---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:publicId/upload/complete Test Plan

## Application Overview

`POST /videos/:publicId/upload/complete` finalizes the multipart upload in MinIO, checks the stored object's real size against the declared one, moves the video from `draft` to `processing`, and adds the `process-video` job (`jobId = videoId`) to the `video-processing` BullMQ queue. Calling it again while the video is `processing` is a safe retry that does not duplicate the job.

## Test Scenarios

### 1. POST /videos/:publicId/upload/complete

**Setup:** Boot `AppModule` with the `main.ts` global config reproduced. Real Postgres, MinIO and Redis. Set `S3_PUBLIC_ENDPOINT=http://minio:9000`. No worker runs in this suite, so jobs stay in the queue. In `beforeAll`, register, confirm (Mailpit) and log in **owner**, and get the `video-processing` queue via `getQueueToken('video-processing')`. In `beforeEach`, `DELETE FROM videos`, `queue.obliterate({ force: true })`, create a draft via `POST /videos` (`size: 5242880`), request the URL for part 1 and `PUT` 5242880 bytes, keeping the returned `ETag`. `afterAll` closes the app.

#### 1.1. completes-upload-and-enqueues-processing-job

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos/:publicId/upload/complete as **owner** with `{ "parts": [{ "part_number": 1, "etag": "<ETag>" }] }`
    - expect: status `200` with `body.status` = `"processing"`
  2. Read the video row
    - expect: `status = 'processing'` and `upload_id` is null
  3. Read the job with id = the video's internal `id` from the queue
    - expect: the job exists, its name is `process-video` and its data is `{ "videoId": "<id>" }`

#### 1.2. retrying-complete-is-idempotent

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST …/upload/complete as **owner** with the correct part list
    - expect: status `200`
  2. POST …/upload/complete again with the same body
    - expect: status `200` with `body.status` = `"processing"`
    - expect: the queue holds exactly one job for this video

#### 1.3. rejects-wrong-etag

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST …/upload/complete as **owner** with `{ "parts": [{ "part_number": 1, "etag": "\"0000000000000000\"" }] }`
    - expect: status `400` with `error: "INVALID_UPLOAD_PARTS"`
    - expect: the video row stays in `'draft'` and no job is added

#### 1.4. rejects-size-mismatch-and-removes-upload

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. Create a second draft declaring `size: 5242880`, request the URL for part 1 and `PUT` only 1024 bytes
  2. POST …/upload/complete for that draft with the returned ETag
    - expect: status `409` with `error: "UPLOAD_SIZE_MISMATCH"`
    - expect: the draft row no longer exists and `HeadObject` on `videos/{id}/source` returns not found

#### 1.5. rejects-complete-for-ready-video

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. Set the owner's video to `status = 'ready'` directly in the DB
  2. POST …/upload/complete as **owner** with any valid part list
    - expect: status `409` with `error: "INVALID_UPLOAD_STATE"`
