import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

function digitsOnly({ value }: { value: unknown }): string {
  return String(value ?? '').replace(/\D/g, '');
}

export class SuggestDeliveryNotesQueryDto {
  @Transform(digitsOnly)
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  /** Last digits of the delivery note number (non-digits stripped). */
  q!: string;
}
