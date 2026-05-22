import { IsArray, IsString } from 'class-validator';

export class UpdateDnCombinationRulesDto {
  /** `sold_to_code` values for customers that must not participate in combine-with hints. */
  @IsArray()
  @IsString({ each: true })
  disallowingSoldToCodes!: string[];
}
