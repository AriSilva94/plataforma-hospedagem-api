import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { SearchPageQueryDto } from '../../common/search-page-query.dto';
import { FEATURING_STATUSES, type FeaturingStatus } from '../room-featuring';

export const ADMIN_ROOM_SORTS = ['name', 'completeness'] as const;

export type AdminRoomSort = (typeof ADMIN_ROOM_SORTS)[number];

export class ListAdminRoomsDto extends SearchPageQueryDto {
  @IsOptional()
  @IsIn(FEATURING_STATUSES)
  featuring?: FeaturingStatus;

  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  listed?: boolean;

  @IsOptional()
  @IsIn(ADMIN_ROOM_SORTS)
  sort: AdminRoomSort = 'name';
}
