---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-25
scope_description: "Backend foundation for video upload and processing: object storage (local S3-compatible server, SDK, key layout), background queue technology, direct-to-storage upload of up to 10GB, processing trigger, video worker runtime with FFmpeg/ffprobe (metadata + thumbnail), video status lifecycle and failure handling, unique public URL identifier, streaming/download delivery and access rules."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — receives the `videos` domain (entity, migration, endpoints), the storage and queue integrations, the video worker (FFmpeg/ffprobe) and the new Compose services (object storage, queue broker, worker). Covered by TD-01..TD-17.
- `next-frontend/` — no open decision. Phase 03 in `docs/project-plan.md` has no UI bullet and `DESAFIO.md` states that the video interface is out of scope for this phase. The Cross-layer TDs below (TD-05, TD-12, TD-13) fix the HTTP contract that a future frontend phase will consume; they do not open frontend implementation choices now.

_Research notes (facts verified on 2026-10-25 that constrain the options below):_

- Installed backend stack: `@nestjs/core`/`@nestjs/common` **11.1.16**, `typeorm` 0.3.28, `typescript` 5.9.3, Node `25.6.0` (`Dockerfile.dev`), CommonJS output (`module: nodenext`, no `"type": "module"`), Jest 30 + `ts-jest` (CJS).
- The official MinIO images are **no longer pullable**: `docker manifest inspect` returns `denied` for `minio/minio` and `minio/mc` (Docker Hub) and `no such manifest` for `quay.io/minio/minio`. MinIO community edition is now distributed as source only. Pullable alternatives checked: `pgsty/minio` / `pgsty/mc` (community fork, versioned `RELEASE.*` tags, latest `RELEASE.2026-08-04T00-00-00Z`), `cgr.dev/chainguard/minio`, `rustfs/rustfs` (`1.0.4`).
- `@nestjs/storage` (new official NestJS file-storage package returned by context7 for the NestJS docs) requires `@nestjs/core ^12.1.0` and is at `0.0.3` — **incompatible with the installed NestJS 11**. Discrepancy between the docs returned and the installed version is flagged here.
- `fluent-ffmpeg` is **deprecated** on npm ("Package no longer supported").
- `pg-boss@12` and `@nestjs/bullmq@12` are **ESM-only** (`"type": "module"`); `@nestjs/bullmq@11.0.5` is CJS and accepts `bullmq ^3 || ^4 || ^5 || ^6` with `@nestjs/core ^10 || ^11`. `@golevelup/nestjs-rabbitmq@9` requires `@nestjs/core ^11.1.24` (installed: 11.1.16).
- S3 limits: a single `PutObject` accepts at most 5 GB; multipart upload accepts parts of 5 MiB–5 GiB (last part may be smaller) and at most 10,000 parts. A 10GB file therefore **requires multipart upload**.
- MinIO does **not** support the `AbortIncompleteMultipartUpload` lifecycle action; instead it expires stale multipart uploads itself via `MINIO_API_STALE_UPLOADS_EXPIRY` (default `24h`, cleanup interval `6h`).

---

## TD-01: Queue Technology for Background Processing

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram (`docs/diagrams/software-arch.mermaid`) leaves the Message Queue as "TBD". The API publishes a processing job after upload; a separate worker consumes it. The queue must support retries with backoff, idempotent job identity, and run as a real service in Docker Compose, testable by integration tests. This is the main stack decision of the phase.

**Options:**

### Option A: BullMQ on Redis (or Valkey) via `@nestjs/bullmq`
- Redis-backed job queue with first-party NestJS integration (`BullModule.forRootAsync`, `registerQueue`, `@Processor`/`WorkerHost`). A new `redis` service is added to Compose.
- **Pros:** Official NestJS module; native `attempts` + exponential `backoff`, custom `jobId` for deduplication, `UnrecoverableError` to skip retries, `removeOnComplete`/`removeOnFail` retention. Mature, widely used for exactly this workload. `@nestjs/bullmq@11.x` and `bullmq` ship CJS, so they load cleanly under the project's CommonJS + Jest setup.
- **Cons:** Adds a new infrastructure dependency (Redis). Job state lives in Redis, outside the PostgreSQL transaction that updates the video row (enqueue cannot be atomic with the DB write). `@nestjs/bullmq@12` is ESM-only — the pin must stay on 11.x while the project is on NestJS 11.

### Option B: pg-boss on the existing PostgreSQL
- Job queue implemented on PostgreSQL tables (`SKIP LOCKED`). No new service — reuses the `db` container.
- **Pros:** Zero new infrastructure. Jobs can be enqueued in the same PostgreSQL database as the video row. Built-in `retryLimit`/`retryBackoff`, `singletonKey`, dead-letter queues.
- **Cons:** No official NestJS module (community wrappers only). `pg-boss@12` is ESM-only and requires Node ≥ 22.12 — loading it from a CommonJS project under Jest/ts-jest is a known friction point. Adds polling load and queue tables to the main database. Does not materialize the "Message Queue" as a distinct container from the architecture diagram.

### Option C: RabbitMQ via `@golevelup/nestjs-rabbitmq`
- AMQP broker as a new Compose service; the API publishes to an exchange, the worker consumes from a queue.
- **Pros:** True message broker, language-agnostic consumers, rich routing, management UI.
- **Cons:** No native delayed retry/backoff — needs dead-letter exchanges + TTL or the delayed-message plugin. Job-level concepts (attempt count, job state, dedup by id) must be hand-built. `@golevelup/nestjs-rabbitmq@9` requires `@nestjs/core ^11.1.24` (core upgrade needed). More moving parts for a single job type.

### Option D: SQS-compatible queue (ElasticMQ locally, Amazon SQS in production)
- SQS API served locally by ElasticMQ; production swaps to Amazon SQS, matching the "S3 in production" direction.
- **Pros:** Same API locally and in AWS production; visibility timeout + redrive policy (DLQ) are native.
- **Cons:** No official NestJS module; retries are visibility-timeout based (no exponential backoff without custom code); a 10GB video can exceed the visibility timeout unless it is extended manually. ElasticMQ is an emulator, not the production engine.

**Recommendation:** **Option A (BullMQ + Redis via `@nestjs/bullmq@11.x`)** — It is the only option with a first-party NestJS 11 integration *and* native job semantics this phase needs (attempts, exponential backoff, `jobId` dedup, unrecoverable errors), all in CJS-compatible packages that work with the project's Jest setup. The cost is one extra Compose service and the non-atomic enqueue, which TD-06/TD-15 handle by making the status transition and the job idempotent. pg-boss (B) would avoid new infra, but its ESM-only current major and lack of a NestJS module add more risk than Redis adds cost.

**Decision:** A (BullMQ + Redis via `@nestjs/bullmq@11.x`)
**Libraries:** bullmq, @nestjs/bullmq

---

## TD-02: Local S3-Compatible Storage Server Image

**Scope:** Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The project already targets S3-compatible object storage, with MinIO locally (`DESAFIO.md`, `CLAUDE.md`). Which storage *API* to use is not open. But the official MinIO container images can no longer be pulled (see Research notes), so the Compose file cannot simply use `minio/minio`. The image choice affects `compose.yaml`, the bucket-bootstrap step and every integration test that hits storage.

**Options:**

### Option A: `pgsty/minio` community fork (pinned `RELEASE.*` tag) + `pgsty/mc` for bucket bootstrap
- Drop-in MinIO server built from the community source, published with versioned tags (multi-arch); companion `mc` image for creating buckets.
- **Pros:** Same MinIO server, env vars (`MINIO_ROOT_USER`, `MINIO_API_STALE_UPLOADS_EXPIRY`) and console the project docs refer to. Pinnable tags give reproducible environments. Widely pulled (~2.6M).
- **Cons:** Third-party maintainer, not MinIO Inc. — supply-chain trust moves to the fork. Upstream community edition is no longer developed, so fixes depend on the fork.

### Option B: `cgr.dev/chainguard/minio`
- Hardened, minimal MinIO image built by Chainguard.
- **Pros:** Reputable publisher with a security focus; minimal image.
- **Cons:** The free public tier exposes only the `latest` tag (pinned versions require a subscription), so the environment is not reproducible. The minimal image may lack a shell or tools for healthchecks.

### Option C: Build MinIO from source in the repo (custom Dockerfile)
- A Dockerfile compiles the last community release from source (Go) and Compose builds it locally.
- **Pros:** Full control and provenance; no third-party image.
- **Cons:** Slow first build and a Go toolchain in the build stage; the repo now maintains a server build; same "unmaintained upstream" concern as A.

### Option D: RustFS (`rustfs/rustfs`) — a different S3-compatible server
- Independent S3-compatible object store written in Rust (Apache-2.0), versioned tags (`1.0.x`).
- **Pros:** Actively maintained, versioned, S3 API.
- **Cons:** Not MinIO — diverges from the project docs. Behavior around multipart edge cases, stale-upload cleanup and presigned URLs must be revalidated. Younger project.

**Recommendation:** **Option A (`pgsty/minio` pinned to a `RELEASE.*` tag, `pgsty/mc` for bucket creation)** — It keeps the exact server the architecture and `DESAFIO.md` describe (MinIO), with reproducible pinned tags, and needs no build. The application only talks S3 (TD-03), so switching later to S3 in production — or to another image — touches only `compose.yaml`. The fork's provenance is the accepted trade-off for a local-only dev/test service.

**Decision:** A (`pgsty/minio` pinned to a `RELEASE.*` tag + `pgsty/mc` for bucket bootstrap)

---

## TD-03: S3 Client Library and Endpoint Strategy

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** Both the API and the worker need to create multipart uploads, presign part URLs and GET URLs, complete/abort uploads, head/put/get objects. Presigned URLs embed the **host in the signature**. The API reaches storage at the Compose service name (`http://minio:9000`), but a client outside the Docker network must reach it at a public address. Signing with the internal host produces URLs the client cannot use, and rewriting the host breaks the signature. This affects the env-var contract (Joi schema + `.env.example` + `compose.yaml`).

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- Official modular SDK. `S3Client` with `endpoint` + `forcePathStyle: true` for MinIO; `getSignedUrl()` presigns any command (`UploadPartCommand`, `GetObjectCommand`, …).
- **Pros:** Works unchanged against AWS S3 in production. Full multipart API (`CreateMultipartUpload`, `UploadPart`, `ListParts`, `CompleteMultipartUpload`, `AbortMultipartUpload`). First-class TypeScript types. Node ≥ 20 (container runs 25).
- **Cons:** Verbose command objects; large dependency tree (modular, but still heavy).

### Option B: MinIO JavaScript SDK (`minio`)
- MinIO's own S3 client.
- **Pros:** Compact API; `presignedPutObject`/`presignedGetObject` helpers.
- **Cons:** Higher-level helpers hide multipart part presigning (needed by TD-05). Vendor-branded SDK whose upstream product is no longer distributed as a community binary. Less natural for an AWS S3 production target.

### Option C: `@nestjs/storage` (NestJS disk abstraction with an S3 disk)
- Official NestJS package with `signedUpload()`, `signedUrl()` and Range-aware `serveFile()`.
- **Pros:** NestJS-native, no AWS SDK.
- **Cons:** Requires `@nestjs/core ^12.1.0` — **incompatible with the installed NestJS 11.1.16**. Pre-1.0 (`0.0.3`). `signedUpload` is a single presigned PUT (capped at 5 GB by S3 — insufficient for 10GB).

**Recommendation:** **Option A (AWS SDK v3)** — It is the only option that supports per-part presigning for multipart (required by TD-05), runs on NestJS 11, and points unchanged at AWS S3 in production. Endpoint strategy: use **two client configurations from one `storage` config namespace**. The internal client (`S3_ENDPOINT=http://minio:9000`, the Compose service name per `CLAUDE.md`) runs server-side operations. A presign-only client (`S3_PUBLIC_ENDPOINT`, the address reachable by the HTTP client) signs every URL handed to callers outside the Docker network. The worker presigns with the internal endpoint (TD-09). The `S3_PUBLIC_ENDPOINT` is the only storage host that is not the service name, because it is consumed outside Docker.

**Decision:** A (AWS SDK v3 — internal endpoint for operations + public endpoint for presigning)
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

---

## TD-04: Bucket and Object Key Layout

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The API (upload initiation, streaming/download URLs) and the worker (reading the source, writing the thumbnail) must agree on bucket names and key conventions. Keys are persisted in the `videos` table, and the layout determines how access is controlled (TD-17) and how storage growth is managed (`docs/project-plan.md`, "Armazenamento").

**Options:**

### Option A: Single private bucket, keys grouped by video id
- One bucket (e.g., `streamtube-videos`) with no public policy. Keys: `videos/{videoId}/source` (original file) and `videos/{videoId}/thumbnail.jpg`. Every read goes through a presigned URL.
- **Pros:** One bucket to bootstrap and configure. All of a video's objects share a prefix — deleting or listing a video is one prefix operation. Access is uniformly controlled by the API via presigning. Keys use the immutable internal UUID, so they never change.
- **Cons:** Thumbnails also need presigned URLs (no CDN-friendly public URL yet).

### Option B: Two buckets — private videos, public-read thumbnails
- `streamtube-videos` (private) and `streamtube-thumbnails` (anonymous read policy).
- **Pros:** Thumbnails are cacheable public URLs, convenient for future listing pages.
- **Cons:** Two buckets to bootstrap and configure. A public thumbnail leaks the existence of draft/unpublished videos — this conflicts with Phase 04 visibility (public/unlisted, draft → publish), which is out of scope to design now.

### Option C: Single private bucket, keys grouped by channel
- Keys: `channels/{channelId}/videos/{videoId}/source` and `.../thumbnail.jpg`.
- **Pros:** Per-channel usage accounting by prefix.
- **Cons:** Longer keys; ownership is already in the DB (`videos.channel_id`), so the prefix duplicates relational data. No capability in Phase 03 needs per-channel storage accounting.

**Recommendation:** **Option A (single private bucket, `videos/{videoId}/…`)** — It is the simplest layout that serves every Phase 03 capability. It keeps all access decisions in the API (consistent with TD-13/TD-17), and it does not expose draft thumbnails publicly before Phase 04 defines visibility. The bucket is created by a one-shot `mc` bootstrap service in Compose (TD-02).

**Decision:** A (Single private bucket, keys grouped by video id)

---

## TD-05: Upload Protocol for Files up to 10GB

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** A 10GB upload must not hold API resources (memory, event loop, request time) while bytes are transferred. `docs/project-plan.md` also requires that the upload can **resume after a connection failure**. The protocol defines the handshake between the API and any client, both now (e2e tests, `api.http`) and later (frontend), so it is Cross-layer.

**Options:**

### Option A: Stream through the API to storage
- The client sends the file to a NestJS endpoint; the API pipes the request stream to S3 (multipart under the hood).
- **Pros:** Single endpoint, simple client; the API sees every byte (can validate on the fly).
- **Cons:** The API is in the data path for 10GB: a long-held connection and a socket for the whole transfer, bandwidth through the Node process, request timeouts. No resume — a dropped connection restarts from zero. This is the pattern `DESAFIO.md` lists as automatic failure.

### Option B: Single presigned PUT directly to storage
- The API returns one presigned `PutObject` URL; the client uploads the whole file directly to storage.
- **Pros:** API out of the data path; simplest direct-upload flow.
- **Cons:** S3 single `PutObject` is capped at **5 GB** — it cannot carry a 10GB file. No resume.

### Option C: Presigned multipart upload orchestrated by the API
- The API creates the multipart upload and returns presigned `UploadPart` URLs. The client PUTs each part directly to storage, then calls the API to complete (TD-06). The API can re-presign or list already-uploaded parts (`ListParts`) so an interrupted client resumes from the missing parts.
- **Pros:** API never touches file bytes — only small JSON requests. Supports up to 10,000 parts (well over 10GB). Native resume at part granularity. Same flow works against AWS S3 in production.
- **Cons:** More complex client (split file, PUT parts, collect `ETag`s, complete). Storage must expose `ETag` to the client (CORS `ExposeHeaders` for a browser client). More API endpoints (initiate, part URLs, complete, abort).

### Option D: tus resumable protocol (`@tus/server` + `@tus/s3-store`)
- Open resumable-upload protocol; a tus server receives chunks and writes them to S3.
- **Pros:** Standardized resume semantics; mature browser client (`tus-js-client`).
- **Cons:** The tus server is a Node process **in the data path** — every byte passes through it (it is the API unless a separate service is added). Adds a protocol and two libraries.

**Recommendation:** **Option C (presigned multipart orchestrated by the API)** — It is the only option that keeps the API completely out of the 10GB data path, works past the 5 GB single-PUT ceiling, and provides resume natively, all with the S3 SDK chosen in TD-03. The extra client complexity is the inherent cost of resumable direct uploads. Limits (part size, URL TTL, max size) are in TD-16; completion and trigger are in TD-06.

**Decision:** C (Presigned multipart upload orchestrated by the API)

---

## TD-06: Upload Completion and Processing Trigger

**Scope:** Cross-layer

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** After the parts are uploaded (TD-05), something must (1) finalize the multipart upload, (2) move the video out of the draft/upload state and (3) publish the processing job (TD-01). Who triggers this determines the client contract and how reliably every finished upload gets processed. Depends on TD-01 and TD-05.

**Options:**

### Option A: Client calls an API "complete" endpoint; the API completes and enqueues
- The client sends the collected part `ETag`s to `POST …/complete`. The API calls `CompleteMultipartUpload`, verifies the object (`HeadObject` size within limits — TD-16), transitions the video status (TD-14) and adds the job with `jobId = videoId`.
- **Pros:** Single, explicit, synchronous contract — the client learns immediately whether the upload was accepted. Works identically on MinIO and AWS S3. The API owns the status transition (business rule in the service layer). Fully testable via e2e.
- **Cons:** If the client never calls complete, the upload stays pending (handled by TD-16 cleanup). Enqueue and DB update are not atomic (mitigated by idempotent `jobId` and retrying `complete`).

### Option B: Storage event notification triggers processing
- MinIO bucket notification (`s3:ObjectCreated:CompleteMultipartUpload`) is published to a target (Redis/AMQP/webhook); a consumer enqueues the job. The client completes the multipart upload itself via a presigned complete URL.
- **Pros:** Processing starts even if the client disappears right after completing.
- **Cons:** Notification target configuration is MinIO-specific (production S3 uses S3 Event Notifications → SQS/EventBridge — a different mechanism). It needs an extra consumer plus webhook/target auth. The size check and status transition happen asynchronously, after the client has already been told "done". Harder to test deterministically.

**Recommendation:** **Option A (API `complete` endpoint completes the multipart upload and enqueues)** — It keeps the trigger inside the API's service layer with one storage-agnostic code path (MinIO locally, S3 in production). It gives the client a synchronous acceptance result and is straightforward to cover with e2e tests. Event notifications (B) would tie the pipeline to MinIO-specific configuration for no Phase 03 benefit.

**Decision:** A (Client calls an API "complete" endpoint; the API completes and enqueues)

---

## TD-07: Video Worker Runtime and Packaging

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture defines a separate "Video Worker" container that consumes jobs, reads/writes storage and updates the database. The worker needs the `Video` entity, the storage client (TD-03), the queue (TD-01) and FFmpeg (TD-08). Where its code lives and how it is started affects `compose.yaml`, the Dockerfile, the module structure and test setup.

**Options:**

### Option A: Same `nestjs-project` codebase, separate entrypoint and Compose service
- A second bootstrap file (e.g., `src/worker.ts`) starts a NestJS **standalone application** (`NestFactory.createApplicationContext(WorkerModule)`, no HTTP listener) that registers the BullMQ processor. A new Compose service runs it from the same image (with FFmpeg installed).
- **Pros:** Reuses entity, TypeORM config, storage/config modules, Joi validation and test tooling — no duplication. Independent process and container: a heavy FFmpeg job never blocks the API event loop, and workers scale separately. Matches the architecture diagram.
- **Cons:** Module boundaries must keep HTTP-only providers out of the worker module. The API image also carries FFmpeg unless a separate build target is added.

### Option B: Separate subproject (e.g., `video-worker/`) with its own package
- Independent project (Node or another language) with its own dependencies and Dockerfile.
- **Pros:** Hard isolation; minimal worker image.
- **Cons:** Duplicates the entity/DB access, config validation and S3 code, or requires a shared package (monorepo tooling not in place). The job/DB contract must be kept in sync across projects by hand. More CI/test infrastructure.

### Option C: Processor inside the API process
- The `@Processor` is registered in the API's `AppModule`; the same process serves HTTP and processes jobs.
- **Pros:** Simplest — no new container or entrypoint.
- **Cons:** CPU/IO-heavy FFmpeg work competes with request handling in the same container, against the "sem impacto na performance" requirement. Contradicts the separate Worker container in the architecture. Cannot scale workers independently.

**Recommendation:** **Option A (same codebase, standalone NestJS application context, own Compose service)** — It gives the process isolation the architecture requires while reusing every existing module and convention (config namespaces, TypeORM, Jest). That avoids the duplication and contract drift of a separate project. The API imports only the producer side (queue registration). The worker imports the consumer side and the processing services.

**Decision:** A (Same `nestjs-project` codebase, separate entrypoint and Compose service)

---

## TD-08: FFmpeg/ffprobe Integration

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker extracts duration/metadata (ffprobe) and renders a thumbnail frame (ffmpeg). The integration choice defines how binaries are installed in the image and how the worker invokes and parses them. Depends on TD-07.

**Options:**

### Option A: System FFmpeg from the OS package manager + direct `child_process` invocation
- Install `ffmpeg` (includes `ffprobe`) in the worker image via `apt`. A small service wraps `execFile`/`spawn` with explicit argument arrays; ffprobe runs with `-print_format json -show_format -show_streams` and the JSON is parsed into a typed result.
- **Pros:** No wrapper dependency; full control of arguments; machine-readable ffprobe JSON. Distro-maintained binaries with HTTP input support (needed by TD-09). Argument arrays (no shell) avoid injection.
- **Cons:** Small amount of glue code (process spawning, exit-code/stderr handling, timeouts). Binary version follows the base image's distro.

### Option B: `fluent-ffmpeg`
- Popular fluent wrapper around the ffmpeg/ffprobe binaries.
- **Pros:** Convenient API (`ffprobe()`, `screenshots()`); many examples.
- **Cons:** **Deprecated on npm** ("Package no longer supported") — no maintenance or security fixes. Still requires the system binaries anyway.

### Option C: Bundled static binaries (`ffmpeg-static` / `ffprobe-static`) + `child_process`
- npm packages download prebuilt static binaries into `node_modules`.
- **Pros:** Pinned binary version through `package.json`; no OS package step.
- **Cons:** Large downloads on `npm install`, platform-specific binaries inside a bind-mounted `node_modules` (host macOS vs container Linux mismatch risk), third-party builds.

**Recommendation:** **Option A (system FFmpeg + direct `child_process` with argument arrays)** — The only maintained wrapper option is deprecated (B). Bundled binaries (C) clash with the project's bind-mounted `node_modules` between the macOS host and the Linux container. Installing `ffmpeg` in the image is one Dockerfile line, and the typed wrapper is small and fully unit-testable.

**Decision:** A (System FFmpeg + direct `child_process` invocation)

---

## TD-09: Worker Access to the Source Video

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The source file can be up to 10GB. ffprobe usually reads only headers (plus the `moov` atom, which in MP4 may be at the end of the file), and a thumbnail needs one frame. How the worker gets bytes from storage determines disk usage, processing time and container volume requirements. Depends on TD-03 and TD-08.

**Options:**

### Option A: Download the whole object to a local temp file, then process
- `GetObject` streamed to a temp file in the worker container; ffprobe/ffmpeg run on the local path; the file is deleted afterward.
- **Pros:** Simplest and most robust for any container format (local seeking).
- **Cons:** Copies up to 10GB per job just to read headers and one frame — needs a large disk volume and minutes of transfer. Concurrent jobs multiply disk usage.

### Option B: ffprobe/ffmpeg read directly from a short-lived presigned GET URL
- The worker presigns a GET URL with the **internal** endpoint and passes it as the input to ffprobe/ffmpeg. FFmpeg's HTTP protocol uses `Range` requests to seek, fetching only the bytes it needs.
- **Pros:** No local copy — only headers, index and the frame's region are transferred. Constant disk usage regardless of video size. Storage supports Range natively.
- **Cons:** Many small range requests for files with unfavorable layout. Depends on FFmpeg's HTTP support (present in distro builds). Network errors surface as ffmpeg failures (handled by TD-15 retries).

### Option C: Pipe the object stream into ffmpeg's stdin
- `GetObject` body piped into `ffmpeg -i pipe:0`.
- **Pros:** No temp file.
- **Cons:** stdin is not seekable: MP4 files with the `moov` atom at the end fail or force reading the whole stream. To reach a frame near the middle, ffmpeg must read everything before it.

**Recommendation:** **Option B (direct read via internal presigned GET URL)** — Phase 03 only extracts metadata and one frame, so transferring the full 10GB (A) is pure overhead. Piping (C) breaks common MP4 layouts. HTTP Range reads keep the worker's disk and network cost proportional to what it actually reads.

**Decision:** B (ffprobe/ffmpeg read directly from a short-lived presigned GET URL)

---

## TD-10: Thumbnail Frame Selection and Image Format

**Scope:** Backend

**Capability:** Geração automática de thumbnail a partir de um frame do vídeo

**Context:** The worker must choose which frame becomes the thumbnail and how it is encoded. The output format fixes the thumbnail key/extension and `Content-Type` shared between the worker (writer) and the API (URL issuer) (TD-04). Depends on TD-08 and TD-11 (duration comes from ffprobe).

**Options:**

### Option A: Fixed timestamp (e.g., 1s, clamped to the duration)
- Seek to a constant offset and grab one frame.
- **Pros:** Simplest; deterministic; cheap.
- **Cons:** First seconds are often black frames, fades or title cards — poor thumbnails.

### Option B: Relative position (e.g., 10% of the duration from ffprobe)
- Seek to a fraction of the probed duration and grab one frame (fallback to the first frame for very short or duration-less files).
- **Pros:** Skips intros on most videos; still one seek + one decoded frame (cheap with TD-09 range reads); deterministic.
- **Cons:** Can still land on a dark or transition frame; needs the probed duration first.

### Option C: FFmpeg `thumbnail` filter over a window
- Decode a window of frames (e.g., ~100) after a seek and let the filter pick the most representative one.
- **Pros:** Best visual quality on average.
- **Cons:** Decodes many frames — noticeably more CPU and more bytes read per job; less deterministic for tests.

**Recommendation:** **Option B (frame at ~10% of the duration, encoded as JPEG with a bounded width preserving aspect ratio)** — Better than a fixed early timestamp at the same cost, and deterministic for tests. JPEG is universally renderable and is the conventional thumbnail format. The `thumbnail` filter (C) can be revisited in Phase 04, which introduces custom thumbnails.

**Decision:** B (Frame at ~10% of the duration, JPEG)

---

## TD-11: Video Metadata Persistence Shape

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** The worker writes the probed duration and metadata; the API exposes them (status/detail endpoint) and later phases display duration on cards (Phase 07). The shape is a contract between the worker, the API response and the migration. Depends on TD-08.

**Options:**

### Option A: Typed columns only
- Dedicated columns, e.g., `duration_seconds`, `width`, `height`, `video_codec`, `audio_codec`, `format_name`, `bit_rate`, `size_bytes`.
- **Pros:** Strongly typed, queryable, validated by the schema.
- **Cons:** Every new metadata field needs a migration; many nullable columns for audio-only or exotic files.

### Option B: Typed columns for what the domain uses + a curated JSONB `metadata`
- Typed `duration_seconds` and `size_bytes` (used by the domain and listings). A `metadata` JSONB stores a curated, typed subset of the ffprobe output (resolution, codecs, container, bitrate, frame rate).
- **Pros:** Duration and size are queryable and typed. Descriptive metadata can evolve without migrations. A TypeScript interface still types the JSONB content.
- **Cons:** JSONB fields are not constrained by the DB schema; queries on them are less ergonomic in TypeORM.

### Option C: Raw ffprobe JSON in a JSONB column
- Persist the full `ffprobe` output as-is.
- **Pros:** Lossless; zero mapping code.
- **Cons:** Large, tool-specific payload leaking into the domain model; duration must be extracted at read time; output shape varies by ffprobe version.

**Recommendation:** **Option B (typed `duration_seconds` + `size_bytes`, curated JSONB `metadata`)** — The capability names duration explicitly and future phases display it, so it deserves a typed column. The rest of "metadados" is descriptive and benefits from a flexible but curated JSONB, typed in code, without raw tool output in the domain.

**Decision:** B (Typed `duration_seconds` + `size_bytes`, curated JSONB `metadata`)

---

## TD-12: Unique Public Video Identifier (URL Strategy)

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** `docs/project-plan.md` asks for a "URL curta e única que nunca conflite com outro vídeo". The identifier appears in API routes now and in frontend URLs later, so its format is a cross-layer contract and a DB column with a unique constraint.

**Options:**

### Option A: Use the UUID primary key in the URL
- Routes use `videos.id` (UUID v4) directly.
- **Pros:** Zero extra code or column; collision-free by construction; follows existing entity conventions (UUID PKs).
- **Cons:** 36 characters — not "short". Exposes the internal PK as a public identifier.

### Option B: Random short public id (11-char base64url) from `node:crypto`, unique index + retry on collision
- A separate `public_id` column, generated from cryptographically random bytes (e.g., 8 bytes → 11 base64url chars, ~64 bits, YouTube-like). It has a `UNIQUE` index; on a unique-violation the service regenerates and retries (SAVEPOINT pattern from `.claude/rules/typeorm-queries.md`).
- **Pros:** Short, URL-safe, non-sequential (not enumerable). The DB constraint makes uniqueness absolute, and retry handles the negligible collision chance. No new dependency (`node:crypto`).
- **Cons:** Extra column and generation/retry logic. Two identifiers per video (internal UUID vs public id).

### Option C: Sqids/Hashids encoding of a sequential integer
- A sequential `bigint` column encoded into a short string with an alphabet (`sqids`).
- **Pros:** Very short; uniqueness inherited from the sequence; no retries.
- **Cons:** Reversible/enumerable — reveals creation order and total count, and with a known alphabet anyone can walk all videos (bad for future unlisted videos, Phase 04). Requires an extra sequence column alongside the UUID PK.

**Recommendation:** **Option B (random 11-char base64url `public_id` via `node:crypto`, DB-unique with retry)** — It is the only option that is both short and non-enumerable. Non-enumerability matters because Phase 04 introduces unlisted videos reachable "somente via link". The unique index guarantees "sem conflito" regardless of probability. Using `node:crypto` avoids `nanoid@6`, which is ESM-only and whose `engines` field (`^22 || ^24 || >=26`) excludes the container's Node 25.

**Decision:** B (Random 11-char base64url `public_id` from `node:crypto`, unique index + retry)

---

## TD-13: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Streaming requires HTTP Range support (`206 Partial Content`) so playback starts without downloading the whole file; download requires `Content-Disposition: attachment`. The architecture diagram already shows "Frontend → Object Storage: Streams". The choice decides whether video bytes pass through the API and what the client receives from the API (bytes vs a URL). Depends on TD-03, TD-04 and TD-17.

**Options:**

### Option A: API proxies bytes with Range support
- The API endpoint parses `Range`, calls `GetObject` with the same range, and pipes the body back with `206`, `Content-Range`, `Accept-Ranges`. A download variant sets `Content-Disposition: attachment`.
- **Pros:** Storage is never exposed to clients; authorization is checked on every byte request; stable URLs.
- **Cons:** All playback and download traffic (multi-GB) flows through the Node process — the same performance concern TD-05 avoids for uploads. Range parsing and header handling must be implemented and tested manually (NestJS 11 `StreamableFile` does not handle Range).

### Option B: API authorizes, then redirects (`302`) to a short-lived presigned GET URL
- The stream endpoint checks access (TD-17) and responds `302` to a presigned `GetObject` URL (public endpoint, TD-03). Storage serves `Range` → `206` natively. The download endpoint presigns with `ResponseContentDisposition=attachment; filename=…`.
- **Pros:** The API stays out of the data path for playback and download. Range/206, seeking and resumable downloads are handled by the storage server (and by S3/CDN in production). Matches the architecture diagram. Little code.
- **Cons:** Anyone holding the URL can use it until it expires (mitigated by short TTL). Clients must follow redirects. Storage endpoint must be reachable by clients (TD-03 public endpoint).

### Option C: Public-read bucket with permanent direct URLs
- Video objects are publicly readable; the API returns their plain URLs.
- **Pros:** Simplest; fully cacheable.
- **Cons:** No access control at all — drafts, failed and (future) unlisted videos would be downloadable by anyone who guesses or obtains the key. Conflicts with TD-04 and Phase 04 visibility.

**Recommendation:** **Option B (authorize in the API, `302` to a short-lived presigned GET; download variant with `ResponseContentDisposition=attachment`)** — It satisfies streaming via native Range/206 in storage and keeps multi-GB reads out of the API, mirroring the upload decision (TD-05) and the diagram. Access control stays in the API at URL-issuing time. A short TTL bounds URL sharing, an acceptable trade-off since Phase 05 will make watching anonymous anyway.

**Decision:** B (Authorize in the API, `302` to a short-lived presigned GET; attachment variant for download)

---

## TD-14: Video Status Lifecycle

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** The video row is created when the upload starts (draft), and moves through processing to a terminal state. The status set is persisted as a PostgreSQL enum and is read by the API (what can be streamed, TD-17) and written by the worker. `DESAFIO.md` illustrates `rascunho → processando → pronto/erro`. Phase 04 later introduces "Fluxo de rascunho → publicação", so the meaning of "draft" must not be painted into a corner. Depends on TD-06.

**Options:**

### Option A: Single 4-state enum `draft → processing → ready | failed`
- `draft`: pre-registered at upload start, upload in progress. `processing`: set by the API on successful `complete` (TD-06), before enqueueing. `ready` / `failed`: set by the worker. Transitions are conditional updates (`WHERE status = <expected>`), so duplicate jobs are no-ops.
- **Pros:** Literal match to the capability and `DESAFIO.md`; minimal state machine; easy to reason about and test.
- **Cons:** `draft` here means "upload not yet completed". When Phase 04 adds publication (draft → published), that concept must be modeled as a separate field (or this enum revisited), otherwise "draft" carries two meanings.

### Option B: 5-state enum with an explicit queued state `draft → uploaded → processing → ready | failed`
- `uploaded` is set on `complete`; the worker moves it to `processing` when it actually starts.
- **Pros:** Distinguishes "waiting in queue" from "being processed" — useful for operational visibility.
- **Cons:** One more state and transition to maintain; the distinction has no consumer in Phase 03 (no UI, no SLA).

### Option C: Two orthogonal fields — upload/processing status + draft/publication flag
- `processing_status` (`uploading | processing | ready | failed`) plus a separate draft/publication field defaulting to draft.
- **Pros:** Cleanly separates technical processing from editorial publication, anticipating Phase 04.
- **Cons:** Introduces the publication concept now, though "Fluxo de rascunho → publicação" belongs to Phase 04 — designing it here is out of scope.

**Recommendation:** **Option A (`draft → processing → ready | failed`)** — It covers both capabilities with the smallest state machine and matches the challenge's stated lifecycle. Conditional transitions make worker retries idempotent (TD-15). The Phase 04 interplay is noted explicitly so that phase can decide how to model publication, without speculating about it in Phase 03.

**Decision:** A (`draft → processing → ready | failed`)

---

## TD-15: Processing Failure, Retries and Idempotency

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Processing can fail transiently (storage/network hiccup, worker restart) or permanently (corrupted or non-video file). The policy defines queue job options, which failures set `failed` (TD-14), what is recorded for diagnosis, and how duplicate deliveries behave. Depends on TD-01 and TD-14.

**Options:**

### Option A: Queue-native retries with exponential backoff; permanent errors fail fast; `failed` only after the final attempt
- Jobs are added with `jobId = videoId`, a small `attempts` count and exponential `backoff`. Invalid-media errors (ffprobe finds no video stream / cannot parse) are thrown as unrecoverable (no retry). The video is marked `failed` with a short `failure_reason` only on the last attempt or on an unrecoverable error. Every worker step is idempotent (deterministic thumbnail key, conditional status updates).
- **Pros:** Transient failures self-heal; corrupt uploads fail immediately with a clear reason; duplicate enqueues are deduplicated by `jobId`. Uses features native to TD-01 Option A.
- **Cons:** Requires classifying errors as transient vs permanent; failed jobs need a retention policy in the queue.

### Option B: No retries — first failure marks the video `failed`
- `attempts: 1`; any error → `failed`.
- **Pros:** Simplest; failures are immediately visible.
- **Cons:** A transient storage blip or worker restart permanently fails a valid 10GB upload, and Phase 03 offers no way to re-trigger processing.

### Option C: Retries + dead-letter queue + manual reprocess endpoint
- Like A, plus failed jobs moved to a DLQ and an owner/admin endpoint to reprocess.
- **Pros:** Full operational recovery path.
- **Cons:** A reprocess endpoint and DLQ handling are not required by any Phase 03 capability — scope creep.

**Recommendation:** **Option A (native retries with exponential backoff, unrecoverable errors for invalid media, `failed` + reason on final failure, `jobId = videoId`)** — It gives resilient processing for transient issues and fast, explained failure for bad files, using only queue features already chosen. A DLQ/reprocess flow (C) has no capability behind it in this phase.

**Decision:** A (Queue-native retries with exponential backoff; unrecoverable errors for invalid media; `failed` only after the final attempt)

---

## TD-16: Upload Limits, URL Expiration and Abandoned Uploads

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The 10GB ceiling must be enforced even though bytes never pass through the API (TD-05). Part size and presigned URL TTL are shared between the API config and the client contract. Abandoned multipart uploads consume storage (`docs/project-plan.md`, "Armazenamento"). MinIO does not support the `AbortIncompleteMultipartUpload` lifecycle rule, but expires stale uploads natively (`MINIO_API_STALE_UPLOADS_EXPIRY`, default 24h). Depends on TD-05 and TD-06.

**Options:**

### Option A: Validate at both ends + storage-native cleanup
- **Initiate:** the client declares `size` (and content type). The API rejects `size > 10GB` or non-video types, then computes the part count from a fixed part size (e.g., 100 MiB → ~103 parts for 10GB, far below 10,000). **Complete:** after `CompleteMultipartUpload`, `HeadObject` confirms the real size matches the declared size and is ≤ 10GB; otherwise the object is deleted and the request rejected. Part URLs are short-lived and re-issuable (resume). Abandoned multipart uploads are reclaimed by storage: MinIO's stale-upload expiry locally, the S3 `AbortIncompleteMultipartUpload` lifecycle rule in production.
- **Pros:** The limit holds even if the client lies about size. No application cron. Uses each storage's native mechanism.
- **Cons:** Draft rows of abandoned uploads remain in the DB (no storage cost; can be cleaned in a later phase); cleanup configuration differs per environment (env var locally vs bucket lifecycle in AWS).

### Option B: Validate at both ends + application-level sweeper job
- Same validation as A, plus a repeatable queue job that finds drafts older than a TTL, aborts their multipart uploads and marks them `failed`/deletes them.
- **Pros:** Storage-agnostic cleanup; DB and storage stay consistent.
- **Cons:** Extra scheduled job, queries and tests; duplicates what storage already does for the bytes; lifecycle of abandoned draft rows is a product decision not specified in Phase 03.

### Option C: Validate only at initiate
- Trust the declared size; rely on presigned part count to bound the upload.
- **Pros:** Simplest.
- **Cons:** A client can upload larger parts than declared (parts can be up to 5 GiB), bypassing the 10GB limit.

**Recommendation:** **Option A (declared-size validation at initiate + real-size verification at complete + storage-native cleanup of incomplete multipart uploads)** — It enforces the 10GB requirement robustly without placing the API in the data path, and reclaims abandoned bytes with zero application code. The sweeper (B) solves a row-cleanup problem no Phase 03 capability asks for.

**Decision:** A (Validate at initiate and at complete + storage-native cleanup)

**Revisions:**
- 2026-10-25 — Initiate payload fixed: the client sends `title` (required), `filename`, `size` and `contentType`; the draft row is created with the title, and title editing remains a Phase 04 capability. Rationale: pre-registration payload clarified (resolves phase-03-videos validation AMB-1).
- 2026-10-25 — Accepted formats fixed as an allowlist checked at initiate: `.mp4` (`video/mp4`), `.mov` (`video/quicktime`), `.mpg` / `.mpeg` (`video/mpeg`), `.avi` (`video/x-msvideo`); a file whose extension or declared MIME type is outside the list is rejected. ffprobe in the worker remains the definitive content check (invalid media → `failed`, per TD-15). Rationale: acceptance policy tightened (resolves phase-03-videos validation AMB-2).

---

## TD-17: Access Rules for Upload, Status, Streaming and Download

**Scope:** Backend

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The global JWT guard protects every endpoint by default (`@Public()` opts out — `.claude/rules/nestjs-controllers.md`). Each user owns exactly one channel, and videos belong to a channel. Who may watch or download depends on the video's status. Anonymous watching is a Phase 05 capability ("Acesso anônimo à visualização de vídeos"), and publication/visibility are Phase 04. This drives the Authorization Matrix and which handlers carry `@Public()`. Depends on TD-14.

**Options:**

### Option A: Owner-only in Phase 03
- Upload (initiate/parts/complete/abort) and status/detail, stream and download: authenticated **owner of the video's channel** only. Non-owners get `404` (no existence leak).
- **Pros:** Secure by default; no draft or unpublished video is reachable by others before Phase 04 defines publication and Phase 05 opens anonymous access. Simple, testable matrix.
- **Cons:** Phase 05 must relax stream/download (add `@Public()` + status/visibility checks).

### Option B: Owner for upload/management; anyone (anonymous) can stream/download `ready` videos by `public_id`
- Upload and status remain owner-only; stream/download are `@Public()` for `ready` videos.
- **Pros:** "Usuários anônimos podem assistir livremente" works already; shareable unique URLs (TD-12) are immediately usable.
- **Cons:** Every processed video becomes publicly watchable while Phase 04's draft → publish flow and visibility don't exist yet — Phase 04 would have to *restrict* access retroactively. Anonymous access is explicitly a Phase 05 capability.

### Option C: Any authenticated user can stream/download `ready` videos
- Middle ground: login required, no ownership check for playback.
- **Pros:** Exercises multi-user playback.
- **Cons:** Same premature-exposure problem as B; matches no capability bullet.

**Recommendation:** **Option A (owner-only for all Phase 03 endpoints, `404` for non-owners)** — It satisfies every Phase 03 capability (the uploader can stream and download their own video) without pre-empting Phase 04's publication/visibility rules or Phase 05's anonymous access. Relaxing access later is additive (`@Public()` + checks), while restricting already-public videos would be a breaking change.

**Decision:** A (Owner-only in Phase 03, `404` for non-owners)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Queue Technology for Background Processing | A (BullMQ + Redis via `@nestjs/bullmq@11.x`) | A |
| TD-02 | Repo-wide | Local S3-Compatible Storage Server Image | A (`pgsty/minio` pinned + `pgsty/mc` bootstrap) | A |
| TD-03 | Backend | S3 Client Library and Endpoint Strategy | A (AWS SDK v3; internal endpoint + public presign endpoint) | A |
| TD-04 | Backend | Bucket and Object Key Layout | A (single private bucket, `videos/{videoId}/…`) | A |
| TD-05 | Cross-layer | Upload Protocol for Files up to 10GB | C (presigned multipart orchestrated by the API) | C |
| TD-06 | Cross-layer | Upload Completion and Processing Trigger | A (API `complete` endpoint completes + enqueues) | A |
| TD-07 | Backend | Video Worker Runtime and Packaging | A (same codebase, standalone app context, own Compose service) | A |
| TD-08 | Backend | FFmpeg/ffprobe Integration | A (system FFmpeg + `child_process` argument arrays) | A |
| TD-09 | Backend | Worker Access to the Source Video | B (read via internal presigned GET URL with Range) | B |
| TD-10 | Backend | Thumbnail Frame Selection and Image Format | B (frame at ~10% of duration, JPEG) | B |
| TD-11 | Backend | Video Metadata Persistence Shape | B (typed duration/size + curated JSONB) | B |
| TD-12 | Cross-layer | Unique Public Video Identifier (URL Strategy) | B (11-char base64url `public_id`, unique + retry) | B |
| TD-13 | Cross-layer | Streaming and Download Delivery | B (authorize + `302` to presigned GET; attachment variant) | B |
| TD-14 | Backend | Video Status Lifecycle | A (`draft → processing → ready \| failed`) | A |
| TD-15 | Backend | Processing Failure, Retries and Idempotency | A (native retries + backoff, unrecoverable for invalid media) | A |
| TD-16 | Backend | Upload Limits, URL Expiration and Abandoned Uploads | A (validate at initiate and complete + storage-native cleanup) | A |
| TD-17 | Backend | Access Rules for Upload, Status, Streaming and Download | A (owner-only in Phase 03, `404` for non-owners) | A |
