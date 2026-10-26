---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.4
target_file: nestjs-project/test/videos-initiate-upload.e2e-spec.ts
---

# POST /videos — Initiate Upload Test Plan

## Application Overview

`POST /videos` starts a video upload. It validates title, file format and size, pre-registers the video as a `draft` in the caller's channel with a unique 11-char `public_id`, and opens an S3 multipart upload in MinIO. It returns the part size and part count the client uses to upload bytes directly to storage, so the file never passes through the API.

## Test Scenarios

### 1. POST /videos

**Setup:** Boot `AppModule` with the `main.ts` global config reproduced (`ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`; `DomainExceptionFilter`; `ValidationExceptionFilter`). Real Postgres (`db`) and MinIO (`minio`, bucket `streamtube-videos`). In `beforeEach`, clean with `DELETE FROM videos`. In `beforeAll`, register a user, confirm via Mailpit and log in to get an access token, following the `test/auth.e2e-spec.ts` helpers. `afterAll` closes the app.

#### 1.1. creates-draft-and-returns-upload-plan

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos with `Authorization: Bearer <token>` and body `{ "title": "My first video", "filename": "clip.mp4", "size": 5242880, "contentType": "video/mp4" }`
    - expect: status `201`
    - expect: `body.video.status` is `"draft"` and `body.video.title` is `"My first video"`
    - expect: `body.video.public_id` matches `^[A-Za-z0-9_-]{11}$`
    - expect: `body.upload.part_count` equals `Math.ceil(5242880 / body.upload.part_size_bytes)`
    - expect: the body contains no internal `id`, `upload_id` or `source_key`
  2. Query `SELECT * FROM videos WHERE public_id = <body.video.public_id>`
    - expect: one row with `status = 'draft'`, `title = 'My first video'`, `channel_id` = the caller's channel id and `upload_id` not null

#### 1.2. rejects-unsupported-extension

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos with a valid token and `filename: "clip.mkv"`, `contentType: "video/x-matroska"` (other fields valid)
    - expect: status `415` with `error: "UNSUPPORTED_VIDEO_FORMAT"`
    - expect: no row inserted in `videos`

#### 1.3. rejects-extension-mime-mismatch

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos with a valid token, `filename: "clip.mp4"` and `contentType: "video/quicktime"`
    - expect: status `415` with `error: "UNSUPPORTED_VIDEO_FORMAT"`

#### 1.4. rejects-size-above-limit

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos with a valid token and `size: 10737418241`
    - expect: status `413` with `error: "VIDEO_TOO_LARGE"`
    - expect: no row inserted in `videos`

#### 1.5. rejects-missing-title

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos with a valid token and a body without `title`
    - expect: status `400` with `error: "VALIDATION_ERROR"` and `message` as an array mentioning `title`

#### 1.6. requires-authentication

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. POST /videos with a valid body and no `Authorization` header
    - expect: status `401`
