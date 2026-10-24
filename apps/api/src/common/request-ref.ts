import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I: easy to read out on the phone

/** Short reference such as "ML-7F3K2" that users can read to support. */
export function newRef(): string {
  const b = randomBytes(5);
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[b[i]! % ALPHABET.length];
  return `ML-${s}`;
}

/** Requests slower than this are written to the log, so slow screens are found and fixed. */
export const SLOW_REQUEST_MS = 300;

/**
 * Gives every request a reference (X-Request-Ref header and error bodies) and measures it:
 * the time is sent in a Server-Timing header (visible in the browser's network panel) and slow ones are logged.
 */
@Injectable()
export class RequestRefMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Slow');

  use(req: any, res: any, next: () => void) {
    req.ref = newRef();
    res.setHeader('X-Request-Ref', req.ref);
    const start = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - start) / 1e6;
    const writeHead = res.writeHead;
    res.writeHead = function (...args: unknown[]) {
      if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${ms().toFixed(1)}`);
      return writeHead.apply(this, args);
    };
    res.on('finish', () => {
      const t = ms();
      if (t > SLOW_REQUEST_MS) this.logger.warn(`${req.ref} ${req.method} ${req.originalUrl ?? req.url} took ${Math.round(t)} ms`);
    });
    next();
  }
}
