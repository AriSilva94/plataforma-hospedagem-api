import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { MAX_SHARED_BATHROOMS } from '../property-catalog';

export class SharedBathroomDto {
  @IsOptional()
  @IsUUID()
  id?: string;
}

export class ReplaceSharedBathroomsDto {
  @IsArray()
  @ArrayMaxSize(MAX_SHARED_BATHROOMS)
  @ValidateNested({ each: true })
  @Type(() => SharedBathroomDto)
  bathrooms!: SharedBathroomDto[];
}
