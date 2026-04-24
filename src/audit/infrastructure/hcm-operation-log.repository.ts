import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { type LeaveType } from '../../time-off/domain/time-off.types';

@Injectable()
export class HcmOperationLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(entry: {
    idempotencyKey?: string;
    operationType: 'GET_BALANCE' | 'CONSUME' | 'RESTORE';
    requestId?: string;
    employeeId?: string;
    locationId?: string;
    leaveType?: LeaveType;
    payloadHash?: string;
    status: 'SUCCESS' | 'FAILED' | 'UNKNOWN';
    responseCode?: number;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    await this.prisma.hcmOperationLog.create({
      data: {
        idempotencyKey: entry.idempotencyKey,
        operationType: entry.operationType,
        requestId: entry.requestId,
        employeeId: entry.employeeId,
        locationId: entry.locationId,
        leaveType: entry.leaveType,
        payloadHash: entry.payloadHash,
        status: entry.status,
        responseCode: entry.responseCode,
        errorCode: entry.errorCode,
        errorMessage: entry.errorMessage,
      },
    });
  }
}
