import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SyncLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(entry: {
    syncType: 'BATCH' | 'REALTIME';
    triggeredBy: string;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    recordsProcessed: number;
    skipped: number;
  }): Promise<void> {
    await this.prisma.syncLog.create({
      data: {
        syncType: entry.syncType,
        triggeredBy: entry.triggeredBy,
        status: entry.status,
        recordsProcessed: entry.recordsProcessed,
        skipped: entry.skipped,
      },
    });
  }
}
