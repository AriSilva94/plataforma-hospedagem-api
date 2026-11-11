import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AvailabilityService } from './availability.service';

@Controller('rooms')
export class PublicAvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get(':roomId/availability')
  get(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.availabilityService.publicGet(roomId);
  }
}
