import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { CarrierCode, CarrierEnvironment } from '../carrier-rate-provider';

/** Request a live rate quote for a delivery note (its shipment group). */
export class GetRateQuotesDto {
  @IsUUID()
  deliveryNoteId!: string;
}

/** Test carrier credentials — stored ones, or draft values from the form. */
export class TestCarrierConnectionDto {
  @IsIn(['FEDEX', 'UPS', 'DHL'])
  carrierCode!: CarrierCode;

  @IsIn(['SANDBOX', 'PRODUCTION'])
  environment!: CarrierEnvironment;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @IsOptional()
  @IsString()
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountNumber?: string;
}

class OriginAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stateOrProvinceCode?: string;

  @IsNotEmpty({ message: 'Origin postal code is required' })
  @IsString()
  @MaxLength(30)
  postalCode!: string;

  @IsNotEmpty({ message: 'Origin country code is required' })
  @IsString()
  @MaxLength(10)
  countryCode!: string;
}

class CarrierEnvCredentialsDto {
  @IsBoolean()
  isEnabled!: boolean;

  /**
   * Required only when the environment is enabled — disabled environments
   * may be left blank so supervisors only fill in what they actually use.
   */
  @ValidateIf((o) => o.isEnabled)
  @IsNotEmpty({ message: 'Client ID is required' })
  @IsString()
  @MaxLength(200)
  clientId!: string;

  /**
   * Client secret. Send a blank string to keep the currently stored secret;
   * anything non-blank replaces it.
   */
  @IsString()
  clientSecret!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  accountNumber?: string;
}

class CarrierSettingsDto {
  @IsIn(['SANDBOX', 'PRODUCTION'])
  activeEnvironment!: CarrierEnvironment;

  @ValidateNested()
  @Type(() => CarrierEnvCredentialsDto)
  sandbox!: CarrierEnvCredentialsDto;

  @ValidateNested()
  @Type(() => CarrierEnvCredentialsDto)
  production!: CarrierEnvCredentialsDto;
}

/** Save the warehouse origin address only. */
export class SaveOriginAddressDto {
  @ValidateNested()
  @Type(() => OriginAddressDto)
  origin!: OriginAddressDto;
}

/** Save one carrier's settings (active environment + both environments). */
export class SaveCarrierSettingsDto extends CarrierSettingsDto {}
