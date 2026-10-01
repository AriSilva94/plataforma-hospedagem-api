import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { PublicPropertiesService } from './public-properties.service';

@Controller('properties')
export class PublicPropertiesController {
  constructor(
    private readonly publicPropertiesService: PublicPropertiesService,
  ) {}

  @Get(':propertyId')
  get(@Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.publicPropertiesService.get(propertyId);
  }
}
