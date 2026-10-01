import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { TrimToNull } from '../../common/transforms';
import { ROOM_AMENITIES } from '../room-catalog';
import { OptionalNonNull } from '../../common/validation';

export class RoomFieldsDto {
  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string | null;

  @OptionalNonNull()
  @IsArray()
  @ArrayUnique()
  @IsIn(ROOM_AMENITIES, { each: true })
  amenities?: string[];

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalInfo?: string | null;
}
