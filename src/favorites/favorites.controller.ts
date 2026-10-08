import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../users/current-user.decorator';
import { FavoritesService } from './favorites.service';

type User = AuthenticatedRequest['user'];

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.favoritesService.list(user.id);
  }

  @Get('room-ids')
  roomIds(@CurrentUser() user: User) {
    return this.favoritesService.roomIds(user.id);
  }

  @Put(':roomId')
  @HttpCode(HttpStatus.NO_CONTENT)
  add(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.favoritesService.add(user.id, roomId);
  }

  @Delete(':roomId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.favoritesService.remove(user.id, roomId);
  }
}
