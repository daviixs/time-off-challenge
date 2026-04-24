import { IsOptional, IsString } from 'class-validator';

export class CancelTimeOffRequestDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
