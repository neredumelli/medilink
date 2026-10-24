'use client';

import { useCallback, useEffect, useState } from 'react';
import { PRODUCT_STATUS_LABEL, ProductStatus } from '@medilink/core';
import { api, ApiError, peek, prefetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ago, inr } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AdminTabs } from '@/components/AdminTabs';
import { ProductTile } from '@/components/shop/ProductCard';
import { FieldDef, FieldInput } from '@/components/admin/FieldInput';

interface Row {
  id: string;
  name: string;
  pack: string;
  company: string;
  salt: string;
  category: string;
  status: ProductStatus;
  controlled: boolean;
  aliases: number;
  barcodes: number;
  distributors: number;
}
interface HistoryRow {
  id: string;
  table: string;
  op: string;
  changes: Record<string, [unknown, unknown]>;
  actor: string;
  at: string;
}
interface Detail {
  product: { id: string; name: string; form: string; pack: string; salt: string; company: string; hsn: string | null; gstPct: number; schedule: string; ndps: boolean; controlled: boolean; category: string; mrpPaise: number; status: ProductStatus; statusNote: string | null; statusAt: string | null; extra: Record<string, unknown> };
  aliases: { id: string; alias: string }[];
  barcodes: string[];
  stock: { distributor: string; externalCode: string; stockQty: number; ptrPaise: number; nearestExpiry: string | null; batches: { batchNo: string; expiry: string; stockQty: number }[] }[];
  openOrders: number;
  fields: FieldDef[];
  history: HistoryRow[];
}

const STATUS_PILL: Record<ProductStatus, string> = { ACTIVE: 'c-green', DISCONTINUED: 'c-sky', BANNED: 'c-coral', RECALLED: 'c-coral' };
const FIELD_NAME: Record<string, string> = {
  status: 'Status',
  statusNote: 'Note to shops',
  statusAt: 'Status date',
  extra: 'Extra details',
  mrpPaise: 'MRP',
  ptrPaise: 'PTR',
  discountPct: 'Discount %',
  schemeBuy: 'Scheme (buy)',
  schemeFree: 'Scheme (free)',
  productId: 'Linked medicine',
  name: 'Name',
  salt: 'Salt',
  company: 'Company',
  pack: 'Pack',
  gstPct: 'GST %',
  category: 'Category',
  schedule: 'Schedule',
  ndps: 'Narcotic (NDPS)',
};
const money = new Set(['mrpPaise', 'ptrPaise']);
const show = (k: string, v: unknown) => (v === null || v === undefined ? '—' : money.has(k) && typeof v === 'number' ? inr(v) : typeof v === 'object' ? Object.entries(v as object).map(([a, b]) => `${a}: ${b}`).join(', ') || '—' : String(v));

/** Turns a database history row into one plain sentence. */
function describe(h: HistoryRow): string {
  const c = h.changes;
  const val = (k: string) => (h.op === 'DELETE' ? c[k]?.[0] : c[k]?.[1]);
  if (h.table === 'ProductAlias') return `${h.op === 'INSERT' ? 'Added' : 'Removed'} other name “${val('alias')}”`;
  if (h.table === 'ProductBarcode') return `${h.op === 'INSERT' ? 'Added' : 'Removed'} barcode ${val('code')}`;
  if (h.op === 'INSERT') return 'Medicine created';
  const parts = Object.entries(c).map(([k, [a, b]]) => `${FIELD_NAME[k] ?? k}: ${show(k, a)} → ${show(k, b)}`);
  return (h.table === 'DistributorItem' ? 'Distributor price · ' : '') + parts.join(' · ');
}

export default function ProductsPage() {
  const { me, toast } = useSession();
  const canEdit = me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN_OPS';
  const [rows, setRows] = useState<Row[] | null>(() => peek<Row[]>('/admin/products?') ?? null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<Detail | null>(null);
  const [newStatus, setNewStatus] = useState<ProductStatus>('ACTIVE');
  const [note, setNote] = useState('');
  const [schedule, setSchedule] = useState('NONE');
  const [ndps, setNdps] = useState(false);
  const [alias, setAlias] = useState('');
  const [code, setCode] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    setRows(await api<Row[]>(`/admin/products?${p}`));
  }, [q, status]);
  useEffect(() => {
    const t = window.setTimeout(() => load().catch(() => {}), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const showDetail = (d: Detail) => {
    setSel(d);
    setNewStatus(d.product.status);
    setNote(d.product.statusNote ?? '');
    setSchedule(d.product.schedule);
    setNdps(d.product.ndps);
    setExtra(Object.fromEntries(Object.entries(d.product.extra ?? {}).map(([k, v]) => [k, String(v)])));
  };
  const open = async (id: string) => {
    const seen = peek<Detail>(`/admin/products/${id}`);
    if (seen) showDetail(seen);
    showDetail(await api<Detail>(`/admin/products/${id}`));
  };

  async function run(fn: () => Promise<unknown>, done: string) {
    if (!sel) return;
    try {
      await fn();
      toast(done);
      await Promise.all([load(), open(sel.product.id)]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
    }
  }

  const id = sel?.product.id;
  const blocking = newStatus === 'BANNED' || newStatus === 'RECALLED';
  const fields = sel?.fields.filter((f) => f.active) ?? [];
  const counts = rows ? { all: rows.length, blocked: rows.filter((r) => r.status === 'BANNED' || r.status === 'RECALLED').length, disc: rows.filter((r) => r.status === 'DISCONTINUED').length, noCode: rows.filter((r) => r.barcodes === 0).length } : null;

  return (
    <ConsoleShell allow={(r) => ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'].includes(r)} eyebrow="Super admin" title="Medicines" subtitle="Status, other names, barcodes, extra details and full change history" right={<AdminTabs />}>
      {counts && (
        <div className="kpis">
          <div className="kpi c-green">
            <span className="ki">
              <Icon name="box" />
            </span>
            <div>
              <b>{counts.all}</b>
              <small>Medicines shown</small>
            </div>
          </div>
          <div className="kpi c-coral">
            <span className="ki">
              <Icon name="shield" />
            </span>
            <div>
              <b>{counts.blocked}</b>
              <small>Banned or recalled</small>
            </div>
          </div>
          <div className="kpi c-sky">
            <span className="ki">
              <Icon name="x" />
            </span>
            <div>
              <b>{counts.disc}</b>
              <small>Discontinued</small>
            </div>
          </div>
          <div className="kpi c-violet">
            <span className="ki">
              <Icon name="scan" />
            </span>
            <div>
              <b>{counts.noCode}</b>
              <small>Without a barcode</small>
            </div>
          </div>
        </div>
      )}

      <div className="cols">
        <section className="panel">
          <div className="frow">
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="pq">Search</label>
              <input id="pq" placeholder="Name, salt, company, other name or barcode" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ps">Status</label>
              <select id="ps" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any</option>
                {(Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {PRODUCT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Other names</th>
                  <th>Barcodes</th>
                  <th>Distributors</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} onClick={() => open(r.id)} onMouseEnter={() => prefetch([`/admin/products/${r.id}`])} className={`click${id === r.id ? ' sel' : ''}`}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <ProductTile name={r.name} category={r.category} small />
                        <div>
                          <button className="linkbtn" style={{ padding: 0, textDecoration: 'none', color: 'var(--ink)', fontWeight: 800, fontSize: 14, textAlign: 'left' }} onClick={() => open(r.id)}>
                            {r.name} <span className="muted">{r.pack}</span>
                          </button>
                          <div className="hint">
                            {r.salt} · {r.company}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{r.aliases}</td>
                    <td>{r.barcodes}</td>
                    <td>{r.distributors}</td>
                    <td>
                      {r.controlled && <span className="pill c-coral">Sched. X / NDPS</span>}{' '}
                      <span className={`pill ${STATUS_PILL[r.status]}`}>{r.status === 'ACTIVE' ? 'active' : PRODUCT_STATUS_LABEL[r.status].split(' ')[0]!.toLowerCase()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows && rows.length === 0 && <p className="hint">No medicines match.</p>}
          </div>
        </section>

        <section className="panel" style={{ position: 'sticky', top: 70, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto' }}>
          {!sel ? (
            <p className="hint">Pick a medicine to change its status, add the names shops use, add barcodes, fill extra details or see every change.</p>
          ) : (
            <>
              <div className="row-b">
                <div>
                  <h2>
                    {sel.product.name} <span className="muted">{sel.product.form} {sel.product.pack}</span>
                  </h2>
                  <div className="hint">
                    {sel.product.salt} · {sel.product.company} · MRP {inr(sel.product.mrpPaise)} · GST {sel.product.gstPct}%
                  </div>
                </div>
                <span className={`pill ${STATUS_PILL[sel.product.status]}`}>{PRODUCT_STATUS_LABEL[sel.product.status]}</span>
              </div>

              {/* ---------------- status */}
              <div className="box" style={{ border: sel.product.status !== 'ACTIVE' ? '2px solid var(--coral)' : undefined }}>
                <b>Can shops order it?</b>
                {sel.product.status !== 'ACTIVE' && (
                  <p className="hint" style={{ margin: 0 }}>
                    Blocked since {ago(sel.product.statusAt!)}. Shops see: “{sel.product.statusNote}”
                  </p>
                )}
                <div className="frow">
                  <div className="field">
                    <label htmlFor="pst">Status</label>
                    <select id="pst" value={newStatus} disabled={!canEdit} onChange={(e) => setNewStatus(e.target.value as ProductStatus)}>
                      {(Object.keys(PRODUCT_STATUS_LABEL) as ProductStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {s === 'ACTIVE' ? 'Active: can be ordered' : PRODUCT_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {newStatus !== 'ACTIVE' && (
                    <div className="field" style={{ flex: 1, minWidth: 200 }}>
                      <label htmlFor="pnote">Note shops will read</label>
                      <input id="pnote" value={note} maxLength={300} placeholder="e.g. CDSCO notice 12 Oct 2026, batches AB12–AB19" disabled={!canEdit} onChange={(e) => setNote(e.target.value)} />
                    </div>
                  )}
                </div>
                {blocking && newStatus !== sel.product.status && (
                  <p className="hint" style={{ margin: 0, color: 'var(--bad)' }}>
                    Shops will not be able to add or order it. {sel.openOrders > 0 ? `${sel.openOrders} open order(s) contain it; their distributors will be alerted.` : 'No open orders contain it.'}
                  </p>
                )}
                {canEdit && (
                  <div className="actions">
                    <button
                      className={`btn small ${blocking ? 'danger' : 'primary'}`}
                      disabled={newStatus === sel.product.status && (note ?? '') === (sel.product.statusNote ?? '')}
                      onClick={() => run(() => api(`/admin/products/${id}/status`, { body: { status: newStatus, note: note || undefined } }), newStatus === 'ACTIVE' ? `${sel.product.name} can be ordered again` : `${sel.product.name}: ${PRODUCT_STATUS_LABEL[newStatus].toLowerCase()}`)}
                    >
                      Save status
                    </button>
                  </div>
                )}
              </div>

              {/* ---------------- schedule and narcotic flag */}
              <div className="box" style={{ border: sel.product.controlled ? '2px solid var(--coral)' : undefined }}>
                <b>Drug schedule</b>
                <p className="hint" style={{ margin: 0 }}>
                  {sel.product.controlled
                    ? 'Never orderable on MediLink: Schedule X and narcotic (NDPS) medicines are blocked in search, carts and orders, and by the database itself.'
                    : 'Schedule H and H1 are shown to shops. Setting Schedule X or narcotic blocks the medicine everywhere at once and removes it from every cart.'}
                </p>
                <div className="frow">
                  <div className="field">
                    <label htmlFor="psch">Schedule</label>
                    <select id="psch" value={schedule} disabled={!canEdit} onChange={(e) => setSchedule(e.target.value)}>
                      <option value="NONE">None (OTC)</option>
                      <option value="H">Schedule H</option>
                      <option value="H1">Schedule H1</option>
                      <option value="X">Schedule X: not orderable</option>
                    </select>
                  </div>
                  <label className="row" style={{ gap: 8, fontWeight: 700 }}>
                    <input type="checkbox" checked={ndps} disabled={!canEdit} onChange={(e) => setNdps(e.target.checked)} /> Narcotic / psychotropic (NDPS Act): not orderable
                  </label>
                </div>
                {canEdit && (
                  <div className="actions">
                    <button
                      className={`btn small ${schedule === 'X' || ndps ? 'danger' : 'primary'}`}
                      disabled={schedule === sel.product.schedule && ndps === sel.product.ndps}
                      onClick={() => run(() => api(`/admin/products/${id}/control`, { body: { schedule, ndps } }), schedule === 'X' || ndps ? `${sel.product.name} is blocked from ordering` : `${sel.product.name}: schedule saved`)}
                    >
                      Save schedule
                    </button>
                  </div>
                )}
              </div>

              {/* ---------------- other names */}
              <div>
                <b>Other names shops use</b>
                <p className="hint" style={{ margin: '2px 0 8px' }}>
                  Local spellings, short forms, Telugu or Hindi script. Search finds the medicine by any of them.
                </p>
                <div className="docs">
                  {sel.aliases.length === 0 && <span className="hint">None yet.</span>}
                  {sel.aliases.map((a) => (
                    <span key={a.id} className="pill c-sky">
                      {a.alias}
                      {canEdit && (
                        <button className="linkbtn" aria-label={`Remove ${a.alias}`} style={{ padding: '0 0 0 4px', minHeight: 0 }} onClick={() => run(() => api(`/admin/products/${id}/aliases/${a.id}`, { method: 'DELETE' }), `Removed “${a.alias}”`)}>
                          <Icon name="x" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {canEdit && (
                  <form
                    className="frow"
                    style={{ marginTop: 8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (alias.trim()) run(() => api(`/admin/products/${id}/aliases`, { body: { alias } }), `Added “${alias.trim()}”`).then(() => setAlias(''));
                    }}
                  >
                    <div className="field" style={{ flex: 1 }}>
                      <label htmlFor="palias" className="sr">
                        Add another name
                      </label>
                      <input id="palias" value={alias} placeholder="Add another name, e.g. డోలో" onChange={(e) => setAlias(e.target.value)} />
                    </div>
                    <button className="btn small" type="submit" disabled={!alias.trim()}>
                      Add
                    </button>
                  </form>
                )}
              </div>

              {/* ---------------- barcodes */}
              <div>
                <b>Barcodes</b>
                <p className="hint" style={{ margin: '2px 0 8px' }}>
                  A medicine can have several (pack sizes, old and new boxes). Shops scan any of them.
                </p>
                <div className="docs">
                  {sel.barcodes.length === 0 && <span className="hint">None yet.</span>}
                  {sel.barcodes.map((b) => (
                    <span key={b} className="pill c-violet mono">
                      {b}
                      {canEdit && (
                        <button className="linkbtn" aria-label={`Remove barcode ${b}`} style={{ padding: '0 0 0 4px', minHeight: 0 }} onClick={() => run(() => api(`/admin/products/${id}/barcodes/${encodeURIComponent(b)}`, { method: 'DELETE' }), `Removed barcode ${b}`)}>
                          <Icon name="x" />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
                {canEdit && (
                  <form
                    className="frow"
                    style={{ marginTop: 8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (code.trim()) run(() => api(`/admin/products/${id}/barcodes`, { body: { code: code.trim() } }), `Added barcode ${code.trim()}`).then(() => setCode(''));
                    }}
                  >
                    <div className="field" style={{ flex: 1 }}>
                      <label htmlFor="pcode" className="sr">
                        Add a barcode
                      </label>
                      <input id="pcode" className="mono" inputMode="numeric" value={code} placeholder="Add a barcode" onChange={(e) => setCode(e.target.value)} />
                    </div>
                    <button className="btn small" type="submit" disabled={!code.trim()}>
                      Add
                    </button>
                  </form>
                )}
              </div>

              {/* ---------------- custom fields */}
              <div className="box">
                <div className="row-b">
                  <b>Extra details</b>
                  <a className="hint" href="/admin/fields">
                    Manage fields
                  </a>
                </div>
                {fields.length === 0 && <p className="hint" style={{ margin: 0 }}>No extra fields for medicines yet. Add them under Data fields.</p>}
                {fields.map((f) => (
                  <div className="field" key={f.key}>
                    <label htmlFor={`x-${f.key}`}>
                      {f.label}
                      {f.required ? ' *' : ''}
                    </label>
                    <FieldInput id={`x-${f.key}`} f={f} value={extra[f.key] ?? ''} disabled={!canEdit} onChange={(v) => setExtra({ ...extra, [f.key]: v })} />
                  </div>
                ))}
                {canEdit && fields.length > 0 && (
                  <div className="actions">
                    <button className="btn small primary" onClick={() => run(() => api(`/admin/extra/product/${id}`, { method: 'PUT', body: { values: Object.fromEntries(fields.map((f) => [f.key, extra[f.key] ?? ''])) } }), 'Extra details saved')}>
                      Save details
                    </button>
                  </div>
                )}
              </div>

              {/* ---------------- stock and batches */}
              <div>
                <b>Stock at distributors</b>
                <div className="tablewrap" style={{ marginTop: 6 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Distributor</th>
                        <th>Stock</th>
                        <th>PTR</th>
                        <th>Batches (expiry)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sel.stock.map((s) => (
                        <tr key={s.externalCode}>
                          <td>
                            {s.distributor}
                            <div className="hint mono">{s.externalCode}</div>
                          </td>
                          <td>{s.stockQty}</td>
                          <td>{inr(s.ptrPaise)}</td>
                          <td>
                            {s.batches.length === 0
                              ? s.nearestExpiry
                                ? `nearest ${s.nearestExpiry.slice(0, 7)}`
                                : '—'
                              : s.batches.map((b) => (
                                  <div key={b.batchNo} className="hint">
                                    <span className="mono">{b.batchNo}</span> · {b.expiry.slice(0, 7)} · {b.stockQty}
                                  </div>
                                ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sel.stock.length === 0 && <p className="hint">No distributor stocks it yet.</p>}
                </div>
              </div>

              {/* ---------------- history */}
              <div>
                <b>
                  <Icon name="history" /> Change history
                </b>
                <p className="hint" style={{ margin: '2px 0 0' }}>
                  Written by the database itself. It cannot be edited or deleted.
                </p>
                <div className="audit" style={{ marginTop: 6 }}>
                  {sel.history.length === 0 && <p className="hint">No changes yet.</p>}
                  {sel.history.map((h) => (
                    <div key={h.id}>
                      <time>{ago(h.at).replace(' ago', '')}</time>
                      <span>
                        {describe(h)}
                        <span className="hint"> · by {h.actor}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}
