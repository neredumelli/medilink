'use client';

/**
 * Last safety net if even the page frame fails. It cannot rely on the app's styles or language setting,
 * so it is self-contained and shows all three languages.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ref = `ML-${(error.digest ?? Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/gi, '').slice(0, 5).toUpperCase()}`;
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0E9F5E', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ background: '#fff', color: '#10231A', borderRadius: 24, padding: 24, maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Something went wrong</h1>
          <p style={{ margin: 0 }}>ఏదో సమస్య వచ్చింది · कुछ गड़बड़ हो गई</p>
          <p style={{ margin: 0, color: '#5B6E63' }}>Please try again. Your cart is saved.</p>
          <p style={{ margin: 0, color: '#5B6E63' }}>
            Reference: <b>{ref}</b>
          </p>
          <button onClick={reset} style={{ border: 0, borderRadius: 14, background: '#0E9F5E', color: '#fff', fontWeight: 800, fontSize: 16, minHeight: 50, cursor: 'pointer' }}>
            Try again · మళ్ళీ ప్రయత్నించండి · फिर कोशिश करें
          </button>
        </div>
      </body>
    </html>
  );
}
