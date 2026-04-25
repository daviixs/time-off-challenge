import { LeaveType } from '../time-off/domain/time-off.types';
import { SyncController } from './sync.controller';
import { SyncService } from './application/sync.service';

describe('SyncController', () => {
  const syncService: jest.Mocked<
    Pick<SyncService, 'syncRealtime' | 'syncBatch'>
  > = {
    syncRealtime: jest.fn(),
    syncBatch: jest.fn(),
  };

  beforeEach(() => {
    syncService.syncRealtime.mockReset();
    syncService.syncBatch.mockReset();
  });

  it('uses the authenticated user as realtime sync trigger', async () => {
    syncService.syncRealtime.mockResolvedValue({
      synced: true,
      skipped: false,
    });
    const controller = new SyncController(syncService as never);

    const result = await controller.syncRealtime('hcm-user', {
      balance: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        availableDays: 10,
        sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    expect(result).toEqual({ synced: true, skipped: false });
    const input = syncService.syncRealtime.mock.calls[0]?.[0];
    expect(input?.triggeredBy).toBe('hcm-user');
    expect(input?.balance.employeeId).toBe('emp-001');
    expect(input?.balance.sourceUpdatedAt).toEqual(
      new Date('2026-04-24T00:00:00.000Z'),
    );
  });

  it('defaults realtime sync trigger to hcm-system', async () => {
    syncService.syncRealtime.mockResolvedValue({
      synced: true,
      skipped: false,
    });
    const controller = new SyncController(syncService as never);

    await controller.syncRealtime(undefined, {
      balance: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        availableDays: 10,
        sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    expect(syncService.syncRealtime.mock.calls[0]?.[0].triggeredBy).toBe(
      'hcm-system',
    );
  });

  it('uses the authenticated user as batch sync trigger', async () => {
    syncService.syncBatch.mockResolvedValue({
      processed: 1,
      failed: 0,
      skipped: 0,
    });
    const controller = new SyncController(syncService as never);

    const result = await controller.syncBatch('hcm-user', {
      balances: [
        {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
          availableDays: 10,
          sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
        },
      ],
    });

    expect(result).toEqual({ processed: 1, failed: 0, skipped: 0 });
    const input = syncService.syncBatch.mock.calls[0]?.[0];
    expect(input?.triggeredBy).toBe('hcm-user');
    expect(input?.balances[0]?.employeeId).toBe('emp-001');
    expect(input?.balances[0]?.sourceUpdatedAt).toEqual(
      new Date('2026-04-24T00:00:00.000Z'),
    );
  });

  it('defaults batch sync trigger to hcm-system', async () => {
    syncService.syncBatch.mockResolvedValue({
      processed: 1,
      failed: 0,
      skipped: 0,
    });
    const controller = new SyncController(syncService as never);

    await controller.syncBatch(undefined, {
      balances: [
        {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
          availableDays: 10,
          sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
        },
      ],
    });

    expect(syncService.syncBatch.mock.calls[0]?.[0].triggeredBy).toBe(
      'hcm-system',
    );
  });
});
