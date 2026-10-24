'use client';

import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABEL_EN } from '@medilink/core';
import { api, ApiError, peek } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ago, inr0 } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';

interface LaneOrder {
  id: string;
  number: string;
  status: string;
  source: string;
  createdAt: string;
  totalPaise: number;
  invoiceNo: string | null;
  partial: boolean;
  erpRef: string | null;
  shop: { name: string; area: string };
  items: { id: string; name: string; schedule: string; qty: number; freeQty: number; billedQty: number | null; inStock: number; short: boolean }[];
}
interface Lane {
  key: string;
  title: string;
  status: string;
  orders: LaneOrder[];
}
interface Dash {
  distributor: { name: string; area: string; billingSoftware: string };
  newOrders: number;
  todayValuePaise: number;
  todayOrders: number;
  fillRatePct: number;
  pendingLinks: number;
  sync: { status: 'online' | 'offline' | 'not_set_up'; minutesSinceBeat: number | null };
}
interface ShopLink {
  linkId: string;
  status: string;
  partyCode: string | null;
  creditLimitPaise: number;
  duesPaise: number;
  shop: { name: string; area: string; gstin: string | null; kycStatus: string };
}

const LANE_COLOR: Record<string, string> = { new: 'c-coral', toBill: 'c-sky', toDispatch: 'c-violet', onTheWay: 'c-sun' };
const SRC: Record<string, [string, string]> = { WHATSAPP: ['WhatsApp', 'c-green'], SALES_REP: ['Sales rep', 'c-violet'], CALL_CENTER: ['Call center', 'c-sky'], APP: ['Shop app', ''], WEB: ['Shop web', ''], UPLOAD: ['Upload', ''] };
const SOFTWARE: Record<string, string> = { MARG: 'Marg ERP', TALLY: 'Tally', BUSY: 'Busy', GOFRUGAL: 'GoFrugal', CSV: 'CSV export', API: 'API' };
const REASONS = ['Credit limit exceeded', 'Items out of stock', 'Old dues pending', 'We do not deliver to this area'];

export default function DistributorPage() {
  const { toast } = useSession();
  const [dash, setDash] = useState<Dash | null>(() => peek<Dash>('/distributor/dashboard') ?? null);
  const [lanes, setLanes] = useState<Lane[] | null>(() => peek<Lane[]>('/distributor/lanes') ?? null);
  const [shops, setShops] = useState<ShopLink[]>(() => peek<ShopLink[]>('/distributor/shops') ?? []);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState(REASONS[0]!);

  const load = useCallback(async () => {
    const [d, l, s] = await Promise.all([api<Dash>('/distributor/dashboard'), api<Lane[]>('/distributor/lanes'), api<ShopLink[]>('/distributor/shops')]);
    setDash(d);
    setLanes(l);
    setShops(s);
  }, []);
  useEffect(() => {
    load().catch(() => {});
    const id = window.setInterval(() => load().catch(() => {}), 30_000); // new orders appear without refreshing
    return () => window.clearInterval(id);
  }, [load]);

  async function act(path: string, body: unknown, done: string) {
    try {
      await api(path, { body });
      toast(done);
      setRejecting(null);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  }

  const sw = dash ? SOFTWARE[dash.distributor.billingSoftware] ?? dash.distributor.billingSoftware : '';
  const pending = shops.filter((s) => s.status === 'PENDING');

  return (
    <ConsoleShell allow={(r) => r.startsWith('DISTRIBUTOR')} eyebrow="Distributor console" title={dash?.distributor.name ?? '…'} subtitle={dash ? `${dash.distributor.area} · ${sw}` : undefined}>
      {dash && (
        <div className="kpis">
          <div className="kpi c-coral">
            <span className="ki">
              <Icon name="inbox" />
            </span>
            <div>
              <b>{dash.newOrders}</b>
              <small>New orders waiting</small>
            </div>
          </div>
          <div className="kpi c-green">
            <span className="ki">
              <Icon name="rupee" />
            </span>
            <div>
              <b>{inr0(dash.todayValuePaise)}</b>
              <small>{dash.todayOrders} orders today</small>
            </div>
          </div>
          <div className="kpi c-sky">
            <span className="ki">
              <Icon name="gauge" />
            </span>
            <div>
              <b>{dash.fillRatePct}%</b>
              <small>Fill rate, last 30 days</small>
            </div>
          </div>
          <div className={`kpi ${dash.sync.status === 'online' ? 'c-violet' : 'c-coral'}`}>
            <span className="ki">
              <Icon name="sync" />
            </span>
            <div>
              <b style={{ fontSize: 19 }}>{dash.sync.status === 'online' ? 'Synced' : dash.sync.status === 'offline' ? 'Offline' : 'Not set up'}</b>
              <small>{dash.sync.minutesSinceBeat !== null ? `Last seen ${dash.sync.minutesSinceBeat} min ago` : `Connect ${sw}`}</small>
            </div>
          </div>
        </div>
      )}
      {dash?.sync.status === 'offline' && (
        <div className="alertband">
          <Icon name="sync" /> Your billing PC is not syncing. Shops are seeing old stock. Open the MediLink agent on that PC.
        </div>
      )}

      {pending.map((s) => (
        <LinkRequest key={s.linkId} s={s} sw={sw} onDone={load} />
      ))}

      <div className="lanes">
        {lanes?.map((lane) => (
          <section key={lane.key} className={`lane ${LANE_COLOR[lane.key]}`}>
            <div className="lane-h">
              <h2>
                <span className="dot" />
                {lane.title}
              </h2>
              {lane.orders.length > 0 && <span className="n">{lane.orders.length}</span>}
            </div>
            {lane.key === 'new' && lane.orders.length > 1 && (
              <button className="btn primary small" onClick={() => act('/distributor/orders/accept-all', {}, `${lane.orders.length} orders accepted`)}>
                <Icon name="check" /> Accept all {lane.orders.length}
              </button>
            )}
            {lane.orders.length === 0 && <div className="lane-empty">{lane.key === 'new' ? 'All caught up' : 'Nothing here'}</div>}
            {lane.orders.map((o) => {
              const shortN = o.items.filter((i) => i.short && i.billedQty === null).length;
              const [srcLabel, srcCls] = SRC[o.source] ?? [o.source, ''];
              return (
                <article key={o.id} className={`ocard ${LANE_COLOR[lane.key]}`}>
                  <div className="o-top">
                    <div style={{ minWidth: 0 }}>
                      <b>{o.shop.name}</b>
                      <div className="hint">
                        {o.shop.area} · {ago(o.createdAt)}
                      </div>
                    </div>
                    <span className="o-val">{inr0(o.totalPaise)}</span>
                  </div>
                  <div className="chips">
                    <span className="pill mono">{o.number}</span>
                    <span className={`pill ${srcCls}`}>{srcLabel}</span>
                    {o.partial && <span className="pill c-sun">Part supply</span>}
                  </div>
                  <div className="items">
                    {o.items.map((i) => (
                      <div key={i.id} className={i.short ? 'short' : ''}>
                        <span>
                          {i.name}
                          {i.schedule !== 'NONE' && <span className="sched"> {i.schedule}</span>}
                        </span>
                        <span>
                          {i.billedQty !== null && i.billedQty < i.qty ? `${i.billedQty} of ${i.qty}` : i.qty}
                          {i.freeQty ? ` +${i.freeQty}` : ''}
                          {i.short && i.billedQty === null ? ` · ${i.inStock} in stock` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  {shortN > 0 && lane.key !== 'onTheWay' && (
                    <div className="note c-sun" style={{ fontSize: 12.5 }}>
                      {shortN} item{shortN > 1 ? 's' : ''} short. We will bill what you have and tell the shop.
                    </div>
                  )}
                  {lane.key === 'new' &&
                    (rejecting === o.id ? (
                      <>
                        <div className="field">
                          <label htmlFor={`rr-${o.id}`}>Reason for the shop</label>
                          <select id={`rr-${o.id}`} value={reason} onChange={(e) => setReason(e.target.value)}>
                            {REASONS.map((r) => (
                              <option key={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                        <div className="actions">
                          <button className="btn danger small" onClick={() => act(`/distributor/orders/${o.id}/reject`, { reason }, `${o.number} rejected`)}>
                            Reject order
                          </button>
                          <button className="linkbtn" onClick={() => setRejecting(null)}>
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="actions">
                        <button className="btn primary small" style={{ flex: 1 }} onClick={() => act(`/distributor/orders/${o.id}/accept`, {}, `Accepted ${o.number}. The shop has been told.`)}>
                          <Icon name="check" /> Accept
                        </button>
                        <button className="btn small" onClick={() => setRejecting(o.id)}>
                          Reject
                        </button>
                      </div>
                    ))}
                  {lane.key === 'toBill' && (
                    <button className="btn primary small wide" onClick={() => act(`/distributor/orders/${o.id}/bill`, {}, 'Bill created')}>
                      Create bill
                    </button>
                  )}
                  {lane.key === 'toDispatch' && (
                    <button className="btn small wide" onClick={() => act(`/distributor/orders/${o.id}/dispatch`, {}, 'Sent for delivery')}>
                      <Icon name="truck" /> Send for delivery
                    </button>
                  )}
                  {lane.key === 'onTheWay' && (
                    <button className="btn small wide" onClick={() => act(`/distributor/orders/${o.id}/deliver`, {}, 'Marked delivered')}>
                      <Icon name="store" /> Mark delivered
                    </button>
                  )}
                  {o.invoiceNo && <div className="erp">Bill {o.invoiceNo}</div>}
                </article>
              );
            })}
          </section>
        ))}
      </div>

      <section className="panel">
        <h2>Your shops</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Shop</th>
                <th>Party code</th>
                <th className="r">Dues / limit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shops
                .filter((s) => s.status !== 'PENDING')
                .map((s) => (
                  <tr key={s.linkId}>
                    <td>
                      <b>{s.shop.name}</b>
                      <div className="hint">{s.shop.area}</div>
                    </td>
                    <td className="mono">{s.partyCode ?? '—'}</td>
                    <td className="r">
                      {inr0(s.duesPaise)} / {inr0(s.creditLimitPaise)}
                    </td>
                    <td>
                      <span className={`pill ${s.status === 'LINKED' ? 'c-green' : 'c-coral'}`}>{s.status === 'LINKED' ? 'Linked' : 'Declined'}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="hint">Order status names: {Object.values(STATUS_LABEL_EN).join(' · ')}</p>
    </ConsoleShell>
  );
}

function LinkRequest({ s, sw, onDone }: { s: ShopLink; sw: string; onDone: () => Promise<void> }) {
  const { toast } = useSession();
  const [code, setCode] = useState('');
  const [limit, setLimit] = useState('75000');
  async function decide(approve: boolean) {
    try {
      if (approve) {
        if (!code.trim()) return toast(`Enter the shop's party code from ${sw}`);
        await api(`/distributor/links/${s.linkId}/approve`, { body: { partyCode: code.trim(), creditLimitPaise: Math.round(Number(limit.replace(/\D/g, '')) * 100), creditDays: 30 } });
        toast('Approved. Your prices now show in their app.');
      } else {
        await api(`/distributor/links/${s.linkId}/decline`, { body: {} });
        toast('Declined');
      }
      await onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
    }
  }
  return (
    <section className="panel" style={{ border: '2px solid var(--sun)' }}>
      <div className="row-b">
        <h2>New shop wants to order from you</h2>
        {s.shop.kycStatus === 'APPROVED' && (
          <span className="pill c-green">
            <Icon name="shield" /> KYC verified
          </span>
        )}
      </div>
      <div>
        <b>{s.shop.name}</b>
        <div className="hint">
          {s.shop.area} · GSTIN <span className="mono">{s.shop.gstin ?? '—'}</span>
        </div>
      </div>
      <div className="frow">
        <div className="field">
          <label htmlFor={`pc-${s.linkId}`}>Party code in {sw}</label>
          <input id={`pc-${s.linkId}`} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`cl-${s.linkId}`}>Credit limit (₹)</label>
          <input id={`cl-${s.linkId}`} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => decide(true)}>
            <Icon name="check" /> Approve
          </button>
          <button className="btn" onClick={() => decide(false)}>
            Decline
          </button>
        </div>
      </div>
    </section>
  );
}
