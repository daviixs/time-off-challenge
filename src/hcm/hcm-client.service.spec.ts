import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { HcmClientService } from './hcm-client.service';
import { LeaveType } from '../time-off/domain/time-off.types';

describe('HcmClientService', () => {
  type HcmLogPayload = {
    operationType: string;
    status: string;
    responseCode?: number;
    payloadHash?: string;
  };

  const logRepository: { create: jest.Mock<void, [HcmLogPayload]> } = {
    create: jest.fn<void, [HcmLogPayload]>(() => undefined),
  };

  function buildConfigService(overrides?: {
    baseUrl?: string;
    timeoutMs?: number;
  }): ConfigService {
    return {
      get: jest.fn((key: string) => {
        if (key === 'HCM_BASE_URL') {
          return overrides?.baseUrl ?? 'http://mock-hcm.test/';
        }

        if (key === 'HCM_TIMEOUT_MS') {
          return overrides?.timeoutMs ?? 2000;
        }

        return undefined;
      }),
    } as unknown as ConfigService;
  }

  function buildService(overrides?: {
    baseUrl?: string;
    timeoutMs?: number;
  }): HcmClientService {
    return new HcmClientService(buildConfigService(overrides), logRepository);
  }

  function successfulBalance(overrides?: {
    employeeId?: string;
    locationId?: string;
    leaveType?: LeaveType;
    availableDays?: number;
    sourceUpdatedAt?: string;
  }) {
    return {
      employeeId: overrides?.employeeId ?? 'emp-001',
      locationId: overrides?.locationId ?? 'loc-nyc',
      leaveType: overrides?.leaveType ?? LeaveType.VACATION,
      availableDays: overrides?.availableDays ?? 10,
      sourceUpdatedAt: overrides?.sourceUpdatedAt ?? '2026-04-24T00:00:00.000Z',
    };
  }

  function consumeInput() {
    return {
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
      days: 3,
      requestId: 'request-1',
      idempotencyKey: 'time-off:request-1:consume:v1',
    };
  }

  let service: HcmClientService;

  beforeEach(() => {
    jest.restoreAllMocks();
    logRepository.create.mockClear();
    service = buildService();
  });

  it('returns a validated balance and records a successful read', async () => {
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: successfulBalance(),
    });

    const balance = await service.getBalance(
      'emp-001',
      'loc-nyc',
      LeaveType.VACATION,
    );

    expect(balance).toMatchObject({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
      availableDays: 10,
    });
    expect(balance.sourceUpdatedAt?.toISOString()).toBe(
      '2026-04-24T00:00:00.000Z',
    );
    expect(getSpy).toHaveBeenCalledWith(
      'http://mock-hcm.test/balances/emp-001/loc-nyc/VACATION',
      { timeout: 2000 },
    );
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'GET_BALANCE',
        status: 'SUCCESS',
        responseCode: 200,
      }),
    );
  });

  it('fails fast when HCM base URL is missing', async () => {
    const serviceWithoutBaseUrl = new HcmClientService(
      {
        get: jest.fn((key: string) => {
          if (key === 'HCM_TIMEOUT_MS') {
            return 2000;
          }

          return undefined;
        }),
      } as unknown as ConfigService,
      logRepository,
    );

    await expect(
      serviceWithoutBaseUrl.getBalance(
        'emp-001',
        'loc-nyc',
        LeaveType.VACATION,
      ),
    ).rejects.toMatchObject({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });
    expect(logRepository.create).not.toHaveBeenCalled();
  });

  it('normalizes 500 responses from HCM reads as unavailable', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue({
      response: {
        status: 500,
        data: { message: 'HCM down' },
      },
    });

    await expect(
      service.getBalance('emp-001', 'loc-nyc', LeaveType.VACATION),
    ).rejects.toMatchObject({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'GET_BALANCE',
        status: 'FAILED',
        responseCode: 500,
        errorCode: 'HCM_UNAVAILABLE',
      }),
    );
  });

  it('normalizes network failures from HCM reads as unavailable', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue({ code: 'ECONNREFUSED' });

    await expect(
      service.getBalance('emp-001', 'loc-nyc', LeaveType.VACATION),
    ).rejects.toMatchObject({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('rejects mismatched dimensions from HCM reads', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: successfulBalance({ employeeId: 'emp-999' }),
    });

    await expect(
      service.getBalance('emp-001', 'loc-nyc', LeaveType.VACATION),
    ).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'GET_BALANCE',
        status: 'FAILED',
        errorCode: 'INVALID_HCM_PAYLOAD',
      }),
    );
  });

  it('rejects invalid sourceUpdatedAt values from HCM reads', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: successfulBalance({ sourceUpdatedAt: 'not-a-date' }),
    });

    await expect(
      service.getBalance('emp-001', 'loc-nyc', LeaveType.VACATION),
    ).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });

  it('returns validated consume results and records a successful write', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        transactionId: 'hcm-tx-001',
        balance: successfulBalance({ availableDays: 7 }),
      },
    });

    const result = await service.consumeBalance(consumeInput());

    expect(result.transactionId).toBe('hcm-tx-001');
    expect(result.balance.availableDays).toBe(7);
    const payload = logRepository.create.mock.calls.at(-1)?.[0];
    expect(payload).toMatchObject({
      operationType: 'CONSUME',
      status: 'SUCCESS',
      responseCode: 200,
    });
    expect(typeof payload?.payloadHash).toBe('string');
  });

  it('falls back to the idempotency key when HCM omits a write transaction id', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        balance: successfulBalance({ availableDays: 7 }),
      },
    });

    const result = await service.consumeBalance(consumeInput());

    expect(result.transactionId).toBe('time-off:request-1:consume:v1');
  });

  it('returns validated restore results', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        transactionId: 'hcm-tx-restore-001',
        balance: successfulBalance({ availableDays: 10 }),
      },
    });

    const result = await service.restoreBalance({
      ...consumeInput(),
      idempotencyKey: 'time-off:request-1:restore:v1',
    });

    expect(result.transactionId).toBe('hcm-tx-restore-001');
    expect(result.balance.availableDays).toBe(10);
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'RESTORE',
        status: 'SUCCESS',
      }),
    );
  });

  it('normalizes consume timeouts as unknown HCM results', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({ code: 'ECONNABORTED' });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'HCM_RESULT_UNKNOWN',
      statusCode: 503,
    });
    expect(logRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'CONSUME',
        status: 'UNKNOWN',
        errorCode: 'HCM_RESULT_UNKNOWN',
      }),
    );
  });

  it('normalizes restore timeouts as unknown HCM results', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({ code: 'ECONNABORTED' });

    await expect(
      service.restoreBalance({
        ...consumeInput(),
        idempotencyKey: 'time-off:request-1:restore:v1',
      }),
    ).rejects.toMatchObject({
      code: 'HCM_RESULT_UNKNOWN',
      statusCode: 503,
    });
  });

  it('normalizes HCM 422 write errors as insufficient balance', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({
      response: {
        status: 422,
        data: { message: 'Not enough balance' },
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      statusCode: 422,
      message: 'Not enough balance',
    });
  });

  it('normalizes HCM 400 write errors as invalid dimensions', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Bad dimension' },
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'INVALID_DIMENSION',
      statusCode: 400,
      message: 'Bad dimension',
    });
  });

  it('normalizes other HCM write rejections as HCM_WRITE_FAILED', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({
      response: {
        status: 409,
        data: { message: 'Conflict' },
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'HCM_WRITE_FAILED',
      statusCode: 502,
      message: 'Conflict',
    });
  });

  it('normalizes 500 write responses as HCM_UNAVAILABLE', async () => {
    jest.spyOn(axios, 'post').mockRejectedValue({
      response: {
        status: 503,
        data: { message: 'Down' },
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('rejects negative balances from HCM writes', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        transactionId: 'hcm-tx-001',
        balance: successfulBalance({ availableDays: -2 }),
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });

  it('rejects invalid sourceUpdatedAt values from HCM writes', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        transactionId: 'hcm-tx-001',
        balance: successfulBalance({ sourceUpdatedAt: 'invalid-date' }),
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });

  it('rejects mismatched dimensions from HCM writes', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        transactionId: 'hcm-tx-001',
        balance: successfulBalance({ locationId: 'loc-sfo' }),
      },
    });

    await expect(service.consumeBalance(consumeInput())).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });
});
