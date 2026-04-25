import { AppError } from '../common/errors/app-error';
import { LeaveType, Role } from '../time-off/domain/time-off.types';
import { BalancesController } from './balances.controller';

describe('BalancesController', () => {
  const balancesService = {
    getCurrentBalance: jest.fn(),
  };

  beforeEach(() => {
    balancesService.getCurrentBalance.mockReset();
  });

  it('allows employees to read their own balances', async () => {
    balancesService.getCurrentBalance.mockResolvedValue({ availableDays: 10 });
    const controller = new BalancesController(balancesService as never);

    await expect(
      controller.getBalance('emp-001', Role.EMPLOYEE, {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
      }),
    ).resolves.toEqual({ availableDays: 10 });
    expect(balancesService.getCurrentBalance).toHaveBeenCalledWith({
      employeeId: 'emp-001',
      locationId: 'loc-nyc',
      leaveType: LeaveType.VACATION,
    });
  });

  it('allows managers to read employee balances', async () => {
    balancesService.getCurrentBalance.mockResolvedValue({ availableDays: 10 });
    const controller = new BalancesController(balancesService as never);

    await expect(
      controller.getBalance('mgr-001', Role.MANAGER, {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
      }),
    ).resolves.toEqual({ availableDays: 10 });
  });

  it('rejects employees reading another employee balance', async () => {
    const controller = new BalancesController(balancesService as never);

    await expect(
      controller.getBalance('emp-999', Role.EMPLOYEE, {
        employeeId: 'emp-001',
        locationId: 'loc-nyc',
        leaveType: LeaveType.VACATION,
      }),
    ).rejects.toMatchObject<AppError>({
      code: 'FORBIDDEN_ROLE',
      statusCode: 403,
    });
    expect(balancesService.getCurrentBalance).not.toHaveBeenCalled();
  });
});
