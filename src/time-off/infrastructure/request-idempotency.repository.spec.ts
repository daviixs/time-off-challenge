import { Prisma } from '@prisma/client';
import { RequestIdempotencyRepository } from './request-idempotency.repository';

describe('RequestIdempotencyRepository', () => {
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
    findUnique?: jest.Mock;
    create?: jest.Mock;
    update?: jest.Mock;
    deleteMany?: jest.Mock;
  }) {
    const prisma = {
      requestIdempotency: {
        findUnique: overrides?.findUnique ?? jest.fn(),
        create: overrides?.create ?? jest.fn(),
        update: overrides?.update ?? jest.fn(),
        deleteMany: overrides?.deleteMany ?? jest.fn(),
      },
    };

    return {
      prisma,
      repository: new RequestIdempotencyRepository(prisma as never),
    };
  }

  const record = {
    idempotencyKey: 'key-1',
    requestHash: 'hash-1',
    status: 'COMPLETED',
    requestId: 'request-1',
    responseBody: '{"id":"request-1"}',
  };

  it('returns null when the idempotency key does not exist', async () => {
    const { repository } = buildRepository({
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(repository.findByKey('key-1')).resolves.toBeNull();
  });

  it('maps an existing idempotency record to the domain shape', async () => {
    const { repository } = buildRepository({
      findUnique: jest.fn().mockResolvedValue(record),
    });

    await expect(repository.findByKey('key-1')).resolves.toEqual(record);
  });

  it('creates a pending idempotency record', async () => {
    const { repository } = buildRepository({
      create: jest.fn().mockResolvedValue({
        ...record,
        status: 'PENDING',
        requestId: null,
        responseBody: null,
      }),
    });

    await expect(
      repository.createPending({
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
      }),
    ).resolves.toMatchObject({
      idempotencyKey: 'key-1',
      requestHash: 'hash-1',
      status: 'PENDING',
      requestId: null,
      responseBody: null,
    });
  });

  it('returns the existing record when concurrent create hits P2002', async () => {
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue(record),
    });

    await expect(
      repository.createPending({
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
      }),
    ).resolves.toEqual(record);
  });

  it('rethrows P2002 when no existing record can be found', async () => {
    const error = p2002();
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(error),
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(
      repository.createPending({
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
      }),
    ).rejects.toBe(error);
  });

  it('rethrows non-unique create errors', async () => {
    const error = new Error('database unavailable');
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(error),
    });

    await expect(
      repository.createPending({
        idempotencyKey: 'key-1',
        requestHash: 'hash-1',
      }),
    ).rejects.toBe(error);
  });

  it('marks an idempotency record as completed', async () => {
    const update = jest.fn().mockResolvedValue(record);
    const { repository } = buildRepository({ update });

    await repository.complete({
      idempotencyKey: 'key-1',
      requestId: 'request-1',
      responseBody: '{"id":"request-1"}',
    });

    expect(update).toHaveBeenCalledWith({
      where: { idempotencyKey: 'key-1' },
      data: {
        status: 'COMPLETED',
        requestId: 'request-1',
        responseBody: '{"id":"request-1"}',
      },
    });
  });

  it('deletes only pending idempotency rows', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const { repository } = buildRepository({ deleteMany });

    await repository.deletePending('key-1');

    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        idempotencyKey: 'key-1',
        status: 'PENDING',
      },
    });
  });
});
