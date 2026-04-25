import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { type LeaveType } from '../../time-off/domain/time-off.types';

@Injectable()
export class BalanceDimensionLeaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async acquire(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    holderId: string;
    now: Date;
    ttlMs: number;
  }): Promise<boolean> {
    const expiresAt = new Date(input.now.getTime() + input.ttlMs);

    try {
      await this.prisma.balanceDimensionLease.create({
        data: {
          employeeId: input.employeeId,
          locationId: input.locationId,
          leaveType: input.leaveType,
          holderId: input.holderId,
          expiresAt,
        },
      });
      return true;
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
      ) {
        throw error;
      }

      const existing = await this.prisma.balanceDimensionLease.findUnique({
        where: {
          employeeId_locationId_leaveType: {
            employeeId: input.employeeId,
            locationId: input.locationId,
            leaveType: input.leaveType,
          },
        },
      });

      if (!existing) {
        return false;
      }

      if (existing.holderId === input.holderId) {
        await this.prisma.balanceDimensionLease.update({
          where: {
            employeeId_locationId_leaveType: {
              employeeId: input.employeeId,
              locationId: input.locationId,
              leaveType: input.leaveType,
            },
          },
          data: {
            expiresAt,
          },
        });
        return true;
      }

      if (existing.expiresAt.getTime() <= input.now.getTime()) {
        const updated = await this.prisma.balanceDimensionLease.updateMany({
          where: {
            employeeId: input.employeeId,
            locationId: input.locationId,
            leaveType: input.leaveType,
            expiresAt: {
              lte: input.now,
            },
          },
          data: {
            holderId: input.holderId,
            expiresAt,
          },
        });
        return updated.count > 0;
      }

      return false;
    }
  }

  async release(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    holderId: string;
  }): Promise<void> {
    await this.prisma.balanceDimensionLease.deleteMany({
      where: {
        employeeId: input.employeeId,
        locationId: input.locationId,
        leaveType: input.leaveType,
        holderId: input.holderId,
      },
    });
  }
}
