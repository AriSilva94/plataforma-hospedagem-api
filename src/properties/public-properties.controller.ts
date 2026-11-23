import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { PublicPropertyQueryDto } from './dto/public-property-query.dto';
import { PublicPropertiesService } from './public-properties.service';

@Controller('properties')
export class PublicPropertiesController {
  constructor(
    private readonly publicPropertiesService: PublicPropertiesService,
  ) {}

  @Get(':propertyId')
  get(
    @Param('propertyId', ParseUUIDPipe) propertyId: string,
    @Query() query: PublicPropertyQueryDto,
  ) {
    return this.publicPropertiesService.get(propertyId, query);
  }
}
