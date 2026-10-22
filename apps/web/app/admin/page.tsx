'use client';

import { useCallback, useEffect, useState } from 'react';
import { STATUS_LABEL_EN } from '@medilink/core';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ago, inr0 } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';

interface Overview {
  activeShops: number;
  liveDistributors: number;
  ordersToday: number;
  gmvTodayPaise: number;
  pendingApprovals: number;
  medianOrderSeconds: number | null;
  recentOrderSeconds: number[];
  syncOffline: { id: string; name: string }[];
  unmappedItems: number;
}
interface Kyc {
  type: 'shop' | 'distributor';
  id: string;
  name: string;
  area: string;
  status: string;
  gstin: string | null;
  gstinCheck: { ok: boolean; problem?: string };
  licences: string[];
  missing: string[];
  owner: { name: string; mobile: string } | null;
  createdAt: string;
}
interface Health {
  distributor: { id: string; name: string; billingSoftware: string };
  status: string;
  minutesSinceBeat: number | null;
}
interface OrderRow {
  id: string;
  number: string;
  status: keyof typeof STATUS_LABEL_EN;
  source: string;
  shop: string;
  distributor: string;
  totalPaise: number;
  createdAt: string;
}
interface Audit {
  id: string;
  actorLabel: string;
  action: string;
  entityId: string | null;
  createdAt: string;
}

export default function AdminPage() {
  const { toast } = useSession();
  const [ov, setOv] = useState<Overview | null>(null);
  const [kyc, setKyc] = useState<Kyc[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);

  const load = useCallback(async () => {
    const [o, k, h, or, a] = await Promise.all([
      api<Overview>('/admin/overview'),
      api<Kyc[]>('/admin/kyc'),
      api<Health[]>('/admin/sync-health'),
      api<OrderRow[]>('/admin/orders'),
      api<Audit[]>('/admin/audit'),
    ]);
    setOv(o);
    setKyc(k);
    setHealth(h);
    setOrders(or);
    setAudit(a);
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function decide(k: Kyc, decision: 'approve' | 'changes' | 'reject') {
    try {
      await api(`/admin/kyc/${k.type}/${k.id}`, { body: { decision } });
      toast(decision === 'approve' ? `${k.name} can start ordering now` : decision === 'changes' ? `${k.name} will get an SMS with what to fix` : `${k.name} rejected`);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
    }
  }

  const times = ov?.recentOrderSeconds ?? [];
  const mx = Math.max(45, ...times);

  return (
    <ConsoleShell allow={(r) => ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'].includes(r)} eyebrow="Super admin" title="Platform overview">
      {ov && (
        <div className="kpis">
          <div className="kpi c-green">
            <span className="ki">
              <Icon name="store" />
            </span>
            <div>
              <b>{ov.activeShops}</b>
              <small>Active shops</small>
            </div>
          </div>
          <div className="kpi c-sky">
            <span className="ki">
              <Icon name="truck" />
            </span>
            <div>
              <b>{ov.liveDistributors}</b>
              <small>Distributors live</small>
            </div>
          </div>
          <div className="kpi c-violet">
            <span className="ki">
              <Icon name="rupee" />
            </span>
            <div>
              <b>{inr0(ov.gmvTodayPaise)}</b>
              <small>{ov.ordersToday} orders today</small>
            </div>
          </div>
          <div className="kpi c-coral">
            <span className="ki">
              <Icon name="shield" />
            </span>
            <div>
              <b>{ov.pendingApprovals}</b>
              <small>Waiting for approval</small>
            </div>
          </div>
          <div className="kpi c-sun">
            <span className="ki">
              <Icon name="gauge" />
            </span>
            <div>
              <b>{ov.medianOrderSeconds !== null ? `${Math.round(ov.medianOrderSeconds)} s` : '—'}</b>
              <small>Median time to order</small>
            </div>
          </div>
        </div>
      )}
      {ov?.syncOffline.map((d) => (
        <div key={d.id} className="alertband">
          <Icon name="sync" /> {d.name} has not synced for over 15 minutes. Shops are seeing old stock for this distributor.
        </div>
      ))}

      <div className="cols">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <section className="panel">
            <h2>Registration approvals</h2>
            {kyc.length === 0 && <p className="hint">Nothing waiting.</p>}
            {kyc.map((k) => (
              <div className="box" key={`${k.type}-${k.id}`}>
                <div className="row-b">
                  <div>
                    <b>{k.name}</b>
                    <div className="hint">
                      {k.type === 'shop' ? 'Shop' : 'Distributor'} · {k.area} · applied {ago(k.createdAt)}
                      {k.owner ? ` · ${k.owner.name}, +91 ${k.owner.mobile}` : ''}
                    </div>
                  </div>
                  <span className={`pill ${k.status === 'PENDING' ? 'c-sun' : 'c-sky'}`}>{k.status === 'PENDING' ? 'Waiting' : 'Asked for changes'}</span>
                </div>
                <dl className="kv">
                  <dt>GSTIN</dt>
                  <dd>
                    <span className="mono">{k.gstin ?? '—'}</span> {k.gstinCheck.ok ? <span className="pill c-green">Valid</span> : <span className="pill c-coral">{k.gstin ? 'Check failed' : 'Missing'}</span>}
                  </dd>
                  <dt>Licences</dt>
                  <dd className="mono">{k.licences.join(', ') || '—'}</dd>
                </dl>
                {k.missing.length > 0 && (
                  <div className="docs">
                    {k.missing.map((m) => (
                      <span key={m} className="pill c-sun">
                        {m} missing
                      </span>
                    ))}
                  </div>
                )}
                <div className="actions">
                  <button className="btn primary small" disabled={!k.gstinCheck.ok || k.missing.length > 0} onClick={() => decide(k, 'approve')}>
                    Approve
                  </button>
                  <button className="btn small" onClick={() => decide(k, 'changes')}>
                    Ask for changes
                  </button>
                  <button className="btn danger small" onClick={() => decide(k, 'reject')}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>All orders</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Shop</th>
                    <th>Distributor</th>
                    <th>Via</th>
                    <th className="r">Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="mono">
                        {o.number}
                        <div className="hint">{ago(o.createdAt)}</div>
                      </td>
                      <td>{o.shop}</td>
                      <td>{o.distributor}</td>
                      <td>{o.source.replace('_', ' ').toLowerCase()}</td>
                      <td className="r">{inr0(o.totalPaise)}</td>
                      <td>
                        <span className="pill">{STATUS_LABEL_EN[o.status]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
          <section className="panel">
            <h2>How fast shops order</h2>
            <div className="hint">Seconds from first item added to order placed. Dashed line is the 30-second goal.</div>
            <div className="bars" role="img" aria-label="Order times in seconds">
              <span className="goal" style={{ bottom: `${(30 / mx) * 100}%` }} />
              {times.map((v, i) => (
                <i key={i} className={i === times.length - 1 ? 'last' : ''} style={{ height: `${Math.max(6, (v / mx) * 100)}%` }} title={`${v} s`} />
              ))}
            </div>
            {times.length === 0 && <p className="hint">No timed orders yet.</p>}
          </section>
          <section className="panel">
            <h2>Billing-software sync</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Distributor</th>
                    <th>Status</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((h) => (
                    <tr key={h.distributor.id}>
                      <td>
                        <b>{h.distributor.name}</b>
                        <div className="hint">{h.distributor.billingSoftware}</div>
                      </td>
                      <td>
                        <span className={`pill ${h.status === 'online' ? 'c-green' : h.status === 'offline' ? 'c-coral' : ''}`}>{h.status === 'online' ? 'Online' : h.status === 'offline' ? 'Offline' : 'Not set up'}</span>
                      </td>
                      <td>{h.minutesSinceBeat !== null ? `${h.minutesSinceBeat} min ago` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ov && ov.unmappedItems > 0 && <p className="hint">{ov.unmappedItems} distributor items are waiting to be matched to the catalogue.</p>}
          </section>
          <section className="panel">
            <h2>Activity log</h2>
            <div className="audit">
              {audit.slice(0, 15).map((a) => (
                <div key={a.id}>
                  <time>{new Date(a.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
                  <span>
                    <b>{a.actorLabel}</b> · {a.action.replace('.', ' ')} {a.entityId ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </ConsoleShell>
  );
}
