import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
import { DataController } from './admin/data.controller';
import { DataService } from './admin/data.service';
import { HealthController } from './health.controller';
import { PublicController } from './public.controller';
import { SettingsService } from './common/settings.service';
import { AccessPolicyGuard } from './common/access-policy.guard';
import { AllErrorsFilter } from './common/error.filter';
import { RequestRefMiddleware } from './common/request-ref';

@Module({
  imports: [JwtModule.register({}), ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 300 }], skipIf: () => process.env.NODE_ENV === 'test' })],
  controllers: [HealthController, PublicController, AuthController, CatalogController, ShopController, DistributorController, SyncController, AdminController, DataController],
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
    DataService,
    SettingsService,
    // Order matters: rate limit, then authentication, then role checks.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Maintenance mode and minimum app version, after we know who the user is.
    { provide: APP_GUARD, useClass: AccessPolicyGuard },
    // Every error leaves in one friendly shape with a reference code.
    { provide: APP_FILTER, useClass: AllErrorsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestRefMiddleware).forRoutes('*');
  }
}
