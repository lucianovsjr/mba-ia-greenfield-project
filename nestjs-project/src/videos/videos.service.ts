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
import type { PartUrlsResponse } from './dto/part-urls-response.dto';
import type { RequestPartUrlsDto } from './dto/request-part-urls.dto';
import type { UploadedPartsResponse } from './dto/uploaded-parts-response.dto';
import { Video } from './entities/video.entity';
import {
  InvalidUploadPartsException,
  InvalidUploadStateException,
  UnsupportedVideoFormatException,
  VideoNotFoundException,
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
        part_count: this.partCount(dto.size),
        max_part_urls_per_request: MAX_PART_URLS_PER_REQUEST,
      },
    };
  }

  async requestPartUrls(
    userId: string,
    publicId: string,
    dto: RequestPartUrlsDto,
  ): Promise<PartUrlsResponse> {
    const video = this.assertDraft(await this.findOwnedVideo(userId, publicId));
    const partCount = this.partCount(video.size_bytes);
    if (dto.part_numbers.some((partNumber) => partNumber > partCount)) {
      throw new InvalidUploadPartsException();
    }

    const ttl = this.config.uploadPartUrlTtlSeconds;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    const urls = await Promise.all(
      dto.part_numbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storageService.presignUploadPart(
          video.source_key,
          video.upload_id!,
          partNumber,
          ttl,
        ),
      })),
    );
    return { urls, expires_at: expiresAt.toISOString() };
  }

  async listUploadedParts(
    userId: string,
    publicId: string,
  ): Promise<UploadedPartsResponse> {
    const video = this.assertDraft(await this.findOwnedVideo(userId, publicId));
    const parts = await this.storageService.listParts(
      video.source_key,
      video.upload_id!,
    );
    return {
      parts: parts.map((part) => ({
        part_number: part.partNumber,
        etag: part.etag,
        size_bytes: part.sizeBytes,
      })),
    };
  }

  async abortUpload(userId: string, publicId: string): Promise<void> {
    const video = this.assertDraft(await this.findOwnedVideo(userId, publicId));
    await this.storageService.abortMultipartUpload(
      video.source_key,
      video.upload_id!,
    );
    await this.dataSource.getRepository(Video).delete({ id: video.id });
  }

  // A video that does not exist or belongs to another user's channel is
  // reported the same way, so its existence is not revealed.
  async findOwnedVideo(userId: string, publicId: string): Promise<Video> {
    const video = await this.dataSource.getRepository(Video).findOne({
      where: { public_id: publicId },
      relations: ['channel'],
    });
    if (!video || video.channel.user_id !== userId) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  assertDraft(video: Video): Video {
    if (video.status !== 'draft' || !video.upload_id) {
      throw new InvalidUploadStateException();
    }
    return video;
  }

  private partCount(sizeBytes: number): number {
    return Math.ceil(sizeBytes / this.config.uploadPartSizeBytes);
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
