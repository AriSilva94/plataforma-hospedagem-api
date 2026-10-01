import { IsEnum, IsOptional } from 'class-validator';
import { Role, UserStatus } from '../../generated/prisma/client';
import { SearchPageQueryDto } from '../../common/search-page-query.dto';

export class ListAdminUsersDto extends SearchPageQueryDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
