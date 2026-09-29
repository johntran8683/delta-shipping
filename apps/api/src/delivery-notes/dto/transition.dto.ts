import { dn_status } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One invoice number for one delivery note in the shipment (required at mark-shipped). */
export class ShipmentInvoiceDto {
  @IsUUID()
  deliveryNoteId!: string;

  @IsNotEmpty({ message: 'Each delivery note needs an invoice number' })
  @IsString()
  @MaxLength(80)
  invoiceNumber!: string;
}

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

  /**
   * Extra PACKED delivery-note ids the shipper chose to ship together with this
   * note (same customer / ship-to / ship method). Only for SHIPPING_IN_PROGRESS.
   */
  @ValidateIf(
    (o: TransitionDto) => o.toStatus === dn_status.SHIPPING_IN_PROGRESS,
  )
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  shipTogetherIds?: string[];

  /**
   * One invoice number per delivery note in the shipment. Only for SHIPPED;
   * every shipped note must have exactly one entry.
   */
  @ValidateIf((o: TransitionDto) => o.toStatus === dn_status.SHIPPED)
  @IsArray()
  @ArrayMinSize(1, {
    message: 'An invoice number is required for each delivery note',
  })
  @ValidateNested({ each: true })
  @Type(() => ShipmentInvoiceDto)
  invoiceNumbers?: ShipmentInvoiceDto[];

  /** Set to true to proceed despite the double-claim warning (shipper). */
  @IsOptional()
  @IsBoolean()
  confirmDoubleClaim?: boolean;
}
