export const VIDEO_STATUSES = [
  'draft',
  'processing',
  'ready',
  'failed',
] as const;

export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface VideoMetadata {
  formatName: string;
  bitRate: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export type PlaybackKind = 'stream' | 'download' | 'thumbnail';
