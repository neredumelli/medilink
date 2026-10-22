'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { greetingKey } from '@medilink/core';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { lakh } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { LangSwitch } from '@/components/LangSwitch';
import { Card, ProductCard, ProductTile } from '@/components/shop/ProductCard';
import { useShop } from '@/components/shop/ShopContext';
import { StatusTracker } from '@/components/shop/StatusTracker';

interface ParsedLine {
  raw: string;
  productId: string | null;
  qty: number;
  needsCheck: boolean;
  product: { name: string } | null;
}

export default function ShopHome() {
  const { t, toast } = useSession();
  const { home, refresh, markStart } = useShop();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Card[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [paste, setPaste] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    timer.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await api<Card[]>(`/catalog/search?q=${encodeURIComponent(q.trim())}`));
      } catch (e) {
        toast(e instanceof ApiError ? e.message : 'Search failed');
      } finally {
        setSearching(false);
      }
    }, 220);
  }, [q, toast]);

  async function quickAdd(productId: string, qty: number, name: string) {
    markStart();
    try {
      await api(`/shop/cart/${productId}`, { method: 'PUT', body: { qty } });
      await refresh();
      toast(`✓ ${name} × ${qty}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not add');
    }
  }

  async function reorder() {
    if (!home?.lastDelivered) return;
    markStart();
    const r = await api<{ added: number; missing: string[] }>(`/shop/orders/${home.lastDelivered.id}/reorder`, { body: {} });
    await refresh();
    toast(`${r.added} items added at best price${r.missing.length ? `. Not available: ${r.missing.join(', ')}` : ''}`);
    router.push('/shop/cart');
  }

  const greet = t(greetingKey(new Date().getHours()));

  return (
    <>
      <header className="band">
        <div className="band-top">
          <div>
            <div className="hello">{greet},</div>
            <div className="shopname">{home?.shop.name ?? '…'}</div>
          </div>
          <LangSwitch />
        </div>
        {home && (
          <div className="today">
            <span>
              <Icon name="truck" />
              <b>{home.chips.onTheWay}</b> {t('onTheWay')}
            </span>
            <span>
              <Icon name="wallet" />
              <b>{lakh(home.chips.creditFreePaise)}</b> {t('creditFree')}
            </span>
            <span>
              <Icon name="note" />
              <b>{home.chips.shortageCount}</b> {t('shortageList')}
            </span>
          </div>
        )}
        <div className="search">
          <Icon name="search" />
          <label className="sr" htmlFor="q">
            {t('search')}
          </label>
          <input id="q" type="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" enterKeyHint="search" />
        </div>
      </header>

      <main className="r-main">
        {home && !home.shop.canOrder && (
          <div className="note c-sky">
            <b>Your shop documents are being checked.</b>
            <span>You can search and fill your cart now. Ordering opens as soon as they are approved.</span>
          </div>
        )}
        {paste && <PasteSheet onClose={() => setPaste(false)} />}

        {q.trim() ? (
          searching && !results ? (
            <div className="skeleton" />
          ) : results && results.length === 0 ? (
            <p className="empty">
              No medicine matches “{q}”.
              <br />
              Try the salt name, like <b>paracetamol</b>.
            </p>
          ) : (
            results?.map((c) => <ProductCard key={c.product.id} card={c} onSearch={setQ} />)
          )
        ) : (
          <>
            <div className="tiles">
              <button className="tile c-green" onClick={reorder} disabled={!home?.lastDelivered}>
                <span className="ti">
                  <Icon name="redo" />
                </span>
                <span>
                  <b>{t('reorder')}</b>
                  <small>{home?.lastDelivered ? `${home.lastDelivered.items.length} ${t('itemsOneTap')}` : t('noOrdersYet')}</small>
                </span>
              </button>
              <button className="tile c-sun" onClick={() => setPaste(true)}>
                <span className="ti">
                  <Icon name="chat" />
                </span>
                <span>
                  <b>{t('pasteList')}</b>
                  <small>{t('weReadIt')}</small>
                </span>
              </button>
              <button className="tile c-coral" onClick={() => router.push('/shop/list')}>
                <span className="ti">
                  <Icon name="note" />
                </span>
                {(home?.chips.shortageCount ?? 0) > 0 && <span className="count">{home!.chips.shortageCount}</span>}
                <span>
                  <b>{t('shortageList')}</b>
                  <small>{t('sharedWithStaff')}</small>
                </span>
              </button>
              <button className="tile c-sky" onClick={() => toast('Scanning works in the Android and iPhone apps')}>
                <span className="ti">
                  <Icon name="scan" />
                </span>
                <span>
                  <b>{t('scan')}</b>
                  <small>{t('inPhoneApp')}</small>
                </span>
              </button>
            </div>

            {home && home.usual.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="sec-h">
                  <h2>{t('usualItems')}</h2>
                  <span className="hint">{t('tapToAdd')}</span>
                </div>
                <div className="usual">
                  {home.usual.map((u) => (
                    <button key={u.productId} className="umini" onClick={() => quickAdd(u.productId, u.usualQty, u.name)}>
                      <ProductTile name={u.name} category={u.category} small />
                      <b>{u.name}</b>
                      <span className="plus">+ {u.usualQty}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {home?.latestOpen && (
              <section className="card">
                <div className="sec-h">
                  <h2>{home.latestOpen.status === 'DISPATCHED' ? t('arrivingSoon') : t('latestOrder')}</h2>
                  <button className="linkbtn" onClick={() => router.push('/shop/orders')}>
                    {t('allOrders')}
                  </button>
                </div>
                <div className="row-b">
                  <b>{home.latestOpen.distributor}</b>
                  <span className="hint">{home.latestOpen.itemCount} {t('items')}</span>
                </div>
                <StatusTracker status={home.latestOpen.status} />
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function PasteSheet({ onClose }: { onClose: () => void }) {
  const { t, toast } = useSession();
  const { refresh, markStart } = useShop();
  const router = useRouter();
  const [text, setText] = useState('');
  const [lines, setLines] = useState<ParsedLine[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function read() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setLines(await api<ParsedLine[]>('/shop/read-list', { body: { text } }));
    } finally {
      setBusy(false);
    }
  }
  async function addAll() {
    if (!lines) return;
    markStart();
    setBusy(true);
    try {
      const items = lines.filter((l) => l.productId).map((l) => ({ productId: l.productId!, qty: l.qty }));
      const r = await api<{ added: number; missing: string[] }>('/shop/cart/add-many', { body: { items } });
      await refresh();
      toast(`${r.added} items added at best price${r.missing.length ? `. Out of stock: ${r.missing.join(', ')}` : ''}`);
      router.push('/shop/cart');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ border: '2px solid var(--sun)' }}>
      <div className="sec-h">
        <h2>{t('pasteList')}</h2>
        <button className="linkbtn" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Paste the list as you would send it on WhatsApp. One item per line, quantity at the end. Spelling mistakes are fine.
      </p>
      <label className="sr" htmlFor="pasteText">
        Order list
      </label>
      <textarea id="pasteText" value={text} placeholder={'Dolo 650 - 20\nPan 40 x 10\nazithral 5'} onChange={(e) => setText(e.target.value)} />
      <button className="btn sun" onClick={read} disabled={busy || !text.trim()}>
        Read my list
      </button>
      {lines && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lines.map((l, i) => (
              <div key={i} className={`prow ${!l.productId ? 'miss' : ''}`}>
                <span>{l.raw}</span>
                <span>{l.product ? `${l.needsCheck ? '? ' : '✓ '}${l.product.name} × ${l.qty}` : 'Not found'}</span>
              </div>
            ))}
          </div>
          <button className="btn primary" onClick={addAll} disabled={busy}>
            Add {lines.filter((l) => l.productId).length} items at best price
          </button>
        </>
      )}
    </section>
  );
}
