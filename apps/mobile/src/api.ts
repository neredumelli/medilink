import * as SecureStore from 'expo-secure-store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const RT_KEY = 'ml_refresh';
let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!accessToken && !path.startsWith('/auth/otp')) await refresh();
  const go = () =>
    fetch(`${BASE}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', 'x-device-name': 'Phone app', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  let res: Response;
  try {
    res = await go();
    if (res.status === 401 && (await refresh())) res = await go();
  } catch {
    throw new ApiError(0, 'No internet connection. Please check and try again.');
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new ApiError(res.status, typeof b.message === 'string' ? b.message : 'Something went wrong. Please try again.');
  }
  return res.json();
}
