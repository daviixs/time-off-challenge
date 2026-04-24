import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { LeaveType } from '../domain/time-off.types';

export class CreateTimeOffRequestDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsEnum(LeaveType)
  leaveType!: LeaveType;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
