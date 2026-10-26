---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.9
target_file: nestjs-project/test/videos-get.e2e-spec.ts
---

# GET /videos/:publicId Test Plan

## Application Overview

`GET /videos/:publicId` returns the owner's video (`VideoResponse`) with its processing status, so the client can follow the `draft → processing → ready | failed` cycle, including duration, metadata and failure reason. Internal identifiers and storage keys are never exposed, and other users get `404`.

## Test Scenarios

### 1. GET /videos/:publicId

**Setup:** Boot `AppModule` with the `main.ts` global config reproduced. Real Postgres. In `beforeAll`, register, confirm (Mailpit) and log in **owner** and **other**. In `beforeEach`, `DELETE FROM videos`, create a draft as **owner** via `POST /videos`, then put the row into the state each scenario needs with direct DB updates. No worker is needed. `afterAll` closes the app.

#### 1.1. returns-owner-video-with-status

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET /videos/:publicId as **owner** (video in `'draft'`)
    - expect: status `200` with `body.public_id` = `:publicId`, `body.status` = `"draft"` and every `VideoResponse` field present

#### 1.2. ready-video-exposes-processing-results

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. Update the row to `status = 'ready'`, `duration_seconds = 3.0`, `metadata = { "formatName": "mov,mp4,m4a,3gp,3g2,mj2", "width": 640, "height": 360, "videoCodec": "h264", ... }`, `thumbnail_key = 'videos/{id}/thumbnail.jpg'`
  2. GET /videos/:publicId as **owner**
    - expect: status `200` with `body.status` = `"ready"`, `body.duration_seconds` = `3`, `body.metadata.width` = `640` and `body.has_thumbnail` = `true`

#### 1.3. failed-video-exposes-failure-reason

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. Update the row to `status = 'failed'`, `failure_reason = 'INVALID_MEDIA'`
  2. GET /videos/:publicId as **owner**
    - expect: status `200` with `body.status` = `"failed"` and `body.failure_reason` = `"INVALID_MEDIA"`

#### 1.4. never-exposes-internal-fields

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET /videos/:publicId as **owner** for a `'ready'` video
    - expect: the body has none of the keys `id`, `upload_id`, `source_key`, `thumbnail_key`, `channel_id`

#### 1.5. hides-video-from-non-owner-and-unknown-ids

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-26T00:59:32Z

**Steps:**
  1. GET /videos/:publicId as **other**
    - expect: status `404` with `error: "VIDEO_NOT_FOUND"`
  2. GET /videos/AAAAAAAAAAA as **owner** (non-existent id)
    - expect: status `404` with `error: "VIDEO_NOT_FOUND"`
