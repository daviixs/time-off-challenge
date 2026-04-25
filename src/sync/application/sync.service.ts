import {
  type ValidatedBalancePayload,
  validateHcmBalancePayload,
} from '../../hcm/hcm-balance-payload';
import {
  type BalanceProjection,
  type LeaveType,
  type TimeOffRequest,
} from '../../time-off/domain/time-off.types';

type IncomingBalance = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  availableDays: number;
  sourceUpdatedAt: Date;
};

type ValidatedIncomingBalance = ValidatedBalancePayload;

type BalanceStore = {
  findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection | null>;
  upsert(balance: BalanceProjection): Promise<BalanceProjection>;
};

type RequestStore = {
  findPendingByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<TimeOffRequest[]>;
  setAtRisk(requestId: string, atRisk: boolean): Promise<void>;
};

type SyncLogStore = {
  create(entry: {
    syncType: 'BATCH' | 'REALTIME';
    triggeredBy: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    recordsProcessed: number;
    skipped: number;
  }): Promise<void>;
};

type Clock = {
  now(): Date;
};

export class SyncService {
  constructor(
    private readonly dependencies: {
      balances: BalanceStore;
      requests: RequestStore;
      syncLogs: SyncLogStore;
      clock: Clock;
    },
  ) {}

  async syncRealtime(input: {
    triggeredBy: string;
    balance: IncomingBalance;
  }): Promise<{ synced: boolean; skipped: boolean }> {
    const existing = await this.dependencies.balances.findByDimension(
      input.balance.employeeId,
      input.balance.locationId,
      input.balance.leaveType,
    );

    const validated = this.validateIncomingBalance(input.balance);

    if (
      existing?.sourceUpdatedAt &&
      existing.sourceUpdatedAt.getTime() >= validated.sourceUpdatedAt.getTime()
    ) {
      await this.dependencies.syncLogs.create({
        syncType: 'REALTIME',
        triggeredBy: input.triggeredBy,
        status: 'SUCCESS',
        recordsProcessed: 0,
        skipped: 1,
      });
      return { synced: false, skipped: true };
    }

    const balance = await this.upsertIncomingBalance(validated);
    await this.updateAtRiskFlags(balance);
    await this.dependencies.syncLogs.create({
      syncType: 'REALTIME',
      triggeredBy: input.triggeredBy,
      status: 'SUCCESS',
      recordsProcessed: 1,
      skipped: 0,
    });
    return { synced: true, skipped: false };
  }

  async syncBatch(input: {
    triggeredBy: string;
    balances: IncomingBalance[];
  }): Promise<{ processed: number; failed: number; skipped: number }> {
    let processed = 0;
    let skipped = 0;

    for (const balance of input.balances) {
      const validated = this.validateIncomingBalance(balance);
      const existing = await this.dependencies.balances.findByDimension(
        validated.employeeId,
        validated.locationId,
        validated.leaveType,
      );

      if (
        existing?.sourceUpdatedAt &&
        existing.sourceUpdatedAt.getTime() > validated.sourceUpdatedAt.getTime()
      ) {
        skipped += 1;
        continue;
      }

      const upserted = await this.upsertIncomingBalance(validated);
      await this.updateAtRiskFlags(upserted);
      processed += 1;
    }

    await this.dependencies.syncLogs.create({
      syncType: 'BATCH',
      triggeredBy: input.triggeredBy,
      status: 'SUCCESS',
      recordsProcessed: processed,
      skipped,
    });

    return { processed, failed: 0, skipped };
  }

  private validateIncomingBalance(
    input: IncomingBalance,
  ): ValidatedIncomingBalance {
    return validateHcmBalancePayload(input);
  }

  private async upsertIncomingBalance(
    input: ValidatedIncomingBalance,
  ): Promise<BalanceProjection> {
    const existing = await this.dependencies.balances.findByDimension(
      input.employeeId,
      input.locationId,
      input.leaveType,
    );
    const now = this.dependencies.clock.now();

    return this.dependencies.balances.upsert({
      employeeId: input.employeeId,
      locationId: input.locationId,
      leaveType: input.leaveType,
      availableDays: input.availableDays,
      sourceUpdatedAt: input.sourceUpdatedAt,
      lastSyncedAt: now,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private async updateAtRiskFlags(balance: BalanceProjection): Promise<void> {
    const pendingRequests =
      await this.dependencies.requests.findPendingByDimension(
        balance.employeeId,
        balance.locationId,
        balance.leaveType,
      );

    for (const request of pendingRequests) {
      await this.dependencies.requests.setAtRisk(
        request.id,
        request.durationDays > balance.availableDays,
      );
    }
  }
}
