import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Lowercase identifier: letters, digits, dots, underscores (e.g. dn.read). */
export class CreatePermissionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(/^[a-z][a-z0-9_.]*$/, {
    message:
      'code must start with a letter and contain only lowercase letters, digits, dots, and underscores',
  })
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
