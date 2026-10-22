import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const c = require('../dist/index.js');

/* ---------- money ---------- */
test('parseScheme reads common formats', () => {
  assert.deepEqual(c.parseScheme('10+1'), { buy: 10, free: 1 });
  assert.deepEqual(c.parseScheme(' 15 + 2 scheme'), { buy: 15, free: 2 });
  assert.equal(c.parseScheme('net'), null);
  assert.equal(c.parseScheme('0+1'), null);
  assert.equal(c.parseScheme(null), null);
});

test('freeQty earns per full block only', () => {
  const s = { buy: 10, free: 1 };
  assert.equal(c.freeQty(s, 9), 0);
  assert.equal(c.freeQty(s, 10), 1);
  assert.equal(c.freeQty(s, 25), 2);
  assert.equal(c.freeQty(null, 50), 0);
});

test('netRate applies discount then scheme, in paise', () => {
  // ₹24.00 PTR, 2% off, 10+1 => 24 * 0.98 * 10/11 = 21.3818 => 2138 paise
  assert.equal(c.netRate(2400, 2, { buy: 10, free: 1 }), 2138);
  assert.equal(c.netRate(2400, 0, null), 2400);
  assert.equal(c.billedRate(2400, 2), 2352);
  assert.equal(c.netRate(2400, 150, null), 0, 'discount is clamped to 100%');
});

test('orderTotals adds GST per line and rounds to paise', () => {
  const t = c.orderTotals([{ ratePaise: 2352, qty: 30 }, { ratePaise: 14217, qty: 10, gstPct: 12 }]);
  assert.equal(t.subtotal, 2352 * 30 + 14217 * 10);
  assert.equal(t.gst, Math.round((2352 * 30 * 5) / 100) + Math.round((14217 * 10 * 12) / 100));
  assert.equal(t.total, t.subtotal + t.gst);
  assert.throws(() => c.orderTotals([{ ratePaise: 100, qty: 1.5 }]), RangeError);
});

test('formatINR uses Indian grouping', () => {
  assert.equal(c.formatINR(12345678), '₹1,23,456.78');
  assert.equal(c.formatINR(150000, { decimals: false }), '₹1,500');
});

/* ---------- best buy ---------- */
const offer = (id, o) => ({ distributorId: id, productId: 'P1', stockQty: 100, ptr: 2400, discountPct: 0, scheme: null, etaHours: 3, creditAvailable: 1_000_000, ...o });

test('pickBest chooses the lowest net rate', () => {
  const r = c.pickBest([offer('A', { ptr: 2400 }), offer('B', { ptr: 2400, scheme: { buy: 10, free: 1 } })], 10);
  assert.equal(r.offer.distributorId, 'B');
  assert.ok(r.reasons.includes('cheapest'));
});

test('pickBest prefers full stock over a cheaper partial', () => {
  const r = c.pickBest([offer('A', { ptr: 2000, stockQty: 5 }), offer('B', { ptr: 2400 })], 10);
  assert.equal(r.offer.distributorId, 'B');
  assert.equal(r.partial, false);
});

test('pickBest falls back to partial stock and says so', () => {
  const r = c.pickBest([offer('A', { stockQty: 5 }), offer('B', { stockQty: 0 })], 10);
  assert.equal(r.offer.distributorId, 'A');
  assert.equal(r.partial, true);
});

test('pickBest avoids distributors where credit would block the order', () => {
  const r = c.pickBest([offer('A', { ptr: 2000, creditAvailable: 100 }), offer('B', { ptr: 2400 })], 10);
  assert.equal(r.offer.distributorId, 'B');
  assert.ok(r.reasons.includes('credit_limited'));
});

test('pickBest flags overCredit when nobody has enough credit', () => {
  const r = c.pickBest([offer('A', { creditAvailable: 0 })], 10);
  assert.equal(r.overCredit, true);
});

test('pickBest breaks price ties by delivery time and honours exclude', () => {
  const r = c.pickBest([offer('A', { etaHours: 20 }), offer('B', { etaHours: 3 })], 10);
  assert.equal(r.offer.distributorId, 'B');
  assert.ok(r.reasons.includes('fastest_same_price'));
  assert.equal(c.pickBest([offer('A'), offer('B')], 10, { exclude: ['A'] }).offer.distributorId, 'B');
  assert.equal(c.pickBest([offer('A', { stockQty: 0 })], 10), null);
});

test('isShortExpiry flags under six months', () => {
  const now = new Date('2026-10-22');
  assert.equal(c.isShortExpiry('2027-02-01', now), true);
  assert.equal(c.isShortExpiry('2027-08-01', now), false);
  assert.equal(c.isShortExpiry(null, now), false);
  assert.equal(c.stockLevel(0), 'out');
  assert.equal(c.stockLevel(6), 'low');
  assert.equal(c.stockLevel(200), 'in');
});

/* ---------- search ---------- */
const catalog = [
  { id: 'P1', name: 'Dolo 650', salt: 'Paracetamol 650 mg', company: 'Micro Labs' },
  { id: 'P2', name: 'Calpol 500', salt: 'Paracetamol 500 mg', company: 'GSK' },
  { id: 'P3', name: 'Pan 40', salt: 'Pantoprazole 40 mg', company: 'Alkem' },
  { id: 'P5', name: 'Azithral 500', salt: 'Azithromycin 500 mg', company: 'Alembic' },
  { id: 'P7', name: 'Telma 40', salt: 'Telmisartan 40 mg', company: 'Glenmark' },
  { id: 'P17', name: 'Telmikind 40', salt: 'Telmisartan 40 mg', company: 'Mankind' },
  { id: 'P11', name: 'Montair LC', salt: 'Montelukast + Levocetirizine', company: 'Cipla' },
  { id: 'P9', name: 'Shelcal 500', salt: 'Calcium + Vitamin D3', company: 'Torrent' },
];

test('search ranks brand prefix first, then salt', () => {
  assert.equal(c.searchItems(catalog, 'dolo')[0].id, 'P1');
  assert.deepEqual(c.searchItems(catalog, 'paracetamol').map((x) => x.id).sort(), ['P1', 'P2']);
  assert.equal(c.searchItems(catalog, 'panto')[0].id, 'P3');
});

test('search tolerates spelling mistakes', () => {
  assert.equal(c.searchItems(catalog, 'azithrl')[0].id, 'P5');
  assert.equal(c.searchItems(catalog, 'shelcl')[0].id, 'P9');
  assert.equal(c.searchItems(catalog, 'xyzzy').length, 0);
});

test('sameComposition finds substitutes', () => {
  assert.deepEqual(c.sameComposition(catalog, catalog[4]).map((x) => x.id), ['P17']);
});

/* ---------- list parsing ---------- */
test('parseOrderList reads WhatsApp-style lists', () => {
  const lines = c.parseOrderList('1. Dolo 650 - 20\npan 40 x10\nazithral 5\nmontair lc 10 strips, shelcal\nunknownthing 3', catalog, () => 15);
  assert.deepEqual(
    lines.map((l) => [l.productId, l.qty, l.qtyGiven]),
    [
      ['P1', 20, true],
      ['P3', 10, true],
      ['P5', 5, true],
      ['P11', 10, true],
      ['P9', 15, false],
      [null, 3, true],
    ],
  );
});

/* ---------- validation ---------- */
test('GSTIN checksum validates real-format numbers', () => {
  assert.deepEqual(c.validateGstin('27AAPFU0939F1ZV'), { ok: true, stateCode: '27', pan: 'AAPFU0939F' });
  assert.deepEqual(c.validateGstin('27AAPFU0939F1ZX'), { ok: false, problem: 'checksum' });
  assert.deepEqual(c.validateGstin('36AAGCG9032M1X'), { ok: false, problem: 'length' });
  assert.deepEqual(c.validateGstin('36aagcg9032m1z' + c.gstinCheckChar('36AAGCG9032M1Z')).ok, true);
  assert.deepEqual(c.validateGstin('00AAPFU0939F1ZV'), { ok: false, problem: 'state' });
});

test('mobile and PAN checks', () => {
  assert.equal(c.normalizeMobile('+91 98480 12345'), '9848012345');
  assert.equal(c.isIndianMobile('+91 98480 12345'), true);
  assert.equal(c.isIndianMobile('5848012345'), false);
  assert.equal(c.isPan('aapfu0939f'), true);
  assert.equal(c.isPlausibleDrugLicence('TS/HYD/2024/20B-07731'), true);
  assert.equal(c.isPlausibleDrugLicence('abc'), false);
});

/* ---------- order status ---------- */
test('order state machine enforces who can do what', () => {
  assert.equal(c.canTransition('PLACED', 'ACCEPTED', 'DISTRIBUTOR'), true);
  assert.equal(c.canTransition('PLACED', 'ACCEPTED', 'RETAILER'), false);
  assert.equal(c.canTransition('PLACED', 'CANCELLED', 'RETAILER'), true);
  assert.equal(c.canTransition('ACCEPTED', 'CANCELLED', 'RETAILER'), false, 'shop cannot cancel once accepted');
  assert.equal(c.canTransition('DELIVERED', 'PLACED', 'ADMIN'), false);
  assert.deepEqual(c.nextStatuses('PLACED', 'DISTRIBUTOR'), ['ACCEPTED', 'REJECTED']);
  assert.equal(c.releasesCredit('REJECTED'), true);
  assert.equal(c.isOpen('DISPATCHED'), true);
});

/* ---------- i18n ---------- */
test('every language has every message', () => {
  for (const lang of c.LANGS) for (const key of Object.keys(c.MESSAGES.en)) assert.ok(c.MESSAGES[lang][key], `${lang}.${key}`);
  assert.equal(c.t('te', 'cart'), 'కార్ట్');
  assert.equal(c.greetingKey(9), 'goodMorning');
});
