import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VIDEO_STORAGE_KEYS } from '../src/videos/videos.constants';
import { createAuthenticatedUser, createE2eApp } from './helpers/e2e-app';

// Spec: nestjs-project/specs/videos-playback.plan.md (SI-03.10)

const internalEndpoint = storageConfig().endpoint;
const SOURCE_SIZE = 4096;
// JPEG SOI/APP0 header and EOI marker: enough for storage to serve as image/jpeg.
const THUMBNAIL_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);
const PLAYBACK_PATHS = ['stream', 'download', 'thumbnail'] as const;

describe('videos-playback', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let storage: StorageService;
  let ownerToken: string;
  let otherToken: string;
  let video: Video;

  const discardVideos = async (): Promise<void> => {
    for (const row of await videoRepository.find()) {
      if (row.upload_id) {
        await storage.abortMultipartUpload(row.source_key, row.upload_id);
      }
      await storage.deleteObject(row.source_key);
      await storage.deleteObject(VIDEO_STORAGE_KEYS.thumbnail(row.id));
    }
    await dataSource.query('DELETE FROM "videos"');
  };

  const getPlayback = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(`/videos/${video.public_id}/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .redirects(0);

  beforeAll(async () => {
    // The Location URLs must be reachable from inside the container.
    app = await createE2eApp((builder) =>
      builder
        .overrideProvider(storageConfig.KEY)
        .useValue({ ...storageConfig(), publicEndpoint: internalEndpoint }),
    );
    dataSource = app.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    storage = app.get(StorageService);
    await cleanAllTables(dataSource);
    ownerToken = await createAuthenticatedUser(
      app,
      'playback_owner@example.com',
    );
    otherToken = await createAuthenticatedUser(
      app,
      'playback_other@example.com',
    );
  });

  afterAll(async () => {
    await discardVideos();
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await discardVideos();
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Playback video',
        filename: 'clip.mp4',
        size: 5242880,
        contentType: 'video/mp4',
      })
      .expect(201);
    const publicId = (res.body as { video: { public_id: string } }).video
      .public_id;
    const draft = await videoRepository.findOneByOrFail({
      public_id: publicId,
    });

    await storage.abortMultipartUpload(draft.source_key, draft.upload_id!);
    await storage.putObject(
      draft.source_key,
      new Uint8Array(SOURCE_SIZE),
      'video/mp4',
    );
    const thumbnailKey = VIDEO_STORAGE_KEYS.thumbnail(draft.id);
    await storage.putObject(thumbnailKey, THUMBNAIL_BYTES, 'image/jpeg');
    await videoRepository.update(
      { id: draft.id },
      { status: 'ready', upload_id: null, thumbnail_key: thumbnailKey },
    );
    video = await videoRepository.findOneByOrFail({ id: draft.id });
  });

  // 1. GET /videos/:publicId/stream, /download, /thumbnail

  test('stream-redirects-to-presigned-url-serving-ranges', async () => {
    const res = await getPlayback('stream', ownerToken).expect(302);

    const location = res.headers.location;
    expect(new URL(location).host).toBe(new URL(internalEndpoint).host);

    const ranged = await fetch(location, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(ranged.status).toBe(206);
    expect((await ranged.arrayBuffer()).byteLength).toBe(1024);
    expect(ranged.headers.get('content-range')).toBe(
      `bytes 0-1023/${SOURCE_SIZE}`,
    );
  });

  test('download-forces-attachment-with-original-filename', async () => {
    const res = await getPlayback('download', ownerToken).expect(302);
    expect(res.headers.location).toEqual(expect.any(String));

    const file = await fetch(res.headers.location);
    expect(file.status).toBe(200);
    const disposition = file.headers.get('content-disposition') ?? '';
    expect(disposition.startsWith('attachment')).toBe(true);
    expect(disposition).toContain('clip.mp4');
  });

  test('thumbnail-redirects-to-jpeg', async () => {
    const res = await getPlayback('thumbnail', ownerToken).expect(302);

    const image = await fetch(res.headers.location);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/jpeg');
  });

  test('rejects-playback-before-ready', async () => {
    await videoRepository.update({ id: video.id }, { status: 'processing' });

    for (const path of PLAYBACK_PATHS) {
      const res = await getPlayback(path, ownerToken).expect(409);
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
    }
  });

  test('hides-video-from-non-owner', async () => {
    for (const path of PLAYBACK_PATHS) {
      const res = await getPlayback(path, otherToken).expect(404);
      expect((res.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
      expect(res.headers.location).toBeUndefined();
    }
  });
});
