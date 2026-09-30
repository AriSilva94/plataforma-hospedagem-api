import { IsEnum } from 'class-validator';
import { GenderIdentity } from '../../generated/prisma/client';

export class UpdateGuestProfileDto {
  @IsEnum(GenderIdentity)
  genderIdentity!: GenderIdentity;
}
