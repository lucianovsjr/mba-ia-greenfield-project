import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  VIDEO_FAILURE_REASONS,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
  type VideoFailureReason,
} from './video-processing.constants';
import { VideoProcessingService } from './video-processing.service';

// Registered only by WorkerModule: the API process never consumes the queue.
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(private readonly processingService: VideoProcessingService) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    await this.processingService.process(job.data.videoId);
  }

  // Fires after every failed attempt; attemptsMade already counts this one.
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ProcessVideoJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error(`Job failed without job data: ${error.message}`);
      return;
    }

    const reason = this.finalFailureReason(job, error);
    if (!reason) {
      this.logger.warn(
        `Video ${job.data.videoId} attempt ${job.attemptsMade} failed, retrying: ${error.message}`,
      );
      return;
    }

    this.logger.error(
      `Video ${job.data.videoId} failed (${reason}) after ${job.attemptsMade} attempt(s): ${error.message}`,
      error.stack,
    );
    // Background handler: rethrowing would only reach the worker's emitter.
    try {
      await this.processingService.markFailed(job.data.videoId, reason);
    } catch (markError) {
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        markError instanceof Error ? markError.stack : String(markError),
      );
    }
  }

  private finalFailureReason(
    job: Job<ProcessVideoJobData>,
    error: Error,
  ): VideoFailureReason | null {
    if (
      error instanceof UnrecoverableError ||
      error.name === 'UnrecoverableError'
    ) {
      return VIDEO_FAILURE_REASONS.invalidMedia;
    }
    if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
      return VIDEO_FAILURE_REASONS.processingFailed;
    }
    return null;
  }
}
