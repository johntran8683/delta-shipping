import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCarrierAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  account_number?: string;

  @IsOptional()
  @IsBoolean()
  is_collect_enabled?: boolean;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
