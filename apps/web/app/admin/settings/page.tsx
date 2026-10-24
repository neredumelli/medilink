'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AdminTabs } from '@/components/AdminTabs';

interface Settings {
  maintenance: { on: boolean; message: string; until: string | null };
  minAppVersion: string;
  security: { admin2faRequired: boolean; adminIpAllowList: string[] };
}

/** "2026-10-22T23:30" (local input) <-> ISO with offset */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function SettingsPage() {
  const { me, toast } = useSession();
  const [s, setS] = useState<Settings | null>(null);
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const [minVersion, setMinVersion] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [require2fa, setRequire2fa] = useState(true);
  const [ipList, setIpList] = useState('');
  const canEdit = me?.role === 'SUPER_ADMIN' || me?.role === 'ADMIN_OPS';
  const isSuper = me?.role === 'SUPER_ADMIN';

  const load = async () => {
    const r = await api<Settings>('/admin/settings');
    setS(r);
    setMessage(r.maintenance.message);
    setUntil(toLocalInput(r.maintenance.until));
    setMinVersion(r.minAppVersion);
    setRequire2fa(r.security.admin2faRequired);
    setIpList(r.security.adminIpAllowList.join('\n'));
  };
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function save(body: Partial<Settings>, done: string) {
    try {
      await api('/admin/settings', { body });
      toast(done);
      setConfirming(false);
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
    }
  }

  const maintenanceBody = (on: boolean) => ({ maintenance: { on, message: message.trim(), until: until ? new Date(until).toISOString() : null } });

  return (
    <ConsoleShell allow={(r) => ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'].includes(r)} eyebrow="Super admin" title="Settings" subtitle="Maintenance mode, app versions and admin security" right={<AdminTabs />}>
      {s && (
        <div className="cols">
          <section className="panel" style={{ border: s.maintenance.on ? '2px solid var(--sun)' : undefined }}>
            <div className="row-b">
              <h2>Maintenance mode</h2>
              <span className={`pill ${s.maintenance.on ? 'c-sun' : 'c-green'}`}>{s.maintenance.on ? 'ON: shops see the maintenance screen' : 'Off: everyone can use MediLink'}</span>
            </div>
            <p className="hint" style={{ margin: 0 }}>
              While it is on, shops and distributors see a friendly “being upgraded” screen with your message and return time, in their language. Their carts stay saved. Admins can still log in and work. Distributor PCs keep syncing.
            </p>
            <div className="field">
              <label htmlFor="mmsg">Message to show (optional)</label>
              <input id="mmsg" value={message} maxLength={300} placeholder="e.g. Upgrading for faster search. Back by 11:30 pm." onChange={(e) => setMessage(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="field">
              <label htmlFor="muntil">Expected back by (optional)</label>
              <input id="muntil" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} disabled={!canEdit} />
            </div>
            {canEdit && (
              <div className="actions">
                {s.maintenance.on ? (
                  <>
                    <button className="btn primary" onClick={() => save(maintenanceBody(false), 'Maintenance mode is off. Everyone can use MediLink.')}>
                      <Icon name="check" /> Turn off: open MediLink to everyone
                    </button>
                    <button className="btn" onClick={() => save(maintenanceBody(true), 'Message updated')}>
                      Update message
                    </button>
                  </>
                ) : confirming ? (
                  <>
                    <span className="hint">Shops will not be able to order until you turn it off.</span>
                    <button className="btn danger" onClick={() => save(maintenanceBody(true), 'Maintenance mode is on')}>
                      Yes, turn on now
                    </button>
                    <button className="linkbtn" onClick={() => setConfirming(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn sun" onClick={() => setConfirming(true)}>
                    Turn on maintenance mode
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Phone app version</h2>
            <p className="hint" style={{ margin: 0 }}>
              Phones with an app older than this see a “please update” screen. Raise it only after the new version is live on Google Play and the App Store.
            </p>
            <div className="frow">
              <div className="field">
                <label htmlFor="minv">Minimum app version</label>
                <input id="minv" value={minVersion} onChange={(e) => setMinVersion(e.target.value)} disabled={!canEdit} />
              </div>
              {canEdit && (
                <button className="btn" disabled={minVersion === s.minAppVersion} onClick={() => save({ minAppVersion: minVersion.trim() }, `Minimum app version set to ${minVersion.trim()}`)}>
                  Save
                </button>
              )}
            </div>
            <p className="hint" style={{ margin: 0 }}>Every change here is recorded in the activity log.</p>
          </section>

          <section className="panel">
            <h2>Admin security</h2>
            <label className="row" style={{ gap: 8, fontWeight: 700 }}>
              <input type="checkbox" checked={require2fa} disabled={!isSuper} onChange={(e) => setRequire2fa(e.target.checked)} /> Every admin must use 2-step login (authenticator app)
            </label>
            <p className="hint" style={{ margin: 0 }}>Always on for a live system. Admins without it can only open the “My security” screen until they set it up.</p>
            <div className="field">
              <label htmlFor="iplist">Allow admin screens only from these addresses (one per line; leave empty to allow anywhere)</label>
              <textarea id="iplist" rows={4} value={ipList} disabled={!isSuper} placeholder={'e.g. 203.0.113.25\n198.51.100.0/24'} onChange={(e) => setIpList(e.target.value)} />
            </div>
            <p className="hint" style={{ margin: 0 }}>Your own address must be in the list, so you cannot lock yourself out.</p>
            {isSuper && (
              <div className="actions">
                <button
                  className="btn"
                  onClick={() =>
                    save(
                      { security: { admin2faRequired: require2fa, adminIpAllowList: ipList.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean) } },
                      'Admin security saved',
                    )
                  }
                >
                  Save admin security
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
