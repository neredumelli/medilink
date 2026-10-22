import { promises as fs } from 'node:fs';
import path from 'node:path';
import { num, normExpiry, parseCsv, toRecords, writeCsv } from '../csv.mjs';

/**
 * Works with any billing software that can export/import CSV (Marg, Busy, GoFrugal and Tally all can):
 *  - stockFile:        exported by the billing software on a schedule (item code, name, stock, PTR, MRP, scheme, expiry)
 *  - outstandingFile:  party-wise dues export
 *  - ordersOutDir:     we write one CSV per MediLink order here; the billing software imports them as sales orders
 *  - billsInDir:       the billing software (or a small macro) drops a CSV per bill: order no, invoice no, item code, billed qty
 * Column names are configurable because every export looks a little different.
 */
export const DEFAULT_COLUMNS = {
  stock: { code: 'item code', name: 'item name', qty: 'stock', ptr: 'ptr', mrp: 'mrp', discount: 'discount %', scheme: 'scheme', expiry: 'expiry', barcode: 'barcode' },
  outstanding: { party: 'party code', amount: 'outstanding' },
  bill: { order: 'medilink order', invoice: 'invoice no', code: 'item code', qty: 'billed qty' },
};

export class CsvAdapter {
  constructor(cfg) {
    this.cfg = cfg;
    this.cols = {
      stock: { ...DEFAULT_COLUMNS.stock, ...(cfg.columns?.stock ?? {}) },
      outstanding: { ...DEFAULT_COLUMNS.outstanding, ...(cfg.columns?.outstanding ?? {}) },
      bill: { ...DEFAULT_COLUMNS.bill, ...(cfg.columns?.bill ?? {}) },
    };
  }

  async fileMtime(file) {
    try {
      return (await fs.stat(file)).mtimeMs;
    } catch {
      return null;
    }
  }

  /** @returns {Promise<{ items: object[], skipped: number }>} */
  async readStock() {
    const c = this.cols.stock;
    const recs = toRecords(parseCsv(await fs.readFile(this.cfg.stockFile, 'utf8')));
    const items = [];
    let skipped = 0;
    for (const r of recs) {
      const code = r[c.code];
      const name = r[c.name];
      const ptr = num(r[c.ptr]);
      const qty = num(r[c.qty]);
      if (!code || !name || ptr === undefined || qty === undefined) {
        skipped++;
        continue;
      }
      const item = { externalCode: code.slice(0, 40), name: name.slice(0, 120), stockQty: Math.max(0, Math.floor(qty)), ptr };
      const mrp = num(r[c.mrp]);
      if (mrp !== undefined) item.mrp = mrp;
      const d = num(r[c.discount]);
      if (d !== undefined) item.discountPct = Math.min(100, Math.max(0, d));
      if (r[c.scheme] && /\d+\s*\+\s*\d+/.test(r[c.scheme])) item.scheme = r[c.scheme].match(/\d+\s*\+\s*\d+/)[0].replace(/\s/g, '');
      const exp = normExpiry(r[c.expiry]);
      if (exp) item.nearestExpiry = exp;
      if (r[c.barcode] && /^\d{8,14}$/.test(r[c.barcode])) item.barcode = r[c.barcode];
      items.push(item);
    }
    return { items, skipped };
  }

  async readOutstanding() {
    if (!this.cfg.outstandingFile) return [];
    const c = this.cols.outstanding;
    try {
      const recs = toRecords(parseCsv(await fs.readFile(this.cfg.outstandingFile, 'utf8')));
      return recs.map((r) => ({ partyCode: r[c.party], outstanding: num(r[c.amount]) ?? 0 })).filter((r) => r.partyCode);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  /** Writes the order for the billing software to import. Returns the reference to send back (file name). */
  async writeOrder(order) {
    await fs.mkdir(this.cfg.ordersOutDir, { recursive: true });
    const file = path.join(this.cfg.ordersOutDir, `${order.number}.csv`);
    const tmp = `${file}.tmp`;
    const rows = order.lines.map((l) => [order.number, order.partyCode ?? '', order.shopName, l.externalCode, l.name, l.qty, l.freeQty, l.rate.toFixed(2)]);
    await fs.writeFile(tmp, writeCsv(['MediLink Order', 'Party Code', 'Shop', 'Item Code', 'Item Name', 'Qty', 'Free', 'Rate'], rows), 'utf8');
    await fs.rename(tmp, file); // atomic: the billing software never sees a half-written file
    return path.basename(file);
  }

  /** Bills dropped by the billing software. Each is { file, number, invoiceNo, lines }. */
  async readBills() {
    const dir = this.cfg.billsInDir;
    let names = [];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.csv'));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const c = this.cols.bill;
    const bills = [];
    for (const name of names) {
      const recs = toRecords(parseCsv(await fs.readFile(path.join(dir, name), 'utf8')));
      const byOrder = new Map();
      for (const r of recs) {
        const number = r[c.order];
        if (!number) continue;
        const b = byOrder.get(number) ?? { file: name, number, invoiceNo: r[c.invoice], lines: [] };
        b.lines.push({ externalCode: r[c.code], billedQty: Math.max(0, Math.floor(num(r[c.qty]) ?? 0)) });
        byOrder.set(number, b);
      }
      bills.push(...byOrder.values());
    }
    return bills;
  }

  async archiveBill(file) {
    const done = path.join(this.cfg.billsInDir, 'done');
    await fs.mkdir(done, { recursive: true });
    await fs.rename(path.join(this.cfg.billsInDir, file), path.join(done, `${Date.now()}-${file}`));
  }
}
