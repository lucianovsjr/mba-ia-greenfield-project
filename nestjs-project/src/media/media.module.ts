import { Module } from '@nestjs/common';
import { PROCESS_RUNNER } from './media.constants';
import { MediaProbeService } from './media-probe.service';
import { runProcess } from './process-runner';
import { ThumbnailService } from './thumbnail.service';

@Module({
  providers: [
    { provide: PROCESS_RUNNER, useValue: runProcess },
    MediaProbeService,
    ThumbnailService,
  ],
  exports: [MediaProbeService, ThumbnailService],
})
export class MediaModule {}
