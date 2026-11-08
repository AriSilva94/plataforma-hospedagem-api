import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { PublicAvailabilityController } from './public-availability.controller';

@Module({
  imports: [AuthModule],
  controllers: [AvailabilityController, PublicAvailabilityController],
  providers: [AvailabilityService],
})
export class AvailabilityModule {}
