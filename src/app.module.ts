import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { HcmOperationLogRepository } from './audit/infrastructure/hcm-operation-log.repository';
import { BalancesService } from './balances/application/balances.service';
import { BalancesController } from './balances/balances.controller';
import { BalanceDimensionLeaseRepository } from './balances/infrastructure/balance-dimension-lease.repository';
import { BalanceRepository } from './balances/infrastructure/balance.repository';
import { SystemClock } from './common/clock/system-clock';
import { EmployeeRepository } from './employees/infrastructure/employee.repository';
import { HcmClientService } from './hcm/hcm-client.service';
import { HcmOperationRepository } from './hcm/infrastructure/hcm-operation.repository';
import { PrismaModule } from './prisma/prisma.module';
import { SyncService } from './sync/application/sync.service';
import { SyncController } from './sync/sync.controller';
import { SyncLogRepository } from './sync/infrastructure/sync-log.repository';
import { RequestQueryService } from './time-off/application/request-query.service';
import { RequestsService } from './time-off/application/requests.service';
import { RequestIdempotencyRepository } from './time-off/infrastructure/request-idempotency.repository';
import { TimeOffController } from './time-off/time-off.controller';
import { TimeOffRequestRepository } from './time-off/infrastructure/time-off-request.repository';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [
    AppController,
    TimeOffController,
    BalancesController,
    SyncController,
  ],
  providers: [
    SystemClock,
    EmployeeRepository,
    BalanceRepository,
    BalanceDimensionLeaseRepository,
    TimeOffRequestRepository,
    RequestIdempotencyRepository,
    SyncLogRepository,
    HcmOperationLogRepository,
    HcmOperationRepository,
    HcmClientService,
    RequestQueryService,
    {
      provide: RequestsService,
      useFactory: (
        employees: EmployeeRepository,
        balances: BalanceRepository,
        requests: TimeOffRequestRepository,
        hcmClient: HcmClientService,
        clock: SystemClock,
        idempotency: RequestIdempotencyRepository,
        operations: HcmOperationRepository,
        leases: BalanceDimensionLeaseRepository,
        configService: ConfigService,
      ) =>
        new RequestsService({
          employees,
          balances,
          requests,
          hcmClient,
          clock,
          balanceTtlMs: Number(configService.get('BALANCE_TTL_MS') ?? 300000),
          balanceDimensionLeaseTtlMs: Number(
            configService.get('BALANCE_DIMENSION_LEASE_TTL_MS') ?? 30000,
          ),
          idempotency,
          operations,
          leases,
        }),
      inject: [
        EmployeeRepository,
        BalanceRepository,
        TimeOffRequestRepository,
        HcmClientService,
        SystemClock,
        RequestIdempotencyRepository,
        HcmOperationRepository,
        BalanceDimensionLeaseRepository,
        ConfigService,
      ],
    },
    {
      provide: BalancesService,
      useFactory: (
        balances: BalanceRepository,
        hcmClient: HcmClientService,
        clock: SystemClock,
        configService: ConfigService,
      ) =>
        new BalancesService({
          balances,
          hcmClient,
          clock,
          balanceTtlMs: Number(configService.get('BALANCE_TTL_MS') ?? 300000),
        }),
      inject: [BalanceRepository, HcmClientService, SystemClock, ConfigService],
    },
    {
      provide: SyncService,
      useFactory: (
        balances: BalanceRepository,
        requests: TimeOffRequestRepository,
        syncLogs: SyncLogRepository,
        clock: SystemClock,
      ) =>
        new SyncService({
          balances,
          requests,
          syncLogs,
          clock,
        }),
      inject: [
        BalanceRepository,
        TimeOffRequestRepository,
        SyncLogRepository,
        SystemClock,
      ],
    },
  ],
})
export class AppModule {}
