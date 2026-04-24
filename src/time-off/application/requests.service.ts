import { AppError } from '../../common/errors/app-error';
import {
  buildHcmIdempotencyKey,
  calculateInclusiveDurationDays,
  isBalanceStale,
} from '../../shared/domain/time-off-policy';
import {
  type Actor,
  type BalanceProjection,
  type CreateTimeOffRequestInput,
  type Employee,
  type LeaveType,
  Role,
  type TimeOffRequest,
} from '../domain/time-off.types';

type EmployeeStore = {
  findById(id: string): Promise<Employee | null>;
};

type BalanceStore = {
  findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection | null>;
  upsert(balance: BalanceProjection): Promise<BalanceProjection>;
};

type RequestStore = {
  findOverlappingPendingOrApproved(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    startDate: Date,
    endDate: Date,
  ): Promise<TimeOffRequest[]>;
  findById(id: string): Promise<TimeOffRequest | null>;
  create(
    input: Omit<TimeOffRequest, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<TimeOffRequest>;
  approvePending(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
    hcmTransactionId: string;
  }): Promise<TimeOffRequest | null>;
  rejectPending(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null>;
  cancelRequest(input: {
    requestId: string;
    resolvedBy: string;
    statusReason: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null>;
};

type HcmClient = {
  getBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection>;
  consumeBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
    requestId: string;
    idempotencyKey: string;
  }): Promise<{
    transactionId: string;
    balance: BalanceProjection;
  }>;
  restoreBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
    requestId: string;
    idempotencyKey: string;
  }): Promise<{
    transactionId: string;
    balance: BalanceProjection;
  }>;
};

type Clock = {
  now(): Date;
};

type RequestsServiceDependencies = {
  employees: EmployeeStore;
  balances: BalanceStore;
  requests: RequestStore;
  hcmClient: HcmClient;
  clock: Clock;
  balanceTtlMs: number;
};

export class RequestsService {
  constructor(private readonly dependencies: RequestsServiceDependencies) {}

  async createRequest(
    actor: Actor,
    input: CreateTimeOffRequestInput,
  ): Promise<TimeOffRequest> {
    this.assertCanCreate(actor, input.employeeId);

    const employee = await this.dependencies.employees.findById(
      input.employeeId,
    );
    if (!employee) {
      throw new AppError('EMPLOYEE_NOT_FOUND', 404, 'Employee was not found.');
    }

    const startDate = new Date(`${input.startDate}T00:00:00.000Z`);
    const endDate = new Date(`${input.endDate}T00:00:00.000Z`);
    const today = new Date(
      this.dependencies.clock.now().toISOString().slice(0, 10),
    );
    if (startDate > endDate || endDate < today) {
      throw new AppError(
        'INVALID_DATE_RANGE',
        400,
        'Time-off requests must have a valid, non-past date range.',
      );
    }
    const durationDays = calculateInclusiveDurationDays(startDate, endDate);

    const overlappingRequests =
      await this.dependencies.requests.findOverlappingPendingOrApproved(
        employee.id,
        input.locationId,
        input.leaveType,
        startDate,
        endDate,
      );

    if (overlappingRequests.length > 0) {
      throw new AppError(
        'OVERLAPPING_REQUEST',
        409,
        'An existing request already overlaps this period.',
      );
    }

    const balance = await this.getFreshBalance(
      employee.id,
      input.locationId,
      input.leaveType,
    );

    if (balance.availableDays < durationDays) {
      throw new AppError(
        'INSUFFICIENT_BALANCE',
        422,
        `Requested ${durationDays} days but only ${balance.availableDays} remain.`,
      );
    }

    return this.dependencies.requests.create({
      employeeId: employee.id,
      locationId: input.locationId,
      leaveType: input.leaveType,
      startDate,
      endDate,
      durationDays,
      status: 'PENDING',
      statusReason: null,
      notes: input.notes ?? null,
      managerNotes: null,
      resolvedAt: null,
      resolvedBy: null,
      hcmTransactionId: null,
      atRisk: false,
    });
  }

  async approveRequest(
    actor: Actor,
    requestId: string,
    input: { notes?: string },
  ): Promise<TimeOffRequest> {
    if (actor.role !== Role.MANAGER) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Only managers may approve time-off requests.',
      );
    }

    const request = await this.dependencies.requests.findById(requestId);
    if (!request) {
      throw new AppError('REQUEST_NOT_FOUND', 404, 'Request was not found.');
    }

    if (request.status !== 'PENDING') {
      throw new AppError(
        'REQUEST_NOT_PENDING',
        422,
        'Only pending requests may be approved.',
      );
    }

    const authoritativeBalance = await this.dependencies.hcmClient.getBalance(
      request.employeeId,
      request.locationId,
      request.leaveType,
    );
    await this.dependencies.balances.upsert(authoritativeBalance);

    if (authoritativeBalance.availableDays < request.durationDays) {
      throw new AppError(
        'INSUFFICIENT_BALANCE',
        422,
        `Requested ${request.durationDays} days but only ${authoritativeBalance.availableDays} remain.`,
      );
    }

    const consumeResult = await this.dependencies.hcmClient.consumeBalance({
      employeeId: request.employeeId,
      locationId: request.locationId,
      leaveType: request.leaveType,
      days: request.durationDays,
      requestId: request.id,
      idempotencyKey: buildHcmIdempotencyKey(request.id, 'consume'),
    });
    await this.dependencies.balances.upsert(consumeResult.balance);

    const approved = await this.dependencies.requests.approvePending({
      requestId: request.id,
      resolvedBy: actor.userId,
      managerNotes: input.notes ?? null,
      resolvedAt: this.dependencies.clock.now(),
      hcmTransactionId: consumeResult.transactionId,
    });

    if (!approved) {
      throw new AppError(
        'REQUEST_NOT_PENDING',
        422,
        'Only pending requests may be approved.',
      );
    }

    return approved;
  }

  async rejectRequest(
    actor: Actor,
    requestId: string,
    input: { notes?: string },
  ): Promise<TimeOffRequest> {
    if (actor.role !== Role.MANAGER) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Only managers may reject time-off requests.',
      );
    }

    const request = await this.dependencies.requests.findById(requestId);
    if (!request) {
      throw new AppError('REQUEST_NOT_FOUND', 404, 'Request was not found.');
    }

    if (request.status !== 'PENDING') {
      throw new AppError(
        'REQUEST_NOT_PENDING',
        422,
        'Only pending requests may be rejected.',
      );
    }

    const rejected = await this.dependencies.requests.rejectPending({
      requestId,
      resolvedBy: actor.userId,
      managerNotes: input.notes ?? null,
      resolvedAt: this.dependencies.clock.now(),
    });

    if (!rejected) {
      throw new AppError(
        'REQUEST_NOT_PENDING',
        422,
        'Only pending requests may be rejected.',
      );
    }

    return rejected;
  }

  async cancelRequest(
    actor: Actor,
    requestId: string,
    input: { reason?: string },
  ): Promise<TimeOffRequest> {
    const request = await this.dependencies.requests.findById(requestId);
    if (!request) {
      throw new AppError('REQUEST_NOT_FOUND', 404, 'Request was not found.');
    }

    if (actor.role === Role.EMPLOYEE && actor.userId !== request.employeeId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Employees may only cancel their own requests.',
      );
    }

    if (request.status !== 'PENDING' && request.status !== 'APPROVED') {
      throw new AppError(
        'REQUEST_NOT_PENDING',
        422,
        'Only pending or approved requests may be cancelled.',
      );
    }

    if (request.status === 'APPROVED') {
      const restoreResult = await this.dependencies.hcmClient.restoreBalance({
        employeeId: request.employeeId,
        locationId: request.locationId,
        leaveType: request.leaveType,
        days: request.durationDays,
        requestId: request.id,
        idempotencyKey: buildHcmIdempotencyKey(request.id, 'restore'),
      });
      await this.dependencies.balances.upsert(restoreResult.balance);
    }

    const cancelled = await this.dependencies.requests.cancelRequest({
      requestId,
      resolvedBy: actor.userId,
      statusReason: input.reason ?? null,
      resolvedAt: this.dependencies.clock.now(),
    });

    if (!cancelled) {
      throw new AppError(
        'REQUEST_NOT_PENDING',
        422,
        'Only pending or approved requests may be cancelled.',
      );
    }

    return cancelled;
  }

  private assertCanCreate(actor: Actor, employeeId: string): void {
    if (actor.role !== Role.EMPLOYEE || actor.userId !== employeeId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Employees may only create their own time-off requests.',
      );
    }
  }

  private async getFreshBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection> {
    const now = this.dependencies.clock.now();
    const localBalance = await this.dependencies.balances.findByDimension(
      employeeId,
      locationId,
      leaveType,
    );

    if (
      localBalance &&
      !isBalanceStale({
        lastSyncedAt: localBalance.lastSyncedAt,
        now,
        ttlMs: this.dependencies.balanceTtlMs,
      })
    ) {
      return localBalance;
    }

    const remoteBalance = await this.dependencies.hcmClient.getBalance(
      employeeId,
      locationId,
      leaveType,
    );

    return this.dependencies.balances.upsert(remoteBalance);
  }
}
