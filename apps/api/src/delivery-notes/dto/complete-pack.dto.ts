import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class PackBoxInputDto {
  @IsOptional()
  @IsString()
  boxNumber?: string;

  @IsNumber()
  @Min(0.0001)
  weightLb!: number;

  @IsNumber()
  @Min(0.0001)
  lengthIn!: number;

  @IsNumber()
  @Min(0.0001)
  widthIn!: number;

  @IsNumber()
  @Min(0.0001)
  heightIn!: number;
}

export class CompletePackDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PackBoxInputDto)
  boxes!: PackBoxInputDto[];

  /** Optional note about the shipment / cart (stored on the pack session). */
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  packCompletionNote?: string;
}
