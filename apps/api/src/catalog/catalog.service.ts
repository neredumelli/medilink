import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { billedRate, isShortExpiry, netRate, Offer, pickBest, productBlockedMessage, stockLevel } from '@medilink/core';
import { PrismaService } from '../prisma.service';

export interface OfferView {
  distributorId: string;
  distributorName: string;
  area: string;
  deliveryLabel: string;
  etaHours: number;
  distributorItemId: string;
  stockQty: number;
  stockLevel: 'out' | 'low' | 'in';
  ptrPaise: number;
  discountPct: number;
  scheme: { buy: number; free: number } | null;
  billedRatePaise: number;
  netRatePaise: number;
  nearestExpiry: string | null;
  shortExpiry: boolean;
  creditAvailablePaise: number;
  stockUpdatedAt: string;
}

/** Today's date as stored in DATE columns (midnight UTC), for licence checks. */
export function todayDate(now = new Date()) {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Distributors whose wholesale licence has not expired (no date recorded = allowed). */
export const licensedDistributor = (now = new Date()): Prisma.DistributorWhereInput => ({ OR: [{ drugLicenceExpiry: null }, { drugLicenceExpiry: { gte: todayDate(now) } }] });

export interface ProductCard {
  product: Pick<Product, 'id' | 'name' | 'form' | 'pack' | 'salt' | 'company' | 'schedule' | 'ndps' | 'category' | 'mrpPaise' | 'gstPct' | 'status' | 'statusNote'>;
  /** Why this medicine cannot be ordered (banned, recalled, discontinued); null when it can. */
  blocked: string | null;
  usualQty: number;
  offers: OfferView[];
  best: { distributorId: string; netRatePaise: number; partial: boolean; overCredit: boolean; reasons: string[] } | null;
  /** Distributors the shop is not linked to that have this in stock. */
  unlinkedWithStock: number;
  substitutes: { id: string; name: string; company: string; fromNetRatePaise: number }[];
}

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Typo-tolerant search: brand prefix first, then trigram word similarity on name + salt + company. */
  async searchIds(q: string, limit = 12): Promise<string[]> {
    const term = q.trim().toLowerCase().slice(0, 60);
    if (!term) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Product"
      WHERE ${term} <% "searchText" OR "searchText" ILIKE ${'%' + term + '%'}
      ORDER BY (lower(name) LIKE ${term + '%'}) DESC,
               (status = 'ACTIVE') DESC,
               word_similarity(${term}, "searchText") DESC,
               name ASC
      LIMIT ${Prisma.raw(String(Math.min(50, Math.max(1, Math.floor(limit)))))}`;
    return rows.map((r) => r.id);
  }

  /** Credit still free for this shop at each linked distributor (limit − dues − open orders). */
  async linkedCredit(retailerId: string) {
    const links = await this.prisma.retailerDistributorLink.findMany({
      where: { retailerId, status: 'LINKED', distributor: licensedDistributor() },
      include: { distributor: true },
    });
    return new Map(links.map((l) => [l.distributorId, { link: l, available: l.creditLimitPaise - l.outstandingPaise - l.reservedPaise }]));
  }

  async offersFor(retailerId: string, productIds: string[], knownCredit?: Awaited<ReturnType<CatalogService['linkedCredit']>>): Promise<Map<string, OfferView[]>> {
    if (productIds.length === 0) return new Map();
    const credit = knownCredit ?? (await this.linkedCredit(retailerId));
    const items = await this.prisma.distributorItem.findMany({
      where: { productId: { in: productIds }, distributorId: { in: [...credit.keys()] } },
      include: { distributor: true },
      orderBy: { stockQty: 'desc' },
    });
    const now = new Date();
    const map = new Map<string, OfferView[]>(productIds.map((id) => [id, []]));
    const seen = new Set<string>();
    for (const it of items) {
      const key = `${it.productId}|${it.distributorId}`;
      if (seen.has(key)) continue; // a distributor may map two codes to one product: keep the one with most stock
      seen.add(key);
      const scheme = it.schemeBuy && it.schemeFree ? { buy: it.schemeBuy, free: it.schemeFree } : null;
      const expiry = it.nearestExpiry ? it.nearestExpiry.toISOString().slice(0, 10) : null;
      map.get(it.productId!)!.push({
        distributorId: it.distributorId,
        distributorName: it.distributor.name,
        area: it.distributor.area,
        deliveryLabel: it.distributor.deliveryLabel,
        etaHours: it.distributor.etaHours,
        distributorItemId: it.id,
        stockQty: it.stockQty,
        stockLevel: stockLevel(it.stockQty),
        ptrPaise: it.ptrPaise,
        discountPct: it.discountPct,
        scheme,
        billedRatePaise: billedRate(it.ptrPaise, it.discountPct),
        netRatePaise: netRate(it.ptrPaise, it.discountPct, scheme),
        nearestExpiry: expiry,
        shortExpiry: isShortExpiry(expiry, now),
        creditAvailablePaise: credit.get(it.distributorId)!.available,
        stockUpdatedAt: it.stockUpdatedAt.toISOString(),
      });
    }
    return map;
  }

  static toCoreOffers(productId: string, offers: OfferView[]): Offer[] {
    return offers.map((o) => ({
      distributorId: o.distributorId,
      productId,
      stockQty: o.stockQty,
      ptr: o.ptrPaise,
      discountPct: o.discountPct,
      scheme: o.scheme,
      nearestExpiry: o.nearestExpiry,
      etaHours: o.etaHours,
      creditAvailable: o.creditAvailablePaise,
    }));
  }

  /**
   * Product cards for search, barcode and detail screens. A fixed number of queries however many
   * medicines match (no per-medicine round trips), so search stays fast as the catalogue grows.
   */
  async cards(retailerId: string, productIds: string[]): Promise<ProductCard[]> {
    if (productIds.length === 0) return [];
    const credit = await this.linkedCredit(retailerId);
    const linkedIds = [...credit.keys()];
    const [products, offers, prefs, unlinked] = await Promise.all([
      this.prisma.product.findMany({ where: { id: { in: productIds } } }),
      this.offersFor(retailerId, productIds, credit),
      this.prisma.retailerProductPref.findMany({ where: { retailerId, productId: { in: productIds } } }),
      this.prisma.distributorItem.groupBy({
        by: ['productId'],
        where: { productId: { in: productIds }, stockQty: { gt: 0 }, distributorId: { notIn: linkedIds }, distributor: { kycStatus: 'APPROVED', ...licensedDistributor() } },
        _count: { _all: true },
      }),
    ]);
    const usual = new Map(prefs.map((p) => [p.productId, p.usualQty]));
    const unlinkedCount = new Map(unlinked.map((u) => [u.productId!, u._count._all]));
    const byId = new Map(products.map((p) => [p.id, p]));

    const draft = productIds
      .map((id) => byId.get(id))
      .filter((p): p is Product => !!p)
      .map((p) => {
        const qty = usual.get(p.id) ?? 10;
        const blocked = productBlockedMessage(p.name, p.status, p.statusNote, p);
        const list = blocked ? [] : offers.get(p.id) ?? [];
        const best = blocked ? null : pickBest(CatalogService.toCoreOffers(p.id, list), qty, { gstPct: p.gstPct });
        return { p, qty, blocked, list, best };
      });
    const subs = await this.substitutesFor(retailerId, draft.filter((d) => !d.best).map((d) => d.p), credit);

    return draft.map(({ p, qty, blocked, list, best }) => ({
      product: { id: p.id, name: p.name, form: p.form, pack: p.pack, salt: p.salt, company: p.company, schedule: p.schedule, ndps: p.ndps, category: p.category, mrpPaise: p.mrpPaise, gstPct: p.gstPct, status: p.status, statusNote: p.statusNote },
      blocked,
      usualQty: qty,
      offers: list,
      best: best && { distributorId: best.offer.distributorId, netRatePaise: best.netRate, partial: best.partial, overCredit: best.overCredit, reasons: best.reasons },
      unlinkedWithStock: blocked ? 0 : unlinkedCount.get(p.id) ?? 0,
      substitutes: best ? [] : subs.get(p.id) ?? [],
    }));
  }

  /** Same-salt medicines in stock for several products at once (two queries in total). */
  async substitutesFor(retailerId: string, products: Product[], credit?: Awaited<ReturnType<CatalogService['linkedCredit']>>) {
    const out = new Map<string, ProductCard['substitutes']>();
    if (products.length === 0) return out;
    const salts = [...new Set(products.map((p) => p.salt.toLowerCase()))];
    const same = await this.prisma.product.findMany({
      where: { OR: salts.map((salt) => ({ salt: { equals: salt, mode: 'insensitive' as const } })), status: 'ACTIVE', ndps: false, schedule: { not: 'X' } },
      take: 200,
    });
    const offers = await this.offersFor(retailerId, same.map((s) => s.id), credit);
    for (const p of products) {
      const list = same
        .filter((s) => s.id !== p.id && s.salt.toLowerCase() === p.salt.toLowerCase())
        .slice(0, 5)
        .map((s) => {
          const inStock = (offers.get(s.id) ?? []).filter((o) => o.stockQty > 0);
          return inStock.length ? { id: s.id, name: s.name, company: s.company, fromNetRatePaise: Math.min(...inStock.map((o) => o.netRatePaise)) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      out.set(p.id, list);
    }
    return out;
  }

  async substitutes(retailerId: string, p: Product) {
    return (await this.substitutesFor(retailerId, [p])).get(p.id) ?? [];
  }

  async search(retailerId: string, q: string) {
    return this.cards(retailerId, await this.searchIds(q));
  }

  async card(retailerId: string, productId: string) {
    const [c] = await this.cards(retailerId, [productId]);
    if (!c) throw new NotFoundException('Medicine not found');
    return c;
  }

  async byBarcode(retailerId: string, barcode: string) {
    const p = barcode ? await this.prisma.productBarcode.findUnique({ where: { code: barcode } }) : null;
    if (!p) throw new NotFoundException('We could not find this barcode. Try searching by name.');
    return this.card(retailerId, p.productId);
  }

  /** Small catalogue list for offline search in the mobile app and for reading pasted lists. */
  async lightCatalog() {
    return this.prisma.product.findMany({ where: { status: { not: 'DISCONTINUED' } }, select: { id: true, name: true, salt: true, company: true, form: true, pack: true, category: true }, orderBy: { name: 'asc' } });
  }
}
