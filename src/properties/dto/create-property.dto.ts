import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { PropertyType } from '../../generated/prisma/client';
import { Trim } from '../../common/transforms';
import { PropertyFieldsDto } from './property-fields.dto';

export class CreatePropertyDto extends PropertyFieldsDto {
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsEnum(PropertyType)
  type!: PropertyType;
}
