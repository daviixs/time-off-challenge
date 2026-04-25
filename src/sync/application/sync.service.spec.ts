/* eslint-disable @typescript-eslint/require-await */

import {
  type BalanceProjection,
  type TimeOffRequest,
  LeaveType,
} from '../../time-off/domain/time-off.types';
import { SyncService } from './sync.service';

class InMemoryBalances {
  public upserts: BalanceProjection[] = [];

  constructor(private readonly balances: BalanceProjection[] = []) {}

  async findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection | null> {
    return (
      this.balances.find(
        (balance) =>
          balance.employeeId === employeeId &&
          balance.locationId === locationId &&
          balance.leaveType === leaveType,
      ) ?? null
    );
  }

  async upsert(balance: BalanceProjection): Promise<BalanceProjection> {
    const existingIndex = this.balances.findIndex(
      (item) =>
        item.employeeId === balance.employeeId &&
        item.locationId === balance.locationId &&
        item.leaveType === balance.leaveType,
    );

    if (existingIndex >= 0) {
      this.balances[existingIndex] = balance;
    } else {
      this.balances.push(balance);
    }

    this.upserts.push(balance);
    return balance;
  }
}

class InMemoryRequests {
  public atRiskUpdates: Array<{ requestId: string; atRisk: boolean }> = [];

  constructor(private readonly requests: TimeOffRequest[]) {}

  async findPendingByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<TimeOffRequest[]> {
    return this.requests.filter(
      (request) =>
        request.employeeId === employeeId &&
        request.locationId === locationId &&
        request.leaveType === leaveType &&
        request.status === 'PENDING',
    );
  }

  async setAtRisk(requestId: string, atRisk: boolean): Promise<void> {
    const request = this.requests.find((item) => item.id === requestId);
    if (request) {
      request.atRisk = atRisk;
      this.atRiskUpdates.push({ requestId, atRisk });
    }
  }
}

class InMemorySyncLogs {
  public entries: Array<{
    syncType: 'BATCH' | 'REALTIME';
    triggeredBy: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    recordsProcessed: number;
    skipped: number;
  }> = [];

  async create(entry: {
    syncType: 'BATCH' | 'REALTIME';
    triggeredBy: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    recordsProcessed: number;
    skipped: number;
  }): Promise<void> {
    this.entries.push(entry);
  }
}

describe('SyncService', () => {
  const existingBalance: BalanceProjection = {
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    availableDays: 8,
    lastSyncedAt: new Date('2026-04-24T00:03:00.000Z'),
    sourceUpdatedAt: new Date('2026-04-24T00:03:00.000Z'),
    version: 1,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:03:00.000Z'),
  };

  const pendingRequest: TimeOffRequest = {
    id: 'request-1',
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    endDate: new Date('2026-05-05T00:00:00.000Z'),
    durationDays: 5,
    status: 'PENDING',
    statusReason: null,
    notes: null,
    managerNotes: null,
    resolvedAt: null,
    resolvedBy: null,
    hcmTransactionId: null,
    atRisk: false,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };

  function buildService(overrides?: {
    balances?: InMemoryBalances;
    requests?: InMemoryRequests;
    syncLogs?: InMemorySyncLogs;
  }): SyncService {
    return new SyncService({
      balances: overrides?.balances ?? new InMemoryBalances([existingBalance]),
      requests:
        overrides?.requests ?? new InMemoryRequests([{ ...pendingRequest }]),
      syncLogs: overrides?.syncLogs ?? new InMemorySyncLogs(),
      clock: {
        now: () => new Date('2026-04-24T00:06:00.000Z'),
      },
    });
  }

  it('upserts realtime balances and marks pending requests at risk when the new balance is too low', async () => {
    const requests = new InMemoryRequests([{ ...pendingRequest }]);
    const balances = new InMemoryBalances([{ ...existingBalance }]);
    const syncLogs = new InMemorySyncLogs();
    const service = buildService({ requests, balances, syncLogs });

    const result = await service.syncRealtime({
      triggeredBy: 'hcm-realtime',
      balance: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        availableDays: 4,
        sourceUpdatedAt: new Date('2026-04-24T00:05:30.000Z'),
      },
    });

    expect(result.synced).toBe(true);
    expect(balances.upserts.at(-1)?.availableDays).toBe(4);
    expect(requests.atRiskUpdates).toEqual([
      { requestId: 'request-1', atRisk: true },
    ]);
    expect(syncLogs.entries.at(-1)).toMatchObject({
      syncType: 'REALTIME',
      status: 'SUCCESS',
      recordsProcessed: 1,
    });
  });

  it('skips stale realtime balances when a fresher projection already exists', async () => {
    const balances = new InMemoryBalances([{ ...existingBalance }]);
    const syncLogs = new InMemorySyncLogs();
    const service = buildService({ balances, syncLogs });

    const result = await service.syncRealtime({
      triggeredBy: 'hcm-realtime',
      balance: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        availableDays: 4,
        sourceUpdatedAt: new Date('2026-04-24T00:02:00.000Z'),
      },
    });

    expect(result).toEqual({ synced: false, skipped: true });
    expect(balances.upserts).toHaveLength(0);
    expect(syncLogs.entries.at(-1)).toMatchObject({
      syncType: 'REALTIME',
      status: 'SUCCESS',
      recordsProcessed: 0,
      skipped: 1,
    });
  });

  it('skips older batch records when a fresher projection already exists', async () => {
    const balances = new InMemoryBalances([{ ...existingBalance }]);
    const syncLogs = new InMemorySyncLogs();
    const service = buildService({ balances, syncLogs });

    const result = await service.syncBatch({
      triggeredBy: 'hcm-batch',
      balances: [
        {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
          availableDays: 12,
          sourceUpdatedAt: new Date('2026-04-24T00:02:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({ processed: 0, failed: 0, skipped: 1 });
    expect(balances.upserts).toHaveLength(0);
    expect(syncLogs.entries.at(-1)).toMatchObject({
      syncType: 'BATCH',
      status: 'SUCCESS',
      recordsProcessed: 0,
      skipped: 1,
    });
  });

  it('upserts newer batch records and records processed counts', async () => {
    const balances = new InMemoryBalances([{ ...existingBalance }]);
    const syncLogs = new InMemorySyncLogs();
    const service = buildService({ balances, syncLogs });

    const result = await service.syncBatch({
      triggeredBy: 'hcm-batch',
      balances: [
        {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
          availableDays: 12,
          sourceUpdatedAt: new Date('2026-04-24T00:08:00.000Z'),
        },
      ],
    });

    expect(result).toEqual({ processed: 1, failed: 0, skipped: 0 });
    expect(balances.upserts.at(-1)?.availableDays).toBe(12);
    expect(syncLogs.entries.at(-1)).toMatchObject({
      syncType: 'BATCH',
      status: 'SUCCESS',
      recordsProcessed: 1,
      skipped: 0,
    });
  });

  it('rejects invalid incoming balances with negative available days', async () => {
    const service = buildService();

    await expect(
      service.syncRealtime({
        triggeredBy: 'hcm-realtime',
        balance: {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
          availableDays: -1,
          sourceUpdatedAt: new Date('2026-04-24T00:11:00.000Z'),
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });
});
