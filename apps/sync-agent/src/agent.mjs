import { promises as fs } from 'node:fs';
import { ApiClient } from './client.mjs';
import { CsvAdapter } from './adapters/csv.mjs';

export const VERSION = '1.0.0';
const STOCK_BATCH = 2000;

/**
 * One sync cycle. Every step is independent: if the internet drops in the middle,
 * nothing is lost and the next cycle picks up where this one stopped.
 *  1. heartbeat
 *  2. stock (only when the export file changed, or every `fullStockMinutes`)
 *  3. new orders -> billing software, then acknowledge
 *  4. bills from billing software -> MediLink (file archived only after the server accepts it)
 *  5. dues per shop
 */
export class Agent {
  constructor(cfg, { client, adapter, log = console, now = () => Date.now() } = {}) {
    this.cfg = cfg;
    this.client = client ?? new ApiClient(cfg);
    this.adapter = adapter ?? new CsvAdapter(cfg.csv);
    this.log = log;
    this.now = now;
    this.state = { stockMtime: null, lastFullStock: 0, outstandingMtime: null };
  }

  async loadState() {
    try {
      this.state = { ...this.state, ...JSON.parse(await fs.readFile(this.cfg.stateFile, 'utf8')) };
    } catch {
      /* first run */
    }
  }
  async saveState() {
    if (this.cfg.stateFile) await fs.writeFile(this.cfg.stateFile, JSON.stringify(this.state), 'utf8');
  }

  async cycle() {
    const report = { heartbeat: false, stock: null, orders: 0, bills: 0, billErrors: 0, outstanding: null };
    await this.client.heartbeat(VERSION);
    report.heartbeat = true;

    // 2. stock
    const mtime = await this.adapter.fileMtime(this.cfg.csv.stockFile);
    const fullDue = this.now() - this.state.lastFullStock > (this.cfg.fullStockMinutes ?? 60) * 60_000;
    if (mtime !== null && (mtime !== this.state.stockMtime || fullDue)) {
      const { items, skipped } = await this.adapter.readStock();
      let sent = 0;
      for (let i = 0; i < items.length; i += STOCK_BATCH) {
        await this.client.pushStock(items.slice(i, i + STOCK_BATCH));
        sent += Math.min(STOCK_BATCH, items.length - i);
      }
      this.state.stockMtime = mtime;
      this.state.lastFullStock = this.now();
      report.stock = { sent, skipped };
      if (skipped) this.log.warn(`${skipped} stock rows skipped (missing code, name, stock or PTR)`);
    }

    // 3. orders
    const pending = await this.client.pendingOrders();
    for (const order of pending) {
      const ref = await this.adapter.writeOrder(order);
      await this.client.ack(order.number, ref);
      report.orders++;
      this.log.info(`Order ${order.number} for ${order.shopName} written to ${ref}`);
    }

    // 4. bills
    for (const bill of await this.adapter.readBills()) {
      try {
        await this.client.billed(bill.number, bill.invoiceNo, bill.lines);
        await this.adapter.archiveBill(bill.file);
        report.bills++;
        this.log.info(`Bill ${bill.invoiceNo} sent for ${bill.number}`);
      } catch (e) {
        report.billErrors++;
        // 409 = already billed in MediLink (e.g. re-sent file): archive so it is not retried forever.
        if (e.status === 409 || e.status === 404) await this.adapter.archiveBill(bill.file);
        this.log.error(`Bill for ${bill.number} failed: ${e.message}`);
      }
    }

    // 5. dues
    const oMtime = this.cfg.csv.outstandingFile ? await this.adapter.fileMtime(this.cfg.csv.outstandingFile) : null;
    if (oMtime !== null && oMtime !== this.state.outstandingMtime) {
      const rows = await this.adapter.readOutstanding();
      if (rows.length) report.outstanding = await this.client.outstanding(rows);
      this.state.outstandingMtime = oMtime;
    }

    await this.saveState();
    return report;
  }
}
