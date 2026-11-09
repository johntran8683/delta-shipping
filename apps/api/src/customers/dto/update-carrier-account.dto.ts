import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateCarrierAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  account_number?: string;

  /**
   * Move the account to a ship-to location, or null to make it
   * customer-wide again. Omit to leave the location unchanged.
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

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
