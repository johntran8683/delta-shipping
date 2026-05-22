import { dn_status } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class BulkTransitionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsEnum(dn_status)
  toStatus!: dn_status;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}
