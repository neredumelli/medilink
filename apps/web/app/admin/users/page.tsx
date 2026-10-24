'use client';

import { useCallback, useEffect, useState } from 'react';
import { assignableRoles, ROLE_LABEL, RoleName, ROLES } from '@medilink/core';
import { api, ApiError, peek, prefetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ago } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AdminTabs } from '@/components/AdminTabs';

interface UserRow {
  id: string;
  userCode: string;
  name: string;
  mobile: string;
  role: RoleName;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  business: { type: 'shop' | 'distributor'; name: string; area: string } | null;
  lastActiveAt: string | null;
  activeDevices: number;
}
interface Detail {
  user: { id: string; userCode: string; name: string; mobile: string; role: RoleName; status: string; lang: string; createdAt: string; termsAcceptedAt: string | null; twoFactorOn: boolean };
  business: { type: 'shop' | 'distributor'; name: string; area: string; kycStatus: string } | null;
  canDo: string[];
  devices: { id: string; deviceName: string | null; createdAt: string }[];
  activity: { id: string; actorLabel: string; action: string; createdAt: string; after: any }[];
}

const STATUS_PILL: Record<string, string> = { ACTIVE: 'c-green', PENDING: 'c-sun', SUSPENDED: 'c-coral' };
const ACTION_LABEL: Record<string, string> = {
  'auth.login': 'Logged in',
  'auth.login_blocked': 'Login blocked (suspended)',
  'auth.otp_wrong': 'Entered a wrong OTP',
  'user.suspend': 'Suspended',
  'user.activate': 'Re-activated',
  'user.logout_all': 'Logged out of all devices',
  'user.role': 'Role changed',
  'order.place': 'Placed an order',
  'order.accepted': 'Accepted an order',
  'order.rejected': 'Rejected an order',
  'order.billed': 'Billed an order',
  'order.dispatched': 'Sent an order for delivery',
  'order.delivered': 'Marked an order delivered',
  'order.cancelled': 'Cancelled an order',
  'link.request': 'Asked to link with a distributor',
  'link.approve': 'Approved a shop link',
  'link.decline': 'Declined a shop link',
  'shop.register': 'Registered the shop',
};

export default function UsersPage() {
  const { me, toast } = useSession();
  const [rows, setRows] = useState<UserRow[] | null>(() => peek<UserRow[]>('/admin/users?') ?? null);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<Detail | null>(null);
  const [reason, setReason] = useState('');
  const canManage = me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN_OPS';

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (role) p.set('role', role);
    if (status) p.set('status', status);
    setRows(await api<UserRow[]>(`/admin/users?${p}`));
  }, [q, role, status]);
  useEffect(() => {
    const t = window.setTimeout(() => load().catch(() => {}), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  const open = async (id: string) => {
    setReason('');
    const seen = peek<Detail>(`/admin/users/${id}`);
    if (seen) setSel(seen);
    setSel(await api<Detail>(`/admin/users/${id}`));
  };

  async function act(path: string, body: unknown, done: string) {
    if (!sel) return;
    try {
      await api(path, { body });
      toast(done);
      await Promise.all([load(), open(sel.user.id)]);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
    }
  }

  const counts = rows ? { all: rows.length, active: rows.filter((r) => r.status === 'ACTIVE').length, suspended: rows.filter((r) => r.status === 'SUSPENDED').length, online: rows.filter((r) => r.activeDevices > 0).length } : null;

  return (
    <ConsoleShell allow={(r) => ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'].includes(r)} eyebrow="Super admin" title="Users & access" subtitle="Who can log in, what they can do, and what they did" right={<AdminTabs />}>
      {counts && (
        <div className="kpis">
          <div className="kpi c-sky">
            <span className="ki">
              <Icon name="user" />
            </span>
            <div>
              <b>{counts.all}</b>
              <small>Users shown</small>
            </div>
          </div>
          <div className="kpi c-green">
            <span className="ki">
              <Icon name="check" />
            </span>
            <div>
              <b>{counts.active}</b>
              <small>Active</small>
            </div>
          </div>
          <div className="kpi c-violet">
            <span className="ki">
              <Icon name="phone" />
            </span>
            <div>
              <b>{counts.online}</b>
              <small>Logged in on a device</small>
            </div>
          </div>
          <div className="kpi c-coral">
            <span className="ki">
              <Icon name="shield" />
            </span>
            <div>
              <b>{counts.suspended}</b>
              <small>Suspended</small>
            </div>
          </div>
        </div>
      )}

      <div className="cols">
        <section className="panel">
          <div className="frow">
            <div className="field" style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="uq">Search</label>
              <input id="uq" placeholder="Name, mobile, ID or business" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ur">Role</label>
              <select id="ur" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="us">Status</label>
              <select id="us" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any</option>
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Business</th>
                  <th>Last active</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((u) => (
                  <tr key={u.id} onClick={() => open(u.id)} onMouseEnter={() => prefetch([`/admin/users/${u.id}`])} className={`click${sel?.user.id === u.id ? ' sel' : ''}`}>
                    <td>
                      <button className="linkbtn" style={{ padding: 0, textDecoration: 'none', color: 'var(--ink)', fontWeight: 800, fontSize: 14, textAlign: 'left' }} onClick={() => open(u.id)}>
                        {u.name}
                      </button>
                      <div className="hint">
                        +91 {u.mobile} · <span className="mono">{u.userCode}</span>
                      </div>
                    </td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{u.business ? `${u.business.name}, ${u.business.area}` : 'MediLink team'}</td>
                    <td>
                      {u.lastActiveAt ? ago(u.lastActiveAt) : 'Never'}
                      {u.activeDevices > 0 && <div className="hint">{u.activeDevices} device(s)</div>}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_PILL[u.status]}`}>{u.status.toLowerCase()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows && rows.length === 0 && <p className="hint">No users match.</p>}
          </div>
        </section>

        <section className="panel" style={{ position: 'sticky', top: 70 }}>
          {!sel ? (
            <p className="hint">Pick a user to see what they can do, their devices and their recent activity.</p>
          ) : (
            <>
              <div className="row-b">
                <div>
                  <h2>{sel.user.name}</h2>
                  <div className="hint">
                    +91 {sel.user.mobile} · <span className="mono">{sel.user.userCode}</span> · joined {ago(sel.user.createdAt)}
                  </div>
                </div>
                <span className={`pill ${STATUS_PILL[sel.user.status]}`}>{sel.user.status.toLowerCase()}</span>
              </div>
              <div className="box">
                <b>{ROLE_LABEL[sel.user.role]}</b>
                {sel.business && (
                  <div className="hint">
                    {sel.business.type === 'shop' ? 'Shop' : 'Distributor'}: {sel.business.name}, {sel.business.area} · KYC {sel.business.kycStatus.toLowerCase().replace('_', ' ')}
                  </div>
                )}
                <div className="docs">
                  {sel.canDo.map((c) => (
                    <span key={c} className={`pill ${c.startsWith('Cannot') ? 'c-coral' : 'c-green'}`}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <b>Logged in on</b>
                {sel.devices.length === 0 ? (
                  <p className="hint" style={{ margin: '4px 0 0' }}>
                    No active devices.
                  </p>
                ) : (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                    {sel.devices.map((d) => (
                      <li key={d.id}>
                        {d.deviceName ?? 'Unknown device'} <span className="hint">· since {ago(d.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {canManage && sel.user.id !== me?.id && (
                <div className="box">
                  <b>Manage access</b>
                  <div className="field">
                    <label htmlFor="reason">Reason (saved in the activity log)</label>
                    <input id="reason" value={reason} placeholder="e.g. Left the shop" onChange={(e) => setReason(e.target.value)} />
                  </div>
                  <div className="actions">
                    {sel.user.status === 'SUSPENDED' ? (
                      <button className="btn primary small" onClick={() => act(`/admin/users/${sel.user.id}/status`, { status: 'ACTIVE', reason: reason || 'Re-activated by admin' }, `${sel.user.name} can log in again`)}>
                        Re-activate
                      </button>
                    ) : (
                      <button className="btn danger small" disabled={reason.trim().length < 3} onClick={() => act(`/admin/users/${sel.user.id}/status`, { status: 'SUSPENDED', reason }, `${sel.user.name} is suspended and logged out`)}>
                        Suspend
                      </button>
                    )}
                    <button className="btn small" disabled={sel.devices.length === 0} onClick={() => act(`/admin/users/${sel.user.id}/logout-all`, {}, 'Logged out of all devices')}>
                      Log out everywhere
                    </button>
                  </div>
                  {me?.role === 'SUPER_ADMIN' && sel.user.twoFactorOn && (
                    <div className="actions">
                      <span className="pill c-green">2-step login on</span>
                      <button className="btn small" onClick={() => act(`/admin/users/${sel.user.id}/reset-2fa`, {}, `${sel.user.name} will set up 2-step login again at next login`)}>
                        Reset 2-step login (lost phone)
                      </button>
                    </div>
                  )}
                  {me?.role === 'SUPER_ADMIN' && (
                    <div className="field">
                      <label htmlFor="role">Change role</label>
                      <select id="role" value={sel.user.role} onChange={(e) => act(`/admin/users/${sel.user.id}/role`, { role: e.target.value }, 'Role changed. It applies straight away.')}>
                        {assignableRoles(sel.business?.type ?? null).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="hint" style={{ margin: 0 }}>
                    Suspending logs the user out at once on every device they use the app on.
                  </p>
                </div>
              )}

              <div>
                <b>Recent activity</b>
                <div className="audit" style={{ marginTop: 6 }}>
                  {sel.activity.length === 0 && <p className="hint">Nothing yet.</p>}
                  {sel.activity.map((a) => (
                    <div key={a.id}>
                      <time>{ago(a.createdAt).replace(' ago', '')}</time>
                      <span>
                        {ACTION_LABEL[a.action] ?? a.action}
                        {a.actorLabel !== sel.user.name ? <span className="hint"> · by {a.actorLabel}</span> : null}
                        {a.after?.reason ? <span className="hint"> · “{a.after.reason}”</span> : null}
                        {a.after?.device ? <span className="hint"> · {a.after.device}</span> : null}
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
