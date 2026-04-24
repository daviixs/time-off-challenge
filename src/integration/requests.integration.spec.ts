import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AppError } from '../common/errors/app-error';
import { HcmClientService } from '../hcm/hcm-client.service';
import { PrismaService } from '../prisma/prisma.service';
import { RequestsService } from '../time-off/application/requests.service';
import { LeaveType, Role } from '../time-off/domain/time-off.types';

jest.setTimeout(30000);

describe('RequestsService integration', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let requestsService: RequestsService;
  let workspacePath: string;
  let hcmClientMock: {
    getBalance: jest.Mock;
    consumeBalance: jest.Mock;
    restoreBalance: jest.Mock;
  };

  beforeAll(async () => {
    workspacePath = mkdtempSync(join(tmpdir(), 'time-off-integration-'));
    process.env.DATABASE_URL = `file:${join(workspacePath, 'integration.db')}`;
    process.env.BALANCE_TTL_MS = '300000';
    process.env.HCM_BASE_URL = 'http://unused-for-integration-tests';

    execSync('npx prisma db push', {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'ignore',
    });

    hcmClientMock = {
      getBalance: jest.fn(),
      consumeBalance: jest.fn(),
      restoreBalance: jest.fn(),
    };

    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(HcmClientService)
      .useValue(hcmClientMock)
      .compile();

    prisma = moduleRef.get(PrismaService);
    requestsService = moduleRef.get(RequestsService);
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
    rmSync(workspacePath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    await prisma.hcmOperationLog.deleteMany();
    await prisma.syncLog.deleteMany();
    await prisma.timeOffRequest.deleteMany();
    await prisma.balance.deleteMany();
    await prisma.employee.deleteMany();

    await prisma.employee.createMany({
      data: [
        {
          id: 'emp-001',
          name: 'Employee One',
          email: 'emp-001@example.com',
          role: 'EMPLOYEE',
        },
        {
          id: 'mgr-001',
          name: 'Manager One',
          email: 'mgr-001@example.com',
          role: 'MANAGER',
        },
      ],
    });

    await prisma.balance.create({
      data: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        availableDays: 10,
        lastSyncedAt: new Date('2026-04-24T00:00:00.000Z'),
        sourceUpdatedAt: new Date('2026-04-24T00:00:00.000Z'),
        version: 1,
      },
    });
  });

  it('creates and approves a request against the real database using the injected HCM client', async () => {
    hcmClientMock.getBalance.mockResolvedValue({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
      availableDays: 10,
      lastSyncedAt: new Date('2026-04-24T00:01:00.000Z'),
      sourceUpdatedAt: new Date('2026-04-24T00:01:00.000Z'),
      version: 2,
      createdAt: new Date('2026-04-24T00:01:00.000Z'),
      updatedAt: new Date('2026-04-24T00:01:00.000Z'),
    });
    hcmClientMock.consumeBalance.mockResolvedValue({
      transactionId: 'hcm-tx-001',
      balance: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        availableDays: 7,
        lastSyncedAt: new Date('2026-04-24T00:02:00.000Z'),
        sourceUpdatedAt: new Date('2026-04-24T00:02:00.000Z'),
        version: 3,
        createdAt: new Date('2026-04-24T00:02:00.000Z'),
        updatedAt: new Date('2026-04-24T00:02:00.000Z'),
      },
    });

    const created = await requestsService.createRequest(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        notes: 'Trip',
      },
    );

    const approved = await requestsService.approveRequest(
      { userId: 'mgr-001', role: Role.MANAGER },
      created.id,
      { notes: 'Approved' },
    );

    const storedRequest = await prisma.timeOffRequest.findUniqueOrThrow({
      where: { id: approved.id },
    });
    const storedBalance = await prisma.balance.findUniqueOrThrow({
      where: {
        employeeId_locationId_leaveType: {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: 'VACATION',
        },
      },
    });

    expect(approved.status).toBe('APPROVED');
    expect(storedRequest.status).toBe('APPROVED');
    expect(storedRequest.hcmTransactionId).toBe('hcm-tx-001');
    expect(storedBalance.availableDays).toBe(7);
  });

  it('keeps the request pending when HCM approval fails', async () => {
    hcmClientMock.getBalance.mockResolvedValue({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
      availableDays: 10,
      lastSyncedAt: new Date('2026-04-24T00:01:00.000Z'),
      sourceUpdatedAt: new Date('2026-04-24T00:01:00.000Z'),
      version: 2,
      createdAt: new Date('2026-04-24T00:01:00.000Z'),
      updatedAt: new Date('2026-04-24T00:01:00.000Z'),
    });
    hcmClientMock.consumeBalance.mockRejectedValue(
      new AppError('HCM_UNAVAILABLE', 503, 'Cannot reach authoritative HCM.'),
    );

    const created = await requestsService.createRequest(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        startDate: '2026-05-01',
        endDate: '2026-05-03',
      },
    );

    await expect(
      requestsService.approveRequest(
        { userId: 'mgr-001', role: Role.MANAGER },
        created.id,
        {},
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'HCM_UNAVAILABLE',
      statusCode: 503,
    });

    const storedRequest = await prisma.timeOffRequest.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(storedRequest.status).toBe('PENDING');
  });
});
