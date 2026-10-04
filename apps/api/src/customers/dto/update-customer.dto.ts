import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sold_to_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  fed_id_number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  default_contact_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  default_phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  default_email?: string | null;

  @IsOptional()
  @IsString()
  shipping_preference?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_box_content?: boolean;
}
