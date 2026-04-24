import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { type Actor, Role } from '../domain/time-off.types';
import { TimeOffRequestRepository } from '../infrastructure/time-off-request.repository';

@Injectable()
export class RequestQueryService {
  constructor(private readonly requests: TimeOffRequestRepository) {}

  async getRequest(actor: Actor, requestId: string) {
    const request = await this.requests.findById(requestId);

    if (!request) {
      throw new AppError('REQUEST_NOT_FOUND', 404, 'Request was not found.');
    }

    if (actor.role === Role.EMPLOYEE && actor.userId !== request.employeeId) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Employees may only view their own requests.',
      );
    }

    return request;
  }

  async listRequests(
    actor: Actor,
    filters: {
      employeeId?: string;
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    },
  ) {
    if (
      actor.role === Role.EMPLOYEE &&
      filters.employeeId &&
      filters.employeeId !== actor.userId
    ) {
      throw new AppError(
        'FORBIDDEN_ROLE',
        403,
        'Employees may only view their own requests.',
      );
    }

    return this.requests.list({
      employeeId:
        actor.role === Role.EMPLOYEE ? actor.userId : filters.employeeId,
      status: filters.status,
    });
  }
}
