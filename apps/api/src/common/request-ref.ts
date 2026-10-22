import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I: easy to read out on the phone

/** Short reference such as "ML-7F3K2" that users can read to support. */
export function newRef(): string {
  const b = randomBytes(5);
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[b[i]! % ALPHABET.length];
  return `ML-${s}`;
}

/** Gives every request a reference, returned in the X-Request-Ref header and in error bodies. */
@Injectable()
export class RequestRefMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    req.ref = newRef();
    res.setHeader('X-Request-Ref', req.ref);
    next();
  }
}
