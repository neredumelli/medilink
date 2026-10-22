/**
 * All money is held in integer paise to avoid floating-point rounding errors.
 * ₹21.43 === 2143 paise.
 */
export type Paise = number;

export interface Scheme {
  /** Buy this many units… */
  buy: number;
  /** …and get this many free. "10+1" => { buy: 10, free: 1 } */
  free: number;
}

export const DEFAULT_GST_PCT = 5; // most medicines after the Sept 2025 GST rate change

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function formatINR(paise: Paise, opts: { decimals?: boolean } = {}): string {
  const rupees = paise / 100;
  const decimals = opts.decimals ?? true;
  return (
    '₹' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    })
  );
}

/** Parses "10+1", "15 + 2", "10+1 scheme". Returns null for anything else. */
export function parseScheme(text: string | null | undefined): Scheme | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s*\+\s*(\d+)/);
  if (!m) return null;
  const buy = Number(m[1]);
  const free = Number(m[2]);
  if (!(buy > 0) || !(free > 0)) return null;
  return { buy, free };
}

export function formatScheme(s: Scheme | null): string {
  return s ? `${s.buy}+${s.free}` : '';
}

/** Free units earned for an ordered quantity. 25 units on 10+1 => 2 free. */
export function freeQty(scheme: Scheme | null, qty: number): number {
  if (!scheme || qty < scheme.buy) return 0;
  return Math.floor(qty / scheme.buy) * scheme.free;
}

/** Billed rate per unit after trade discount (what appears on the invoice line). */
export function billedRate(ptr: Paise, discountPct: number): Paise {
  return Math.round(ptr * (1 - clampPct(discountPct) / 100));
}

/**
 * The number shops compare: effective cost per unit after discount AND scheme.
 * PTR ₹24.00, 2% off, 10+1 => 24 × 0.98 × 10/11 = ₹21.38
 */
export function netRate(ptr: Paise, discountPct: number, scheme: Scheme | null): Paise {
  let r = ptr * (1 - clampPct(discountPct) / 100);
  if (scheme) r = (r * scheme.buy) / (scheme.buy + scheme.free);
  return Math.round(r);
}

export interface PricedLine {
  ratePaise: Paise;
  qty: number;
  gstPct?: number;
}

export interface Totals {
  subtotal: Paise;
  gst: Paise;
  total: Paise;
}

export function orderTotals(lines: PricedLine[]): Totals {
  let subtotal = 0;
  let gst = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 0) throw new RangeError(`Invalid quantity ${l.qty}`);
    const value = l.ratePaise * l.qty;
    subtotal += value;
    gst += Math.round((value * (l.gstPct ?? DEFAULT_GST_PCT)) / 100);
  }
  return { subtotal, gst, total: subtotal + gst };
}

function clampPct(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, p));
}
