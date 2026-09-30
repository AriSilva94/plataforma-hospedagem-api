import {
  BadRequestException,
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PostalCodeService } from './postal-code.service';

@Controller('owner/postal-codes')
@UseGuards(JwtAuthGuard)
export class PostalCodesController {
  constructor(private readonly postalCodeService: PostalCodeService) {}

  @Get(':postalCode')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  lookup(@Param('postalCode') postalCode: string) {
    const digits = postalCode.replace('-', '');
    if (!/^\d{8}$/.test(digits)) {
      throw new BadRequestException('Informe um CEP com 8 dígitos.');
    }
    return this.postalCodeService.lookup(digits);
  }
}
