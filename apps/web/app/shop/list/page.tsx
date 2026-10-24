'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, peek } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ago } from '@/lib/format';
import { ProductTile } from '@/components/shop/ProductCard';
import { useShop } from '@/components/shop/ShopContext';

interface Item {
  id: string;
  productId: string;
  name: string;
  category: string;
  qty: number;
  addedBy: string;
  createdAt: string;
}

export default function ListPage() {
  const { toast } = useSession();
  const { refresh, markStart } = useShop();
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(() => peek<Item[]>('/shop/shortage') ?? null);
  const load = useCallback(async () => setItems(await api<Item[]>('/shop/shortage')), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function remove(id: string) {
    setItems(await api<Item[]>(`/shop/shortage/${id}`, { method: 'DELETE' }));
    await refresh();
  }
  async function orderAll() {
    markStart();
    const r = await api<{ added: number; missing: string[] }>('/shop/shortage/order-all', { body: {} });
    await refresh();
    toast(`${r.added} items in cart${r.missing.length ? `. Still out of stock: ${r.missing.join(', ')}` : ''}`);
    router.push('/shop/cart');
  }

  return (
    <main className="r-main">
      <section className="card">
        <div className="sec-h">
          <h2>Shortage list</h2>
          <span className="pill c-sky">Shared with staff</span>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Your staff add items here during the day from their own login. When you are ready, order everything in one tap.
        </p>
        {!items ? (
          <div className="skeleton" />
        ) : items.length === 0 ? (
          <p className="empty">Nothing here. Tap the bookmark on any medicine to save it.</p>
        ) : (
          <>
            <div className="lines">
              {items.map((l) => (
                <div className="line" key={l.id}>
                  <ProductTile name={l.name} category={l.category} small />
                  <div>
                    <b>{l.name}</b> <span className="muted">× {l.qty}</span>
                    <div className="hint">
                      Added by {l.addedBy} · {ago(l.createdAt)}
                    </div>
                  </div>
                  <button className="btn small" onClick={() => remove(l.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button className="btn primary wide" onClick={orderAll}>
              Order all {items.length} at best price
            </button>
          </>
        )}
      </section>
    </main>
  );
}
