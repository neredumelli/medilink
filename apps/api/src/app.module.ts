import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './prisma.service';
import { JwtAuthGuard, RolesGuard } from './common/auth';
import { AuditService } from './common/audit.service';
import { NotifyService } from './common/notify.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { OtpSender } from './auth/otp.sender';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { OrderWorkflowService } from './orders/order-workflow.service';
import { ShopController } from './shop/shop.controller';
import { ShopService } from './shop/shop.service';
import { DistributorController } from './distributor/distributor.controller';
import { DistributorService } from './distributor/distributor.service';
import { SyncController } from './sync/sync.controller';
import { SyncService } from './sync/sync.service';
import { AgentGuard } from './sync/agent.guard';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { HealthController } from './health.controller';

@Module({
  imports: [JwtModule.register({}), ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' })],
  controllers: [HealthController, AuthController, CatalogController, ShopController, DistributorController, SyncController, AdminController],
  providers: [
    PrismaService,
    AuditService,
    NotifyService,
    OtpSender,
    AuthService,
    CatalogService,
    OrderWorkflowService,
    ShopService,
    DistributorService,
    SyncService,
    AgentGuard,
    AdminService,
    // Order matters: rate limit, then authentication, then role checks.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
