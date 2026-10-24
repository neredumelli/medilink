'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { MessageKey } from '@medilink/core';
import { getSystem, isSlow, setSystem, subscribe } from '@/lib/system';
import { useSession } from '@/lib/session';
import { PillLogo } from '@/components/Icon';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
const RECHECK_MS = 30_000;

const COPY: Record<'offline' | 'down' | 'maintenance' | 'update', { title: MessageKey; body: MessageKey; tone: string }> = {
  offline: { title: 'offlineTitle', body: 'offlineBody', tone: 'c-sky' },
  down: { title: 'downTitle', body: 'downBody', tone: 'c-coral' },
  maintenance: { title: 'maintenanceTitle', body: 'maintenanceBody', tone: 'c-sun' },
  update: { title: 'updateTitle', body: 'updateBody', tone: 'c-violet' },
};

/**
 * Full-screen message when MediLink can't be used right now, in the user's language.
 * Checks again on its own (every 30 s, or as soon as the internet comes back) and reloads when fixed.
 */
export function SystemStatus() {
  const { t, lang } = useSession();
  const sys = useSyncExternalStore(subscribe, getSystem, getSystem);
  const slow = useSyncExternalStore(subscribe, isSlow, () => false);
  const [checking, setChecking] = useState(false);
  const [verySlow, setVerySlow] = useState(false);
  useEffect(() => {
    if (!slow) return setVerySlow(false);
    const id = window.setTimeout(() => setVerySlow(true), 8_000);
    return () => window.clearTimeout(id);
  }, [slow]);

  const recheck = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return setSystem({ kind: 'offline' });
    setChecking(true);
    try {
      const r = await fetch(`${BASE}/public/status`, { cache: 'no-store' });
      if (!r.ok) return setSystem({ kind: 'down' });
      const s = await r.json();
      if (s.maintenance?.on) return setSystem({ kind: 'maintenance', message: s.maintenance.message || undefined, until: s.maintenance.until });
      setSystem({ kind: 'ok' });
      window.location.reload(); // fetch fresh data; the cart is saved on the server
    } catch {
      setSystem({ kind: navigator.onLine === false ? 'offline' : 'down' });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (sys.kind === 'ok' || sys.kind === 'update') return;
    const id = window.setInterval(recheck, RECHECK_MS);
    const online = () => recheck();
    const offline = () => setSystem({ kind: 'offline' });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [sys.kind, recheck]);

  useEffect(() => {
    const offline = () => setSystem({ kind: 'offline' });
    window.addEventListener('offline', offline);
    return () => window.removeEventListener('offline', offline);
  }, []);

  if (sys.kind === 'ok') {
    // An action taking a moment: a thin line at the top, no words. Words only if it is really slow (bad network).
    return slow ? (
      <>
        <div className="progress" aria-hidden="true" />
        {verySlow && (
          <div className="slowbar" role="status">
            {t('stillWorking')}
          </div>
        )}
      </>
    ) : null;
  }

  const c = COPY[sys.kind];
  const until = sys.until ? new Date(sys.until) : null;
  const untilText = until && !Number.isNaN(until.getTime()) ? until.toLocaleString(lang === 'en' ? 'en-IN' : `${lang}-IN`, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : null;

  return (
    <div className="sysscreen" role="alertdialog" aria-modal="true" aria-labelledby="sys-title" aria-describedby="sys-body">
      <div className="sys-card">
        <div className="brand" style={{ justifyContent: 'center' }}>
          <PillLogo /> MediLink
        </div>
        <div className={`sys-icon ${c.tone}`} aria-hidden="true">
          {sys.kind === 'offline' ? '⌁' : sys.kind === 'maintenance' ? '⚙' : sys.kind === 'update' ? '↑' : '!'}
        </div>
        <h1 id="sys-title">{t(c.title)}</h1>
        <p id="sys-body">{sys.kind === 'maintenance' && sys.message ? sys.message : t(c.body)}</p>
        {untilText && (
          <p className="sys-until">
            {t('backBy')}: <b>{untilText}</b>
          </p>
        )}
        {sys.kind === 'update' ? (
          <button className="btn primary wide addbtn" onClick={() => window.location.reload()}>
            {t('tryAgain')}
          </button>
        ) : (
          <>
            <button className="btn primary wide addbtn" onClick={recheck} disabled={checking}>
              {checking ? '…' : t('tryAgain')}
            </button>
            <p className="hint" style={{ margin: 0 }}>{t('checkingAgain')}</p>
          </>
        )}
        {sys.ref && (
          <p className="hint" style={{ margin: 0 }}>
            {t('reference')}: <span className="mono">{sys.ref}</span>
          </p>
        )}
      </div>
    </div>
  );
}
