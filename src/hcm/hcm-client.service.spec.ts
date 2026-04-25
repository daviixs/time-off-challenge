import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { HcmClientService } from './hcm-client.service';
import { LeaveType } from '../time-off/domain/time-off.types';

describe('HcmClientService payload validation', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'HCM_BASE_URL') {
        return 'http://mock-hcm.test';
      }

      if (key === 'HCM_TIMEOUT_MS') {
        return 2000;
      }

      return undefined;
    }),
  } as unknown as ConfigService;

  const logRepository = {
    create: jest.fn(() => undefined),
  };

  let service: HcmClientService;

  beforeEach(() => {
    jest.restoreAllMocks();
    logRepository.create.mockClear();
    service = new HcmClientService(configService, logRepository);
  });

  it('rejects mismatched dimensions from HCM reads', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: {
        employeeId: 'emp-999',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        availableDays: 10,
        sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
      },
    });

    await expect(
      service.getBalance('emp-001', 'loc-nyc', LeaveType.VACATION),
    ).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });

  it('rejects negative balances from HCM writes', async () => {
    jest.spyOn(axios, 'post').mockResolvedValue({
      status: 200,
      data: {
        transactionId: 'hcm-tx-001',
        balance: {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: LeaveType.VACATION,
          availableDays: -2,
          sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
        },
      },
    });

    await expect(
      service.consumeBalance({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        days: 3,
        requestId: 'request-1',
        idempotencyKey: 'time-off:request-1:consume:v1',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_HCM_PAYLOAD',
      statusCode: 502,
    });
  });
});
