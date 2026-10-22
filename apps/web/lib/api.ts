'use client';

/**
 * Small API client. Access tokens live in memory; the refresh token is kept in localStorage so a
 * shop owner stays logged in on the counter PC. (Phase 5 hardening: move refresh to an httpOnly cookie.)
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const RT_KEY = 'ml.rt';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: { field: string; message: string }[],
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

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!accessToken && path !== '/auth/otp/request' && path !== '/auth/otp/verify') await refresh();
  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'x-device-name': 'Web', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && (await refresh())) res = await doFetch();
  } catch {
    throw new ApiError(0, 'No internet connection. Please check and try again.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join(', ') : 'Something went wrong. Please try again.';
    throw new ApiError(res.status, msg, body.issues);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
