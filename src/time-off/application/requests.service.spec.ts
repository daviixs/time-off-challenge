/* eslint-disable @typescript-eslint/require-await */

import { AppError } from '../../common/errors/app-error';
import { buildCreateRequestIdempotencyHash } from '../../shared/domain/time-off-policy';
import {
  type BalanceProjection,
  type CreateTimeOffRequestInput,
  type Employee,
  type TimeOffRequest,
  type TimeOffRequestStatus,
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
  public created: TimeOffRequest[] = [];

  constructor(private readonly requests: TimeOffRequest[] = []) {}

  async findOverlappingPendingOrApproved(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    startDate: Date,
    endDate: Date,
  ): Promise<TimeOffRequest[]> {
    return this.requests.filter(
      (request) =>
        request.employeeId === employeeId &&
        request.locationId === locationId &&
        request.leaveType === leaveType &&
        [
          'PENDING',
          'APPROVAL_IN_PROGRESS',
          'APPROVAL_UNKNOWN',
          'APPROVED',
          'CANCELLATION_IN_PROGRESS',
          'CANCELLATION_UNKNOWN',
        ].includes(request.status) &&
        request.startDate <= endDate &&
        request.endDate >= startDate,
    );
  }

  async create(
    input: Omit<TimeOffRequest, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TimeOffRequest> {
    const created: TimeOffRequest = {
      ...input,
      id: `request-${this.created.length + 1}`,
      createdAt: new Date('2026-04-24T00:00:00.000Z'),
      updatedAt: new Date('2026-04-24T00:00:00.000Z'),
    };

    this.requests.push(created);
    this.created.push(created);
    return created;
  }

  async findById(id: string): Promise<TimeOffRequest | null> {
    return this.requests.find((request) => request.id === id) ?? null;
  }

  async beginApproval(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async finalizeApproval(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async markApprovalUnknown(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async revertApprovalToPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async rejectPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async cancelPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async beginCancellation(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async finalizeCancellation(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async markCancellationUnknown(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async revertCancellationToApproved(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }
}

class InMemoryRequestIdempotency {
  private readonly records = new Map<
    string,
    {
      idempotencyKey: string;
      requestHash: string;
      status: 'PENDING' | 'COMPLETED';
      requestId: string | null;
      responseBody: string | null;
    }
  >();

  constructor(
    initialRecords: Array<{
      idempotencyKey: string;
      requestHash: string;
      status: 'PENDING' | 'COMPLETED';
      requestId: string | null;
      responseBody: string | null;
    }> = [],
  ) {
    for (const record of initialRecords) {
      this.records.set(record.idempotencyKey, record);
    }
  }

  async findByKey(idempotencyKey: string) {
    return this.records.get(idempotencyKey) ?? null;
  }

  async createPending(input: { idempotencyKey: string; requestHash: string }) {
    const existing = this.records.get(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    const record = {
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      status: 'PENDING' as const,
      requestId: null,
      responseBody: null,
    };
    this.records.set(input.idempotencyKey, record);
    return record;
  }

  async complete(input: {
    idempotencyKey: string;
    requestId: string;
    responseBody: string;
  }) {
    const existing = this.records.get(input.idempotencyKey);
    if (existing) {
      this.records.set(input.idempotencyKey, {
        ...existing,
        status: 'COMPLETED',
        requestId: input.requestId,
        responseBody: input.responseBody,
      });
    }
  }

  async deletePending(idempotencyKey: string) {
    const existing = this.records.get(idempotencyKey);
    if (existing?.status === 'PENDING') {
      this.records.delete(idempotencyKey);
    }
  }
}

class FakeHcmOperations {
  async findByKey() {
    return null;
  }

  async createPending() {
    throw new Error('Not used in create tests');
  }

  async resetToPending() {
    throw new Error('Not used in create tests');
  }

  async markSuccess() {
    throw new Error('Not used in create tests');
  }

  async markUnknown() {
    throw new Error('Not used in create tests');
  }

  async markFailed() {
    throw new Error('Not used in create tests');
  }
}

class FakeLeases {
  constructor(private readonly acquireResult = true) {}

  async acquire(): Promise<boolean> {
    return this.acquireResult;
  }

  async release(): Promise<void> {
    return undefined;
  }
}

class FakeHcmClient {
  public fetched: string[] = [];

  constructor(private readonly balance: BalanceProjection) {}

  async getBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection> {
    this.fetched.push(`${employeeId}:${locationId}:${leaveType}`);
    return this.balance;
  }

  async consumeBalance(): Promise<{
    transactionId: string;
    balance: BalanceProjection;
  }> {
    throw new Error('Not used in create tests');
  }

  async restoreBalance(): Promise<{
    transactionId: string;
    balance: BalanceProjection;
  }> {
    throw new Error('Not used in create tests');
  }
}

describe('RequestsService.createRequest', () => {
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

  const freshBalance: BalanceProjection = {
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    availableDays: 10,
    lastSyncedAt: new Date('2026-04-24T00:03:00.000Z'),
    sourceUpdatedAt: new Date('2026-04-24T00:03:00.000Z'),
    version: 1,
    createdAt: new Date('2026-04-24T00:03:00.000Z'),
    updatedAt: new Date('2026-04-24T00:03:00.000Z'),
  };

  function buildService(overrides?: {
    employees?: InMemoryEmployees;
    balances?: InMemoryBalances;
    requests?: InMemoryRequests;
    hcmClient?: FakeHcmClient;
    idempotency?: InMemoryRequestIdempotency;
    leases?: FakeLeases;
  }): RequestsService {
    return new RequestsService({
      employees:
        overrides?.employees ?? new InMemoryEmployees([employee, manager]),
      balances: overrides?.balances ?? new InMemoryBalances([freshBalance]),
      requests: overrides?.requests ?? new InMemoryRequests(),
      hcmClient:
        overrides?.hcmClient ??
        new FakeHcmClient({
          ...freshBalance,
          availableDays: 10,
          lastSyncedAt: new Date('2026-04-24T00:04:00.000Z'),
          sourceUpdatedAt: new Date('2026-04-24T00:04:00.000Z'),
          version: 2,
        }),
      clock: {
        now: () => new Date('2026-04-24T00:04:00.000Z'),
      },
      balanceTtlMs: 5 * 60 * 1000,
      balanceDimensionLeaseTtlMs: 30_000,
      idempotency: overrides?.idempotency ?? new InMemoryRequestIdempotency(),
      operations: new FakeHcmOperations(),
      leases: overrides?.leases ?? new FakeLeases(),
    });
  }

  function requestInput(): CreateTimeOffRequestInput {
    return {
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      notes: 'Trip',
    };
  }

  it('creates a pending request when employee owns it and fresh balance covers the duration', async () => {
    const requests = new InMemoryRequests();
    const service = buildService({ requests });

    const created = await service.createRequest(
      { userId: employee.id, role: employee.role },
      requestInput(),
    );

    expect(created.status).toBe<TimeOffRequestStatus>('PENDING');
    expect(created.durationDays).toBe(3);
    expect(requests.created).toHaveLength(1);
  });

  it('replays the original response for the same idempotency key and payload', async () => {
    const requests = new InMemoryRequests();
    const idempotency = new InMemoryRequestIdempotency();
    const service = buildService({ requests, idempotency });

    const first = await service.createRequest(
      { userId: employee.id, role: employee.role },
      requestInput(),
      { idempotencyKey: 'create-key-1' },
    );
    const replay = await service.createRequest(
      { userId: employee.id, role: employee.role },
      requestInput(),
      { idempotencyKey: 'create-key-1' },
    );

    expect(replay).toEqual(first);
    expect(requests.created).toHaveLength(1);
  });

  it('rejects idempotency key reuse with a different payload', async () => {
    const idempotency = new InMemoryRequestIdempotency();
    const service = buildService({ idempotency });

    await service.createRequest(
      { userId: employee.id, role: employee.role },
      requestInput(),
      { idempotencyKey: 'create-key-2' },
    );

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        {
          ...requestInput(),
          endDate: '2026-05-04',
        },
        { idempotencyKey: 'create-key-2' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 409,
    });
  });

  it('rejects a duplicate create while the idempotency key is still pending', async () => {
    const input = requestInput();
    const idempotency = new InMemoryRequestIdempotency([
      {
        idempotencyKey: 'pending-key',
        requestHash: buildCreateRequestIdempotencyHash({
          employeeId: input.employeeId,
          locationId: input.locationId,
          leaveType: input.leaveType,
          startDate: input.startDate,
          endDate: input.endDate,
          notes: input.notes ?? null,
        }),
        status: 'PENDING',
        requestId: null,
        responseBody: null,
      },
    ]);
    const service = buildService({ idempotency });

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        input,
        { idempotencyKey: 'pending-key' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
      statusCode: 409,
    });
  });

  it('deletes a pending idempotency row when create fails', async () => {
    const idempotency = new InMemoryRequestIdempotency();
    const service = buildService({
      employees: new InMemoryEmployees([]),
      idempotency,
    });

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        requestInput(),
        { idempotencyKey: 'create-key-3' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'EMPLOYEE_NOT_FOUND',
      statusCode: 404,
    });
    await expect(idempotency.findByKey('create-key-3')).resolves.toBeNull();
  });

  it('rejects create when the balance dimension lease is held', async () => {
    const service = buildService({ leases: new FakeLeases(false) });

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        requestInput(),
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'BALANCE_DIMENSION_LOCKED',
      statusCode: 409,
    });
  });

  it('refreshes a stale balance projection from HCM before creating the request', async () => {
    const balances = new InMemoryBalances([
      {
        ...freshBalance,
        availableDays: 7,
        lastSyncedAt: new Date('2026-04-23T23:50:00.000Z'),
      },
    ]);
    const hcmClient = new FakeHcmClient({
      ...freshBalance,
      availableDays: 12,
      lastSyncedAt: new Date('2026-04-24T00:04:00.000Z'),
      sourceUpdatedAt: new Date('2026-04-24T00:04:00.000Z'),
      version: 2,
    });
    const service = buildService({ balances, hcmClient });

    const created = await service.createRequest(
      { userId: employee.id, role: employee.role },
      requestInput(),
    );

    expect(created.status).toBe('PENDING');
    expect(hcmClient.fetched).toEqual(['emp-001:loc-nyc:VACATION']);
    expect(balances.updates.at(-1)?.availableDays).toBe(12);
  });

  it('rejects requests when the projected balance cannot cover the duration', async () => {
    const balances = new InMemoryBalances([
      {
        ...freshBalance,
        availableDays: 2,
      },
    ]);
    const service = buildService({ balances });

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        requestInput(),
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'INSUFFICIENT_BALANCE',
      statusCode: 422,
    });
  });

  it('rejects overlapping pending or approved requests', async () => {
    const requests = new InMemoryRequests([
      {
        id: 'request-existing',
        employeeId: employee.id,
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        startDate: new Date('2026-05-02'),
        endDate: new Date('2026-05-04'),
        durationDays: 3,
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
      },
    ]);
    const service = buildService({ requests });

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        requestInput(),
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'OVERLAPPING_REQUEST',
      statusCode: 409,
    });
  });

  it('rejects employees trying to create requests for someone else', async () => {
    const service = buildService();

    await expect(
      service.createRequest(
        { userId: manager.id, role: Role.EMPLOYEE },
        requestInput(),
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
  });

  it('rejects inverted date ranges', async () => {
    const service = buildService();

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        {
          ...requestInput(),
          startDate: '2026-05-03',
          endDate: '2026-05-01',
        },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'INVALID_DATE_RANGE',
      statusCode: 400,
    });
  });

  it('rejects requests that end before today', async () => {
    const service = buildService();

    await expect(
      service.createRequest(
        { userId: employee.id, role: employee.role },
        {
          ...requestInput(),
          startDate: '2026-04-20',
          endDate: '2026-04-23',
        },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'INVALID_DATE_RANGE',
      statusCode: 400,
    });
  });
});
