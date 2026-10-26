import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../src/videos/processing/video-processing.constants';
import { createAuthenticatedUser, createE2eApp } from './helpers/e2e-app';

// Spec: nestjs-project/specs/videos-upload-complete.plan.md (SI-03.6)

const DECLARED_SIZE = 5242880;

describe('videos-upload-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue<ProcessVideoJobData>;
  let ownerToken: string;

  beforeAll(async () => {
    // S3_PUBLIC_ENDPOINT → internal endpoint so presigned URLs work in-container.
    app = await createE2eApp((builder) =>
      builder.overrideProvider(storageConfig.KEY).useValue({
        ...storageConfig(),
        publicEndpoint: storageConfig().endpoint,
      }),
    );
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    queue = app.get<Queue<ProcessVideoJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    await cleanAllTables(dataSource);
    ownerToken = await createAuthenticatedUser(
      app,
      'complete_owner@example.com',
    );
  });

  afterAll(async () => {
    for (const video of await dataSource.getRepository(Video).find()) {
      if (video.upload_id) {
        await storage.abortMultipartUpload(video.source_key, video.upload_id);
      } else {
        await storage.deleteObject(video.source_key);
      }
    }
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    await app.close();
  });

  // Creates a draft (declared 5 MiB) and uploads part 1 with `bytes` bytes.
  const draftWithUploadedPart = async (bytes = DECLARED_SIZE) => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Complete video',
        filename: 'clip.mp4',
        size: DECLARED_SIZE,
        contentType: 'video/mp4',
      })
      .expect(201);
    const publicId = (res.body as { video: { public_id: string } }).video
      .public_id;
    const urlRes = await request(app.getHttpServer())
      .post(`/videos/${publicId}/upload/part-urls`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ part_numbers: [1] })
      .expect(200);
    const [{ url }] = (urlRes.body as { urls: { url: string }[] }).urls;
    const put = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(bytes),
    });
    expect(put.status).toBe(200);
    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ public_id: publicId });
    return { publicId, etag: put.headers.get('etag')!, id: row.id, row };
  };

  let draft: Awaited<ReturnType<typeof draftWithUploadedPart>>;

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await queue.obliterate({ force: true });
    draft = await draftWithUploadedPart();
  });

  const complete = (publicId: string, etag: string) =>
    request(app.getHttpServer())
      .post(`/videos/${publicId}/upload/complete`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ parts: [{ part_number: 1, etag }] });

  const errorOf = (res: request.Response): string =>
    (res.body as { error: string }).error;

  // 1. POST /videos/:publicId/upload/complete

  test('completes-upload-and-enqueues-processing-job', async () => {
    const res = await complete(draft.publicId, draft.etag).expect(200);
    expect((res.body as { status: string }).status).toBe('processing');

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: draft.id });
    expect(row.status).toBe('processing');
    expect(row.upload_id).toBeNull();

    const job = await queue.getJob(draft.id);
    expect(job?.name).toBe('process-video');
    expect(job?.data).toEqual({ videoId: draft.id });
  });

  test('retrying-complete-is-idempotent', async () => {
    await complete(draft.publicId, draft.etag).expect(200);

    const res = await complete(draft.publicId, draft.etag).expect(200);

    expect((res.body as { status: string }).status).toBe('processing');
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.filter((job) => job.data.videoId === draft.id)).toHaveLength(1);
  });

  test('rejects-wrong-etag', async () => {
    const res = await complete(
      draft.publicId,
      '"00000000000000000000000000000000"',
    ).expect(400);

    expect(errorOf(res)).toBe('INVALID_UPLOAD_PARTS');
    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: draft.id });
    expect(row.status).toBe('draft');
    expect(await queue.getJob(draft.id)).toBeUndefined();
  });

  test('rejects-size-mismatch-and-removes-upload', async () => {
    const mismatched = await draftWithUploadedPart(1024);

    const res = await complete(mismatched.publicId, mismatched.etag).expect(
      409,
    );

    expect(errorOf(res)).toBe('UPLOAD_SIZE_MISMATCH');
    expect(
      await dataSource.getRepository(Video).findOneBy({ id: mismatched.id }),
    ).toBeNull();
    await expect(
      storage.headObject(mismatched.row.source_key),
    ).rejects.toMatchObject({ name: 'NotFound' });
  });

  test('rejects-complete-for-ready-video', async () => {
    await dataSource.query(`UPDATE videos SET status = 'ready' WHERE id = $1`, [
      draft.id,
    ]);

    const res = await complete(draft.publicId, draft.etag).expect(409);

    expect(errorOf(res)).toBe('INVALID_UPLOAD_STATE');
  });
});
