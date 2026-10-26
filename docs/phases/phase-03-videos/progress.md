# phase-03-videos — Progress

**Status:** completed
**SIs:** 12/12 completed

### SI-03.1 — Infra: dependências, namespaces de configuração e serviços no Docker Compose
- **Status:** completed
- **Tests:** 9 passing (`env.validation.integration-spec.ts`) + e2e `GET /` passing; `tsc --noEmit` exit 0
- **Observations:**
  - `pgsty/mc` fixado em `RELEASE.2026-08-06T00-00-00Z` (tag publicada mais próxima do servidor `RELEASE.2026-08-04T00-00-00Z`); a imagem do MinIO traz `curl` e `mc`, então o healthcheck usa `curl -fs http://localhost:9000/minio/health/live`.
  - Credenciais locais do MinIO (`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`) substituídas no `compose.yaml` a partir do `.env` (interpolação do Compose); `S3_ACCESS_KEY` / `S3_SECRET_KEY` usam os mesmos valores localmente.
  - Joi também valida `UPLOAD_PART_SIZE_BYTES ≥ 5 MiB` (mínimo de parte do S3) — restrição derivada do limite do S3 citado nas Research notes, sem alterar nenhum valor do plano.
  - Validado manualmente: `minio-init` sai com 0 e cria `streamtube-videos`; rodar de novo é idempotente; `redis-cli ping` → `PONG`; `ffprobe`/`ffmpeg` 5.1.9 no container `nestjs-api`.

### SI-03.2 — Módulo de storage S3 (cliente interno + cliente de presign)
- **Status:** completed
- **Tests:** 8 passing (`storage.module.spec.ts` 1 + `storage.service.integration-spec.ts` 7, MinIO real); `tsc --noEmit` exit 0; eslint limpo
- **Observations:**
  - A suíte de integração sobrescreve `storageConfig.KEY` com `publicEndpoint = S3_ENDPOINT` para que as URLs pré-assinadas sejam alcançáveis de dentro do container; a asserção de host público vs. interno usa um segundo módulo com a config padrão (`localhost:9000`), só assinando (sem rede).
  - 1 tentativa de correção: o `tsc` rejeitou `Buffer` como `body` do `fetch` no teste; corrigido enviando `new Uint8Array(body)`.
  - `listParts` pagina via `PartNumberMarker` (`IsTruncated`), cobrindo uploads com mais de 1000 partes.

### SI-03.3 — Entidade Video, migration e VideosModule
- **Status:** completed
- **Tests:** 73 passing em 13 suítes (`video.entity.integration-spec.ts`, `videos.module.spec.ts`, `migrations.integration-spec.ts` + 10 suítes da Fase 02 afetadas pela nova relação); `tsc --noEmit` exit 0; lint 0 erros (23 warnings pré-existentes)
- **Observations:**
  - Migration gerada pela CLI: `src/database/migrations/1792977734660-CreateVideos.ts` (enum `videos_status_enum`, unique em `public_id`, índice em `channel_id`, FK com `ON DELETE CASCADE`); `migration:run` → `migration:revert` → `migration:run` validados no banco de dev.
  - A relação `Channel → videos` obriga todo `DataSource` de teste com `Channel` a carregar `Video`: além dos dois arquivos citados no plano, `Video` foi acrescentado aos arrays `ALL_ENTITIES` de 10 testes da Fase 02 (auth, users, channels) e `cleanAllTables` passou a limpar `videos` primeiro (FK).
  - O teste de migrations agora cobre 3 migrations; o teste de reversão verifica a remoção da tabela `videos` e do enum.
  - Os 10 arrays `ALL_ENTITIES` duplicados poderiam virar uma constante compartilhada em `src/test/` — refatoração fora do escopo deste SI (task separada).

### SI-03.4 — Endpoint POST /videos (pré-cadastro do rascunho e início do upload)
- **Status:** completed
- **Tests:** 22 unit/integration passing (5 suítes) + 6 e2e passing (`test/videos-initiate-upload.e2e-spec.ts`, da spec); regressão `test/auth.e2e-spec.ts` 45 passing; `tsc --noEmit` exit 0; eslint limpo
- **Observations:**
  - O detector de violação de unicidade do Postgres estava privado em `channels.service.ts`; criado `src/common/database/pg-errors.ts` para os vídeos sem refatorar o código da Fase 02 — unificar o uso em `ChannelsService` é task separada.
  - Criado `test/helpers/e2e-app.ts` (bootstrap com a config global do `main.ts` + usuário registrado/confirmado/logado, limpando o throttler) para ser reutilizado pelos e2e das próximas specs de vídeo; o `MailService` é espionado direto pelo container (singleton).
  - `ChannelsService.findByUserId` adicionado (Tech action 4) e coberto no teste de integração existente de channels.
  - AC #8 (colisão de `public_id`) coberto pela integração (`videos.service.integration-spec.ts`) e pelo unit; sem cenário e2e, conforme o aviso do `/plan-test-specs`.
  - 1 tentativa de correção: lint apontou import não usado e variável descartada no e2e; ajustados.

### SI-03.5 — Endpoints de partes do upload: URLs pré-assinadas, listagem para retomada e abort
- **Status:** completed
- **Tests:** 27 unit/integration passing (`videos.service.spec.ts` + `videos.service.integration-spec.ts`) + 6 e2e passing (`test/videos-upload-parts.e2e-spec.ts`, da spec); regressão `test/videos-initiate-upload.e2e-spec.ts` 6 passing; `tsc --noEmit` exit 0; eslint limpo
- **Observations:**
  - `findOwnedVideo` carrega a relação `channel` e compara `channel.user_id` com o `sub` do JWT; vídeo inexistente e vídeo de outro canal retornam o mesmo `VIDEO_NOT_FOUND` (TD-17).
  - `assertDraft` também rejeita rascunho sem `upload_id`, garantindo que as operações de multipart nunca recebam um `UploadId` nulo.
  - Integração e e2e sobrescrevem `storageConfig` com `publicEndpoint = S3_ENDPOINT` (via `createE2eApp(customize)` no e2e), conforme o Setup da spec.

### SI-03.6 — Endpoint de conclusão do upload e publicação do job de processamento
- **Status:** completed
- **Tests:** 40 unit/integration passing (`videos.service.spec.ts`, `videos.service.integration-spec.ts`, `queue.module.spec.ts`, `videos.module.spec.ts`; Postgres + MinIO + Redis reais) + 5 e2e passing (`test/videos-upload-complete.e2e-spec.ts`, da spec); regressão dos e2e de vídeo anteriores e `GET /` verde (18 no total); Jest encerra sem open handles; `tsc --noEmit` exit 0; eslint limpo
- **Observations:**
  - A transição `draft → processing` é um update condicional (`WHERE status = 'draft'`); se nada for afetado (requisição concorrente), retorna `409 INVALID_UPLOAD_STATE` sem enfileirar.
  - Retry de `complete` com o vídeo já em `processing` re-adiciona o job com o mesmo `jobId` (ignorado pelo BullMQ, confirmado na doc via context7) e responde `200`, sem tocar no storage.
  - 2 tentativas de correção: (1) lint — fila do e2e tipada como `Queue<ProcessVideoJobData>`; (2) testes — `mockRejectedValue` vazava entre testes unitários (`clearAllMocks` não reseta implementações) e `getJobCounts` também devolve `paused`; ambos eram defeitos dos testes, não do service.

### SI-03.7 — Módulo de mídia: wrappers de ffprobe e ffmpeg
- **Status:** completed
- **Tests:** 20 passing (`media-probe.service.spec.ts` 9 + `thumbnail.service.spec.ts` 5 + `media-probe.service.integration-spec.ts` 4 + `thumbnail.service.integration-spec.ts` 2; ffprobe/ffmpeg reais no container); `tsc --noEmit` exit 0; eslint limpo
- **Observations:**
  - O runner é injetado pelo token `PROCESS_RUNNER` (`useValue: runProcess`), o que permite mockar o binário nos unit tests sem mexer no `child_process`. Os timeouts (`FFPROBE_TIMEOUT_MS` 60s, `FFMPEG_TIMEOUT_MS` 120s) ficam em `media.constants.ts`, porque o plano não define env var para eles.
  - Só exit ≠ 0 com stderr `Invalid data found when processing input` (AVERROR_INVALIDDATA, confirmado no container para bytes aleatórios) vira `InvalidMediaError`. Falhas de rede/storage (ex.: `403 Forbidden` na URL pré-assinada) e timeout propagam como `ProcessExecutionError`, para continuarem retentáveis no SI-03.8 (TD-15).
  - Os argumentos do `ffmpeg` incluem `-v error -y` além dos do plano. O `-y` evita que o ffmpeg trave esperando confirmação de overwrite no stdin quando o arquivo de saída já existe, e o `-v error` reduz o stderr capturado.
  - `frameRate` usa `avg_frame_rate` com fallback para `r_frame_rate`. `"0/0"` vira `null`, e o valor é arredondado a 3 casas (`30000/1001` → `29.97`).
  - `child_process.execFile` é API nativa do Node (sem lib npm), por isso não houve consulta ao context7. O comportamento do erro (`code` numérico, `killed`/`signal` no timeout) segue a API documentada do Node 25.6 do container.
  - 1 tentativa de correção: o lint apontou formatação do Prettier em 2 arquivos novos, corrigida com `eslint --fix`.

### SI-03.8 — Worker de vídeo: entrypoint standalone, processamento do job e serviço no Compose
- **Status:** completed
- **Tests:** 17 passing (`video-processing.service.spec.ts` 9 + `video-processing.service.integration-spec.ts` 3 + `video-processing.processor.integration-spec.ts` 4 + `worker.module.spec.ts` 1; Postgres, MinIO, Redis e ffmpeg reais); suíte completa com o `video-worker` no ar: `npm test` 245/245, `test:e2e` 69/69; `tsc --noEmit` exit 0; lint 0 erros (23 warnings pré-existentes)
- **Observations:**
  - Com o `video-worker` no ar, ele consumia os jobs que os testes do SI-03.6 publicam no mesmo Redis, e `videos.service.integration-spec.ts` falhava (job `active` em vez de `waiting`). Correção aprovada pelo usuário: nova env `QUEUE_PREFIX` (padrão `bull`, validada no Joi, no `.env.example`) repassada como `prefix` no `QueueModule`, e `src/test/setup-env.ts` (depois do `dotenv/config` no `setupFiles` do Jest unit e e2e) força `QUEUE_PREFIX=test`. Isso alterou arquivos dos SIs 03.1 e 03.6 (`queue.config.ts`, `env.validation.ts`, `queue.module.ts` + spec, configs do Jest).
  - Com o worker no ar, `migrations.integration-spec.ts` passou a falhar com `deadlock detected`, deixando o banco meio migrado e quebrando as suítes seguintes (unit e e2e). O log do Postgres mostrou o deadlock entre as próprias conexões do teste: os `DROP TABLE ... CASCADE` em `Promise.all` sobre tabelas ligadas por FK (`videos → channels`, desde o SI-03.3). O worker só muda o timing. Correção aprovada pelo usuário: um único `DROP TABLE IF EXISTS ... CASCADE` (e um único `DROP TYPE`). Sem o worker já passava (245/245), com o worker reproduziu 2 vezes, e depois da correção passou.
  - O `WorkerModule` importa o `UsersModule` só para registrar a metadata de `User`/`Channel`, que as relações de `Video` exigem. Sem isso o TypeORM não inicializa.
  - O handler `@OnWorkerEvent('failed')` roda a cada tentativa. Na `5.81.5`, `job.attemptsMade` já foi incrementado quando o evento dispara (conferido em `job.moveToFailed`), então `attemptsMade >= opts.attempts` identifica a última tentativa. Falha no `markFailed` dentro do handler é registrada em log, sem rethrow (exceção de background task de `nestjs-services.md`).
  - O teste do processor mantém `attempts: 3` e troca só o backoff por `fixed` de 50 ms, para não esperar os 10 s + 20 s do backoff exponencial.
  - TTL da URL interna do source em `SOURCE_URL_TTL_SECONDS` (900 s, em `video-processing.constants.ts`), já que o plano não define env var para isso.
  - Validação manual: `docker compose up -d video-worker` sobe e fica em execução; um job real no prefixo padrão (MP4 1280x720 de 4 s no MinIO) levou o vídeo a `ready` com `duration_seconds = 4`, metadados e `thumbnail_key`. O AC "API responde `GET /` durante o processamento" não foi verificado manualmente, porque o dev server da API não roda por padrão (`nestjs-project/CLAUDE.md`). Fica para a T3.3/SI-03.11.
  - Task separada: o `nestjs-api` (`start:dev`) e o `video-worker` (`start:worker:dev`) compilam ambos com `--watch` no mesmo `dist/` com `deleteOutDir: true`. Rodando juntos, um apaga a saída do outro ao reiniciar. Avaliar um `outDir` próprio para o worker.
  - 2 tentativas de correção: (1) unit — o mock do `extractFrame` não gravava o JPEG; o cenário passou a cobrir a falha do ffmpeg; (2) e2e — o caminho do `setup-env.ts` no `jest-e2e.json` é relativo a `test/` (`<rootDir>/../src/...`).

### SI-03.9 — Endpoint GET /videos/:publicId (consulta do vídeo e do status)
- **Status:** completed
- **Tests:** 37 unit passing (`videos.service.spec.ts`, 5 novos em `getVideo`) + 5 e2e passing (`test/videos-get.e2e-spec.ts`, da spec); regressão `test/videos-initiate-upload.e2e-spec.ts` 6 passing; `tsc --noEmit` exit 0; eslint limpo
- **Observations:**
  - O e2e aborta no MinIO os multipart uploads dos rascunhos antes de apagar as linhas, a cada teste, e não só no `afterAll` como em `videos-upload-parts.e2e-spec.ts`. Assim não acumulam uploads abertos no bucket.

### SI-03.10 — Endpoints de streaming, download e thumbnail via redirect pré-assinado
- **Status:** completed
- **Tests:** 58 unit/integration passing (`videos.service.spec.ts`, 8 novos em `getPlaybackUrl`; `content-disposition.util.spec.ts` 4; `videos.service.integration-spec.ts`, 3 novos com MinIO real) + 5 e2e passing (`test/videos-playback.e2e-spec.ts`, da spec); suíte completa `npm test` 265/265, `test:e2e` 79/79; `tsc --noEmit` exit 0; lint 0 erros (23 warnings pré-existentes)
- **Observations:**
  - O `Content-Disposition` do download é montado em `src/videos/content-disposition.util.ts`: `filename="…"` só com ASCII imprimível (aspas, barra invertida, caracteres de controle e não-ASCII viram `_`, o que também impede injeção de CR/LF no header) e `filename*=UTF-8''…` com o nome exato percent-encoded (RFC 5987).
  - `thumbnail` de um vídeo `ready` sem `thumbnail_key` responde `409 VIDEO_NOT_READY`. O worker sempre grava o thumbnail no sucesso, então é só uma guarda contra `null`, sem código de erro novo.
  - Os endpoints usam `@Redirect()` sem argumentos e retornam `HttpRedirectResponse` (`{ url, statusCode: 302 }`), conforme a doc do NestJS (context7). A geração da URL fica num helper privado do controller, compartilhado pelas três rotas.
  - AC #7 (URL expira após `PLAYBACK_URL_TTL_SECONDS`) coberto na integração: `jest.replaceProperty` reduz o TTL para 1 s, a URL responde `200` e, 2,5 s depois, `403`.
  - O e2e grava um JPEG mínimo (marcadores SOI/APP0/EOI) como thumbnail, porque a asserção é só sobre o `Content-Type` servido pelo storage.
  - Task separada (cosmético, fora de escopo): em `videos.service.ts`, o comentário sobre descartar o upload concluído está acima de `getVideo`, mas descreve `discardUpload`.

### SI-03.11 — Pipeline completo de ponta a ponta e artefatos de API (OpenAPI + api.http)
- **Status:** completed
- **Tests:** 9 e2e passing (`test/videos-pipeline.e2e-spec.ts` 2, `test/swagger.e2e-spec.ts` 7, 1 novo); suíte completa `npm test` 265/265, `test:e2e` 82/82; `tsc --noEmit` exit 0; lint 0 erros (23 warnings pré-existentes)
- **Observations:**
  - O pipeline sobe a API (`createE2eApp`) e, no mesmo processo, o `WorkerModule` inteiro via `Test.createTestingModule(...).init()` — o BullMQ registra o processor no `onModuleInit` (doc do NestJS, context7). Os dois lados só se falam pela fila no Redis.
  - Ambos os módulos sobrescrevem `queueConfig.KEY` com o prefixo `test-pipeline`, isolando os jobs do pipeline dos outros testes (prefixo `test`) e do container `video-worker` (prefixo `bull`).
  - O upload no teste segue o `upload.part_count`/`part_size_bytes` devolvidos pela API (a fixture de 3 s cabe numa parte de 100 MiB); a asserção "nenhum byte passa pela API" verifica que todo `PUT` vai para o host do MinIO.
  - Caminho de falha: bytes aleatórios com extensão `.mp4` passam pela allowlist, o ffprobe rejeita e o vídeo termina `failed`/`INVALID_MEDIA` após 1 tentativa; `stream` responde `409`.
  - `swagger.e2e-spec.ts` ganhou um teste que confere as 9 operações de `/videos`, a tag `videos` e que toda resposta ≥ 400 referencia `ApiErrorEnvelope`. O `openapi.json` foi regenerado com `npm run openapi:export`.
  - `api.http`: passos 10–19 (initiate → part-urls → `PUT` direto ao storage com o arquivo local `@videoFile` → parts → complete → get → stream/download/thumbnail com `@no-redirect` → abort), capturando `public_id`, URL da parte e `ETag` por response variables. A execução manual contra o Compose fica para a T3.3 (exige API e `video-worker` rodando).

### SI-03.12 — Atualizar a documentação de IA (CLAUDE.md e diagrama de arquitetura)
- **Status:** completed
- **Tests:** no tests (documentation only); ACs verificados por grep — nenhum "TBD" no `CLAUDE.md` da raiz nem no diagrama, os 9 endpoints de `/videos` conferidos contra `videos.controller.ts`, os 4 serviços contra o `compose.yaml`, os scripts `start:worker*` contra o `package.json`, as env vars contra o `.env.example` e todos os caminhos citados existem
- **Observations:**
  - `nestjs-project/CLAUDE.md` também ganhou as verificações de prontidão do Redis, MinIO e `minio-init` em "Environment Startup Verification" e a nota sobre o `src/test/setup-env.ts` (`QUEUE_PREFIX=test`) em "Jest Configuration" — ambos são comportamento do código desta fase que afeta como o agente sobe o ambiente e roda os testes.
  - O conflito de `dist/` entre `start:dev` e `start:worker:dev` (task separada registrada no SI-03.8) ficou documentado como aviso no `nestjs-project/CLAUDE.md`, sem correção.
