import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingSoftware, KycStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { validateGstin } from '@medilink/core';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { AuthUser } from '../common/auth';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  async overview() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [shops, distributors, today, pendingShops, pendingDists, times, agents, unmapped] = await Promise.all([
      this.prisma.retailer.count({ where: { kycStatus: 'APPROVED' } }),
      this.prisma.distributor.count({ where: { kycStatus: 'APPROVED' } }),
      this.prisma.order.aggregate({ where: { createdAt: { gte: startOfDay }, status: { notIn: ['REJECTED', 'CANCELLED'] } }, _sum: { totalPaise: true }, _count: true }),
      this.prisma.retailer.count({ where: { kycStatus: 'PENDING' } }),
      this.prisma.distributor.count({ where: { kycStatus: 'PENDING' } }),
      this.prisma.order.findMany({ where: { timeToPlaceSec: { not: null } }, orderBy: { createdAt: 'desc' }, take: 50, select: { timeToPlaceSec: true } }),
      this.syncHealth(),
      this.prisma.distributorItem.count({ where: { productId: null } }),
    ]);
    const secs = times.map((t) => t.timeToPlaceSec!).sort((a, b) => a - b);
    const median = secs.length ? (secs.length % 2 ? secs[(secs.length - 1) / 2]! : (secs[secs.length / 2 - 1]! + secs[secs.length / 2]!) / 2) : null;
    return {
      activeShops: shops,
      liveDistributors: distributors,
      ordersToday: today._count,
      gmvTodayPaise: today._sum.totalPaise ?? 0,
      pendingApprovals: pendingShops + pendingDists,
      medianOrderSeconds: median,
      recentOrderSeconds: times.slice(0, 12).map((t) => t.timeToPlaceSec).reverse(),
      syncOffline: agents.filter((a) => a.status === 'offline').map((a) => a.distributor),
      unmappedItems: unmapped,
    };
  }

  async kycQueue() {
    const statuses: KycStatus[] = ['PENDING', 'CHANGES_REQUESTED'];
    const [shops, dists] = await Promise.all([
      this.prisma.retailer.findMany({ where: { kycStatus: { in: statuses } }, include: { documents: true, users: { select: { name: true, mobile: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.distributor.findMany({ where: { kycStatus: { in: statuses } }, include: { documents: true, users: { select: { name: true, mobile: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const check = (g: string | null) => (g ? validateGstin(g) : { ok: false as const, problem: 'missing' as const });
    return [
      ...shops.map((r) => ({ type: 'shop' as const, id: r.id, name: r.name, area: r.area, status: r.kycStatus, gstin: r.gstin, gstinCheck: check(r.gstin), licences: [r.dl20b, r.dl21b].filter(Boolean), missing: [!r.dl20b && '20B licence', !r.dl21b && '21B licence'].filter(Boolean), documents: r.documents, owner: r.users[0] ?? null, createdAt: r.createdAt })),
      ...dists.map((d) => ({ type: 'distributor' as const, id: d.id, name: d.name, area: d.area, status: d.kycStatus, gstin: d.gstin, gstinCheck: check(d.gstin), licences: [d.drugLicence].filter(Boolean), missing: [!d.drugLicence && 'wholesale licence'].filter(Boolean), documents: d.documents, owner: d.users[0] ?? null, createdAt: d.createdAt })),
    ];
  }

  async decideKyc(admin: AuthUser, type: 'shop' | 'distributor', id: string, decision: 'approve' | 'changes' | 'reject', note?: string) {
    const status: KycStatus = decision === 'approve' ? 'APPROVED' : decision === 'changes' ? 'CHANGES_REQUESTED' : 'REJECTED';
    if (type === 'shop') {
      const r = await this.prisma.retailer.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Shop not found');
      if (decision === 'approve' && (!r.gstin || !validateGstin(r.gstin).ok)) throw new BadRequestException('GSTIN is missing or wrong. Ask the shop for changes instead.');
      await this.prisma.retailer.update({ where: { id }, data: { kycStatus: status, kycNote: note ?? null } });
      await this.prisma.user.updateMany({ where: { retailerId: id }, data: { status: decision === 'reject' ? 'SUSPENDED' : 'ACTIVE' } });
      await this.notify.toUsersOf({ retailerId: id }, `kyc_${decision}`, { note }, undefined, ['SMS', 'WHATSAPP']);
    } else {
      const d = await this.prisma.distributor.findUnique({ where: { id } });
      if (!d) throw new NotFoundException('Distributor not found');
      if (decision === 'approve' && (!d.gstin || !validateGstin(d.gstin).ok)) throw new BadRequestException('GSTIN is missing or wrong. Ask for changes instead.');
      await this.prisma.distributor.update({ where: { id }, data: { kycStatus: status, kycNote: note ?? null } });
      await this.prisma.user.updateMany({ where: { distributorId: id }, data: { status: decision === 'reject' ? 'SUSPENDED' : 'ACTIVE' } });
      await this.notify.toUsersOf({ distributorId: id }, `kyc_${decision}`, { note }, undefined, ['SMS', 'WHATSAPP']);
    }
    await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: `kyc.${decision}`, entity: type === 'shop' ? 'Retailer' : 'Distributor', entityId: id, after: { status, note } });
    return { id, status };
  }

  async syncHealth() {
    const ds = await this.prisma.distributor.findMany({ where: { kycStatus: 'APPROVED' }, include: { syncAgent: true }, orderBy: { name: 'asc' } });
    return ds.map((d) => {
      const a = d.syncAgent && !d.syncAgent.revokedAt ? d.syncAgent : null;
      const mins = a?.lastHeartbeatAt ? Math.round((Date.now() - a.lastHeartbeatAt.getTime()) / 60_000) : null;
      return {
        distributor: { id: d.id, name: d.name, billingSoftware: d.billingSoftware },
        status: !a ? 'not_set_up' : mins !== null && mins <= 15 ? 'online' : 'offline',
        minutesSinceBeat: mins,
        lastStockSyncAt: a?.lastStockSyncAt ?? null,
        version: a?.version ?? null,
        keyPrefix: a?.keyPrefix ?? null,
      };
    });
  }

  /** Creates (or replaces) a distributor's agent key. The full key is returned once and never stored. */
  async issueAgentKey(admin: AuthUser, distributorId: string, software: BillingSoftware) {
    const d = await this.prisma.distributor.findUnique({ where: { id: distributorId } });
    if (!d) throw new NotFoundException('Distributor not found');
    const key = `mlk_${d.code.toLowerCase()}_${randomBytes(24).toString('base64url')}`;
    const keyHash = createHash('sha256').update(key).digest('hex');
    await this.prisma.syncAgent.upsert({
      where: { distributorId },
      create: { distributorId, keyPrefix: key.slice(0, 12), keyHash, software },
      update: { keyPrefix: key.slice(0, 12), keyHash, software, revokedAt: null },
    });
    await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'agent.key_issued', entity: 'Distributor', entityId: distributorId });
    return { key, note: 'Copy this key into the sync agent now. It will not be shown again.' };
  }

  async orders(take = 100) {
    const rows = await this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take, include: { retailer: true, distributor: true } });
    return rows.map((o) => ({ id: o.id, number: o.number, status: o.status, source: o.source, shop: o.retailer.name, distributor: o.distributor.name, totalPaise: o.totalPaise, createdAt: o.createdAt, partial: o.partial }));
  }

  async auditLog(take = 100) {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take });
  }

  /** Distributor items we could not match to a master product automatically. */
  async unmapped() {
    return this.prisma.distributorItem.findMany({ where: { productId: null }, include: { distributor: { select: { name: true } } }, take: 200, orderBy: { createdAt: 'asc' } });
  }

  async mapItem(admin: AuthUser, itemId: string, productId: string) {
    const item = await this.prisma.distributorItem.update({ where: { id: itemId }, data: { productId, mapConfidence: 100 } });
    await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'catalog.map', entity: 'DistributorItem', entityId: itemId, after: { productId } });
    return item;
  }
}
