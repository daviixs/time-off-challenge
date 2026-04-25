import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { AppError } from '../common/errors/app-error';
import { HcmOperationLogRepository } from '../audit/infrastructure/hcm-operation-log.repository';
import { validateHcmBalancePayload } from './hcm-balance-payload';
import {
  type BalanceProjection,
  type LeaveType,
} from '../time-off/domain/time-off.types';

type HcmBalanceResponse = {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  availableDays: number;
  sourceUpdatedAt?: string;
  transactionId?: string;
};

type HcmBalanceWriteResponse = {
  transactionId: string;
  balance: HcmBalanceResponse;
};

@Injectable()
export class HcmClientService {
  private readonly timeoutMs: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly hcmOperationLogRepository: HcmOperationLogRepository,
  ) {
    this.timeoutMs = Number(this.configService.get('HCM_TIMEOUT_MS') ?? 2000);
  }

  async getBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection> {
    const baseUrl = this.getBaseUrl();

    try {
      const response = await axios.get<HcmBalanceResponse>(
        `${baseUrl}/balances/${employeeId}/${locationId}/${leaveType}`,
        {
          timeout: this.timeoutMs,
        },
      );

      const balance = this.toBalanceProjection(
        {
          employeeId,
          locationId,
          leaveType,
        },
        response.data,
      );

      await this.hcmOperationLogRepository.create({
        operationType: 'GET_BALANCE',
        employeeId,
        locationId,
        leaveType,
        status: 'SUCCESS',
        responseCode: response.status,
      });

      return balance;
    } catch (error) {
      if (error instanceof AppError) {
        await this.hcmOperationLogRepository.create({
          operationType: 'GET_BALANCE',
          employeeId,
          locationId,
          leaveType,
          status: 'FAILED',
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }

      throw await this.normalizeError({
        operationType: 'GET_BALANCE',
        employeeId,
        locationId,
        leaveType,
        error,
      });
    }
  }

  async consumeBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
    requestId: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string; balance: BalanceProjection }> {
    return this.writeBalanceOperation('CONSUME', '/balances/consume', input);
  }

  async restoreBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
    requestId: string;
    idempotencyKey: string;
  }): Promise<{ transactionId: string; balance: BalanceProjection }> {
    return this.writeBalanceOperation('RESTORE', '/balances/restore', input);
  }

  private async writeBalanceOperation(
    operationType: 'CONSUME' | 'RESTORE',
    path: string,
    input: {
      employeeId: string;
      locationId: string;
      leaveType: LeaveType;
      days: number;
      requestId: string;
      idempotencyKey: string;
    },
  ): Promise<{ transactionId: string; balance: BalanceProjection }> {
    const baseUrl = this.getBaseUrl();
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');

    try {
      const response = await axios.post<HcmBalanceWriteResponse>(
        `${baseUrl}${path}`,
        input,
        {
          timeout: this.timeoutMs,
        },
      );

      const balance = this.toBalanceProjection(
        {
          employeeId: input.employeeId,
          locationId: input.locationId,
          leaveType: input.leaveType,
        },
        response.data.balance,
      );

      await this.hcmOperationLogRepository.create({
        idempotencyKey: input.idempotencyKey,
        operationType,
        requestId: input.requestId,
        employeeId: input.employeeId,
        locationId: input.locationId,
        leaveType: input.leaveType,
        payloadHash,
        status: 'SUCCESS',
        responseCode: response.status,
      });

      return {
        transactionId: response.data.transactionId ?? input.idempotencyKey,
        balance,
      };
    } catch (error) {
      if (error instanceof AppError) {
        await this.hcmOperationLogRepository.create({
          idempotencyKey: input.idempotencyKey,
          operationType,
          requestId: input.requestId,
          employeeId: input.employeeId,
          locationId: input.locationId,
          leaveType: input.leaveType,
          payloadHash,
          status: 'FAILED',
          errorCode: error.code,
          errorMessage: error.message,
        });
        throw error;
      }

      throw await this.normalizeError({
        idempotencyKey: input.idempotencyKey,
        operationType,
        requestId: input.requestId,
        employeeId: input.employeeId,
        locationId: input.locationId,
        leaveType: input.leaveType,
        payloadHash,
        error,
      });
    }
  }

  private getBaseUrl(): string {
    const baseUrl = this.configService.get<string>('HCM_BASE_URL');
    if (!baseUrl) {
      throw new AppError(
        'HCM_UNAVAILABLE',
        503,
        'HCM base URL is not configured.',
      );
    }

    return baseUrl.replace(/\/$/, '');
  }

  private toBalanceProjection(
    expected: {
      employeeId: string;
      locationId: string;
      leaveType: LeaveType;
    },
    payload: HcmBalanceResponse,
  ): BalanceProjection {
    const now = new Date();
    const validated = validateHcmBalancePayload(payload, expected);

    return {
      employeeId: validated.employeeId,
      locationId: validated.locationId,
      leaveType: validated.leaveType,
      availableDays: validated.availableDays,
      lastSyncedAt: now,
      sourceUpdatedAt: validated.sourceUpdatedAt,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async normalizeError(input: {
    idempotencyKey?: string;
    operationType: 'GET_BALANCE' | 'CONSUME' | 'RESTORE';
    requestId?: string;
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    payloadHash?: string;
    error: unknown;
  }): Promise<AppError> {
    const error = input.error as AxiosError<{ message?: string }>;
    const statusCode = error.response?.status;

    let appError: AppError;
    if (
      error.code === 'ECONNABORTED' &&
      input.operationType !== 'GET_BALANCE'
    ) {
      appError = new AppError(
        'HCM_RESULT_UNKNOWN',
        503,
        'HCM timed out before confirming the operation result.',
      );
    } else if (!statusCode || statusCode >= 500) {
      appError = new AppError(
        'HCM_UNAVAILABLE',
        503,
        'Cannot reach authoritative HCM.',
      );
    } else if (statusCode === 422) {
      appError = new AppError(
        'INSUFFICIENT_BALANCE',
        422,
        error.response?.data?.message ?? 'HCM rejected the balance operation.',
      );
    } else if (statusCode === 400) {
      appError = new AppError(
        'INVALID_DIMENSION',
        400,
        error.response?.data?.message ?? 'HCM rejected the balance dimensions.',
      );
    } else {
      appError = new AppError(
        'HCM_WRITE_FAILED',
        502,
        error.response?.data?.message ?? 'HCM rejected the operation.',
      );
    }

    await this.hcmOperationLogRepository.create({
      idempotencyKey: input.idempotencyKey,
      operationType: input.operationType,
      requestId: input.requestId,
      employeeId: input.employeeId,
      locationId: input.locationId,
      leaveType: input.leaveType,
      payloadHash: input.payloadHash,
      status: appError.code === 'HCM_RESULT_UNKNOWN' ? 'UNKNOWN' : 'FAILED',
      responseCode: statusCode,
      errorCode: appError.code,
      errorMessage: appError.message,
    });

    return appError;
  }
}
