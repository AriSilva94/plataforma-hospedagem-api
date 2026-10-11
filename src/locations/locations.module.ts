import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationsController } from './locations.controller';

@Module({
  imports: [AuthModule],
  controllers: [LocationsController],
})
export class LocationsModule {}
