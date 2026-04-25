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
    // future-proof for hardening tables
    await prisma.$executeRawUnsafe('DELETE FROM "RequestIdempotency"');
    await prisma.$executeRawUnsafe('DELETE FROM "HcmOperation"');
    await prisma.$executeRawUnsafe('DELETE FROM "BalanceDimensionLease"');
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

  it('moves the request to APPROVAL_UNKNOWN and persists an UNKNOWN HCM operation when the consume result is ambiguous', async () => {
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
      new AppError(
        'HCM_RESULT_UNKNOWN',
        503,
        'HCM timed out before confirming the operation result.',
      ),
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
      code: 'HCM_RESULT_UNKNOWN',
      statusCode: 503,
    });

    const storedRequest = await prisma.timeOffRequest.findUniqueOrThrow({
      where: { id: created.id },
    });
    const operation = await prisma.hcmOperation.findUniqueOrThrow({
      where: {
        idempotencyKey: `time-off:${created.id}:consume:v1`,
      },
    });

    expect(storedRequest.status).toBe('APPROVAL_UNKNOWN');
    expect(operation.status).toBe('UNKNOWN');
  });

  it('reuses a SUCCESS consume operation without calling HCM again', async () => {
    const created = await prisma.timeOffRequest.create({
      data: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: new Date('2026-05-03T00:00:00.000Z'),
        durationDays: 3,
        status: 'APPROVAL_IN_PROGRESS',
      },
    });

    await prisma.hcmOperation.create({
      data: {
        requestId: created.id,
        operationType: 'CONSUME',
        idempotencyKey: `time-off:${created.id}:consume:v1`,
        status: 'SUCCESS',
        transactionId: 'hcm-tx-001',
        responseBody: JSON.stringify({
          transactionId: 'hcm-tx-001',
          balance: {
            employeeId: 'emp-001',
            locationId: 'loc-nyc',
            leaveType: 'VACATION',
            availableDays: 7,
            sourceUpdatedAt: '2026-04-24T00:02:00.000Z',
          },
        }),
      },
    });

    const approved = await requestsService.approveRequest(
      { userId: 'mgr-001', role: Role.MANAGER },
      created.id,
      { notes: 'Approved' },
    );

    expect(approved.status).toBe('APPROVED');
    expect(hcmClientMock.consumeBalance).not.toHaveBeenCalled();
  });

  it('reuses a SUCCESS restore operation without calling HCM again', async () => {
    const created = await prisma.timeOffRequest.create({
      data: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: new Date('2026-05-03T00:00:00.000Z'),
        durationDays: 3,
        status: 'CANCELLATION_IN_PROGRESS',
        resolvedBy: 'mgr-001',
        resolvedAt: new Date('2026-04-24T00:01:00.000Z'),
        hcmTransactionId: 'hcm-tx-001',
      },
    });

    await prisma.hcmOperation.create({
      data: {
        requestId: created.id,
        operationType: 'RESTORE',
        idempotencyKey: `time-off:${created.id}:restore:v1`,
        status: 'SUCCESS',
        transactionId: 'hcm-tx-restore-001',
        responseBody: JSON.stringify({
          transactionId: 'hcm-tx-restore-001',
          balance: {
            employeeId: 'emp-001',
            locationId: 'loc-nyc',
            leaveType: 'VACATION',
            availableDays: 10,
            sourceUpdatedAt: '2026-04-24T00:02:00.000Z',
          },
        }),
      },
    });

    const cancelled = await requestsService.cancelRequest(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      created.id,
      { reason: 'Plans changed' },
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(hcmClientMock.restoreBalance).not.toHaveBeenCalled();
  });

  it('serializes simultaneous approvals for the same balance dimension', async () => {
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

    const first = await requestsService.createRequest(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        startDate: '2026-05-01',
        endDate: '2026-05-03',
      },
    );
    const second = await requestsService.createRequest(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
        startDate: '2026-05-10',
        endDate: '2026-05-12',
      },
    );

    let releaseConsume!: (value: {
      transactionId: string;
      balance: {
        employeeId: string;
        locationId: string;
        leaveType: LeaveType;
        availableDays: number;
        lastSyncedAt: Date;
        sourceUpdatedAt: Date;
        version: number;
        createdAt: Date;
        updatedAt: Date;
      };
    }) => void;
    const consumeStarted = new Promise<void>((resolve) => {
      hcmClientMock.consumeBalance.mockImplementationOnce(
        () =>
          new Promise((innerResolve) => {
            releaseConsume = innerResolve;
            resolve();
          }),
      );
    });

    const firstApproval = requestsService.approveRequest(
      { userId: 'mgr-001', role: Role.MANAGER },
      first.id,
      {},
    );
    await consumeStarted;

    await expect(
      requestsService.approveRequest(
        { userId: 'mgr-001', role: Role.MANAGER },
        second.id,
        {},
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'BALANCE_DIMENSION_LOCKED',
      statusCode: 409,
    });

    releaseConsume({
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

    await expect(firstApproval).resolves.toMatchObject({
      status: 'APPROVED',
    });
    expect(hcmClientMock.consumeBalance).toHaveBeenCalledTimes(1);

    const storedBalance = await prisma.balance.findUniqueOrThrow({
      where: {
        employeeId_locationId_leaveType: {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: 'VACATION',
        },
      },
    });
    expect(storedBalance.availableDays).toBe(7);
  });

  it('rejects approval when the balance dimension lease is already held', async () => {
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

    await prisma.balanceDimensionLease.create({
      data: {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        holderId: 'existing-holder',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      },
    });

    await expect(
      requestsService.approveRequest(
        { userId: 'mgr-001', role: Role.MANAGER },
        created.id,
        {},
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'BALANCE_DIMENSION_LOCKED',
      statusCode: 409,
    });
  });
});
