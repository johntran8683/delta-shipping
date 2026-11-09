import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
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

  /**
   * The ship-to location this account belongs to. Omit (or null) for a
   * customer-wide account that applies to every location.
   */
  @IsOptional()
  @IsUUID()
  ship_to_location_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_collect_enabled?: boolean;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
