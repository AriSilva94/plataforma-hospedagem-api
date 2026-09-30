import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TrimEach, TrimToNull } from '../../common/transforms';
import { BRAZILIAN_STATES, PROPERTY_FEATURES } from '../property-catalog';
import { OptionalNonNull } from '../../common/validation';

export class PropertyFieldsDto {
  @OptionalNonNull()
  @IsBoolean()
  featured?: boolean;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  houseRules?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  generalInfo?: string | null;

  @OptionalNonNull()
  @IsArray()
  @ArrayUnique()
  @IsIn(PROPERTY_FEATURES, { each: true })
  features?: string[];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') || null : value,
  )
  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'CEP deve conter 8 dígitos.' })
  postalCode?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  street?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  number?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  neighborhood?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  )
  @IsOptional()
  @IsIn(BRAZILIAN_STATES, { message: 'UF inválida.' })
  state?: string | null;

  @TrimEach()
  @OptionalNonNull()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(2, { each: true })
  @MaxLength(120, { each: true })
  referencePoints?: string[];
}
