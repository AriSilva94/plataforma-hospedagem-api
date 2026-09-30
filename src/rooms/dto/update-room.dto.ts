import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BathroomType,
  GenderIdentity,
  RoomStatus,
} from '../../generated/prisma/client';
import { Trim } from '../../common/transforms';
import { MAX_PRICE_CENTS, MAX_ROOM_CAPACITY } from '../room-catalog';
import { RoomFieldsDto } from './room-fields.dto';
import { OptionalNonNull } from '../../common/validation';

export class UpdateRoomDto extends RoomFieldsDto {
  @Trim()
  @OptionalNonNull()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title?: string;

  @OptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_PRICE_CENTS)
  priceCents?: number;

  @OptionalNonNull()
  @IsInt()
  @Min(1)
  @Max(MAX_ROOM_CAPACITY)
  capacity?: number;

  @OptionalNonNull()
  @IsEnum(BathroomType)
  bathroomType?: BathroomType;

  @OptionalNonNull()
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecione ao menos um público aceito.' })
  @ArrayUnique()
  @IsEnum(GenderIdentity, { each: true })
  acceptedAudiences?: GenderIdentity[];

  @OptionalNonNull()
  @IsEnum(RoomStatus)
  status?: RoomStatus;
}
