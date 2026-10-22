'use client';

import { useEffect, useMemo } from 'react';
import { useSession } from '@/lib/session';

/** Shown instead of a blank page when a screen hits an unexpected error. */
export default function ScreenError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useSession();
  // Short reference the user can read to support; the digest links to the server log when there is one.
  const ref = useMemo(() => `ML-${(error.digest ?? Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase()}`, [error.digest]);

  useEffect(() => {
    console.error(`[${ref}]`, error);
  }, [error, ref]);

  return (
    <div className="errscreen">
      <div className="sys-card">
        <div className="sys-icon c-coral" aria-hidden="true">
          !
        </div>
        <h1>{t('errorTitle')}</h1>
        <p>{t('errorBody')}</p>
        <p className="hint" style={{ margin: 0 }}>
          {t('reference')}: <span className="mono">{ref}</span>
        </p>
        <button className="btn primary wide addbtn" onClick={reset}>
          {t('tryAgain')}
        </button>
        <button className="btn wide" onClick={() => (window.location.href = '/')}>
          Home
        </button>
      </div>
    </div>
  );
}
