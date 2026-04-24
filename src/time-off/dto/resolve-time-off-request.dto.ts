import { IsOptional, IsString } from 'class-validator';

export class ResolveTimeOffRequestDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
