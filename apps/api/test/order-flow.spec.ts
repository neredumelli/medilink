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

  it('blocks other distributors from touching the order', async () => {
    const shop = await login('9848012345');
    const list = await request(app.getHttpServer()).get('/api/shop/orders').set({ Authorization: `Bearer ${shop}` }).expect(200);
    // ML-10236 in the seed is billed by Deccan Health; Lakshmi Medical must not be able to dispatch it.
    const dhdOrder = list.body.find((o: any) => o.number === 'ML-10236');
    const other = await login('9876500002'); // Lakshmi Medical
    await request(app.getHttpServer()).post(`/api/distributor/orders/${dhdOrder.id}/dispatch`).set({ Authorization: `Bearer ${other}` }).expect(403);
  });
});
