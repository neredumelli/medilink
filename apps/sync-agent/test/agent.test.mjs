import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsv, toRecords, num, normExpiry, writeCsv } from '../src/csv.mjs';
import { sign } from '../src/client.mjs';
import { Agent } from '../src/agent.mjs';

test('CSV: quotes, commas, BOM, blank lines', () => {
  const rows = parseCsv('﻿Item Code,Item Name,Stock\r\nSVP1001,"DOLO 650, 15S",300\r\n\r\nSVP1002,"PAN ""40""",0\n');
  assert.deepEqual(rows, [
    ['Item Code', 'Item Name', 'Stock'],
    ['SVP1001', 'DOLO 650, 15S', '300'],
    ['SVP1002', 'PAN "40"', '0'],
  ]);
  assert.equal(toRecords(rows)[0]['item name'], 'DOLO 650, 15S');
  assert.equal(parseCsv(writeCsv(['a', 'b'], [['x,y', 'q"q']])).at(1)[0], 'x,y');
});

test('numbers and expiry formats from Indian billing exports', () => {
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num('₹ 24'), 24);
  assert.equal(num(''), undefined);
  assert.equal(normExpiry('03/27'), '2027-03-01');
  assert.equal(normExpiry('03/2027'), '2027-03-01');
  assert.equal(normExpiry('2027-03'), '2027-03-01');
  assert.equal(normExpiry('31-03-2027'), '2027-03-31');
  assert.equal(normExpiry('soon'), undefined);
});

/** A fake MediLink API that checks signatures exactly like apps/api/src/sync/agent.guard.ts. */
function fakeApi(key) {
  const seen = { stock: [], acks: [], billed: [], outstanding: [], badSig: 0 };
  const pending = [
    { number: 'ML-10241', partyCode: 'SVP-0001', shopName: 'Annapurna Medical & General Stores', lines: [{ externalCode: 'SVP1001', name: 'DOLO 650 15S', qty: 20, freeQty: 2, rate: 23.5 }] },
  ];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const ts = req.headers['x-timestamp'];
    const expected = Buffer.from(createHmac('sha256', key).update(`${ts}.${raw}`).digest('hex'), 'hex');
    const given = Buffer.from(String(req.headers['x-signature'] ?? ''), 'hex');
    if (req.headers.authorization !== `Bearer ${key}` || expected.length !== given.length || !timingSafeEqual(expected, given)) {
      seen.badSig++;
      res.writeHead(401).end('{"message":"Bad signature"}');
      return;
    }
    const body = raw ? JSON.parse(raw) : null;
    const send = (o) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
    if (req.url === '/api/sync/heartbeat') return send({ ok: true });
    if (req.url === '/api/sync/stock') return seen.stock.push(...body.items), send({ updated: body.items.length });
    if (req.url === '/api/sync/orders/pending') return send(pending.splice(0));
    if (req.url.endsWith('/ack')) return seen.acks.push([req.url, body.erpRef]), send({ ok: true });
    if (req.url.endsWith('/billed')) return seen.billed.push([req.url, body]), send({ ok: true });
    if (req.url === '/api/sync/outstanding') return seen.outstanding.push(...body.rows), send({ matched: body.rows.length });
    res.writeHead(404).end('{}');
  });
  return { server, seen };
}

test('a full sync cycle moves stock, orders, bills and dues', async () => {
  const key = 'mlk_svp_test_key_123';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mlagent-'));
  const csv = {
    stockFile: path.join(dir, 'stock.csv'),
    outstandingFile: path.join(dir, 'outstanding.csv'),
    ordersOutDir: path.join(dir, 'orders'),
    billsInDir: path.join(dir, 'bills'),
  };
  await fs.writeFile(csv.stockFile, 'Item Code,Item Name,Stock,PTR,MRP,Discount %,Scheme,Expiry\nSVP1001,DOLO 650 15S,300,24.00,33.60,2,10+1,03/27\nBAD,,5,1,1,,,\n');
  await fs.writeFile(csv.outstandingFile, 'Party Code,Outstanding\nSVP-0001,"62,000.00"\n');
  await fs.mkdir(csv.billsInDir, { recursive: true });
  await fs.writeFile(path.join(csv.billsInDir, 'bill-1838.csv'), 'MediLink Order,Invoice No,Item Code,Billed Qty\nML-10236,SVP/26-27/1838,SVP1011,4\n');

  const { server, seen } = fakeApi(key);
  await new Promise((r) => server.listen(0, r));
  const apiUrl = `http://127.0.0.1:${server.address().port}/api`;
  const quiet = { info() {}, warn() {}, error() {} };
  try {
    const agent = new Agent({ apiUrl, key, stateFile: path.join(dir, 'state.json'), csv }, { log: quiet });
    const r = await agent.cycle();
    assert.equal(seen.badSig, 0, 'every request is signed correctly');
    assert.deepEqual(r, { heartbeat: true, stock: { sent: 1, skipped: 1 }, orders: 1, bills: 1, billErrors: 0, outstanding: { matched: 1 } });
    assert.deepEqual(seen.stock[0], { externalCode: 'SVP1001', name: 'DOLO 650 15S', stockQty: 300, ptr: 24, mrp: 33.6, discountPct: 2, scheme: '10+1', nearestExpiry: '2027-03-01' });

    const written = await fs.readFile(path.join(csv.ordersOutDir, 'ML-10241.csv'), 'utf8');
    assert.match(written, /ML-10241,SVP-0001,Annapurna Medical & General Stores,SVP1001,DOLO 650 15S,20,2,23.50/);
    assert.deepEqual(seen.acks, [['/api/sync/orders/ML-10241/ack', 'ML-10241.csv']]);
    assert.deepEqual(seen.billed[0][1], { invoiceNo: 'SVP/26-27/1838', lines: [{ externalCode: 'SVP1011', billedQty: 4 }] });
    assert.deepEqual(await fs.readdir(csv.billsInDir), ['done'], 'processed bill file is archived');
    assert.deepEqual(seen.outstanding, [{ partyCode: 'SVP-0001', outstanding: 62000 }]);

    // Second cycle: nothing changed, so stock and dues are not re-sent.
    const r2 = await agent.cycle();
    assert.equal(r2.stock, null);
    assert.equal(r2.outstanding, null);
    assert.equal(seen.stock.length, 1);
  } finally {
    server.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('signature format matches the API guard', () => {
  const key = 'mlk_abc';
  assert.equal(sign(key, '1700000000000', '{"a":1}'), createHmac('sha256', key).update('1700000000000.{"a":1}').digest('hex'));
});
