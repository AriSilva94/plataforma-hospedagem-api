import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../common/transforms';

export class UpdateMeDto {
  @Trim()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;
}
