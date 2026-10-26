import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import storageConfig from '../src/config/storage.config';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { createAuthenticatedUser, createE2eApp } from './helpers/e2e-app';

// Spec: nestjs-project/specs/videos-upload-parts.plan.md (SI-03.5)

const internalEndpoint = storageConfig().endpoint;

describe('videos-upload-parts', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let ownerToken: string;
  let otherToken: string;
  let publicId: string;

  beforeAll(async () => {
    // S3_PUBLIC_ENDPOINT → internal endpoint so presigned URLs work in-container.
    app = await createE2eApp((builder) =>
      builder
        .overrideProvider(storageConfig.KEY)
        .useValue({ ...storageConfig(), publicEndpoint: internalEndpoint }),
    );
    dataSource = app.get(DataSource);
    await cleanAllTables(dataSource);
    ownerToken = await createAuthenticatedUser(app, 'parts_owner@example.com');
    otherToken = await createAuthenticatedUser(app, 'parts_other@example.com');
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
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Parts video',
        filename: 'clip.mp4',
        size: 5242880,
        contentType: 'video/mp4',
      })
      .expect(201);
    publicId = (res.body as { video: { public_id: string } }).video.public_id;
  });

  const as = (token: string) => ({
    partUrls: (partNumbers: number[]) =>
      request(app.getHttpServer())
        .post(`/videos/${publicId}/upload/part-urls`)
        .set('Authorization', `Bearer ${token}`)
        .send({ part_numbers: partNumbers }),
    parts: () =>
      request(app.getHttpServer())
        .get(`/videos/${publicId}/upload/parts`)
        .set('Authorization', `Bearer ${token}`),
    abort: () =>
      request(app.getHttpServer())
        .delete(`/videos/${publicId}/upload`)
        .set('Authorization', `Bearer ${token}`),
  });

  const errorOf = (res: request.Response): string =>
    (res.body as { error: string }).error;

  const countVideos = async (): Promise<number> =>
    dataSource.getRepository(Video).countBy({ public_id: publicId });

  // 1. POST /videos/:publicId/upload/part-urls, GET …/upload/parts, DELETE …/upload

  test('issues-presigned-part-urls', async () => {
    const res = await as(ownerToken).partUrls([1]).expect(200);
    const body = res.body as {
      urls: { part_number: number; url: string }[];
      expires_at: string;
    };

    expect(body.urls).toHaveLength(1);
    expect(body.urls[0].part_number).toBe(1);
    expect(new URL(body.urls[0].url).host).toBe(new URL(internalEndpoint).host);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('rejects-part-number-above-part-count', async () => {
    const res = await as(ownerToken).partUrls([2]).expect(400);

    expect(errorOf(res)).toBe('INVALID_UPLOAD_PARTS');
  });

  test('lists-uploaded-parts-for-resume', async () => {
    const urlRes = await as(ownerToken).partUrls([1]).expect(200);
    const [{ url }] = (urlRes.body as { urls: { url: string }[] }).urls;
    const put = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(5242880),
    });
    expect(put.status).toBe(200);
    const etag = put.headers.get('etag');
    expect(etag).toBeTruthy();

    const res = await as(ownerToken).parts().expect(200);

    expect((res.body as { parts: unknown[] }).parts).toContainEqual({
      part_number: 1,
      etag,
      size_bytes: 5242880,
    });
  });

  test('aborts-upload-and-removes-draft', async () => {
    await as(ownerToken).abort().expect(204, '');

    expect(await countVideos()).toBe(0);
    const res = await as(ownerToken).partUrls([1]).expect(404);
    expect(errorOf(res)).toBe('VIDEO_NOT_FOUND');
  });

  test('hides-video-from-non-owner', async () => {
    const responses = [
      await as(otherToken).partUrls([1]),
      await as(otherToken).parts(),
      await as(otherToken).abort(),
    ];

    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(errorOf(res)).toBe('VIDEO_NOT_FOUND');
    }
    expect(await countVideos()).toBe(1);
  });

  test('rejects-operations-outside-draft', async () => {
    await dataSource.query(
      `UPDATE videos SET status = 'processing' WHERE public_id = $1`,
      [publicId],
    );

    const responses = [
      await as(ownerToken).partUrls([1]),
      await as(ownerToken).parts(),
      await as(ownerToken).abort(),
    ];

    for (const res of responses) {
      expect(res.status).toBe(409);
      expect(errorOf(res)).toBe('INVALID_UPLOAD_STATE');
    }
  });
});
