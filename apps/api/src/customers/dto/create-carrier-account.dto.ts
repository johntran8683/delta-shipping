import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCarrierAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  carrier_code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  account_number!: string;

  @IsOptional()
  @IsBoolean()
  is_collect_enabled?: boolean;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
