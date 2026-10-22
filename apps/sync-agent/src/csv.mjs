/**
 * Small RFC-4180 CSV reader/writer (quotes, commas and newlines inside quotes, BOM from Excel).
 * Billing software exports differ, so column names are mapped in config.json.
 */

/** @param {string} text @returns {string[][]} */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // Excel BOM
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Turns rows into objects keyed by header (headers trimmed, case-insensitive lookups via lower-case keys). */
export function toRecords(rows) {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

function esc(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/** "1,234.50" -> 1234.5 ; "" -> undefined */
export function num(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Accepts 2027-03, 03/2027, 03/27, 2027-03-31, 31-03-2027 -> YYYY-MM-DD (first of month when no day). */
export function normExpiry(v) {
  if (!v) return undefined;
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/))) return `${m[1]}-${m[2]}-${m[3] ?? '01'}`;
  if ((m = s.match(/^(\d{2})[/-](\d{2}|\d{4})$/))) return `${m[2].length === 2 ? '20' + m[2] : m[2]}-${m[1]}-01`;
  if ((m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/))) return `${m[3]}-${m[2]}-${m[1]}`;
  return undefined;
}
