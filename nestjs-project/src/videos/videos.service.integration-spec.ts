import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videosConfig from '../config/videos.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VIDEO_PROCESSING_QUEUE } from './processing/video-processing.constants';
import * as publicIdUtil from './public-id.util';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (integration)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let videosService: VideosService;
  let storage: StorageService;
  let videoRepository: Repository<Video>;
  let queue: Queue;
  let userId: string;
  let channelId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, videosConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    })
      // Presigned URLs must be reachable from inside the container.
      .overrideProvider(storageConfig.KEY)
      .useValue({
        ...storageConfig(),
        publicEndpoint: storageConfig().endpoint,
      })
      .compile();

    dataSource = moduleRef.get(DataSource);
    videosService = moduleRef.get(VideosService);
    storage = moduleRef.get(StorageService);
    videoRepository = dataSource.getRepository(Video);
    queue = moduleRef.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await cleanAllTables(dataSource);
    await queue.obliterate({ force: true });
    const user = await dataSource.getRepository(User).save({
      email: 'video_owner@example.com',
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'video_owner',
      nickname: 'video_owner',
      user_id: user.id,
    });
    userId = user.id;
    channelId = channel.id;
  });

  const initiate = () =>
    videosService.initiateUpload(userId, {
      title: 'Integration video',
      filename: 'clip.mp4',
      size: 5242880,
      contentType: 'video/mp4',
    });

  it('should persist a draft linked to the caller channel with an open multipart upload', async () => {
    const result = await initiate();

    const row = await videoRepository.findOneByOrFail({
      public_id: result.video.public_id,
    });
    expect(row.status).toBe('draft');
    expect(row.channel_id).toBe(channelId);
    expect(row.title).toBe('Integration video');
    expect(row.source_key).toBe(`videos/${row.id}/source`);
    expect(row.upload_id).toEqual(expect.any(String));
    // The multipart upload really exists in MinIO (ListParts would fail otherwise).
    await expect(
      storage.listParts(row.source_key, row.upload_id!),
    ).resolves.toEqual([]);
    await storage.abortMultipartUpload(row.source_key, row.upload_id!);
  });

  it('should resolve a public_id collision with a new id', async () => {
    const first = await initiate();
    const original = publicIdUtil.generatePublicId;
    jest
      .spyOn(publicIdUtil, 'generatePublicId')
      .mockReturnValueOnce(first.video.public_id)
      .mockImplementation(original);

    const second = await initiate();

    expect(second.video.public_id).not.toBe(first.video.public_id);
    expect(await videoRepository.count()).toBe(2);
    for (const row of await videoRepository.find()) {
      await storage.abortMultipartUpload(row.source_key, row.upload_id!);
    }
  });

  it('should list a part uploaded through an issued presigned URL', async () => {
    const { video } = await initiate();
    const { urls } = await videosService.requestPartUrls(
      userId,
      video.public_id,
      { part_numbers: [1] },
    );
    const put = await fetch(urls[0].url, {
      method: 'PUT',
      body: new Uint8Array(1024),
    });
    expect(put.status).toBe(200);

    const { parts } = await videosService.listUploadedParts(
      userId,
      video.public_id,
    );

    expect(parts).toEqual([
      { part_number: 1, etag: put.headers.get('etag'), size_bytes: 1024 },
    ]);
    const row = await videoRepository.findOneByOrFail({
      public_id: video.public_id,
    });
    await storage.abortMultipartUpload(row.source_key, row.upload_id!);
  });

  it('should abort the multipart upload and delete the draft', async () => {
    const { video } = await initiate();
    const row = await videoRepository.findOneByOrFail({
      public_id: video.public_id,
    });

    await videosService.abortUpload(userId, video.public_id);

    expect(
      await videoRepository.findOneBy({ public_id: video.public_id }),
    ).toBeNull();
    await expect(
      storage.listParts(row.source_key, row.upload_id!),
    ).rejects.toMatchObject({ name: 'NoSuchUpload' });
  });
  const uploadSinglePart = async (publicId: string, bytes: number) => {
    const { urls } = await videosService.requestPartUrls(userId, publicId, {
      part_numbers: [1],
    });
    const put = await fetch(urls[0].url, {
      method: 'PUT',
      body: new Uint8Array(bytes),
    });
    expect(put.status).toBe(200);
    return put.headers.get('etag')!;
  };

  it('should complete the upload, move to processing and enqueue a job keyed by the video id', async () => {
    const { video } = await initiate();
    const etag = await uploadSinglePart(video.public_id, 5242880);

    const result = await videosService.completeUpload(userId, video.public_id, {
      parts: [{ part_number: 1, etag }],
    });

    expect(result.status).toBe('processing');
    const row = await videoRepository.findOneByOrFail({
      public_id: video.public_id,
    });
    expect(row.status).toBe('processing');
    expect(row.upload_id).toBeNull();
    expect(await storage.headObject(row.source_key)).toBe(5242880);
    const job = await queue.getJob(row.id);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: row.id });

    await videosService.completeUpload(userId, video.public_id, {
      parts: [{ part_number: 1, etag }],
    });
    expect(
      await queue.getJobCounts('waiting', 'delayed', 'active'),
    ).toMatchObject({
      waiting: 1,
      delayed: 0,
      active: 0,
    });
    await storage.deleteObject(row.source_key);
  });

  it('should delete the object and the draft when the stored size differs from the declared one', async () => {
    const { video } = await initiate();
    const row = await videoRepository.findOneByOrFail({
      public_id: video.public_id,
    });
    const etag = await uploadSinglePart(video.public_id, 1024);

    await expect(
      videosService.completeUpload(userId, video.public_id, {
        parts: [{ part_number: 1, etag }],
      }),
    ).rejects.toMatchObject({ errorCode: 'UPLOAD_SIZE_MISMATCH' });

    expect(await videoRepository.findOneBy({ id: row.id })).toBeNull();
    await expect(storage.headObject(row.source_key)).rejects.toMatchObject({
      name: 'NotFound',
    });
    expect(await queue.getJob(row.id)).toBeUndefined();
  });

  describe('getPlaybackUrl', () => {
    const SOURCE_SIZE = 4096;

    // A ready video whose source object was written straight to storage.
    const seedReadyVideo = async (): Promise<Video> => {
      const { video } = await initiate();
      const row = await videoRepository.findOneByOrFail({
        public_id: video.public_id,
      });
      await storage.abortMultipartUpload(row.source_key, row.upload_id!);
      await storage.putObject(
        row.source_key,
        new Uint8Array(SOURCE_SIZE).map((_, i) => i % 256),
        'video/mp4',
      );
      await videoRepository.update(
        { id: row.id },
        { status: 'ready', upload_id: null },
      );
      return row;
    };

    it('should issue a stream URL that the storage serves with Range and 206', async () => {
      const row = await seedReadyVideo();

      const url = await videosService.getPlaybackUrl(
        userId,
        row.public_id,
        'stream',
      );
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });

      expect(res.status).toBe(206);
      expect(res.headers.get('content-range')).toBe(
        `bytes 0-1023/${SOURCE_SIZE}`,
      );
      expect(res.headers.get('content-type')).toBe('video/mp4');
      expect((await res.arrayBuffer()).byteLength).toBe(1024);
      await storage.deleteObject(row.source_key);
    });

    it('should issue a download URL answering with an attachment disposition', async () => {
      const row = await seedReadyVideo();

      const url = await videosService.getPlaybackUrl(
        userId,
        row.public_id,
        'download',
      );
      const res = await fetch(url);

      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toBe(
        `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
      );
      expect((await res.arrayBuffer()).byteLength).toBe(SOURCE_SIZE);
      await storage.deleteObject(row.source_key);
    });

    it('should issue a URL that stops working after the playback TTL', async () => {
      const row = await seedReadyVideo();
      jest.replaceProperty(
        moduleRef.get<ConfigType<typeof videosConfig>>(videosConfig.KEY),
        'playbackUrlTtlSeconds',
        1,
      );

      const url = await videosService.getPlaybackUrl(
        userId,
        row.public_id,
        'stream',
      );
      expect((await fetch(url)).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect((await fetch(url)).status).toBe(403);
      await storage.deleteObject(row.source_key);
    });
  });
});
