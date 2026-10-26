import { ApiProperty } from '@nestjs/swagger';

export class PartUrlResponse {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description: 'Presigned UploadPart URL; send the part bytes with PUT',
    example: 'http://localhost:9000/streamtube-videos/videos/…/source?…',
  })
  url: string;
}

export class PartUrlsResponse {
  @ApiProperty({ type: [PartUrlResponse] })
  urls: PartUrlResponse[];

  @ApiProperty({ format: 'date-time' })
  expires_at: string;
}
