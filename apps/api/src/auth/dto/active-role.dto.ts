import { IsString, MinLength } from 'class-validator';

export class ActiveRoleDto {
  @IsString()
  @MinLength(2)
  roleCode!: string;
}
