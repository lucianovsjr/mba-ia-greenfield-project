---
libs:
  "bullmq":
    version: "^5.81.5"
    context7_id: "/websites/bullmq_io"
    fetched_at: "2026-10-25T21:36:38-03:00"
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-10-25T21:36:38-03:00"
  "@aws-sdk/client-s3":
    version: "^3.1156.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-25T21:36:38-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1156.0"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-10-25T21:36:38-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T21:35:32-03:00"
---

# Library References

Library documentation cache for the libraries decided in this scope, distilled from Context7 for the surfaces the TDs use. Installed stack it must stay compatible with: NestJS 11.1.16 (CommonJS output, `module: nodenext`), Node 25.6.0, Jest 30 + ts-jest (CJS).

## Version pinning notes

- **`@nestjs/bullmq` pinned to `^11.0.5`** (CJS, peers `@nestjs/core ^10 || ^11`, `bullmq ^3 || ^4 || ^5 || ^6`). `@nestjs/bullmq@12` is ESM-only and also accepts NestJS 12; it must not be used while the project is on NestJS 11 + ts-jest CJS (per `phase-03-videos/TD-01`).
- **`bullmq` pinned to `^5.81.5`** (CJS, `main: ./dist/cjs/index.js`). It ships `ioredis` 5 as a regular dependency, so no Redis client needs to be installed separately. `bullmq@6` (first published 2026-07-30) moved the Redis client to a peer dependency (`ioredis >=5` / `redis >=5`). The 5.x line keeps the dependency surface to one package.
- **`@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` pinned to `^3.1156.0`** (CJS, `main: ./dist-cjs/index.js`, Node ≥ 20). Keep both packages on the same version.
- **Doc/version discrepancy flagged:** Context7's BullMQ library (`/websites/bullmq_io`) tracks the current docs site (v6 era). The APIs used here (`Queue.add` options `jobId` / `attempts` / `backoff` / `removeOnComplete` / `removeOnFail`, `Worker`, `UnrecoverableError`, `connection`) exist unchanged in 5.x. Cross-check any newer API against the 5.x typings before use.

### bullmq

Used by `phase-03-videos/TD-01` (queue) and `phase-03-videos/TD-15` (retries, idempotency).

- **Adding a job with retries + exponential backoff** — retry delay is `2^(attempts-1) * delay` ms:

  ```typescript
  await queue.add(
    'test-retry',
    { foo: 'bar' },
    { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
  );
  ```

- **Retention** — `removeOnComplete: true` removes completed jobs; `removeOnFail: 1000` keeps the last 1000 failed jobs:

  ```typescript
  await myQueue.add('wall', { color: 'pink' }, { removeOnComplete: true, removeOnFail: 1000 });
  ```

- **Custom job id** — passing `jobId` in the job options makes the id deterministic; adding a job whose `jobId` already exists in the queue is ignored (dedup for `jobId = videoId`, per TD-15).

- **Stop retrying (permanent failures)** — throwing `UnrecoverableError` moves the job straight to the failed set, overriding `attempts`:

  ```typescript
  import { Worker, UnrecoverableError } from 'bullmq';

  const worker = new Worker('foo', async (job) => {
    throw new UnrecoverableError('Unrecoverable');
  }, { connection });
  ```

- **Connection** — ioredis-compatible options; without options BullMQ defaults to `localhost:6379`, so the Compose service name must always be passed (per root `CLAUDE.md`, never `localhost`):

  ```typescript
  const myQueue = new Queue('myqueue', { connection: { host: 'redis', port: 6379 } });
  ```

### @nestjs/bullmq

Used by `phase-03-videos/TD-01` (NestJS integration) and `phase-03-videos/TD-07` (API = producer, worker = consumer).

- **Shared connection config (async, from a config namespace)** — `BullModule.forRootAsync` registers a global module; `useFactory` receives the injected providers:

  ```typescript
  import { BullModule } from '@nestjs/bullmq';

  @Module({
    imports: [
      BullModule.forRootAsync({
        useFactory: (config: ConfigService) => ({ connection: config.getRedisConnection() }),
        inject: [ConfigService],
      }),
    ],
  })
  export class AppModule {}
  ```

  Inject the project's `registerAs` namespace via `inject: [queueConfig.KEY]` + `ConfigType<typeof queueConfig>` (inherited convention). Per `.claude/rules/nestjs-testing.md`, test modules for `forRootAsync` need `ConfigModule.forRoot({ isGlobal: true, load: [...] })`.

- **Queue registration** — `BullModule.registerQueue({ name, defaultJobOptions })` in the owning module; providers close workers/queue on `onApplicationShutdown`:

  ```typescript
  BullModule.registerQueue({ name: 'image-optimize', defaultJobOptions: { attempts: 2 } })
  ```

- **Producer** — `@InjectQueue(name)` resolves token `BullQueue_<name>`:

  ```typescript
  constructor(@InjectQueue('audio') private readonly audioQueue: Queue) {}
  await this.audioQueue.add('transcode', { file });
  ```

- **Consumer** — a class extending `WorkerHost` decorated with `@Processor(queueName, workerOptions?)`; `process(job)` returns a promise. Worker options such as `concurrency` go in the second argument:

  ```typescript
  @Processor('audio', { concurrency: 5 })
  export class AudioConsumer extends WorkerHost {
    async process(job: Job<{ file: string }>): Promise<any> {
      return transcode(job.data.file);
    }
  }
  ```

  Per TD-07, only the worker's module registers the `@Processor` class; the API module registers the queue (producer side) only.

### @aws-sdk/client-s3

Used by `phase-03-videos/TD-03` (client + endpoints), `TD-04` (keys), `TD-05` (multipart), `TD-06` (complete), `TD-16` (size check).

- **MinIO-compatible client** — custom `endpoint` + `forcePathStyle: true` (bucket in the path, `host/bucket/key`), explicit `region` and `credentials`:

  ```typescript
  const client = new S3Client({
    endpoint: 'http://minio:9000',
    forcePathStyle: true,
    region: 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
  });
  ```

- **Reuse one client instance** per credentials/region across commands (SDK effective practice). Per TD-03, there are two instances from the same `storage` namespace: the internal one (`S3_ENDPOINT`) for operations and the presign-only one (`S3_PUBLIC_ENDPOINT`).

- **Multipart commands** (TD-05/TD-06/TD-16): `CreateMultipartUploadCommand({ Bucket, Key })` → `UploadId`. Then `UploadPartCommand({ Bucket, Key, UploadId, PartNumber, Body })` → `ETag` for each part, followed by `CompleteMultipartUploadCommand` with the collected `{ PartNumber, ETag }` list. Also used: `ListPartsCommand` (resume), `AbortMultipartUploadCommand`, `HeadObjectCommand` (real size → `ContentLength`) and `PutObjectCommand` (thumbnail upload by the worker).

- **ETag must be readable by the uploader** — a part response without `ETag` usually means the bucket CORS config does not expose the header ("Missing Bucket CORS configuration for ETag header?"). Browser clients need `ExposeHeaders: ETag`.

### @aws-sdk/s3-request-presigner

Used by `phase-03-videos/TD-05` (part URLs), `TD-09` (worker GET URL), `TD-13` (stream/download URLs).

- **Presign any command** — `getSignedUrl(client, command, { expiresIn })`; `expiresIn` defaults to **900 s** when omitted:

  ```typescript
  import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
  import { GetObjectCommand } from '@aws-sdk/client-s3';

  const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });
  ```

  The same call presigns `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` for direct part uploads.

- **Download as attachment** — `GetObjectCommand({ Bucket, Key, ResponseContentDisposition: 'attachment; filename="…"' })` sets the `Content-Disposition` response header via the signed `response-content-disposition` query parameter. Response-header overrides only work on signed requests (presigned URL or Authorization header).

- **Signing extra headers** — `signableHeaders: new Set(['content-type'])` forces standard headers into the signature when the uploader must send a fixed `Content-Type`.

- **Host is part of the signature** — the URL must be generated by the client whose `endpoint` is the host the caller will hit (TD-03 public vs. internal endpoint); rewriting the host afterwards invalidates the signature.
