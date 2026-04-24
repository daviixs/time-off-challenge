import { Body, Controller, Headers, Post } from '@nestjs/common';
import { SyncService } from './application/sync.service';
import { BatchSyncDto } from './dto/batch-sync.dto';
import { RealtimeSyncDto } from './dto/realtime-sync.dto';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('realtime')
  syncRealtime(
    @Headers('x-user-id') userId: string | undefined,
    @Body() body: RealtimeSyncDto,
  ) {
    return this.syncService.syncRealtime({
      triggeredBy: userId ?? 'hcm-system',
      balance: {
        ...body.balance,
        sourceUpdatedAt: new Date(body.balance.sourceUpdatedAt),
      },
    });
  }

  @Post('batch')
  syncBatch(
    @Headers('x-user-id') userId: string | undefined,
    @Body() body: BatchSyncDto,
  ) {
    return this.syncService.syncBatch({
      triggeredBy: userId ?? 'hcm-system',
      balances: body.balances.map((balance) => ({
        ...balance,
        sourceUpdatedAt: new Date(balance.sourceUpdatedAt),
      })),
    });
  }
}
