import { randomUUID } from 'crypto';
import { AppError } from '../../common/errors/app-error';
import {
  buildCreateRequestIdempotencyHash,
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
  beginApproval(requestId: string): Promise<TimeOffRequest | null>;
  finalizeApproval(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
    hcmTransactionId: string;
  }): Promise<TimeOffRequest | null>;
  markApprovalUnknown(requestId: string): Promise<TimeOffRequest | null>;
  revertApprovalToPending(requestId: string): Promise<TimeOffRequest | null>;
  rejectPending(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null>;
  cancelPending(input: {
    requestId: string;
    resolvedBy: string;
    statusReason: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null>;
  beginCancellation(requestId: string): Promise<TimeOffRequest | null>;
  finalizeCancellation(input: {
    requestId: string;
    resolvedBy: string;
    statusReason: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null>;
  markCancellationUnknown(requestId: string): Promise<TimeOffRequest | null>;
  revertCancellationToApproved(
    requestId: string,
  ): Promise<TimeOffRequest | null>;
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

type RequestIdempotencyRecord = {
  idempotencyKey: string;
  requestHash: string;
  status: 'PENDING' | 'COMPLETED';
  requestId: string | null;
  responseBody: string | null;
};

type RequestIdempotencyStore = {
  findByKey(idempotencyKey: string): Promise<RequestIdempotencyRecord | null>;
  createPending(input: {
    idempotencyKey: string;
    requestHash: string;
  }): Promise<RequestIdempotencyRecord>;
  complete(input: {
    idempotencyKey: string;
    requestId: string;
    responseBody: string;
  }): Promise<void>;
  deletePending(idempotencyKey: string): Promise<void>;
};

type DurableHcmOperationRecord = {
  requestId: string;
  operationType: 'CONSUME' | 'RESTORE';
  idempotencyKey: string;
  status: 'PENDING' | 'SUCCESS' | 'UNKNOWN' | 'FAILED';
  transactionId: string | null;
  responseBody: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type HcmOperationStore = {
  findByKey(idempotencyKey: string): Promise<DurableHcmOperationRecord | null>;
  createPending(input: {
    requestId: string;
    operationType: 'CONSUME' | 'RESTORE';
    idempotencyKey: string;
  }): Promise<DurableHcmOperationRecord>;
  resetToPending(idempotencyKey: string): Promise<DurableHcmOperationRecord>;
  markSuccess(input: {
    idempotencyKey: string;
    transactionId: string;
    responseBody: string;
  }): Promise<DurableHcmOperationRecord>;
  markUnknown(input: {
    idempotencyKey: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<DurableHcmOperationRecord>;
  markFailed(input: {
    idempotencyKey: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<DurableHcmOperationRecord>;
};

type BalanceDimensionLeaseStore = {
  acquire(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    holderId: string;
    now: Date;
    ttlMs: number;
  }): Promise<boolean>;
  release(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    holderId: string;
  }): Promise<void>;
};

type RequestsServiceDependencies = {
  employees: EmployeeStore;
  balances: BalanceStore;
  requests: RequestStore;
  hcmClient: HcmClient;
  clock: Clock;
  balanceTtlMs: number;
  balanceDimensionLeaseTtlMs: number;
  idempotency: RequestIdempotencyStore;
  operations: HcmOperationStore;
  leases: BalanceDimensionLeaseStore;
};

export class RequestsService {
  constructor(private readonly dependencies: RequestsServiceDependencies) {}

  async createRequest(
    actor: Actor,
    input: CreateTimeOffRequestInput,
    options?: { idempotencyKey?: string },
  ): Promise<TimeOffRequest> {
    this.assertCanCreate(actor, input.employeeId);

    const requestHash = options?.idempotencyKey
      ? buildCreateRequestIdempotencyHash({
          employeeId: input.employeeId,
          locationId: input.locationId,
          leaveType: input.leaveType,
          startDate: input.startDate,
          endDate: input.endDate,
          notes: input.notes ?? null,
        })
      : null;

    if (options?.idempotencyKey && requestHash) {
      const existing = await this.dependencies.idempotency.findByKey(
        options.idempotencyKey,
      );

      if (existing) {
        return this.resolveCreateReplay(existing, requestHash);
      }

      const reserved = await this.dependencies.idempotency.createPending({
        idempotencyKey: options.idempotencyKey,
        requestHash,
      });

      if (
        reserved.requestHash !== requestHash ||
        reserved.status !== 'PENDING'
      ) {
        return this.resolveCreateReplay(reserved, requestHash);
      }
    }

    return this.withDimensionLease(
      {
        employeeId: input.employeeId,
        locationId: input.locationId,
        leaveType: input.leaveType,
      },
      async () => {
        try {
          const employee = await this.dependencies.employees.findById(
            input.employeeId,
          );
          if (!employee) {
            throw new AppError(
              'EMPLOYEE_NOT_FOUND',
              404,
              'Employee was not found.',
            );
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
          const durationDays = calculateInclusiveDurationDays(
            startDate,
            endDate,
          );

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

          const created = await this.dependencies.requests.create({
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

          if (options?.idempotencyKey) {
            await this.dependencies.idempotency.complete({
              idempotencyKey: options.idempotencyKey,
              requestId: created.id,
              responseBody: serializeRequest(created),
            });
          }

          return created;
        } catch (error) {
          if (options?.idempotencyKey) {
            await this.dependencies.idempotency.deletePending(
              options.idempotencyKey,
            );
          }
          throw error;
        }
      },
    );
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

    const initialRequest = await this.dependencies.requests.findById(requestId);
    if (!initialRequest) {
      throw new AppError('REQUEST_NOT_FOUND', 404, 'Request was not found.');
    }

    return this.withDimensionLease(
      {
        employeeId: initialRequest.employeeId,
        locationId: initialRequest.locationId,
        leaveType: initialRequest.leaveType,
      },
      async () => {
        let request = await this.dependencies.requests.findById(requestId);
        if (!request) {
          throw new AppError(
            'REQUEST_NOT_FOUND',
            404,
            'Request was not found.',
          );
        }

        const idempotencyKey = buildHcmIdempotencyKey(request.id, 'consume');

        if (request.status === 'APPROVAL_UNKNOWN') {
          throw new AppError(
            'REQUEST_STATE_UNKNOWN',
            409,
            'Request approval is in an unknown state and requires reconciliation.',
          );
        }

        if (
          request.status === 'CANCELLATION_IN_PROGRESS' ||
          request.status === 'APPROVAL_IN_PROGRESS'
        ) {
          return this.resolveApprovalFromExistingOperation(
            request,
            actor,
            input,
            idempotencyKey,
          );
        }

        if (
          request.status === 'CANCELLATION_UNKNOWN' ||
          request.status === 'CANCELLED' ||
          request.status === 'REJECTED' ||
          request.status === 'APPROVED'
        ) {
          throw new AppError(
            'REQUEST_NOT_PENDING',
            422,
            'Only pending requests may be approved.',
          );
        }

        request = await this.dependencies.requests.beginApproval(request.id);
        if (!request) {
          throw new AppError(
            'REQUEST_IN_PROGRESS',
            409,
            'Request approval is already in progress.',
          );
        }

        let operation =
          await this.dependencies.operations.findByKey(idempotencyKey);
        if (!operation) {
          operation = await this.dependencies.operations.createPending({
            requestId: request.id,
            operationType: 'CONSUME',
            idempotencyKey,
          });
        } else if (operation.status === 'FAILED') {
          operation =
            await this.dependencies.operations.resetToPending(idempotencyKey);
        }

        if (operation.status === 'SUCCESS') {
          return this.finalizeApprovalFromSuccessOperation(
            request,
            actor,
            input,
            operation,
          );
        }

        if (operation.status === 'UNKNOWN') {
          await this.dependencies.requests.markApprovalUnknown(request.id);
          throw new AppError(
            'REQUEST_STATE_UNKNOWN',
            409,
            'Request approval is in an unknown state and requires reconciliation.',
          );
        }

        try {
          const authoritativeBalance =
            await this.dependencies.hcmClient.getBalance(
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

          const consumeResult =
            await this.dependencies.hcmClient.consumeBalance({
              employeeId: request.employeeId,
              locationId: request.locationId,
              leaveType: request.leaveType,
              days: request.durationDays,
              requestId: request.id,
              idempotencyKey,
            });

          await this.dependencies.operations.markSuccess({
            idempotencyKey,
            transactionId: consumeResult.transactionId,
            responseBody: serializeOperationResponse(consumeResult),
          });
          await this.dependencies.balances.upsert(consumeResult.balance);

          const approved = await this.dependencies.requests.finalizeApproval({
            requestId: request.id,
            resolvedBy: actor.userId,
            managerNotes: input.notes ?? null,
            resolvedAt: this.dependencies.clock.now(),
            hcmTransactionId: consumeResult.transactionId,
          });

          if (!approved) {
            throw new AppError(
              'REQUEST_IN_PROGRESS',
              409,
              'Request approval is already in progress.',
            );
          }

          return approved;
        } catch (error) {
          if (
            error instanceof AppError &&
            error.code === 'HCM_RESULT_UNKNOWN'
          ) {
            await this.dependencies.operations.markUnknown({
              idempotencyKey,
              errorCode: error.code,
              errorMessage: error.message,
            });
            await this.dependencies.requests.markApprovalUnknown(request.id);
            throw error;
          }

          if (error instanceof AppError) {
            await this.dependencies.operations.markFailed({
              idempotencyKey,
              errorCode: error.code,
              errorMessage: error.message,
            });
            await this.dependencies.requests.revertApprovalToPending(
              request.id,
            );
          }

          throw error;
        }
      },
    );
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

    if (
      request.status === 'APPROVAL_IN_PROGRESS' ||
      request.status === 'CANCELLATION_IN_PROGRESS'
    ) {
      throw new AppError(
        'REQUEST_IN_PROGRESS',
        409,
        'Request is currently being processed and cannot be rejected.',
      );
    }

    if (
      request.status === 'APPROVAL_UNKNOWN' ||
      request.status === 'CANCELLATION_UNKNOWN'
    ) {
      throw new AppError(
        'REQUEST_STATE_UNKNOWN',
        409,
        'Request is in an unknown state and requires reconciliation.',
      );
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
    const initialRequest = await this.dependencies.requests.findById(requestId);
    if (!initialRequest) {
      throw new AppError('REQUEST_NOT_FOUND', 404, 'Request was not found.');
    }

    if (
      actor.role === Role.EMPLOYEE &&
      actor.userId !== initialRequest.employeeId
    ) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Employees may only cancel their own requests.',
      );
    }

    return this.withDimensionLease(
      {
        employeeId: initialRequest.employeeId,
        locationId: initialRequest.locationId,
        leaveType: initialRequest.leaveType,
      },
      async () => {
        let request = await this.dependencies.requests.findById(requestId);
        if (!request) {
          throw new AppError(
            'REQUEST_NOT_FOUND',
            404,
            'Request was not found.',
          );
        }

        if (request.status === 'APPROVAL_IN_PROGRESS') {
          throw new AppError(
            'REQUEST_IN_PROGRESS',
            409,
            'Request approval is already in progress and cannot be cancelled.',
          );
        }

        if (
          request.status === 'APPROVAL_UNKNOWN' ||
          request.status === 'CANCELLATION_UNKNOWN'
        ) {
          throw new AppError(
            'REQUEST_STATE_UNKNOWN',
            409,
            'Request is in an unknown state and requires reconciliation.',
          );
        }

        if (request.status === 'PENDING') {
          const cancelled = await this.dependencies.requests.cancelPending({
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

        if (request.status === 'CANCELLATION_IN_PROGRESS') {
          return this.resolveCancellationFromExistingOperation(
            request,
            actor,
            input,
            buildHcmIdempotencyKey(request.id, 'restore'),
          );
        }

        if (request.status !== 'APPROVED') {
          throw new AppError(
            'REQUEST_NOT_PENDING',
            422,
            'Only pending or approved requests may be cancelled.',
          );
        }

        request = await this.dependencies.requests.beginCancellation(
          request.id,
        );
        if (!request) {
          throw new AppError(
            'REQUEST_IN_PROGRESS',
            409,
            'Request cancellation is already in progress.',
          );
        }

        const idempotencyKey = buildHcmIdempotencyKey(request.id, 'restore');
        let operation =
          await this.dependencies.operations.findByKey(idempotencyKey);
        if (!operation) {
          operation = await this.dependencies.operations.createPending({
            requestId: request.id,
            operationType: 'RESTORE',
            idempotencyKey,
          });
        } else if (operation.status === 'FAILED') {
          operation =
            await this.dependencies.operations.resetToPending(idempotencyKey);
        }

        if (operation.status === 'SUCCESS') {
          return this.finalizeCancellationFromSuccessOperation(
            request,
            actor,
            input,
            operation,
          );
        }

        if (operation.status === 'UNKNOWN') {
          await this.dependencies.requests.markCancellationUnknown(request.id);
          throw new AppError(
            'REQUEST_STATE_UNKNOWN',
            409,
            'Request cancellation is in an unknown state and requires reconciliation.',
          );
        }

        try {
          const restoreResult =
            await this.dependencies.hcmClient.restoreBalance({
              employeeId: request.employeeId,
              locationId: request.locationId,
              leaveType: request.leaveType,
              days: request.durationDays,
              requestId: request.id,
              idempotencyKey,
            });

          await this.dependencies.operations.markSuccess({
            idempotencyKey,
            transactionId: restoreResult.transactionId,
            responseBody: serializeOperationResponse(restoreResult),
          });
          await this.dependencies.balances.upsert(restoreResult.balance);

          const cancelled =
            await this.dependencies.requests.finalizeCancellation({
              requestId,
              resolvedBy: actor.userId,
              statusReason: input.reason ?? null,
              resolvedAt: this.dependencies.clock.now(),
            });

          if (!cancelled) {
            throw new AppError(
              'REQUEST_IN_PROGRESS',
              409,
              'Request cancellation is already in progress.',
            );
          }

          return cancelled;
        } catch (error) {
          if (
            error instanceof AppError &&
            error.code === 'HCM_RESULT_UNKNOWN'
          ) {
            await this.dependencies.operations.markUnknown({
              idempotencyKey,
              errorCode: error.code,
              errorMessage: error.message,
            });
            await this.dependencies.requests.markCancellationUnknown(
              request.id,
            );
            throw error;
          }

          if (error instanceof AppError) {
            await this.dependencies.operations.markFailed({
              idempotencyKey,
              errorCode: error.code,
              errorMessage: error.message,
            });
            await this.dependencies.requests.revertCancellationToApproved(
              request.id,
            );
          }

          throw error;
        }
      },
    );
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

  private async withDimensionLease<T>(
    dimension: {
      employeeId: string;
      locationId: string;
      leaveType: LeaveType;
    },
    work: () => Promise<T>,
  ): Promise<T> {
    const holderId = randomUUID();
    const acquired = await this.dependencies.leases.acquire({
      employeeId: dimension.employeeId,
      locationId: dimension.locationId,
      leaveType: dimension.leaveType,
      holderId,
      now: this.dependencies.clock.now(),
      ttlMs: this.dependencies.balanceDimensionLeaseTtlMs,
    });

    if (!acquired) {
      throw new AppError(
        'BALANCE_DIMENSION_LOCKED',
        409,
        'Another operation is already in progress for this balance dimension.',
      );
    }

    try {
      return await work();
    } finally {
      await this.dependencies.leases.release({
        employeeId: dimension.employeeId,
        locationId: dimension.locationId,
        leaveType: dimension.leaveType,
        holderId,
      });
    }
  }

  private resolveCreateReplay(
    existing: RequestIdempotencyRecord,
    requestHash: string,
  ): TimeOffRequest {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        409,
        'Idempotency key was already used with a different request payload.',
      );
    }

    if (existing.status === 'COMPLETED' && existing.responseBody) {
      return deserializeRequest(existing.responseBody);
    }

    throw new AppError(
      'IDEMPOTENCY_KEY_IN_PROGRESS',
      409,
      'An equivalent request with this idempotency key is still being processed.',
    );
  }

  private async resolveApprovalFromExistingOperation(
    request: TimeOffRequest,
    actor: Actor,
    input: { notes?: string },
    idempotencyKey: string,
  ): Promise<TimeOffRequest> {
    if (request.status !== 'APPROVAL_IN_PROGRESS') {
      throw new AppError(
        'REQUEST_IN_PROGRESS',
        409,
        'Request approval is already in progress.',
      );
    }

    const operation =
      await this.dependencies.operations.findByKey(idempotencyKey);
    if (!operation || operation.status === 'PENDING') {
      throw new AppError(
        'REQUEST_IN_PROGRESS',
        409,
        'Request approval is already in progress.',
      );
    }

    if (operation.status === 'UNKNOWN') {
      throw new AppError(
        'REQUEST_STATE_UNKNOWN',
        409,
        'Request approval is in an unknown state and requires reconciliation.',
      );
    }

    if (operation.status === 'FAILED') {
      await this.dependencies.requests.revertApprovalToPending(request.id);
      return this.approveRequest(actor, request.id, input);
    }

    return this.finalizeApprovalFromSuccessOperation(
      request,
      actor,
      input,
      operation,
    );
  }

  private async finalizeApprovalFromSuccessOperation(
    request: TimeOffRequest,
    actor: Actor,
    input: { notes?: string },
    operation: DurableHcmOperationRecord,
  ): Promise<TimeOffRequest> {
    const response = deserializeOperationResponse(operation.responseBody);
    await this.dependencies.balances.upsert(response.balance);

    const approved = await this.dependencies.requests.finalizeApproval({
      requestId: request.id,
      resolvedBy: actor.userId,
      managerNotes: input.notes ?? null,
      resolvedAt: this.dependencies.clock.now(),
      hcmTransactionId: response.transactionId,
    });

    if (approved) {
      return approved;
    }

    const current = await this.dependencies.requests.findById(request.id);
    if (current?.status === 'APPROVED') {
      return current;
    }

    throw new AppError(
      'REQUEST_IN_PROGRESS',
      409,
      'Request approval is already in progress.',
    );
  }

  private async resolveCancellationFromExistingOperation(
    request: TimeOffRequest,
    actor: Actor,
    input: { reason?: string },
    idempotencyKey: string,
  ): Promise<TimeOffRequest> {
    const operation =
      await this.dependencies.operations.findByKey(idempotencyKey);
    if (!operation || operation.status === 'PENDING') {
      throw new AppError(
        'REQUEST_IN_PROGRESS',
        409,
        'Request cancellation is already in progress.',
      );
    }

    if (operation.status === 'UNKNOWN') {
      throw new AppError(
        'REQUEST_STATE_UNKNOWN',
        409,
        'Request cancellation is in an unknown state and requires reconciliation.',
      );
    }

    if (operation.status === 'FAILED') {
      await this.dependencies.requests.revertCancellationToApproved(request.id);
      return this.cancelRequest(actor, request.id, input);
    }

    return this.finalizeCancellationFromSuccessOperation(
      request,
      actor,
      input,
      operation,
    );
  }

  private async finalizeCancellationFromSuccessOperation(
    request: TimeOffRequest,
    actor: Actor,
    input: { reason?: string },
    operation: DurableHcmOperationRecord,
  ): Promise<TimeOffRequest> {
    const response = deserializeOperationResponse(operation.responseBody);
    await this.dependencies.balances.upsert(response.balance);

    const cancelled = await this.dependencies.requests.finalizeCancellation({
      requestId: request.id,
      resolvedBy: actor.userId,
      statusReason: input.reason ?? null,
      resolvedAt: this.dependencies.clock.now(),
    });

    if (cancelled) {
      return cancelled;
    }

    const current = await this.dependencies.requests.findById(request.id);
    if (current?.status === 'CANCELLED') {
      return current;
    }

    throw new AppError(
      'REQUEST_IN_PROGRESS',
      409,
      'Request cancellation is already in progress.',
    );
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

function serializeRequest(request: TimeOffRequest): string {
  return JSON.stringify({
    ...request,
    startDate: request.startDate.toISOString(),
    endDate: request.endDate.toISOString(),
    resolvedAt: request.resolvedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  });
}

function deserializeRequest(serialized: string): TimeOffRequest {
  const request = JSON.parse(serialized) as TimeOffRequest & {
    startDate: string;
    endDate: string;
    resolvedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };

  return {
    ...request,
    status: request.status,
    startDate: new Date(request.startDate),
    endDate: new Date(request.endDate),
    resolvedAt: request.resolvedAt ? new Date(request.resolvedAt) : null,
    createdAt: new Date(request.createdAt),
    updatedAt: new Date(request.updatedAt),
  };
}

function serializeOperationResponse(input: {
  transactionId: string;
  balance: BalanceProjection;
}): string {
  return JSON.stringify({
    transactionId: input.transactionId,
    balance: {
      ...input.balance,
      lastSyncedAt: input.balance.lastSyncedAt.toISOString(),
      sourceUpdatedAt: input.balance.sourceUpdatedAt?.toISOString() ?? null,
      createdAt: input.balance.createdAt.toISOString(),
      updatedAt: input.balance.updatedAt.toISOString(),
    },
  });
}

function deserializeOperationResponse(serialized: string | null): {
  transactionId: string;
  balance: BalanceProjection;
} {
  if (!serialized) {
    throw new AppError(
      'REQUEST_STATE_UNKNOWN',
      409,
      'Missing persisted HCM operation response for replay.',
    );
  }

  const payload = JSON.parse(serialized) as {
    transactionId: string;
    balance: Omit<
      BalanceProjection,
      'lastSyncedAt' | 'sourceUpdatedAt' | 'createdAt' | 'updatedAt'
    > & {
      lastSyncedAt?: string;
      sourceUpdatedAt: string | null;
      createdAt?: string;
      updatedAt?: string;
    };
  };
  const now = new Date();

  return {
    transactionId: payload.transactionId,
    balance: {
      ...payload.balance,
      lastSyncedAt: payload.balance.lastSyncedAt
        ? new Date(payload.balance.lastSyncedAt)
        : now,
      sourceUpdatedAt: payload.balance.sourceUpdatedAt
        ? new Date(payload.balance.sourceUpdatedAt)
        : null,
      version: payload.balance.version ?? 1,
      createdAt: payload.balance.createdAt
        ? new Date(payload.balance.createdAt)
        : now,
      updatedAt: payload.balance.updatedAt
        ? new Date(payload.balance.updatedAt)
        : now,
    },
  };
}
