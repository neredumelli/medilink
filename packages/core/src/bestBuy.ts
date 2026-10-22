import { netRate, billedRate, Paise, Scheme, DEFAULT_GST_PCT } from './money';

/** One distributor's live offer for one product, as seen by one shop. */
export interface Offer {
  distributorId: string;
  productId: string;
  stockQty: number;
  ptr: Paise;
  discountPct: number;
  scheme: Scheme | null;
  /** ISO date of the nearest batch expiry, if known. */
  nearestExpiry?: string | null;
  /** Typical delivery time to this shop, in hours. */
  etaHours: number;
  /** Credit still available to this shop at this distributor. */
  creditAvailable: Paise;
}

export type BestReason = 'cheapest' | 'only_in_stock' | 'fastest_same_price' | 'partial_stock' | 'credit_limited';

export interface BestPick {
  offer: Offer;
  netRate: Paise;
  /** True when the chosen distributor cannot supply the full quantity. */
  partial: boolean;
  /** True when no distributor with enough credit has stock, so credit will block checkout. */
  overCredit: boolean;
  reasons: BestReason[];
}

/**
 * "Best buy": the distributor a shop owner would pick if they had time to compare.
 *
 * Order of preference:
 *  1. has stock at all
 *  2. can supply the full quantity (if any can)
 *  3. order fits inside the shop's available credit (if any does)
 *  4. lowest net rate after discount + scheme
 *  5. fastest delivery as a tie-breaker
 */
export function pickBest(offers: Offer[], qty: number, opts: { exclude?: string[]; gstPct?: number } = {}): BestPick | null {
  const gstPct = opts.gstPct ?? DEFAULT_GST_PCT;
  let pool = offers.filter((o) => o.stockQty > 0 && !(opts.exclude ?? []).includes(o.distributorId));
  if (pool.length === 0) return null;
  const reasons: BestReason[] = [];
  if (pool.length === 1) reasons.push('only_in_stock');

  const full = pool.filter((o) => o.stockQty >= qty);
  const partial = full.length === 0;
  if (!partial) pool = full;
  else reasons.push('partial_stock');

  const orderValue = (o: Offer) => Math.round(billedRate(o.ptr, o.discountPct) * Math.min(qty, o.stockQty) * (1 + gstPct / 100));
  const withinCredit = pool.filter((o) => o.creditAvailable >= orderValue(o));
  const overCredit = withinCredit.length === 0;
  if (!overCredit) {
    if (withinCredit.length < pool.length) reasons.push('credit_limited');
    pool = withinCredit;
  }

  const ranked = [...pool].sort(
    (a, b) => netRate(a.ptr, a.discountPct, a.scheme) - netRate(b.ptr, b.discountPct, b.scheme) || a.etaHours - b.etaHours,
  );
  const chosen = ranked[0]!;
  const chosenRate = netRate(chosen.ptr, chosen.discountPct, chosen.scheme);
  const runnerUp = ranked[1];
  if (runnerUp && netRate(runnerUp.ptr, runnerUp.discountPct, runnerUp.scheme) === chosenRate) reasons.push('fastest_same_price');
  else if (ranked.length > 1) reasons.push('cheapest');

  return { offer: chosen, netRate: chosenRate, partial, overCredit, reasons };
}

/** Shelf life under this many months is flagged as "short expiry" to the shop. */
export const SHORT_EXPIRY_MONTHS = 6;

export function isShortExpiry(expiryIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiryIso) return false;
  const exp = new Date(expiryIso);
  if (Number.isNaN(exp.getTime())) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() + SHORT_EXPIRY_MONTHS);
  return exp < limit;
}

export type StockLevel = 'out' | 'low' | 'in';
export function stockLevel(qty: number, lowThreshold = 20): StockLevel {
  if (qty <= 0) return 'out';
  return qty < lowThreshold ? 'low' : 'in';
}
