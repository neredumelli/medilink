import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { Lang, MessageKey, t as tr } from '@medilink/core';
import { api, clearSession, hasSession } from './api';
import { fonts, useTheme } from './theme';

export interface Me {
  id: string;
  userCode: string;
  name: string;
  mobile: string;
  role: string;
  lang: Lang;
  retailer: { id: string; name: string; area: string; kycStatus: string; gstin: string | null } | null;
}

interface Ctx {
  me: Me | null;
  ready: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: MessageKey) => string;
  toast: (msg: string) => void;
  cartCount: number;
  refreshCart: () => Promise<void>;
  markStart: () => void;
  takeElapsed: () => number | undefined;
}

const C = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangS] = useState<Lang>('en');
  const [msg, setMsg] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const start = useRef<number | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

  const reload = useCallback(async () => {
    try {
      if (!(await hasSession())) return setMe(null);
      const m = await api<Me>('/auth/me');
      setMe(m);
      setLangS(m.lang);
    } catch {
      setMe(null);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const refreshCart = useCallback(async () => {
    const c = await api<{ itemCount: number }>('/shop/cart').catch(() => null);
    if (c) setCartCount(c.itemCount);
  }, []);

  const toast = useCallback(
    (m: string) => {
      setMsg(m);
      fade.setValue(0);
      Animated.sequence([Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }), Animated.delay(2800), Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true })]).start(() => setMsg(null));
    },
    [fade],
  );

  return (
    <C.Provider
      value={{
        me,
        ready,
        reload,
        logout: async () => {
          await clearSession();
          setMe(null);
        },
        lang,
        setLang: (l) => {
          setLangS(l);
          if (me) api('/auth/me/lang', { method: 'PUT', body: { lang: l } }).catch(() => {});
        },
        t: (k) => tr(lang, k),
        toast,
        cartCount,
        refreshCart,
        markStart: () => {
          start.current ??= Date.now();
        },
        takeElapsed: () => {
          const s = start.current;
          start.current = null;
          return s ? Math.max(1, Math.round((Date.now() - s) / 1000)) : undefined;
        },
      }}
    >
      {children}
      {msg && (
        <Animated.View pointerEvents="none" style={[styles.toast, { backgroundColor: theme.ink, opacity: fade }]}>
          <Text style={{ color: theme.bg, fontFamily: fonts.bodyBold, fontSize: 15 }}>{msg}</Text>
        </Animated.View>
      )}
    </C.Provider>
  );
}

export function useSession() {
  const c = useContext(C);
  if (!c) throw new Error('useSession outside provider');
  return c;
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', left: 16, right: 16, bottom: 110, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 18, elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12 },
});
