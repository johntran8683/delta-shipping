import { IsString, MinLength } from 'class-validator';

export class ResetManagedUserPasswordDto {
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
