import { CanActivate, ExecutionContext, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { compareVersions } from '@medilink/core';
import { ADMIN_ROLES, AuthUser } from './auth';
import { SettingsService } from './settings.service';

/** Paths that keep working during maintenance: health checks, status, login (so admins can get in) and the sync agent. */
const ALWAYS_OPEN = ['/api/health', '/api/public', '/api/auth', '/api/sync'];

/**
 * Runs after login checks on every request:
 *  - Maintenance mode: everyone except admins gets a friendly 503 with the message and expected time.
 *  - Minimum app version: phone apps older than the minimum get 426 "please update".
 */
@Injectable()
export class AccessPolicyGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const path: string = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (ALWAYS_OPEN.some((p) => path.startsWith(p))) return true;
    const s = await this.settings.get();

    const appVersion = req.headers['x-app-version'];
    if (typeof appVersion === 'string' && compareVersions(appVersion, s.minAppVersion) < 0) {
      throw new HttpException({ message: 'Please update MediLink to continue.', updateRequired: true, minAppVersion: s.minAppVersion }, 426);
    }

    if (s.maintenance.on) {
      const user: AuthUser | undefined = req.user;
      if (user && ADMIN_ROLES.includes(user.role)) return true;
      throw new ServiceUnavailableException({
        message: s.maintenance.message || "MediLink is being upgraded. We'll be back shortly. Your cart is saved.",
        maintenance: true,
        until: s.maintenance.until,
      });
    }
    return true;
  }
}
