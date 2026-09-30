import { IsEnum } from 'class-validator';
import { PropertyStatus } from '../../generated/prisma/client';

export class UpdatePropertyStatusDto {
  @IsEnum(PropertyStatus)
  status!: PropertyStatus;
}
