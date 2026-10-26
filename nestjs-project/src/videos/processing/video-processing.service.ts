import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import type { Repository } from 'typeorm';
import { InvalidMediaError } from '../../media/media.errors';
import {
  MediaProbeService,
  type ProbeResult,
} from '../../media/media-probe.service';
import { ThumbnailService } from '../../media/thumbnail.service';
import { StorageService } from '../../storage/storage.service';
import { Video } from '../entities/video.entity';
import { VIDEO_STORAGE_KEYS } from '../videos.constants';
import {
  SOURCE_URL_TTL_SECONDS,
  THUMBNAIL_CONTENT_TYPE,
  VIDEO_FAILURE_REASONS,
  type VideoFailureReason,
} from './video-processing.constants';

@Injectable()
export class VideoProcessingService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    private readonly mediaProbeService: MediaProbeService,
    private readonly thumbnailService: ThumbnailService,
  ) {}

  // At-least-once delivery: every step is idempotent and the final transition
  // only applies while the video is still 'processing'.
  async process(videoId: string): Promise<void> {
    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video || video.status !== 'processing') return;

    // ffprobe/ffmpeg read the source through HTTP Range requests (TD-09).
    const sourceUrl = await this.storageService.presignGetObject(
      video.source_key,
      { expiresIn: SOURCE_URL_TTL_SECONDS, endpoint: 'internal' },
    );

    const probe = await this.probe(sourceUrl);
    const thumbnailKey = VIDEO_STORAGE_KEYS.thumbnail(video.id);
    await this.uploadThumbnail(sourceUrl, probe.durationSeconds, thumbnailKey);

    await this.videoRepository.update(
      { id: video.id, status: 'processing' },
      {
        status: 'ready',
        duration_seconds: probe.durationSeconds,
        metadata: probe.metadata,
        thumbnail_key: thumbnailKey,
      },
    );
  }

  async markFailed(videoId: string, reason: VideoFailureReason): Promise<void> {
    await this.videoRepository.update(
      { id: videoId, status: 'processing' },
      { status: 'failed', failure_reason: reason },
    );
  }

  private async probe(sourceUrl: string): Promise<ProbeResult> {
    try {
      return await this.mediaProbeService.probe(sourceUrl);
    } catch (error) {
      if (error instanceof InvalidMediaError) {
        // The same file always fails the same way: skip the remaining attempts.
        throw new UnrecoverableError(VIDEO_FAILURE_REASONS.invalidMedia);
      }
      throw error;
    }
  }

  // The key is deterministic, so a retried job overwrites the same object.
  private async uploadThumbnail(
    sourceUrl: string,
    durationSeconds: number | null,
    thumbnailKey: string,
  ): Promise<void> {
    const workDir = await mkdtemp(join(tmpdir(), 'streamtube-thumbnail-'));
    try {
      const outputPath = join(workDir, 'thumbnail.jpg');
      await this.thumbnailService.extractFrame(
        sourceUrl,
        this.thumbnailService.computeOffset(durationSeconds),
        outputPath,
      );
      await this.storageService.putObject(
        thumbnailKey,
        await readFile(outputPath),
        THUMBNAIL_CONTENT_TYPE,
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
