'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError, setSession } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Icon } from '@/components/Icon';
import { ConsoleShell } from '@/components/ConsoleShell';
import { AdminTabs } from '@/components/AdminTabs';

interface Setup {
  secret: string;
  otpauthUrl: string;
  qrSvgDataUrl: string;
}

/** An admin's own 2-step login: set up the authenticator app and keep recovery codes. */
export default function SecurityPage() {
  const { me, reload, toast } = useSession();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tf = me?.twoFactor;

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api<Setup>('/auth/2fa/setup', { method: 'POST' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code shown in the app');
    setBusy(true);
    try {
      const res = await api<{ recoveryCodes: string[]; accessToken: string; refreshToken: string }>('/auth/2fa/enable', { body: { code } });
      setSession(res);
      setCodes(res.recoveryCodes);
      setSetup(null);
      await reload();
      toast('2-step login is on');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const text = `MediLink recovery codes for ${me?.name} (${me?.userCode})\nEach code works once. Keep them somewhere safe, away from your phone.\n\n${codes!.join('\n')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'medilink-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ConsoleShell allow={(r) => ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'].includes(r)} eyebrow="Admin" title="My security" subtitle="2-step login with an authenticator app" right={<AdminTabs />}>
      <div className="cols">
        <section className="panel" style={{ border: tf?.enabled ? undefined : '2px solid var(--sun)' }}>
          <div className="row-b">
            <h2>2-step login</h2>
            <span className={`pill ${tf?.enabled ? 'c-green' : 'c-sun'}`}>{tf?.enabled ? 'On' : 'Not set up'}</span>
          </div>

          {codes ? (
            <>
              <p style={{ margin: 0 }}>
                <b>Save these recovery codes now.</b> They are shown only once. If you lose your phone, each code lets you log in one time.
              </p>
              <div className="box mono" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, fontSize: 16 }}>
                {codes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
              <div className="actions">
                <button className="btn primary" onClick={download}>
                  <Icon name="check" /> Download codes
                </button>
                <button className="btn" onClick={() => window.print()}>
                  Print
                </button>
                <button className="linkbtn" onClick={() => setCodes(null)}>
                  I have saved them
                </button>
              </div>
            </>
          ) : tf?.enabled ? (
            <>
              <p className="hint" style={{ margin: 0 }}>
                Each time you log in, MediLink asks for the 6-digit code from your authenticator app after the SMS code. Someone who only has your SIM or your OTP cannot get into the admin panel.
              </p>
              <p style={{ margin: 0 }}>
                Recovery codes left: <b>{tf.recoveryCodesLeft}</b>
                {tf.recoveryCodesLeft <= 3 && <span className="hint"> · running low: ask the super admin to reset your 2-step login and set it up again for fresh codes.</span>}
              </p>
              <p className="hint" style={{ margin: 0 }}>
                New phone? Ask the super admin to reset your 2-step login (Users &amp; access), then set it up again here.
              </p>
            </>
          ) : setup ? (
            <form onSubmit={confirm} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Install Google Authenticator, Microsoft Authenticator or Authy on your phone.</li>
                <li>In the app, tap “+” and scan this code.</li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <img src={setup.qrSvgDataUrl} alt="QR code for your authenticator app" width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 12, alignSelf: 'flex-start' }} />
              <p className="hint" style={{ margin: 0 }}>
                Cannot scan? Enter this key by hand: <span className="mono" style={{ userSelect: 'all' }}>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
              </p>
              <div className="field">
                <label htmlFor="tfcode">6-digit code from the app</label>
                <input id="tfcode" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
              </div>
              {error && <div className="err">{error}</div>}
              <div className="actions">
                <button className="btn primary" disabled={busy}>
                  {busy ? '…' : 'Turn on 2-step login'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <p style={{ margin: 0 }}>Protect the admin panel with a code from an authenticator app on your phone, in addition to the SMS code.</p>
              <p className="hint" style={{ margin: 0 }}>
                On a live system every admin must use it. It takes about a minute to set up.
              </p>
              {error && <div className="err">{error}</div>}
              <div className="actions">
                <button className="btn primary" disabled={busy} onClick={start}>
                  {busy ? '…' : 'Set up 2-step login'}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </ConsoleShell>
  );
}
