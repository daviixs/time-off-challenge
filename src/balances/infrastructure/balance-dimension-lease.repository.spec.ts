import { Prisma } from '@prisma/client';
import { BalanceDimensionLeaseRepository } from './balance-dimension-lease.repository';
import { LeaveType } from '../../time-off/domain/time-off.types';

describe('BalanceDimensionLeaseRepository', () => {
  const dimension = {
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
    holderId: 'holder-1',
    now: new Date('2026-04-24T00:00:00.000Z'),
    ttlMs: 30_000,
  };

  function p2002() {
    return new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );
  }

  function buildRepository(overrides?: {
    create?: jest.Mock;
    findUnique?: jest.Mock;
    update?: jest.Mock;
    updateMany?: jest.Mock;
    deleteMany?: jest.Mock;
  }) {
    const prisma = {
      balanceDimensionLease: {
        create: overrides?.create ?? jest.fn(),
        findUnique: overrides?.findUnique ?? jest.fn(),
        update: overrides?.update ?? jest.fn(),
        updateMany: overrides?.updateMany ?? jest.fn(),
        deleteMany: overrides?.deleteMany ?? jest.fn(),
      },
    };

    return {
      prisma,
      repository: new BalanceDimensionLeaseRepository(prisma as never),
    };
  }

  it('acquires a lease when no row exists', async () => {
    const create = jest.fn().mockResolvedValue({});
    const { repository } = buildRepository({ create });

    await expect(repository.acquire(dimension)).resolves.toBe(true);

    expect(create).toHaveBeenCalledWith({
      data: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        holderId: 'holder-1',
        expiresAt: new Date('2026-04-24T00:00:30.000Z'),
      },
    });
  });

  it('rethrows non-unique create errors', async () => {
    const error = new Error('database unavailable');
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(error),
    });

    await expect(repository.acquire(dimension)).rejects.toBe(error);
  });

  it('returns false when a P2002 conflict cannot be loaded', async () => {
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(repository.acquire(dimension)).resolves.toBe(false);
  });

  it('refreshes a lease held by the same holder', async () => {
    const update = jest.fn().mockResolvedValue({});
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue({
        ...dimension,
        expiresAt: new Date('2026-04-24T00:00:10.000Z'),
      }),
      update,
    });

    await expect(repository.acquire(dimension)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: {
        employeeId_locationId_leaveType: {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
        },
      },
      data: {
        expiresAt: new Date('2026-04-24T00:00:30.000Z'),
      },
    });
  });

  it('takes over an expired lease held by another holder', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue({
        ...dimension,
        holderId: 'other-holder',
        expiresAt: new Date('2026-04-23T23:59:59.000Z'),
      }),
      updateMany,
    });

    await expect(repository.acquire(dimension)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        expiresAt: {
          lte: dimension.now,
        },
      },
      data: {
        holderId: 'holder-1',
        expiresAt: new Date('2026-04-24T00:00:30.000Z'),
      },
    });
  });

  it('returns false when expired lease takeover loses the race', async () => {
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue({
        ...dimension,
        holderId: 'other-holder',
        expiresAt: new Date('2026-04-23T23:59:59.000Z'),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    });

    await expect(repository.acquire(dimension)).resolves.toBe(false);
  });

  it('returns false when an unexpired lease is held by another holder', async () => {
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue({
        ...dimension,
        holderId: 'other-holder',
        expiresAt: new Date('2026-04-24T00:00:01.000Z'),
      }),
    });

    await expect(repository.acquire(dimension)).resolves.toBe(false);
  });

  it('releases only the lease held by the current holder', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const { repository } = buildRepository({ deleteMany });

    await repository.release(dimension);

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        holderId: 'holder-1',
      },
    });
  });
});
