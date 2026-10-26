import { Inject, Injectable } from '@nestjs/common';
import {
  FFMPEG_TIMEOUT_MS,
  PROCESS_RUNNER,
  THUMBNAIL_MAX_WIDTH,
  THUMBNAIL_OFFSET_RATIO,
} from './media.constants';
import type { ProcessRunner } from './process-runner';

@Injectable()
export class ThumbnailService {
  constructor(@Inject(PROCESS_RUNNER) private readonly runner: ProcessRunner) {}

  computeOffset(durationSeconds: number | null): number {
    if (durationSeconds === null || durationSeconds < 1) return 0;
    return durationSeconds * THUMBNAIL_OFFSET_RATIO;
  }

  // Writes a single JPEG frame to outputPath (expected to end in .jpg), capped
  // at THUMBNAIL_MAX_WIDTH with the aspect ratio preserved (even height).
  async extractFrame(
    input: string,
    offsetSeconds: number,
    outputPath: string,
  ): Promise<void> {
    await this.runner(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        String(offsetSeconds),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(${THUMBNAIL_MAX_WIDTH},iw)':-2`,
        '-q:v',
        '2',
        outputPath,
      ],
      { timeoutMs: FFMPEG_TIMEOUT_MS },
    );
  }
}
