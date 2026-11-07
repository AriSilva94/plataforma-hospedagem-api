import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../common/transforms';
import { GenderIdentity, PropertyType } from '../../generated/prisma/client';
import { BRAZILIAN_STATES } from '../../properties/property-catalog';
import { MAX_PRICE_CENTS } from '../room-catalog';

const PROPERTY_TYPES = Object.values(PropertyType);

export class ListPublicRoomsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(48)
  limit: number = 12;

  @Trim()
  @ValidateIf((dto: ListPublicRoomsDto) => dto.state !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'Informe a cidade junto com a UF.' })
  @MaxLength(120)
  city?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @ValidateIf((dto: ListPublicRoomsDto) => dto.city !== undefined)
  @IsIn(BRAZILIAN_STATES, { message: 'UF inválida.' })
  state?: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').map((type) => type.trim())
      : value,
  )
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROPERTY_TYPES.length)
  @IsIn(PROPERTY_TYPES, { each: true })
  types?: PropertyType[];

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  minPriceCents?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_CENTS)
  maxPriceCents?: number;

  @IsOptional()
  @IsIn(Object.values(GenderIdentity))
  audience?: GenderIdentity;
}
