const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_FORMAT = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Checksum character for the first 14 characters of a GSTIN (mod-36 Luhn variant). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!.toUpperCase());
    if (v < 0) throw new Error('Invalid GSTIN character');
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

export type GstinProblem = 'length' | 'format' | 'checksum' | 'state';

export function validateGstin(input: string): { ok: true; stateCode: string; pan: string } | { ok: false; problem: GstinProblem } {
  const g = input.trim().toUpperCase();
  if (g.length !== 15) return { ok: false, problem: 'length' };
  if (!GSTIN_FORMAT.test(g)) return { ok: false, problem: 'format' };
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 38) return { ok: false, problem: 'state' };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { ok: false, problem: 'checksum' };
  return { ok: true, stateCode: g.slice(0, 2), pan: g.slice(2, 12) };
}

export const TELANGANA_STATE_CODE = '36';

export function isIndianMobile(input: string): boolean {
  return /^[6-9]\d{9}$/.test(normalizeMobile(input));
}

/** "+91 98480 12345" -> "9848012345" */
export function normalizeMobile(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

export function isPan(input: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(input.trim().toUpperCase());
}

/** Drug licence numbers vary by state; we only check it is present and plausible. */
export function isPlausibleDrugLicence(input: string): boolean {
  const s = input.trim();
  return s.length >= 6 && s.length <= 60 && /\d/.test(s);
}
