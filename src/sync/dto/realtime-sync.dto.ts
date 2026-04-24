import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsObject,
  IsString,
} from 'class-validator';
import { LeaveType } from '../../time-off/domain/time-off.types';

class RealtimeBalanceDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsEnum(LeaveType)
  leaveType!: LeaveType;

  @IsNumber()
  availableDays!: number;

  @IsDateString()
  sourceUpdatedAt!: string;
}

export class RealtimeSyncDto {
  @IsObject()
  @Type(() => RealtimeBalanceDto)
  balance!: RealtimeBalanceDto;
}
