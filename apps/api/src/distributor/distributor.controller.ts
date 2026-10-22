import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthUser, CurrentUser, DISTRIBUTOR_ROLES, requireDistributor, Roles } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { OrderWorkflowService } from '../orders/order-workflow.service';
import { DistributorService } from './distributor.service';

const Reject = z.object({ reason: z.string().trim().min(3, 'Tell the shop why').max(200) });
const Bill = z.object({
  invoiceNo: z.string().trim().max(40).optional(),
  billed: z.array(z.object({ orderItemId: z.string().uuid(), billedQty: z.number().int().min(0) })).optional(),
});
const Approve = z.object({
  partyCode: z.string().trim().min(1).max(40),
  creditLimitPaise: z.number().int().min(0).max(2_000_000_000),
  creditDays: z.number().int().min(0).max(180).default(30),
});

@ApiTags('distributor')
@ApiBearerAuth()
@Roles(...DISTRIBUTOR_ROLES)
@Controller('distributor')
export class DistributorController {
  constructor(
    private readonly svc: DistributorService,
    private readonly workflow: OrderWorkflowService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser) {
    return this.svc.dashboard(requireDistributor(u));
  }

  @Get('lanes')
  lanes(@CurrentUser() u: AuthUser) {
    return this.svc.lanes(requireDistributor(u));
  }

  @Get('orders/closed')
  closed(@CurrentUser() u: AuthUser) {
    return this.svc.closed(requireDistributor(u));
  }

  @Post('orders/accept-all')
  acceptAll(@CurrentUser() u: AuthUser) {
    return this.svc.acceptAll(u, requireDistributor(u));
  }

  @Post('orders/:id/accept')
  accept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = requireDistributor(u);
    return this.workflow.transition(id, 'ACCEPTED', this.svc.actor(u, d));
  }

  @Post('orders/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reject)) b: z.infer<typeof Reject>) {
    const d = requireDistributor(u);
    return this.workflow.transition(id, 'REJECTED', this.svc.actor(u, d), { reason: b.reason });
  }

  /** Bill from the console (when not using the sync agent). Bills what is in stock unless quantities are given. */
  @Post('orders/:id/bill')
  bill(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Bill)) b: z.infer<typeof Bill>) {
    const d = requireDistributor(u);
    return this.workflow.transition(id, 'BILLED', this.svc.actor(u, d), { bill: b });
  }

  @Post('orders/:id/dispatch')
  dispatch(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = requireDistributor(u);
    return this.workflow.transition(id, 'DISPATCHED', this.svc.actor(u, d));
  }

  @Post('orders/:id/deliver')
  deliver(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = requireDistributor(u);
    return this.workflow.transition(id, 'DELIVERED', this.svc.actor(u, d));
  }

  @Get('shops')
  shops(@CurrentUser() u: AuthUser) {
    return this.svc.shops(requireDistributor(u));
  }

  @Roles('DISTRIBUTOR_ADMIN')
  @Post('links/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Approve)) b: z.infer<typeof Approve>) {
    return this.svc.decideLink(u, requireDistributor(u), id, true, b);
  }

  @Roles('DISTRIBUTOR_ADMIN')
  @Post('links/:id/decline')
  decline(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.decideLink(u, requireDistributor(u), id, false, {});
  }

  @Get('low-stock')
  lowStock(@CurrentUser() u: AuthUser) {
    return this.svc.lowStock(requireDistributor(u));
  }
}
