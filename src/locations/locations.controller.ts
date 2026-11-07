import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { citiesOfState, searchCities } from './brazilian-cities';
import { SearchCitiesDto } from './search-cities.dto';

@Controller('locations')
export class LocationsController {
  @Get('cities')
  @Header('Cache-Control', 'public, max-age=86400')
  searchCities(@Query() { q }: SearchCitiesDto) {
    return searchCities(q);
  }

  @Get('states/:state/cities')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, max-age=86400')
  listCities(@Param('state') state: string) {
    const cities = citiesOfState(state.toUpperCase());
    if (!cities) {
      throw new NotFoundException('UF não encontrada.');
    }
    return cities;
  }
}
