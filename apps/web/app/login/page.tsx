'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isIndianMobile, LANGS, Lang } from '@medilink/core';
import { api, ApiError, setSession } from '@/lib/api';
import { homeFor, useSession } from '@/lib/session';
import { PillLogo } from '@/components/Icon';

const LANG_LABEL: Record<Lang, string> = { en: 'English', te: 'తెలుగు', hi: 'हिंदी' };

export default function Login() {
  const router = useRouter();
  const { t, lang, setLang, reload } = useSession();
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'mobile' | 'otp'>('mobile');
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
      setSession(res);
      await reload();
      router.replace(homeFor(res.user.role));
    } catch (err) {
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
