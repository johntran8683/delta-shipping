import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  IsArray,
  ArrayNotEmpty,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  /** Role codes to assign, e.g. ["PICKER"]. Must exist in `roles`. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  roleCodes?: string[];
}
