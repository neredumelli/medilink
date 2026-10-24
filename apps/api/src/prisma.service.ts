import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Prisma interactive-transaction client type. */
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Who a request acts for. PostgreSQL row-level security uses these to hide other businesses' rows. */
export interface TenantContext {
  userId?: string | null;
  retailerId?: string | null;
  distributorId?: string | null;
}

interface Scope {
  tx: Tx;
  savepoints: number;
}

const scope = new AsyncLocalStorage<Scope>();

/** Statements that must never be redirected into the request transaction. */
const OWN = new Set<PropertyKey>(['$connect', '$disconnect', '$on', '$extends', 'onModuleInit', 'onModuleDestroy', 'withTenant', 'inTenantScope', 'constructor']);

/**
 * The database client.
 *
 * For shop and distributor requests (see TenantInterceptor) the whole request runs in one transaction as
 * the restricted database role `medilink_tenant`, with the shop / distributor id set for that transaction.
 * Every `this.prisma.x` call made while handling the request is routed into that transaction, so services
 * need no changes, and PostgreSQL row-level security protects other businesses' data even if a query
 * forgets its filter. Nested `$transaction` calls become savepoints inside the request transaction.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const base = this;
    return new Proxy(this, {
      get(target, prop, receiver) {
        const s = scope.getStore();
        if (s && !OWN.has(prop)) {
          if (prop === '$transaction') return (arg: unknown, _opts?: unknown) => nestedTransaction(s, arg);
          const v = (s.tx as any)[prop];
          if (v !== undefined) return typeof v === 'function' ? v.bind(s.tx) : v;
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' && prop !== 'constructor' ? v.bind(base) : v;
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** True while handling a shop or distributor request. */
  inTenantScope(): boolean {
    return !!scope.getStore();
  }

  /**
   * Runs `fn` in one transaction as the shop or distributor in `ctx`. Everything succeeds or nothing is saved.
   * Calls made inside an existing tenant scope simply join it.
   */
  async withTenant<T>(ctx: TenantContext, fn: () => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
    if (scope.getStore()) return fn();
    return super.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE medilink_tenant');
        await tx.$queryRaw`SELECT set_config('app.retailer_id', ${ctx.retailerId ?? ''}, true),
                                  set_config('app.distributor_id', ${ctx.distributorId ?? ''}, true),
                                  set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
        return scope.run({ tx, savepoints: 0 }, fn);
      },
      { maxWait: 10_000, timeout: opts.timeoutMs ?? 30_000 },
    );
  }
}

/** `$transaction` inside a tenant scope: callbacks run in a savepoint, arrays run in order. */
async function nestedTransaction(s: Scope, arg: unknown): Promise<unknown> {
  if (Array.isArray(arg)) {
    const out: unknown[] = [];
    for (const p of arg) out.push(await p);
    return out;
  }
  if (typeof arg !== 'function') throw new Error('Unsupported $transaction call');
  const name = `sp_${++s.savepoints}`;
  await s.tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const result = await (arg as (tx: Tx) => Promise<unknown>)(s.tx);
    await s.tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (e) {
    await s.tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
}
