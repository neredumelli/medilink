import { Searchable, matchScore } from './search';

export interface ParsedLine {
  raw: string;
  productId: string | null;
  qty: number;
  /** true when the quantity was written in the line, false when we fell back to the usual quantity */
  qtyGiven: boolean;
  /** 0–100, from the search score. Under 50 should be confirmed by the user. */
  confidence: number;
}

const LINE_RE = /^(.*?)[\s\-x×X:*=]+(\d{1,4})\s*(strips?|strp|s|nos?|pcs|pc|boxes?|bx|tabs?)?\.?$/i;

/**
 * Reads a free-text order list as shops send it on WhatsApp:
 *   "Dolo 650 - 20", "pan 40 x10", "azithral 5", "montair lc 10 strips", "shelcal"
 * One item per line (commas and semicolons also split).
 */
export function parseOrderList(
  text: string,
  catalog: Searchable[],
  usualQty: (productId: string) => number = () => 10,
): ParsedLine[] {
  return text
    .split(/[\n,;]+/)
    .map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s+/, '').trim())
    .filter((l) => l.length > 0)
    .map((raw) => {
      const m = raw.match(LINE_RE);
      const name = (m ? m[1]! : raw).trim();
      const qtyGiven = !!m;
      let bestId: string | null = null;
      let best = 0;
      for (const item of catalog) {
        const s = matchScore(item, name);
        if (s > best) {
          best = s;
          bestId = item.id;
        }
      }
      const qty = m ? Math.max(1, Math.min(9999, Number(m[2]))) : bestId ? usualQty(bestId) : 1;
      return { raw, productId: bestId, qty, qtyGiven, confidence: best };
    });
}
