'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { inr0 } from '@/lib/format';
import { Icon } from '@/components/Icon';

interface Dist {
  id: string;
  name: string;
  area: string;
  deliveryLabel: string;
  link: { status: 'PENDING' | 'LINKED' | 'DECLINED'; creditLimitPaise: number; duesPaise: number; availablePaise: number } | null;
}

export default function AccountPage() {
  const { me, logout, toast, t } = useSession();
  const router = useRouter();
  const [dists, setDists] = useState<Dist[] | null>(null);
  const [big, setBig] = useState(false);
  const load = useCallback(async () => setDists(await api<Dist[]>('/shop/distributors')), []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  useEffect(() => {
    document.querySelector('.phone')?.classList.toggle('big', big);
  }, [big]);

  async function link(id: string) {
    try {
      await api(`/shop/distributors/${id}/link`, { body: {} });
      toast('Request sent. The distributor will set your credit limit.');
      await load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not send request');
    }
  }

  const r = me?.retailer;
  return (
    <main className="r-main">
      <section className="card">
        <div className="row-b">
          <h2 style={{ fontSize: '1.2em' }}>{r?.name}</h2>
          <span className={`pill ${r?.kycStatus === 'APPROVED' ? 'c-green' : 'c-sun'}`}>
            <Icon name="shield" /> {r?.kycStatus === 'APPROVED' ? 'Verified' : 'Being checked'}
          </span>
        </div>
        <dl className="kv">
          <dt>Your ID</dt>
          <dd className="mono">{me?.userCode}</dd>
          <dt>Area</dt>
          <dd>{r?.area}</dd>
          <dt>GSTIN</dt>
          <dd className="mono">{r?.gstin ?? 'Not added'}</dd>
          <dt>Login</dt>
          <dd>+91 {me?.mobile} · OTP</dd>
        </dl>
      </section>

      <section className="card">
        <h2 style={{ fontSize: '1.2em' }}>Your distributors</h2>
        {!dists ? (
          <div className="skeleton" />
        ) : (
          dists.map((d) => (
            <div className="dl-item" key={d.id}>
              <div className="row-b">
                <b>{d.name}</b>
                {d.link?.status === 'LINKED' ? <span className="pill c-green">Linked</span> : d.link?.status === 'PENDING' ? <span className="pill c-sun">Request sent</span> : <span className="pill">Not linked</span>}
              </div>
              <div className="hint">
                {d.area} · delivers {d.deliveryLabel.toLowerCase()}
              </div>
              {d.link?.status === 'LINKED' ? (
                <div className="row-b">
                  <span>
                    {t('dues')} <b>{inr0(d.link.duesPaise)}</b>
                  </span>
                  <span className="hint">
                    Free {inr0(d.link.availablePaise)} of {inr0(d.link.creditLimitPaise)}
                  </span>
                </div>
              ) : d.link?.status === 'PENDING' ? (
                <div className="hint">They will set your credit limit and approve.</div>
              ) : (
                <button className="btn primary small" onClick={() => link(d.id)}>
                  Request to link
                </button>
              )}
            </div>
          ))
        )}
      </section>

      <section className="card">
        <h2 style={{ fontSize: '1.2em' }}>Settings &amp; help</h2>
        <div className="row-b">
          <span>Large text</span>
          <button className="btn small" aria-pressed={big} onClick={() => setBig(!big)}>
            {big ? 'On' : 'Off'}
          </button>
        </div>
        <div className="row-b">
          <span>Talk to a person</span>
          <span className="mono">{process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? "Support number not set"}</span>
        </div>
        <button
          className="btn"
          onClick={async () => {
            await logout();
            router.replace('/login');
          }}
        >
          <Icon name="logout" /> Log out
        </button>
      </section>
    </main>
  );
}
