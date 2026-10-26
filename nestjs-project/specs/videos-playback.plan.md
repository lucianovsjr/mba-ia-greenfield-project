---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.10
target_file: nestjs-project/test/videos-playback.e2e-spec.ts
---

# Streaming, Download and Thumbnail Endpoints Test Plan

## Application Overview

`GET /videos/:publicId/stream`, `/download` and `/thumbnail` authorize the owner and answer `302` to short-lived presigned MinIO URLs. MinIO itself serves `Range` requests with `206 Partial Content`, so playback starts without a full download and the bytes never pass through the API. The download URL forces `Content-Disposition: attachment` with the original filename. All three require the video to be `ready`.

## Test Scenarios

### 1. GET /videos/:publicId/stream, GET /videos/:publicId/download, GET /videos/:publicId/thumbnail

**Setup:** Boot `AppModule` with the `main.ts` global config reproduced. Real Postgres and MinIO. Set `S3_PUBLIC_ENDPOINT=http://minio:9000` so the `Location` URLs are reachable from inside the container. In `beforeAll`, register, confirm (Mailpit) and log in **owner** and **other**. In `beforeEach`, `DELETE FROM videos`, create a draft as **owner** via `POST /videos` (`filename: "clip.mp4"`), then write fixtures directly to storage with `StorageService.putObject`: a 4096-byte object at `videos/{id}/source` and a small JPEG at `videos/{id}/thumbnail.jpg`. Finally update the row to `status = 'ready'`, `upload_id = null`, `thumbnail_key = 'videos/{id}/thumbnail.jpg'`. Requests use supertest without following redirects. `afterAll` closes the app.

#### 1.1. stream-redirects-to-presigned-url-serving-ranges

**Covers AC:** #1, #2
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET /videos/:publicId/stream as **owner**
    - expect: status `302`, and the `Location` host equals the `S3_PUBLIC_ENDPOINT` host
  2. `fetch(Location, { headers: { Range: "bytes=0-1023" } })`
    - expect: status `206`, a 1024-byte body and `Content-Range: bytes 0-1023/4096`

#### 1.2. download-forces-attachment-with-original-filename

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET /videos/:publicId/download as **owner**
    - expect: status `302` with a `Location` header
  2. `fetch(Location)`
    - expect: status `200` and a `Content-Disposition` header starting with `attachment` that contains `clip.mp4`

#### 1.3. thumbnail-redirects-to-jpeg

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET /videos/:publicId/thumbnail as **owner**
    - expect: status `302`
  2. `fetch(Location)`
    - expect: status `200` with `Content-Type: image/jpeg`

#### 1.4. rejects-playback-before-ready

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. Update the row to `status = 'processing'`
  2. GET …/stream, …/download and …/thumbnail as **owner**
    - expect: each returns `409` with `error: "VIDEO_NOT_READY"`

#### 1.5. hides-video-from-non-owner

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET …/stream, …/download and …/thumbnail as **other**
    - expect: each returns `404` with `error: "VIDEO_NOT_FOUND"` and no `Location` header
