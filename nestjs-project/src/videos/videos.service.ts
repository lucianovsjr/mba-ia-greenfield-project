import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { isPgUniqueViolationOnColumn } from '../common/database/pg-errors';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import type { InitiateUploadResponse } from './dto/initiate-upload-response.dto';
import type { InitiateUploadDto } from './dto/initiate-upload.dto';
import { Video } from './entities/video.entity';
import {
  UnsupportedVideoFormatException,
  VideoTooLargeException,
} from './exceptions/video.exceptions';
import { generatePublicId } from './public-id.util';
import { toVideoResponse } from './video.mapper';
import {
  ALLOWED_VIDEO_FORMATS,
  MAX_PART_URLS_PER_REQUEST,
  MAX_PUBLIC_ID_ATTEMPTS,
  VIDEO_STORAGE_KEYS,
} from './videos.constants';

const PUBLIC_ID_COLUMN = 'public_id';

interface DraftFields {
  id: string;
  channelId: string;
  dto: InitiateUploadDto;
  sourceKey: string;
  uploadId: string;
}

@Injectable()
export class VideosService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly channelsService: ChannelsService,
    @Inject(videosConfig.KEY)
    private readonly config: ConfigType<typeof videosConfig>,
  ) {}

  async initiateUpload(
    userId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponse> {
    this.assertSupportedFormat(dto.filename, dto.contentType);
    if (dto.size > this.config.maxSizeBytes) {
      throw new VideoTooLargeException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new Error(`User ${userId} has no channel`);
    }

    const id = randomUUID();
    const sourceKey = VIDEO_STORAGE_KEYS.source(id);
    const uploadId = await this.storageService.createMultipartUpload(
      sourceKey,
      dto.contentType,
    );

    let video: Video;
    try {
      video = await this.insertDraft({
        id,
        channelId: channel.id,
        dto,
        sourceKey,
        uploadId,
      });
    } catch (err) {
      // Compensation: no draft row was stored, so the multipart upload is orphaned.
      await this.storageService.abortMultipartUpload(sourceKey, uploadId);
      throw err;
    }

    return {
      video: toVideoResponse(video),
      upload: {
        part_size_bytes: this.config.uploadPartSizeBytes,
        part_count: Math.ceil(dto.size / this.config.uploadPartSizeBytes),
        max_part_urls_per_request: MAX_PART_URLS_PER_REQUEST,
      },
    };
  }

  private assertSupportedFormat(filename: string, contentType: string): void {
    const extension = extname(filename).toLowerCase();
    const expected =
      ALLOWED_VIDEO_FORMATS[extension as keyof typeof ALLOWED_VIDEO_FORMATS];
    if (!expected || expected !== contentType) {
      throw new UnsupportedVideoFormatException();
    }
  }

  private async insertDraft(fields: DraftFields): Promise<Video> {
    return this.dataSource.transaction(async (manager) => {
      for (let attempt = 0; attempt < MAX_PUBLIC_ID_ATTEMPTS; attempt++) {
        const savepoint = `public_id_attempt_${attempt}`;
        await manager.query(`SAVEPOINT ${savepoint}`);
        try {
          const saved = await manager.save(
            manager.create(Video, {
              id: fields.id,
              public_id: generatePublicId(),
              channel_id: fields.channelId,
              title: fields.dto.title,
              status: 'draft',
              original_filename: fields.dto.filename,
              content_type: fields.dto.contentType,
              size_bytes: fields.dto.size,
              upload_id: fields.uploadId,
              source_key: fields.sourceKey,
            }),
          );
          await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
          return saved;
        } catch (err) {
          await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          if (!isPgUniqueViolationOnColumn(err, PUBLIC_ID_COLUMN)) {
            throw err;
          }
        }
      }
      throw new Error(
        `public_id collision could not be resolved after ${MAX_PUBLIC_ID_ATTEMPTS} attempts`,
      );
    });
  }
}
