import { Controller, Get, Query } from '@nestjs/common';
import { ListPublicRoomsDto } from './dto/list-public-rooms.dto';
import { PublicRoomsService } from './public-rooms.service';

@Controller('rooms')
export class PublicRoomsController {
  constructor(private readonly publicRoomsService: PublicRoomsService) {}

  @Get()
  list(@Query() query: ListPublicRoomsDto) {
    return this.publicRoomsService.list(query);
  }
}
