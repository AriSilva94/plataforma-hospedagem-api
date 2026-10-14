import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { PublicOwnersService } from './public-owners.service';

@Controller('owners')
export class PublicOwnersController {
  constructor(private readonly publicOwnersService: PublicOwnersService) {}

  @Get(':ownerProfileId')
  get(@Param('ownerProfileId', ParseUUIDPipe) ownerProfileId: string) {
    return this.publicOwnersService.get(ownerProfileId);
  }
}
