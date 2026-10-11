import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim, TrimToNull } from '../../common/transforms';
import { BRAZILIAN_STATES } from '../../properties/property-catalog';

function toBrazilianE164(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  const digits = value.replace(/\D/g, '');
  if (digits === '') {
    return null;
  }
  const national =
    digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  return `+55${national}`;
}

export class UpdateMeDto {
  @Trim()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @Transform(({ value }: { value: unknown }) => toBrazilianE164(value))
  @IsOptional()
  @Matches(/^\+55[1-9]{2}(9\d{8}|[2-5]\d{7})$/, {
    message: 'Informe um telefone brasileiro com DDD.',
  })
  phone?: string | null;

  @TrimToNull()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Data de nascimento deve estar no formato AAAA-MM-DD.',
  })
  @IsISO8601({ strict: true }, { message: 'Data de nascimento inválida.' })
  birthDate?: string | null;

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city?: string | null;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() || null : value,
  )
  @IsOptional()
  @IsIn(BRAZILIAN_STATES, { message: 'UF inválida.' })
  state?: string | null;
}
