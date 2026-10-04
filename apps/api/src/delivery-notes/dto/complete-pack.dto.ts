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

export class PackBoxItemInputDto {
  /** Part number as packed. Must match a line on the packed delivery notes. */
  @IsString()
  @MaxLength(80)
  materialCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  materialDescription?: string;

  @IsNumber()
  @Min(0.0001)
  quantity!: number;
}

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

  /**
   * Per-box contents. Required when any packed note's customer requires box
   * contents; otherwise optional — but when any contents are entered they
   * must balance against the delivery-note lines.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PackBoxItemInputDto)
  contents?: PackBoxItemInputDto[];
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
