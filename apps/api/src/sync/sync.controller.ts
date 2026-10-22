import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Public } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { AgentGuard } from './agent.guard';
import { AgentWithDistributor, SyncService } from './sync.service';

const Heartbeat = z.object({ version: z.string().max(20) });
const Stock = z.object({
  items: z
    .array(
      z.object({
        externalCode: z.string().min(1).max(40),
        name: z.string().min(1).max(120),
        stockQty: z.number().min(0),
        ptr: z.number().min(0),
        mrp: z.number().min(0).optional(),
        discountPct: z.number().min(0).max(100).optional(),
        scheme: z.string().max(20).optional(),
        nearestExpiry: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional(),
        barcode: z.string().max(20).optional(),
        /** Optional batch-wise stock. When sent, it replaces the item's batches and sets the nearest expiry. */
        batches: z
          .array(
            z.object({
              batchNo: z.string().trim().min(1).max(30),
              expiry: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
              qty: z.number().min(0),
              mrp: z.number().min(0).optional(),
            }),
          )
          .max(200)
          .optional(),
      }),
    )
    .max(5000),
});
const Ack = z.object({ erpRef: z.string().min(1).max(60) });
const Billed = z.object({ invoiceNo: z.string().min(1).max(40), lines: z.array(z.object({ externalCode: z.string(), billedQty: z.number().int().min(0) })) });
const Outstanding = z.object({ rows: z.array(z.object({ partyCode: z.string().min(1), outstanding: z.number() })).max(10000) });

/** Endpoints used only by the MediLink sync agent on the distributor's billing PC. */
@ApiTags('sync-agent')
@Public()
@UseGuards(AgentGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Req() req: { agent: AgentWithDistributor }, @Body(new ZodPipe(Heartbeat)) b: z.infer<typeof Heartbeat>) {
    return this.sync.heartbeat(req.agent, b.version);
  }

  @Post('stock')
  @HttpCode(200)
  stock(@Req() req: { agent: AgentWithDistributor }, @Body(new ZodPipe(Stock)) b: z.infer<typeof Stock>) {
    return this.sync.pushStock(req.agent, b.items);
  }

  @Get('orders/pending')
  pending(@Req() req: { agent: AgentWithDistributor }) {
    return this.sync.pendingOrders(req.agent);
  }

  @Post('orders/:number/ack')
  @HttpCode(200)
  ack(@Req() req: { agent: AgentWithDistributor }, @Param('number') number: string, @Body(new ZodPipe(Ack)) b: z.infer<typeof Ack>) {
    return this.sync.ackOrder(req.agent, number, b.erpRef);
  }

  @Post('orders/:number/billed')
  @HttpCode(200)
  billed(@Req() req: { agent: AgentWithDistributor }, @Param('number') number: string, @Body(new ZodPipe(Billed)) b: z.infer<typeof Billed>) {
    return this.sync.billed(req.agent, number, b);
  }

  @Post('outstanding')
  @HttpCode(200)
  outstanding(@Req() req: { agent: AgentWithDistributor }, @Body(new ZodPipe(Outstanding)) b: z.infer<typeof Outstanding>) {
    return this.sync.outstanding(req.agent, b.rows);
  }
}
