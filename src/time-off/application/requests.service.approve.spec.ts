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
    throw new Error('Not used in approval tests');
  }

  async findById(id: string): Promise<TimeOffRequest | null> {
    return this.requests.find((request) => request.id === id) ?? null;
  }

  async beginApproval(requestId: string): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'PENDING') {
      return null;
    }

    request.status = 'APPROVAL_IN_PROGRESS';
    return request;
  }

  async finalizeApproval(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
    hcmTransactionId: string;
  }): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === input.requestId);
    if (!request || request.status !== 'APPROVAL_IN_PROGRESS') {
      return null;
    }

    request.status = 'APPROVED';
    request.resolvedBy = input.resolvedBy;
    request.resolvedAt = input.resolvedAt;
    request.managerNotes = input.managerNotes;
    request.hcmTransactionId = input.hcmTransactionId;
    request.updatedAt = input.resolvedAt;
    return request;
  }

  async markApprovalUnknown(requestId: string): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'APPROVAL_IN_PROGRESS') {
      return null;
    }

    request.status = 'APPROVAL_UNKNOWN';
    return request;
  }

  async revertApprovalToPending(
    requestId: string,
  ): Promise<TimeOffRequest | null> {
    const request = this.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'APPROVAL_IN_PROGRESS') {
      return null;
    }

    request.status = 'PENDING';
    return request;
  }

  async rejectPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in approval tests');
  }

  async cancelPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in approval tests');
  }

  async beginCancellation(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in approval tests');
  }

  async finalizeCancellation(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in approval tests');
  }

  async markCancellationUnknown(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in approval tests');
  }

  async revertCancellationToApproved(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in approval tests');
  }
}

class FakeRequestIdempotency {
  async findByKey() {
    return null;
  }

  async createPending() {
    throw new Error('Not used in approval tests');
  }

  async complete() {
    throw new Error('Not used in approval tests');
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
  public fetched: string[] = [];
  public consumed: string[] = [];

  constructor(
    private readonly behavior: {
      getBalance: () => Promise<BalanceProjection>;
      consume: () => Promise<{
        transactionId: string;
        balance: BalanceProjection;
      }>;
    },
  ) {}

  async getBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection> {
    this.fetched.push(`${employeeId}:${locationId}:${leaveType}`);
    return this.behavior.getBalance();
  }

  async consumeBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
    requestId: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string; balance: BalanceProjection }> {
    this.consumed.push(
      `${input.requestId}:${input.days}:${input.idempotencyKey}`,
    );
    return this.behavior.consume();
  }

  async restoreBalance(): Promise<{
    transactionId: string;
    balance: BalanceProjection;
  }> {
    throw new Error('Not used in approval tests');
  }
}

describe('RequestsService.approveRequest', () => {
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

  const pendingRequest: TimeOffRequest = {
    id: 'request-1',
    employeeId: employee.id,
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    endDate: new Date('2026-05-03T00:00:00.000Z'),
    durationDays: 3,
    status: 'PENDING',
    statusReason: null,
    notes: 'Trip',
    managerNotes: null,
    resolvedAt: null,
    resolvedBy: null,
    hcmTransactionId: null,
    atRisk: false,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };

  const balance: BalanceProjection = {
    employeeId: employee.id,
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    availableDays: 10,
    lastSyncedAt: new Date('2026-04-24T00:04:00.000Z'),
    sourceUpdatedAt: new Date('2026-04-24T00:04:00.000Z'),
    version: 1,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:04:00.000Z'),
  };

  function buildService(overrides?: {
    requests?: InMemoryRequests;
    balances?: InMemoryBalances;
    hcmClient?: FakeHcmClient;
  }): RequestsService {
    return new RequestsService({
      employees: new InMemoryEmployees([employee, manager]),
      requests:
        overrides?.requests ??
        new InMemoryRequests([
          {
            ...pendingRequest,
            startDate: new Date(pendingRequest.startDate),
            endDate: new Date(pendingRequest.endDate),
            createdAt: new Date(pendingRequest.createdAt),
            updatedAt: new Date(pendingRequest.updatedAt),
          },
        ]),
      balances: overrides?.balances ?? new InMemoryBalances([{ ...balance }]),
      hcmClient:
        overrides?.hcmClient ??
        new FakeHcmClient({
          getBalance: async () => ({ ...balance }),
          consume: async () => ({
            transactionId: 'hcm-tx-001',
            balance: {
              ...balance,
              availableDays: 7,
              version: 2,
              lastSyncedAt: new Date('2026-04-24T00:05:00.000Z'),
              updatedAt: new Date('2026-04-24T00:05:00.000Z'),
            },
          }),
        }),
      clock: {
        now: () => new Date('2026-04-24T00:05:00.000Z'),
      },
      balanceTtlMs: 5 * 60 * 1000,
      balanceDimensionLeaseTtlMs: 30_000,
      idempotency: new FakeRequestIdempotency(),
      operations: new FakeHcmOperations(),
      leases: new FakeLeases(),
    });
  }

  it('approves a pending request only after HCM confirms the balance consumption', async () => {
    const balances = new InMemoryBalances([{ ...balance }]);
    const requests = new InMemoryRequests([{ ...pendingRequest }]);
    const statusAtConsume: string[] = [];
    const hcmClient = new FakeHcmClient({
      getBalance: async () => ({ ...balance }),
      consume: async () => {
        statusAtConsume.push(
          (await requests.findById(pendingRequest.id))?.status ?? 'missing',
        );
        return {
          transactionId: 'hcm-tx-001',
          balance: {
            ...balance,
            availableDays: 7,
            version: 2,
            lastSyncedAt: new Date('2026-04-24T00:05:00.000Z'),
            updatedAt: new Date('2026-04-24T00:05:00.000Z'),
          },
        };
      },
    });
    const service = buildService({ balances, requests, hcmClient });

    const approved = await service.approveRequest(
      { userId: manager.id, role: manager.role },
      pendingRequest.id,
      { notes: 'Approved' },
    );

    expect(approved.status).toBe('APPROVED');
    expect(approved.resolvedBy).toBe(manager.id);
    expect(approved.hcmTransactionId).toBe('hcm-tx-001');
    expect(hcmClient.consumed).toEqual([
      'request-1:3:time-off:request-1:consume:v1',
    ]);
    expect(statusAtConsume).toEqual(['APPROVAL_IN_PROGRESS']);
    expect(balances.updates.at(-1)?.availableDays).toBe(7);
  });

  it('rejects approval when HCM reports a lower authoritative balance than the request requires', async () => {
    const balances = new InMemoryBalances([{ ...balance }]);
    const requests = new InMemoryRequests([{ ...pendingRequest }]);
    const hcmClient = new FakeHcmClient({
      getBalance: async () => ({
        ...balance,
        availableDays: 2,
        version: 2,
      }),
      consume: async () => {
        throw new Error('should not consume');
      },
    });
    const service = buildService({ balances, requests, hcmClient });

    await expect(
      service.approveRequest(
        { userId: manager.id, role: manager.role },
        pendingRequest.id,
        { notes: 'Approved' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'INSUFFICIENT_BALANCE',
      statusCode: 422,
    });
    expect((await requests.findById(pendingRequest.id))?.status).toBe(
      'PENDING',
    );
    expect(balances.updates.at(-1)?.availableDays).toBe(2);
  });

  it('leaves the request pending when HCM is unavailable', async () => {
    const requests = new InMemoryRequests([{ ...pendingRequest }]);
    const service = buildService({
      requests,
      hcmClient: new FakeHcmClient({
        getBalance: async () => {
          throw new AppError(
            'HCM_UNAVAILABLE',
            503,
            'Cannot reach authoritative HCM.',
          );
        },
        consume: async () => {
          throw new Error('should not consume');
        },
      }),
    });

    await expect(
      service.approveRequest(
        { userId: manager.id, role: manager.role },
        pendingRequest.id,
        { notes: 'Approved' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });
    expect((await requests.findById(pendingRequest.id))?.status).toBe(
      'PENDING',
    );
  });

  it('forbids non-managers from approving requests', async () => {
    const service = buildService();

    await expect(
      service.approveRequest(
        { userId: employee.id, role: employee.role },
        pendingRequest.id,
        { notes: 'Nope' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
  });

  it('rejects attempts to approve non-pending requests', async () => {
    const requests = new InMemoryRequests([
      {
        ...pendingRequest,
        status: 'APPROVED',
      },
    ]);
    const service = buildService({ requests });

    await expect(
      service.approveRequest(
        { userId: manager.id, role: manager.role },
        pendingRequest.id,
        { notes: 'Approved' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'REQUEST_NOT_PENDING',
      statusCode: 422,
    });
  });
});
