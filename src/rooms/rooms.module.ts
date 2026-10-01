import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaModule } from '../media/media.module';
import { PropertiesModule } from '../properties/properties.module';
import { RankingModule } from '../ranking/ranking.module';
import { AdminRoomsController } from './admin-rooms.controller';
import { PublicRoomsController } from './public-rooms.controller';
import { PublicRoomsService } from './public-rooms.service';
import { RoomFeaturingService } from './room-featuring.service';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [AuthModule, MediaModule, PropertiesModule, RankingModule],
  controllers: [RoomsController, PublicRoomsController, AdminRoomsController],
  providers: [RoomsService, PublicRoomsService, RoomFeaturingService],
})
export class RoomsModule {}
