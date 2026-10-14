import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { Role } from '../generated/prisma/client';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { UploadedMediaFile } from '../media/media.service';
import { UploadMedia } from '../media/upload-media.decorator';
import { CurrentUser } from './current-user.decorator';
import { UpdateGuestProfileDto } from './dto/update-guest-profile.dto';
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

  @Post('me/avatar')
  @UploadMedia()
  uploadAvatar(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @UploadedFile() file: UploadedMediaFile | undefined,
  ) {
    return this.usersService.uploadAvatar(user.id, file);
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.OK)
  removeAvatar(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.usersService.removeAvatar(user.id);
  }

  @Post('me/profiles/guest')
  addGuestProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.usersService.addProfile(user.id, Role.GUEST);
  }

  @Patch('me/profiles/guest')
  updateGuestProfile(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: UpdateGuestProfileDto,
  ) {
    return this.usersService.updateGuestProfile(user.id, dto);
  }

  @Post('me/profiles/owner')
  addOwnerProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.usersService.addProfile(user.id, Role.OWNER);
  }
}
