import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class StartPackDto {
  /** Other PICKED delivery notes to include in the same pack session (same combine cluster as anchor). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  peerDeliveryNoteIds?: string[];

  /** Set to true to proceed despite the double-claim warning. */
  @IsOptional()
  @IsBoolean()
  confirmDoubleClaim?: boolean;
}
