import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ListPublicPropertiesDto } from './dto/list-public-properties.dto';
import { PublicPropertiesService } from './public-properties.service';

@Controller('properties')
export class PublicPropertiesController {
  constructor(
    private readonly publicPropertiesService: PublicPropertiesService,
  ) {}

  @Get()
  list(@Query() query: ListPublicPropertiesDto) {
    return this.publicPropertiesService.list(query);
  }

  @Get(':propertyId')
  get(@Param('propertyId', ParseUUIDPipe) propertyId: string) {
    return this.publicPropertiesService.get(propertyId);
  }
}
