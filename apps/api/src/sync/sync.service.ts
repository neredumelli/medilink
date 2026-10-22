import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Distributor, SyncAgent } from '@prisma/client';
import { matchScore, parseScheme, rupeesToPaise } from '@medilink/core';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { OrderWorkflowService } from '../orders/order-workflow.service';

export type AgentWithDistributor = SyncAgent & { distributor: Distributor };

export interface StockRow {
  externalCode: string;
  name: string;
  stockQty: number;
  ptr: number; // rupees, as exported by billing software
  mrp?: number;
  discountPct?: number;
  scheme?: string; // "10+1"
  nearestExpiry?: string; // YYYY-MM-DD or YYYY-MM
  barcode?: string;
}

/** Auto-map a new distributor item to a master product only when we are confident. */
const AUTO_MAP_MIN_SCORE = 80;

@Injectable()
export class SyncService {
  private readonly logger = new Logger('Sync');
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: OrderWorkflowService,
    private readonly audit: AuditService,
  ) {}

  private actor(agent: AgentWithDistributor) {
    return { type: 'SYNC_AGENT' as const, id: null, label: `${agent.distributor.name} sync agent`, distributorId: agent.distributorId };
  }

  async heartbeat(agent: AgentWithDistributor, version: string) {
    await this.prisma.syncAgent.update({ where: { id: agent.id }, data: { lastHeartbeatAt: new Date(), version } });
    return { ok: true, serverTime: new Date().toISOString(), pollSeconds: 60 };
  }

  /** Upserts stock, price, scheme and expiry. Items not seen before are mapped to master products when confident. */
  async pushStock(agent: AgentWithDistributor, rows: StockRow[]) {
    const catalog = await this.prisma.product.findMany({ select: { id: true, name: true, salt: true, company: true, barcode: true, pack: true } });
    const byBarcode = new Map(catalog.filter((p) => p.barcode).map((p) => [p.barcode!, p.id]));
    let created = 0;
    let updated = 0;
    let unmapped = 0;

    for (const r of rows) {
      const scheme = parseScheme(r.scheme);
      const expiry = r.nearestExpiry ? new Date(r.nearestExpiry.length === 7 ? `${r.nearestExpiry}-01` : r.nearestExpiry) : null;
      const data = {
        externalName: r.name,
        stockQty: Math.max(0, Math.floor(r.stockQty)),
        ptrPaise: rupeesToPaise(r.ptr),
        mrpPaise: r.mrp !== undefined ? rupeesToPaise(r.mrp) : null,
        discountPct: Math.min(100, Math.max(0, r.discountPct ?? 0)),
        schemeBuy: scheme?.buy ?? null,
        schemeFree: scheme?.free ?? null,
        nearestExpiry: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null,
        stockUpdatedAt: new Date(),
      };
      const existing = await this.prisma.distributorItem.findUnique({ where: { distributorId_externalCode: { distributorId: agent.distributorId, externalCode: r.externalCode } } });
      if (existing) {
        await this.prisma.distributorItem.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        let productId: string | null = r.barcode ? byBarcode.get(r.barcode) ?? null : null;
        let confidence = productId ? 100 : 0;
        if (!productId) {
          for (const p of catalog) {
            const s = matchScore(p, r.name.replace(/\b\d+\s*'?s\b/i, '').trim());
            if (s > confidence) {
              confidence = s;
              productId = p.id;
            }
          }
          if (confidence < AUTO_MAP_MIN_SCORE) productId = null;
        }
        if (!productId) unmapped++;
        await this.prisma.distributorItem.create({ data: { ...data, distributorId: agent.distributorId, externalCode: r.externalCode, productId, mapConfidence: confidence || null } });
        created++;
      }
    }
    await this.prisma.syncAgent.update({ where: { id: agent.id }, data: { lastStockSyncAt: new Date(), lastHeartbeatAt: new Date() } });
    this.logger.log(`${agent.distributor.code}: stock ${updated} updated, ${created} new, ${unmapped} waiting for mapping`);
    return { updated, created, unmapped };
  }

  /** New orders not yet written into the billing software. */
  async pendingOrders(agent: AgentWithDistributor) {
    const orders = await this.prisma.order.findMany({
      where: { distributorId: agent.distributorId, status: { in: ['PLACED', 'ACCEPTED'] }, erpPulledAt: null },
      orderBy: { createdAt: 'asc' },
      take: 50,
      include: { retailer: true, items: { include: { distributorItem: true } } },
    });
    const links = await this.prisma.retailerDistributorLink.findMany({ where: { distributorId: agent.distributorId, retailerId: { in: orders.map((o) => o.retailerId) } } });
    const party = new Map(links.map((l) => [l.retailerId, l.partyCode]));
    return orders.map((o) => ({
      number: o.number,
      createdAt: o.createdAt,
      partyCode: party.get(o.retailerId) ?? null,
      shopName: o.retailer.name,
      shopGstin: o.retailer.gstin,
      lines: o.items.map((i) => ({ externalCode: i.distributorItem.externalCode, name: i.distributorItem.externalName, qty: i.qty, freeQty: i.freeQty, rate: i.ratePaise / 100 })),
      totals: { subtotal: o.subtotalPaise / 100, gst: o.gstPaise / 100, total: o.totalPaise / 100 },
    }));
  }

  /** The agent wrote the order into the billing software as a pending sales order. */
  async ackOrder(agent: AgentWithDistributor, number: string, erpRef: string) {
    const o = await this.findOrder(agent, number);
    await this.prisma.order.update({ where: { id: o.id }, data: { erpPulledAt: new Date(), erpRef } });
    if (o.status === 'PLACED') await this.workflow.transition(o.id, 'ACCEPTED', this.actor(agent));
    return { ok: true };
  }

  /** The bill was made in the billing software: record invoice number and billed quantities. */
  async billed(agent: AgentWithDistributor, number: string, input: { invoiceNo: string; lines: { externalCode: string; billedQty: number }[] }) {
    let o = await this.findOrder(agent, number);
    if (o.status === 'PLACED') {
      await this.workflow.transition(o.id, 'ACCEPTED', this.actor(agent));
      o = await this.findOrder(agent, number);
    }
    return this.workflow.transition(o.id, 'BILLED', this.actor(agent), {
      bill: { invoiceNo: input.invoiceNo, erpRef: input.invoiceNo, billed: input.lines.map((l) => ({ externalCode: l.externalCode, billedQty: l.billedQty })) },
    });
  }

  /** Shop-wise dues from the billing software (matched by party code). */
  async outstanding(agent: AgentWithDistributor, rows: { partyCode: string; outstanding: number }[]) {
    let matched = 0;
    for (const r of rows) {
      const res = await this.prisma.retailerDistributorLink.updateMany({
        where: { distributorId: agent.distributorId, partyCode: r.partyCode },
        data: { outstandingPaise: Math.max(0, rupeesToPaise(r.outstanding)) },
      });
      matched += res.count;
    }
    return { matched, unmatched: rows.length - matched };
  }

  private async findOrder(agent: AgentWithDistributor, number: string) {
    const o = await this.prisma.order.findFirst({ where: { number, distributorId: agent.distributorId } });
    if (!o) throw new NotFoundException(`Order ${number} not found for this distributor`);
    return o;
  }
}
