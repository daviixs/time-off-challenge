import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { LeaveType } from '../../time-off/domain/time-off.types';

class BatchBalanceDto {
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

export class BatchSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceDto)
  balances!: BatchBalanceDto[];
}
