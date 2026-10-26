import type { VideoResponse } from './dto/video-response.dto';
import type { Video } from './entities/video.entity';

export function toVideoResponse(video: Video): VideoResponse {
  return {
    public_id: video.public_id,
    title: video.title,
    status: video.status,
    original_filename: video.original_filename,
    content_type: video.content_type,
    size_bytes: video.size_bytes,
    duration_seconds: video.duration_seconds,
    metadata: video.metadata,
    has_thumbnail: video.thumbnail_key !== null,
    failure_reason: video.failure_reason,
    created_at: video.created_at.toISOString(),
    updated_at: video.updated_at.toISOString(),
  };
}
