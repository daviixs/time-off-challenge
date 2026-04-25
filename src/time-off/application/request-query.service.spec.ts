import { AppError } from '../../common/errors/app-error';
import { LeaveType, Role, type TimeOffRequest } from '../domain/time-off.types';
import { RequestQueryService } from './request-query.service';

class InMemoryRequestRepository {
  public listFilters: unknown[] = [];

  constructor(private readonly requests: TimeOffRequest[]) {}

  findById(id: string): Promise<TimeOffRequest | null> {
    return Promise.resolve(
      this.requests.find((request) => request.id === id) ?? null,
    );
  }

  list(filters: {
    employeeId?: string;
    status?: TimeOffRequest['status'];
  }): Promise<TimeOffRequest[]> {
    this.listFilters.push(filters);
    return Promise.resolve(
      this.requests.filter(
        (request) =>
          (!filters.employeeId || request.employeeId === filters.employeeId) &&
          (!filters.status || request.status === filters.status),
      ),
    );
  }
}

describe('RequestQueryService', () => {
  const request: TimeOffRequest = {
    id: 'request-1',
    employeeId: 'emp-001',
    locationId: 'loc-nyc',
    leaveType: LeaveType.VACATION,
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

  function buildService(requests = [request]) {
    const repository = new InMemoryRequestRepository(requests);
    return {
      repository,
      service: new RequestQueryService(repository as never),
    };
  }

  it('returns a request for its owning employee', async () => {
    const { service } = buildService();

    await expect(
      service.getRequest(
        { userId: 'emp-001', role: Role.EMPLOYEE },
        'request-1',
      ),
    ).resolves.toMatchObject({ id: 'request-1' });
  });

  it('allows managers to read any request', async () => {
    const { service } = buildService();

    await expect(
      service.getRequest(
        { userId: 'mgr-001', role: Role.MANAGER },
        'request-1',
      ),
    ).resolves.toMatchObject({ id: 'request-1' });
  });

  it('rejects missing requests', async () => {
    const { service } = buildService([]);

    await expect(
      service.getRequest(
        { userId: 'mgr-001', role: Role.MANAGER },
        'request-1',
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'REQUEST_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects employees reading another employee request', async () => {
    const { service } = buildService();

    await expect(
      service.getRequest(
        { userId: 'emp-999', role: Role.EMPLOYEE },
        'request-1',
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
  });

  it('forces employee list queries to the actor employee id', async () => {
    const { repository, service } = buildService();

    const listed = await service.listRequests(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      {},
    );

    expect(listed).toHaveLength(1);
    expect(repository.listFilters.at(-1)).toEqual({
      employeeId: 'emp-001',
      status: undefined,
    });
  });

  it('rejects employee list queries for another employee', async () => {
    const { service } = buildService();

    await expect(
      service.listRequests(
        { userId: 'emp-001', role: Role.EMPLOYEE },
        { employeeId: 'emp-999' },
      ),
    ).rejects.toMatchObject<AppError>({
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
  });

  it('allows managers to list with explicit filters', async () => {
    const { repository, service } = buildService();

    await service.listRequests(
      { userId: 'mgr-001', role: Role.MANAGER },
      { employeeId: 'emp-001', status: 'PENDING' },
    );

    expect(repository.listFilters.at(-1)).toEqual({
      employeeId: 'emp-001',
      status: 'PENDING',
    });
  });
});
