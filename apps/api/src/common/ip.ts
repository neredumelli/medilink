/** Admin IP allow-list: exact addresses (IPv4 or IPv6) and IPv4 ranges such as 203.0.113.0/24. */

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4ToInt(ip: string): number | null {
  const m = V4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** "::ffff:203.0.113.5" (IPv4 seen through an IPv6 socket) → "203.0.113.5". */
export function normalizeIp(ip: string | undefined | null): string {
  const s = (ip ?? '').trim().toLowerCase();
  return s.startsWith('::ffff:') && V4.test(s.slice(7)) ? s.slice(7) : s;
}

/** True when the entry is a valid address or IPv4 range. */
export function isValidAllowEntry(entry: string): boolean {
  const e = entry.trim();
  if (e.includes('/')) {
    const [base, bits] = e.split('/');
    return v4ToInt(base!) !== null && /^\d{1,2}$/.test(bits!) && Number(bits) <= 32;
  }
  return v4ToInt(e) !== null || /^[0-9a-f:]+$/i.test(e);
}

export function ipAllowed(ip: string | undefined | null, list: string[]): boolean {
  if (list.length === 0) return true;
  const addr = normalizeIp(ip);
  const n = v4ToInt(addr);
  return list.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry.includes('/')) return normalizeIp(entry) === addr;
    if (n === null) return false;
    const [base, bitsS] = entry.split('/');
    const b = v4ToInt(base!);
    const bits = Number(bitsS);
    if (b === null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  });
}
