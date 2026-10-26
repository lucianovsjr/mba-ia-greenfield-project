import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import queueConfig from '../src/config/queue.config';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  createFixtureDir,
  generateRandomBytes,
  generateVideo,
  type VideoFixtureDir,
} from '../src/test/video-fixtures';
import { Video } from '../src/videos/entities/video.entity';
import {
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../src/videos/processing/video-processing.constants';
import { VIDEO_STORAGE_KEYS } from '../src/videos/videos.constants';
import { WorkerModule } from '../src/worker.module';
import { createAuthenticatedUser, createE2eApp } from './helpers/e2e-app';

// Full pipeline over real Postgres, MinIO, Redis and FFmpeg: the API and the
// video worker run in this process, wired only through the queue (SI-03.11).

const internalEndpoint = storageConfig().endpoint;
// Own Redis namespace: no other suite (nor the video-worker container) touches it.
const pipelineQueueConfig = { ...queueConfig(), prefix: 'test-pipeline' };
const PIPELINE_TIMEOUT_MS = 60_000;
const FINAL_STATUSES = ['ready', 'failed'];

interface VideoBody {
  public_id: string;
  status: string;
  size_bytes: number;
  duration_seconds: number | null;
  metadata: { width: number | null; height: number | null } | null;
  has_thumbnail: boolean;
  failure_reason: string | null;
}

describe('videos-pipeline', () => {
  let app: INestApplication<App>;
  let worker: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let queue: Queue<ProcessVideoJobData>;
  let fixtures: VideoFixtureDir;
  let token: string;

  const discardVideos = async (): Promise<void> => {
    for (const row of await dataSource.getRepository(Video).find()) {
      if (row.upload_id) {
        await storage.abortMultipartUpload(row.source_key, row.upload_id);
      }
      await storage.deleteObject(row.source_key);
      await storage.deleteObject(VIDEO_STORAGE_KEYS.thumbnail(row.id));
    }
    await dataSource.query('DELETE FROM "videos"');
  };

  const api = () => request(app.getHttpServer());
  const auth = (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);

  // Client side of the upload: the API only hands out part URLs, the bytes
  // go straight to storage. Returns the hosts that received the parts.
  const uploadFile = async (
    filePath: string,
    contentType: string,
  ): Promise<{ publicId: string; partHosts: string[] }> => {
    const file = await readFile(filePath);
    const initiate = await auth(api().post('/videos'))
      .send({
        title: 'Pipeline video',
        filename: basename(filePath),
        size: file.byteLength,
        contentType,
      })
      .expect(201);
    const { video, upload } = initiate.body as {
      video: { public_id: string };
      upload: { part_size_bytes: number; part_count: number };
    };
    const publicId = video.public_id;

    const partNumbers = Array.from(
      { length: upload.part_count },
      (_, i) => i + 1,
    );
    const urlsRes = await auth(
      api().post(`/videos/${publicId}/upload/part-urls`),
    )
      .send({ part_numbers: partNumbers })
      .expect(200);
    const { urls } = urlsRes.body as {
      urls: { part_number: number; url: string }[];
    };

    const parts: { part_number: number; etag: string }[] = [];
    for (const { part_number, url } of urls) {
      const start = (part_number - 1) * upload.part_size_bytes;
      const put = await fetch(url, {
        method: 'PUT',
        body: new Uint8Array(
          file.subarray(start, start + upload.part_size_bytes),
        ),
      });
      expect(put.status).toBe(200);
      parts.push({ part_number, etag: put.headers.get('etag')! });
    }

    const completeRes = await auth(
      api().post(`/videos/${publicId}/upload/complete`),
    )
      .send({ parts })
      .expect(200);
    expect((completeRes.body as VideoBody).status).toBe('processing');

    return { publicId, partHosts: urls.map(({ url }) => new URL(url).host) };
  };

  // Polls GET /videos/:publicId as a client would until processing ends.
  const waitForFinalStatus = async (publicId: string): Promise<VideoBody> => {
    const deadline = Date.now() + PIPELINE_TIMEOUT_MS - 10_000;
    for (;;) {
      const res = await auth(api().get(`/videos/${publicId}`)).expect(200);
      const body = res.body as VideoBody;
      if (FINAL_STATUSES.includes(body.status)) return body;
      if (Date.now() > deadline) {
        throw new Error(`Video ${publicId} still '${body.status}'`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };

  const playbackLocation = async (
    publicId: string,
    path: string,
  ): Promise<string> => {
    const res = await auth(api().get(`/videos/${publicId}/${path}`))
      .redirects(0)
      .expect(302);
    return res.headers.location;
  };

  beforeAll(async () => {
    // The part and playback URLs must be reachable from inside the container.
    app = await createE2eApp((builder) =>
      builder
        .overrideProvider(storageConfig.KEY)
        .useValue({ ...storageConfig(), publicEndpoint: internalEndpoint })
        .overrideProvider(queueConfig.KEY)
        .useValue(pipelineQueueConfig),
    );
    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    queue = app.get<Queue<ProcessVideoJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    await queue.obliterate({ force: true });

    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(queueConfig.KEY)
      .useValue(pipelineQueueConfig)
      .compile();
    // init() runs the BullMQ explorer, which starts consuming the queue.
    await worker.init();

    fixtures = await createFixtureDir();
    await discardVideos();
    await cleanAllTables(dataSource);
    token = await createAuthenticatedUser(app, 'pipeline_owner@example.com');
  }, PIPELINE_TIMEOUT_MS);

  afterAll(async () => {
    await worker.close();
    await discardVideos();
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
    await app.close();
    await fixtures.cleanup();
  });

  test(
    'uploads-processes-and-plays-back-a-valid-video',
    async () => {
      const filePath = await generateVideo(join(fixtures.path, 'clip.mp4'), {
        width: 640,
        height: 360,
        durationSeconds: 3,
      });

      const { publicId, partHosts } = await uploadFile(filePath, 'video/mp4');

      // No request carrying file bytes ever reaches the API.
      expect(partHosts.length).toBeGreaterThan(0);
      for (const host of partHosts) {
        expect(host).toBe(new URL(internalEndpoint).host);
      }

      const video = await waitForFinalStatus(publicId);
      expect(video).toMatchObject({
        status: 'ready',
        has_thumbnail: true,
        failure_reason: null,
        metadata: { width: 640, height: 360 },
      });
      expect(video.duration_seconds).toBeCloseTo(3, 0);

      const ranged = await fetch(await playbackLocation(publicId, 'stream'), {
        headers: { Range: 'bytes=0-1023' },
      });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toBe(
        `bytes 0-1023/${video.size_bytes}`,
      );
      await ranged.arrayBuffer();

      const download = await fetch(
        await playbackLocation(publicId, 'download'),
      );
      expect(download.status).toBe(200);
      expect((await download.arrayBuffer()).byteLength).toBe(video.size_bytes);

      const thumbnail = await fetch(
        await playbackLocation(publicId, 'thumbnail'),
      );
      expect(thumbnail.status).toBe(200);
      expect(thumbnail.headers.get('content-type')).toBe('image/jpeg');
      expect((await thumbnail.arrayBuffer()).byteLength).toBeGreaterThan(0);
    },
    PIPELINE_TIMEOUT_MS,
  );

  test(
    'marks-a-corrupted-upload-as-failed-invalid-media',
    async () => {
      const filePath = await generateRandomBytes(
        join(fixtures.path, 'corrupted.mp4'),
      );

      const { publicId } = await uploadFile(filePath, 'video/mp4');

      const video = await waitForFinalStatus(publicId);
      expect(video).toMatchObject({
        status: 'failed',
        failure_reason: 'INVALID_MEDIA',
        has_thumbnail: false,
        duration_seconds: null,
      });
      await auth(api().get(`/videos/${publicId}/stream`))
        .redirects(0)
        .expect(409);
    },
    PIPELINE_TIMEOUT_MS,
  );
});
