import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderSource, Prisma } from '@prisma/client';
import { billedRate, freeQty, licenceState, orderTotals, parseOrderList, pickBest, productBlockedMessage } from '@medilink/core';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { AuthUser } from '../common/auth';
import { CatalogService, todayDate } from '../catalog/catalog.service';
import { OrderWorkflowService } from '../orders/order-workflow.service';

export interface PlaceResult {
  orders: { id: string; number: string; distributorName: string; totalPaise: number }[];
  totalPaise: number;
  timeToPlaceSec: number | null;
}

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The shop's drug licences (20B/21B): ordering stops the day after the first one expires. */
export function shopLicence(r: { dl20bExpiry: Date | null; dl21bExpiry: Date | null }) {
  const st = licenceState({ '20B': r.dl20bExpiry, '21B': r.dl21bExpiry });
  const message =
    st.state === 'expired'
      ? `Your drug licence (${st.which}) expired on ${fmtDate(st.expiresOn!)}. Send the renewed licence to MediLink support to keep ordering.`
      : st.state === 'expiring'
        ? `Your drug licence (${st.which}) expires on ${fmtDate(st.expiresOn!)}${st.daysLeft === 0 ? ' (today)' : ` (in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'})`}. Renew it so ordering does not stop.`
        : null;
  return { ...st, message };
}

@Injectable()
export class ShopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly workflow: OrderWorkflowService,
  ) {}

  // ------------------------------------------------------------ home
  async home(retailerId: string) {
    const [retailer, credit, onTheWay, shortage, prefs, lastDelivered, latestOpen] = await Promise.all([
      this.prisma.retailer.findUniqueOrThrow({ where: { id: retailerId } }),
      this.catalog.linkedCredit(retailerId),
      this.prisma.order.count({ where: { retailerId, status: { in: ['PLACED', 'ACCEPTED', 'BILLED', 'DISPATCHED'] } } }),
      this.prisma.shortageItem.count({ where: { retailerId } }),
      this.prisma.retailerProductPref.findMany({ where: { retailerId }, orderBy: { orderCount: 'desc' }, take: 8, include: { product: true } }),
      this.prisma.order.findFirst({ where: { retailerId, status: 'DELIVERED' }, orderBy: { createdAt: 'desc' }, include: { items: { include: { product: true } }, distributor: true } }),
      this.prisma.order.findFirst({ where: { retailerId, status: { in: ['PLACED', 'ACCEPTED', 'BILLED', 'DISPATCHED'] } }, orderBy: { createdAt: 'desc' }, include: { distributor: true, _count: { select: { items: true } } } }),
    ]);
    const creditFree = [...credit.values()].reduce((a, c) => a + Math.max(0, c.available), 0);
    const licence = shopLicence(retailer);
    return {
      shop: { name: retailer.name, area: retailer.area, kycStatus: retailer.kycStatus, canOrder: retailer.kycStatus === 'APPROVED' && licence.state !== 'expired', licence },
      chips: { onTheWay, creditFreePaise: creditFree, shortageCount: shortage },
      usual: prefs.map((p) => ({ productId: p.productId, name: p.product.name, category: p.product.category, usualQty: p.usualQty })),
      lastDelivered: lastDelivered && {
        id: lastDelivered.id,
        number: lastDelivered.number,
        distributor: lastDelivered.distributor.name,
        createdAt: lastDelivered.createdAt,
        items: lastDelivered.items.map((i) => ({ productId: i.productId, name: i.product.name, qty: i.qty })),
      },
      latestOpen: latestOpen && {
        id: latestOpen.id,
        number: latestOpen.number,
        status: latestOpen.status,
        distributor: latestOpen.distributor.name,
        deliveryLabel: latestOpen.distributor.deliveryLabel,
        itemCount: latestOpen._count.items,
        totalPaise: latestOpen.totalPaise,
      },
    };
  }

  // ------------------------------------------------------------ cart
  async getCart(retailerId: string) {
    const rows = await this.prisma.cartItem.findMany({ where: { retailerId }, include: { product: true }, orderBy: { createdAt: 'asc' } });
    const offers = await this.catalog.offersFor(retailerId, rows.map((r) => r.productId));
    const credit = await this.catalog.linkedCredit(retailerId);
    const groups = new Map<string, any>();
    for (const r of rows) {
      const offer = (offers.get(r.productId) ?? []).find((o) => o.distributorId === r.distributorId);
      const g =
        groups.get(r.distributorId) ??
        groups
          .set(r.distributorId, {
            distributorId: r.distributorId,
            distributorName: credit.get(r.distributorId)?.link.distributor.name ?? 'Distributor',
            deliveryLabel: credit.get(r.distributorId)?.link.distributor.deliveryLabel ?? '',
            creditLimitPaise: credit.get(r.distributorId)?.link.creditLimitPaise ?? 0,
            creditAvailablePaise: credit.get(r.distributorId)?.available ?? 0,
            lines: [],
          })
          .get(r.distributorId);
      const blockedMsg = productBlockedMessage(r.product.name, r.product.status, r.product.statusNote, r.product);
      g.lines.push({
        productId: r.productId,
        blocked: blockedMsg,
        name: r.product.name,
        pack: r.product.pack,
        category: r.product.category,
        qty: r.qty,
        pinned: r.pinned,
        gstPct: r.product.gstPct,
        ratePaise: offer?.billedRatePaise ?? 0,
        freeQty: offer ? freeQty(offer.scheme, r.qty) : 0,
        valuePaise: (offer?.billedRatePaise ?? 0) * r.qty,
        stockQty: offer?.stockQty ?? 0,
        shortExpiry: offer?.shortExpiry ?? false,
        unavailable: !!blockedMsg || !offer || offer.stockQty === 0,
        alternatives: (offers.get(r.productId) ?? []).filter((o) => o.stockQty > 0).map((o) => ({ distributorId: o.distributorId, name: o.distributorName, netRatePaise: o.netRatePaise })),
      });
    }
    let blocked = rows.some((r) => !!productBlockedMessage(r.product.name, r.product.status, r.product.statusNote, r.product));
    const out = [...groups.values()].map((g) => {
      const totals = orderTotals(g.lines.map((l: any) => ({ ratePaise: l.ratePaise, qty: l.qty, gstPct: l.gstPct })));
      const overCredit = totals.total > g.creditAvailablePaise;
      if (overCredit) blocked = true;
      return { ...g, totals, overCredit, overByPaise: overCredit ? totals.total - g.creditAvailablePaise : 0 };
    });
    const grand = out.reduce((a, g) => ({ subtotal: a.subtotal + g.totals.subtotal, gst: a.gst + g.totals.gst, total: a.total + g.totals.total }), { subtotal: 0, gst: 0, total: 0 });
    return { groups: out, totals: grand, itemCount: rows.length, canPlace: rows.length > 0 && !blocked };
  }

  /** Add or change a cart line. Without a distributor, Best price picks one. */
  async setCartItem(retailerId: string, productId: string, qty: number, distributorId?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Medicine not found');
    const blockedMsg = productBlockedMessage(product.name, product.status, product.statusNote, product);
    if (blockedMsg) throw new ConflictException(blockedMsg);
    const offers = (await this.catalog.offersFor(retailerId, [productId])).get(productId) ?? [];
    let chosen: string;
    if (distributorId) {
      if (!offers.some((o) => o.distributorId === distributorId && o.stockQty > 0)) throw new ConflictException('That distributor has no stock of this medicine right now');
      chosen = distributorId;
    } else {
      const best = pickBest(CatalogService.toCoreOffers(productId, offers), qty, { gstPct: product.gstPct });
      if (!best) throw new ConflictException(`${product.name} is out of stock at all your distributors`);
      chosen = best.offer.distributorId;
    }
    await this.prisma.cartItem.upsert({
      where: { retailerId_productId: { retailerId, productId } },
      create: { retailerId, productId, qty, distributorId: chosen, pinned: !!distributorId },
      update: { qty, distributorId: chosen, pinned: !!distributorId },
    });
    await this.prisma.retailerProductPref.upsert({
      where: { retailerId_productId: { retailerId, productId } },
      create: { retailerId, productId, usualQty: qty },
      update: { usualQty: qty },
    });
    return { productId, qty, distributorId: chosen };
  }

  async addManyBest(retailerId: string, items: { productId: string; qty: number }[], excludeDistributorId?: string) {
    const added: string[] = [];
    const missing: string[] = [];
    for (const it of items) {
      const product = await this.prisma.product.findUnique({ where: { id: it.productId } });
      if (!product) continue;
      if (productBlockedMessage(product.name, product.status, product.statusNote, product)) {
        missing.push(product.name);
        continue;
      }
      const offers = (await this.catalog.offersFor(retailerId, [it.productId])).get(it.productId) ?? [];
      const best = pickBest(CatalogService.toCoreOffers(it.productId, offers), it.qty, { exclude: excludeDistributorId ? [excludeDistributorId] : [], gstPct: product.gstPct });
      if (!best) {
        missing.push(product.name);
        continue;
      }
      await this.prisma.cartItem.upsert({
        where: { retailerId_productId: { retailerId, productId: it.productId } },
        create: { retailerId, productId: it.productId, qty: it.qty, distributorId: best.offer.distributorId },
        update: { qty: it.qty, distributorId: best.offer.distributorId, pinned: false },
      });
      added.push(product.name);
    }
    return { added: added.length, missing };
  }

  async removeCartItem(retailerId: string, productId: string) {
    await this.prisma.cartItem.deleteMany({ where: { retailerId, productId } });
    return { ok: true };
  }

  async reorder(retailerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, retailerId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    return this.addManyBest(retailerId, order.items.map((i) => ({ productId: i.productId, qty: i.qty })));
  }

  /** "Came short": put the missing quantity in the cart from other distributors. */
  async orderShortfall(retailerId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, retailerId }, include: { items: true } });
    if (!order) throw new NotFoundException('Order not found');
    const short = order.items.filter((i) => i.billedQty !== null && i.billedQty < i.qty).map((i) => ({ productId: i.productId, qty: i.qty - (i.billedQty ?? 0) }));
    if (short.length === 0) return { added: 0, missing: [] };
    return this.addManyBest(retailerId, short, order.distributorId);
  }

  // ------------------------------------------------------------ list reading
  async readList(text: string) {
    const catalog = await this.catalog.lightCatalog();
    const lines = parseOrderList(text, catalog);
    const byId = new Map(catalog.map((c) => [c.id, c]));
    return lines.map((l) => ({ ...l, product: l.productId ? byId.get(l.productId) : null, needsCheck: l.confidence < 50 }));
  }

  // ------------------------------------------------------------ shortage list
  async shortageList(retailerId: string) {
    const rows = await this.prisma.shortageItem.findMany({ where: { retailerId }, include: { product: true, addedBy: { select: { name: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ id: r.id, productId: r.productId, name: r.product.name, category: r.product.category, qty: r.qty, addedBy: r.addedBy?.name ?? 'Staff', createdAt: r.createdAt }));
  }

  async addShortage(user: AuthUser, retailerId: string, productId: string, qty: number) {
    await this.prisma.shortageItem.upsert({
      where: { retailerId_productId: { retailerId, productId } },
      create: { retailerId, productId, qty, addedById: user.sub },
      update: { qty },
    });
    return this.shortageList(retailerId);
  }

  async removeShortage(retailerId: string, id: string) {
    await this.prisma.shortageItem.deleteMany({ where: { id, retailerId } });
    return this.shortageList(retailerId);
  }

  async orderShortageList(retailerId: string) {
    const rows = await this.prisma.shortageItem.findMany({ where: { retailerId } });
    const res = await this.addManyBest(retailerId, rows.map((r) => ({ productId: r.productId, qty: r.qty })));
    const inCart = await this.prisma.cartItem.findMany({ where: { retailerId, productId: { in: rows.map((r) => r.productId) } }, select: { productId: true } });
    await this.prisma.shortageItem.deleteMany({ where: { retailerId, productId: { in: inCart.map((c) => c.productId) } } });
    return res;
  }

  // ------------------------------------------------------------ placing orders
  /**
   * Turns the cart into one order per distributor.
   * Re-checks link status and credit under a row lock so two phones in the same shop cannot overspend.
   */
  async placeOrders(user: AuthUser, retailerId: string, input: { timeToPlaceSec?: number; source: OrderSource }, idempotencyKey?: string) {
    // Duplicate protection: the same key (double tap, network retry) returns the first result.
    if (idempotencyKey) {
      const seen = await this.prisma.idempotencyKey.findUnique({ where: { userId_key: { userId: user.sub, key: idempotencyKey } } });
      if (seen) return seen.response as unknown as PlaceResult;
    }
    const retailer = await this.prisma.retailer.findUniqueOrThrow({ where: { id: retailerId } });
    if (retailer.kycStatus !== 'APPROVED') throw new ForbiddenException('Your shop documents are still being checked. You can order as soon as they are approved.');
    const licence = shopLicence(retailer);
    if (licence.state === 'expired') throw new ForbiddenException({ message: licence.message, licenceExpired: true });
    if (user.role === 'RETAILER_STAFF') throw new ForbiddenException('Only the shop owner can place orders. Add items to the shortage list instead.');

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "RetailerDistributorLink" WHERE "retailerId" = ${retailerId}::uuid FOR UPDATE`;
      // Checked again under the lock: a second identical request waits here, then gets the first result.
      if (idempotencyKey) {
        const seen = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId: user.sub, key: idempotencyKey } } });
        if (seen) return seen.response as unknown as PlaceResult;
      }
      const cart = await tx.cartItem.findMany({ where: { retailerId }, include: { product: true } });
      if (cart.length === 0) throw new BadRequestException('Your cart is empty');
      for (const c of cart) {
        const msg = productBlockedMessage(c.product.name, c.product.status, c.product.statusNote, c.product);
        if (msg) throw new ConflictException(`${msg} Please remove it from your cart.`);
      }

      const byDist = new Map<string, typeof cart>();
      cart.forEach((c) => byDist.set(c.distributorId, [...(byDist.get(c.distributorId) ?? []), c]));

      const orders = [];
      for (const [distributorId, lines] of byDist) {
        const link = await tx.retailerDistributorLink.findUnique({ where: { retailerId_distributorId: { retailerId, distributorId } }, include: { distributor: true } });
        if (!link || link.status !== 'LINKED') throw new ConflictException('One of the distributors in your cart is not linked to your shop');
        if (link.distributor.drugLicenceExpiry && link.distributor.drugLicenceExpiry < todayDate()) {
          throw new ConflictException(`${link.distributor.name} cannot take orders right now (their licence renewal is pending). Please pick another distributor in your cart.`);
        }

        const items = [];
        for (const c of lines) {
          const di = await tx.distributorItem.findFirst({ where: { distributorId, productId: c.productId }, orderBy: { stockQty: 'desc' } });
          if (!di || di.stockQty === 0) throw new ConflictException(`${c.product.name} just went out of stock at ${link.distributor.name}. Please pick another distributor in your cart.`);
          const scheme = di.schemeBuy && di.schemeFree ? { buy: di.schemeBuy, free: di.schemeFree } : null;
          items.push({ productId: c.productId, distributorItemId: di.id, qty: c.qty, freeQty: freeQty(scheme, c.qty), ratePaise: billedRate(di.ptrPaise, di.discountPct), gstPct: c.product.gstPct });
        }
        const totals = orderTotals(items);
        const available = link.creditLimitPaise - link.outstandingPaise - link.reservedPaise;
        if (totals.total > available) {
          throw new ConflictException({
            message: `This order to ${link.distributor.name} is more than your available credit. Move some items to another distributor or pay your dues.`,
            distributorId,
            overByPaise: totals.total - available,
          });
        }
        const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
        const order = await tx.order.create({
          data: {
            number: `ML-${n}`,
            retailerId,
            distributorId,
            source: input.source,
            placedById: user.sub,
            subtotalPaise: totals.subtotal,
            gstPaise: totals.gst,
            totalPaise: totals.total,
            timeToPlaceSec: input.timeToPlaceSec,
            items: { create: items },
            events: { create: { status: 'PLACED', actorType: 'RETAILER', actorId: user.sub } },
          },
        });
        await tx.retailerDistributorLink.update({ where: { id: link.id }, data: { reservedPaise: { increment: totals.total } } });
        await this.audit.log({ actorId: user.sub, actorLabel: retailer.name, action: 'order.place', entity: 'Order', entityId: order.number, after: { distributor: link.distributor.name, totalPaise: totals.total } }, tx);
        await this.notify.toUsersOf({ distributorId }, 'order_new', { number: order.number, shop: retailer.name, totalPaise: totals.total }, tx);
        orders.push({ id: order.id, number: order.number, distributorName: link.distributor.name, totalPaise: totals.total });
      }

      for (const c of cart) {
        await tx.retailerProductPref.upsert({
          where: { retailerId_productId: { retailerId, productId: c.productId } },
          create: { retailerId, productId: c.productId, usualQty: c.qty, orderCount: 1 },
          update: { usualQty: c.qty, orderCount: { increment: 1 } },
        });
      }
      await tx.cartItem.deleteMany({ where: { retailerId } });
      const placed: PlaceResult = { orders, totalPaise: orders.reduce((a, o) => a + o.totalPaise, 0), timeToPlaceSec: input.timeToPlaceSec ?? null };
      if (idempotencyKey) {
        await tx.idempotencyKey.create({ data: { userId: user.sub, key: idempotencyKey, route: 'shop.placeOrders', response: placed as unknown as Prisma.InputJsonValue } });
      }
      return placed;
    });
    return result;
  }

  async orders(retailerId: string, take = 30) {
    const rows = await this.prisma.order.findMany({
      where: { retailerId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { distributor: true, items: { include: { product: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      distributor: { id: o.distributorId, name: o.distributor.name, deliveryLabel: o.distributor.deliveryLabel },
      createdAt: o.createdAt,
      totalPaise: o.totalPaise,
      invoiceNo: o.invoiceNo,
      partial: o.partial,
      rejectReason: o.rejectReason,
      items: o.items.map((i) => ({ productId: i.productId, name: i.product.name, qty: i.qty, freeQty: i.freeQty, billedQty: i.billedQty })),
      events: o.events.map((e) => ({ status: e.status, at: e.createdAt, note: e.note })),
    }));
  }

  cancel(user: AuthUser, retailerId: string, orderId: string) {
    return this.workflow.transition(orderId, 'CANCELLED', { type: 'RETAILER', id: user.sub, label: user.name, retailerId }, { reason: 'Cancelled by shop' });
  }

  markReceived(user: AuthUser, retailerId: string, orderId: string) {
    return this.workflow.transition(orderId, 'DELIVERED', { type: 'RETAILER', id: user.sub, label: user.name, retailerId });
  }

  // ------------------------------------------------------------ distributors
  async distributors(retailerId: string) {
    const [all, links] = await Promise.all([
      this.prisma.distributor.findMany({ where: { kycStatus: 'APPROVED' }, orderBy: { name: 'asc' } }),
      this.prisma.retailerDistributorLink.findMany({ where: { retailerId } }),
    ]);
    const byD = new Map(links.map((l) => [l.distributorId, l]));
    return all.map((d) => {
      const l = byD.get(d.id);
      return {
        id: d.id,
        name: d.name,
        area: d.area,
        deliveryLabel: d.deliveryLabel,
        link: l ? { status: l.status, creditLimitPaise: l.creditLimitPaise, duesPaise: l.outstandingPaise, openOrdersPaise: l.reservedPaise, availablePaise: l.creditLimitPaise - l.outstandingPaise - l.reservedPaise } : null,
      };
    });
  }

  async requestLink(user: AuthUser, retailerId: string, distributorId: string) {
    const d = await this.prisma.distributor.findFirst({ where: { id: distributorId, kycStatus: 'APPROVED' } });
    if (!d) throw new NotFoundException('Distributor not found');
    const existing = await this.prisma.retailerDistributorLink.findUnique({ where: { retailerId_distributorId: { retailerId, distributorId } } });
    if (existing?.status === 'LINKED') return { status: 'LINKED' };
    await this.prisma.retailerDistributorLink.upsert({
      where: { retailerId_distributorId: { retailerId, distributorId } },
      create: { retailerId, distributorId, status: 'PENDING' },
      update: { status: 'PENDING' },
    });
    const shop = await this.prisma.retailer.findUniqueOrThrow({ where: { id: retailerId } });
    await this.audit.log({ actorId: user.sub, actorLabel: shop.name, action: 'link.request', entity: 'Distributor', entityId: distributorId });
    await this.notify.toUsersOf({ distributorId }, 'link_request', { shop: shop.name, area: shop.area });
    return { status: 'PENDING' };
  }
}
