import { Injectable } from '@nestjs/common';
import {
  RequestStatus,
  type TimeOffRequest as PrismaTimeOffRequest,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type LeaveType,
  type TimeOffRequest,
  type TimeOffRequestStatus,
} from '../domain/time-off.types';

type CreateRequestInput = Omit<
  TimeOffRequest,
  'id' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class TimeOffRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOverlappingPendingOrApproved(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    startDate: Date,
    endDate: Date,
  ): Promise<TimeOffRequest[]> {
    const requests = await this.prisma.timeOffRequest.findMany({
      where: {
        employeeId,
        locationId,
        leaveType,
        status: {
          in: [RequestStatus.PENDING, RequestStatus.APPROVED],
        },
        startDate: {
          lte: endDate,
        },
        endDate: {
          gte: startDate,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return requests.map((request) => this.toDomain(request));
  }

  async create(input: CreateRequestInput): Promise<TimeOffRequest> {
    const created = await this.prisma.timeOffRequest.create({
      data: {
        employeeId: input.employeeId,
        locationId: input.locationId,
        leaveType: input.leaveType,
        startDate: input.startDate,
        endDate: input.endDate,
        durationDays: input.durationDays,
        status: input.status,
        statusReason: input.statusReason,
        notes: input.notes,
        managerNotes: input.managerNotes,
        resolvedAt: input.resolvedAt,
        resolvedBy: input.resolvedBy,
        hcmTransactionId: input.hcmTransactionId,
        atRisk: input.atRisk,
      },
    });

    return this.toDomain(created);
  }

  async findById(id: string): Promise<TimeOffRequest | null> {
    const request = await this.prisma.timeOffRequest.findUnique({
      where: { id },
    });

    return request ? this.toDomain(request) : null;
  }

  async approvePending(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
    hcmTransactionId: string;
  }): Promise<TimeOffRequest | null> {
    const updated = await this.prisma.timeOffRequest.updateManyAndReturn({
      where: {
        id: input.requestId,
        status: RequestStatus.PENDING,
      },
      data: {
        status: RequestStatus.APPROVED,
        resolvedBy: input.resolvedBy,
        resolvedAt: input.resolvedAt,
        managerNotes: input.managerNotes,
        hcmTransactionId: input.hcmTransactionId,
      },
    });

    return updated[0] ? this.toDomain(updated[0]) : null;
  }

  async rejectPending(input: {
    requestId: string;
    resolvedBy: string;
    managerNotes: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null> {
    const updated = await this.prisma.timeOffRequest.updateManyAndReturn({
      where: {
        id: input.requestId,
        status: RequestStatus.PENDING,
      },
      data: {
        status: RequestStatus.REJECTED,
        resolvedBy: input.resolvedBy,
        resolvedAt: input.resolvedAt,
        managerNotes: input.managerNotes,
      },
    });

    return updated[0] ? this.toDomain(updated[0]) : null;
  }

  async cancelRequest(input: {
    requestId: string;
    resolvedBy: string;
    statusReason: string | null;
    resolvedAt: Date;
  }): Promise<TimeOffRequest | null> {
    const updated = await this.prisma.timeOffRequest.updateManyAndReturn({
      where: {
        id: input.requestId,
        status: {
          in: [RequestStatus.PENDING, RequestStatus.APPROVED],
        },
      },
      data: {
        status: RequestStatus.CANCELLED,
        resolvedBy: input.resolvedBy,
        resolvedAt: input.resolvedAt,
        statusReason: input.statusReason,
      },
    });

    return updated[0] ? this.toDomain(updated[0]) : null;
  }

  async list(filters: {
    employeeId?: string;
    status?: TimeOffRequestStatus;
  }): Promise<TimeOffRequest[]> {
    const requests = await this.prisma.timeOffRequest.findMany({
      where: {
        employeeId: filters.employeeId,
        status: filters.status,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return requests.map((request) => this.toDomain(request));
  }

  async findPendingByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<TimeOffRequest[]> {
    const requests = await this.prisma.timeOffRequest.findMany({
      where: {
        employeeId,
        locationId,
        leaveType,
        status: RequestStatus.PENDING,
      },
    });

    return requests.map((request) => this.toDomain(request));
  }

  async setAtRisk(requestId: string, atRisk: boolean): Promise<void> {
    await this.prisma.timeOffRequest.update({
      where: { id: requestId },
      data: { atRisk },
    });
  }

  private toDomain(request: PrismaTimeOffRequest): TimeOffRequest {
    return {
      id: request.id,
      employeeId: request.employeeId,
      locationId: request.locationId,
      leaveType: request.leaveType as LeaveType,
      startDate: request.startDate,
      endDate: request.endDate,
      durationDays: request.durationDays,
      status: request.status,
      statusReason: request.statusReason,
      notes: request.notes,
      managerNotes: request.managerNotes,
      resolvedAt: request.resolvedAt,
      resolvedBy: request.resolvedBy,
      hcmTransactionId: request.hcmTransactionId,
      atRisk: request.atRisk,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }
}
