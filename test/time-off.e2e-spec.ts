/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */

import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppExceptionFilter } from '../src/common/errors/app-exception.filter';
import { AppModule } from '../src/app.module';
import { createSqliteAdapter } from '../src/prisma/sqlite-adapter';
import {
  startMockHcmServer,
  type MockHcmServer,
} from './support/mock-hcm-server';

jest.setTimeout(30000);

describe('Time-off API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let mockHcm: MockHcmServer;
  let workspacePath: string;

  beforeAll(async () => {
    workspacePath = mkdtempSync(join(tmpdir(), 'time-off-e2e-'));
    process.env.DATABASE_URL = `file:${join(workspacePath, 'test.db')}`;
    process.env.BALANCE_TTL_MS = '300000';

    mockHcm = await startMockHcmServer();
    process.env.HCM_BASE_URL = mockHcm.baseUrl;

    execSync('npx prisma db push', {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'ignore',
    });

    prisma = new PrismaClient({
      adapter: createSqliteAdapter(process.env.DATABASE_URL),
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
    if (mockHcm) {
      await mockHcm.close();
    }
    rmSync(workspacePath, { recursive: true, force: true });
  });

  beforeEach(async () => {
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
    await mockHcm.reset();
  });

  it('supports batch sync, request creation, approval, and balance refresh end-to-end', async () => {
    await request(app.getHttpServer())
      .post('/sync/batch')
      .send({
        balances: [
          {
            employeeId: 'emp-001',
            locationId: 'loc-nyc',
            leaveType: 'VACATION',
            availableDays: 10,
            sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
          },
        ],
      })
      .expect(201)
      .expect({ processed: 1, failed: 0, skipped: 0 });

    await mockHcm.seedBalance({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: 'VACATION',
      availableDays: 10,
      sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
    });

    const created = await request(app.getHttpServer())
      .post('/time-off/requests')
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
        notes: 'Trip',
      })
      .expect(201);

    expect(created.body.status).toBe('PENDING');

    const approved = await request(app.getHttpServer())
      .patch(`/time-off/requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr-001')
      .set('x-role', 'MANAGER')
      .send({ notes: 'Approved' })
      .expect(200);

    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.hcmTransactionId).toBeDefined();

    const balance = await request(app.getHttpServer())
      .get('/balances')
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .query({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
      })
      .expect(200);

    expect(balance.body.availableDays).toBe(7);
  });

  it('restores HCM balance when cancelling an approved request', async () => {
    await mockHcm.seedBalance({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: 'VACATION',
      availableDays: 10,
      sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post('/sync/batch')
      .send({
        balances: [
          {
            employeeId: 'emp-001',
            locationId: 'loc-nyc',
            leaveType: 'VACATION',
            availableDays: 10,
            sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
          },
        ],
      })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/time-off/requests')
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-03',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/time-off/requests/${created.body.id}/approve`)
      .set('x-user-id', 'mgr-001')
      .set('x-role', 'MANAGER')
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/time-off/requests/${created.body.id}/cancel`)
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .send({ reason: 'Plans changed' })
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('CANCELLED');
      });

    const balance = await request(app.getHttpServer())
      .get('/balances')
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .query({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
      })
      .expect(200);

    expect(balance.body.availableDays).toBe(10);
  });

  it('marks pending requests at risk after a realtime sync reduces available balance', async () => {
    await mockHcm.seedBalance({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: 'VACATION',
      availableDays: 10,
      sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post('/sync/batch')
      .send({
        balances: [
          {
            employeeId: 'emp-001',
            locationId: 'loc-nyc',
            leaveType: 'VACATION',
            availableDays: 10,
            sourceUpdatedAt: '2026-04-24T00:00:00.000Z',
          },
        ],
      })
      .expect(201);

    const created = await request(app.getHttpServer())
      .post('/time-off/requests')
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .send({
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: 'VACATION',
        startDate: '2026-05-01',
        endDate: '2026-05-05',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/sync/realtime')
      .send({
        balance: {
          employeeId: 'emp-001',
          locationId: 'loc-nyc',
          leaveType: 'VACATION',
          availableDays: 4,
          sourceUpdatedAt: '2026-04-24T00:10:00.000Z',
        },
      })
      .expect(201);

    const fetched = await request(app.getHttpServer())
      .get(`/time-off/requests/${created.body.id}`)
      .set('x-user-id', 'emp-001')
      .set('x-role', 'EMPLOYEE')
      .expect(200);

    expect(fetched.body.atRisk).toBe(true);
  });
});
