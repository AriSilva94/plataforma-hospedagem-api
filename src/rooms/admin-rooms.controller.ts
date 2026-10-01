import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeatureRoomDto } from './dto/feature-room.dto';
import { ListAdminRoomsDto } from './dto/list-admin-rooms.dto';
import { RoomFeaturingService } from './room-featuring.service';

@Controller('admin/rooms')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminRoomsController {
  constructor(private readonly roomFeaturingService: RoomFeaturingService) {}

  @Get()
  list(@Query() query: ListAdminRoomsDto) {
    return this.roomFeaturingService.list(query);
  }

  @Put(':roomId/featured')
  feature(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: FeatureRoomDto,
  ) {
    return this.roomFeaturingService.feature(
      roomId,
      dto.featuredFrom,
      dto.featuredUntil,
    );
  }

  @Delete(':roomId/featured')
  unfeature(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomFeaturingService.unfeature(roomId);
  }
}
