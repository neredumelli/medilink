import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma.service';

export const AGENT_CLOCK_SKEW_MS = 5 * 60_000;

export function signBody(key: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * Authenticates the sync agent installed on a distributor's billing PC.
 *   Authorization: Bearer <agent key>
 *   X-Timestamp:   unix ms
 *   X-Signature:   hex HMAC-SHA256(key, `${timestamp}.${rawBody}`)
 * The signature stops tampering and the timestamp stops replays.
 */
@Injectable()
export class AgentGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const auth: string | undefined = req.headers.authorization;
    const key = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!key.startsWith('mlk_')) throw new UnauthorizedException('Missing agent key');

    const agent = await this.prisma.syncAgent.findFirst({
      where: { keyHash: createHash('sha256').update(key).digest('hex'), revokedAt: null },
      include: { distributor: true },
    });
    if (!agent) throw new UnauthorizedException('Unknown or revoked agent key');

    const ts = String(req.headers['x-timestamp'] ?? '');
    if (!/^\d{13}$/.test(ts) || Math.abs(Date.now() - Number(ts)) > AGENT_CLOCK_SKEW_MS) {
      throw new UnauthorizedException('Agent clock is wrong or request is too old. Check the PC date and time.');
    }
    const raw: string = req.rawBody ? req.rawBody.toString('utf8') : '';
    const expected = Buffer.from(signBody(key, ts, raw), 'hex');
    const given = Buffer.from(String(req.headers['x-signature'] ?? ''), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UnauthorizedException('Bad signature');

    req.agent = agent;
    return true;
  }
}
