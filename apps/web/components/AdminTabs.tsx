'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Tabs shown in the admin header band. */
export function AdminTabs() {
  const path = usePathname();
  const tabs = [
    { href: '/admin', label: 'Overview' },
    { href: '/admin/users', label: 'Users & access' },
  ];
  return (
    <div className="seg" role="tablist" aria-label="Admin sections" style={{ background: 'rgba(255,255,255,.16)' }}>
      {tabs.map((t) => {
        const on = t.href === '/admin' ? path === '/admin' : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={on} style={{ textDecoration: 'none', padding: '8px 14px', borderRadius: 9, fontWeight: 800, background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--ink)' : 'var(--band-ink)' }}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
