import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { ListPublicRoomsDto } from './dto/list-public-rooms.dto';
import { PublicRoomsService } from './public-rooms.service';
import { RoomStoryService } from './room-story.service';

@Controller('rooms')
export class PublicRoomsController {
  constructor(
    private readonly publicRoomsService: PublicRoomsService,
    private readonly roomStoryService: RoomStoryService,
  ) {}

  @Get()
  list(@Query() query: ListPublicRoomsDto) {
    return this.publicRoomsService.list(query);
  }

  @Get('stories')
  @UseGuards(OptionalJwtAuthGuard)
  listStories(@Req() request: Partial<AuthenticatedRequest>) {
    return this.roomStoryService.listPublic(request.user?.id);
  }

  @Post(':roomId/story/views')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  recordStoryView(
    @Req() request: AuthenticatedRequest,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.roomStoryService.recordView(request.user.id, roomId);
  }

  @Get('featured')
  listFeatured(@Query() query: ListPublicRoomsDto) {
    return this.publicRoomsService.listFeatured(query);
  }
}
