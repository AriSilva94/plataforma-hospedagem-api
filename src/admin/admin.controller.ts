import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import { ListAdminPropertiesDto } from './dto/list-admin-properties.dto';
import { ListAdminUsersDto } from './dto/list-admin-users.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  overview() {
    return this.adminService.overview();
  }

  @Get('users')
  users(@Query() query: ListAdminUsersDto) {
    return this.adminService.users(query);
  }

  @Get('properties')
  properties(@Query() query: ListAdminPropertiesDto) {
    return this.adminService.properties(query);
  }
}
