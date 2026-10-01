import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaStorage } from './media-storage';
import { R2MediaStorage } from './r2-media-storage';

@Module({
  providers: [
    MediaService,
    { provide: MediaStorage, useClass: R2MediaStorage },
  ],
  exports: [MediaService],
})
export class MediaModule {}
