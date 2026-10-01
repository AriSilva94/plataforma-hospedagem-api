import { Type } from 'class-transformer';
import { IsDate } from 'class-validator';

export class FeatureRoomDto {
  @Type(() => Date)
  @IsDate()
  featuredFrom!: Date;

  @Type(() => Date)
  @IsDate()
  featuredUntil!: Date;
}
