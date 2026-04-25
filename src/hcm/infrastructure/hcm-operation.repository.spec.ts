import { Prisma } from '@prisma/client';
import { HcmOperationRepository } from './hcm-operation.repository';

describe('HcmOperationRepository', () => {
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
  }) {
    const prisma = {
      hcmOperation: {
        findUnique: overrides?.findUnique ?? jest.fn(),
        create: overrides?.create ?? jest.fn(),
        update: overrides?.update ?? jest.fn(),
      },
    };

    return {
      prisma,
      repository: new HcmOperationRepository(prisma as never),
    };
  }

  const operation = {
    id: 'operation-1',
    requestId: 'request-1',
    operationType: 'CONSUME',
    idempotencyKey: 'time-off:request-1:consume:v1',
    status: 'PENDING',
    transactionId: null,
    responseBody: null,
    errorCode: null,
    errorMessage: null,
  };

  it('returns null when an operation does not exist', async () => {
    const { repository } = buildRepository({
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(
      repository.findByKey(operation.idempotencyKey),
    ).resolves.toBeNull();
  });

  it('maps an existing HCM operation to the domain shape', async () => {
    const { repository } = buildRepository({
      findUnique: jest.fn().mockResolvedValue(operation),
    });

    await expect(
      repository.findByKey(operation.idempotencyKey),
    ).resolves.toEqual(operation);
  });

  it('creates a pending HCM operation', async () => {
    const create = jest.fn().mockResolvedValue(operation);
    const { repository } = buildRepository({ create });

    await expect(
      repository.createPending({
        requestId: 'request-1',
        operationType: 'CONSUME',
        idempotencyKey: operation.idempotencyKey,
      }),
    ).resolves.toEqual(operation);
    expect(create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1',
        operationType: 'CONSUME',
        idempotencyKey: operation.idempotencyKey,
        status: 'PENDING',
      },
    });
  });

  it('returns an existing operation after a concurrent P2002 create', async () => {
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(p2002()),
      findUnique: jest.fn().mockResolvedValue(operation),
    });

    await expect(
      repository.createPending({
        requestId: 'request-1',
        operationType: 'CONSUME',
        idempotencyKey: operation.idempotencyKey,
      }),
    ).resolves.toEqual(operation);
  });

  it('rethrows P2002 when the existing operation cannot be loaded', async () => {
    const error = p2002();
    const { repository } = buildRepository({
      create: jest.fn().mockRejectedValue(error),
      findUnique: jest.fn().mockResolvedValue(null),
    });

    await expect(
      repository.createPending({
        requestId: 'request-1',
        operationType: 'CONSUME',
        idempotencyKey: operation.idempotencyKey,
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
        requestId: 'request-1',
        operationType: 'CONSUME',
        idempotencyKey: operation.idempotencyKey,
      }),
    ).rejects.toBe(error);
  });

  it('resets failed operations back to pending', async () => {
    const update = jest.fn().mockResolvedValue(operation);
    const { repository } = buildRepository({ update });

    await repository.resetToPending(operation.idempotencyKey);

    expect(update).toHaveBeenCalledWith({
      where: { idempotencyKey: operation.idempotencyKey },
      data: {
        status: 'PENDING',
        errorCode: null,
        errorMessage: null,
      },
    });
  });

  it('marks operations as success, unknown, and failed', async () => {
    const update = jest.fn().mockResolvedValue(operation);
    const { repository } = buildRepository({ update });

    await repository.markSuccess({
      idempotencyKey: operation.idempotencyKey,
      transactionId: 'hcm-tx-001',
      responseBody: '{"ok":true}',
    });
    await repository.markUnknown({
      idempotencyKey: operation.idempotencyKey,
      errorCode: 'HCM_RESULT_UNKNOWN',
      errorMessage: 'timeout',
    });
    await repository.markFailed({
      idempotencyKey: operation.idempotencyKey,
      errorCode: 'HCM_UNAVAILABLE',
      errorMessage: 'down',
    });

    expect(update).toHaveBeenCalledWith({
      where: { idempotencyKey: operation.idempotencyKey },
      data: {
        status: 'SUCCESS',
        transactionId: 'hcm-tx-001',
        responseBody: '{"ok":true}',
        errorCode: null,
        errorMessage: null,
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { idempotencyKey: operation.idempotencyKey },
      data: {
        status: 'UNKNOWN',
        errorCode: 'HCM_RESULT_UNKNOWN',
        errorMessage: 'timeout',
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { idempotencyKey: operation.idempotencyKey },
      data: {
        status: 'FAILED',
        errorCode: 'HCM_UNAVAILABLE',
        errorMessage: 'down',
      },
    });
  });
});
