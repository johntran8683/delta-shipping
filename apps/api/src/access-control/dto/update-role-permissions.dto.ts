import { IsArray, IsString } from 'class-validator';

export class UpdateRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}
