import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TrimToNull } from '../../common/transforms';
import { ROOM_AMENITIES } from '../room-catalog';
import { RoomBedDto } from './room-bed.dto';
import { OptionalNonNull } from '../../common/validation';
import { HouseServicesFieldsDto } from '../../common/house-services';

export class RoomFieldsDto extends HouseServicesFieldsDto {
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

  @OptionalNonNull()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique((bed: RoomBedDto) => bed.type)
  @ValidateNested({ each: true })
  @Type(() => RoomBedDto)
  beds?: RoomBedDto[];

  @TrimToNull()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalInfo?: string | null;
}
