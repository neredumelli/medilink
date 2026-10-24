'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STATUS_LABEL_EN } from '@medilink/core';
import { api, ApiError, peek } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ago, inr0 } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { StatusTracker } from '@/components/shop/StatusTracker';
import { useShop } from '@/components/shop/ShopContext';

interface Order {
  id: string;
  number: string;
  status: keyof typeof STATUS_LABEL_EN;
  distributor: { name: string; deliveryLabel: string };
  createdAt: string;
  totalPaise: number;
  invoiceNo: string | null;
  partial: boolean;
  rejectReason: string | null;
  items: { name: string; qty: number; billedQty: number | null }[];
}

const PILL: Record<string, string> = { PLACED: 'c-coral', ACCEPTED: 'c-sky', BILLED: 'c-violet', DISPATCHED: 'c-sun', DELIVERED: 'c-green', REJECTED: 'c-coral', CANCELLED: '' };

export default function OrdersPage() {
  const { t, toast } = useSession();
  const { refresh } = useShop();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(() => peek<Order[]>('/shop/orders') ?? null);
  const [just, setJust] = useState<{ orders: { distributorName: string }[]; totalPaise: number; timeToPlaceSec: number | null } | null>(null);

  const load = useCallback(async () => setOrders(await api<Order[]>('/shop/orders')), []);
  useEffect(() => {
    load().catch(() => {});
    try {
      const raw = sessionStorage.getItem('ml.justPlaced');
      if (raw) {
        setJust(JSON.parse(raw));
        sessionStorage.removeItem('ml.justPlaced');
      }
    } catch {}
  }, [load]);

  async function act(path: string, then: 'cart' | 'reload', done: string) {
    try {
      const r = await api<any>(path, { body: {} });
      await refresh();
      if (then === 'cart') {
        toast(r.added ? done : 'No other distributor has stock right now');
        if (r.added) router.push('/shop/cart');
      } else {
        toast(done);
        await load();
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  }

  return (
    <main className="r-main">
      {just && (
        <div className="success">
          <span className="ck">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
          <div>
            <h2>{t('ordersSent')}</h2>
            <div>
              {just.orders.map((o) => o.distributorName).join(' and ')} · {inr0(just.totalPaise)}
              {just.timeToPlaceSec ? `. Placed in ${just.timeToPlaceSec} seconds.` : ''}
            </div>
          </div>
        </div>
      )}
      {!orders ? (
        <div className="skeleton" />
      ) : orders.length === 0 ? (
        <p className="empty">No orders yet.</p>
      ) : (
        orders.map((o) => {
          const short = o.items.filter((i) => i.billedQty !== null && i.billedQty < i.qty);
          const open = !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(o.status);
          return (
            <section className="card" key={o.id}>
              <div className="row-b">
                <div>
                  <b style={{ fontSize: '1.08em' }}>{o.distributor.name}</b>
                  <div className="hint">
                    <span className="mono">{o.number}</span> · {ago(o.createdAt)} · {o.items.length} items · {inr0(o.totalPaise)}
                  </div>
                </div>
                <span className={`pill ${PILL[o.status]}`}>
                  {STATUS_LABEL_EN[o.status]}
                  {o.partial ? ' · part' : ''}
                </span>
              </div>
              {o.status === 'REJECTED' || o.status === 'CANCELLED' ? (
                <div className="note c-coral">
                  {STATUS_LABEL_EN[o.status]}
                  {o.rejectReason ? `: ${o.rejectReason}` : ''}. Your credit has been released.
                </div>
              ) : (
                <StatusTracker status={o.status} />
              )}
              {open && (
                <div className="hint">
                  <Icon name="truck" /> Expected {o.distributor.deliveryLabel.toLowerCase()}
                  {o.invoiceNo && (
                    <>
                      {' '}
                      · Bill <span className="mono">{o.invoiceNo}</span>
                    </>
                  )}
                </div>
              )}
              {short.length > 0 && o.status !== 'REJECTED' && (
                <div className="note c-sun">
                  <span>
                    <b>{t('cameShort')}:</b> {short.map((i) => `${i.name} ${i.billedQty} of ${i.qty}`).join(', ')}
                  </span>
                  <button className="btn sun small" onClick={() => act(`/shop/orders/${o.id}/get-rest`, 'cart', 'Remaining quantity added from another distributor')}>
                    {t('getRest')}
                  </button>
                </div>
              )}
              <div className="actions">
                {o.status === 'PLACED' && (
                  <button className="btn small" onClick={() => act(`/shop/orders/${o.id}/cancel`, 'reload', 'Order cancelled')}>
                    Cancel order
                  </button>
                )}
                {o.status === 'DISPATCHED' && (
                  <button className="btn small primary" onClick={() => act(`/shop/orders/${o.id}/received`, 'reload', 'Marked as received')}>
                    <Icon name="check" /> Goods received
                  </button>
                )}
                {o.status === 'DELIVERED' && (
                  <button className="btn small" onClick={() => act(`/shop/orders/${o.id}/reorder`, 'cart', 'Items added at best price')}>
                    <Icon name="redo" /> Order again
                  </button>
                )}
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
