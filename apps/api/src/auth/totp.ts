/**
 * Authenticator-app codes (TOTP, RFC 6238: 30-second steps, 6 digits, HMAC-SHA1), as used by
 * Google Authenticator, Microsoft Authenticator, Authy and others. No third-party code needed.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits), base32 as authenticator apps expect. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

/** The 6-digit code for one 30-second step. */
export function totpCode(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Checks a code, allowing one step of clock drift either way. Returns the matched step, or null.
 * A step at or before `lastStep` is refused so a code cannot be used twice.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastStep?: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** The link an authenticator app understands (also drawn as a QR code). */
export function otpauthUrl(secretBase32: string, account: string, issuer = 'MediLink'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}

// ---------------------------------------------------------------- secret storage
// The secret is stored encrypted (AES-256-GCM), so a database copy alone cannot produce login codes.
function keyFrom(material: string): Buffer {
  return createHash('sha256').update(`medilink-totp:${material}`).digest();
}

export function encryptSecret(secret: string, material: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFrom(material), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(stored: string, material: string): string {
  const [v, iv, tag, enc] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', keyFrom(material), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

// ---------------------------------------------------------------- recovery codes
/** Ten one-time codes like "K7QD-M2XP" for when the phone is lost. Only their hashes are stored. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(`recovery:${normalizeRecoveryCode(code)}`).digest('hex');
}
