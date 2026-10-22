'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateGstin } from '@medilink/core';
import { api, ApiError, setSession } from '@/lib/api';
import { useSession } from '@/lib/session';

type Field = 'ownerName' | 'shopName' | 'area' | 'pincode' | 'address' | 'gstin' | 'dl20b' | 'dl21b';
const LABELS: Record<Field, string> = {
  ownerName: 'Your name',
  shopName: 'Shop name',
  area: 'Area',
  pincode: 'Pincode',
  address: 'Shop address',
  gstin: 'GSTIN (optional now, needed before ordering)',
  dl20b: 'Drug licence 20B',
  dl21b: 'Drug licence 21B',
};

export default function Register() {
  const router = useRouter();
  const { lang, reload } = useSession();
  const [reg, setReg] = useState<{ token: string; mobile: string } | null>(null);
  const [form, setForm] = useState<Record<Field, string>>({ ownerName: '', shopName: '', area: '', pincode: '', address: '', gstin: '', dl20b: '', dl21b: '' });
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field | 'form', string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem('ml.reg');
    if (!raw) router.replace('/login');
    else setReg(JSON.parse(raw));
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    (['ownerName', 'shopName', 'area', 'address', 'dl20b', 'dl21b'] as Field[]).forEach((f) => !form[f].trim() && (errs[f] = 'Please fill this in'));
    if (!/^[1-9]\d{5}$/.test(form.pincode)) errs.pincode = 'Enter a 6-digit pincode';
    if (form.gstin.trim()) {
      const g = validateGstin(form.gstin);
      if (!g.ok) errs.gstin = g.problem === 'checksum' ? 'One character looks wrong. Please check against your GST certificate.' : 'GSTIN should be 15 characters, like 36AAAAA0000A1Z5';
    }
    if (!terms) errs.form = 'Please accept the terms to continue';
    setErrors(errs);
    if (Object.keys(errs).length || !reg) return;
    setBusy(true);
    try {
      const res = await api('/auth/register/shop', { body: { registrationToken: reg.token, ...form, lang, acceptTerms: true } });
      sessionStorage.removeItem('ml.reg');
      setSession(res);
      await reload();
      router.replace('/shop');
    } catch (err) {
      if (err instanceof ApiError && err.issues) {
        const next: typeof errors = {};
        err.issues.forEach((i) => (next[i.field as Field] = i.message));
        setErrors({ ...next, form: err.message });
      } else setErrors({ form: err instanceof Error ? err.message : 'Could not register' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="authwrap">
      <form className="authcard" onSubmit={submit} noValidate>
        <h1>Register your shop</h1>
        <p className="hint" style={{ margin: 0 }}>
          Mobile +91 {reg?.mobile}. You can look around right away; ordering opens once we check your licences (usually within a few hours).
        </p>
        {(Object.keys(LABELS) as Field[]).map((f) => (
          <label key={f} className="bigfield">
            {LABELS[f]}
            {f === 'address' ? (
              <textarea id={f} rows={2} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
            ) : (
              <input id={f} value={form[f]} inputMode={f === 'pincode' ? 'numeric' : undefined} onChange={(e) => setForm({ ...form, [f]: f === 'gstin' ? e.target.value.toUpperCase() : e.target.value })} />
            )}
            {errors[f] && <span className="err">{errors[f]}</span>}
          </label>
        ))}
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 600 }}>
          <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ width: 22, height: 22 }} />
          I agree to the Terms of Use and Privacy Policy. MediLink is for licensed businesses only.
        </label>
        {errors.form && <div className="err">{errors.form}</div>}
        <button className="btn primary wide addbtn" disabled={busy}>
          {busy ? '…' : 'Create my shop account'}
        </button>
      </form>
    </main>
  );
}
