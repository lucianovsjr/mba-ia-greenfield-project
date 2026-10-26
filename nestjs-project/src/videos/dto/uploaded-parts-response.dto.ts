import { ApiProperty } from '@nestjs/swagger';

export class UploadedPartResponse {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({ example: '"5d41402abc4b2a76b9719d911017c592"' })
  etag: string;

  @ApiProperty({ example: 104857600 })
  size_bytes: number;
}

export class UploadedPartsResponse {
  @ApiProperty({ type: [UploadedPartResponse] })
  parts: UploadedPartResponse[];
}
