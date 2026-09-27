import { dn_status } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class TransitionDto {
  @IsEnum(dn_status)
  toStatus!: dn_status;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ValidateIf((o: TransitionDto) => o.toStatus === dn_status.SHIPPED)
  @IsNotEmpty({ message: 'trackingNumber is required when marking shipped' })
  @IsString()
  @MaxLength(80)
  trackingNumber?: string;

  /** Set to true to proceed despite the double-claim warning (shipper). */
  @IsOptional()
  @IsBoolean()
  confirmDoubleClaim?: boolean;
}
