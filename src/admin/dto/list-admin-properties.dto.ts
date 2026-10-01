import { IsEnum, IsOptional } from 'class-validator';
import { PropertyStatus } from '../../generated/prisma/client';
import { SearchPageQueryDto } from '../../common/search-page-query.dto';

export class ListAdminPropertiesDto extends SearchPageQueryDto {
  @IsOptional()
  @IsEnum(PropertyStatus)
  status?: PropertyStatus;
}
