import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ADMIN_ROLES, AuthUser, CurrentUser, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { AdminService } from './admin.service';

const Decide = z.object({ decision: z.enum(['approve', 'changes', 'reject']), note: z.string().trim().max(300).optional() });
const AgentKey = z.object({ software: z.enum(['MARG', 'TALLY', 'BUSY', 'GOFRUGAL', 'CSV', 'API']) });
const MapItem = z.object({ productId: z.string().uuid() });

@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_ROLES)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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
