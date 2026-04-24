type DateRange = {
  startDate: Date;
  endDate: Date;
};

type BalanceStalenessInput = {
  lastSyncedAt: Date;
  now: Date;
  ttlMs: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function calculateInclusiveDurationDays(
  startDate: Date,
  endDate: Date,
): number {
  const utcStart = Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  );
  const utcEnd = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  );

  return Math.floor((utcEnd - utcStart) / MS_PER_DAY) + 1;
}

export function rangesOverlap(left: DateRange, right: DateRange): boolean {
  return (
    left.startDate.getTime() <= right.endDate.getTime() &&
    right.startDate.getTime() <= left.endDate.getTime()
  );
}

export function isBalanceStale(input: BalanceStalenessInput): boolean {
  return input.now.getTime() - input.lastSyncedAt.getTime() > input.ttlMs;
}

export function buildHcmIdempotencyKey(
  requestId: string,
  action: 'consume' | 'restore',
): string {
  return `time-off:${requestId}:${action}:v1`;
}
