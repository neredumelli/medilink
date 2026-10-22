import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, OrderStatus, Prisma } from '@prisma/client';
import { Actor, canTransition, orderTotals, releasesCredit, STATUS_LABEL_EN } from '@medilink/core';
import { PrismaService, Tx } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';

export interface ActorRef {
  type: Exclude<ActorType, 'SYSTEM'>;
  id: string | null;
  label: string;
  /** Set for distributor users and sync agents: they may only touch their own orders. */
  distributorId?: string;
  /** Set for shop users: they may only touch their own orders. */
  retailerId?: string;
}

export interface BillInput {
  invoiceNo?: string;
  /** Billed quantity per order item. Missing items default to min(ordered, stock). */
  billed?: { orderItemId?: string; externalCode?: string; billedQty: number }[];
  erpRef?: string;
}

/** Indian financial year label, April–March: Oct 2026 => "26-27". */
export function financialYear(d = new Date()): string {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

/**
 * The only place order status changes. Enforces who may do what (shared rules in @medilink/core),
 * keeps credit reservations in step, writes an event + audit row, and queues notifications —
 * all in one transaction.
 */
@Injectable()
export class OrderWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async transition(orderId: string, to: OrderStatus, actor: ActorRef, extra: { reason?: string; bill?: BillInput } = {}) {
    return this.prisma.$transaction(async (tx) => {
      // Lock the order row so two people cannot act on it at the same time.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Order not found');
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { include: { distributorItem: true, product: true } }, distributor: true },
      });
      if (actor.distributorId && order.distributorId !== actor.distributorId) throw new ForbiddenException('This order belongs to another distributor');
      if (actor.retailerId && order.retailerId !== actor.retailerId) throw new ForbiddenException('This order belongs to another shop');
      if (!canTransition(order.status, to, actor.type as Actor)) {
        throw new ConflictException(`This order is already "${STATUS_LABEL_EN[order.status]}" and cannot be moved to "${STATUS_LABEL_EN[to]}"`);
      }

      const data: Prisma.OrderUpdateInput = { status: to };
      let note: string | undefined = extra.reason;

      if (to === 'REJECTED' || to === 'CANCELLED') data.rejectReason = extra.reason ?? null;

      if (to === 'BILLED') {
        const billedFor = (itemId: string, externalCode: string, ordered: number, stock: number) => {
          const given = extra.bill?.billed?.find((b) => b.orderItemId === itemId || (b.externalCode && b.externalCode === externalCode));
          return Math.max(0, Math.min(ordered, given ? given.billedQty : stock));
        };
        let partial = false;
        const lines: { ratePaise: number; qty: number; gstPct: number }[] = [];
        for (const it of order.items) {
          const billedQty = billedFor(it.id, it.distributorItem.externalCode, it.qty, it.distributorItem.stockQty);
          if (billedQty < it.qty) partial = true;
          await tx.orderItem.update({ where: { id: it.id }, data: { billedQty } });
          // Stock never goes below zero, even if the ERP and our copy disagree.
          await tx.$executeRaw`UPDATE "DistributorItem" SET "stockQty" = GREATEST(0, "stockQty" - ${billedQty}), "updatedAt" = NOW() WHERE id = ${it.distributorItemId}::uuid`;
          lines.push({ ratePaise: it.ratePaise, qty: billedQty, gstPct: it.gstPct });
        }
        const totals = orderTotals(lines);
        let invoiceNo = extra.bill?.invoiceNo;
        if (!invoiceNo) {
          const d = await tx.distributor.update({ where: { id: order.distributorId }, data: { invoiceSeq: { increment: 1 } } });
          invoiceNo = `${d.code}/${financialYear()}/${String(d.invoiceSeq).padStart(4, '0')}`;
        }
        Object.assign(data, {
          partial,
          invoiceNo,
          erpRef: extra.bill?.erpRef ?? invoiceNo,
          subtotalPaise: totals.subtotal,
          gstPaise: totals.gst,
          totalPaise: totals.total,
        });
        // The reservation made at order time becomes real dues for the billed amount.
        await tx.$executeRaw`
          UPDATE "RetailerDistributorLink"
          SET "reservedPaise" = GREATEST(0, "reservedPaise" - ${order.totalPaise}),
              "outstandingPaise" = "outstandingPaise" + ${totals.total}, "updatedAt" = NOW()
          WHERE "retailerId" = ${order.retailerId}::uuid AND "distributorId" = ${order.distributorId}::uuid`;
        note = `Bill ${invoiceNo}${partial ? ' (part supply)' : ''}`;
      }

      if (releasesCredit(to)) {
        await tx.$executeRaw`
          UPDATE "RetailerDistributorLink" SET "reservedPaise" = GREATEST(0, "reservedPaise" - ${order.totalPaise}), "updatedAt" = NOW()
          WHERE "retailerId" = ${order.retailerId}::uuid AND "distributorId" = ${order.distributorId}::uuid`;
      }

      const updated = await tx.order.update({ where: { id: orderId }, data });
      await tx.orderEvent.create({ data: { orderId, status: to, actorType: actor.type, actorId: actor.id, note } });
      await this.audit.log(
        { actorId: actor.id, actorLabel: actor.label, action: `order.${to.toLowerCase()}`, entity: 'Order', entityId: order.number, before: { status: order.status }, after: { status: to, note } },
        tx,
      );
      await this.notify.toUsersOf(
        { retailerId: order.retailerId },
        `order_${to.toLowerCase()}`,
        { number: order.number, distributor: order.distributor.name, invoiceNo: updated.invoiceNo, partial: updated.partial, reason: extra.reason },
        tx,
      );
      return updated;
    });
  }

  /** Accept several new orders at once (distributor "Accept all"). Stops at none; reports each result. */
  async acceptMany(orderIds: string[], actor: ActorRef) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of orderIds) {
      try {
        await this.transition(id, 'ACCEPTED', actor);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : 'Failed' });
      }
    }
    return results;
  }
}

export type { Tx };
