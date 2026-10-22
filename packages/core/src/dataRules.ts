/**
 * Rules for the flexible data model: medicine status, licence expiry and admin-defined custom fields.
 * Shared by the API (enforcement) and the apps (labels and warnings), so they never disagree.
 */

// ------------------------------------------------------------------ medicine status
export type ProductStatus = 'ACTIVE' | 'DISCONTINUED' | 'BANNED' | 'RECALLED';
export const PRODUCT_STATUSES: ProductStatus[] = ['ACTIVE', 'DISCONTINUED', 'BANNED', 'RECALLED'];

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  ACTIVE: 'Active',
  DISCONTINUED: 'Discontinued by the company',
  BANNED: 'Banned by the government',
  RECALLED: 'Recalled',
};

export const canOrderProduct = (s: ProductStatus | string) => s === 'ACTIVE';

/** The sentence a shop sees when a medicine cannot be ordered. */
export function productBlockedMessage(name: string, status: ProductStatus | string, note?: string | null): string | null {
  if (status === 'ACTIVE') return null;
  const why =
    status === 'BANNED' ? `${name} is banned by the government and cannot be ordered.` : status === 'RECALLED' ? `${name} has been recalled and cannot be ordered.` : `${name} is discontinued by the company.`;
  return note ? `${why} ${note}` : why;
}

// ------------------------------------------------------------------ licence expiry
export const LICENCE_WARN_DAYS = 30;

export interface LicenceState {
  state: 'ok' | 'expiring' | 'expired' | 'missing';
  /** earliest expiry date (YYYY-MM-DD) among the licences given */
  expiresOn: string | null;
  /** days left until that date (negative when already expired) */
  daysLeft: number | null;
  /** which licence expires first, e.g. "20B" */
  which: string | null;
}

const dayNumber = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
const toDay = (v: string | Date) => (typeof v === 'string' ? new Date(`${v.slice(0, 10)}T00:00:00`) : new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));

/**
 * Looks at a set of licence expiry dates and says whether the business can keep trading.
 * A licence is valid through its expiry date; ordering stops the day after.
 * No dates at all → 'missing' (allowed: older records before dates were collected).
 */
export function licenceState(expiries: Record<string, string | Date | null | undefined>, today: Date = new Date()): LicenceState {
  const known = Object.entries(expiries).filter((e): e is [string, string | Date] => !!e[1]);
  if (known.length === 0) return { state: 'missing', expiresOn: null, daysLeft: null, which: null };
  const [which, first] = known.map(([k, v]) => [k, toDay(v)] as const).sort((a, b) => a[1].getTime() - b[1].getTime())[0]!;
  const daysLeft = dayNumber(first) - dayNumber(today);
  const pad = (n: number) => String(n).padStart(2, '0');
  const expiresOn = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(first.getDate())}`;
  const state = daysLeft < 0 ? 'expired' : daysLeft <= LICENCE_WARN_DAYS ? 'expiring' : 'ok';
  return { state, expiresOn, daysLeft, which };
}

// ------------------------------------------------------------------ custom fields
export type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'YESNO' | 'CHOICE';
export type FieldEntity = 'PRODUCT' | 'RETAILER' | 'DISTRIBUTOR';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  active?: boolean;
}

export type FieldValue = string | number | boolean;

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** "Same-day order cut-off" → "same_day_order_cut_off" */
export function fieldKeyFrom(label: string): string {
  const k = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return /^[a-z]/.test(k) ? k : `f_${k}`.slice(0, 40);
}

/**
 * Checks values typed by an admin (or from an import) against the field definitions.
 * Returns clean values (numbers as numbers, yes/no as booleans, trimmed text) or readable errors.
 * Values for unknown or switched-off fields are kept untouched, so turning a field off never loses data.
 */
export function validateCustomValues(defs: FieldDef[], values: Record<string, unknown>, existing: Record<string, unknown> = {}): { ok: boolean; clean: Record<string, FieldValue>; errors: string[] } {
  const clean: Record<string, FieldValue> = {};
  const errors: string[] = [];
  for (const [k, v] of Object.entries(existing)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[k] = v;

  const active = defs.filter((d) => d.active !== false);
  const byKey = new Map(active.map((d) => [d.key, d]));
  for (const [key, raw] of Object.entries(values)) {
    const def = byKey.get(key);
    if (!def) {
      errors.push(`"${key}" is not a field. Add it under Data fields first.`);
      continue;
    }
    if (raw === null || raw === undefined || raw === '') {
      delete clean[key];
      continue;
    }
    const s = String(raw).trim();
    switch (def.type) {
      case 'TEXT':
        if (s.length > 300) errors.push(`${def.label}: keep it under 300 characters.`);
        else clean[key] = s;
        break;
      case 'NUMBER': {
        const n = Number(s.replace(/,/g, ''));
        if (!Number.isFinite(n)) errors.push(`${def.label}: enter a number.`);
        else clean[key] = n;
        break;
      }
      case 'DATE':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) errors.push(`${def.label}: enter a date like 2026-12-31.`);
        else clean[key] = s;
        break;
      case 'YESNO': {
        const yes = ['true', 'yes', 'y', '1'].includes(s.toLowerCase());
        const no = ['false', 'no', 'n', '0'].includes(s.toLowerCase());
        if (!yes && !no) errors.push(`${def.label}: choose Yes or No.`);
        else clean[key] = yes;
        break;
      }
      case 'CHOICE': {
        const match = (def.options ?? []).find((o) => o.toLowerCase() === s.toLowerCase());
        if (!match) errors.push(`${def.label}: choose one of ${(def.options ?? []).join(', ')}.`);
        else clean[key] = match;
        break;
      }
    }
  }
  for (const d of active) if (d.required && (clean[d.key] === undefined || clean[d.key] === '')) errors.push(`${d.label} is required.`);
  return { ok: errors.length === 0, clean, errors };
}

// ------------------------------------------------------------------ aliases and barcodes
/** Aliases are stored lower-case and trimmed; Telugu/Hindi script is kept as typed. */
export const normalizeAlias = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
export const isValidAlias = (s: string) => {
  const a = normalizeAlias(s);
  return a.length >= 2 && a.length <= 80;
};
export const isValidBarcode = (s: string) => /^[0-9A-Za-z-]{6,20}$/.test(s.trim());
