import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnrecoverableError } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import storageConfig from '../../config/storage.config';
import { MediaModule } from '../../media/media.module';
import { STORAGE_S3_CLIENT } from '../../storage/storage.constants';
import { StorageModule } from '../../storage/storage.module';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  createFixtureDir,
  generateRandomBytes,
  generateVideo,
  type VideoFixtureDir,
} from '../../test/video-fixtures';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import { VIDEO_STORAGE_KEYS } from '../videos.constants';
import type { VideoStatus } from '../videos.types';
import { VideoProcessingService } from './video-processing.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessingService (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: VideoProcessingService;
  let storage: StorageService;
  let s3: S3Client;
  let videoRepository: Repository<Video>;
  let fixtures: VideoFixtureDir;
  let channelId: string;
  const storedKeys: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
        StorageModule,
        MediaModule,
      ],
      providers: [VideoProcessingService],
    }).compile();

    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(VideoProcessingService);
    storage = moduleRef.get(StorageService);
    s3 = moduleRef.get<S3Client>(STORAGE_S3_CLIENT);
    videoRepository = dataSource.getRepository(Video);
    fixtures = await createFixtureDir();
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await moduleRef.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    const user = await dataSource.getRepository(User).save({
      email: 'worker_owner@example.com',
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'worker_owner',
      nickname: 'worker_owner',
      user_id: user.id,
    });
    channelId = channel.id;
  });

  afterEach(async () => {
    for (const key of storedKeys.splice(0)) {
      await storage.deleteObject(key);
    }
  });

  // Stores the file as the video's source and returns the row.
  const seedVideo = async (
    filePath: string,
    status: VideoStatus = 'processing',
  ): Promise<Video> => {
    const id = randomUUID();
    const sourceKey = VIDEO_STORAGE_KEYS.source(id);
    const body = await readFile(filePath);
    await storage.putObject(sourceKey, body, 'video/mp4');
    storedKeys.push(sourceKey, VIDEO_STORAGE_KEYS.thumbnail(id));
    return videoRepository.save({
      id,
      public_id: id.slice(0, 11),
      channel_id: channelId,
      title: 'Worker video',
      status,
      original_filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: body.length,
      upload_id: null,
      source_key: sourceKey,
    });
  };

  it('should move a valid video to ready with duration, metadata and a JPEG thumbnail', async () => {
    const input = await generateVideo(join(fixtures.path, 'valid.mp4'), {
      width: 640,
      height: 360,
      durationSeconds: 2,
    });
    const video = await seedVideo(input);

    await service.process(video.id);

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe('ready');
    expect(row.duration_seconds).toBeCloseTo(2, 0);
    expect(row.metadata).toMatchObject({
      width: 640,
      height: 360,
      videoCodec: 'h264',
    });
    expect(row.thumbnail_key).toBe(`videos/${video.id}/thumbnail.jpg`);
    expect(row.failure_reason).toBeNull();

    const head = await s3.send(
      new HeadObjectCommand({
        Bucket: storageConfig().bucket,
        Key: row.thumbnail_key!,
      }),
    );
    expect(head.ContentType).toBe('image/jpeg');
    expect(head.ContentLength).toBeGreaterThan(0);
  }, 60000);

  it('should reject a corrupted file as unrecoverable and mark it failed with INVALID_MEDIA', async () => {
    const input = await generateRandomBytes(join(fixtures.path, 'corrupt.mp4'));
    const video = await seedVideo(input);

    const error = await service.process(video.id).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect(
      (await videoRepository.findOneByOrFail({ id: video.id })).status,
    ).toBe('processing');

    await service.markFailed(video.id, 'INVALID_MEDIA');

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('INVALID_MEDIA');
    expect(row.thumbnail_key).toBeNull();
  }, 60000);

  it('should leave a video that is not processing untouched', async () => {
    const input = await generateVideo(join(fixtures.path, 'draft.mp4'), {
      durationSeconds: 1,
    });
    const video = await seedVideo(input, 'draft');

    await service.process(video.id);
    await service.markFailed(video.id, 'PROCESSING_FAILED');

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe('draft');
    expect(row.duration_seconds).toBeNull();
    expect(row.failure_reason).toBeNull();
    expect(row.updated_at).toEqual(video.updated_at);
  }, 60000);
});
