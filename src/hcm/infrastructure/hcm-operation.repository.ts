import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type DurableHcmOperationRecord = {
  id: string;
  requestId: string;
  operationType: 'CONSUME' | 'RESTORE';
  idempotencyKey: string;
  status: 'PENDING' | 'SUCCESS' | 'UNKNOWN' | 'FAILED';
  transactionId: string | null;
  responseBody: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

@Injectable()
export class HcmOperationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(
    idempotencyKey: string,
  ): Promise<DurableHcmOperationRecord | null> {
    const operation = await this.prisma.hcmOperation.findUnique({
      where: { idempotencyKey },
    });

    if (!operation) {
      return null;
    }

    return this.toDomain(operation);
  }

  async createPending(input: {
    requestId: string;
    operationType: 'CONSUME' | 'RESTORE';
    idempotencyKey: string;
  }): Promise<DurableHcmOperationRecord> {
    try {
      const created = await this.prisma.hcmOperation.create({
        data: {
          requestId: input.requestId,
          operationType: input.operationType,
          idempotencyKey: input.idempotencyKey,
          status: 'PENDING',
        },
      });

      return this.toDomain(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findByKey(input.idempotencyKey);
        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  async resetToPending(
    idempotencyKey: string,
  ): Promise<DurableHcmOperationRecord> {
    const updated = await this.prisma.hcmOperation.update({
      where: { idempotencyKey },
      data: {
        status: 'PENDING',
        errorCode: null,
        errorMessage: null,
      },
    });

    return this.toDomain(updated);
  }

  async markSuccess(input: {
    idempotencyKey: string;
    transactionId: string;
    responseBody: string;
  }): Promise<DurableHcmOperationRecord> {
    const updated = await this.prisma.hcmOperation.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: {
        status: 'SUCCESS',
        transactionId: input.transactionId,
        responseBody: input.responseBody,
        errorCode: null,
        errorMessage: null,
      },
    });

    return this.toDomain(updated);
  }

  async markUnknown(input: {
    idempotencyKey: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<DurableHcmOperationRecord> {
    const updated = await this.prisma.hcmOperation.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: {
        status: 'UNKNOWN',
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });

    return this.toDomain(updated);
  }

  async markFailed(input: {
    idempotencyKey: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<DurableHcmOperationRecord> {
    const updated = await this.prisma.hcmOperation.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: {
        status: 'FAILED',
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      },
    });

    return this.toDomain(updated);
  }

  private toDomain(operation: {
    id: string;
    requestId: string;
    operationType: 'CONSUME' | 'RESTORE';
    idempotencyKey: string;
    status: 'PENDING' | 'SUCCESS' | 'UNKNOWN' | 'FAILED';
    transactionId: string | null;
    responseBody: string | null;
    errorCode: string | null;
    errorMessage: string | null;
  }): DurableHcmOperationRecord {
    return {
      id: operation.id,
      requestId: operation.requestId,
      operationType: operation.operationType,
      idempotencyKey: operation.idempotencyKey,
      status: operation.status,
      transactionId: operation.transactionId,
      responseBody: operation.responseBody,
      errorCode: operation.errorCode,
      errorMessage: operation.errorMessage,
    };
  }
}
