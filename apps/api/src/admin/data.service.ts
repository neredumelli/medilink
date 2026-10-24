import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldEntity, FieldType, Prisma, ProductStatus, Schedule } from '@prisma/client';
import { CONTROLLED_MESSAGE, fieldKeyFrom, isControlledMedicine, FIELD_KEY_RE, isValidAlias, isValidBarcode, licenceState, normalizeAlias, validateCustomValues } from '@medilink/core';
import { PrismaService, Tx } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { AuthUser } from '../common/auth';

const OPEN: Prisma.EnumOrderStatusFilter = { in: ['PLACED', 'ACCEPTED', 'BILLED', 'DISPATCHED'] };

/**
 * Medicines master data, custom fields, licence dates and change history for the admin panel.
 * Every change runs with app.actor set, so the database history records who made it.
 */
@Injectable()
export class DataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  private asActor<T>(admin: AuthUser, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.actor', ${admin.name}, true)`;
      return fn(tx);
    });
  }

  // ------------------------------------------------------------ medicines
  async products(f: { q?: string; status?: ProductStatus }) {
    const q = f.q?.trim().toLowerCase();
    const rows = await this.prisma.product.findMany({
      where: {
        ...(f.status ? { status: f.status } : {}),
        ...(q ? { OR: [{ searchText: { contains: q } }, { barcodes: { some: { code: q } } }] } : {}),
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      take: 200,
      include: { _count: { select: { aliases: true, barcodes: true, items: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      pack: p.pack,
      company: p.company,
      salt: p.salt,
      category: p.category,
      status: p.status,
      controlled: isControlledMedicine(p),
      aliases: p._count.aliases,
      barcodes: p._count.barcodes,
      distributors: p._count.items,
    }));
  }

  async product(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        aliases: { orderBy: { alias: 'asc' } },
        barcodes: { orderBy: { createdAt: 'asc' } },
        items: { include: { distributor: { select: { name: true } }, batches: { orderBy: { expiry: 'asc' } } }, orderBy: { stockQty: 'desc' } },
      },
    });
    if (!p) throw new NotFoundException('Medicine not found');
    const [fields, history, openOrders] = await Promise.all([
      this.fields('PRODUCT'),
      this.history(['Product', 'ProductAlias', 'ProductBarcode'], [id], p.items.map((i) => i.id)),
      this.prisma.order.count({ where: { status: OPEN, items: { some: { productId: id } } } }),
    ]);
    return {
      product: { id: p.id, name: p.name, form: p.form, pack: p.pack, salt: p.salt, company: p.company, hsn: p.hsn, gstPct: p.gstPct, schedule: p.schedule, ndps: p.ndps, controlled: isControlledMedicine(p), category: p.category, mrpPaise: p.mrpPaise, status: p.status, statusNote: p.statusNote, statusAt: p.statusAt, extra: p.extra },
      aliases: p.aliases.map((a) => ({ id: a.id, alias: a.alias })),
      barcodes: p.barcodes.map((b) => b.code),
      stock: p.items.map((i) => ({
        distributor: i.distributor.name,
        externalCode: i.externalCode,
        stockQty: i.stockQty,
        ptrPaise: i.ptrPaise,
        nearestExpiry: i.nearestExpiry,
        batches: i.batches.map((b) => ({ batchNo: b.batchNo, expiry: b.expiry, stockQty: b.stockQty })),
      })),
      openOrders,
      fields,
      history,
    };
  }

  /** Active / discontinued / banned / recalled. Blocking statuses need a note shops will read. */
  async setStatus(admin: AuthUser, id: string, status: ProductStatus, note?: string) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Medicine not found');
    if (status !== 'ACTIVE' && !note?.trim()) throw new BadRequestException('Write a short note for shops, e.g. the notice number and date.');
    const updated = await this.asActor(admin, async (tx) => {
      const u = await tx.product.update({ where: { id }, data: { status, statusNote: status === 'ACTIVE' ? null : note!.trim(), statusAt: status === 'ACTIVE' ? null : new Date() } });
      await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'product.status', entity: 'Product', entityId: id, before: { status: p.status }, after: { status, note } }, tx);
      return u;
    });
    // Distributors with open orders for it must know before they bill.
    if (status === 'BANNED' || status === 'RECALLED') {
      const dists = await this.prisma.order.findMany({ where: { status: OPEN, items: { some: { productId: id } } }, select: { distributorId: true }, distinct: ['distributorId'] });
      for (const d of dists) await this.notify.toUsersOf({ distributorId: d.distributorId }, 'product_blocked', { product: p.name, status, note });
    }
    const inCarts = await this.prisma.cartItem.count({ where: { productId: id } });
    return { id, status: updated.status, statusNote: updated.statusNote, shopsWithItInCart: inCarts };
  }

  /**
   * Sets the drug schedule and narcotic flag. Making a medicine Schedule X or narcotic blocks it everywhere
   * at once: the database removes it from carts and refuses it in new orders. Open orders are flagged to
   * their distributors.
   */
  async setControl(admin: AuthUser, id: string, schedule: Schedule, ndps: boolean) {
    const p = await this.prisma.product.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Medicine not found');
    const inCarts = await this.prisma.cartItem.count({ where: { productId: id } });
    const updated = await this.asActor(admin, async (tx) => {
      const u = await tx.product.update({ where: { id }, data: { schedule, ndps } });
      await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'product.control', entity: 'Product', entityId: id, before: { schedule: p.schedule, ndps: p.ndps }, after: { schedule, ndps } }, tx);
      return u;
    });
    const nowControlled = isControlledMedicine(updated);
    if (nowControlled && !isControlledMedicine(p)) {
      const dists = await this.prisma.order.findMany({ where: { status: OPEN, items: { some: { productId: id } } }, select: { distributorId: true }, distinct: ['distributorId'] });
      for (const d of dists) await this.notify.toUsersOf({ distributorId: d.distributorId }, 'product_blocked', { product: p.name, status: 'CONTROLLED', note: CONTROLLED_MESSAGE });
    }
    return { id, schedule: updated.schedule, ndps: updated.ndps, controlled: nowControlled, removedFromCarts: nowControlled ? inCarts : 0 };
  }

  async addAlias(admin: AuthUser, productId: string, raw: string) {
    if (!isValidAlias(raw)) throw new BadRequestException('Use 2 to 80 letters for the other name.');
    const alias = normalizeAlias(raw);
    await this.mustExist(productId);
    const dup = await this.prisma.productAlias.findUnique({ where: { productId_alias: { productId, alias } } });
    if (dup) throw new ConflictException(`"${alias}" is already a name for this medicine.`);
    await this.asActor(admin, (tx) => tx.productAlias.create({ data: { productId, alias } }));
    return this.prisma.productAlias.findMany({ where: { productId }, orderBy: { alias: 'asc' }, select: { id: true, alias: true } });
  }

  async removeAlias(admin: AuthUser, productId: string, aliasId: string) {
    await this.asActor(admin, (tx) => tx.productAlias.deleteMany({ where: { id: aliasId, productId } }));
    return this.prisma.productAlias.findMany({ where: { productId }, orderBy: { alias: 'asc' }, select: { id: true, alias: true } });
  }

  async addBarcode(admin: AuthUser, productId: string, raw: string) {
    const code = raw.trim();
    if (!isValidBarcode(code)) throw new BadRequestException('A barcode has 6 to 20 digits or letters.');
    await this.mustExist(productId);
    const owner = await this.prisma.productBarcode.findUnique({ where: { code }, include: { product: { select: { name: true } } } });
    if (owner && owner.productId !== productId) throw new ConflictException(`This barcode already belongs to ${owner.product.name}. Remove it there first.`);
    if (!owner) await this.asActor(admin, (tx) => tx.productBarcode.create({ data: { code, productId } }));
    return (await this.prisma.productBarcode.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } })).map((b) => b.code);
  }

  async removeBarcode(admin: AuthUser, productId: string, code: string) {
    await this.asActor(admin, (tx) => tx.productBarcode.deleteMany({ where: { code, productId } }));
    return (await this.prisma.productBarcode.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } })).map((b) => b.code);
  }

  private async mustExist(productId: string) {
    if (!(await this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw new NotFoundException('Medicine not found');
  }

  // ------------------------------------------------------------ custom fields
  fields(entity?: FieldEntity) {
    return this.prisma.customField.findMany({ where: entity ? { entity } : {}, orderBy: [{ entity: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }] });
  }

  async createField(admin: AuthUser, b: { entity: FieldEntity; label: string; type: FieldType; options?: string[]; required?: boolean }) {
    const key = fieldKeyFrom(b.label);
    if (!FIELD_KEY_RE.test(key)) throw new BadRequestException('Use a label with at least two letters.');
    const options = [...new Set((b.options ?? []).map((o) => o.trim()).filter(Boolean))];
    if (b.type === 'CHOICE' && options.length === 0) throw new BadRequestException('Add at least one choice.');
    if (await this.prisma.customField.findUnique({ where: { entity_key: { entity: b.entity, key } } })) throw new ConflictException(`There is already a field called "${b.label}".`);
    const count = await this.prisma.customField.count({ where: { entity: b.entity } });
    const f = await this.asActor(admin, (tx) => tx.customField.create({ data: { entity: b.entity, key, label: b.label.trim(), type: b.type, options: b.type === 'CHOICE' ? options : [], required: !!b.required, sortOrder: count + 1 } }));
    await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'field.create', entity: 'CustomField', entityId: f.id, after: { entity: f.entity, key: f.key, type: f.type } });
    return f;
  }

  /** Label, choices, required and on/off can change. Key and type cannot (existing values depend on them). */
  async updateField(admin: AuthUser, id: string, b: { label?: string; options?: string[]; required?: boolean; active?: boolean; sortOrder?: number }) {
    const f = await this.prisma.customField.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Field not found');
    const options = b.options ? [...new Set(b.options.map((o) => o.trim()).filter(Boolean))] : undefined;
    if (f.type === 'CHOICE' && options && options.length === 0) throw new BadRequestException('Keep at least one choice.');
    return this.asActor(admin, (tx) =>
      tx.customField.update({ where: { id }, data: { label: b.label?.trim(), options: f.type === 'CHOICE' ? options : undefined, required: b.required, active: b.active, sortOrder: b.sortOrder } }),
    );
  }

  /** Saves custom field values on a medicine, shop or distributor after checking them against the field rules. */
  async setExtra(admin: AuthUser, entity: FieldEntity, id: string, values: Record<string, unknown>) {
    const defs = await this.fields(entity);
    const current = await this.extraOf(entity, id);
    const res = validateCustomValues(
      defs.map((d) => ({ key: d.key, label: d.label, type: d.type, options: d.options, required: d.required, active: d.active })),
      values,
      current,
    );
    if (!res.ok) throw new BadRequestException({ message: res.errors.join(' '), errors: res.errors });
    const data = { extra: res.clean as Prisma.InputJsonValue };
    await this.asActor(admin, async (tx) => {
      if (entity === 'PRODUCT') await tx.product.update({ where: { id }, data });
      else if (entity === 'RETAILER') await tx.retailer.update({ where: { id }, data });
      else await tx.distributor.update({ where: { id }, data });
    });
    return res.clean;
  }

  private async extraOf(entity: FieldEntity, id: string): Promise<Record<string, unknown>> {
    const row =
      entity === 'PRODUCT'
        ? await this.prisma.product.findUnique({ where: { id }, select: { extra: true } })
        : entity === 'RETAILER'
          ? await this.prisma.retailer.findUnique({ where: { id }, select: { extra: true } })
          : await this.prisma.distributor.findUnique({ where: { id }, select: { extra: true } });
    if (!row) throw new NotFoundException('Not found');
    return (row.extra ?? {}) as Record<string, unknown>;
  }

  // ------------------------------------------------------------ licences
  /** Shops and distributors whose licence has expired or expires within 30 days. */
  async licenceAlerts() {
    const soon = new Date(Date.now() + 31 * 86_400_000);
    const [shops, dists] = await Promise.all([
      this.prisma.retailer.findMany({ where: { OR: [{ dl20bExpiry: { lte: soon } }, { dl21bExpiry: { lte: soon } }] }, select: { id: true, name: true, area: true, dl20bExpiry: true, dl21bExpiry: true } }),
      this.prisma.distributor.findMany({ where: { drugLicenceExpiry: { lte: soon } }, select: { id: true, name: true, area: true, drugLicenceExpiry: true } }),
    ]);
    return [
      ...shops.map((r) => ({ type: 'shop' as const, id: r.id, name: r.name, area: r.area, ...licenceState({ '20B': r.dl20bExpiry, '21B': r.dl21bExpiry }) })),
      ...dists.map((d) => ({ type: 'distributor' as const, id: d.id, name: d.name, area: d.area, ...licenceState({ Wholesale: d.drugLicenceExpiry }) })),
    ]
      .filter((x) => x.state === 'expired' || x.state === 'expiring')
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  }

  /** Records a renewed licence. Ordering resumes at once. */
  async setLicence(admin: AuthUser, type: 'shop' | 'distributor', id: string, b: { dl20bExpiry?: string | null; dl21bExpiry?: string | null; drugLicenceExpiry?: string | null }) {
    const d = (s?: string | null) => (s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`));
    const today = new Date().toISOString().slice(0, 10);
    for (const v of [b.dl20bExpiry, b.dl21bExpiry, b.drugLicenceExpiry]) if (v && v < today) throw new BadRequestException('The new expiry date is already in the past.');
    await this.asActor(admin, async (tx) => {
      if (type === 'shop') await tx.retailer.update({ where: { id }, data: { dl20bExpiry: d(b.dl20bExpiry), dl21bExpiry: d(b.dl21bExpiry) } });
      else await tx.distributor.update({ where: { id }, data: { drugLicenceExpiry: d(b.drugLicenceExpiry) } });
      await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'licence.renewed', entity: type === 'shop' ? 'Retailer' : 'Distributor', entityId: id, after: b }, tx);
    });
    return { ok: true };
  }

  // ------------------------------------------------------------ history
  /** Change history for some rows (newest first), from the database triggers. */
  async history(tables: string[], rowIds: string[], itemIds: string[] = [], take = 60) {
    const rows = await this.prisma.rowHistory.findMany({
      where: { OR: [{ tableName: { in: tables }, rowId: { in: rowIds } }, ...(itemIds.length ? [{ tableName: 'DistributorItem', rowId: { in: itemIds } }] : [])] },
      orderBy: { changedAt: 'desc' },
      take,
    });
    return rows.map((r) => ({ id: r.id.toString(), table: r.tableName, op: r.op, changes: r.changes, actor: r.actor ?? 'System', at: r.changedAt }));
  }
}
