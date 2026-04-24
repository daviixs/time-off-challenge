/* eslint-disable @typescript-eslint/require-await */

import { AppError } from '../../common/errors/app-error';
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
        ['PENDING', 'APPROVED'].includes(request.status) &&
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

  async approvePending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async rejectPending(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
  }

  async cancelRequest(): Promise<TimeOffRequest | null> {
    throw new Error('Not used in create tests');
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
