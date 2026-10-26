---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: nestjs-project/test/videos-upload-parts.e2e-spec.ts
---

# Upload Parts Endpoints Test Plan

## Application Overview

While a video is a `draft`, its owner can request presigned `UploadPart` URLs at any time (the resume path), list the parts already stored by MinIO, and abort the upload, which removes the multipart upload and the draft. Only the owner can reach these endpoints, and only while the upload is in progress.

## Test Scenarios

### 1. POST /videos/:publicId/upload/part-urls, GET /videos/:publicId/upload/parts, DELETE /videos/:publicId/upload

**Setup:** Boot `AppModule` with the `main.ts` global config reproduced (`ValidationPipe`, `DomainExceptionFilter`, `ValidationExceptionFilter`). Real Postgres and MinIO. Set `S3_PUBLIC_ENDPOINT=http://minio:9000` so presigned URLs are reachable from inside the container. In `beforeAll`, register, confirm (Mailpit) and log in two users, **owner** and **other**. In `beforeEach`, clean with `DELETE FROM videos` and create a draft as **owner** via `POST /videos` (`filename: "clip.mp4"`, `contentType: "video/mp4"`, `size: 5242880`). `afterAll` closes the app.

#### 1.1. issues-presigned-part-urls

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos/:publicId/upload/part-urls as **owner** with `{ "part_numbers": [1] }`
    - expect: status `200`
    - expect: `body.urls` has 1 entry `{ part_number: 1, url }` whose `url` host is the `S3_PUBLIC_ENDPOINT` host
    - expect: `body.expires_at` is an ISO-8601 date in the future

#### 1.2. rejects-part-number-above-part-count

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos/:publicId/upload/part-urls as **owner** with `{ "part_numbers": [2] }` (the draft has `part_count = 1`)
    - expect: status `400` with `error: "INVALID_UPLOAD_PARTS"`

#### 1.3. lists-uploaded-parts-for-resume

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST …/part-urls as **owner** with `{ "part_numbers": [1] }` and `PUT` 5242880 bytes to the returned URL
    - expect: storage responds `200` with an `ETag` header
  2. GET /videos/:publicId/upload/parts as **owner**
    - expect: status `200`
    - expect: `body.parts` contains `{ part_number: 1, etag: <ETag from step 1>, size_bytes: 5242880 }`

#### 1.4. aborts-upload-and-removes-draft

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. DELETE /videos/:publicId/upload as **owner**
    - expect: status `204` with an empty body
    - expect: `SELECT count(*) FROM videos WHERE public_id = :publicId` returns `0`
  2. POST /videos/:publicId/upload/part-urls as **owner** with `{ "part_numbers": [1] }`
    - expect: status `404` with `error: "VIDEO_NOT_FOUND"`

#### 1.5. hides-video-from-non-owner

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST …/part-urls, GET …/upload/parts and DELETE …/upload as **other** for the owner's draft
    - expect: each returns `404` with `error: "VIDEO_NOT_FOUND"`
    - expect: the owner's draft still exists in `videos`

#### 1.6. rejects-operations-outside-draft

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. Set the owner's video to `status = 'processing'` directly in the DB
  2. POST …/part-urls, GET …/upload/parts and DELETE …/upload as **owner**
    - expect: each returns `409` with `error: "INVALID_UPLOAD_STATE"`
