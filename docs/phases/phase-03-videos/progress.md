# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 4/12 completed

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
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.6 — Endpoint de conclusão do upload e publicação do job de processamento
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Módulo de mídia: wrappers de ffprobe e ffmpeg
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — Worker de vídeo: entrypoint standalone, processamento do job e serviço no Compose
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — Endpoint GET /videos/:publicId (consulta do vídeo e do status)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Endpoints de streaming, download e thumbnail via redirect pré-assinado
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.11 — Pipeline completo de ponta a ponta e artefatos de API (OpenAPI + api.http)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — Atualizar a documentação de IA (CLAUDE.md e diagrama de arquitetura)
- **Status:** pending
- **Tests:** —
- **Observations:** none
