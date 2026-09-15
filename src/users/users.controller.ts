import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { UpdateMeDto } from './dto/update-me.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: UpdateMeDto,
  ) {
    return this.usersService.updateMe(user.id, dto);
  }

  @Post('me/profiles/guest')
  addGuestProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.usersService.addProfile(user.id, Role.GUEST);
  }

  @Post('me/profiles/owner')
  addOwnerProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.usersService.addProfile(user.id, Role.OWNER);
  }
}
