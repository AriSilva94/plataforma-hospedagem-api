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
import { RejectRoomStoryDto } from './dto/reject-room-story.dto';
import { RejectRoomVerificationDto } from './dto/reject-room-verification.dto';
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

  @Put(':roomId/verified')
  verify(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomFeaturingService.verify(roomId);
  }

  @Delete(':roomId/verified')
  unverify(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomFeaturingService.unverify(roomId);
  }

  @Put(':roomId/rejected')
  reject(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: RejectRoomVerificationDto,
  ) {
    return this.roomFeaturingService.reject(roomId, dto.reason);
  }

  @Put(':roomId/story/approved')
  approveStory(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomFeaturingService.approveStory(roomId);
  }

  @Put(':roomId/story/rejected')
  rejectStory(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: RejectRoomStoryDto,
  ) {
    return this.roomFeaturingService.rejectStory(roomId, dto.reason);
  }

  @Delete(':roomId/story/review')
  unreviewStory(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomFeaturingService.unreviewStory(roomId);
  }

  @Delete(':roomId/rejected')
  unreject(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomFeaturingService.unreject(roomId);
  }
}
