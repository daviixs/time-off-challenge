/* eslint-disable @typescript-eslint/require-await */

import { AppError } from '../../common/errors/app-error';
import {
  type BalanceProjection,
  type Employee,
  type TimeOffRequest,
  LeaveType,
  Role,
} from '../domain/time-off.types';
import { RequestsService } from './requests.service';

class InMemoryEmployees {
  constructor(private readonly employees: Employee[]) {}

  async findById(id: string): Promise<Employee | null> {
    return this.employees.find((employee) => employee.id === id) ?? null;
  }
}

class InMemoryBalances {
  public updates: BalanceProjection[] = [];

  constructor(private balances: BalanceProjection[]) {}

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

    this.updates.push(balance);
    return balance;
  }
}

class InMemoryRequests {
  constructor(private readonly requests: TimeOffRequest[]) {}

  async findOverlappingPendingOrApproved(): Promise<TimeOffRequest[]> {
    return [];
  }

  async create(): Promise<TimeOffRequest> {
    throw new Error('Not used in lifecycle tests');
  }

  async findById(id: string): Promise<TimeOffRequest | null> {
    return this.requests.find((request) => request.id === id) ?? null;
  }

  async beginApproval(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in lifecycle tests');
  }

  async finalizeApproval(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in lifecycle tests');
  }

  async markApprovalUnknown(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in lifecycle tests');
  }

  async revertApprovalToPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in lifecycle tests');
  }

  async rejectPending(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === input.requestId);
    if (!request || request.status !== 'PENDING') {
      return null;
    }

    request.status = 'REJECTED';
    request.resolvedBy = input.resolvedBy;
    request.resolvedAt = input.resolvedAt;
    request.managerNotes = input.managerNotes;
    request.updatedAt = input.resolvedAt;
    return request;
  }

  async cancelPending(input: {
    requestId: string;
    resolvedBy: string;
    statusReason: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === input.requestId);
    if (!request || request.status !== 'PENDING') {
      return null;
    }

    request.status = 'CANCELLED';
    request.resolvedBy = input.resolvedBy;
    request.resolvedAt = input.resolvedAt;
    request.statusReason = input.statusReason;
    request.updatedAt = input.resolvedAt;
    return request;
  }

  async beginCancellation(requestId: string): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'APPROVED') {
      return null;
    }

    request.status = 'CANCELLATION_IN_PROGRESS';
    return request;
  }

  async finalizeCancellation(input: {
    requestId: string;
    resolvedBy: string;
    statusReason: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === input.requestId);
    if (!request || request.status !== 'CANCELLATION_IN_PROGRESS') {
      return null;
    }

    request.status = 'CANCELLED';
    request.resolvedBy = input.resolvedBy;
    request.resolvedAt = input.resolvedAt;
    request.statusReason = input.statusReason;
    request.updatedAt = input.resolvedAt;
    return request;
  }

  async markCancellationUnknown(
    requestId: string,
  ): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'CANCELLATION_IN_PROGRESS') {
      return null;
    }

    request.status = 'CANCELLATION_UNKNOWN';
    return request;
  }

  async revertCancellationToApproved(
    requestId: string,
  ): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'CANCELLATION_IN_PROGRESS') {
      return null;
    }

    request.status = 'APPROVED';
    return request;
  }
}

class FakeRequestIdempotency {
  async findByKey() {
    return null;
  }

  async createPending() {
    throw new Error('Not used in lifecycle tests');
  }

  async complete() {
    throw new Error('Not used in lifecycle tests');
  }

  async deletePending() {
    return undefined;
  }
}

class FakeHcmOperations {
  private readonly records = new Map<
    string,
    {
      requestId: string;
      operationType: 'CONSUME' | 'RESTORE';
      idempotencyKey: string;
      status: 'PENDING' | 'SUCCESS' | 'UNKNOWN' | 'FAILED';
      transactionId: string | null;
      responseBody: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }
  >();

  async findByKey(idempotencyKey: string) {
    return this.records.get(idempotencyKey) ?? null;
  }

  async createPending(input: {
    requestId: string;
    operationType: 'CONSUME' | 'RESTORE';
    idempotencyKey: string;
  }) {
    const record = {
      requestId: input.requestId,
      operationType: input.operationType,
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING' as const,
      transactionId: null,
      responseBody: null,
      errorCode: null,
      errorMessage: null,
    };
    this.records.set(input.idempotencyKey, record);
    return record;
  }

  async resetToPending(idempotencyKey: string) {
    const record = this.records.get(idempotencyKey);
    if (!record) {
      throw new Error('missing operation');
    }
    record.status = 'PENDING';
    record.errorCode = null;
    record.errorMessage = null;
    return record;
  }

  async markSuccess(input: {
    idempotencyKey: string;
    transactionId: string;
    responseBody: string;
  }) {
    const record = this.records.get(input.idempotencyKey);
    if (!record) {
      throw new Error('missing operation');
    }
    record.status = 'SUCCESS';
    record.transactionId = input.transactionId;
    record.responseBody = input.responseBody;
    record.errorCode = null;
    record.errorMessage = null;
    return record;
  }

  async markUnknown(input: {
    idempotencyKey: string;
    errorCode: string;
    errorMessage: string;
  }) {
    const record = this.records.get(input.idempotencyKey);
    if (!record) {
      throw new Error('missing operation');
    }
    record.status = 'UNKNOWN';
    record.errorCode = input.errorCode;
    record.errorMessage = input.errorMessage;
    return record;
  }

  async markFailed(input: {
    idempotencyKey: string;
    errorCode: string;
    errorMessage: string;
  }) {
    const record = this.records.get(input.idempotencyKey);
    if (!record) {
      throw new Error('missing operation');
    }
    record.status = 'FAILED';
    record.errorCode = input.errorCode;
    record.errorMessage = input.errorMessage;
    return record;
  }
}

class FakeLeases {
  async acquire(): Promise<boolean> {
    return true;
  }

  async release(): Promise<void> {
    return undefined;
  }
}

class FakeHcmClient {
  public restored: string[] = [];

  constructor(
    private readonly restore: () => Promise<{
      transactionId: string;
      balance: BalanceProjection;
    }>,
  ) {}

  async getBalance(): Promise<BalanceProjection> {
    throw new Error('Not used in lifecycle tests');
  }

  async consumeBalance(): Promise<{
    transactionId: string;
    balance: BalanceProjection;
  }> {
    throw new Error('Not used in lifecycle tests');
  }

  async restoreBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
    requestId: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string; balance: BalanceProjection }> {
    this.restored.push(
      `${input.requestId}:${input.days}:${input.idempotencyKey}`,
    );
    return this.restore();
  }
}

describe('RequestsService reject and cancel lifecycle', () => {
  const employee: Employee = {
    id: 'emp-001',
    name: 'Employee One',
    email: 'emp-001@example.com',
    role: Role.EMPLOYEE,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };

  const manager: Employee = {
    id: 'mgr-001',
    name: 'Manager One',
    email: 'mgr-001@example.com',
    role: Role.MANAGER,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };

  const approvedRequest: TimeOffRequest = {
    id: 'request-approved',
    employeeId: employee.id,
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    endDate: new Date('2026-05-03T00:00:00.000Z'),
    durationDays: 3,
    status: 'APPROVED',
    statusReason: null,
    notes: 'Trip',
    managerNotes: 'Approved',
    resolvedAt: new Date('2026-04-24T00:02:00.000Z'),
    resolvedBy: manager.id,
    hcmTransactionId: 'hcm-tx-001',
    atRisk: false,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:02:00.000Z'),
  };

  const pendingRequest: TimeOffRequest = {
    ...approvedRequest,
    id: 'request-pending',
    status: 'PENDING',
    resolvedAt: null,
    resolvedBy: null,
    managerNotes: null,
    hcmTransactionId: null,
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };

  const balance: BalanceProjection = {
    employeeId: employee.id,
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    availableDays: 7,
    lastSyncedAt: new Date('2026-04-24T00:05:00.000Z'),
    sourceUpdatedAt: new Date('2026-04-24T00:05:00.000Z'),
    version: 2,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:05:00.000Z'),
  };

  function buildService(overrides?: {
    requests?: InMemoryRequests;
    hcmClient?: FakeHcmClient;
    balances?: InMemoryBalances;
  }): RequestsService {
    return new RequestsService({
      employees: new InMemoryEmployees([employee, manager]),
      requests:
        overrides?.requests ??
        new InMemoryRequests([{ ...pendingRequest }, { ...approvedRequest }]),
      balances: overrides?.balances ?? new InMemoryBalances([{ ...balance }]),
      hcmClient:
        overrides?.hcmClient ??
        new FakeHcmClient(async () => ({
          transactionId: 'hcm-tx-restore-001',
          balance: {
            ...balance,
            availableDays: 10,
            version: 3,
            updatedAt: new Date('2026-04-24T00:06:00.000Z'),
            lastSyncedAt: new Date('2026-04-24T00:06:00.000Z'),
          },
        })),
      clock: {
        now: () => new Date('2026-04-24T00:06:00.000Z'),
      },
      balanceTtlMs: 5 * 60 * 1000,
      balanceDimensionLeaseTtlMs: 30_000,
      idempotency: new FakeRequestIdempotency(),
      operations: new FakeHcmOperations(),
      leases: new FakeLeases(),
    });
  }

  it('allows a manager to reject a pending request without calling HCM', async () => {
    const requests = new InMemoryRequests([{ ...pendingRequest }]);
    const hcmClient = new FakeHcmClient(async () => {
      throw new Error('should not restore');
    });
    const service = buildService({ requests, hcmClient });

    const rejected = await service.rejectRequest(
      { userId: manager.id, role: manager.role },
      pendingRequest.id,
      { notes: 'Need coverage during release' },
    );

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.managerNotes).toBe('Need coverage during release');
    expect(hcmClient.restored).toHaveLength(0);
  });

  it('cancels a pending request locally without calling HCM', async () => {
    const requests = new InMemoryRequests([{ ...pendingRequest }]);
    const hcmClient = new FakeHcmClient(async () => {
      throw new Error('should not restore');
    });
    const service = buildService({ requests, hcmClient });

    const cancelled = await service.cancelRequest(
      { userId: employee.id, role: employee.role },
      pendingRequest.id,
      { reason: 'Plans changed' },
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.statusReason).toBe('Plans changed');
    expect(hcmClient.restored).toHaveLength(0);
  });

  it('restores approved balance through HCM before cancelling an approved request', async () => {
    const requests = new InMemoryRequests([{ ...approvedRequest }]);
    const balances = new InMemoryBalances([{ ...balance }]);
    const statusAtRestore: string[] = [];
    const hcmClient = new FakeHcmClient(async () => {
      statusAtRestore.push(
        (await requests.findById(approvedRequest.id))?.status ?? 'missing',
      );
      return {
        transactionId: 'hcm-tx-restore-001',
        balance: {
          ...balance,
          availableDays: 10,
          version: 3,
          updatedAt: new Date('2026-04-24T00:06:00.000Z'),
          lastSyncedAt: new Date('2026-04-24T00:06:00.000Z'),
        },
      };
    });
    const service = buildService({ requests, balances, hcmClient });

    const cancelled = await service.cancelRequest(
      { userId: employee.id, role: employee.role },
      approvedRequest.id,
      { reason: 'Plans changed' },
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(hcmClient.restored).toEqual([
      'request-approved:3:time-off:request-approved:restore:v1',
    ]);
    expect(statusAtRestore).toEqual(['CANCELLATION_IN_PROGRESS']);
    expect(balances.updates.at(-1)?.availableDays).toBe(10);
  });

  it('moves approved cancellation to CANCELLATION_UNKNOWN when HCM restore is ambiguous', async () => {
    const requests = new InMemoryRequests([{ ...approvedRequest }]);
    const hcmClient = new FakeHcmClient(async () => {
      throw new AppError(
        'HCM_RESULT_UNKNOWN',
        503,
        'HCM timed out before confirming the operation result.',
      );
    });
    const service = buildService({ requests, hcmClient });

    await expect(
      service.cancelRequest(
        { userId: employee.id, role: employee.role },
        approvedRequest.id,
        { reason: 'Plans changed' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'HCM_RESULT_UNKNOWN',
      statusCode: 503,
    });

    expect((await requests.findById(approvedRequest.id))?.status).toBe(
      'CANCELLATION_UNKNOWN',
    );
  });

  it('forbids employees from cancelling other employees requests', async () => {
    const service = buildService({
      requests: new InMemoryRequests([{ ...approvedRequest }]),
    });

    await expect(
      service.cancelRequest(
        { userId: 'emp-999', role: Role.EMPLOYEE },
        approvedRequest.id,
        { reason: 'No access' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
  });

  it('rejects cancellation of requests already in a terminal state', async () => {
    const service = buildService({
      requests: new InMemoryRequests([
        {
          ...approvedRequest,
          status: 'REJECTED',
        },
      ]),
    });

    await expect(
      service.cancelRequest(
        { userId: manager.id, role: manager.role },
        approvedRequest.id,
        { reason: 'No longer relevant' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'REQUEST_NOT_PENDING',
      statusCode: 422,
    });
  });
});
