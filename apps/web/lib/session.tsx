'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Lang, MessageKey, t as translate } from '@medilink/core';
import { api, clearSession, hasStoredSession } from './api';
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>('en');
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
    } catch {
      setMe(null);
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

export function homeFor(role: string) {
  if (role.startsWith('RETAILER')) return '/shop';
  if (role.startsWith('DISTRIBUTOR')) return '/distributor';
  return '/admin';
}
