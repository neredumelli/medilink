'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export interface HomeData {
  shop: { name: string; area: string; kycStatus: string; canOrder: boolean };
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

const Ctx = createContext<ShopCtx | null>(null);
const START_KEY = 'ml.orderStart';

export function ShopProvider({ children }: { children: ReactNode }) {
  const [home, setHome] = useState<HomeData | null>(null);
  const [cartCount, setCount] = useState(0);
  const [cartTotal, setTotal] = useState(0);

  const refresh = useCallback(async () => {
    const [h, c] = await Promise.all([api<HomeData>('/shop/home'), api<{ itemCount: number; totals: { total: number } }>('/shop/cart')]);
    setHome(h);
    setCount(c.itemCount);
    setTotal(c.totals.total);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
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
