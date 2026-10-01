import { Module } from '@nestjs/common';
import { RoomRankingService } from './room-ranking.service';

@Module({
  providers: [RoomRankingService],
  exports: [RoomRankingService],
})
export class RankingModule {}
