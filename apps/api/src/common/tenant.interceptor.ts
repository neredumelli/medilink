import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import { PrismaService, TenantContext } from '../prisma.service';
import { AuthUser } from './auth';

/**
 * Wraps every shop and distributor request (and every sync-agent request) in one database transaction
 * that runs under row-level security for that business. Admin and public requests are left as they are.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const tenant = tenantOf(req.user as AuthUser | undefined, req.agent as { distributorId: string } | undefined);
    if (!tenant) return next.handle();
    // Sync agents can send up to 5,000 stock lines in one request, so they get more time.
    const timeoutMs = req.agent ? 120_000 : 30_000;
    return from(this.prisma.withTenant(tenant, () => lastValueFrom(next.handle(), { defaultValue: undefined }), { timeoutMs }));
  }
}

export function tenantOf(user?: AuthUser, agent?: { distributorId: string }): TenantContext | null {
  if (agent?.distributorId) return { distributorId: agent.distributorId };
  if (user && (user.retailerId || user.distributorId)) return { userId: user.sub, retailerId: user.retailerId, distributorId: user.distributorId };
  return null;
}
