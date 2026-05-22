import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class SetRushDto {
  @IsBoolean()
  rushed!: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
