import { IsEnum, IsString } from 'class-validator';
import { LeaveType } from '../../time-off/domain/time-off.types';

export class GetBalanceQueryDto {
  @IsString()
  employeeId!: string;

  @IsString()
  locationId!: string;

  @IsEnum(LeaveType)
  leaveType!: LeaveType;
}
