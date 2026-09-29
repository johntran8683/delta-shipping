import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CHARGING_METHODS } from '../charging-method';

/** Inline creation of a customer when the sold-to code is not on file. */
export class NewCustomerDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  sold_to_code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  sold_to_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  default_contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  default_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  default_email?: string;
}

/** Inline creation of a ship-to location under the chosen customer. */
export class NewShipToDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  ship_to_code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  ship_to_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  street1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  street2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state_region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postal_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  country_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

export class ManualDeliveryNoteLineDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  material_code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  material_description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  so_number?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  order_qty!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unit_price?: number;
}

export class CreateDeliveryNoteDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  dn_number!: string;

  /** Existing customer id. Exactly one of customer_id / new_customer. */
  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewCustomerDto)
  new_customer?: NewCustomerDto;

  /** Existing ship-to location id. Exactly one of ship_to_location_id / new_ship_to. */
  @IsOptional()
  @IsString()
  ship_to_location_id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => NewShipToDto)
  new_ship_to?: NewShipToDto;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  customer_po?: string;

  @IsOptional()
  @IsDateString()
  po_date?: string;

  @IsOptional()
  @IsDateString()
  requested_delivery_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency_code?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  shipping_type!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @IsIn([...CHARGING_METHODS], {
    message: `charging_method must be one of: ${CHARGING_METHODS.join(', ')}`,
  })
  charging_method!: string;

  @IsOptional()
  @IsBoolean()
  is_rushed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rush_reason?: string;

  /**
   * Explicit priority override. Honored only when the caller also holds
   * dn.priority.set; otherwise the note takes today's import priority.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  priority_no?: number;

  @ValidateNested({ each: true })
  @Type(() => ManualDeliveryNoteLineDto)
  @ArrayMinSize(1)
  lines!: ManualDeliveryNoteLineDto[];
}

/** Same shape as create; dn_number may also be corrected while still NEW. */
export class UpdateDeliveryNoteDto extends CreateDeliveryNoteDto {}
