import { CATEGORY_COLOR, CategoryKey, formatINR } from '@medilink/core';

export const inr = (paise: number) => formatINR(paise);
export const inr0 = (paise: number) => formatINR(paise, { decimals: false });
export const lakh = (paise: number) => (paise >= 10_000_000 ? `₹${(paise / 10_000_000).toFixed(1).replace(/\.0$/, '')}L` : inr0(paise));

export function ago(iso: string | Date) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** CSS colour family class for a product category, e.g. "c-coral". */
export function catClass(category: string) {
  const c = CATEGORY_COLOR[(category as CategoryKey) ?? 'OTHER'] ?? 'sky';
  return `c-${c === 'brand' ? 'green' : c}`;
}

export const abbr = (name: string) => name.replace(/[^A-Za-z]/g, '').slice(0, 2);
