import { IsString, Length } from 'class-validator';
import { Trim } from '../common/transforms';

export class SearchCitiesDto {
  @Trim()
  @IsString()
  @Length(2, 60)
  q!: string;
}
