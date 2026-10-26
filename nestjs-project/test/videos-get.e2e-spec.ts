import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { createAuthenticatedUser, createE2eApp } from './helpers/e2e-app';

// Spec: nestjs-project/specs/videos-get.plan.md (SI-03.9)

const VIDEO_RESPONSE_KEYS = [
  'public_id',
  'title',
  'status',
  'original_filename',
  'content_type',
  'size_bytes',
  'duration_seconds',
  'metadata',
  'has_thumbnail',
  'failure_reason',
  'created_at',
  'updated_at',
];

const READY_METADATA = {
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  bitRate: 1200000,
  width: 640,
  height: 360,
  frameRate: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
};

describe('videos-get', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let storage: StorageService;
  let ownerToken: string;
  let otherToken: string;
  let publicId: string;

  // Draft rows hold open multipart uploads in MinIO; abort them before deleting.
  const discardVideos = async (): Promise<void> => {
    for (const video of await videoRepository.find()) {
      if (video.upload_id) {
        await storage.abortMultipartUpload(video.source_key, video.upload_id);
      }
    }
    await dataSource.query('DELETE FROM "videos"');
  };

  const markReady = async (): Promise<void> => {
    const video = await videoRepository.findOneByOrFail({
      public_id: publicId,
    });
    await storage.abortMultipartUpload(video.source_key, video.upload_id!);
    await videoRepository.update(
      { id: video.id },
      {
        status: 'ready',
        upload_id: null,
        duration_seconds: 3.0,
        metadata: READY_METADATA,
        thumbnail_key: `videos/${video.id}/thumbnail.jpg`,
      },
    );
  };

  const getVideo = (id: string, token: string) =>
    request(app.getHttpServer())
      .get(`/videos/${id}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    storage = app.get(StorageService);
    await cleanAllTables(dataSource);
    ownerToken = await createAuthenticatedUser(app, 'get_owner@example.com');
    otherToken = await createAuthenticatedUser(app, 'get_other@example.com');
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
        title: 'Get video',
        filename: 'clip.mp4',
        size: 5242880,
        contentType: 'video/mp4',
      })
      .expect(201);
    publicId = (res.body as { video: { public_id: string } }).video.public_id;
  });

  // 1. GET /videos/:publicId

  test('returns-owner-video-with-status', async () => {
    const res = await getVideo(publicId, ownerToken).expect(200);

    const body = res.body as Record<string, unknown>;
    expect(body.public_id).toBe(publicId);
    expect(body.status).toBe('draft');
    for (const key of VIDEO_RESPONSE_KEYS) {
      expect(body).toHaveProperty(key);
    }
  });

  test('ready-video-exposes-processing-results', async () => {
    await markReady();

    const res = await getVideo(publicId, ownerToken).expect(200);

    const body = res.body as {
      status: string;
      duration_seconds: number;
      metadata: { width: number };
      has_thumbnail: boolean;
    };
    expect(body.status).toBe('ready');
    expect(body.duration_seconds).toBe(3);
    expect(body.metadata.width).toBe(640);
    expect(body.has_thumbnail).toBe(true);
  });

  test('failed-video-exposes-failure-reason', async () => {
    await videoRepository.update(
      { public_id: publicId },
      { status: 'failed', failure_reason: 'INVALID_MEDIA' },
    );

    const res = await getVideo(publicId, ownerToken).expect(200);

    const body = res.body as { status: string; failure_reason: string };
    expect(body.status).toBe('failed');
    expect(body.failure_reason).toBe('INVALID_MEDIA');
  });

  test('never-exposes-internal-fields', async () => {
    await markReady();

    const res = await getVideo(publicId, ownerToken).expect(200);

    for (const key of [
      'id',
      'upload_id',
      'source_key',
      'thumbnail_key',
      'channel_id',
    ]) {
      expect(res.body).not.toHaveProperty(key);
    }
  });

  test('hides-video-from-non-owner-and-unknown-ids', async () => {
    const asOther = await getVideo(publicId, otherToken).expect(404);
    expect((asOther.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');

    const unknown = await getVideo('AAAAAAAAAAA', ownerToken).expect(404);
    expect((unknown.body as { error: string }).error).toBe('VIDEO_NOT_FOUND');
  });
});
