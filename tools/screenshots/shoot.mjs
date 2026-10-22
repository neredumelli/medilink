/**
 * Captures real screenshots of MediLink running with the Hyderabad demo data.
 * Needs: web on BASE_URL, API log file (OTP codes are printed there in development) at API_LOG.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const LOG = process.env.API_LOG ?? 'api.log';
const OUT = process.env.OUT_DIR ?? 'out';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const otpCount = (m) => [...fs.readFileSync(LOG, 'utf8').matchAll(new RegExp(`OTP for ${m}: (\\d{6})`, 'g'))];

async function waitForNewOtp(mobile, before) {
  for (let i = 0; i < 60; i++) {
    const all = otpCount(mobile);
    if (all.length > before) return all[all.length - 1][1];
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No OTP for ${mobile} in ${LOG}`);
}

async function shot(page, name, title, opts = {}) {
  await page.waitForTimeout(opts.wait ?? 700);
  if (opts.fullPage) {
    // Floating bars and pop-ups land mid-image on full-page captures: pin them in normal flow and hide toasts.
    await page.addStyleTag({ content: '.cartbar,.bnav,.topnav,.rolebar{position:static!important}.toast{display:none!important}' }).catch(() => {});
    await page.waitForTimeout(200);
  }
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  results.push({ name, title, file: `${name}.png` });
  console.log('captured', name);
}

async function step(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`STEP FAILED: ${label}: ${e.message.split('\n')[0]}`);
  }
}

async function login(page, mobile, shots) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('#mobile');
  await page.fill('#mobile', mobile);
  if (shots) await shot(page, shots[0], 'Login: mobile number, no password');
  const before = otpCount(mobile).length;
  await page.getByRole('button', { name: /send otp/i }).click();
  const code = await waitForNewOtp(mobile, before);
  await page.waitForSelector('#otp');
  await page.fill('#otp', code);
  if (shots) await shot(page, shots[1], 'Login: 6-digit OTP');
  await page.getByRole('button', { name: /verify/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');
}

const browser = await chromium.launch();

// ---------------- Shop (phone size) ----------------
const phone = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2, locale: 'en-IN' });
const shop = await phone.newPage();
await step('shop login', () => login(shop, '9848012345', ['01-login', '02-otp']));
await step('shop home', async () => {
  await shop.waitForSelector('.tiles');
  await shot(shop, '03-shop-home', 'Shop home: greeting, today status, search, quick tiles, usual items', { wait: 1200 });
});
await step('search', async () => {
  await shop.fill('#q', 'dolo');
  await shop.waitForSelector('.bestbox', { timeout: 15000 });
  await shot(shop, '04-search-best-price', 'Search: best price after scheme, stock, delivery', { wait: 900 });
  await shop.locator('.cmpbtn').first().click();
  await shot(shop, '05-compare-distributors', 'Compare all linked distributors in one tap', { fullPage: true });
});
await step('typo', async () => {
  await shop.fill('#q', 'azithrl');
  await shop.waitForSelector('.pc-name', { timeout: 15000 });
  await shot(shop, '06-typo-search', 'Spelling mistakes are fine ("azithrl")', { wait: 900 });
});
await step('substitute', async () => {
  await shop.fill('#q', 'telma 40');
  await shop.waitForSelector('.note', { timeout: 15000 });
  await shot(shop, '07-out-of-stock-substitute', 'Out of stock everywhere: same-salt substitutes', { wait: 900 });
});
await step('add to cart', async () => {
  await shop.fill('#q', 'dolo');
  await shop.waitForSelector('.addbtn');
  await shop.locator('.addbtn').first().click();
  await shop.waitForSelector('.cartbar', { timeout: 15000 });
  await shot(shop, '08-added-to-cart', 'Added: confirmation and cart bar', { wait: 600 });
});
await step('paste list', async () => {
  await shop.fill('#q', '');
  await shop.locator('.tile.c-sun').click();
  await shop.fill('#pasteText', 'Dolo 650 - 20\nPan 40 x 10\nazithral 5\nmontair lc 10 strips\nshelcal 15');
  await shop.getByRole('button', { name: /read my list/i }).click();
  await shop.waitForSelector('.prow', { timeout: 15000 });
  await shot(shop, '09-paste-whatsapp-list', 'Paste a WhatsApp list: read and matched automatically', { fullPage: true });
  await shop.getByRole('button', { name: /items at best price/i }).click();
  await shop.waitForURL('**/shop/cart', { timeout: 20000 });
});
await step('cart', async () => {
  await shop.waitForSelector('.creditbar', { timeout: 15000 });
  await shot(shop, '10-cart-split-by-distributor', 'Cart: split per distributor with credit check', { fullPage: true, wait: 1200 });
});
await step('place order', async () => {
  const btn = shop.getByRole('button', { name: /place orders/i });
  if (await btn.isEnabled()) {
    await btn.click();
    await shop.waitForURL('**/shop/orders', { timeout: 20000 });
    await shop.waitForSelector('.success', { timeout: 15000 });
    await shot(shop, '11-order-success', 'Orders sent: success screen with time taken', { wait: 1000 });
  } else {
    await shot(shop, '11-order-blocked-credit', 'Over credit: order blocked with a clear fix', { fullPage: true });
  }
});
await step('orders', async () => {
  await shop.goto(`${BASE}/shop/orders`);
  await shop.waitForSelector('.track', { timeout: 15000 });
  await shot(shop, '12-order-tracking', 'Order tracking, part supply and "get the rest"', { fullPage: true, wait: 1000 });
});
await step('shortage list', async () => {
  await shop.goto(`${BASE}/shop/list`);
  await shop.waitForSelector('.line', { timeout: 15000 });
  await shot(shop, '13-shortage-list', 'Shared shortage list: staff add, owner orders all');
});
await step('account', async () => {
  await shop.goto(`${BASE}/shop/account`);
  await shop.waitForSelector('.dl-item', { timeout: 15000 });
  await shot(shop, '14-account-distributors', 'Account: distributors, dues, credit, link requests', { fullPage: true });
});
await step('telugu', async () => {
  await shop.goto(`${BASE}/shop`);
  await shop.waitForSelector('.tiles');
  await shop.getByRole('button', { name: 'తె' }).click();
  await shot(shop, '15-shop-home-telugu', 'Same screen in Telugu (one tap)', { wait: 1200 });
  await shop.getByRole('button', { name: 'EN' }).click();
});

// ---------------- Distributor (desktop) ----------------
const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1.5, locale: 'en-IN' });
const dist = await desk.newPage();
await step('distributor login', () => login(dist, '9876500001'));
await step('distributor lanes', async () => {
  await dist.waitForSelector('.lanes', { timeout: 15000 });
  await shot(dist, '16-distributor-order-lanes', 'Distributor: order lanes New → To bill → To dispatch → On the way', { fullPage: true, wait: 1200 });
  const accept = dist.getByRole('button', { name: /^accept$/i }).first();
  if (await accept.count()) {
    await accept.click();
    await dist.waitForTimeout(1500);
  }
  const bill = dist.getByRole('button', { name: /create bill/i }).first();
  if (await bill.count()) {
    await bill.click();
    await dist.waitForTimeout(1500);
  }
  await shot(dist, '17-distributor-after-billing', 'After accept + bill: order moves lanes, bill number created', { fullPage: true });
});

// ---------------- Admin (desktop) ----------------
const adm = await desk.newPage();
await step('admin login', () => login(adm, '9000000001'));
await step('admin overview', async () => {
  await adm.waitForSelector('.kpis', { timeout: 15000 });
  await shot(adm, '18-admin-overview', 'Admin: KPIs, approvals with GSTIN check, sync health, activity', { fullPage: true, wait: 1200 });
});
await step('admin users', async () => {
  await adm.goto(`${BASE}/admin/users`);
  await adm.waitForSelector('table tbody tr', { timeout: 15000 });
  await adm.locator('table tbody tr').filter({ hasText: 'Salma' }).first().click();
  await adm.waitForSelector('.audit', { timeout: 15000 });
  await shot(adm, '19-admin-users-access', 'Users & access: role in plain words, devices, activity, suspend', { fullPage: true, wait: 1000 });
});

// ---------------- Shop sees the update ----------------
await step('shop sees billed', async () => {
  await shop.goto(`${BASE}/shop/orders`);
  await shop.waitForSelector('.track', { timeout: 15000 });
  await shot(shop, '20-shop-sees-billed', 'Shop sees the order billed by the distributor', { wait: 1000 });
});

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(results, null, 2));
await browser.close();
console.log(`Done: ${results.length} screenshots`);
if (results.length < 10) process.exit(1);
