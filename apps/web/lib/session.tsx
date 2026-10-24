'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { Lang, MessageKey, t as translate } from '@medilink/core';
import { api, ApiError, clearSession, hasStoredSession } from './api';
import { SystemStatus } from '@/components/SystemStatus';

export interface Me {
  id: string;
  userCode: string;
  name: string;
  mobile: string;
  role: string;
  lang: Lang;
  retailer: { id: string; name: string; area: string; kycStatus: string; gstin: string | null } | null;
  distributor: { id: string; name: string; area: string; code: string; billingSoftware: string } | null;
  /** Admins only: authenticator-app 2-step login. */
  twoFactor: { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number } | null;
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: MessageKey) => string;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const Ctx = createContext<SessionCtx | null>(null);

const ME_KEY = 'ml.me';

function rememberedMe(): Me | null {
  if (typeof window === 'undefined' || !hasStoredSession()) return null;
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // The logged-in user is remembered on the device, so screens draw at once on reload; /auth/me confirms it quietly.
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>('en');
  useLayoutEffect(() => {
    const m = rememberedMe();
    if (m) {
      setMe(m);
      setLangState(m.lang);
      setLoading(false);
    }
  }, []);
  const [toastMsg, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!hasStoredSession()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      const m = await api<Me>('/auth/me');
      setMe(m);
      setLangState(m.lang);
      try {
        localStorage.setItem(ME_KEY, JSON.stringify(m));
      } catch {}
    } catch (e) {
      // Only a real "please log in again" ends the session; a network blip keeps the remembered user.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setMe(null);
        try {
          localStorage.removeItem(ME_KEY);
        } catch {}
      } else if (!rememberedMe()) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    if (me) {
      try {
        localStorage.setItem(ME_KEY, JSON.stringify({ ...me, lang: l }));
      } catch {}
    }
    if (me) api('/auth/me/lang', { method: 'PUT', body: { lang: l } }).catch(() => {});
  };

  const toast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout((window as any).__mlToast);
    (window as any).__mlToast = window.setTimeout(() => setToast(null), 3400);
  }, []);

  return (
    <Ctx.Provider
      value={{
        me,
        loading,
        reload,
        logout: async () => {
          await clearSession();
          setMe(null);
        },
        lang,
        setLang,
        t: (k) => translate(lang, k),
        toast,
        toastMsg,
      }}
    >
      {children}
      <SystemStatus />
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession must be inside SessionProvider');
  return c;
}

/** The data each home screen needs, fetched while login finishes so the first screen is already filled. */
export function homeDataFor(role: string): string[] {
  if (role.startsWith('RETAILER')) return ['/shop/home', '/shop/cart'];
  if (role.startsWith('DISTRIBUTOR')) return ['/distributor/dashboard', '/distributor/lanes', '/distributor/shops'];
  return ['/admin/overview', '/admin/kyc', '/admin/sync-health', '/admin/orders', '/admin/audit', '/admin/licences'];
}

export function homeFor(role: string) {
  if (role.startsWith('RETAILER')) return '/shop';
  if (role.startsWith('DISTRIBUTOR')) return '/distributor';
  return '/admin';
}
