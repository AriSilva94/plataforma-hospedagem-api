import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SharedAreaType } from '../../generated/prisma/client';
import { TrimToNull } from '../../common/transforms';
import { MAX_SHARED_AREAS } from '../property-catalog';

export class SharedAreaDto {
  @IsEnum(SharedAreaType)
  type!: SharedAreaType;

  @TrimToNull()
  @ValidateIf(
    (area: SharedAreaDto) =>
      area.type === SharedAreaType.OTHER || area.label != null,
  )
  @IsString({ message: 'Informe o nome da área.' })
  @MinLength(2)
  @MaxLength(60)
  label?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class ReplaceSharedAreasDto {
  @IsArray()
  @ArrayMaxSize(MAX_SHARED_AREAS)
  @ValidateNested({ each: true })
  @Type(() => SharedAreaDto)
  areas!: SharedAreaDto[];
}
