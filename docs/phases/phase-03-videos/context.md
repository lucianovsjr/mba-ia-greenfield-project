---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-10-25T19:00:59-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T21:04:59-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-25T19:00:59-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-10-25T19:00:59-03:00"
  docs/decisions/technical-decisions-next-frontend-msw-foundation.md: "2026-10-25T19:00:59-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-25T19:00:59-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-25T19:00:59-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-25T19:00:59-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-25T19:00:59-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** The phase section does not name any subproject (no `nestjs-project` / `nextjs-project` mention and no `Subprojetos:` line).

**Deferred subprojects:** _None._

**Sequencing notes:** "> Depende de: Fase 01, Fase 02" (intro line: "Upload de arquivos grandes sem travar o sistema, processamento automático do vídeo e geração de URL única.")

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta — "Fluxo completo de criação de conta, confirmação por e-mail, login, logout e recuperação de senha." (Depende de: Fase 01)
- **Phase 04:** Gerenciamento de Vídeos e Canal — "Edição das informações do vídeo, fluxo de rascunho e publicação, painel de administração do canal e página pública." (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Backend | Queue Technology for Background Processing | decided | A (BullMQ + Redis via `@nestjs/bullmq@11.x`) | — |
| phase-03-videos/TD-02 | phase | Repo-wide | Local S3-Compatible Storage Server Image | decided | A (`pgsty/minio` pinned RELEASE tag + `pgsty/mc` bootstrap) | — |
| phase-03-videos/TD-03 | phase | Backend | S3 Client Library and Endpoint Strategy | decided | A (AWS SDK v3, internal endpoint for ops + public endpoint for presigning) | — |
| phase-03-videos/TD-04 | phase | Backend | Bucket and Object Key Layout | decided | A (Single private bucket, keys grouped by video id) | — |
| phase-03-videos/TD-05 | phase | Cross-layer | Upload Protocol for Files up to 10GB | decided | C (Presigned multipart upload orchestrated by the API) | — |
| phase-03-videos/TD-06 | phase | Cross-layer | Upload Completion and Processing Trigger | decided | A (Client calls API "complete" endpoint; API completes and enqueues) | — |
| phase-03-videos/TD-07 | phase | Backend | Video Worker Runtime and Packaging | decided | A (Same `nestjs-project` codebase, separate entrypoint + Compose service) | — |
| phase-03-videos/TD-08 | phase | Backend | FFmpeg/ffprobe Integration | decided | A (System FFmpeg + direct `child_process`) | — |
| phase-03-videos/TD-09 | phase | Backend | Worker Access to the Source Video | decided | B (ffprobe/ffmpeg read from short-lived presigned GET URL) | — |
| phase-03-videos/TD-10 | phase | Backend | Thumbnail Frame Selection and Image Format | decided | B (Frame at ~10% of duration, JPEG) | — |
| phase-03-videos/TD-11 | phase | Backend | Video Metadata Persistence Shape | decided | B (Typed `duration_seconds` + `size_bytes`, curated JSONB `metadata`) | — |
| phase-03-videos/TD-12 | phase | Cross-layer | Unique Public Video Identifier (URL Strategy) | decided | B (Random 11-char base64url `public_id` via `node:crypto`, unique index + retry) | — |
| phase-03-videos/TD-13 | phase | Cross-layer | Streaming and Download Delivery | decided | B (Authorize in API, 302 to short-lived presigned GET; attachment variant for download) | — |
| phase-03-videos/TD-14 | phase | Backend | Video Status Lifecycle | decided | A (`draft → processing → ready \| failed`) | — |
| phase-03-videos/TD-15 | phase | Backend | Processing Failure, Retries and Idempotency | decided | A (Queue-native retries w/ exponential backoff; unrecoverable for invalid media; `failed` after final attempt) | — |
| phase-03-videos/TD-16 | phase | Backend | Upload Limits, URL Expiration and Abandoned Uploads | decided | A (Validate at initiate and complete + storage-native cleanup) | — |
| phase-03-videos/TD-17 | phase | Backend | Access Rules for Upload, Status, Streaming and Download | decided | A (Owner-only in Phase 03, 404 for non-owners) | — |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-02, phase-03-videos/TD-03, phase-03-videos/TD-04 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01, phase-03-videos/TD-07 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-05, phase-03-videos/TD-16, phase-03-videos/TD-17 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-14 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-06, phase-03-videos/TD-08, phase-03-videos/TD-09, phase-03-videos/TD-11, phase-03-videos/TD-14, phase-03-videos/TD-15 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-08, phase-03-videos/TD-10 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-12 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-13, phase-03-videos/TD-17 |
| Download do vídeo pelo usuário | phase-03-videos/TD-13, phase-03-videos/TD-17 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** It is the only option with a first-party NestJS 11 integration *and* native job semantics this phase needs (attempts, exponential backoff, `jobId` dedup, unrecoverable errors), all in CJS-compatible packages that work with the project's Jest setup. The cost is one extra Compose service and the non-atomic enqueue, which TD-06/TD-15 handle by making the status transition and the job idempotent. pg-boss (B) would avoid new infra, but its ESM-only current major and lack of a NestJS module add more risk than Redis adds cost.
**Libraries:** —

### phase-03-videos/TD-02

**Recommendation:** It keeps the exact server the architecture and `DESAFIO.md` describe (MinIO), with reproducible pinned tags, and needs no build. The application only talks S3 (TD-03), so switching later to S3 in production — or to another image — touches only `compose.yaml`. The fork's provenance is the accepted trade-off for a local-only dev/test service.
**Libraries:** —

### phase-03-videos/TD-03

**Recommendation:** It is the only option that supports per-part presigning for multipart (required by TD-05), runs on NestJS 11, and points unchanged at AWS S3 in production. Endpoint strategy: use **two client configurations from one `storage` config namespace**. The internal client (`S3_ENDPOINT=http://minio:9000`, the Compose service name per `CLAUDE.md`) runs server-side operations. A presign-only client (`S3_PUBLIC_ENDPOINT`, the address reachable by the HTTP client) signs every URL handed to callers outside the Docker network. The worker presigns with the internal endpoint (TD-09). The `S3_PUBLIC_ENDPOINT` is the only storage host that is not the service name, because it is consumed outside Docker.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** It is the simplest layout that serves every Phase 03 capability. It keeps all access decisions in the API (consistent with TD-13/TD-17), and it does not expose draft thumbnails publicly before Phase 04 defines visibility. The bucket is created by a one-shot `mc` bootstrap service in Compose (TD-02).
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** It is the only option that keeps the API completely out of the 10GB data path, works past the 5 GB single-PUT ceiling, and provides resume natively, all with the S3 SDK chosen in TD-03. The extra client complexity is the inherent cost of resumable direct uploads. Limits (part size, URL TTL, max size) are in TD-16; completion and trigger are in TD-06.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** It keeps the trigger inside the API's service layer with one storage-agnostic code path (MinIO locally, S3 in production). It gives the client a synchronous acceptance result and is straightforward to cover with e2e tests. Event notifications (B) would tie the pipeline to MinIO-specific configuration for no Phase 03 benefit.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** It gives the process isolation the architecture requires while reusing every existing module and convention (config namespaces, TypeORM, Jest). That avoids the duplication and contract drift of a separate project. The API imports only the producer side (queue registration). The worker imports the consumer side and the processing services.
**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** The only maintained wrapper option is deprecated (B). Bundled binaries (C) clash with the project's bind-mounted `node_modules` between the macOS host and the Linux container. Installing `ffmpeg` in the image is one Dockerfile line, and the typed wrapper is small and fully unit-testable.
**Libraries:** —

### phase-03-videos/TD-09

**Recommendation:** Phase 03 only extracts metadata and one frame, so transferring the full 10GB (A) is pure overhead. Piping (C) breaks common MP4 layouts. HTTP Range reads keep the worker's disk and network cost proportional to what it actually reads.
**Libraries:** —

### phase-03-videos/TD-10

**Recommendation:** Better than a fixed early timestamp at the same cost, and deterministic for tests. JPEG is universally renderable and is the conventional thumbnail format. The `thumbnail` filter (C) can be revisited in Phase 04, which introduces custom thumbnails.
**Libraries:** —

### phase-03-videos/TD-11

**Recommendation:** The capability names duration explicitly and future phases display it, so it deserves a typed column. The rest of "metadados" is descriptive and benefits from a flexible but curated JSONB, typed in code, without raw tool output in the domain.
**Libraries:** —

### phase-03-videos/TD-12

**Recommendation:** It is the only option that is both short and non-enumerable. Non-enumerability matters because Phase 04 introduces unlisted videos reachable "somente via link". The unique index guarantees "sem conflito" regardless of probability. Using `node:crypto` avoids `nanoid@6`, which is ESM-only and whose `engines` field (`^22 || ^24 || >=26`) excludes the container's Node 25.
**Libraries:** —

### phase-03-videos/TD-13

**Recommendation:** It satisfies streaming via native Range/206 in storage and keeps multi-GB reads out of the API, mirroring the upload decision (TD-05) and the diagram. Access control stays in the API at URL-issuing time. A short TTL bounds URL sharing, an acceptable trade-off since Phase 05 will make watching anonymous anyway.
**Libraries:** —

### phase-03-videos/TD-14

**Recommendation:** It covers both capabilities with the smallest state machine and matches the challenge's stated lifecycle. Conditional transitions make worker retries idempotent (TD-15). The Phase 04 interplay is noted explicitly so that phase can decide how to model publication, without speculating about it in Phase 03.
**Libraries:** —

### phase-03-videos/TD-15

**Recommendation:** It gives resilient processing for transient issues and fast, explained failure for bad files, using only queue features already chosen. A DLQ/reprocess flow (C) has no capability behind it in this phase.
**Libraries:** —

### phase-03-videos/TD-16

**Recommendation:** It enforces the 10GB requirement robustly without placing the API in the data path, and reclaims abandoned bytes with zero application code. The sweeper (B) solves a row-cleanup problem no Phase 03 capability asks for.
**Libraries:** —

### phase-03-videos/TD-17

**Recommendation:** It satisfies every Phase 03 capability (the uploader can stream and download their own video) without pre-empting Phase 04's publication/visibility rules or Phase 05's anonymous access. Relaxing access later is additive (`@Public()` + checks), while restricting already-public videos would be a breaking change.
**Libraries:** —

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.

**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.

**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.

**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.

**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.

**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.

**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller; social login is not on the near-term roadmap, so the plugin-architecture benefit did not justify the extra abstraction layer.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.

**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.

**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.

**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.

**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.

**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.

**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.

**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`), trading token size and base64-readability for a single token format across the codebase.

**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.

**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Three reasons. (1) **Architectural fit.** The strict-BFF model in `next-frontend-config-base/TD-03` already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and Auth.js's framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority — Auth.js's value (DB adapters, OAuth providers, magic-link, `getServerSession` helpers) is mostly unused in this configuration. (2) **Smaller blast radius.** A ~50-LOC session helper is grep-friendly, debuggable, and test-friendly via the existing MSW+BFF integration test pattern; a misconfigured Auth.js callback is a longer fault-isolation loop. (3) **Compatibility with Next.js 16 / React 19.** Built-in `next/headers` `cookies()` is the canonical primitive both runtimes already use; Auth.js v5 versions track Next.js majors with a lag, adding compatibility risk that Option A does not have. Option C is rejected as unsafe (`localStorage` for refresh tokens) and architecturally regressive (loses RSC personalization).
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** Three reasons. (1) **Defense in depth on the cookie content** — `httpOnly` blocks JS, encryption blocks accidental log/proxy inspection; the marginal cost is one ~3KB dep. (2) **Single cookie to manage** simplifies logout (one `session.destroy()` call) and avoids the orphan-cookie failure mode of Option A. (3) **Room to carry minimal user metadata** (`userId`, `email`, `channelSlug`) lets `app/layout.tsx` RSC render the authenticated chrome (avatar, channel name) without a per-render `/auth/me` round-trip — Phase 04+ gains compound here. Option A is a viable downgrade if the team rejects `iron-session` for any reason; the migration A→B (or B→A) is a one-Route-Handler refactor with no test changes downstream because the BFF interface is unchanged. Option C is rejected: it solves a problem (server-side revocation) the project does not have at the cost of infrastructure the project does not own.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** The single-flight detail is non-trivial and goes in the helper from day one — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Option B's client-driven pattern is rejected because it doesn't replace Option A (RSC still needs server-side refresh) — adopting B means doing both. Option C's pre-emptive timer is rejected because the failure modes (multiple tabs, sleep/wake) outweigh the latency saving and force a `"use client"` shell near the root.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** Three reasons. (1) **Decoupled from TD-05** — works with Route Handlers OR Server Actions; the form code does not change if TD-05 is revisited later. (2) **Aligned with shadcn's canonical form primitive** — the project already commits to `radix-nova` shadcn (`components.json`); `npx shadcn@latest add form` produces react-hook-form wrappers; choosing react-hook-form means using the supported primitive instead of hand-rolling around it. (3) **Zod-first developer ergonomics match the rest of the FE foundation** — `next-frontend-config-base/TD-01` chose Zod 4 for env; the same schemas-as-source-of-truth pattern carries to forms with zero new validator paradigm. Option B is rejected for impedance with shadcn's primitive and for over-investing in progressive-enhancement that the strict-BFF model does not require. Option C is rejected for the per-field boilerplate and the loss of client-side feedback on a project that values quick, type-safe form iteration.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Three reasons. (1) **Strict-BFF alignment.** `next-frontend-config-base/TD-03` named Route Handlers as the BFF surface; Option A keeps every mutation visible under `app/api/**`. (2) **Test scaffold already exists** — `next-frontend/CLAUDE.md` § Testing and `next-frontend-msw-foundation` were authored for Route-Handlers-as-functions; Option A reuses them with zero invention. (3) **Single mutation surface** — Phase 02 sets the precedent for Phases 03–07; uniformity beats per-mutation idiom-picking when the cost of inconsistency compounds (Option C). Option B has real ergonomic appeal for the simplest forms but fragments the BFF surface and forces test-pattern reinvention; if the team later wants progressive enhancement for specific forms, the migration A→B is per-form and doesn't require touching unrelated routes — A is the safer default and the cheaper baseline.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Two reinforcing reasons. (1) **No first-render flicker, no round-trip** — the session is delivered in the same response as the page HTML; the Client Provider hydrates with the correct initial state; users never see "Login" briefly turn into their avatar. (2) **No new BFF endpoint** — the cookie is the source of truth, RSC reads it, the Provider broadcasts it; the BFF surface stays minimal. The `router.refresh()` requirement after mid-session mutations is a small price (one line in the relevant mutation handler) for the structural benefits. Option B is rejected for the double-read-and-flicker; Option C is dominated by Option B and rejected.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** Three reasons. (1) **First-paint-correct** — the user sees the right outcome on the first paint, no skeleton, no flicker. (2) **Single integration pattern across both flows** — confirmation is RSC-only; reset is RSC + Client form (TD-04, TD-05 patterns reused) — both share the "RSC owns the token, Client Component owns the input" split. (3) **Email-prefetch behavior** is solved at the backend's idempotent-confirmation level (a small note for `/plan-build` to confirm; not a separate TD). Option B's Route-Handler-as-link-target adds redirects for no clean gain. Option C is dominated.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** é a única opção que preserva as decisões anteriores (`class-validator` em TD-06 de phase-02-auth) sem re-platform; o CLI plugin com `classValidatorShim: true` aproveita os decoradores `class-validator` existentes para inferir schemas, mantendo o boilerplate baixo. Nestia tem mérito técnico real mas o custo de migração do stack de validação inviabiliza-a sem uma decisão upstream de supersede de TD-06. Manual authoring é descartado.
**Libraries:** @nestjs/swagger
**Revisions:**
- 2026-05-12 — Esclarece que o CLI plugin (`classValidatorShim: true`) cobre apenas inferência de schemas de DTOs a partir de `class-validator`; documentação de operações, respostas tipadas por status code, contratos de erro (alinhados ao envelope de phase-02-auth/TD-07) e exemplos exigem decoradores explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). _Rationale:_ openapi.json gerado pelo bootstrap atual está genérico — sem detalhes de parâmetros, schemas de retorno por status, nem contratos de erro — porque a base instalada se apoiou só na introspecção automática. Esta revisão fixa que enriquecimento via decoradores explícitos faz parte da Option A escolhida, não é trabalho fora do escopo do TD.

### openapi-docs-nestjs/TD-02

**Recommendation:** o custo marginal sobre Option A é apenas um npm script (~15 linhas) e o benefício é uma fundação correta para futura integração FE (codegen offline) sem perder a UI interativa que dev/QA usam. Option B sozinho pune a experiência de desenvolvimento em dev/local; Option A sozinho compromete o pipeline de codegen futuro. Combinar é dominante.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** alinha com a postura defensiva já estabelecida em phase 02 e não compromete consumidores legítimos (o `openapi.json` commitado em TD-02 cumpre o papel de "spec consultável fora da UI"). Re-abrir como Option A ou C é trivial no futuro se um caso de uso de API pública aparecer.
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Three converging reasons: (1) **Type-inference matches the FE's strict-TS culture** — `lib/env.ts` exports a typed `env` object with no `as` casts, satisfying the project's "Type Safety" working principle. (2) **Ecosystem gravity in Next.js / React 19** — Zod is the de-facto schema language for App Router (Server Actions inputs, form resolvers, future contract validation), so introducing it once at the env layer compounds value for forms in Phase 02+. (3) **Direct enablement of TD-02 Option A (`@t3-oss/env-nextjs`)** — t3-env's first-citizen validator. Backend parity with Joi is not load-bearing: env schemas are not shared FE↔BE (different runtimes, different key sets); two validators across two subprojects is a bounded cost.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** The only option that combines (i) **type-level NEXT_PUBLIC_ prefix enforcement**, (ii) **runtime Proxy-based leak detection**, and (iii) **single-file, single-import-path consumer ergonomics**. Option B reaches roughly the same _structural_ outcome at higher implementation and maintenance cost, with a weaker guarantee (no prefix enforcement, no proxy). Option C is unsafe at any non-trivial team size. The marginal cost over B is one ~3KB dep — well-spent for the strongest boundary among the three.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Aligned with the BFF testing strategy and architectural commitment already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller; BFF tests stub `fetch` via MSW). Eliminates CORS, eliminates public exposure of the backend URL, and produces the smallest correct foundation. Option B's `NEXT_PUBLIC_API_URL` is a future-proofing concession with no current consumer — and adding a public key later is a non-breaking change, while removing one is breaking. Option C ties a foundational decision to infra work explicitly deferred elsewhere. The Docker networking gap (how server-in-container resolves the backend) is a separate orthogonal decision.
**Libraries:** —

### next-frontend-msw-foundation/TD-01

**Recommendation:** Three reasons. (1) **MSW's own best-practice recommends it** — the project should not invent its own scheme when the official one is documented and matches the codebase's domain orientation. (2) **Domain ownership tracks the codebase**, not the project plan — `components/`, `app/api/`, and any future feature folders will be organized by domain (auth, videos, channels), so handler files mirror that vocabulary and remain stable as phases come and go. (3) **Append-only growth with minimal merge conflicts** — each phase touches a new file plus one line in the barrel, which is the smallest practical concurrent-PR footprint. Option A is acceptable through Phase 02 alone (~5–7 endpoints) but accumulates costs that B avoids from day one; bootstrapping directly into B costs one extra file and one barrel and pays off by Phase 03. Option C's phase coupling is rejected outright — domain-by-phase is a category error.
**Libraries:** —

### next-frontend-msw-foundation/TD-02

**Recommendation:** The browser worker is a future capability with no documented current consumer; wiring it now (Option B) is speculative investment, and wiring it incoherently (Option C) actively misleads developers into thinking interception works when it doesn't under strict BFF. Option A keeps the foundation minimal, aligns 1:1 with everything CLAUDE.md and the existing rules currently document, and is non-breaking to extend.
**Libraries:** —

### next-frontend-msw-foundation/TD-03

**Recommendation:** Reasons: (1) **Option B's determinism + readability is the right baseline** — every fixture in Phase 02 (5–7 endpoints, single-record-mostly) is naturally hand-written, and the diff-revealing override pattern is the highest-value benefit. (2) **Bulk-collection cases will arrive (Phase 07 home page grid, Phase 06 comment threads) and inline hand-written lists of 20+ items are genuinely tedious** — keeping faker available as a scoped tool is pragmatic. (3) **Per-fixture local seeding eliminates the global-cursor pitfall** that makes Option C structurally fragile — using `faker.seed(N)` immediately before a collection-builder run scopes the determinism to that fixture and isolates it from upstream changes to other factories.
**Libraries:** —

### next-frontend-msw-foundation/TD-04

**Recommendation:** The user's "import only what it needs" requirement is satisfied at the *authoring* layer by TD-01 (per-domain files; each phase adds one file). At the *runtime* layer, loading all handlers is the canonical MSW v2 model and imposes no cost on tests that don't fetch the extra URLs. `onUnhandledRequest: "error"` enforces that a phase's test cannot accidentally invoke a route outside its scope (the fetch fails loudly with "no handler matched"), which is the strongest version of "stays inside its phase" available. Option B's per-suite composition pays real boilerplate cost for an explicitness gain that TD-01 already provides at a different layer. Option C invents a Vitest-projects-shaped problem for a phase-shaped concern.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions... _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function... _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and... _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning... _(from phase 01)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. Documented as a known gap. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | a tela de confirmação da conta não será implementada nesta fase corrente, será adiada — the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per Non-UI rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

_Source: `testing-guide-nestjs-project` skill, §3 Feature Implementation Checklist. Supporting references for external systems (storage, queue) live in the skill's `references/external-systems.md`._
