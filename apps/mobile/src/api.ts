import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { setSystem } from './system';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const RT_KEY = 'ml_refresh';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';
export const API_BASE = BASE;
const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public ref?: string,
  ) {
    super(message);
  }
}

/** Refresh token lives in the phone's secure keychain (iOS Keychain / Android Keystore). */
export async function setSession(t: { accessToken: string; refreshToken: string }) {
  accessToken = t.accessToken;
  await SecureStore.setItemAsync(RT_KEY, t.refreshToken);
}

export async function hasSession() {
  return !!(await SecureStore.getItemAsync(RT_KEY));
}

export async function clearSession() {
  const rt = await SecureStore.getItemAsync(RT_KEY);
  accessToken = null;
  await SecureStore.deleteItemAsync(RT_KEY);
  if (rt) fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(() => {});
}

async function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const rt = await SecureStore.getItemAsync(RT_KEY);
    if (!rt) return false;
    const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-name': 'Phone app' }, body: JSON.stringify({ refreshToken: rt }) });
    if (!r.ok) return false;
    await setSession(await r.json());
    return true;
  })()
    .catch(() => false)
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  if (!accessToken && !path.startsWith('/auth/otp')) await refresh();
  const go = () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    return fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        'x-device-name': 'Phone app',
        'x-app-version': APP_VERSION,
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
  };
  let res: Response;
  try {
    res = await go();
    if (res.status === 401 && (await refresh())) res = await go();
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new ApiError(0, 'This is taking too long. Please try again.');
    // Phones do not tell us reliably whether it is our server or their signal, so we say "offline" (the common case).
    setSystem({ kind: 'offline' });
    throw new ApiError(0, 'No internet connection. Please check and try again.');
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    const msg = typeof b.message === 'string' ? b.message : 'Something went wrong. Please try again.';
    if (res.status === 503 && b.maintenance) setSystem({ kind: 'maintenance', message: msg, until: b.until ?? null });
    else if (res.status === 426 || b.updateRequired) setSystem({ kind: 'update' });
    else if (res.status === 502 || res.status === 503 || res.status === 504) setSystem({ kind: 'down', ref: b.ref });
    throw new ApiError(res.status, msg, b.ref);
  }
  setSystem({ kind: 'ok' });
  return res.json();
}
