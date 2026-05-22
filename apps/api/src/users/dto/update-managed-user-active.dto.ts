import { IsBoolean } from 'class-validator';

export class UpdateManagedUserActiveDto {
  @IsBoolean()
  isActive!: boolean;
}
