'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useSession } from '@/lib/session';
import { Icon, PillLogo } from '@/components/Icon';

/** Wide layout for the distributor console and admin panel. */
export function ConsoleShell({ allow, eyebrow, title, subtitle, right, children }: { allow: (role: string) => boolean; eyebrow: string; title: string; subtitle?: string; right?: ReactNode; children: ReactNode }) {
  const { me, loading, logout } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (!allow(me.role)) router.replace(homeFor(me.role));
  }, [me, loading, router, allow]);
  if (!me || !allow(me.role)) return <div className="authwrap" />;
  return (
    <>
      <div className="topnav">
        <div className="topnav-in">
          <div className="brand">
            <PillLogo /> MediLink
          </div>
          <span className="spacer" />
          <span className="hint">
            {me.name} · <span className="mono">{me.userCode}</span>
          </span>
          <button
            className="btn small"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <Icon name="logout" /> Log out
          </button>
        </div>
      </div>
      <div className="cband">
        <div className="cband-in">
          <div>
            <div className="hint">{eyebrow}</div>
            <h1>{title}</h1>
            {subtitle && <div className="hint">{subtitle}</div>}
          </div>
          {right}
        </div>
      </div>
      <div className="console">{children}</div>
    </>
  );
}
