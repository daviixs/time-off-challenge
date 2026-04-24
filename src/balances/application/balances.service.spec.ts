/* eslint-disable @typescript-eslint/require-await */

import { AppError } from '../../common/errors/app-error';
import {
  type BalanceProjection,
  LeaveType,
} from '../../time-off/domain/time-off.types';
import { BalancesService } from './balances.service';

class InMemoryBalances {
  public updates: BalanceProjection[] = [];

  constructor(private readonly balances: BalanceProjection[] = []) {}

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
    this.updates.push(balance);
    return balance;
  }
}

class FakeHcmClient {
  public fetched = 0;

  constructor(private readonly remoteBalance: BalanceProjection) {}

  async getBalance(): Promise<BalanceProjection> {
    this.fetched += 1;
    return this.remoteBalance;
  }
}

describe('BalancesService.getCurrentBalance', () => {
  const freshBalance: BalanceProjection = {
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    availableDays: 8,
    lastSyncedAt: new Date('2026-04-24T00:03:00.000Z'),
    sourceUpdatedAt: new Date('2026-04-24T00:03:00.000Z'),
    version: 1,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:03:00.000Z'),
  };

  function buildService(overrides?: {
    balances?: InMemoryBalances;
    hcmClient?: FakeHcmClient;
  }): BalancesService {
    return new BalancesService({
      balances: overrides?.balances ?? new InMemoryBalances([freshBalance]),
      hcmClient:
        overrides?.hcmClient ??
        new FakeHcmClient({
          ...freshBalance,
          availableDays: 10,
          version: 2,
          lastSyncedAt: new Date('2026-04-24T00:04:00.000Z'),
          updatedAt: new Date('2026-04-24T00:04:00.000Z'),
        }),
      clock: {
        now: () => new Date('2026-04-24T00:04:00.000Z'),
      },
      balanceTtlMs: 5 * 60 * 1000,
    });
  }

  it('returns the local projection when it is still fresh', async () => {
    const balances = new InMemoryBalances([freshBalance]);
    const hcmClient = new FakeHcmClient({
      ...freshBalance,
      availableDays: 10,
      version: 2,
    });
    const service = buildService({ balances, hcmClient });

    const balance = await service.getCurrentBalance({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
    });

    expect(balance.availableDays).toBe(8);
    expect(hcmClient.fetched).toBe(0);
  });

  it('refreshes from HCM when the local projection is stale', async () => {
    const staleBalance = {
      ...freshBalance,
      lastSyncedAt: new Date('2026-04-23T23:00:00.000Z'),
    };
    const balances = new InMemoryBalances([staleBalance]);
    const service = buildService({ balances });

    const balance = await service.getCurrentBalance({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
    });

    expect(balance.availableDays).toBe(10);
    expect(balances.updates.at(-1)?.availableDays).toBe(10);
  });

  it('refreshes from HCM when no local projection exists', async () => {
    const balances = new InMemoryBalances([]);
    const service = buildService({ balances });

    const balance = await service.getCurrentBalance({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
    });

    expect(balance.availableDays).toBe(10);
    expect(balances.updates).toHaveLength(1);
  });

  it('propagates HCM availability failures for missing or stale balances', async () => {
    const balances = new InMemoryBalances([]);
    const service = new BalancesService({
      balances,
      hcmClient: {
        getBalance: async () => {
          throw new AppError(
            'HCM_UNAVAILABLE',
            503,
            'Cannot reach authoritative HCM.',
          );
        },
      },
      clock: {
        now: () => new Date('2026-04-24T00:04:00.000Z'),
      },
      balanceTtlMs: 5 * 60 * 1000,
    });

    await expect(
      service.getCurrentBalance({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
      }),
    ).rejects.toMatchObject<AppError>({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });
  });
});
