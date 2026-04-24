import { Controller, Get, Headers, Query } from '@nestjs/common';
import { actorFromHeaders } from '../common/auth/header-actor';
import { AppError } from '../common/errors/app-error';
import { Role } from '../time-off/domain/time-off.types';
import { BalancesService } from './application/balances.service';
import { GetBalanceQueryDto } from './dto/get-balance-query.dto';

@Controller('balances')
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get()
  async getBalance(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('x-role') role: string | undefined,
    @Query() query: GetBalanceQueryDto,
  ) {
    const actor = actorFromHeaders({ userId, role });
    if (actor.role === Role.EMPLOYEE && actor.userId !== query.employeeId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Employees may only view their own balances.',
      );
    }

    return this.balancesService.getCurrentBalance(query);
  }
}
