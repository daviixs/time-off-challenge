import {
  buildHcmIdempotencyKey,
  calculateInclusiveDurationDays,
  isBalanceStale,
  rangesOverlap,
} from './time-off-policy';

describe('time-off policy', () => {
  it('calculates inclusive calendar day duration', () => {
    expect(
      calculateInclusiveDurationDays(
        new Date('2026-05-01'),
        new Date('2026-05-03'),
      ),
    ).toBe(3);
  });

  it('treats same-day requests as one day', () => {
    expect(
      calculateInclusiveDurationDays(
        new Date('2026-05-01'),
        new Date('2026-05-01'),
      ),
    ).toBe(1);
  });

  it('detects inclusive overlap across date ranges', () => {
    expect(
      rangesOverlap(
        { startDate: new Date('2026-05-01'), endDate: new Date('2026-05-03') },
        { startDate: new Date('2026-05-03'), endDate: new Date('2026-05-05') },
      ),
    ).toBe(true);
  });

  it('marks balances stale once ttl is exceeded', () => {
    expect(
      isBalanceStale({
        lastSyncedAt: new Date('2026-05-01T00:00:00.000Z'),
        now: new Date('2026-05-01T00:05:01.000Z'),
        ttlMs: 5 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it('builds deterministic HCM idempotency keys', () => {
    expect(buildHcmIdempotencyKey('request-123', 'consume')).toBe(
      'time-off:request-123:consume:v1',
    );
  });
});
