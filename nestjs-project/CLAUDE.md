# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, storage, queue, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO:** `curl -fs http://localhost:9000/minio/health/live` — expect exit code 0
- **Bucket:** `docker compose ps -a minio-init` — expect `Exited (0)` (one-shot job that creates the `S3_BUCKET` bucket; it is not a long-running service)

`docker compose up -d` also starts `video-worker`, which runs the worker in watch mode — see "Videos" below.

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `video-worker` — video processing worker (same image and code as `nestjs-api`, runs `npm run start:worker:dev`)
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP `1025`, web UI `8025`
- `minio` — S3-compatible object storage (`pgsty/minio`), API `9000`, console `9001`, credentials `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`
- `minio-init` — one-shot `mc` job that creates the `S3_BUCKET` bucket, then exits
- `redis` — Redis 8, port `6379`, backend of the BullMQ queue

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Verify Redis and MinIO
docker compose exec redis redis-cli ping
curl -fs http://localhost:9000/minio/health/live

# Check container logs
docker compose logs nestjs-api
docker compose logs video-worker
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker                     # Video worker (src/worker.ts)
npm run start:worker:dev                 # Video worker with hot-reload (what video-worker runs)
npm run start:worker:prod                # Run compiled worker (dist/worker.js)
npm run openapi:export                   # Regenerate openapi.json

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `start:worker*`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `setupFiles` also loads `src/test/setup-env.ts` (after `dotenv/config`), which forces `QUEUE_PREFIX=test` so the running `video-worker` (prefix `bull`) never consumes jobs published by tests.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module
- Two entrypoints share the code: `src/main.ts` (HTTP API, `AppModule`) and `src/worker.ts` (standalone application context, `WorkerModule`, no HTTP server)

## Videos (upload and processing)

Modules:

- `src/storage/` — `StorageModule`: S3 SDK wrapper (`StorageService`) with two clients — one on `S3_ENDPOINT` for server-side calls and one on `S3_PUBLIC_ENDPOINT` for presigning URLs used by HTTP clients
- `src/queue/` — `QueueModule`: BullMQ connection to Redis (`REDIS_HOST`/`REDIS_PORT`, key prefix `QUEUE_PREFIX`)
- `src/media/` — `MediaModule`: `ffprobe` (`MediaProbeService`) and `ffmpeg` (`ThumbnailService`) wrappers over `child_process` (binaries installed in `Dockerfile.dev`)
- `src/videos/` — `VideosModule`: `Video` entity (linked to `Channel`), controller, service, and `processing/` (job producer, processor, `VideoProcessingService`)
- `src/worker.ts` + `src/worker.module.ts` — worker entrypoint; registers the `video-processing` queue processor

Endpoints — all require authentication and are **owner-only** (non-owners get `404 VIDEO_NOT_FOUND`):

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/videos` | Create the draft video and start the S3 multipart upload |
| `POST` | `/videos/:publicId/upload/part-urls` | Presigned `PUT` URLs for upload parts |
| `GET` | `/videos/:publicId/upload/parts` | List uploaded parts (resume an upload) |
| `POST` | `/videos/:publicId/upload/complete` | Complete the multipart upload and enqueue processing |
| `DELETE` | `/videos/:publicId/upload` | Abort the upload and delete the draft |
| `GET` | `/videos/:publicId` | Video data and processing status |
| `GET` | `/videos/:publicId/stream` | `302` to a presigned URL (storage serves `Range`/`206`) |
| `GET` | `/videos/:publicId/download` | `302` to a presigned URL with `Content-Disposition: attachment` |
| `GET` | `/videos/:publicId/thumbnail` | `302` to a presigned thumbnail URL |

Flow: the client uploads parts **directly to storage** through presigned URLs — video bytes never pass through the API. On `complete`, the API publishes a `process-video` job (`jobId` = video id, 3 attempts with exponential backoff). The worker probes the source with `ffprobe`, extracts a JPEG thumbnail with `ffmpeg`, uploads it and stores the metadata.

Status lifecycle (`videos.status`): `draft` → `processing` → `ready` | `failed`. `failed` records `failure_reason`: `INVALID_MEDIA` (ffprobe rejected the file; not retried) or `PROCESSING_FAILED` (retries exhausted). Stream, download and thumbnail answer `409 VIDEO_NOT_READY` until `ready`.

Storage keys: `videos/{id}/source` and `videos/{id}/thumbnail.jpg` in the `S3_BUCKET` bucket.

Environment variables added in this phase (see `.env.example`):

- Storage: `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`
- Queue: `REDIS_HOST`, `REDIS_PORT`, `QUEUE_PREFIX`
- Videos: `VIDEO_MAX_SIZE_BYTES` (10 GiB), `UPLOAD_PART_SIZE_BYTES`, `UPLOAD_PART_URL_TTL_SECONDS`, `PLAYBACK_URL_TTL_SECONDS`

**Exception to the service-name rule:** `S3_PUBLIC_ENDPOINT` is `http://localhost:9000` on purpose. It only signs presigned URLs that HTTP clients outside the Docker network (browser, `curl`, `api.http`) call; the URL host is part of the signature, so it must be the address those clients reach. Every server-side call uses `S3_ENDPOINT=http://minio:9000`.

The worker runs `nest start --watch` on the same `dist/` as `nestjs-api`'s `start:dev`; running both in watch mode at the same time can make one delete the other's build output on restart.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
