'use client';

/**
 * Small API client built for "eye-blink" screens:
 *  - Every page's data is remembered on the device (memory + localStorage, per user). A screen draws the
 *    remembered data at once and the fresh answer replaces it a moment later, silently.
 *  - The short-lived access token is kept for the browser tab (sessionStorage), so reloading a page does
 *    not wait for a token refresh first.
 *  - Identical requests in flight are shared (a prefetch and a page asking for the same data make one call).
 * The refresh token is kept in localStorage so a shop owner stays logged in on the counter PC.
 */
import { getSystem, setSystem, slowEnd, slowStart } from './system';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const RT_KEY = 'ml.rt';
const AT_KEY = 'ml.at';
const CACHE_KEY = 'ml.cache.v1';
const CACHE_MAX = 80;

let accessToken: string | null = loadAccessToken();
let refreshing: Promise<boolean> | null = null;

// ------------------------------------------------------------------ remembered data
type Entry = { at: number; data: unknown };
let cache = new Map<string, Entry>();
let cacheOwner: string | null = null;
const inflight = new Map<string, { seq: number; p: Promise<unknown> }>();
/** Goes up after every change (POST/PUT/DELETE), so a read started before a change is never reused after it. */
let changeSeq = 0;

function tokenOwner(t: string | null): string | null {
  if (!t) return null;
  try {
    return JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).sub ?? null;
  } catch {
    return null;
  }
}

function loadAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const t = sessionStorage.getItem(AT_KEY);
    if (!t) return null;
    const exp = JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
    return exp * 1000 > Date.now() + 20_000 ? t : null;
  } catch {
    return null;
  }
}

function loadCache() {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { owner: string; entries: [string, Entry][] };
    cacheOwner = saved.owner;
    cache = new Map(saved.entries);
  } catch {
    /* unreadable or blocked storage: start empty */
  }
}
loadCache();

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = [...cache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ owner: cacheOwner, entries }));
    } catch {
      /* storage full or blocked: memory cache still works */
    }
  }, 150);
}

function remember(path: string, data: unknown) {
  const owner = tokenOwner(accessToken);
  if (owner && owner !== cacheOwner) {
    cache.clear();
    cacheOwner = owner;
  }
  cache.set(path, { at: Date.now(), data });
  persist();
}

/** The last answer seen for a GET path, if any (drawn instantly while a fresh copy loads). */
export function peek<T>(path: string): T | undefined {
  const owner = tokenOwner(accessToken);
  if (owner && cacheOwner && owner !== cacheOwner) return undefined;
  return cache.get(path)?.data as T | undefined;
}

/** Fetch these screens' data in the background, so the next tap opens instantly. */
export function prefetch(paths: string[]) {
  const run = () => paths.forEach((p) => api(p, { quiet: true }).catch(() => {}));
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) (window as any).requestIdleCallback(run, { timeout: 1200 });
  else setTimeout(run, 50);
}

export function clearCache() {
  cache.clear();
  cacheOwner = null;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

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
    sessionStorage.setItem(AT_KEY, tokens.accessToken);
  } catch {}
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
  clearCache();
  try {
    localStorage.removeItem(RT_KEY);
    localStorage.removeItem('ml.me');
    sessionStorage.removeItem(AT_KEY);
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
/** A thin progress line appears only if an action takes longer than this. Reads never show it once data is remembered. */
const SLOW_MS = 400;

/**
 * Calls the API. Besides normal errors it reports system-wide problems to the status screen:
 *   offline (user's internet) · down (our server unreachable / 502-504) · maintenance (503) · update (426).
 */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string>; quiet?: boolean } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const cacheable = method === 'GET' && !opts.headers && !path.startsWith('/auth/');
  if (cacheable) {
    const running = inflight.get(path);
    if (running && running.seq === changeSeq) return running.p as Promise<T>;
    const seq = changeSeq;
    const p = request<T>(path, { ...opts, method, quiet: opts.quiet || cache.has(path) }).then((d) => {
      if (seq === changeSeq) remember(path, d);
      return d;
    });
    inflight.set(path, { seq, p });
    p.finally(() => inflight.get(path)?.p === p && inflight.delete(path)).catch(() => {});
    return p;
  }
  const result = await request<T>(path, { ...opts, method });
  if (method !== 'GET') changeSeq++;
  return result;
}

async function request<T>(path: string, opts: { method: string; body?: unknown; headers?: Record<string, string>; quiet?: boolean }): Promise<T> {
  if (!accessToken && !['/auth/otp/request', '/auth/otp/verify', '/auth/2fa/verify'].includes(path)) await refresh();
  const doFetch = () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(`${BASE}${path}`, {
      method: opts.method,
      headers: { 'content-type': 'application/json', 'x-device-name': 'Web', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  };
  let slowOn = false;
  const slowTimer = opts.quiet
    ? undefined
    : setTimeout(() => {
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
      if (opts.quiet) throw new ApiError(0, 'You are offline. Check your internet connection.');
      setSystem({ kind: 'offline' });
      throw new ApiError(0, 'You are offline. Check your internet connection.');
    }
    if ((e as Error)?.name === 'AbortError') throw new ApiError(0, 'This is taking too long. Please try again.');
    if (opts.quiet) throw new ApiError(0, 'We could not reach MediLink.');
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
