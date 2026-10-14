import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { RankingModule } from '../ranking/ranking.module';
import { PostalCodeService } from './postal-code.service';
import { PostalCodesController } from './postal-codes.controller';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PublicOwnersController } from './public-owners.controller';
import { PublicOwnersService } from './public-owners.service';
import { PublicPropertiesController } from './public-properties.controller';
import { PublicPropertiesService } from './public-properties.service';

@Module({
  imports: [AuthModule, MediaModule, RankingModule],
  controllers: [
    PropertiesController,
    PostalCodesController,
    PublicPropertiesController,
    PublicOwnersController,
  ],
  providers: [
    PropertiesService,
    PublicPropertiesService,
    PublicOwnersService,
    PostalCodeService,
  ],
  exports: [PropertiesService],
})
export class PropertiesModule {}
