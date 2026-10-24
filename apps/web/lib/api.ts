'use client';

/**
 * Small API client. Access tokens live in memory; the refresh token is kept in localStorage so a
 * shop owner stays logged in on the counter PC. (Phase 5 hardening: move refresh to an httpOnly cookie.)
 */
import { getSystem, setSystem, slowEnd, slowStart } from './system';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const RT_KEY = 'ml.rt';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { field: string; message: string }[],
    /** Reference code to quote to support, e.g. ML-7F3K2. */
    public ref?: string,
    /** The full error body, for screens that react to extra flags. */
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function setSession(tokens: { accessToken: string; refreshToken: string }) {
  accessToken = tokens.accessToken;
  try {
    localStorage.setItem(RT_KEY, tokens.refreshToken);
  } catch {
    /* private mode: session lasts until the tab closes */
  }
}

export function hasStoredSession(): boolean {
  try {
    return !!localStorage.getItem(RT_KEY);
  } catch {
    return false;
  }
}

export async function clearSession() {
  const rt = safeGet();
  accessToken = null;
  try {
    localStorage.removeItem(RT_KEY);
  } catch {}
  if (rt) await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => {});
}

function safeGet() {
  try {
    return localStorage.getItem(RT_KEY);
  } catch {
    return null;
  }
}

async function refresh(): Promise<boolean> {
  const rt = safeGet();
  if (!rt) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-name': 'Web' },
    body: JSON.stringify({ refreshToken: rt }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      setSession(await r.json());
      return true;
    })
    .catch(() => false)
    .finally(() => (refreshing = null));
  return refreshing;
}

const TIMEOUT_MS = 30_000;
const SLOW_MS = 5_000;

/**
 * Calls the API. Besides normal errors it reports system-wide problems to the status screen:
 *   offline (user's internet) · down (our server unreachable / 502-504) · maintenance (503) · update (426).
 */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  if (!accessToken && !['/auth/otp/request', '/auth/otp/verify', '/auth/2fa/verify'].includes(path)) await refresh();
  const doFetch = () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'x-device-name': 'Web', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  };
  let slowOn = false;
  const slowTimer = setTimeout(() => {
    slowOn = true;
    slowStart();
  }, SLOW_MS);
  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && (await refresh())) res = await doFetch();
  } catch (e) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) {
      setSystem({ kind: 'offline' });
      throw new ApiError(0, 'You are offline. Check your internet connection.');
    }
    if ((e as Error)?.name === 'AbortError') throw new ApiError(0, 'This is taking too long. Please try again.');
    setSystem({ kind: 'down' });
    throw new ApiError(0, 'We could not reach MediLink. Please try again in a few minutes.');
  } finally {
    clearTimeout(slowTimer);
    if (slowOn) slowEnd();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join(', ') : 'Something went wrong. Please try again.';
    if (res.status === 503 && body.maintenance) setSystem({ kind: 'maintenance', message: msg, until: body.until ?? null });
    else if (res.status === 426 || body.updateRequired) setSystem({ kind: 'update' });
    else if (res.status === 502 || res.status === 503 || res.status === 504) setSystem({ kind: 'down', ref: body.ref });
    else if (res.status === 403 && typeof window !== 'undefined') {
      // Admins: 2-step login has to be set up, or this session was made before it was switched on.
      if (body.twoFactorSetup && !window.location.pathname.startsWith('/admin/security')) window.location.assign('/admin/security');
      if (body.twoFactorLogin) {
        await clearSession();
        window.location.assign('/login');
      }
    }
    throw new ApiError(res.status, msg, body.issues, body.ref, body);
  }
  if (getSystem().kind !== 'ok') setSystem({ kind: 'ok' });
  return res.status === 204 ? (undefined as T) : res.json();
}
