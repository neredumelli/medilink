'use client';

import { ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { MessageKey } from '@medilink/core';
import { homeFor, useSession } from '@/lib/session';
import { Icon, IconName } from '@/components/Icon';
import { LangSwitch } from '@/components/LangSwitch';
import { ShopProvider, useShop } from '@/components/shop/ShopContext';
import { inr0 } from '@/lib/format';

const TABS: { href: string; key: MessageKey; icon: IconName }[] = [
  { href: '/shop', key: 'home', icon: 'home' },
  { href: '/shop/list', key: 'list', icon: 'list' },
  { href: '/shop/cart', key: 'cart', icon: 'cart' },
  { href: '/shop/orders', key: 'orders', icon: 'box' },
  { href: '/shop/account', key: 'account', icon: 'user' },
];

export default function ShopLayout({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace('/login');
    else if (!me.role.startsWith('RETAILER')) router.replace(homeFor(me.role));
  }, [me, loading, router]);
  if (!me || !me.role.startsWith('RETAILER')) return <div className="authwrap" />;
  return (
    <ShopProvider>
      <Shell>{children}</Shell>
    </ShopProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { t } = useSession();
  const { cartCount, cartTotal, home } = useShop();
  const current = TABS.find((tab) => (tab.href === '/shop' ? path === '/shop' : path.startsWith(tab.href)));
  return (
    <div className="phone">
      {path !== '/shop' && (
        <header className="band">
          <div className="band-top">
            <div className="tabtitle">{current ? t(current.key) : ''}</div>
            <LangSwitch />
          </div>
        </header>
      )}
      {children}
      {cartCount > 0 && path !== '/shop/cart' && (
        <Link className="cartbar" href="/shop/cart" style={{ textDecoration: 'none' }}>
          <span>
            <Icon name="cart" /> {cartCount} item{cartCount > 1 ? 's' : ''} · {inr0(cartTotal)}
          </span>
          <span>{t('cart')} →</span>
        </Link>
      )}
      <nav className="bnav" aria-label="Shop">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className="tab" aria-current={current?.href === tab.href ? 'page' : undefined}>
            <span className="ni">
              <Icon name={tab.icon} />
            </span>
            {t(tab.key)}
            {tab.key === 'cart' && cartCount > 0 && <span className="badge">{cartCount}</span>}
            {tab.key === 'list' && (home?.chips.shortageCount ?? 0) > 0 && <span className="badge">{home!.chips.shortageCount}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
