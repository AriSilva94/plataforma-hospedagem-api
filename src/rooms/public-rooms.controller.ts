import { Controller, Get, Query } from '@nestjs/common';
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
  listStories() {
    return this.roomStoryService.listPublic();
  }

  @Get('featured')
  listFeatured(@Query() query: ListPublicRoomsDto) {
    return this.publicRoomsService.listFeatured(query);
  }
}
