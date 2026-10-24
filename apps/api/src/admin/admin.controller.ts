import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ADMIN_ROLES, AuthUser, CurrentUser, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { AdminService } from './admin.service';
import { SettingsService } from '../common/settings.service';
import { ipAllowed, isValidAllowEntry, normalizeIp } from '../common/ip';
import { config } from '../config';

const Decide = z.object({ decision: z.enum(['approve', 'changes', 'reject']), note: z.string().trim().max(300).optional() });
const AgentKey = z.object({ software: z.enum(['MARG', 'TALLY', 'BUSY', 'GOFRUGAL', 'CSV', 'API']) });
const MapItem = z.object({ productId: z.string().uuid() });
const ROLE = z.enum(['SUPER_ADMIN', 'ADMIN_OPS', 'SUPPORT', 'CALL_CENTER', 'DISTRIBUTOR_ADMIN', 'DISTRIBUTOR_STAFF', 'RETAILER_OWNER', 'RETAILER_STAFF', 'SALES_REP']);
const UserFilter = z.object({ q: z.string().max(60).optional(), role: ROLE.optional(), status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED']).optional() });
const SetStatus = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3, 'Give a short reason').max(200) });
const SetRole = z.object({ role: ROLE });
const UpdateSettings = z.object({
  maintenance: z
    .object({
      on: z.boolean(),
      message: z.string().trim().max(300).default(''),
      until: z.string().datetime({ offset: true }).nullable().default(null),
    })
    .optional(),
  minAppVersion: z.string().regex(/^\d+(\.\d+){0,2}$/, 'Use a version like 1.2.0').optional(),
  security: z
    .object({
      admin2faRequired: z.boolean(),
      adminIpAllowList: z.array(z.string().trim().max(45)).max(50).default([]),
    })
    .optional(),
});

@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_ROLES)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------- settings (maintenance mode, minimum app version)
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('settings')
  updateSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(UpdateSettings)) b: z.infer<typeof UpdateSettings>, @Req() req: Request) {
    if (b.security) {
      if (u.role !== 'SUPER_ADMIN') throw new ForbiddenException('Only the super admin can change admin security.');
      const list = b.security.adminIpAllowList.filter((x) => x.length > 0);
      const bad = list.filter((x) => !isValidAllowEntry(x));
      if (bad.length) throw new BadRequestException(`These are not valid addresses: ${bad.join(', ')}`);
      if (!ipAllowed(req.ip, list)) throw new BadRequestException(`Your own address (${normalizeIp(req.ip)}) must be in the list, or you would lock yourself out.`);
      if (!b.security.admin2faRequired && config().NODE_ENV === 'production') throw new BadRequestException('2-step login cannot be switched off on a live system.');
      b.security.adminIpAllowList = list;
    }
    return this.settings.update(u, b);
  }

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('kyc')
  kyc() {
    return this.admin.kycQueue();
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('kyc/:type/:id')
  decide(
    @CurrentUser() u: AuthUser,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(Decide)) b: z.infer<typeof Decide>,
  ) {
    const t = new ZodPipe(z.enum(['shop', 'distributor'])).transform(type);
    return this.admin.decideKyc(u, t, id, b.decision, b.note);
  }

  @Get('sync-health')
  syncHealth() {
    return this.admin.syncHealth();
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('distributors/:id/agent-key')
  agentKey(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AgentKey)) b: z.infer<typeof AgentKey>) {
    return this.admin.issueAgentKey(u, id, b.software);
  }

  @Get('orders')
  orders() {
    return this.admin.orders();
  }

  @Get('audit')
  audit() {
    return this.admin.auditLog();
  }

  // ---------------- users & access
  @Get('users')
  users(@Query(new ZodPipe(UserFilter)) f: z.infer<typeof UserFilter>) {
    return this.admin.users(f);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.userDetail(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('users/:id/status')
  status(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SetStatus)) b: z.infer<typeof SetStatus>) {
    return this.admin.setUserStatus(u, id, b.status, b.reason);
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('users/:id/logout-all')
  logoutAll(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.logoutEverywhere(u, id);
  }

  @Roles('SUPER_ADMIN')
  @Post('users/:id/role')
  role(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SetRole)) b: z.infer<typeof SetRole>) {
    return this.admin.setUserRole(u, id, b.role);
  }

  /** Lost phone: the super admin switches off an admin's 2-step login so they can set it up again. */
  @Roles('SUPER_ADMIN')
  @Post('users/:id/reset-2fa')
  reset2fa(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetTwoFactor(u, id);
  }

  @Get('catalog/unmapped')
  unmapped() {
    return this.admin.unmapped();
  }

  @Roles('SUPER_ADMIN', 'ADMIN_OPS')
  @Post('catalog/items/:id/map')
  map(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(MapItem)) b: z.infer<typeof MapItem>) {
    return this.admin.mapItem(u, id, b.productId);
  }
}
