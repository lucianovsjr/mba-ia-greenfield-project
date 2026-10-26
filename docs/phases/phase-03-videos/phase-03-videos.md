---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-25T21:37:18-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-10-25T21:37:08-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T21:35:32-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Deliver video upload of files up to 10GB directly to object storage without impacting API performance, with automatic draft pre-registration at upload start, background processing in a queue-driven worker (duration/metadata extraction and automatic thumbnail generation), a unique conflict-free URL per video, and streaming and download — the backend foundation (storage, queue and worker running in Docker Compose) for every later video phase.

---

## Step Implementations

### SI-03.1 — Infra: dependências, namespaces de configuração e serviços no Docker Compose

**Description:** Instala as libs da fase, cria os namespaces de configuração de storage, fila e vídeos, e sobe no Compose a infraestrutura real (MinIO, criação do bucket, Redis), além do FFmpeg na imagem — base para todos os SIs seguintes.

**Technical actions:**

1. Instalar em `nestjs-project`: `bullmq@^5.81.5`, `@nestjs/bullmq@^11.0.5`, `@aws-sdk/client-s3@^3.1156.0`, `@aws-sdk/s3-request-presigner@^3.1156.0` (versões fixadas em `library-refs.md`; per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`)
2. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` lendo `S3_ENDPOINT` (default `'http://minio:9000'`), `S3_PUBLIC_ENDPOINT` (default `'http://localhost:9000'`), `S3_REGION` (default `'us-east-1'`), `S3_ACCESS_KEY` (obrigatório), `S3_SECRET_KEY` (obrigatório), `S3_BUCKET` (default `'streamtube-videos'`); `src/config/queue.config.ts` — `registerAs('queue', ...)` com `REDIS_HOST` (default `'redis'`) e `REDIS_PORT` (default `6379`); `src/config/videos.config.ts` — `registerAs('videos', ...)` com `VIDEO_MAX_SIZE_BYTES` (default `10737418240`), `UPLOAD_PART_SIZE_BYTES` (default `104857600`), `UPLOAD_PART_URL_TTL_SECONDS` (default `3600`), `PLAYBACK_URL_TTL_SECONDS` (default `900`). Carregar os três no `ConfigModule.forRoot` do `AppModule` (per `phase-01-configuracao-base/TD-03`, `phase-03-videos/TD-03`, `phase-03-videos/TD-16`)
3. Estender `src/config/env.validation.ts` (Joi) com todas as novas variáveis e atualizar `.env.example` com valores compatíveis com o Compose, incluindo `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (iguais a `S3_ACCESS_KEY` / `S3_SECRET_KEY` localmente). `S3_PUBLIC_ENDPOINT` é a única exceção à regra de nome de serviço, por ser consumido fora da rede Docker (per `phase-03-videos/TD-03`)
4. Adicionar ao `nestjs-project/compose.yaml`: `minio` (`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, `server /data --console-address ":9001"`, portas `9000`/`9001`, volume nomeado, healthcheck), `minio-init` (`pgsty/mc` com tag fixada; cria o bucket com `mc mb --ignore-existing` e encerra), `redis` (`redis:8-alpine`, healthcheck `redis-cli ping`). `nestjs-api` passa a depender de `redis` (healthy) e `minio-init` (completed successfully) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-04`)
5. Instalar `ffmpeg` (inclui `ffprobe`) via `apt` no `Dockerfile.dev` (per `phase-03-videos/TD-08`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: novas variáveis obrigatórias e defaults | `src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `minio`, `redis` e `nestjs-api`; `minio-init` encerra com código 0 e o bucket `streamtube-videos` existe (`mc ls`)
- Rodar `minio-init` novamente não falha (criação do bucket é idempotente)
- `docker compose exec redis redis-cli ping` responde `PONG`
- `docker compose exec nestjs-api ffprobe -version` e `ffmpeg -version` saem com código 0
- Subir a aplicação sem `S3_ACCESS_KEY` gera erro de validação Joi no bootstrap e a aplicação não inicia
- O e2e existente (`GET /` retorna 200) continua passando com as novas variáveis

---

### SI-03.2 — Módulo de storage S3 (cliente interno + cliente de presign)

**Description:** Encapsula todo acesso ao object storage em um `StorageService` reutilizável pela API e pelo worker, com o par de clientes S3 (endpoint interno para operações, endpoint público para assinar URLs) definido na TD-03.

**Technical actions:**

1. Criar `src/storage/storage.constants.ts` (tokens `STORAGE_S3_CLIENT` e `STORAGE_PRESIGN_CLIENT`, `as const`) e `src/storage/storage.module.ts` — dois providers `useFactory` que constroem `S3Client` a partir de `storageConfig` (`endpoint` = `S3_ENDPOINT` ou `S3_PUBLIC_ENDPOINT`, `forcePathStyle: true`, `region`, `credentials`); exporta `StorageService` (per `phase-03-videos/TD-03`; API conforme `library-refs.md` → @aws-sdk/client-s3)
2. Criar `src/storage/storage.service.ts` com: `createMultipartUpload(key, contentType)`, `presignUploadPart(key, uploadId, partNumber, expiresIn)` (cliente de presign), `listParts(key, uploadId)`, `completeMultipartUpload(key, uploadId, parts)`, `abortMultipartUpload(key, uploadId)`, `headObject(key)` (retorna `ContentLength`), `putObject(key, body, contentType)`, `deleteObject(key)` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`, `phase-03-videos/TD-16`)
3. Adicionar `presignGetObject(key, { expiresIn, endpoint: 'public' | 'internal', responseContentType?, responseContentDisposition? })` usando `getSignedUrl` — `'public'` para stream/download/thumbnail, `'internal'` para o worker (per `phase-03-videos/TD-09`, `phase-03-videos/TD-13`; API conforme `library-refs.md` → @aws-sdk/s3-request-presigner)
4. Traduzir as rejeições de `CompleteMultipartUpload` (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`, `NoSuchUpload`) em um erro tipado de infraestrutura `StoragePartsRejectedError` (`src/storage/storage.errors.ts`); demais erros propagam sem alteração (`.claude/rules/nestjs-services.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageModule` | Unit: compilation test (factories + `storageConfig`) | `src/storage/storage.module.spec.ts` |
| `StorageService` | Integration: multipart real no MinIO (presign de partes, upload via `fetch`, list/complete/head/abort), presigned GET com `Range`, disposition e erro tipado | `src/storage/storage.service.integration-spec.ts` |

**Dependencies:** SI-03.1 — MinIO, bucket e `storageConfig` precisam existir

**Acceptance criteria:**

- Um multipart de 2 partes (5 MiB + 1 KiB) enviado pelas URLs de `presignUploadPart` é concluído e `headObject` reporta o tamanho total
- `listParts` retorna `PartNumber` + `ETag` das partes já enviadas antes do complete
- Requisição com `Range: bytes=0-99` a uma URL de `presignGetObject` retorna `206` com exatamente 100 bytes
- A resposta de uma URL com `responseContentDisposition` traz o header `Content-Disposition` informado
- `completeMultipartUpload` com um `ETag` incorreto lança `StoragePartsRejectedError`
- Após `abortMultipartUpload`, `listParts` do mesmo `uploadId` falha com `NoSuchUpload`
- URLs geradas com `endpoint: 'public'` têm o host de `S3_PUBLIC_ENDPOINT`; com `'internal'`, o host de `S3_ENDPOINT`

---

### SI-03.3 — Entidade Video, migration e VideosModule

**Description:** Cria a tabela `videos` ligada ao canal, com status, chaves de storage, duração, metadados e o identificador público, conforme o Data Model.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` — `@Entity('videos')` com todas as colunas do Data Model (`public_id`, `channel_id`, `title`, `status`, `original_filename`, `content_type`, `size_bytes`, `upload_id`, `source_key`, `thumbnail_key`, `duration_seconds`, `metadata`, `failure_reason`, timestamps); `VideoStatus` e `VideoMetadata` em `src/videos/videos.types.ts`; `size_bytes` com transformer bigint ↔ number (per `phase-03-videos/TD-11`, `phase-03-videos/TD-12`, `phase-03-videos/TD-14`)
2. Declarar `@ManyToOne(() => Channel, (channel) => channel.videos, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'channel_id' })` em `Video` e o lado inverso `@OneToMany(() => Video, (video) => video.channel)` em `src/channels/entities/channel.entity.ts` (`.claude/rules/nestjs-entities.md`)
3. Gerar `src/database/migrations/<timestamp>-CreateVideos.ts` via `npm run migration:generate -- src/database/migrations/CreateVideos` e revisar o SQL (enum `videos_status_enum`, unique em `public_id`, índice em `channel_id`, FK com cascade) (`.claude/rules/typeorm-migrations.md`)
4. Criar `src/videos/videos.module.ts` com `TypeOrmModule.forFeature([Video])` e registrá-lo no `AppModule`; incluir `Video` nos arrays explícitos de entidades e a nova migration nos imports do `src/test/create-test-data-source.ts` e do `src/database/migrations.integration-spec.ts`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: unique `public_id`, default `status = 'draft'`, enum rejeita valor inválido, cascade ao remover o canal, roundtrip de `size_bytes` > 2^32, `metadata` JSONB | `src/videos/entities/video.entity.integration-spec.ts` |
| `VideosModule` | Unit: compilation test | `src/videos/videos.module.spec.ts` |
| Migrations | Integration: runner aplica e reverte `CreateVideos` | `src/database/migrations.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` e o tipo `videos_status_enum`; `migration:revert` remove ambos
- Inserir dois vídeos com o mesmo `public_id` falha com violação de unicidade
- Um vídeo recém-criado tem `status = 'draft'` e `thumbnail_key`, `duration_seconds`, `metadata` e `failure_reason` nulos
- Remover um canal remove os vídeos desse canal
- `size_bytes = 10737418240` é gravado e lido de volta como o mesmo número
- Gravar `status = 'published'` falha (valor fora do enum)

---

### SI-03.4 — Endpoint POST /videos (pré-cadastro do rascunho e início do upload)

**Route:** POST /videos
**Test Specs:** see `nestjs-project/specs/videos-initiate-upload.plan.md`
**Authorization:** Authenticated (owner = canal do usuário autenticado)

**Description:** Ao iniciar o upload, valida título, formato e tamanho, pré-cadastra o vídeo como rascunho com `public_id` único e abre o multipart upload no storage, devolvendo o tamanho e a quantidade de partes.

**Technical actions:**

1. Criar `src/videos/dto/initiate-upload.dto.ts` (`title`, `filename`, `size`, `contentType` com `class-validator`, regras de schema da tabela `Validation Rules — Upload`) e os DTOs de resposta `src/videos/dto/video-response.dto.ts` (`VideoResponse`, com `@ApiProperty` em todos os campos) e `src/videos/dto/initiate-upload-response.dto.ts`; mapper `toVideoResponse(video)` em `src/videos/video.mapper.ts` (`has_thumbnail = thumbnail_key !== null`) (per `phase-03-videos/TD-16` Revision 2026-10-25, `.claude/rules/nestjs-dtos.md`)
2. Criar `src/videos/public-id.util.ts` — `generatePublicId()` = `randomBytes(8).toString('base64url')` (11 caracteres) e `src/videos/videos.constants.ts` com a allowlist extensão → MIME (`.mp4`→`video/mp4`, `.mov`→`video/quicktime`, `.mpg`/`.mpeg`→`video/mpeg`, `.avi`→`video/x-msvideo`) (per `phase-03-videos/TD-12`, `phase-03-videos/TD-16` Revision 2026-10-25)
3. Criar `src/videos/exceptions/video.exceptions.ts` com uma subclasse de `DomainException` por código do Error Catalog (`VIDEO_NOT_FOUND`, `VIDEO_TOO_LARGE`, `UNSUPPORTED_VIDEO_FORMAT`, `INVALID_UPLOAD_STATE`, `INVALID_UPLOAD_PARTS`, `UPLOAD_SIZE_MISMATCH`, `VIDEO_NOT_READY`) (per `phase-02-auth/TD-07`)
4. Criar `src/videos/videos.service.ts` — `initiateUpload(userId, dto)`: valida allowlist + correspondência extensão/MIME (`UnsupportedVideoFormatException`) e `size ≤ VIDEO_MAX_SIZE_BYTES` (`VideoTooLargeException`); resolve o canal do usuário via novo `ChannelsService.findByUserId(userId)`; gera `id` (`randomUUID`) e chama `StorageService.createMultipartUpload('videos/{id}/source', contentType)`; insere o rascunho com `upload_id` em transação, regenerando `public_id` em violação de unicidade com SAVEPOINT por tentativa (`.claude/rules/typeorm-queries.md`); se a inserção falhar de vez, aborta o multipart (compensação) e relança o erro (per `phase-03-videos/TD-04`, `phase-03-videos/TD-05`, `phase-03-videos/TD-14`)
5. Criar `src/videos/videos.controller.ts` (`@ApiTags('videos')`, `@Controller('videos')`) com `POST /videos` (`@HttpCode(201)`, `@ApiBearerAuth('access-token')`, `@ApiOperation` e um `@ApiResponse` para 201/400/401/413/415 referenciando `ApiErrorEnvelope`) usando `@CurrentUser()`; importar `StorageModule` e `ChannelsModule` no `VideosModule` (`.claude/rules/nestjs-controllers.md`, per `openapi-docs-nestjs/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generatePublicId` | Unit: 11 caracteres base64url, valores distintos | `src/videos/public-id.util.spec.ts` |
| `VideosService.initiateUpload` | Unit: allowlist, mismatch extensão/MIME, limite de tamanho, retry de colisão, compensação (mocks de repo, storage e channels) | `src/videos/videos.service.spec.ts` |
| `VideosService.initiateUpload` | Integration: Postgres + MinIO reais — rascunho criado com `upload_id` válido; colisão de `public_id` forçada via spy resolve com novo id | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário / `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |
| `VideosModule` | Unit: compilation test com `StorageModule` + `ChannelsModule` | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2 — `StorageService`; SI-03.3 — entidade `Video`

**Acceptance criteria:**

- `POST /videos` com `title`, `filename: "clip.mp4"`, `size: 5242880`, `contentType: "video/mp4"` retorna `201` com `video.status: "draft"`, `video.public_id` de 11 caracteres e `upload.part_count = ceil(size / upload.part_size_bytes)`
- Após o `201`, a tabela `videos` tem o rascunho com o título enviado, o `channel_id` do usuário autenticado e `upload_id` não nulo
- `POST /videos` com `filename: "clip.mkv"` retorna `415` com `error: "UNSUPPORTED_VIDEO_FORMAT"`
- `POST /videos` com `filename: "clip.mp4"` e `contentType: "video/quicktime"` retorna `415` com `error: "UNSUPPORTED_VIDEO_FORMAT"`
- `POST /videos` com `size: 10737418241` retorna `413` com `error: "VIDEO_TOO_LARGE"`
- `POST /videos` sem `title` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /videos` sem `Authorization` retorna `401`
- Uma colisão de `public_id` na inserção é resolvida com um novo id e a requisição ainda retorna `201`

---

### SI-03.5 — Endpoints de partes do upload: URLs pré-assinadas, listagem para retomada e abort

**Route:** POST /videos/:publicId/upload/part-urls, GET /videos/:publicId/upload/parts, DELETE /videos/:publicId/upload
**Test Specs:** see `nestjs-project/specs/videos-upload-parts.plan.md`
**Authorization:** Owner

**Description:** Entrega as URLs pré-assinadas por parte (reemissíveis a qualquer momento, o que permite retomar o upload), lista as partes já armazenadas e permite abortar o rascunho, tudo sem que um byte do arquivo passe pela API.

**Technical actions:**

1. Adicionar ao `VideosService` o helper `findOwnedVideo(userId, publicId)` — busca por `public_id` com o canal; ausente ou de outro canal lança `VideoNotFoundException` — e `assertDraft(video)` → `InvalidUploadStateException` (per `phase-03-videos/TD-17`, `.claude/rules/nestjs-layer-separation.md`)
2. Implementar `requestPartUrls(userId, publicId, dto)`: valida cada número contra `ceil(size_bytes / UPLOAD_PART_SIZE_BYTES)` (`InvalidUploadPartsException`) e chama `StorageService.presignUploadPart` com `UPLOAD_PART_URL_TTL_SECONDS`, retornando `urls` + `expires_at` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-05`)
3. Implementar `listUploadedParts(userId, publicId)` (via `StorageService.listParts`) e `abortUpload(userId, publicId)` (`abortMultipartUpload` + remoção do rascunho) (per `phase-03-videos/TD-05`)
4. Criar `src/videos/dto/request-part-urls.dto.ts` (`part_numbers`: 1–100 inteiros únicos ≥ 1) e os DTOs de resposta `part-urls-response.dto.ts` / `uploaded-parts-response.dto.ts`
5. Adicionar ao `VideosController` `POST /videos/:publicId/upload/part-urls` (`@HttpCode(200)`), `GET /videos/:publicId/upload/parts` e `DELETE /videos/:publicId/upload` (`@HttpCode(204)`), com `@ApiBearerAuth('access-token')` e `@ApiResponse` para cada status do API Contracts (`.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (ownership, estado, partes) | Unit: ramos de `findOwnedVideo`, `assertDraft`, faixa de `part_numbers` | `src/videos/videos.service.spec.ts` |
| `VideosService` (partes e abort) | Integration: Postgres + MinIO reais — parte enviada por `fetch` à URL emitida aparece em `listUploadedParts`; abort remove o rascunho e o multipart | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.4 — rascunho com `upload_id` e o `VideosController`

**Acceptance criteria:**

- `POST /videos/:publicId/upload/part-urls` com `part_numbers: [1, 2]` retorna `200` com 2 entradas em `urls` e um `expires_at` futuro
- `POST /videos/:publicId/upload/part-urls` com um número maior que `part_count` retorna `400` com `error: "INVALID_UPLOAD_PARTS"`
- Uma parte enviada com `PUT` à URL emitida passa a constar em `GET /videos/:publicId/upload/parts` com `part_number`, `etag` e `size_bytes`
- `DELETE /videos/:publicId/upload` retorna `204`; o rascunho deixa de existir na tabela `videos` e um novo `POST /videos/:publicId/upload/part-urls` retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Qualquer um dos três endpoints chamado por outro usuário autenticado retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Qualquer um dos três endpoints chamado para um vídeo em `'processing'` retorna `409` com `error: "INVALID_UPLOAD_STATE"`

---

### SI-03.6 — Endpoint de conclusão do upload e publicação do job de processamento

**Route:** POST /videos/:publicId/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner

**Description:** Finaliza o multipart no storage, confere o tamanho real do objeto, move o vídeo para `'processing'` e publica o job `process-video` na fila — o gatilho do processamento automático.

**Technical actions:**

1. Criar `src/queue/queue.module.ts` — `BullModule.forRootAsync` com `inject: [queueConfig.KEY]` → `{ connection: { host, port } }` — e `src/videos/processing/video-processing.constants.ts` (fila `'video-processing'`, job `'process-video'`, opções `attempts: 3`, `backoff: { type: 'exponential', delay: 10000 }`, `removeOnComplete: true`, `removeOnFail: 1000`); `VideosModule` importa `QueueModule` e `BullModule.registerQueue({ name: 'video-processing' })` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-07`, `phase-03-videos/TD-15`; API conforme `library-refs.md` → @nestjs/bullmq)
2. Criar `src/videos/processing/video-processing.producer.ts` — `VideoProcessingProducer.enqueue(videoId)` via `@InjectQueue('video-processing')`, com `jobId = videoId` e payload `{ videoId }` (per `phase-03-videos/TD-15`; API conforme `library-refs.md` → bullmq)
3. Implementar `VideosService.completeUpload(userId, publicId, dto)`: `'processing'` → re-enfileira e retorna (retry idempotente); `'ready'`/`'failed'` → `InvalidUploadStateException`; caso `'draft'`: `completeMultipartUpload` (`StoragePartsRejectedError` → `InvalidUploadPartsException`), `headObject` (acima do limite → remove objeto + rascunho e lança `VideoTooLargeException`; diferente do declarado → remove objeto + rascunho e lança `UploadSizeMismatchException`), update condicional `WHERE status = 'draft'` para `status = 'processing'`, `upload_id = null`, e então `enqueue` (per `phase-03-videos/TD-06`, `phase-03-videos/TD-14`, `phase-03-videos/TD-16`)
4. Criar `src/videos/dto/complete-upload.dto.ts` (`parts`: 1–10000 itens `{ part_number, etag }`, `@ValidateNested` + `@Type`) e adicionar `POST /videos/:publicId/upload/complete` (`@HttpCode(200)`) ao `VideosController` com `@ApiResponse` para 200/400/404/409/413 (`.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.completeUpload` | Unit: ramos de estado, retry idempotente, mapeamento de rejeição de partes, tamanho excedido/divergente (mocks) | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` + `VideoProcessingProducer` | Integration: Postgres + MinIO + Redis reais — complete leva a `'processing'` e cria o job com `id = videoId`; divergência de tamanho remove objeto e rascunho | `src/videos/videos.service.integration-spec.ts` |
| `QueueModule` | Unit: compilation test (`forRootAsync` + `queueConfig` global) | `src/queue/queue.module.spec.ts` |

**Dependencies:** SI-03.5 — `findOwnedVideo` e as partes enviadas pelas URLs emitidas

**Acceptance criteria:**

- `POST /videos/:publicId/upload/complete` com as partes corretas retorna `200` com `status: "processing"`
- Após o `200`, a linha em `videos` tem `status = 'processing'` e `upload_id` nulo, e a fila `video-processing` contém um job com id igual ao `id` do vídeo e payload `{ "videoId": "<id>" }`
- Uma segunda chamada a `complete` para o mesmo vídeo retorna `200` e a fila continua com um único job para esse vídeo
- `complete` com um `etag` incorreto retorna `400` com `error: "INVALID_UPLOAD_PARTS"` e o vídeo continua em `'draft'`
- `complete` quando o objeto armazenado difere do `size` declarado retorna `409` com `error: "UPLOAD_SIZE_MISMATCH"`, e o objeto e o rascunho deixam de existir
- `complete` para um vídeo em `'ready'` retorna `409` com `error: "INVALID_UPLOAD_STATE"`

---

### SI-03.7 — Módulo de mídia: wrappers de ffprobe e ffmpeg

**Description:** Isola a invocação dos binários do FFmpeg em serviços tipados — extração de duração e metadados (ffprobe) e geração de um frame JPEG (ffmpeg) —, sem shell e com tratamento explícito de mídia inválida.

**Technical actions:**

1. Criar `src/media/process-runner.ts` — `runProcess(command, args, { timeoutMs })` sobre `execFile` com array de argumentos (sem shell), captura de `stderr` e erro tipado em exit code ≠ 0 ou timeout (per `phase-03-videos/TD-08`)
2. Criar `src/media/media-probe.service.ts` — `probe(input)` executa `ffprobe -v error -print_format json -show_format -show_streams <input>`, mapeia para `{ durationSeconds, metadata: VideoMetadata }` (subconjunto curado de `phase-03-videos/TD-11`) e lança `InvalidMediaError` (`src/media/media.errors.ts`) quando a saída não é parseável ou não há stream de vídeo (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`, `phase-03-videos/TD-11`)
3. Criar `src/media/thumbnail.service.ts` — `computeOffset(durationSeconds)` (10% da duração; `0` quando ausente ou < 1s) e `extractFrame(input, offsetSeconds, outputPath)` executando `ffmpeg -ss <offset> -i <input> -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 2 <output>.jpg` (per `phase-03-videos/TD-10`)
4. Criar `src/media/media.module.ts` exportando `MediaProbeService` e `ThumbnailService`; utilitário de teste `src/test/video-fixtures.ts` que gera fixtures com `ffmpeg -f lavfi` (vídeo H.264 curto, arquivo só de áudio, arquivo de bytes aleatórios) em diretório temporário

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `MediaProbeService` | Unit: parsing do JSON do ffprobe, mapeamento curado, sem stream de vídeo → `InvalidMediaError` (runner mockado) | `src/media/media-probe.service.spec.ts` |
| `ThumbnailService` | Unit: `computeOffset` e argumentos montados (runner mockado) | `src/media/thumbnail.service.spec.ts` |
| `MediaProbeService` | Integration: ffprobe real sobre as fixtures geradas | `src/media/media-probe.service.integration-spec.ts` |
| `ThumbnailService` | Integration: ffmpeg real gera JPEG com largura limitada | `src/media/thumbnail.service.integration-spec.ts` |

**Dependencies:** SI-03.1 — FFmpeg na imagem; SI-03.3 — tipo `VideoMetadata`

**Acceptance criteria:**

- `probe` de um MP4 H.264 gerado com 3s, 640x360, retorna `durationSeconds` ≈ 3, `width: 640`, `height: 360` e `videoCodec: "h264"`
- `probe` de um arquivo de bytes aleatórios lança `InvalidMediaError`
- `probe` de um arquivo só de áudio lança `InvalidMediaError` (sem stream de vídeo)
- `extractFrame` de um vídeo 1920x1080 gera um JPEG com largura 1280 e proporção preservada
- `computeOffset(100)` retorna `10`; `computeOffset(0.5)` e `computeOffset(null)` retornam `0`
- Um nome de arquivo com espaços ou `;` é passado ao binário como argumento único, sem interpretação de shell

---

### SI-03.8 — Worker de vídeo: entrypoint standalone, processamento do job e serviço no Compose

**Description:** Sobe o worker como processo e container separados da API, consumindo `process-video`: extrai duração e metadados, gera e envia o thumbnail e fecha o ciclo de status em `'ready'` ou `'failed'`.

**Technical actions:**

1. Criar `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)` + `enableShutdownHooks()` — e `src/worker.module.ts`, importando o mesmo `ConfigModule.forRoot` (load + Joi), `TypeOrmModule.forRootAsync` (`databaseConfig`), `QueueModule`, `StorageModule`, `MediaModule`, `TypeOrmModule.forFeature([Video])` e o processor; sem controllers (per `phase-03-videos/TD-07`)
2. Criar `src/videos/processing/video-processing.service.ts` — `process(videoId)`: sai sem efeito se o vídeo não estiver em `'processing'`; presigna GET interno do `source_key`; `MediaProbeService.probe` (`InvalidMediaError` → `UnrecoverableError('INVALID_MEDIA')`); `ThumbnailService.extractFrame` em arquivo temporário; `StorageService.putObject('videos/{id}/thumbnail.jpg', …, 'image/jpeg')`; update condicional `WHERE status = 'processing'` → `'ready'` com `duration_seconds`, `metadata`, `thumbnail_key`; e `markFailed(videoId, reason)` com o mesmo update condicional (per `phase-03-videos/TD-09`, `phase-03-videos/TD-10`, `phase-03-videos/TD-14`, `phase-03-videos/TD-15`; API conforme `library-refs.md` → bullmq)
3. Criar `src/videos/processing/video-processing.processor.ts` — `@Processor('video-processing')` estendendo `WorkerHost`, delegando `process(job)` ao serviço; `@OnWorkerEvent('failed')` chama `markFailed` com `INVALID_MEDIA` (erro irrecuperável) ou `PROCESSING_FAILED` (quando `job.attemptsMade >= job.opts.attempts`), registrando o erro em log (`.claude/rules/nestjs-services.md` — exceção de background task; API conforme `library-refs.md` → @nestjs/bullmq)
4. Adicionar ao `package.json` os scripts `start:worker` (`nest start --entryFile worker`), `start:worker:dev` (`nest start --entryFile worker --watch`) e `start:worker:prod` (`node dist/worker`)
5. Adicionar ao `compose.yaml` o serviço `video-worker` (mesmo build e volume do `nestjs-api`, `command: npm run start:worker:dev`, `depends_on`: `db` healthy, `redis` healthy, `minio-init` completed successfully) (per `phase-03-videos/TD-07`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingService` | Unit: vídeo fora de `'processing'` é ignorado, `InvalidMediaError` vira `UnrecoverableError`, `markFailed` condicional (mocks) | `src/videos/processing/video-processing.service.spec.ts` |
| `VideoProcessingService` | Integration: Postgres + MinIO + ffmpeg reais — fixture válida termina `'ready'` com thumbnail no bucket; fixture inválida termina `'failed'` | `src/videos/processing/video-processing.service.integration-spec.ts` |
| `VideoProcessingProcessor` | Integration: Redis real — job adicionado é consumido; erro irrecuperável não tem retry; erro persistente esgota as 3 tentativas | `src/videos/processing/video-processing.processor.integration-spec.ts` |
| `WorkerModule` | Unit: compilation test | `src/worker.module.spec.ts` |

**Dependencies:** SI-03.6 — fila, payload e producer; SI-03.7 — `MediaProbeService` e `ThumbnailService`

**Acceptance criteria:**

- Um job para um vídeo em `'processing'` com um MP4 válido no storage leva o vídeo a `'ready'` com `duration_seconds`, `metadata.width`/`metadata.height` e `thumbnail_key` preenchidos
- Após o processamento, o objeto `videos/{id}/thumbnail.jpg` existe no bucket com `Content-Type: image/jpeg`
- Um job para um arquivo corrompido leva o vídeo a `'failed'` com `failure_reason = 'INVALID_MEDIA'` após uma única tentativa
- Um erro que persiste nas 3 tentativas leva o vídeo a `'failed'` com `failure_reason = 'PROCESSING_FAILED'`
- Um job para um vídeo que não está em `'processing'` não altera a linha
- `docker compose up -d` sobe o `video-worker`, que permanece em execução e consome a fila `video-processing`
- A API continua respondendo `GET /` enquanto o worker processa um job

---

### SI-03.9 — Endpoint GET /videos/:publicId (consulta do vídeo e do status)

**Route:** GET /videos/:publicId
**Test Specs:** see `nestjs-project/specs/videos-get.plan.md`
**Authorization:** Owner

**Description:** Expõe ao dono o vídeo e o status do processamento, para acompanhar o ciclo `draft → processing → ready | failed` com duração, metadados e motivo de falha.

**Technical actions:**

1. Implementar `VideosService.getVideo(userId, publicId)` sobre `findOwnedVideo`, retornando `toVideoResponse(video)` (per `phase-03-videos/TD-11`, `phase-03-videos/TD-14`, `phase-03-videos/TD-17`)
2. Adicionar `GET /videos/:publicId` ao `VideosController` com `@ApiBearerAuth('access-token')`, `@ApiOperation` e `@ApiResponse` para 200 (`VideoResponse`) e 404 (`ApiErrorEnvelope`) (`.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getVideo` | Unit: mapeamento de `VideoResponse` por status (`has_thumbnail`, `failure_reason`, campos nulos) | `src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.5 — `findOwnedVideo`

**Acceptance criteria:**

- `GET /videos/:publicId` do dono retorna `200` com `VideoResponse` e o `status` atual
- Para um vídeo `'ready'`, a resposta traz `duration_seconds` e `metadata` não nulos e `has_thumbnail: true`
- Para um vídeo `'failed'`, a resposta traz `failure_reason` não nulo
- A resposta nunca contém o `id` interno, `upload_id`, `source_key` ou `thumbnail_key`
- `GET /videos/:publicId` de outro usuário ou com `publicId` inexistente retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.10 — Endpoints de streaming, download e thumbnail via redirect pré-assinado

**Route:** GET /videos/:publicId/stream, GET /videos/:publicId/download, GET /videos/:publicId/thumbnail
**Test Specs:** see `nestjs-project/specs/videos-playback.plan.md`
**Authorization:** Owner

**Description:** Autoriza o dono e redireciona (`302`) para URLs pré-assinadas de curta duração; o storage atende `Range` com `206 Partial Content`, então a reprodução começa sem baixar o arquivo inteiro e os bytes nunca passam pela API.

**Technical actions:**

1. Implementar `VideosService.getPlaybackUrl(userId, publicId, kind: 'stream' | 'download' | 'thumbnail')`: `findOwnedVideo`; status diferente de `'ready'` → `VideoNotReadyException`; `StorageService.presignGetObject` com `endpoint: 'public'` e `PLAYBACK_URL_TTL_SECONDS` — `stream` com `responseContentType = content_type`; `download` com `responseContentDisposition = attachment; filename="<original_filename>"` (nome sanitizado + `filename*` RFC 5987); `thumbnail` sobre `thumbnail_key` (per `phase-03-videos/TD-04`, `phase-03-videos/TD-13`, `phase-03-videos/TD-17`)
2. Adicionar ao `VideosController` `GET /videos/:publicId/stream`, `GET /videos/:publicId/download` e `GET /videos/:publicId/thumbnail` respondendo `302` com `Location` (via `@Redirect()` retornando `{ url, statusCode: 302 }`), com `@ApiResponse` para 302 (header `Location`), 404 e 409 (`.claude/rules/nestjs-controllers.md`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService.getPlaybackUrl` | Unit: ramos por `kind` e por status (mocks) | `src/videos/videos.service.spec.ts` |
| `VideosService.getPlaybackUrl` | Integration: MinIO real — URL de `stream` atende `Range` com `206`; URL de `download` traz `Content-Disposition: attachment` | `src/videos/videos.service.integration-spec.ts` |

**Dependencies:** SI-03.5 — `findOwnedVideo`; SI-03.2 — `presignGetObject`

**Acceptance criteria:**

- `GET /videos/:publicId/stream` de um vídeo `'ready'` retorna `302` com `Location` apontando para o host de `S3_PUBLIC_ENDPOINT`
- Requisitar o `Location` do stream com `Range: bytes=0-1023` retorna `206` com 1024 bytes e `Content-Range`
- Requisitar o `Location` do download retorna o arquivo com `Content-Disposition: attachment` e o `original_filename`
- Requisitar o `Location` do thumbnail retorna uma imagem `image/jpeg`
- Os três endpoints para um vídeo em `'processing'` retornam `409` com `error: "VIDEO_NOT_READY"`
- Os três endpoints chamados por outro usuário retornam `404` com `error: "VIDEO_NOT_FOUND"`
- Um `Location` emitido deixa de funcionar após `PLAYBACK_URL_TTL_SECONDS`

---

### SI-03.11 — Pipeline completo de ponta a ponta e artefatos de API (OpenAPI + api.http)

**Description:** Prova o fluxo inteiro sobre a infraestrutura real — pré-cadastro → upload direto das partes ao storage → complete → worker → `'ready'` → stream/download/thumbnail — e atualiza o contrato OpenAPI exportado e o `api.http` com os novos endpoints.

**Technical actions:**

1. Criar `test/videos-pipeline.e2e-spec.ts` — sobe `AppModule` (com a configuração global do `main.ts` reproduzida) e, no mesmo processo de teste, o `VideoProcessingProcessor` do `WorkerModule`; usa `S3_PUBLIC_ENDPOINT` apontando para o endpoint interno (`http://minio:9000`), para que as URLs assinadas sejam alcançáveis de dentro do container; autentica um usuário confirmado; gera a fixture com `src/test/video-fixtures.ts` e envia as partes com `PUT` direto às URLs emitidas (per `phase-03-videos/TD-05`, `phase-03-videos/TD-07`, `.claude/rules/nestjs-testing.md`)
2. Cobrir no mesmo spec o caminho de falha: arquivo corrompido completo termina em `'failed'` com `failure_reason: "INVALID_MEDIA"` (per `phase-03-videos/TD-15`)
3. Regenerar `nestjs-project/openapi.json` com `npm run openapi:export` e garantir que `test/swagger.e2e-spec.ts` continua passando com a tag `videos` (per `openapi-docs-nestjs/TD-02`)
4. Adicionar a `nestjs-project/api.http` a sequência de requisições de vídeo (initiate, part-urls, parts, complete, get, stream, download, thumbnail, abort)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Pipeline de upload e processamento | E2E: fluxo completo com Postgres, MinIO, Redis e FFmpeg reais (sucesso e falha) | `test/videos-pipeline.e2e-spec.ts` |
| OpenAPI exportado | E2E: documento continua válido e inclui as operações `/videos` | `test/swagger.e2e-spec.ts` |

**Dependencies:** SI-03.8 — worker; SI-03.9 — consulta de status; SI-03.10 — stream/download/thumbnail

**Acceptance criteria:**

- O fluxo `POST /videos` → `part-urls` → `PUT` das partes no storage → `complete` → polling de `GET /videos/:publicId` chega a `status: "ready"` dentro do timeout do teste
- No fluxo de sucesso, todos os `PUT` de partes vão para o host do storage — nenhuma requisição com bytes do arquivo é enviada à API
- No vídeo `'ready'`, o `Location` do stream atende `Range` com `206`, e o do download e o do thumbnail respondem `200`
- O upload de um arquivo corrompido termina com `status: "failed"` e `failure_reason: "INVALID_MEDIA"`
- `openapi.json` contém as 9 operações em `/videos` com respostas de erro referenciando `ApiErrorEnvelope`
- `api.http` executa a sequência de vídeo contra o ambiente local do Compose

---

### SI-03.12 — Atualizar a documentação de IA (CLAUDE.md e diagrama de arquitetura)

**Description:** Reflete no `CLAUDE.md` da raiz, no `nestjs-project/CLAUDE.md` e no diagrama de arquitetura o estado real do código após a fase: módulo de vídeos, endpoints, fila/worker, storage e os novos serviços do Compose.

**Technical actions:**

1. Atualizar o `CLAUDE.md` da raiz — arquitetura com a fila definida (BullMQ + Redis no lugar de "TBD"), o worker como container separado do mesmo código e o storage MinIO (imagem `pgsty/minio`) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-07`)
2. Atualizar `docs/diagrams/software-arch.mermaid` — `ContainerQueue(queue, "Message Queue", "BullMQ + Redis", ...)` e a relação Frontend → Object Storage via URL pré-assinada (per `phase-03-videos/TD-01`, `phase-03-videos/TD-13`)
3. Adicionar ao `nestjs-project/CLAUDE.md` uma seção de vídeos: módulos (`storage`, `queue`, `media`, `videos`, entrypoint `worker.ts`), endpoints `/videos`, ciclo de status, serviços do Compose (`minio`, `minio-init`, `redis`, `video-worker`) com comandos de verificação, scripts `start:worker*`, variáveis de ambiente novas e a exceção de `S3_PUBLIC_ENDPOINT` à regra de nome de serviço
4. Conferir que todo arquivo, endpoint, script e serviço citado nos três documentos existe no código (grep por cada um)

**Tests:** _(empty — documentation only; verified by AC grep checks)_

**Dependencies:** SI-03.11 — o código documentado precisa estar completo

**Acceptance criteria:**

- O `CLAUDE.md` da raiz não descreve mais a fila como "TBD" e cita BullMQ + Redis, o worker e o storage
- `nestjs-project/CLAUDE.md` lista os 9 endpoints de `/videos`, os 4 novos serviços do Compose, os scripts `start:worker*` e as variáveis de ambiente novas
- Cada caminho de arquivo citado nos documentos atualizados existe no repositório
- `docs/diagrams/software-arch.mermaid` define a fila como BullMQ + Redis

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Internal identifier; used in storage keys (per `phase-03-videos/TD-04`) |
| public_id | varchar(11) | unique, not null | Random 11-char base64url id from `node:crypto` (8 random bytes); the unique public URL identifier, regenerated on unique-violation (per `phase-03-videos/TD-12`) |
| channel_id | uuid | FK → channels.id, not null, on delete cascade | Owner channel (one user = one channel) |
| title | varchar(100) | not null | Required at upload start (per `phase-03-videos/TD-16` Revision 2026-10-25); editing it is a Phase 04 capability |
| status | enum `videos_status_enum` | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'failed'` | Lifecycle `draft → processing → ready \| failed` (per `phase-03-videos/TD-14`) |
| original_filename | varchar(255) | not null | Client-sent `filename`; used for the download `Content-Disposition` (per `phase-03-videos/TD-13`) |
| content_type | varchar(100) | not null | Client-sent `contentType`, one of the allowlisted MIME types (per `phase-03-videos/TD-16` Revision) |
| size_bytes | bigint | not null | Declared at initiate; verified against `HeadObject` at complete (per `phase-03-videos/TD-11`, `phase-03-videos/TD-16`). Mapped with a string↔number transformer (bigint) |
| upload_id | varchar(1024) | nullable | S3 multipart `UploadId` while `status = 'draft'`; set to `null` after complete (per `phase-03-videos/TD-05`) |
| source_key | varchar(255) | not null | `videos/{id}/source` (per `phase-03-videos/TD-04`) |
| thumbnail_key | varchar(255) | nullable | `videos/{id}/thumbnail.jpg`, set by the worker on success (per `phase-03-videos/TD-04`, `phase-03-videos/TD-10`) |
| duration_seconds | double precision | nullable | Filled by the worker from ffprobe (per `phase-03-videos/TD-11`) |
| metadata | jsonb | nullable | Curated ffprobe subset typed as `VideoMetadata` (per `phase-03-videos/TD-11`) |
| failure_reason | varchar(255) | nullable | Short reason set with `status = 'failed'` (per `phase-03-videos/TD-15`) |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**`VideoMetadata` (TypeScript interface for the `metadata` JSONB, per `phase-03-videos/TD-11`):** `{ formatName: string; bitRate: number \| null; width: number \| null; height: number \| null; frameRate: number \| null; videoCodec: string \| null; audioCodec: string \| null }`.

**Relations:** Video → Channel (many-to-one, owning side via `channel_id`); Channel → Video (one-to-many, inverse side added to `Channel`).
**Indexes:** `(public_id)` — unique; `(channel_id)` — FK lookup.
**Migration:** `<timestamp>-CreateVideos.ts`, generated via `npm run migration:generate` (creates `videos` + `videos_status_enum`).

### API Contracts

All endpoints below are authenticated (global JWT guard, `Authorization: Bearer <access_token>`) and owner-only. `:publicId` is the 11-char `public_id` (per `phase-03-videos/TD-12`); the internal `id` is never exposed. A video that does not exist **or** belongs to another user's channel returns `404 VIDEO_NOT_FOUND` (per `phase-03-videos/TD-17`). Response fields follow the snake_case wire convention established by Phase 02 (`access_token`, `refresh_token`).

**Video resource (shared response shape, referred to as `VideoResponse`):**
- public_id: string (11 chars)
- title: string
- status: `'draft' | 'processing' | 'ready' | 'failed'`
- original_filename: string
- content_type: string
- size_bytes: number
- duration_seconds: number | null
- metadata: `VideoMetadata` | null (see Data Model)
- has_thumbnail: boolean
- failure_reason: string | null
- created_at: string (ISO-8601)
- updated_at: string (ISO-8601)

---

#### POST /videos (SI-03.4)

Pre-registers the video as a draft and opens the multipart upload (per `phase-03-videos/TD-05`, `phase-03-videos/TD-14`, `phase-03-videos/TD-16`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- title: string, required — 1 to 100 characters (trimmed)
- filename: string, required — 1 to 255 characters; extension must be one of `.mp4`, `.mov`, `.mpg`, `.mpeg`, `.avi` (case-insensitive)
- size: integer, required — ≥ 1; must not exceed `VIDEO_MAX_SIZE_BYTES` (10 GiB = 10737418240 bytes)
- contentType: string, required — must be one of `video/mp4`, `video/quicktime`, `video/mpeg`, `video/x-msvideo`, and consistent with the `filename` extension

**Response 201:**
- video: `VideoResponse` (status `'draft'`)
- upload: object
  - part_size_bytes: number — fixed part size (`UPLOAD_PART_SIZE_BYTES`, default 100 MiB)
  - part_count: number — `ceil(size / part_size_bytes)`
  - max_part_urls_per_request: number — 100

**Error responses:**
- 400 validation error: when the request body fails schema validation
- 413 VIDEO_TOO_LARGE: when `size` exceeds `VIDEO_MAX_SIZE_BYTES`
- 415 UNSUPPORTED_VIDEO_FORMAT: when the `filename` extension or `contentType` is outside the allowlist, or they do not match each other
- 401: missing/invalid access token (global guard)

---

#### POST /videos/:publicId/upload/part-urls (SI-03.5)

Issues presigned `UploadPart` URLs, signed with the public storage endpoint (per `phase-03-videos/TD-03`, `phase-03-videos/TD-05`). Re-issuable at any time while the video is a draft — this is the resume path.

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- part_numbers: integer[], required — 1 to 100 unique items, each between 1 and the video's `part_count`

**Response 200:**
- urls: array of `{ part_number: number, url: string }`
- expires_at: string (ISO-8601) — `now + UPLOAD_PART_URL_TTL_SECONDS`

**Error responses:**
- 400 validation error: when the request body fails schema validation
- 400 INVALID_UPLOAD_PARTS: when a part number is greater than the video's `part_count`
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 INVALID_UPLOAD_STATE: when the video is not in `'draft'` status

---

#### GET /videos/:publicId/upload/parts (SI-03.5)

Lists the parts already stored by the storage server (`ListParts`), so an interrupted client resumes only the missing ones (per `phase-03-videos/TD-05`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- parts: array of `{ part_number: number, etag: string, size_bytes: number }`

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 INVALID_UPLOAD_STATE: when the video is not in `'draft'` status

---

#### DELETE /videos/:publicId/upload (SI-03.5)

Aborts the multipart upload (`AbortMultipartUpload`) and deletes the draft row — an aborted pre-registration leaves nothing behind.

**Request headers:**
- Authorization: Bearer <access_token>

**Response 204:** No content.

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 INVALID_UPLOAD_STATE: when the video is not in `'draft'` status

---

#### POST /videos/:publicId/upload/complete (SI-03.6)

Completes the multipart upload, verifies the stored object, moves the video to `'processing'` and enqueues the processing job (per `phase-03-videos/TD-06`, `phase-03-videos/TD-14`, `phase-03-videos/TD-16`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- parts: array, required — 1 to 10000 items of `{ part_number: integer (≥1), etag: string (non-empty) }`, sorted ascending by `part_number`

**Response 200:**
- `VideoResponse` (status `'processing'`)

Idempotent retry: when the video is already `'processing'` (a previous `complete` committed the transition but the enqueue failed or the response was lost), the call skips the storage steps, re-adds the job with the same `jobId` and returns `200` with the current `VideoResponse`.

**Error responses:**
- 400 validation error: when the request body fails schema validation
- 400 INVALID_UPLOAD_PARTS: when the storage server rejects the part list (missing/unknown part, wrong ETag, wrong order, part below the 5 MiB minimum)
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 INVALID_UPLOAD_STATE: when the video status is `'ready'` or `'failed'`
- 409 UPLOAD_SIZE_MISMATCH: when the stored object size differs from the declared `size` (the object and the draft are deleted; the client starts a new upload)
- 413 VIDEO_TOO_LARGE: when the stored object exceeds `VIDEO_MAX_SIZE_BYTES` (the object and the draft are deleted)

---

#### GET /videos/:publicId (SI-03.9)

Returns the video and its processing status.

**Request headers:**
- Authorization: Bearer <access_token>

**Response 200:**
- `VideoResponse`

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller

---

#### GET /videos/:publicId/stream (SI-03.10)

Redirects to a short-lived presigned `GetObject` URL; the storage server serves `Range` requests with `206 Partial Content` (per `phase-03-videos/TD-13`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: presigned GET URL of `source_key` (public endpoint, TTL `PLAYBACK_URL_TTL_SECONDS`, `ResponseContentType` = `content_type`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 VIDEO_NOT_READY: when the video status is not `'ready'`

---

#### GET /videos/:publicId/download (SI-03.10)

Same as stream, with `ResponseContentDisposition=attachment; filename="<original_filename>"` so the browser saves the file (per `phase-03-videos/TD-13`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: presigned GET URL of `source_key` with the attachment disposition (public endpoint, TTL `PLAYBACK_URL_TTL_SECONDS`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 VIDEO_NOT_READY: when the video status is not `'ready'`

---

#### GET /videos/:publicId/thumbnail (SI-03.10)

Redirects to a short-lived presigned GET URL of the generated JPEG thumbnail (per `phase-03-videos/TD-04`, `phase-03-videos/TD-10`).

**Request headers:**
- Authorization: Bearer <access_token>

**Response 302:**
- Location: presigned GET URL of `thumbnail_key` (public endpoint, TTL `PLAYBACK_URL_TTL_SECONDS`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `publicId` or not owned by the caller
- 409 VIDEO_NOT_READY: when the video status is not `'ready'`

---

#### Validation Rules — Upload

| Field | Rule | Source |
|-------|------|--------|
| title | required, string, trimmed length 1–100 | `phase-03-videos/TD-16` Revision (AMB-1) |
| filename | required, string, length 1–255, extension ∈ {`.mp4`, `.mov`, `.mpg`, `.mpeg`, `.avi`} (case-insensitive) | `phase-03-videos/TD-16` Revision (AMB-2) |
| size | required, integer, 1 ≤ size ≤ `VIDEO_MAX_SIZE_BYTES` | `phase-03-videos/TD-16` |
| contentType | required, string; ∈ {`video/mp4`, `video/quicktime`, `video/mpeg`, `video/x-msvideo`}; must match the extension (`.mp4`→`video/mp4`, `.mov`→`video/quicktime`, `.mpg`/`.mpeg`→`video/mpeg`, `.avi`→`video/x-msvideo`) | `phase-03-videos/TD-16` Revision (AMB-2) |
| part_numbers | required, array of 1–100 unique integers ≥ 1 | `phase-03-videos/TD-05` |
| parts | required, array of 1–10000 `{ part_number ≥ 1, etag non-empty }` | `phase-03-videos/TD-05`, `phase-03-videos/TD-06` |

Schema-level rules (presence, types, lengths, integer ranges ≥ 1, array sizes, uniqueness) are enforced by `class-validator` DTOs through the global `ValidationPipe` (per `phase-02-auth/TD-06`) and return `400 VALIDATION_ERROR`. Domain rules — extension/MIME allowlist and their match (`415 UNSUPPORTED_VIDEO_FORMAT`), size vs. `VIDEO_MAX_SIZE_BYTES` (`413 VIDEO_TOO_LARGE`), part number vs. `part_count` (`400 INVALID_UPLOAD_PARTS`) — are enforced in `VideosService`, which throws domain exceptions (`.claude/rules/nestjs-services.md`).

### Authorization Matrix

Per `phase-03-videos/TD-17`: every Phase 03 endpoint is owner-only. No handler carries `@Public()`; anonymous access to videos is a Phase 05 capability. "Owner" = the authenticated user whose channel (`channels.user_id = JWT sub`) owns the video (`videos.channel_id`).

| Endpoint | Anonymous | Authenticated (non-owner) | Owner | Notes |
|----------|-----------|---------------------------|-------|-------|
| POST /videos | ✗ (401) | — | ✓ | Any authenticated user creates a video in their own channel |
| POST /videos/:publicId/upload/part-urls | ✗ (401) | ✗ (404) | ✓ | Only while `status = 'draft'` |
| GET /videos/:publicId/upload/parts | ✗ (401) | ✗ (404) | ✓ | Only while `status = 'draft'` |
| DELETE /videos/:publicId/upload | ✗ (401) | ✗ (404) | ✓ | Only while `status = 'draft'` |
| POST /videos/:publicId/upload/complete | ✗ (401) | ✗ (404) | ✓ | Only while `status = 'draft'` |
| GET /videos/:publicId | ✗ (401) | ✗ (404) | ✓ | Any status |
| GET /videos/:publicId/stream | ✗ (401) | ✗ (404) | ✓ | Only when `status = 'ready'` |
| GET /videos/:publicId/download | ✗ (401) | ✗ (404) | ✓ | Only when `status = 'ready'` |
| GET /videos/:publicId/thumbnail | ✗ (401) | ✗ (404) | ✓ | Only when `status = 'ready'` |

Non-owners receive `404 VIDEO_NOT_FOUND` (not 403) so a video's existence is not revealed. The ownership check is a business rule and lives in `VideosService` (`.claude/rules/nestjs-layer-separation.md`), not in a guard.

### Error Catalog

**Error response format:** inherited from Phase 02 (`phase-02-auth/TD-07`) — `{ statusCode: number, error: string, message: string }`, with `error` carrying the domain code; validation errors use `error: "VALIDATION_ERROR"` and a `message` array. Exceptions extend `DomainException` (`src/common/exceptions/domain.exception.ts`) and are mapped by the existing `DomainExceptionFilter`.

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Any `/videos/:publicId…` endpoint with an unknown `publicId` or a video owned by another user's channel |
| VIDEO_TOO_LARGE | 413 | Video exceeds the maximum allowed size | POST /videos with `size` > `VIDEO_MAX_SIZE_BYTES`; POST …/upload/complete when the stored object exceeds it (object and draft deleted) |
| UNSUPPORTED_VIDEO_FORMAT | 415 | Unsupported video format | POST /videos with a `filename` extension or `contentType` outside the allowlist, or mismatched with each other |
| INVALID_UPLOAD_STATE | 409 | Upload is not in progress for this video | Part URLs, list parts or abort on a video whose `status` is not `'draft'`; complete on a video whose `status` is `'ready'` or `'failed'` (complete on `'processing'` is an idempotent retry) |
| INVALID_UPLOAD_PARTS | 400 | Invalid upload parts | Part number > `part_count`; storage rejects `CompleteMultipartUpload` (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`, `NoSuchUpload`) |
| UPLOAD_SIZE_MISMATCH | 409 | Uploaded file size does not match the declared size | POST …/upload/complete when `HeadObject` `ContentLength` ≠ declared `size` (object and draft deleted) |
| VIDEO_NOT_READY | 409 | Video is not ready | GET …/stream, …/download, …/thumbnail when `status` is not `'ready'` |

**Worker failure reasons** (stored in `videos.failure_reason`, not HTTP responses — per `phase-03-videos/TD-15`):

| failure_reason | Classification | Trigger |
|----------------|----------------|---------|
| `INVALID_MEDIA` | Unrecoverable (no retry) | ffprobe fails to parse the file, or the file has no video stream |
| `PROCESSING_FAILED` | Recoverable — set only after the final attempt | Any other error (storage/network/ffmpeg crash) persisting across all attempts |

### Events/Messages

#### Queue `video-processing` — job `process-video`

**Payload:**

```json
{ "videoId": "uuid" }
```

**Job options:** `jobId = videoId` (duplicate enqueues are ignored), `attempts: 3`, `backoff: { type: 'exponential', delay: 10000 }`, `removeOnComplete: true`, `removeOnFail: 1000` (per `phase-03-videos/TD-15`; API surface per `library-refs.md` → bullmq).
**Producer:** `VideoProcessingProducer` (injected into `VideosService.completeUpload`, API process) via `@InjectQueue('video-processing')` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-06`, `phase-03-videos/TD-07`).
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing')` extending `WorkerHost`), registered only in `WorkerModule` and run by the `video-worker` container (per `phase-03-videos/TD-07`).
**Trigger:** POST /videos/:publicId/upload/complete succeeds — the DB transition `draft → processing` is committed first, then the job is added. A failure to enqueue is surfaced as a 5xx; the client can retry `complete`, which re-adds the same `jobId` idempotently because the status is already `'processing'` (see `VideosService.completeUpload` in SI-03.6).
**Processing steps (consumer):**
1. Load the video by `videoId`; if `status` is not `'processing'` → return (no-op, already handled).
2. Presign an internal GET URL of `source_key` (internal endpoint, per `phase-03-videos/TD-09`).
3. ffprobe the URL → duration + curated `VideoMetadata` (per `phase-03-videos/TD-08`, `phase-03-videos/TD-11`); no video stream or parse failure → `UnrecoverableError('INVALID_MEDIA')`.
4. ffmpeg seeks to ~10% of the duration (first frame when the duration is missing or < 1s) and writes one JPEG frame, width bounded to 1280 px with aspect ratio preserved (per `phase-03-videos/TD-10`), into a temp file.
5. `PutObject` the JPEG to `videos/{id}/thumbnail.jpg` (`Content-Type: image/jpeg`) — deterministic key, so retries overwrite.
6. Conditional update `WHERE id = :id AND status = 'processing'` → `status = 'ready'`, `duration_seconds`, `metadata`, `thumbnail_key`.
**Failure handling:** on `UnrecoverableError` or when `job.attemptsMade` reaches `attempts`, the processor's `failed` handler runs a conditional update `WHERE id = :id AND status = 'processing'` → `status = 'failed'`, `failure_reason` (`INVALID_MEDIA` | `PROCESSING_FAILED`). Errors are logged, never swallowed into a success (`.claude/rules/nestjs-services.md` — background-task exception).
**Delivery semantics:** at-least-once (per `phase-03-videos/TD-15`); every step is idempotent.

---

## Dependency Map

```
SI-03.1 (root — infra: libs, config, MinIO, Redis, FFmpeg)
├── SI-03.2 — storage depende do MinIO/bucket e do storageConfig
└── SI-03.7 — mídia depende do FFmpeg na imagem (+ SI-03.3 pelo tipo VideoMetadata)

SI-03.3 (root — entidade Video + migration)

SI-03.2 + SI-03.3
└── SI-03.4 — POST /videos (rascunho + multipart)
    └── SI-03.5 — part-urls / parts / abort (+ findOwnedVideo)
        ├── SI-03.6 — complete + enqueue
        ├── SI-03.9 — GET /videos/:publicId
        └── SI-03.10 — stream / download / thumbnail (+ SI-03.2 presignGetObject)

SI-03.6 + SI-03.7
└── SI-03.8 — worker (consumer + serviço no Compose)

SI-03.8 + SI-03.9 + SI-03.10
└── SI-03.11 — pipeline e2e + openapi.json + api.http
    └── SI-03.12 — CLAUDE.md + diagrama de arquitetura
```

Ordem linear de implementação: SI-03.1 → SI-03.2, SI-03.3 (paralelos) → SI-03.4 → SI-03.5 → SI-03.6, SI-03.7, SI-03.9, SI-03.10 (paralelos) → SI-03.8 → SI-03.11 → SI-03.12

---

## Deliverables

- [ ] SI-03.1 — Infra: dependências, namespaces de configuração e serviços no Docker Compose
- [ ] SI-03.2 — Módulo de storage S3 (cliente interno + cliente de presign)
- [ ] SI-03.3 — Entidade Video, migration e VideosModule
- [ ] SI-03.4 — Endpoint POST /videos (pré-cadastro do rascunho e início do upload)
- [ ] SI-03.5 — Endpoints de partes do upload: URLs pré-assinadas, listagem para retomada e abort
- [ ] SI-03.6 — Endpoint de conclusão do upload e publicação do job de processamento
- [ ] SI-03.7 — Módulo de mídia: wrappers de ffprobe e ffmpeg
- [ ] SI-03.8 — Worker de vídeo: entrypoint standalone, processamento do job e serviço no Compose
- [ ] SI-03.9 — Endpoint GET /videos/:publicId (consulta do vídeo e do status)
- [ ] SI-03.10 — Endpoints de streaming, download e thumbnail via redirect pré-assinado
- [ ] SI-03.11 — Pipeline completo de ponta a ponta e artefatos de API (OpenAPI + api.http)
- [ ] SI-03.12 — Atualizar a documentação de IA (CLAUDE.md e diagrama de arquitetura)

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully, including the worker entrypoint (`docker compose exec nestjs-api npm run build` produces `dist/main.js` and `dist/worker.js`)
