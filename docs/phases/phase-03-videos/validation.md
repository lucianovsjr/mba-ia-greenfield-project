---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 3
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-25T21:13:22-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-25T21:04:59-03:00"
issues:
  - id: AMB-1
    status: open
    summary: "Pre-registration payload undefined: which video fields exist/are required at upload start"
  - id: AMB-2
    status: open
    summary: "Accepted upload formats undefined: TD-16 only says 'reject non-video types'"
  - id: AMB-3
    status: open
    summary: "Affected subprojects not declared for Phase 03 in project-plan.md"
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

- **AMB-1** — The capability "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload" does not say which video fields exist at pre-registration or where they come from. In particular, it does not say whether a title is required from the client at upload start, defaulted from the original filename, or left empty. The neighbor Phase 04 owns "Edição das informações do vídeo: título, descrição, categoria e thumbnail customizada". So the boundary between what Phase 03 stores at creation and what Phase 04 edits later is not fixed, and an implementer would have to ask which fields the initiate-upload request carries. Explicit choice: define the pre-registration payload. Candidates: (a) client sends `title` (required) plus file `size`/`contentType`; (b) title defaults to the original filename (sent by the client) and is editable in Phase 04; (c) title nullable until Phase 04. Record it as a TD (or a Revision of `phase-03-videos/TD-14`/`TD-16`) so `/plan-build` can write the Data Model and the initiate endpoint contract.
- **AMB-2** — `phase-03-videos/TD-16` rejects "non-video types" at initiate, and `phase-03-videos/TD-15` fails invalid media as unrecoverable after ffprobe. But no source states which formats are accepted. It is unclear whether any declared `video/*` content type is enough, whether there is an allowlist of containers/MIME types (e.g., `video/mp4`, `video/webm`, `video/quicktime`), and whether the file extension matters. The initiate DTO validation and the Error Catalog both depend on this. Explicit choice: fix the acceptance policy. Candidates: (a) any `video/*` declared type at initiate, with the real check delegated to ffprobe in the worker; (b) explicit MIME allowlist at initiate plus the ffprobe check. Record it as a Revision of `phase-03-videos/TD-16`.
- **AMB-3** — `## Scope` → **Affected subprojects** states that the Phase 03 section of `docs/project-plan.md` names no subproject, yet every current-scope TD is Backend / Cross-layer / Repo-wide work on `nestjs-project/`. The decisions doc's `_Subprojects in scope:_` note also excludes `next-frontend/` ("video interface out of scope"). `/plan-build` needs an explicit subproject list to scope SIs and Testing Requirements. Explicit choice: confirm that Phase 03 affects `nestjs-project/` only, with `next-frontend/` having no work in this phase, and record the frontend as a Non-UI / Deferred entry or the subprojects as a scope note so the plan does not have to infer it.

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._

## Resolved Issues

_No issues resolved yet._
