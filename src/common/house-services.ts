import { IsBoolean, IsEnum, IsOptional, ValidateIf } from 'class-validator';
import { CleaningFrequency, SmokingPolicy } from '../generated/prisma/client';

export class HouseServicesFieldsDto {
  @IsOptional()
  @IsBoolean()
  hasCleaner?: boolean | null;

  @ValidateIf(
    (dto: HouseServicesFieldsDto) =>
      dto.hasCleaner === true || dto.cleaningFrequency != null,
  )
  @IsEnum(CleaningFrequency, {
    message: 'Informe a frequência da faxina.',
  })
  cleaningFrequency?: CleaningFrequency | null;

  @IsOptional()
  @IsEnum(SmokingPolicy)
  smokingPolicy?: SmokingPolicy | null;
}

export function withConsistentCleaning<T extends HouseServicesFieldsDto>(
  dto: T,
): T {
  if (dto.hasCleaner === undefined || dto.hasCleaner === true) {
    return dto;
  }
  return { ...dto, cleaningFrequency: null };
}

type HouseServices = {
  hasCleaner: boolean | null;
  cleaningFrequency: CleaningFrequency | null;
  smokingPolicy: SmokingPolicy | null;
};

export function resolveHouseServices(
  property: HouseServices,
  room: HouseServices,
): HouseServices {
  const cleaning = room.hasCleaner === null ? property : room;
  return {
    hasCleaner: cleaning.hasCleaner,
    cleaningFrequency: cleaning.cleaningFrequency,
    smokingPolicy: room.smokingPolicy ?? property.smokingPolicy,
  };
}
