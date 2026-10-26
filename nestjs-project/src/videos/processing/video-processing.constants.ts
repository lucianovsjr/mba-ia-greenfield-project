import type { JobsOptions } from 'bullmq';

export const VIDEO_PROCESSING_QUEUE = 'video-processing' as const;

export const PROCESS_VIDEO_JOB = 'process-video' as const;

export const PROCESS_VIDEO_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: true,
  removeOnFail: 1000,
} as const satisfies JobsOptions;

export interface ProcessVideoJobData {
  videoId: string;
}
