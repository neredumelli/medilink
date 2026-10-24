import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditService } from './audit.service';
import type { AuthUser } from './auth';
import { config } from '../config';

export interface MaintenanceSetting {
  on: boolean;
  message: string;
  /** ISO time the app is expected back, shown to users. */
  until: string | null;
}

export interface SecuritySetting {
  /** Admins must use an authenticator app. Always true in production, whatever is stored. */
  admin2faRequired: boolean;
  /** When not empty, admin screens only work from these addresses / IPv4 ranges. */
  adminIpAllowList: string[];
}

export interface Settings {
  maintenance: MaintenanceSetting;
  minAppVersion: string;
  security: SecuritySetting;
}

const DEFAULTS: Settings = {
  maintenance: { on: false, message: '', until: null },
  minAppVersion: '0.1.0',
  security: { admin2faRequired: true, adminIpAllowList: [] },
};
const CACHE_MS = 5_000;

/** Admin-editable settings, cached for a few seconds so every request can check them cheaply. */
@Injectable()
export class SettingsService {
  private cache: { at: number; value: Settings } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: Object.keys(DEFAULTS) } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const value: Settings = {
      maintenance: { ...DEFAULTS.maintenance, ...((map.maintenance as object) ?? {}) },
      minAppVersion: typeof map.minAppVersion === 'string' ? map.minAppVersion : DEFAULTS.minAppVersion,
      security: { ...DEFAULTS.security, ...((map.security as object) ?? {}) },
    };
    // A real install never lets admins in without the second step.
    if (config().NODE_ENV === 'production') value.security.admin2faRequired = true;
    this.cache = { at: Date.now(), value };
    return value;
  }

  async update(admin: AuthUser, patch: Partial<Settings>): Promise<Settings> {
    const before = await this.get();
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await this.prisma.appSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue, updatedById: admin.sub },
        update: { value: value as Prisma.InputJsonValue, updatedById: admin.sub },
      });
    }
    this.cache = null;
    const after = await this.get();
    await this.audit.log({ actorId: admin.sub, actorLabel: admin.name, action: 'settings.update', entity: 'AppSetting', entityId: Object.keys(patch).join(','), before, after });
    return after;
  }
}
