import Link from 'next/link';

/** Friendly page for a wrong or old link. */
export default function NotFound() {
  return (
    <div className="errscreen">
      <div className="sys-card">
        <div className="sys-icon c-sky" aria-hidden="true">
          ?
        </div>
        <h1>This page does not exist</h1>
        <p>The link may be old or typed wrongly.</p>
        <Link className="btn primary wide addbtn" href="/" style={{ textDecoration: 'none' }}>
          Go to MediLink home
        </Link>
      </div>
    </div>
  );
}
