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

export interface AuthUser {
  sub: string; // user id
  role: Role;
  name: string;
  retailerId: string | null;
  distributorId: string | null;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

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
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Please log in again');
    try {
      req.user = this.jwt.verify<AuthUser>(token, { secret: config().JWT_ACCESS_SECRET });
      return true;
    } catch {
      throw new UnauthorizedException('Your session has expired. Please log in again');
    }
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
