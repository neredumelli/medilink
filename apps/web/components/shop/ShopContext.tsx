'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, peek, prefetch } from '@/lib/api';

export interface HomeData {
  shop: {
    name: string;
    area: string;
    kycStatus: string;
    canOrder: boolean;
    licence?: { state: 'ok' | 'expiring' | 'expired' | 'missing'; expiresOn: string | null; daysLeft: number | null; which: string | null };
  };
  chips: { onTheWay: number; creditFreePaise: number; shortageCount: number };
  usual: { productId: string; name: string; category: string; usualQty: number }[];
  lastDelivered: { id: string; number: string; distributor: string; createdAt: string; items: { productId: string; name: string; qty: number }[] } | null;
  latestOpen: { id: string; number: string; status: string; distributor: string; deliveryLabel: string; itemCount: number; totalPaise: number } | null;
}

interface ShopCtx {
  home: HomeData | null;
  cartCount: number;
  cartTotal: number;
  refresh: () => Promise<void>;
  /** Called on the first add to cart, to measure how long ordering takes. */
  markStart: () => void;
  takeElapsed: () => number | undefined;
}

type CartSum = { itemCount: number; totals: { total: number } };
const Ctx = createContext<ShopCtx | null>(null);
const START_KEY = 'ml.orderStart';

export function ShopProvider({ children }: { children: ReactNode }) {
  const [home, setHome] = useState<HomeData | null>(() => peek<HomeData>('/shop/home') ?? null);
  const [cartCount, setCount] = useState(() => peek<CartSum>('/shop/cart')?.itemCount ?? 0);
  const [cartTotal, setTotal] = useState(() => peek<CartSum>('/shop/cart')?.totals.total ?? 0);

  const refresh = useCallback(async () => {
    const [h, c] = await Promise.all([api<HomeData>('/shop/home'), api<CartSum>('/shop/cart')]);
    setHome(h);
    setCount(c.itemCount);
    setTotal(c.totals.total);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    // Fetch the other tabs now, so every tap on the bottom bar opens instantly.
    prefetch(['/shop/orders', '/shop/shortage', '/shop/distributors']);
    const onFocus = () => document.visibilityState === 'visible' && refresh().catch(() => {});
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  return (
    <Ctx.Provider
      value={{
        home,
        cartCount,
        cartTotal,
        refresh,
        markStart: () => {
          try {
            if (!sessionStorage.getItem(START_KEY)) sessionStorage.setItem(START_KEY, String(Date.now()));
          } catch {}
        },
        takeElapsed: () => {
          try {
            const s = sessionStorage.getItem(START_KEY);
            sessionStorage.removeItem(START_KEY);
            return s ? Math.max(1, Math.round((Date.now() - Number(s)) / 1000)) : undefined;
          } catch {
            return undefined;
          }
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useShop() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useShop must be inside ShopProvider');
  return c;
}
