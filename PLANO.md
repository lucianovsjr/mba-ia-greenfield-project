# PLANO — Fase 03: Upload e Processamento de Vídeos

Plano de execução do desafio descrito em [DESAFIO.md](DESAFIO.md). Cada task tem um objetivo, o comando/skill usado, o artefato gerado e um critério de pronto. As tasks seguem o workflow do projeto (`research → plan-context → plan-validate ⇄ plan-resolve → plan-build → implement`) e devem ser executadas **em ordem**.

> **Importante:** este documento organiza o *processo*. As decisões técnicas (fila, upload, streaming etc.) e o fatiamento em `SI-03.x` **não** são definidos aqui: eles saem dos artefatos gerados pelas skills. As opções citadas abaixo são apenas candidatas a avaliar no research, não decisões.

> Este arquivo é **versionado** e deve ser mantido atualizado: toda atividade nova que surgir entra aqui (na etapa correspondente) e é commitada junto com o trabalho da branch em que surgiu.

**Legenda:** `[ ]` pendente · `[x]` concluída

---

## Etapa 0 — Setup e linha de base

### T0.1 — Preparar branches (Git Flow)
- [x] Garantir que `dev` está atualizada a partir de `main` (estavam iguais).
- [x] Commitar o `PLANO.md` junto com o `DESAFIO.md` na branch `docs/desafio-fase-03` e fazer o merge dela na `dev`.
- [ ] Criar as branches de trabalho a partir da `dev` (cada uma só depois do merge da anterior):
  - `bugfix/baseline-lint-and-tests` — correção dos problemas pré-existentes (T0.4).
  - `feature/mcp-context7` — configuração do MCP context7 (T0.5).
  - `docs/phase-03-planning` — research + artefatos de planejamento (Etapas 1–2).
  - `feature/phase-03-videos` — implementação (Etapa 3), criada da `dev` após o merge do planejamento.
- **Pronto quando:** nenhuma alteração for feita diretamente na `main`; o trabalho acontece em branches `docs/*` / `bugfix/*` / `feature/*` saídas da `dev`.

### T0.2 — Subir o ambiente atual e confirmar a suíte verde
- [x] `cd nestjs-project && docker compose up -d` (ver "Notas do ambiente local" abaixo).
- [x] `docker compose exec nestjs-api npm install`
- [x] `docker compose exec nestjs-api npm run migration:run`
- [x] Rodar e registrar o baseline (dentro do container):
  - `npm test -- --runInBand` → ❌ 143/144 (falha `src/database/migrations.integration-spec.ts`) e o Jest não encerra após o resumo.
  - `npm run test:e2e` → ✅ 52/52.
  - `npx tsc --noEmit` → ✅ exit 0.
  - `npm run lint` → ❌ 150 erros / 40 warnings.
- [x] Baseline verde após a T0.4: `npm test` 144/144 (Jest encerra sozinho), e2e 52/52, `tsc` exit 0, lint 0 erros (23 warnings).
- **Pronto quando:** as quatro verificações passarem no estado atual (Fases 01–02). Falhas viram task separada (T0.4) — não misturar com a Fase 03.

**Notas do ambiente local** (específicas da máquina de desenvolvimento):
- Runtime Docker é o Colima (`colima start`).
- O plugin `docker compose` não está registrado no Docker CLI; usar o binário `docker-compose`.
- `.env` criado a partir do `.env.example` (idêntico após a correção da T0.4).

### T0.3 — Verificar a fundação de IA
- [x] MCP Postgres conectado e consultando o banco do Compose.
- [x] MCP context7 conectado (configurado na T0.5).
- [ ] Ler como referência de formato: `docs/phases/phase-02-auth/` (context, validation, plano, progress) e `docs/decisions/technical-decisions-phase-02-auth.md`.
- [ ] Ler as rules relevantes em `.claude/rules/` (layer separation, modules, services, controllers, DTOs, entities, typeorm-migrations, typeorm-queries, testing, typescript-strict).
- **Pronto quando:** context7 responde a uma consulta e o MCP Postgres consegue consultar o banco do Compose.

### T0.4 — Corrigir problemas pré-existentes do baseline (`bugfix/baseline-lint-and-tests`)
- [x] `src/database/migrations.integration-spec.ts`: o `beforeAll` remove as tabelas mas não o tipo `verification_tokens_type_enum`, então a suíte falha sempre que o banco já está migrado e deixa o banco meio migrado. → o `beforeAll` passa a remover também os tipos enum.
- [x] Jest (`npm test`) não encerra após imprimir o resumo. → causa: o `afterAll` do teste de migration lançava erro antes do `dataSource.destroy()`, deixando o pool do Postgres aberto. Corrigido junto com o item acima (`try/finally`).
- [x] `npm run lint`: 150 erros. → mocks e respostas tipados (helper do Mailpit, corpo das respostas no e2e, entidades nos specs, erro do Postgres em `channels.service.ts`) e `unbound-method` desligado só para arquivos de teste, conforme a documentação do typescript-eslint.
- [x] `.env.example`: `MAIL_FROM` sem aspas quebra o parse do Docker Compose (`unexpected character "<"`). → valor entre aspas simples, preservando o valor original.
- [x] Definition of Done completa (suíte + e2e + tsc + lint).
- [x] Merge na `dev`.
- **Pronto quando:** baseline 100% verde na `dev`.

### T0.5 — Configurar o MCP context7 (`feature/mcp-context7`)
- [x] Adicionar o servidor context7 ao `.mcp.json` versionado (e ao `.mcp.json.example`), conforme o README oficial do context7: servidor remoto HTTP `https://mcp.context7.com/mcp`, com a API key opcional via `${CONTEXT7_API_KEY:-}` (nenhum segredo versionado).
- [x] Documentar a variável opcional `CONTEXT7_API_KEY` no `CLAUDE.md` (seção "Library Documentation Lookup").
- [x] Habilitar o servidor no Claude Code (`enabledMcpjsonServers` no `.claude/settings.local.json`, local) — `claude mcp list` mostra `context7 ✔ Connected`.
- [x] Validar com uma consulta real de documentação (`resolve-library-id` respondeu via HTTP).
- [ ] Reiniciar a sessão do Claude Code para carregar as ferramentas do context7 e confirmar uma consulta pela própria sessão.
- [x] Merge na `dev`.
- **Pronto quando:** `claude mcp list` mostra o context7 conectado e uma consulta retorna documentação.

---

## Etapa 1 — Research (decisões técnicas)

### T1.1 — Rodar `/research` da Fase 03
- [ ] Executar `/research phase 03` (phase mode — escopo = bullets da Fase 03 em `docs/project-plan.md`).
- [ ] Garantir que o documento cubra, no mínimo, as decisões exigidas pelo desafio, cada uma com opções, trade-offs, recomendação e o campo `Capability:` apontando para o bullet da fase:
  - [ ] **Tecnologia de fila** (decisão principal — o plano a deixa "TBD"). Candidatas a avaliar: BullMQ + Redis, RabbitMQ, fila em PostgreSQL (ex.: pg-boss), SQS/ElasticMQ.
  - [ ] **Estratégia de upload de até 10GB sem travar a API** (ex.: URL pré-assinada / multipart upload direto ao S3/MinIO, confirmação de conclusão do upload, expiração e limpeza de uploads abandonados).
  - [ ] **Uso do object storage** (MinIO local / S3 em produção — já dado): buckets, convenção de chaves de vídeo e thumbnail, cliente/SDK.
  - [ ] **Execução do worker** (processo/container separado; mesmo código-base ou projeto separado) e uso de **FFmpeg/ffprobe** para metadados e thumbnail (escolha do frame, formato da imagem).
  - [ ] **Gatilho do processamento** (quem publica o job e quando: confirmação do cliente vs. evento do storage).
  - [ ] **URL única** (formato do identificador público, garantia de unicidade/colisão).
  - [ ] **Streaming** (HTTP Range / `206 Partial Content` — proxy pela API vs. redirecionamento para URL pré-assinada) e **download** (ex.: `Content-Disposition`).
  - [ ] **Ciclo de status** (rascunho → processando → pronto/erro), retries, idempotência do job e comportamento em falha.
  - [ ] **Autorização** (quem pode iniciar upload, quem pode assistir/baixar — anônimo vs. dono, considerando o status).
- **Artefato:** `docs/decisions/technical-decisions-phase-03-videos.md` (frontmatter `scope_type: phase`, `related_phases: [3]`).
- **Pronto quando:** todas as TDs estiverem com status decidido, revisadas criticamente por mim, sem requisito inventado fora do escopo da Fase 03.

### T1.2 — Revisão crítica do research
- [ ] Conferir cada recomendação contra o enunciado (10GB sem passar pela API, infra real no Compose, nada de mock do que dá para rodar).
- [ ] Conferir que funcionalidades das Fases 04/05 (edição, publicação, visibilidade, player) **não** entraram no escopo.
- [ ] Refinar o prompt e reexecutar se alguma TD vier rasa.

---

## Etapa 2 — Planejamento (pipeline)

### T2.1 — `/plan-context 03`
- [ ] Gerar `docs/phases/phase-03-videos/context.md` (consolida project-plan, decisões, convenções das fases anteriores e testing guide).
- [ ] Revisar: capability coverage completo (todos os bullets da Fase 03 mapeados), convenções herdadas da Fase 02 presentes.

### T2.2 — `/plan-validate 03`
- [ ] Gerar `docs/phases/phase-03-videos/validation.md`.
- [ ] Ler as issues por categoria (inconsistências, decisões faltando, gaps de dependência).

### T2.3 — `/plan-resolve 03`
- [ ] Responder às pendências levantadas; atualizar decisões e `context.md`.
- [ ] Fixar as libs novas via **context7** (versões compatíveis com NestJS 11 / Node do projeto) → `docs/phases/phase-03-videos/library-refs.md`. Esperado: SDK S3, lib da fila escolhida, wrapper/binário FFmpeg (conforme decidido).
- [ ] Sinalizar qualquer divergência entre a doc retornada e a versão instalada.

### T2.4 — Iterar validate ⇄ resolve até `clean`
- [ ] Repetir T2.2 → T2.3 até `validation.md` terminar com **`status: clean`**.
- **Pronto quando:** veredito `clean`, sem issue aberta.

### T2.5 — `/plan-build 03`
- [ ] Gerar `docs/phases/phase-03-videos/phase-03-videos.md` com:
  - [ ] Step Implementations `SI-03.1`, `SI-03.2`, … (cada uma com arquivos, ações técnicas e seção de Tests).
  - [ ] Technical Specifications: **Data Model**, **API Contracts**, **Authorization Matrix**, **Error Catalog**, **Events/Messages** (payload do job, produtor, consumidor, retries).
  - [ ] **Dependency Map** e **Deliverables**.
- [ ] Revisão crítica do plano — checklist mínimo de cobertura:
  - [ ] Infra no `compose.yaml`: storage (MinIO + criação de bucket), fila, worker — usando nomes de serviço como host.
  - [ ] Namespaces de configuração/env para storage, fila e worker.
  - [ ] Entidade `Video` ligada a `Channel` + migration `<timestamp>-CreateVideos.ts` (id, canal, título, status, chaves de storage do vídeo e thumbnail, duração, metadados, identificador da URL única).
  - [ ] Início do upload com pré-cadastro como rascunho.
  - [ ] Conclusão do upload → publicação do job na fila.
  - [ ] Worker: consumo do job, ffprobe (duração/metadados), FFmpeg (thumbnail), upload do thumbnail, transição de status, tratamento de falha.
  - [ ] Consulta do vídeo/status, streaming (Range/206) e download.
  - [ ] Testes nos três níveis (`*.spec.ts`, `*.integration-spec.ts` contra MinIO/fila/Postgres reais, `*.e2e-spec.ts`).
  - [ ] Documentação OpenAPI dos novos endpoints (padrão do módulo `swagger/`).
  - [ ] SI final para atualizar o `CLAUDE.md`.
- [ ] *(Opcional)* `/plan-test-specs 03` se o plano tiver SIs com `**Test Specs:**`.

### T2.6 — Fechar o planejamento
- [ ] Revisar a coerência entre decisões ↔ context ↔ validation ↔ plano (nada no plano sem origem rastreável).
- [ ] Merge de `docs/phase-03-planning` na `dev` (commit somente com autorização).

---

## Etapa 3 — Implementação (`/implement 03`)

### T3.1 — Criar a branch de feature
- [ ] `git checkout dev && git checkout -b feature/phase-03-videos`.

### T3.2 — Executar os SIs em ordem
- [ ] Rodar `/implement 03`, SI a SI, respeitando o Dependency Map.
- [ ] Para cada SI:
  - [ ] Consultar context7 antes de usar qualquer lib (SDK S3, fila, FFmpeg, TypeORM, NestJS).
  - [ ] Seguir as rules do projeto (separação de camadas, repository pattern, transações, filtro de exceções de domínio, DTOs com class-validator).
  - [ ] Rodar os testes do SI; só avançar com a suíte do SI verde.
  - [ ] Atualizar `docs/phases/phase-03-videos/progress.md` (status + testes por SI, no formato da Fase 02).
- **Pronto quando:** todos os SIs estiverem `done` no `progress.md`.

### T3.3 — Validação funcional ponta a ponta (manual, além dos testes)
- [ ] `docker compose up -d` sobe API, Postgres, Mailpit, storage, fila e worker sem erros.
- [ ] Iniciar um upload → vídeo criado como rascunho no banco (conferir via MCP Postgres).
- [ ] Concluir o upload direto ao storage → job publicado → worker processa → status `pronto`, duração/metadados preenchidos, thumbnail no bucket.
- [ ] Vídeo inválido/corrompido → status de erro.
- [ ] Streaming responde `206 Partial Content` com header `Range`; download funciona.
- [ ] Validar o upload grande: arquivo de vários GB enviado sem passar pela API (a API continua respondendo durante o envio). Limite de 10GB aplicado conforme o plano.
- [ ] Atualizar `nestjs-project/api.http` com os novos endpoints, se for o padrão adotado no plano.

---

## Etapa 4 — Fechamento

### T4.1 — Definition of Done
- [ ] `npm test` verde.
- [ ] `npm run test:e2e` verde.
- [ ] `npx tsc --noEmit` com exit code 0.
- [ ] `npm run lint` sem erros.

### T4.2 — Atualizar a documentação de IA
- [ ] `CLAUDE.md` (raiz): estrutura do repositório e arquitetura com a fila definida (sai de "TBD"), worker e storage reais.
- [ ] `nestjs-project/CLAUDE.md`: seção de vídeos — módulo, endpoints, fila/worker, storage, novos serviços do Compose, comandos e env vars.
- [ ] Conferir que todo arquivo, endpoint ou comportamento citado existe no código.

### T4.3 — Revisão dos Critérios de Aceite (DESAFIO.md)
- [ ] Decisões e planejamento: todos os artefatos presentes; `validation.md` em `clean`; plano no formato do projeto.
- [ ] Feature: upload 10GB sem travar + rascunho; processamento + thumbnail; URL única; streaming + download; ciclo de status no banco.
- [ ] Infra/qualidade: storage, fila e worker no Compose; migration + entidade ligada ao canal; testes verdes; DoD completo; Git Flow respeitado.
- [ ] Documentação: `CLAUDE.md` coerente com o código.
- [ ] Checar a lista de **reprova automática** item a item.

### T4.4 — Integração e entrega
- [ ] Merge de `feature/phase-03-videos` na `dev` (com autorização).
- [ ] Com a `dev` estável, merge na `main` e push para o fork público.

---

## Ordem e dependências

```
T0.1 → T0.2 → T0.3 → T0.4 (bugfix baseline) → T0.5 (context7)
                                                    ↓
T1.1 → T1.2
          ↓
T2.1 → T2.2 ⇄ T2.3 (até clean) → T2.5 → T2.6
                                          ↓
                      T3.1 → T3.2 (SI a SI) → T3.3
                                               ↓
                         T4.1 → T4.2 → T4.3 → T4.4
```

## Fora de escopo (anotar como task separada se surgir)

- Interface de vídeo no `next-frontend/` (fora do escopo desta fase).
- Edição de informações do vídeo, publicação, visibilidade, categorias (Fase 04).
- Player, contagem de visualizações, sugestões (Fase 05).
- Correções ou refactors das Fases 01–02 não necessários para a Fase 03.
