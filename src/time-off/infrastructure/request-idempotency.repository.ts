import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type RequestIdempotencyRecord = {
  idempotencyKey: string;
  requestHash: string;
  status: 'PENDING' | 'COMPLETED';
  requestId: string | null;
  responseBody: string | null;
};

@Injectable()
export class RequestIdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(
    idempotencyKey: string,
  ): Promise<RequestIdempotencyRecord | null> {
    const record = await this.prisma.requestIdempotency.findUnique({
      where: { idempotencyKey },
    });

    if (!record) {
      return null;
    }

    return {
      idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash,
      status: record.status,
      requestId: record.requestId,
      responseBody: record.responseBody,
    };
  }

  async createPending(input: {
    idempotencyKey: string;
    requestHash: string;
  }): Promise<RequestIdempotencyRecord> {
    try {
      const created = await this.prisma.requestIdempotency.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          status: 'PENDING',
        },
      });

      return {
        idempotencyKey: created.idempotencyKey,
        requestHash: created.requestHash,
        status: created.status,
        requestId: created.requestId,
        responseBody: created.responseBody,
      };
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

  async complete(input: {
    idempotencyKey: string;
    requestId: string;
    responseBody: string;
  }): Promise<void> {
    await this.prisma.requestIdempotency.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: {
        status: 'COMPLETED',
        requestId: input.requestId,
        responseBody: input.responseBody,
      },
    });
  }

  async deletePending(idempotencyKey: string): Promise<void> {
    await this.prisma.requestIdempotency.deleteMany({
      where: {
        idempotencyKey,
        status: 'PENDING',
      },
    });
  }
}
