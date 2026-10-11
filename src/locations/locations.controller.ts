import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { citiesOfState } from './brazilian-cities';

@Controller('locations')
@UseGuards(JwtAuthGuard)
export class LocationsController {
  @Get('states/:state/cities')
  @Header('Cache-Control', 'private, max-age=86400')
  listCities(@Param('state') state: string) {
    const cities = citiesOfState(state.toUpperCase());
    if (!cities) {
      throw new NotFoundException('UF não encontrada.');
    }
    return cities;
  }
}
