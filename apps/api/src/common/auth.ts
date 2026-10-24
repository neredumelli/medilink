import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { SettingsService } from './settings.service';
import { ipAllowed } from './ip';

export interface AuthUser {
  sub: string; // user id
  role: Role;
  name: string;
  retailerId: string | null;
  distributorId: string | null;
  /** true when this login passed the authenticator-app step (admins) */
  mfa?: boolean;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Routes an admin may use before finishing 2-step login setup (e.g. the setup screen itself). */
export const ALLOW_WITHOUT_2FA = 'allowWithout2fa';
export const AllowWithout2fa = () => SetMetadata(ALLOW_WITHOUT_2FA, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const RETAILER_ROLES: Role[] = ['RETAILER_OWNER', 'RETAILER_STAFF'];
export const DISTRIBUTOR_ROLES: Role[] = ['DISTRIBUTOR_ADMIN', 'DISTRIBUTOR_STAFF'];
export const ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT'];

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Please log in again');
    let payload: AuthUser;
    try {
      payload = this.jwt.verify<AuthUser>(token, { secret: config().JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Your session has expired. Please log in again');
    }
    // Look the user up on every request so a suspension or role change applies immediately.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { status: true, role: true, name: true, retailerId: true, distributorId: true, totpEnabledAt: true } });
    if (!user || user.status === 'SUSPENDED') throw new UnauthorizedException('This account is suspended. Please call support.');
    req.user = { sub: payload.sub, role: user.role, name: user.name, retailerId: user.retailerId, distributorId: user.distributorId, mfa: payload.mfa === true } satisfies AuthUser;

    if (ADMIN_ROLES.includes(user.role)) {
      const { security } = await this.settings.get();
      // Admin screens can be limited to the office network.
      if (!ipAllowed(req.ip, security.adminIpAllowList)) {
        throw new ForbiddenException({ message: 'Admin access is not allowed from this network. Please connect from the office.', ipBlocked: true });
      }
      // 2-step login: required by setting (always in production), and always once an admin has switched it on.
      const needs2fa = security.admin2faRequired || !!user.totpEnabledAt;
      const exempt = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_2FA, [ctx.getHandler(), ctx.getClass()]);
      if (needs2fa && payload.mfa !== true && !exempt) {
        throw new ForbiddenException(
          user.totpEnabledAt
            ? { message: 'Please log in again with your authenticator app code.', twoFactorLogin: true }
            : { message: 'Set up 2-step login with an authenticator app to use the admin panel.', twoFactorSetup: true },
        );
      }
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('You do not have access to this');
    return true;
  }
}

export function requireRetailer(user: AuthUser): string {
  if (!user.retailerId) throw new ForbiddenException('This account is not linked to a shop');
  return user.retailerId;
}

export function requireDistributor(user: AuthUser): string {
  if (!user.distributorId) throw new ForbiddenException('This account is not linked to a distributor');
  return user.distributorId;
}
