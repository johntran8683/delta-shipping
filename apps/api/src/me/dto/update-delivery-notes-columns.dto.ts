import { IsArray, IsString } from 'class-validator';

export class UpdateDeliveryNotesColumnsDto {
  @IsArray()
  @IsString({ each: true })
  visibleColumns!: string[];
}
