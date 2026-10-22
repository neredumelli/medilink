'use client';

import { useState } from 'react';
import { freeQty } from '@medilink/core';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { abbr, catClass, inr } from '@/lib/format';
import { Icon } from '@/components/Icon';
import { useShop } from './ShopContext';

export interface Offer {
  distributorId: string;
  distributorName: string;
  area: string;
  deliveryLabel: string;
  stockQty: number;
  stockLevel: 'out' | 'low' | 'in';
  ptrPaise: number;
  discountPct: number;
  scheme: { buy: number; free: number } | null;
  netRatePaise: number;
  nearestExpiry: string | null;
  shortExpiry: boolean;
}
export interface Card {
  product: { id: string; name: string; form: string; pack: string; salt: string; company: string; schedule: string; category: string; mrpPaise: number; status?: string; statusNote?: string | null };
  /** Why it cannot be ordered (banned, recalled, discontinued). */
  blocked?: string | null;
  usualQty: number;
  offers: Offer[];
  best: { distributorId: string; netRatePaise: number; partial: boolean; overCredit: boolean } | null;
  unlinkedWithStock: number;
  substitutes: { id: string; name: string; company: string; fromNetRatePaise: number }[];
}

export function ProductTile({ name, category, small }: { name: string; category: string; small?: boolean }) {
  return (
    <span className={`ptile ${catClass(category)}`} aria-hidden="true" style={small ? { width: 40, height: 40, fontSize: '1em', borderRadius: 12 } : undefined}>
      {abbr(name)}
    </span>
  );
}

function StockPill({ o }: { o: Offer }) {
  const { t } = useSession();
  if (o.stockQty === 0) return <span className="pill c-coral">{t('outOfStock')}</span>;
  if (o.stockLevel === 'low') return <span className="pill c-sun">{t('lowStock')} · {o.stockQty} left</span>;
  return <span className="pill c-green">{t('inStock')}</span>;
}

const expLabel = (iso: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—');

export function ProductCard({ card, onSearch }: { card: Card; onSearch: (q: string) => void }) {
  const { t, toast } = useSession();
  const { refresh, markStart } = useShop();
  const p = card.product;
  const [qty, setQty] = useState(card.usualQty);
  const [pick, setPick] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(false);

  const head = (
    <div className="pc-top">
      <ProductTile name={p.name} category={p.category} />
      <div className="pc-info">
        <div className="pc-name">
          {p.name} <span>{p.form} {p.pack}</span>
        </div>
        <div className="pc-meta">
          {p.salt} · {p.company} {p.schedule !== 'NONE' && <span className="sched" title={`Schedule ${p.schedule} drug`}>Sch {p.schedule}</span>}
        </div>
      </div>
      <div className="mrp">
        MRP<b>{inr(p.mrpPaise)}</b>
      </div>
    </div>
  );

  if (card.blocked) {
    const label = p.status === 'BANNED' ? t('statusBanned') : p.status === 'RECALLED' ? t('statusRecalled') : t('statusDiscontinued');
    return (
      <article className="card" aria-label={`${p.name}: ${t('cannotOrder')}`}>
        {head}
        <div className="note c-coral">
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="pill c-coral">
              <Icon name="x" /> {label}
            </span>
            <b>{t('cannotOrder')}</b>
          </span>
          {p.statusNote && <span>{p.statusNote}</span>}
          {card.substitutes.length > 0 && (
            <>
              <span>{t('sameMedicine')}:</span>
              <div className="subs">
                {card.substitutes.map((s) => (
                  <button key={s.id} onClick={() => onSearch(s.name)}>
                    {s.name} · {s.company} · {inr(s.fromNetRatePaise)}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </article>
    );
  }

  if (!card.best) {
    return (
      <article className="card">
        {head}
        <div className="note c-coral">
          <span>{t('outOfStock')} at all your distributors.</span>
          {card.substitutes.length > 0 && (
            <>
              <span>{t('sameMedicine')}:</span>
              <div className="subs">
                {card.substitutes.map((s) => (
                  <button key={s.id} onClick={() => onSearch(s.name)}>
                    {s.name} · {s.company} · {inr(s.fromNetRatePaise)}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="btn small" onClick={() => setNotify(!notify)}>
            <Icon name={notify ? 'check' : 'bell'} /> {notify ? 'We will tell you when it is back' : t('notifyBack')}
          </button>
        </div>
      </article>
    );
  }

  const chosenId = pick ?? card.best.distributorId;
  const o = card.offers.find((x) => x.distributorId === chosenId)!;
  const isBest = chosenId === card.best.distributorId;
  const inStockCount = card.offers.filter((x) => x.stockQty > 0).length;
  const fq = freeQty(o.scheme, qty);

  async function add() {
    setBusy(true);
    markStart();
    try {
      await api(`/shop/cart/${p.id}`, { method: 'PUT', body: { qty, distributorId: pick ?? undefined } });
      await refresh();
      toast(`✓ ${p.name} × ${qty} from ${o.distributorName}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not add');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    try {
      await api('/shop/shortage', { body: { productId: p.id, qty } });
      await refresh();
      toast('Saved to shortage list');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save');
    }
  }

  return (
    <article className="card">
      {head}
      <div className={`bestbox ${isBest ? '' : 'alt'}`}>
        <div className="bb-row">
          <div>
            <span className={`tag ${isBest ? '' : 'blue'}`}>{isBest ? t('bestPrice') : t('yourChoice')}</span>
            <div className="price" style={{ marginTop: 6 }}>
              {inr(o.netRatePaise)} <small>{t('perStrip')}</small>
            </div>
          </div>
          <StockPill o={o} />
        </div>
        <div className="from">
          {t('from')} <b>{o.distributorName}</b> · {o.deliveryLabel}
        </div>
        <div className="chips">
          {o.scheme && <span className="pill c-violet">Scheme {o.scheme.buy}+{o.scheme.free}</span>}
          {o.discountPct > 0 && <span className="pill c-violet">{o.discountPct}% off</span>}
          <span className="pill">PTR {inr(o.ptrPaise)}</span>
          <span className={`pill ${o.shortExpiry ? 'c-sun' : ''}`}>
            Exp {expLabel(o.nearestExpiry)}
            {o.shortExpiry ? ' · short' : ''}
          </span>
        </div>
      </div>

      {(inStockCount > 1 || card.unlinkedWithStock > 0) && (
        <button className="cmpbtn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name={open ? 'up' : 'down'} /> {t('compare')} ({card.offers.length})
        </button>
      )}
      {open && (
        <div className="drows">
          {card.offers.map((x) => (
            <button key={x.distributorId} className={`drow ${x.distributorId === chosenId ? 'sel' : ''}`} disabled={x.stockQty === 0} aria-pressed={x.distributorId === chosenId} onClick={() => setPick(x.distributorId)}>
              <span className="dname">
                {x.distributorName}
                <small>
                  {x.area} · {x.deliveryLabel}
                </small>
              </span>
              <span className="rate">
                {inr(x.netRatePaise)}
                <small>net</small>
              </span>
              <span className="chips">
                <StockPill o={x} />
                {x.scheme && <span className="pill c-violet">{x.scheme.buy}+{x.scheme.free}</span>}
                {x.discountPct > 0 && <span className="pill c-violet">{x.discountPct}% off</span>}
                {x.distributorId === card.best!.distributorId && <span className="tag">{t('bestPrice')}</span>}
              </span>
            </button>
          ))}
          {card.unlinkedWithStock > 0 && <div className="hint">{card.unlinkedWithStock} more distributor(s) have this. Link them from Account.</div>}
        </div>
      )}
      {o.stockQty < qty && <div className="note c-sun">Only {o.stockQty} in stock here. The rest will need another distributor.</div>}
      {card.best.overCredit && <div className="note c-coral">{t('overCredit')}</div>}

      <div className="pc-foot">
        <div className="stepper">
          <button type="button" aria-label="Less" onClick={() => setQty(Math.max(1, qty - 1))}>
            −
          </button>
          <label className="sr" htmlFor={`qty-${p.id}`}>
            Quantity
          </label>
          <input id={`qty-${p.id}`} inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(9999, Number(e.target.value.replace(/\D/g, '')) || 1)))} />
          <button type="button" aria-label="More" onClick={() => setQty(Math.min(9999, qty + 1))}>
            +
          </button>
        </div>
        <button className="btn primary addbtn" disabled={busy} onClick={add}>
          {t('addToCart')}
          {fq > 0 ? ` · +${fq} free` : ''}
        </button>
        <button className="iconbtn" aria-label="Save to shortage list" title="Save to shortage list" onClick={save}>
          <Icon name="bookmark" />
        </button>
      </div>
    </article>
  );
}
