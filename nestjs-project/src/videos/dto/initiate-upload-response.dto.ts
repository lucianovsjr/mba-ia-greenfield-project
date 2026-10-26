import { ApiProperty } from '@nestjs/swagger';
import { VideoResponse } from './video-response.dto';

export class UploadPlanResponse {
  @ApiProperty({ example: 104857600 })
  part_size_bytes: number;

  @ApiProperty({ example: 1 })
  part_count: number;

  @ApiProperty({ example: 100 })
  max_part_urls_per_request: number;
}

export class InitiateUploadResponse {
  @ApiProperty({ type: VideoResponse })
  video: VideoResponse;

  @ApiProperty({ type: UploadPlanResponse })
  upload: UploadPlanResponse;
}
