import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { AuthUser } from '../common/auth';
import { ActorRef, OrderWorkflowService } from '../orders/order-workflow.service';

const LANES: { key: string; title: string; status: OrderStatus }[] = [
  { key: 'new', title: 'New orders', status: 'PLACED' },
  { key: 'toBill', title: 'To bill', status: 'ACCEPTED' },
  { key: 'toDispatch', title: 'To dispatch', status: 'BILLED' },
  { key: 'onTheWay', title: 'On the way', status: 'DISPATCHED' },
];

@Injectable()
export class DistributorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: OrderWorkflowService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  actor(user: AuthUser, distributorId: string): ActorRef {
    return { type: 'DISTRIBUTOR', id: user.sub, label: user.name, distributorId };
  }

  async dashboard(distributorId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [d, newCount, today, fill, agent, pendingLinks] = await Promise.all([
      this.prisma.distributor.findUniqueOrThrow({ where: { id: distributorId } }),
      this.prisma.order.count({ where: { distributorId, status: 'PLACED' } }),
      this.prisma.order.aggregate({ where: { distributorId, createdAt: { gte: startOfDay }, status: { notIn: ['REJECTED', 'CANCELLED'] } }, _sum: { totalPaise: true }, _count: true }),
      this.prisma.$queryRaw<{ billed: bigint | null; ordered: bigint | null }[]>`
        SELECT SUM(oi."billedQty") AS billed, SUM(oi.qty) AS ordered
        FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."distributorId" = ${distributorId}::uuid AND oi."billedQty" IS NOT NULL AND o."createdAt" >= ${since30}`,
      this.prisma.syncAgent.findUnique({ where: { distributorId } }),
      this.prisma.retailerDistributorLink.count({ where: { distributorId, status: 'PENDING' } }),
    ]);
    const billed = Number(fill[0]?.billed ?? 0);
    const ordered = Number(fill[0]?.ordered ?? 0);
    const minutesSinceBeat = agent?.lastHeartbeatAt ? Math.round((Date.now() - agent.lastHeartbeatAt.getTime()) / 60_000) : null;
    return {
      distributor: { id: d.id, name: d.name, area: d.area, code: d.code, billingSoftware: d.billingSoftware },
      newOrders: newCount,
      todayValuePaise: today._sum.totalPaise ?? 0,
      todayOrders: today._count,
      fillRatePct: ordered ? Math.round((billed / ordered) * 100) : 100,
      pendingLinks,
      sync: agent
        ? { status: minutesSinceBeat !== null && minutesSinceBeat <= 15 ? 'online' : 'offline', minutesSinceBeat, lastStockSyncAt: agent.lastStockSyncAt, version: agent.version }
        : { status: 'not_set_up', minutesSinceBeat: null, lastStockSyncAt: null, version: null },
    };
  }

  /** Orders grouped into lanes by what needs doing next. */
  async lanes(distributorId: string) {
    const open = await this.prisma.order.findMany({
      where: { distributorId, status: { in: LANES.map((l) => l.status) } },
      orderBy: { createdAt: 'asc' },
      include: { retailer: true, items: { include: { product: true, distributorItem: true } } },
    });
    const card = (o: (typeof open)[number]) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      source: o.source,
      createdAt: o.createdAt,
      totalPaise: o.totalPaise,
      invoiceNo: o.invoiceNo,
      partial: o.partial,
      erpRef: o.erpRef,
      shop: { id: o.retailerId, name: o.retailer.name, area: o.retailer.area },
      items: o.items.map((i) => ({
        id: i.id,
        name: i.product.name,
        schedule: i.product.schedule,
        qty: i.qty,
        freeQty: i.freeQty,
        billedQty: i.billedQty,
        inStock: i.distributorItem.stockQty,
        short: i.billedQty === null ? i.distributorItem.stockQty < i.qty : i.billedQty < i.qty,
      })),
    });
    return LANES.map((l) => ({ key: l.key, title: l.title, status: l.status, orders: open.filter((o) => o.status === l.status).map(card) }));
  }

  async closed(distributorId: string) {
    const rows = await this.prisma.order.findMany({
      where: { distributorId, status: { in: ['DELIVERED', 'REJECTED', 'CANCELLED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { retailer: true },
    });
    return rows.map((o) => ({ id: o.id, number: o.number, status: o.status, shop: o.retailer.name, totalPaise: o.totalPaise, updatedAt: o.updatedAt }));
  }

  async acceptAll(user: AuthUser, distributorId: string) {
    const ids = (await this.prisma.order.findMany({ where: { distributorId, status: 'PLACED' }, select: { id: true } })).map((o) => o.id);
    return this.workflow.acceptMany(ids, this.actor(user, distributorId));
  }

  async shops(distributorId: string) {
    const links = await this.prisma.retailerDistributorLink.findMany({ where: { distributorId }, include: { retailer: true }, orderBy: { updatedAt: 'desc' } });
    return links.map((l) => ({
      linkId: l.id,
      status: l.status,
      partyCode: l.partyCode,
      creditLimitPaise: l.creditLimitPaise,
      duesPaise: l.outstandingPaise,
      openOrdersPaise: l.reservedPaise,
      shop: { id: l.retailerId, name: l.retailer.name, area: l.retailer.area, gstin: l.retailer.gstin, kycStatus: l.retailer.kycStatus, dl20b: l.retailer.dl20b, dl21b: l.retailer.dl21b },
    }));
  }

  async decideLink(user: AuthUser, distributorId: string, linkId: string, approve: boolean, input: { partyCode?: string; creditLimitPaise?: number; creditDays?: number }) {
    const link = await this.prisma.retailerDistributorLink.findFirst({ where: { id: linkId, distributorId }, include: { retailer: true } });
    if (!link) throw new NotFoundException('Request not found');
    const updated = await this.prisma.retailerDistributorLink.update({
      where: { id: link.id },
      data: approve
        ? { status: 'LINKED', partyCode: input.partyCode, creditLimitPaise: input.creditLimitPaise ?? link.creditLimitPaise, creditDays: input.creditDays ?? link.creditDays }
        : { status: 'DECLINED' },
    });
    await this.audit.log({ actorId: user.sub, actorLabel: user.name, action: approve ? 'link.approve' : 'link.decline', entity: 'RetailerDistributorLink', entityId: link.id, after: { partyCode: input.partyCode, creditLimitPaise: input.creditLimitPaise } });
    await this.notify.toUsersOf({ retailerId: link.retailerId }, approve ? 'link_approved' : 'link_declined', { distributorId });
    return updated;
  }

  /** Items in our catalogue with low stock, to help the distributor re-order from companies. */
  async lowStock(distributorId: string) {
    return this.prisma.distributorItem.findMany({
      where: { distributorId, stockQty: { lt: 20 }, productId: { not: null } },
      orderBy: { stockQty: 'asc' },
      take: 50,
      select: { externalCode: true, externalName: true, stockQty: true },
    });
  }
}
