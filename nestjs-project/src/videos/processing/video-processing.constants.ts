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

export const VIDEO_FAILURE_REASONS = {
  invalidMedia: 'INVALID_MEDIA',
  processingFailed: 'PROCESSING_FAILED',
} as const;

export type VideoFailureReason =
  (typeof VIDEO_FAILURE_REASONS)[keyof typeof VIDEO_FAILURE_REASONS];

// Long enough for ffprobe + ffmpeg (FFPROBE_TIMEOUT_MS + FFMPEG_TIMEOUT_MS).
export const SOURCE_URL_TTL_SECONDS = 900;

export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg' as const;
