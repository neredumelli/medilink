'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isIndianMobile, LANGS, Lang } from '@medilink/core';
import { api, ApiError, setSession } from '@/lib/api';
import { homeDataFor, homeFor, useSession } from '@/lib/session';
import { PillLogo } from '@/components/Icon';

const LANG_LABEL: Record<Lang, string> = { en: 'English', te: 'తెలుగు', hi: 'हिंदी' };

export default function Login() {
  const router = useRouter();
  const { t, lang, setLang, reload } = useSession();
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'mobile' | 'otp' | 'app'>('mobile');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [appCode, setAppCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isIndianMobile(mobile)) return setError('Enter a 10-digit mobile number');
    setBusy(true);
    try {
      await api('/auth/otp/request', { body: { mobile } });
      setStep('otp');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send OTP');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('The OTP has 6 digits');
    setBusy(true);
    try {
      const res = await api('/auth/otp/verify', { body: { mobile, code } });
      if (res.registrationToken) {
        sessionStorage.setItem('ml.reg', JSON.stringify({ token: res.registrationToken, mobile }));
        router.push('/register');
        return;
      }
      if (res.twoFactorRequired) {
        setTwoFactorToken(res.twoFactorToken);
        setStep('app');
        return;
      }
      setSession(res);
      // Start loading the home screen's data together with the profile, not after it.
      homeDataFor(res.user.role).forEach((p) => api(p).catch(() => {}));
      router.prefetch(homeFor(res.user.role));
      await reload();
      router.replace(homeFor(res.user.role));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify');
    } finally {
      setBusy(false);
    }
  }

  /** Admins: the 6-digit code from the authenticator app, or a recovery code. */
  async function verifyApp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (appCode.trim().length < 6) return setError('Enter the 6-digit code from your authenticator app');
    setBusy(true);
    try {
      const res = await api('/auth/2fa/verify', { body: { twoFactorToken, code: appCode.trim() } });
      setSession(res);
      // Start loading the home screen's data together with the profile, not after it.
      homeDataFor(res.user.role).forEach((p) => api(p).catch(() => {}));
      router.prefetch(homeFor(res.user.role));
      await reload();
      router.replace(homeFor(res.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && /start again/.test(err.message)) setStep('mobile');
      setError(err instanceof ApiError ? err.message : 'Could not verify');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authwrap">
      <div className="brandmark">
        <PillLogo size={40} /> MediLink
      </div>
      <div className="authcard">
        <div className="seg" role="group" aria-label="Language" style={{ alignSelf: 'flex-start' }}>
          {LANGS.map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
              {LANG_LABEL[l]}
            </button>
          ))}
        </div>
        {step === 'mobile' ? (
          <form onSubmit={sendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1>{t('enterMobile')}</h1>
            <label className="bigfield">
              <span className="sr">Mobile number</span>
              <input id="mobile" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="98480 12345" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))} autoFocus />
            </label>
            {error && <div className="err">{error}</div>}
            <button className="btn primary wide addbtn" disabled={busy}>
              {busy ? '…' : t('sendOtp')}
            </button>
            <p className="hint" style={{ margin: 0 }}>
              No password needed. We send a one-time code by SMS.
            </p>
          </form>
        ) : step === 'app' ? (
          <form onSubmit={verifyApp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1>Code from your authenticator app</h1>
            <p className="hint" style={{ margin: 0 }}>
              Open Google Authenticator (or the app you use) and type the 6-digit MediLink code. Lost your phone? Type one of your recovery codes.
            </p>
            <label className="bigfield">
              <span className="sr">Authenticator code</span>
              <input id="appcode" className="otp" autoComplete="one-time-code" maxLength={12} value={appCode} onChange={(e) => setAppCode(e.target.value.toUpperCase().replace(/[^0-9A-Z-]/g, ''))} autoFocus />
            </label>
            {error && <div className="err">{error}</div>}
            <button className="btn primary wide addbtn" disabled={busy}>
              {busy ? '…' : t('verify')}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h1>{t('enterOtp')}</h1>
            <p className="hint" style={{ margin: 0 }}>
              Sent to +91 {mobile}.{' '}
              <button type="button" className="linkbtn" onClick={() => setStep('mobile')}>
                Change
              </button>
            </p>
            <label className="bigfield">
              <span className="sr">OTP</span>
              <input id="otp" className="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
            </label>
            {error && <div className="err">{error}</div>}
            <button className="btn primary wide addbtn" disabled={busy}>
              {busy ? '…' : t('verify')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
