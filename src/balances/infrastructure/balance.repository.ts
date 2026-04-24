import { Injectable } from '@nestjs/common';
import { type LeaveType as PrismaLeaveType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type BalanceProjection,
  type LeaveType,
} from '../../time-off/domain/time-off.types';

@Injectable()
export class BalanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByDimension(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<BalanceProjection | null> {
    const balance = await this.prisma.balance.findUnique({
      where: {
        employeeId_locationId_leaveType: {
          employeeId,
          locationId,
          leaveType,
        },
      },
    });

    return balance ? this.toDomain(balance) : null;
  }

  async upsert(balance: BalanceProjection): Promise<BalanceProjection> {
    const upserted = await this.prisma.balance.upsert({
      where: {
        employeeId_locationId_leaveType: {
          employeeId: balance.employeeId,
          locationId: balance.locationId,
          leaveType: balance.leaveType,
        },
      },
      create: {
        employeeId: balance.employeeId,
        locationId: balance.locationId,
        leaveType: balance.leaveType,
        availableDays: balance.availableDays,
        lastSyncedAt: balance.lastSyncedAt,
        sourceUpdatedAt: balance.sourceUpdatedAt,
        version: balance.version,
        createdAt: balance.createdAt,
      },
      update: {
        availableDays: balance.availableDays,
        lastSyncedAt: balance.lastSyncedAt,
        sourceUpdatedAt: balance.sourceUpdatedAt,
        version: balance.version,
      },
    });

    return this.toDomain(upserted);
  }

  private toDomain(balance: {
    employeeId: string;
    locationId: string;
    leaveType: PrismaLeaveType;
    availableDays: number;
    lastSyncedAt: Date;
    sourceUpdatedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): BalanceProjection {
    return {
      employeeId: balance.employeeId,
      locationId: balance.locationId,
      leaveType: balance.leaveType as LeaveType,
      availableDays: balance.availableDays,
      lastSyncedAt: balance.lastSyncedAt,
      sourceUpdatedAt: balance.sourceUpdatedAt,
      version: balance.version,
      createdAt: balance.createdAt,
      updatedAt: balance.updatedAt,
    };
  }
}
