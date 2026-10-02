import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class CircleCountDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  partNumbers!: string[];
}
