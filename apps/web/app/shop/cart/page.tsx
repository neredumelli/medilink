'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { inr, inr0 } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ProductTile } from '@/components/shop/ProductCard';
import { useShop } from '@/components/shop/ShopContext';

interface Line {
  productId: string;
  name: string;
  pack: string;
  category: string;
  qty: number;
  ratePaise: number;
  freeQty: number;
  valuePaise: number;
  stockQty: number;
  shortExpiry: boolean;
  unavailable: boolean;
  /** banned / recalled / discontinued since it was added */
  blocked?: string | null;
  alternatives: { distributorId: string; name: string; netRatePaise: number }[];
}
interface Group {
  distributorId: string;
  distributorName: string;
  deliveryLabel: string;
  creditLimitPaise: number;
  creditAvailablePaise: number;
  lines: Line[];
  totals: { subtotal: number; gst: number; total: number };
  overCredit: boolean;
  overByPaise: number;
}
interface Cart {
  groups: Group[];
  totals: { subtotal: number; gst: number; total: number };
  itemCount: number;
  canPlace: boolean;
}

export default function CartPage() {
  const { t, toast } = useSession();
  const { refresh, takeElapsed, home } = useShop();
  const router = useRouter();
  const [cart, setCart] = useState<Cart | null>(null);
  /** One key per placement attempt: a retry after a lost connection reuses it, so the order is never created twice. */
  const placeKey = useRef<string | null>(null);
  const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setCart(await api<Cart>('/shop/cart')), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function change(productId: string, body: { qty: number; distributorId?: string }) {
    try {
      placeKey.current = null;
      await api(`/shop/cart/${productId}`, { method: 'PUT', body });
      await Promise.all([load(), refresh()]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update');
    }
  }
  async function remove(productId: string) {
    placeKey.current = null;
    await api(`/shop/cart/${productId}`, { method: 'DELETE' });
    await Promise.all([load(), refresh()]);
  }
  async function place() {
    setBusy(true);
    try {
      placeKey.current ??= newKey();
      const res = await api<{ orders: { number: string; distributorName: string }[]; totalPaise: number; timeToPlaceSec: number | null }>('/shop/orders', {
        body: { timeToPlaceSec: takeElapsed(), source: 'WEB' },
        headers: { 'Idempotency-Key': placeKey.current },
      });
      placeKey.current = null;
      sessionStorage.setItem('ml.justPlaced', JSON.stringify(res));
      await refresh();
      router.push('/shop/orders');
    } catch (e) {
      // A clear answer from the server (e.g. cart changed, credit limit) means this attempt is finished: next tap is a new order.
      // No answer (connection lost, server down) keeps the key, so tapping again cannot create a duplicate.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) placeKey.current = null;
      toast(e instanceof ApiError ? e.message : 'Could not place the order');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!cart) return <main className="r-main"><div className="skeleton" /></main>;
  if (cart.itemCount === 0)
    return (
      <main className="r-main">
        <div className="empty">
          <Icon name="cart" size={48} />
          <p>Your cart is empty.</p>
          <Link className="btn primary" href="/shop">
            Find medicines
          </Link>
        </div>
      </main>
    );

  return (
    <main className="r-main">
      {cart.groups.map((g) => {
        const used = g.creditLimitPaise - g.creditAvailablePaise;
        const pu = g.creditLimitPaise ? Math.min(100, (used / g.creditLimitPaise) * 100) : 100;
        const pn = g.creditLimitPaise ? Math.min(100 - pu, (g.totals.total / g.creditLimitPaise) * 100) : 0;
        return (
          <section className="card" key={g.distributorId}>
            <div className="sec-h">
              <h2>{g.distributorName}</h2>
              <span className="pill c-green">
                <Icon name="truck" /> {g.deliveryLabel}
              </span>
            </div>
            <div className="lines">
              {g.lines.map((l) => (
                <div className="line" key={l.productId}>
                  <ProductTile name={l.name} category={l.category} small />
                  <div style={{ minWidth: 0 }}>
                    <b>{l.name}</b> <span className="muted">{l.pack}</span>
                    <div className="hint">
                      {l.qty}
                      {l.freeQty > 0 && <b style={{ color: 'var(--violet)' }}> + {l.freeQty} free</b>} × {inr(l.ratePaise)}
                      {l.shortExpiry && <span style={{ color: 'var(--sun-ink)' }}> · short expiry</span>}
                      {!l.blocked && l.stockQty < l.qty && <span style={{ color: 'var(--bad)' }}> · only {l.stockQty} in stock</span>}
                    </div>
                    {l.blocked && (
                      <div className="hint" role="alert" style={{ color: 'var(--bad)', fontWeight: 700 }}>
                        {t('cannotOrder')}: {l.blocked}{' '}
                        <button className="linkbtn" onClick={() => remove(l.productId)}>
                          {t('removeFromCart')}
                        </button>
                      </div>
                    )}
                  </div>
                  <b>{inr0(l.valuePaise)}</b>
                  <div className="ctrl">
                    <label className="sr" htmlFor={`cq-${l.productId}`}>
                      Quantity
                    </label>
                    <input className="q" id={`cq-${l.productId}`} inputMode="numeric" defaultValue={l.qty} onBlur={(e) => Number(e.target.value) !== l.qty && change(l.productId, { qty: Math.max(1, Number(e.target.value) || 1), distributorId: g.distributorId })} />
                    <label className="sr" htmlFor={`cd-${l.productId}`}>
                      Distributor
                    </label>
                    <select id={`cd-${l.productId}`} value={g.distributorId} onChange={(e) => change(l.productId, { qty: l.qty, distributorId: e.target.value })}>
                      {l.alternatives.map((a) => (
                        <option key={a.distributorId} value={a.distributorId}>
                          {a.name} · {inr(a.netRatePaise)}
                        </option>
                      ))}
                    </select>
                    <button className="linkbtn" onClick={() => remove(l.productId)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="row-b hint" style={{ marginBottom: 6 }}>
                <span>Credit available</span>
                <b style={{ color: g.overCredit ? 'var(--bad)' : 'var(--ink)' }}>
                  {inr0(g.creditAvailablePaise)} of {inr0(g.creditLimitPaise)}
                </b>
              </div>
              <div className="creditbar" aria-hidden="true">
                <i style={{ width: `${pu}%`, background: 'var(--muted)', opacity: 0.5 }} />
                <i style={{ width: `${pn}%`, background: g.overCredit ? 'var(--bad)' : 'var(--brand)' }} />
              </div>
            </div>
            {g.overCredit && <div className="note c-coral">This order is {inr0(g.overByPaise)} more than your credit here. Switch some items to another distributor above, or pay your dues from Account.</div>}
            <div className="row-b">
              <span className="muted">Subtotal with GST</span>
              <b>{inr(g.totals.total)}</b>
            </div>
          </section>
        );
      })}
      <section className="card">
        <div className="totals">
          <span>Medicines</span>
          <span>{inr(cart.totals.subtotal)}</span>
          <span>GST</span>
          <span>{inr(cart.totals.gst)}</span>
          <span className="big">Total</span>
          <span className="big">{inr(cart.totals.total)}</span>
        </div>
        {home && !home.shop.canOrder && <div className="note c-sky">Ordering opens once your shop documents are approved.</div>}
        <button className="btn primary wide addbtn" disabled={busy || !cart.canPlace || (home ? !home.shop.canOrder : false)} onClick={place}>
          <Icon name="check" /> {t('placeOrders')} · {cart.groups.length} distributor{cart.groups.length > 1 ? 's' : ''}
        </button>
        <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
          Each distributor gets its own order, straight into their billing software.
        </p>
      </section>
    </main>
  );
}
