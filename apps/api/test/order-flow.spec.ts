/**
 * End-to-end order flow against a real PostgreSQL database loaded with prisma/seed.sql.
 * Run: pnpm db:up && pnpm --filter @medilink/api prisma:reset && pnpm --filter @medilink/api test
 * Uses OTP_PROVIDER=console; the test reads the OTP by temporarily replacing the sender.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpSender } from '../src/auth/otp.sender';
import { signBody } from '../src/sync/agent.guard';

const codes = new Map<string, string>();

describe('Shop → distributor order flow', () => {
  let app: INestApplication;
  const tokens = new Map<string, string>(); // reuse logins: OTP requests are rate-limited (3 per 10 min)
  const login = async (mobile: string) => {
    if (tokens.has(mobile)) return tokens.get(mobile)!;
    await request(app.getHttpServer()).post('/api/auth/otp/request').send({ mobile }).expect(200);
    const res = await request(app.getHttpServer()).post('/api/auth/otp/verify').send({ mobile, code: codes.get(mobile) }).expect(200);
    tokens.set(mobile, res.body.accessToken);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OtpSender)
      .useValue({ send: async (m: string, c: string) => void codes.set(m, c) })
      .compile();
    app = mod.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(() => app.close());

  it('rejects a wrong OTP', async () => {
    await request(app.getHttpServer()).post('/api/auth/otp/request').send({ mobile: '9848012345' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/otp/verify').send({ mobile: '9848012345', code: '000000' }).expect(401);
  });

  it('shop searches, adds best price, places; distributor accepts and bills', async () => {
    const shop = await login('9848012345');
    const auth = { Authorization: `Bearer ${shop}` };

    const search = await request(app.getHttpServer()).get('/api/catalog/search?q=dolo').set(auth).expect(200);
    const dolo = search.body[0];
    expect(dolo.product.name).toBe('Dolo 650');
    expect(dolo.best).toBeTruthy();

    // Typo tolerance
    const typo = await request(app.getHttpServer()).get('/api/catalog/search?q=azithrl').set(auth).expect(200);
    expect(typo.body[0].product.name).toBe('Azithral 500');

    // Out of stock everywhere -> substitutes
    const telma = await request(app.getHttpServer()).get('/api/catalog/search?q=telma 40').set(auth).expect(200);
    const t40 = telma.body.find((c: any) => c.product.name === 'Telma 40');
    expect(t40.best).toBeNull();
    expect(t40.substitutes.map((s: any) => s.name)).toContain('Telmikind 40');

    await request(app.getHttpServer()).put(`/api/shop/cart/${dolo.product.id}`).set(auth).send({ qty: 20 }).expect(200);
    const cart = await request(app.getHttpServer()).get('/api/shop/cart').set(auth).expect(200);
    expect(cart.body.itemCount).toBe(1);
    expect(cart.body.groups[0].distributorId).toBe(dolo.best.distributorId);

    const placed = await request(app.getHttpServer()).post('/api/shop/orders').set(auth).send({ timeToPlaceSec: 18 }).expect(201);
    const order = placed.body.orders[0];
    expect(order.number).toMatch(/^ML-\d+$/);

    // Seed distributor logins: SVP 9876500001, LMA 9876500002, DHD 9876500003
    const mobileFor: Record<string, [string, string]> = {
      'Sri Venkateswara Pharma Distributors': ['9876500001', 'SVP'],
      'Lakshmi Medical Agencies': ['9876500002', 'LMA'],
      'Deccan Health Distributors': ['9876500003', 'DHD'],
    };
    const [distMobile, code] = mobileFor[order.distributorName];
    const dist = await login(distMobile);
    const dAuth = { Authorization: `Bearer ${dist}` };
    await request(app.getHttpServer()).post(`/api/distributor/orders/${order.id}/accept`).set(dAuth).expect(201);
    const billed = await request(app.getHttpServer()).post(`/api/distributor/orders/${order.id}/bill`).set(dAuth).send({}).expect(201);
    expect(billed.body.invoiceNo).toMatch(new RegExp(`^${code}/`));

    // Shop sees it; cannot cancel a billed order
    await request(app.getHttpServer()).post(`/api/shop/orders/${order.id}/cancel`).set(auth).expect(409);
  });

  it('admin sees users, suspends one (login blocked), reactivates', async () => {
    const admin = await login('9000000001');
    const a = { Authorization: `Bearer ${admin}` };
    const list = await request(app.getHttpServer()).get('/api/admin/users?q=Salma').set(a).expect(200);
    const salma = list.body.find((u: any) => u.mobile === '9848012346');
    expect(salma.role).toBe('RETAILER_STAFF');
    expect(salma.business.name).toBe('Annapurna Medical & General Stores');

    await request(app.getHttpServer()).post(`/api/admin/users/${salma.id}/status`).set(a).send({ status: 'SUSPENDED', reason: 'Left the shop' }).expect(201);
    await request(app.getHttpServer()).post('/api/auth/otp/request').send({ mobile: '9848012346' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/otp/verify').send({ mobile: '9848012346', code: codes.get('9848012346') }).expect(401);

    const detail = await request(app.getHttpServer()).get(`/api/admin/users/${salma.id}`).set(a).expect(200);
    expect(detail.body.activity.map((x: any) => x.action)).toEqual(expect.arrayContaining(['user.suspend', 'auth.login_blocked']));
    expect(detail.body.canDo).toContain('Cannot place orders');

    await request(app.getHttpServer()).post(`/api/admin/users/${salma.id}/status`).set(a).send({ status: 'ACTIVE', reason: 'Back at work' }).expect(201);
    // A shop user cannot be made a distributor admin
    await request(app.getHttpServer()).post(`/api/admin/users/${salma.id}/role`).set(a).send({ role: 'DISTRIBUTOR_ADMIN' }).expect(400);
    // Non-admins cannot see the users list
    const shop = await login('9848012345');
    await request(app.getHttpServer()).get('/api/admin/users').set({ Authorization: `Bearer ${shop}` }).expect(403);
  });

  it('a double tap or retry with the same key never creates a second order', async () => {
    const shop = await login('9848012345');
    const auth = { Authorization: `Bearer ${shop}` };
    const search = await request(app.getHttpServer()).get('/api/catalog/search?q=okacet').set(auth).expect(200);
    await request(app.getHttpServer()).put(`/api/shop/cart/${search.body[0].product.id}`).set(auth).send({ qty: 10 }).expect(200);
    const key = 'retry-test-key-0001';
    const first = await request(app.getHttpServer()).post('/api/shop/orders').set(auth).set('Idempotency-Key', key).send({}).expect(201);
    const again = await request(app.getHttpServer()).post('/api/shop/orders').set(auth).set('Idempotency-Key', key).send({}).expect(201);
    expect(again.body.orders.map((o: any) => o.number)).toEqual(first.body.orders.map((o: any) => o.number));
    // Without the same key, an empty cart is refused (no phantom order)
    const empty = await request(app.getHttpServer()).post('/api/shop/orders').set(auth).set('Idempotency-Key', 'another-key-0002').send({}).expect(400);
    expect(empty.body.message).toBe('Your cart is empty');
    expect(empty.body.ref).toMatch(/^ML-[A-Z2-9]{5}$/);
  });

  it('every error carries a reference code and no technical details', async () => {
    const shop = await login('9848012345');
    const res = await request(app.getHttpServer()).get('/api/catalog/products/3f2b1c4d-8e9a-4b7c-9d1e-2a3b4c5d6e7f').set({ Authorization: `Bearer ${shop}` }).expect(404);
    expect(res.body).toEqual({ statusCode: 404, message: 'Medicine not found', ref: expect.stringMatching(/^ML-/) });
    expect(res.headers['x-request-ref']).toBe(res.body.ref);
  });

  it('maintenance mode shows a friendly message to shops but lets admins work', async () => {
    const admin = await login('9000000001');
    const shop = await login('9848012345');
    const a = { Authorization: `Bearer ${admin}` };
    const until = new Date(Date.now() + 3600_000).toISOString();
    await request(app.getHttpServer()).post('/api/admin/settings').set(a).send({ maintenance: { on: true, message: 'Upgrading tonight', until } }).expect(201);
    try {
      const blocked = await request(app.getHttpServer()).get('/api/shop/home').set({ Authorization: `Bearer ${shop}` }).expect(503);
      expect(blocked.body).toMatchObject({ maintenance: true, message: 'Upgrading tonight', until });
      await request(app.getHttpServer()).get('/api/admin/overview').set(a).expect(200);
      const status = await request(app.getHttpServer()).get('/api/public/status').expect(200);
      expect(status.body).toMatchObject({ ok: false, maintenance: { on: true } });
    } finally {
      await request(app.getHttpServer()).post('/api/admin/settings').set(a).send({ maintenance: { on: false, message: '', until: null } }).expect(201);
    }
    await request(app.getHttpServer()).get('/api/shop/home').set({ Authorization: `Bearer ${shop}` }).expect(200);
  });

  it('old phone apps are asked to update', async () => {
    const shop = await login('9848012345');
    const res = await request(app.getHttpServer()).get('/api/shop/home').set({ Authorization: `Bearer ${shop}`, 'X-App-Version': '0.0.1' }).expect(426);
    expect(res.body).toMatchObject({ updateRequired: true, minAppVersion: '0.1.0' });
    await request(app.getHttpServer()).get('/api/shop/home').set({ Authorization: `Bearer ${shop}`, 'X-App-Version': '0.1.0' }).expect(200);
  });

  it('blocks other distributors from touching the order', async () => {
    const shop = await login('9848012345');
    const list = await request(app.getHttpServer()).get('/api/shop/orders').set({ Authorization: `Bearer ${shop}` }).expect(200);
    // ML-10236 in the seed is billed by Deccan Health; Lakshmi Medical must not be able to dispatch it.
    const dhdOrder = list.body.find((o: any) => o.number === 'ML-10236');
    const other = await login('9876500002'); // Lakshmi Medical
    await request(app.getHttpServer()).post(`/api/distributor/orders/${dhdOrder.id}/dispatch`).set({ Authorization: `Bearer ${other}` }).expect(403);
  });
  // ---------------------------------------------------------------- flexible data
  const DOLO = 'dfe8c276-fb0c-5aa2-88d7-151d4065f2f9';
  const PAN40 = '1fe76230-ce98-5abe-a5c3-e16d20dcb418';

  it('finds medicines by other names, Telugu/Hindi script and any of their barcodes', async () => {
    const auth = { Authorization: `Bearer ${await login('9848012345')}` };
    for (const q of ['డోలో', 'डोलो', 'dolo650']) {
      const r = await request(app.getHttpServer()).get(`/api/catalog/search?q=${encodeURIComponent(q)}`).set(auth).expect(200);
      expect(r.body[0].product.name).toBe('Dolo 650');
    }
    const amox = await request(app.getHttpServer()).get('/api/catalog/search?q=amoxyclav').set(auth).expect(200);
    expect(amox.body[0].product.name).toBe('Augmentin 625 Duo');
    for (const code of ['2000000000011', '2000000000028']) {
      const r = await request(app.getHttpServer()).get(`/api/catalog/barcode/${code}`).set(auth).expect(200);
      expect(r.body.product.id).toBe(DOLO);
    }
  });

  it('admin adds and removes another name; the change history records who did it', async () => {
    const admin = { Authorization: `Bearer ${await login('9000000001')}` };
    const shop = { Authorization: `Bearer ${await login('9848012345')}` };
    const added = await request(app.getHttpServer()).post(`/api/admin/products/${PAN40}/aliases`).set(admin).send({ alias: '  Pantop  Forty ' }).expect(201);
    const a = added.body.find((x: any) => x.alias === 'pantop forty');
    expect(a).toBeTruthy();
    await request(app.getHttpServer()).post(`/api/admin/products/${PAN40}/aliases`).set(admin).send({ alias: 'pantop forty' }).expect(409);
    const found = await request(app.getHttpServer()).get('/api/catalog/search?q=pantop forty').set(shop).expect(200);
    expect(found.body[0].product.id).toBe(PAN40);
    await request(app.getHttpServer()).delete(`/api/admin/products/${PAN40}/aliases/${a.id}`).set(admin).expect(200);

    // Barcode already used by another medicine is refused with a clear reason
    const taken = await request(app.getHttpServer()).post(`/api/admin/products/${PAN40}/barcodes`).set(admin).send({ code: '2000000000011' }).expect(409);
    expect(taken.body.message).toContain('Dolo 650');

    const detail = await request(app.getHttpServer()).get(`/api/admin/products/${PAN40}`).set(admin).expect(200);
    const aliasEvents = detail.body.history.filter((h: any) => h.table === 'ProductAlias');
    expect(aliasEvents.map((h: any) => h.op)).toEqual(expect.arrayContaining(['INSERT', 'DELETE']));
    expect(aliasEvents[0].actor).toBe('Platform Admin');
  });

  it('a recalled medicine cannot be added or ordered, and shops see why', async () => {
    const admin = { Authorization: `Bearer ${await login('9000000001')}` };
    const shop = { Authorization: `Bearer ${await login('9848012345')}` };
    await request(app.getHttpServer()).post(`/api/admin/products/${PAN40}/status`).set(admin).send({ status: 'RECALLED' }).expect(400); // note required
    try {
      await request(app.getHttpServer()).post(`/api/admin/products/${PAN40}/status`).set(admin).send({ status: 'RECALLED', note: 'Test recall notice R-1.' }).expect(201);
      const s = await request(app.getHttpServer()).get('/api/catalog/search?q=pan 40').set(shop).expect(200);
      const card = s.body.find((c: any) => c.product.id === PAN40);
      expect(card.blocked).toMatch(/recalled.*R-1/);
      expect(card.best).toBeNull();
      expect(card.offers).toHaveLength(0);
      expect(card.substitutes.map((x: any) => x.name)).toContain('Pantocid 40');
      const add = await request(app.getHttpServer()).put(`/api/shop/cart/${PAN40}`).set(shop).send({ qty: 5 }).expect(409);
      expect(add.body.message).toMatch(/recalled/);
    } finally {
      await request(app.getHttpServer()).post(`/api/admin/products/${PAN40}/status`).set(admin).send({ status: 'ACTIVE' }).expect(201);
    }
    await request(app.getHttpServer()).put(`/api/shop/cart/${PAN40}`).set(shop).send({ qty: 5 }).expect(200);
    await request(app.getHttpServer()).delete(`/api/shop/cart/${PAN40}`).set(shop).expect(200);
  });

  it('a shop with an expired licence cannot order until the renewal is recorded', async () => {
    const admin = { Authorization: `Bearer ${await login('9000000001')}` };
    const krishna = { Authorization: `Bearer ${await login('9848044444')}` }; // licence expired 5 days ago (seed)
    const sai = { Authorization: `Bearer ${await login('9848022222')}` }; // expires in 20 days

    const home = await request(app.getHttpServer()).get('/api/shop/home').set(krishna).expect(200);
    expect(home.body.shop.canOrder).toBe(false);
    expect(home.body.shop.licence.state).toBe('expired');
    expect(home.body.shop.licence.message).toMatch(/expired on/);

    const soon = await request(app.getHttpServer()).get('/api/shop/home').set(sai).expect(200);
    expect(soon.body.shop.canOrder).toBe(true);
    expect(soon.body.shop.licence).toMatchObject({ state: 'expiring', daysLeft: 20, which: '20B' });

    const dolo = await request(app.getHttpServer()).get('/api/catalog/search?q=dolo').set(krishna).expect(200);
    if (dolo.body[0].best) await request(app.getHttpServer()).put(`/api/shop/cart/${DOLO}`).set(krishna).send({ qty: 10 }).expect(200);
    const blocked = await request(app.getHttpServer()).post('/api/shop/orders').set(krishna).send({ source: 'WEB' }).expect(403);
    expect(blocked.body).toMatchObject({ licenceExpired: true });

    const alerts = await request(app.getHttpServer()).get('/api/admin/licences').set(admin).expect(200);
    const names = alerts.body.map((a: any) => a.name);
    expect(names).toEqual(expect.arrayContaining(['Krishna Medical Hall', 'Sri Sai Medicals', 'Sai Krishna Pharma']));
    const k = alerts.body.find((a: any) => a.name === 'Krishna Medical Hall');
    await request(app.getHttpServer()).post(`/api/admin/licences/shop/${k.id}`).set(admin).send({ dl20bExpiry: '2020-01-01' }).expect(400);
    await request(app.getHttpServer()).post(`/api/admin/licences/shop/${k.id}`).set(admin).send({ dl20bExpiry: '2029-03-31', dl21bExpiry: '2029-03-31' }).expect(201);
    const after = await request(app.getHttpServer()).get('/api/shop/home').set(krishna).expect(200);
    expect(after.body.shop.canOrder).toBe(true);
    await request(app.getHttpServer()).delete(`/api/shop/cart/${DOLO}`).set(krishna).expect(200);
  });

  it('admin adds a custom field without code changes; values are checked', async () => {
    const admin = { Authorization: `Bearer ${await login('9000000001')}` };
    const fields = await request(app.getHttpServer()).get('/api/admin/fields?entity=PRODUCT').set(admin).expect(200);
    expect(fields.body.map((f: any) => f.key)).toContain('storage');

    const f = await request(app.getHttpServer()).post('/api/admin/fields').set(admin).send({ entity: 'PRODUCT', label: 'Pack weight (g)', type: 'NUMBER' }).expect(201);
    expect(f.body.key).toBe('pack_weight_g');
    await request(app.getHttpServer()).post('/api/admin/fields').set(admin).send({ entity: 'PRODUCT', label: 'Pack weight (g)', type: 'TEXT' }).expect(409);
    await request(app.getHttpServer()).post('/api/admin/fields').set(admin).send({ entity: 'PRODUCT', label: 'Colour', type: 'CHOICE', options: [] }).expect(400);

    const bad = await request(app.getHttpServer()).put(`/api/admin/extra/product/${PAN40}`).set(admin).send({ values: { pack_weight_g: 'heavy', storage: 'Freezer' } }).expect(400);
    expect(bad.body.errors).toHaveLength(2);
    const ok = await request(app.getHttpServer()).put(`/api/admin/extra/product/${PAN40}`).set(admin).send({ values: { pack_weight_g: '12.5', storage: 'fridge (2–8 °c)' } }).expect(200);
    expect(ok.body).toEqual({ pack_weight_g: 12.5, storage: 'Fridge (2–8 °C)' });

    await request(app.getHttpServer()).patch(`/api/admin/fields/${f.body.id}`).set(admin).send({ active: false }).expect(200);
    const detail = await request(app.getHttpServer()).get(`/api/admin/products/${PAN40}`).set(admin).expect(200);
    expect(detail.body.product.extra.pack_weight_g).toBe(12.5); // switching a field off never loses data
  });

  it('batch-wise stock from the billing software sets the nearest expiry', async () => {
    const admin = { Authorization: `Bearer ${await login('9000000001')}` };
    const SKP = '3b27d4bb-05c1-5e54-9d98-46babf13c18c';
    const { body } = await request(app.getHttpServer()).post(`/api/admin/distributors/${SKP}/agent-key`).set(admin).send({ software: 'CSV' }).expect(201);
    const push = (items: unknown[]) => {
      const raw = JSON.stringify({ items });
      const ts = String(Date.now());
      return request(app.getHttpServer())
        .post('/api/sync/stock')
        .set({ Authorization: `Bearer ${body.key}`, 'X-Timestamp': ts, 'X-Signature': signBody(body.key, ts, raw), 'content-type': 'application/json' })
        .send(raw);
    };
    const row = { externalCode: 'SKP-T1', name: 'DOLO 650 TAB 15S', stockQty: 0, ptr: 24, barcode: '2000000000028' };
    await push([{ ...row, batches: [ { batchNo: 'B1', expiry: '2027-09', qty: 5 }, { batchNo: 'B2', expiry: '2027-03-15', qty: 0 }, { batchNo: 'B3', expiry: '2027-05-01', qty: 3 } ] }]).expect(200);
    const stockOf = async () => (await request(app.getHttpServer()).get(`/api/admin/products/${DOLO}`).set(admin).expect(200)).body.stock.find((s: any) => s.externalCode === 'SKP-T1');
    let s = await stockOf();
    expect(s.nearestExpiry.slice(0, 10)).toBe('2027-05-01'); // B2 has no stock, so it does not count
    expect(s.batches).toHaveLength(3);

    await push([{ ...row, batches: [{ batchNo: 'B1', expiry: '2027-09', qty: 5 }] }]).expect(200); // B2, B3 sold out and gone
    s = await stockOf();
    expect(s.nearestExpiry.slice(0, 10)).toBe('2027-09-01');
    expect(s.batches.map((b: any) => b.batchNo)).toEqual(['B1']);
  });
});
