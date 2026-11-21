import { IsEnum, IsInt, Max, Min } from 'class-validator';
import { BedType } from '../../generated/prisma/client';
import { MAX_BED_QUANTITY } from '../room-catalog';

export class RoomBedDto {
  @IsEnum(BedType)
  type!: BedType;

  @IsInt()
  @Min(1)
  @Max(MAX_BED_QUANTITY)
  quantity!: number;
}
