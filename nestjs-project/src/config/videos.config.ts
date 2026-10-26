import { registerAs } from '@nestjs/config';

export default registerAs('videos', () => ({
  maxSizeBytes: parseInt(process.env.VIDEO_MAX_SIZE_BYTES || '10737418240', 10),
  uploadPartSizeBytes: parseInt(
    process.env.UPLOAD_PART_SIZE_BYTES || '104857600',
    10,
  ),
  uploadPartUrlTtlSeconds: parseInt(
    process.env.UPLOAD_PART_URL_TTL_SECONDS || '3600',
    10,
  ),
  playbackUrlTtlSeconds: parseInt(
    process.env.PLAYBACK_URL_TTL_SECONDS || '900',
    10,
  ),
}));
