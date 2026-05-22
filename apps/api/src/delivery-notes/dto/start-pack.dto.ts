import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class StartPackDto {
  /** Other PICKED delivery notes to include in the same pack session (same combine cluster as anchor). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  peerDeliveryNoteIds?: string[];
}
