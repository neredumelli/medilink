/**
 * Typo-tolerant product matching used for (a) offline search in the mobile app and
 * (b) reading pasted / WhatsApp order lists. Server-side search uses PostgreSQL
 * pg_trgm with the same field priorities.
 */
export interface Searchable {
  id: string;
  name: string;
  salt: string;
  company: string;
}

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0 = no match. Higher is better. Brand prefix beats brand contains beats salt beats company beats typo. */
export function matchScore(item: Searchable, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const name = normalize(item.name);
  const salt = normalize(item.salt);
  const company = normalize(item.company);
  if (name.startsWith(q)) return 100;
  if (name.includes(q)) return 80;
  if (salt.includes(q)) return 70;
  if (company.startsWith(q)) return 40;
  if (q.length >= 4) {
    const d = levenshtein(q, name.slice(0, q.length));
    if (d <= Math.floor(q.length / 4) + 1) return 55 - d;
    if (q.length >= 5) {
      const d2 = levenshtein(q, salt.slice(0, q.length));
      if (d2 <= 2) return 45 - d2;
    }
  }
  return 0;
}

export function searchItems<T extends Searchable>(items: T[], query: string, limit = 20): T[] {
  return items
    .map((item) => ({ item, s: matchScore(item, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((x) => x.item);
}

/** Products with the same composition, used as substitutes when something is out of stock. */
export function sameComposition<T extends Searchable>(items: T[], of: T): T[] {
  const key = normalize(of.salt);
  return items.filter((x) => x.id !== of.id && normalize(x.salt) === key);
}
