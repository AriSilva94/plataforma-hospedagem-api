import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PublicPropertiesController } from './public-properties.controller';
import { PublicPropertiesService } from './public-properties.service';

@Module({
  imports: [AuthModule, MediaModule],
  controllers: [PropertiesController, PublicPropertiesController],
  providers: [PropertiesService, PublicPropertiesService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
