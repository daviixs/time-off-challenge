import { isBalanceStale } from '../../shared/domain/time-off-policy';
import {
  type BalanceProjection,
  type LeaveType,
} from '../../time-off/domain/time-off.types';

type BalanceStore = {
  findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection | null>;
  upsert(balance: BalanceProjection): Promise<BalanceProjection>;
};

type HcmClient = {
  getBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection>;
};

type Clock = {
  now(): Date;
};

export class BalancesService {
  constructor(
    private readonly dependencies: {
      balances: BalanceStore;
      hcmClient: HcmClient;
      clock: Clock;
      balanceTtlMs: number;
    },
  ) {}

  async getCurrentBalance(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
  }): Promise<BalanceProjection> {
    const localBalance = await this.dependencies.balances.findByDimension(
      input.employeeId,
      input.locationId,
      input.leaveType,
    );

    if (
      localBalance &&
      !isBalanceStale({
        lastSyncedAt: localBalance.lastSyncedAt,
        now: this.dependencies.clock.now(),
        ttlMs: this.dependencies.balanceTtlMs,
      })
    ) {
      return localBalance;
    }

    const remoteBalance = await this.dependencies.hcmClient.getBalance(
      input.employeeId,
      input.locationId,
      input.leaveType,
    );

    return this.dependencies.balances.upsert(remoteBalance);
  }
}
