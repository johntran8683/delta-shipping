import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class SetPriorityDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toPriorityNo!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
