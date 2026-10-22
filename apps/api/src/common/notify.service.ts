import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma.service';

export type Channel = 'SMS' | 'WHATSAPP' | 'PUSH' | 'EMAIL';

/**
 * Writes notifications to an outbox table inside the same transaction as the business change,
 * so a message is never sent for a change that rolled back. A worker (Phase 4) delivers them.
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger('Notify');
  constructor(private readonly prisma: PrismaService) {}

  async toUsersOf(
    target: { retailerId?: string; distributorId?: string },
    template: string,
    payload: Record<string, unknown>,
    tx?: Tx,
    channels: Channel[] = ['PUSH', 'WHATSAPP'],
  ) {
    const db = tx ?? this.prisma;
    const users = await db.user.findMany({
      where: { status: 'ACTIVE', ...(target.retailerId ? { retailerId: target.retailerId } : { distributorId: target.distributorId }) },
      select: { id: true, mobile: true },
    });
    if (users.length === 0) return;
    await db.notification.createMany({
      data: users.flatMap((u) =>
        channels.map((channel) => ({ userId: u.id, mobile: u.mobile, channel, template, payload: payload as Prisma.InputJsonValue })),
      ),
    });
    this.logger.debug(`${template} queued for ${users.length} user(s)`);
  }
}
