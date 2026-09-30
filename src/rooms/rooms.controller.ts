import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReorderMediaDto } from '../media/dto/reorder-media.dto';
import type { UploadedMediaFile } from '../media/media.service';
import { UploadMedia } from '../media/upload-media.decorator';
import { CurrentUser } from '../users/current-user.decorator';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomsService } from './rooms.service';

type User = AuthenticatedRequest['user'];

@Controller('owner')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post('properties/:propertyId/rooms')
  create(
    @CurrentUser() user: User,
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Body() dto: CreateRoomDto,
  ) {
    return this.roomsService.create(user.id, propertyId, dto);
  }

  @Get('rooms/:roomId')
  get(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.roomsService.get(user.id, roomId);
  }

  @Patch('rooms/:roomId')
  update(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomsService.update(user.id, roomId, dto);
  }

  @Delete('rooms/:roomId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.roomsService.remove(user.id, roomId);
  }

  @Post('rooms/:roomId/media')
  @UploadMedia()
  addMedia(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @UploadedFile() file: UploadedMediaFile | undefined,
  ) {
    return this.roomsService.addMedia(user.id, roomId, file);
  }

  @Put('rooms/:roomId/media/order')
  reorderMedia(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: ReorderMediaDto,
  ) {
    return this.roomsService.reorderMedia(user.id, roomId, dto);
  }

  @Delete('rooms/:roomId/media/:mediaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMedia(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.roomsService.removeMedia(user.id, roomId, mediaId);
  }
}
