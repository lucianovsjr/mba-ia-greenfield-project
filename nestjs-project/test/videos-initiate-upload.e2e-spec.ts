import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { StorageService } from '../src/storage/storage.service';
import { Video } from '../src/videos/entities/video.entity';
import { createAuthenticatedUser, createE2eApp } from './helpers/e2e-app';

// Spec: nestjs-project/specs/videos-initiate-upload.plan.md (SI-03.4)

interface InitiateBody {
  video: Record<string, unknown> & { public_id: string; status: string };
  upload: { part_size_bytes: number; part_count: number };
}

const validBody = {
  title: 'My first video',
  filename: 'clip.mp4',
  size: 5242880,
  contentType: 'video/mp4',
};

describe('videos-initiate-upload', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let token: string;
  let ownerChannelId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    await cleanAllTables(dataSource);
    token = await createAuthenticatedUser(app, 'initiate_owner@example.com');
    const [channel] = await dataSource.query<{ id: string }[]>(
      `SELECT c.id FROM channels c JOIN users u ON u.id = c.user_id WHERE u.email = $1`,
      ['initiate_owner@example.com'],
    );
    ownerChannelId = channel.id;
  });

  afterAll(async () => {
    const storage = app.get(StorageService);
    for (const video of await dataSource.getRepository(Video).find()) {
      if (video.upload_id) {
        await storage.abortMultipartUpload(video.source_key, video.upload_id);
      }
    }
    await cleanAllTables(dataSource);
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
  });

  const post = (body: Record<string, unknown>, auth = true) => {
    const req = request(app.getHttpServer()).post('/videos').send(body);
    return auth ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // 1. POST /videos

  test('creates-draft-and-returns-upload-plan', async () => {
    const res = await post(validBody).expect(201);
    const resBody = res.body as InitiateBody;

    expect(resBody.video.status).toBe('draft');
    expect(resBody.video.title).toBe('My first video');
    expect(resBody.video.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(resBody.upload.part_count).toBe(
      Math.ceil(5242880 / resBody.upload.part_size_bytes),
    );
    expect(resBody.video).not.toHaveProperty('id');
    expect(resBody.video).not.toHaveProperty('upload_id');
    expect(resBody.video).not.toHaveProperty('source_key');

    const rows = await dataSource.query<
      {
        status: string;
        title: string;
        channel_id: string;
        upload_id: string;
      }[]
    >(
      'SELECT status, title, channel_id, upload_id FROM videos WHERE public_id = $1',
      [resBody.video.public_id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'draft',
      title: 'My first video',
      channel_id: ownerChannelId,
    });
    expect(rows[0].upload_id).not.toBeNull();
  });

  test('rejects-unsupported-extension', async () => {
    const res = await post({
      ...validBody,
      filename: 'clip.mkv',
      contentType: 'video/x-matroska',
    }).expect(415);

    expect((res.body as { error: string }).error).toBe(
      'UNSUPPORTED_VIDEO_FORMAT',
    );
    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  test('rejects-extension-mime-mismatch', async () => {
    const res = await post({
      ...validBody,
      filename: 'clip.mp4',
      contentType: 'video/quicktime',
    }).expect(415);

    expect((res.body as { error: string }).error).toBe(
      'UNSUPPORTED_VIDEO_FORMAT',
    );
  });

  test('rejects-size-above-limit', async () => {
    const res = await post({ ...validBody, size: 10737418241 }).expect(413);

    expect((res.body as { error: string }).error).toBe('VIDEO_TOO_LARGE');
    expect(await dataSource.getRepository(Video).count()).toBe(0);
  });

  test('rejects-missing-title', async () => {
    const withoutTitle: Record<string, unknown> = { ...validBody };
    delete withoutTitle.title;
    const res = await post(withoutTitle).expect(400);
    const resBody = res.body as { error: string; message: string[] };

    expect(resBody.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(resBody.message)).toBe(true);
    expect(resBody.message.join(' ')).toContain('title');
  });

  test('requires-authentication', async () => {
    await post(validBody, false).expect(401);
  });
});
