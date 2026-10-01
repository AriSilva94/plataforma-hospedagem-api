import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { PropertyType } from '../../generated/prisma/client';
import { Trim } from '../../common/transforms';
import { PropertyFieldsDto } from './property-fields.dto';
import { OptionalNonNull } from '../../common/validation';

export class UpdatePropertyDto extends PropertyFieldsDto {
  @Trim()
  @OptionalNonNull()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @OptionalNonNull()
  @IsEnum(PropertyType)
  type?: PropertyType;
}
