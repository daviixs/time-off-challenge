import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsString,
} from 'class-validator';
import { LeaveType } from '../../time-off/domain/time-off.types';

class RealtimeBalanceDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
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
