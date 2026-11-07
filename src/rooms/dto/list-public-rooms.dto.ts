import { Transform, Type } from 'class-transformer';
import {
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
import { BRAZILIAN_STATES } from '../../properties/property-catalog';

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
}
