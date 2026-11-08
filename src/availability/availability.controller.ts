import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../users/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';

type User = AuthenticatedRequest['user'];

@Controller('owner')
@UseGuards(JwtAuthGuard)
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('rooms/:roomId/availability')
  get(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
  ) {
    return this.availabilityService.ownerGet(user.id, roomId);
  }

  @Put('rooms/:roomId/availability')
  replace(
    @CurrentUser() user: User,
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() dto: UpdateAvailabilityDto,
  ) {
    return this.availabilityService.ownerReplace(user.id, roomId, dto);
  }
}
