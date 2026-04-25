import { LeaveType, Role } from './domain/time-off.types';
import { TimeOffController } from './time-off.controller';

describe('TimeOffController', () => {
  const requestsService = {
    createRequest: jest.fn(),
    approveRequest: jest.fn(),
    rejectRequest: jest.fn(),
    cancelRequest: jest.fn(),
  };
  const requestQueryService = {
    getRequest: jest.fn(),
    listRequests: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  function buildController() {
    return new TimeOffController(
      requestsService as never,
      requestQueryService as never,
    );
  }

  it('passes actor, body, and idempotency key when creating requests', () => {
    requestsService.createRequest.mockReturnValue({ id: 'request-1' });
    const controller = buildController();
    const body = {
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
      startDate: '2026-05-01',
      endDate: '2026-05-03',
    };

    expect(
      controller.createRequest('emp-001', Role.EMPLOYEE, 'idem-key-1', body),
    ).toEqual({ id: 'request-1' });
    expect(requestsService.createRequest).toHaveBeenCalledWith(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      body,
      { idempotencyKey: 'idem-key-1' },
    );
  });

  it('passes actor and id to get requests', () => {
    requestQueryService.getRequest.mockReturnValue({ id: 'request-1' });
    const controller = buildController();

    expect(
      controller.getRequest('emp-001', Role.EMPLOYEE, 'request-1'),
    ).toEqual({
      id: 'request-1',
    });
    expect(requestQueryService.getRequest).toHaveBeenCalledWith(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      'request-1',
    );
  });

  it('passes actor and filters to list requests', () => {
    requestQueryService.listRequests.mockReturnValue([]);
    const controller = buildController();

    expect(
      controller.listRequests('mgr-001', Role.MANAGER, {
        employeeId: 'emp-001',
        status: 'PENDING',
      }),
    ).toEqual([]);
    expect(requestQueryService.listRequests).toHaveBeenCalledWith(
      { userId: 'mgr-001', role: Role.MANAGER },
      { employeeId: 'emp-001', status: 'PENDING' },
    );
  });

  it('passes actor, id, and body to lifecycle actions', () => {
    requestsService.approveRequest.mockReturnValue({ status: 'APPROVED' });
    requestsService.rejectRequest.mockReturnValue({ status: 'REJECTED' });
    requestsService.cancelRequest.mockReturnValue({ status: 'CANCELLED' });
    const controller = buildController();

    expect(
      controller.approveRequest('mgr-001', Role.MANAGER, 'request-1', {
        notes: 'ok',
      }),
    ).toEqual({ status: 'APPROVED' });
    expect(
      controller.rejectRequest('mgr-001', Role.MANAGER, 'request-1', {
        notes: 'no',
      }),
    ).toEqual({ status: 'REJECTED' });
    expect(
      controller.cancelRequest('emp-001', Role.EMPLOYEE, 'request-1', {
        reason: 'changed',
      }),
    ).toEqual({ status: 'CANCELLED' });

    expect(requestsService.approveRequest).toHaveBeenCalledWith(
      { userId: 'mgr-001', role: Role.MANAGER },
      'request-1',
      { notes: 'ok' },
    );
    expect(requestsService.rejectRequest).toHaveBeenCalledWith(
      { userId: 'mgr-001', role: Role.MANAGER },
      'request-1',
      { notes: 'no' },
    );
    expect(requestsService.cancelRequest).toHaveBeenCalledWith(
      { userId: 'emp-001', role: Role.EMPLOYEE },
      'request-1',
      { reason: 'changed' },
    );
  });
});
