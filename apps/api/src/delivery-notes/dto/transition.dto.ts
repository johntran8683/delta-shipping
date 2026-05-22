import { dn_status } from '@prisma/client';
import {
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
}
