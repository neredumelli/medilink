import { createHmac } from 'node:crypto';

/** Same signature the API checks: hex HMAC-SHA256(key, `${timestamp}.${rawBody}`). */
export function sign(key, timestamp, rawBody) {
  return createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('hex');
}

export class ApiClient {
  /** @param {{ apiUrl: string, key: string, timeoutMs?: number }} cfg */
  constructor(cfg, fetchImpl = globalThis.fetch) {
    this.base = cfg.apiUrl.replace(/\/$/, '');
    this.key = cfg.key;
    this.timeoutMs = cfg.timeoutMs ?? 30_000;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const ts = String(Date.now());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.key}`,
          'x-timestamp': ts,
          'x-signature': sign(this.key, ts, raw),
          ...(raw ? { 'content-type': 'application/json' } : {}),
        },
        body: raw || undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const err = new Error(`${method} ${path} -> ${res.status}: ${data?.message ?? text}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  heartbeat(version) {
    return this.request('POST', '/sync/heartbeat', { version });
  }
  pushStock(items) {
    return this.request('POST', '/sync/stock', { items });
  }
  pendingOrders() {
    return this.request('GET', '/sync/orders/pending');
  }
  ack(number, erpRef) {
    return this.request('POST', `/sync/orders/${encodeURIComponent(number)}/ack`, { erpRef });
  }
  billed(number, invoiceNo, lines) {
    return this.request('POST', `/sync/orders/${encodeURIComponent(number)}/billed`, { invoiceNo, lines });
  }
  outstanding(rows) {
    return this.request('POST', '/sync/outstanding', { rows });
  }
}
