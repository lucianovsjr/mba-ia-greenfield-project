import { ApiProperty } from '@nestjs/swagger';
import { VIDEO_STATUSES, type VideoStatus } from '../videos.types';

export class VideoMetadataResponse {
  @ApiProperty({ example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  formatName: string;

  @ApiProperty({ nullable: true, type: Number, example: 1200000 })
  bitRate: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 1920 })
  width: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 1080 })
  height: number | null;

  @ApiProperty({ nullable: true, type: Number, example: 30 })
  frameRate: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'h264' })
  videoCodec: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'aac' })
  audioCodec: string | null;
}

export class VideoResponse {
  @ApiProperty({ example: 'dQw4w9WgXcQ', minLength: 11, maxLength: 11 })
  public_id: string;

  @ApiProperty({ example: 'My first video' })
  title: string;

  @ApiProperty({ enum: VIDEO_STATUSES, example: 'draft' })
  status: VideoStatus;

  @ApiProperty({ example: 'clip.mp4' })
  original_filename: string;

  @ApiProperty({ example: 'video/mp4' })
  content_type: string;

  @ApiProperty({ example: 5242880 })
  size_bytes: number;

  @ApiProperty({ nullable: true, type: Number, example: 12.5 })
  duration_seconds: number | null;

  @ApiProperty({ nullable: true, type: VideoMetadataResponse })
  metadata: VideoMetadataResponse | null;

  @ApiProperty({ example: false })
  has_thumbnail: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  failure_reason: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}
