import { TimeOffRequestRepository } from './time-off-request.repository';
import { LeaveType } from '../domain/time-off.types';

describe('TimeOffRequestRepository', () => {
  const requestRow = {
    id: 'request-1',
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: 'VACATION',
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    endDate: new Date('2026-05-03T00:00:00.000Z'),
    durationDays: 3,
    status: 'PENDING',
    statusReason: null,
    notes: null,
    managerNotes: null,
    resolvedAt: null,
    resolvedBy: null,
    hcmTransactionId: null,
    atRisk: false,
    createdAt: new Date('2026-04-24T00:00:00.000Z'),
    updatedAt: new Date('2026-04-24T00:00:00.000Z'),
  };

  function buildRepository(overrides?: {
    findMany?: jest.Mock;
    create?: jest.Mock;
    findUnique?: jest.Mock;
    updateManyAndReturn?: jest.Mock;
    update?: jest.Mock;
  }) {
    const prisma = {
      timeOffRequest: {
        findMany: overrides?.findMany ?? jest.fn().mockResolvedValue([]),
        create: overrides?.create ?? jest.fn().mockResolvedValue(requestRow),
        findUnique: overrides?.findUnique ?? jest.fn().mockResolvedValue(null),
        updateManyAndReturn:
          overrides?.updateManyAndReturn ?? jest.fn().mockResolvedValue([]),
        update: overrides?.update ?? jest.fn().mockResolvedValue(requestRow),
      },
    };

    return {
      prisma,
      repository: new TimeOffRequestRepository(prisma as never),
    };
  }

  it('maps created and listed request rows to domain requests', async () => {
    const findMany = jest.fn().mockResolvedValue([requestRow]);
    const { repository } = buildRepository({ findMany });

    await expect(
      repository.findOverlappingPendingOrApproved(
        'emp-001',
        'loc-nyc',
        LeaveType.VACATION,
        new Date('2026-05-01T00:00:00.000Z'),
        new Date('2026-05-03T00:00:00.000Z'),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'request-1',
        leaveType: LeaveType.VACATION,
      }),
    ]);

    await expect(
      repository.create({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        startDate: requestRow.startDate,
        endDate: requestRow.endDate,
        durationDays: 3,
        status: 'PENDING',
        statusReason: null,
        notes: null,
        managerNotes: null,
        resolvedAt: null,
        resolvedBy: null,
        hcmTransactionId: null,
        atRisk: false,
      }),
    ).resolves.toMatchObject({ id: 'request-1' });

    await expect(repository.list({ employeeId: 'emp-001' })).resolves.toEqual([
      expect.objectContaining({ id: 'request-1' }),
    ]);
    await expect(
      repository.findPendingByDimension(
        'emp-001',
        'loc-nyc',
        LeaveType.VACATION,
      ),
    ).resolves.toEqual([expect.objectContaining({ id: 'request-1' })]);
  });

  it('returns null when findById does not find a request', async () => {
    const { repository } = buildRepository({
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('returns a request when findById finds a row', async () => {
    const { repository } = buildRepository({
      findUnique: jest.fn().mockResolvedValue(requestRow),
    });

    await expect(repository.findById('request-1')).resolves.toMatchObject({
      id: 'request-1',
    });
  });

  it.each([
    ['beginApproval', () => ['request-1']],
    [
      'finalizeApproval',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'mgr-001',
          managerNotes: 'ok',
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
          hcmTransactionId: 'hcm-tx-001',
        },
      ],
    ],
    ['markApprovalUnknown', () => ['request-1']],
    ['revertApprovalToPending', () => ['request-1']],
    [
      'rejectPending',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'mgr-001',
          managerNotes: 'no',
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        },
      ],
    ],
    [
      'cancelPending',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'emp-001',
          statusReason: 'changed',
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        },
      ],
    ],
    ['beginCancellation', () => ['request-1']],
    [
      'finalizeCancellation',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'emp-001',
          statusReason: 'changed',
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        },
      ],
    ],
    ['markCancellationUnknown', () => ['request-1']],
    ['revertCancellationToApproved', () => ['request-1']],
  ] as const)(
    'returns a domain request when %s conditionally updates a row',
    async (method, buildArgs) => {
      const { repository } = buildRepository({
        updateManyAndReturn: jest.fn().mockResolvedValue([requestRow]),
      });

      const result = await (
        repository[method] as (...args: unknown[]) => Promise<unknown>
      )(...buildArgs());

      expect(result).toMatchObject({ id: 'request-1' });
    },
  );

  it.each([
    ['beginApproval', () => ['request-1']],
    [
      'finalizeApproval',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'mgr-001',
          managerNotes: null,
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
          hcmTransactionId: 'hcm-tx-001',
        },
      ],
    ],
    ['markApprovalUnknown', () => ['request-1']],
    ['revertApprovalToPending', () => ['request-1']],
    [
      'rejectPending',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'mgr-001',
          managerNotes: null,
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        },
      ],
    ],
    [
      'cancelPending',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'emp-001',
          statusReason: null,
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        },
      ],
    ],
    ['beginCancellation', () => ['request-1']],
    [
      'finalizeCancellation',
      () => [
        {
          requestId: 'request-1',
          resolvedBy: 'emp-001',
          statusReason: null,
          resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        },
      ],
    ],
    ['markCancellationUnknown', () => ['request-1']],
    ['revertCancellationToApproved', () => ['request-1']],
  ] as const)(
    'returns null when %s conditional update does not match a row',
    async (method, buildArgs) => {
      const { repository } = buildRepository({
        updateManyAndReturn: jest.fn().mockResolvedValue([]),
      });

      const result = await (
        repository[method] as (...args: unknown[]) => Promise<unknown>
      )(...buildArgs());

      expect(result).toBeNull();
    },
  );

  it('updates atRisk flag by request id', async () => {
    const update = jest.fn().mockResolvedValue(requestRow);
    const { repository } = buildRepository({ update });

    await repository.setAtRisk('request-1', true);

    expect(update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { atRisk: true },
    });
  });
});
