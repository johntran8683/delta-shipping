import { dn_status } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DELIVERY_NOTE_LIST_SORT_FIELDS,
  type DeliveryNoteListSortDir,
} from '../delivery-notes-list-sort';

function trimToUndefined({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === '' ? undefined : s;
}

export class ListDeliveryNotesQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  /** Omit to default to open DNs only (`is_open: true`). Pass false for all. */
  is_open?: boolean;

  @IsOptional()
  @IsEnum(dn_status)
  status?: dn_status;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  /**
   * When true, return only DNs in PICKING that the current user started.
   * Ignores `status` (queue is always PICKING for that user).
   */
  myPicking?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  /**
   * When true, return only DNs in PACKING that the current user started.
   * Ignores `status`.
   */
  myPacking?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  /**
   * When true, return only DNs in SHIPPING_IN_PROGRESS that the current user
   * started. Ignores `status`.
   */
  myShipping?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    return value === true || value === 'true';
  })
  @IsBoolean()
  /** When true, return only rushed DNs. Combines with other filters. */
  isRushed?: boolean;

  /** Partial match on delivery note number (case-insensitive). */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(80)
  dnNumber?: string;

  /** Partial match on customer name or sold-to code (case-insensitive). */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(120)
  customer?: string;

  /** Partial match on ship-to code or ship-to address fields (case-insensitive). */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString()
  @MaxLength(120)
  shipTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  /** priority | customer | dn_number | status | shipping_type */
  @IsOptional()
  @Transform(trimToUndefined)
  @IsIn([...DELIVERY_NOTE_LIST_SORT_FIELDS])
  sortBy?: (typeof DELIVERY_NOTE_LIST_SORT_FIELDS)[number];

  @IsOptional()
  @Transform(({ value }) => {
    const s = String(value ?? '')
      .trim()
      .toLowerCase();
    return s === 'desc' ? 'desc' : s === 'asc' ? 'asc' : undefined;
  })
  @IsIn(['asc', 'desc'])
  sortDir?: DeliveryNoteListSortDir;
}
