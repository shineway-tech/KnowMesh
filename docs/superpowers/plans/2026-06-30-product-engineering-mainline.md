# KnowMesh Product Engineering Mainline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the product engineering mainline from the current `0.1.0-alpha` foundation toward a trustworthy `1.0.0 Usable` KnowMesh: searchable assets, evidence-first query runtime, real K12 Expert, maintainable versions, provider boundaries, and ordinary-user local operation.

**Architecture:** `docs/current-design.md` remains the only design authority. The implementation must continue the SQLite-first Knowledge Asset Layer: `workspace.sqlite` for workspace state, one `catalog.sqlite` per knowledge base, artifact files on disk, JSON only for export/audit/sidecar/checkpoint/credential boundaries. The mainline is ordered to prevent rework: catalog search contracts first, then build manifests, then Query Runtime, then K12 Expert hardening, then maintenance/provider/platform productization.

**Tech Stack:** Node.js >= 24, ESM modules, `better-sqlite3`, SQLite WAL and FTS5, built-in `node:test`, local Web Console (`src/web-console`), local service modules (`src/local-service`), CLI launcher (`src/cli/knowmesh.mjs`).

---

## Non-Negotiable Execution Rules

- `docs/current-design.md` is the product and architecture source of truth. Do not create a competing blueprint.
- Do not revive JSON-first state. JSON/JSONL may appear only as export, audit, sidecar, credential, or checkpoint files.
- Do not build UI-only answer paths. Web Console and external integrations must call the same Query Runtime.
- Do not treat vector search as business truth. Catalog rows and version manifests are authoritative; vectors accelerate retrieval.
- Do not put K12 conditions in Core flow unless the template or Expert registry selected a declared K12 capability.
- Do not add compatibility shims for abandoned local drafts. Keep the one-time K12 migration preservation, then delete superseded flows.
- Do not let the large files grow without control. Any block that touches `src/local-service/local-executor.mjs`, `src/local-service/query-engine.mjs`, `src/local-service/server.test.mjs`, `src/web-console/app.js`, `src/web-console/pages.mjs`, or `src/web-console/styles.css` should first extract a focused helper or test file when the change is more than a small patch.
- Every block ends with `npm test`, `npm run smoke:release`, `npm run smoke:artifact`, `npm run verify:package-boundary`, and `git diff --check`.
- Before starting a block, list every round in that block and what each round will change, test, and prove.
- After completing a block, list every round in the next block with the same level of detail before implementing it.
- Do not start the next block until the current block acceptance checks pass and the next block's round plan has been stated.

## Current Baseline

Already present and should be preserved:

- `src/local-service/storage.mjs`: workspace and catalog migrations through catalog object relations, WAL, FTS tables for documents, structures, objects, and query feedback.
- `src/local-service/source-catalog.mjs`, `extraction-manifest.mjs`, `structure-sidecar.mjs`, `retrieval-manifests.mjs`, `index-records.mjs`, `version-manifest.mjs`: manifest readers/writers around catalog state.
- `src/local-service/query-runtime.mjs`, `query-engine.mjs`, `query-route-planner.mjs`, `query-structure-route.mjs`, `query-quality-gates.mjs`: first Query Runtime contract and route foundation.
- `src/local-service/k12-*.mjs`: K12 classifier, TOC, page ranges, objects, query router, readiness, evaluation runner, and source-scope gate.
- `src/local-service/document-inventory.mjs`, `maintenance-review.mjs`, `query-feedback.mjs`, `knowledge-versions.mjs`, `targeted-rerun.mjs`, `evaluation-dashboard.mjs`: maintenance surface foundations.
- `src/local-service/provider-capabilities.mjs`, `platform-runtime.mjs`, `package-manifest.mjs`: provider/platform/package preview foundations.
- Public repository foundation, README, CI, CodeQL, Scorecard, draft `v0.1.0-alpha`, and starter issues.

Important debt to retire during the mainline:

- `src/local-service/local-executor.mjs` is too large and owns too many provider, batch, artifact, and execution concerns.
- `src/local-service/query-engine.mjs` is too broad and mixes route planning, retrieval source selection, answer prompt, validation, and result shaping.
- `src/local-service/server.mjs` and `src/local-service/server.test.mjs` are route and integration bottlenecks.
- `src/web-console/app.js`, `src/web-console/pages.mjs`, and `src/web-console/styles.css` need gradual feature-slice extraction before adding major UI states.

---

## Block A: `0.2.0 Searchable` Catalog Retrieval Foundation

**Purpose:** Make a knowledge asset reliably searchable by keyword, structure, metadata, and provider/vector sidecar status before improving generated answers.

**Why first:** Query Runtime quality depends on stable evidence retrieval. If search contracts are weak, K12, feedback, and UI will all be rewritten later.

**Files:**

- Modify: `src/local-service/storage.mjs`
- Create: `src/local-service/catalog-search.mjs`
- Create: `src/local-service/catalog-search.test.mjs`
- Modify: `src/local-service/retrieval-manifests.mjs`
- Modify: `src/local-service/index-records.mjs`
- Modify: `src/local-service/query-engine.mjs`
- Modify: `src/local-service/server.mjs`
- Add focused tests instead of expanding `src/local-service/server.test.mjs` where possible.
- Modify: `src/web-console/pages.mjs`, `src/web-console/app.js`, `src/web-console/styles.css` only after API contracts pass.

### Round A1: Search Schema and Contract

**Goal:** Give catalog chunks a real local search contract without making JSON or vector stores the truth.

**Work:**

- [x] Add migration `005_catalog_chunk_search` in `src/local-service/storage.mjs`.
- [x] Add `chunks_fts` keyed to catalog chunk rows. Use bounded search text generated during write/sync; do not add unbounded source text to ordinary catalog tables.
- [x] Add filter indexes for the first search surface:
  - `chunks(document_id, quality_state, updated_at)`
  - `chunks(structure_node_id, quality_state)`
  - `citations(document_id, page_number)`
  - `index_records(provider, index_name, status)`
- [x] Update `src/local-service/content-catalog.mjs` so clean/OCR chunk writes also update `chunks_fts` in the same transaction.
- [x] Update `src/local-service/index-records.mjs` only where search-readiness state depends on index rows; keep vector rows diagnostic.
- [x] Create `src/local-service/catalog-search.test.mjs`.

**Tests to write:**

- [x] Keyword match returns the expected chunk and citation metadata.
- [x] Metadata filter limits by document/source fields.
- [x] Quality-state filter excludes `review`/`archive` by default when search is for query evidence.
- [x] Page filter returns only matching citation page ranges.
- [x] Structure filter returns only chunks under the selected structure node.
- [x] Updating/deleting a chunk keeps FTS rows from going stale.

**Verification:**

- [x] Run `npm test -- src/local-service/catalog-search.test.mjs src/local-service/knowledge-bases.test.mjs`.
- [x] Run `git diff --check`.

**Done when:** A catalog can answer local keyword/filter searches from SQLite alone, and stale chunk rows cannot remain searchable after catalog updates.

### Round A2: Catalog Search API

**Goal:** Expose catalog search through a stable local API that Query Runtime and Web Console can share.

**Work:**

- [x] Implement `searchCatalog(state, input)` in `src/local-service/catalog-search.mjs`.
- [x] Support input fields: `query`, `limit`, `offset`, `qualityStates`, `documentId`, `sourceType`, `pageStart`, `pageEnd`, `structureNodeId`, `includeReview`, and `purpose`.
- [x] Normalize default search purpose:
  - `purpose=queryEvidence`: exclude `review` and `archive` unless explicitly requested.
  - `purpose=maintenance`: include review states when filters ask for them.
- [x] Return stable evidence records with `chunkId`, `documentId`, `structureNodeId`, `title`, `pageNumber`, `qualityState`, `score`, `source`, `excerpt`, `citation`, `metadata`, and `links`.
- [x] Keep excerpts short and bounded; full text remains in artifacts.
- [x] Add `/api/search` and `/kb/:id/api/search` GET/POST handling in `src/local-service/server.mjs`.
- [x] Prefer a focused API test file if route coverage can avoid expanding `src/local-service/server.test.mjs` further.

**Tests to write:**

- [x] `/kb/:id/api/search` is scoped to the selected KB.
- [x] `/api/search` refuses or resolves correctly when no KB is selected; no implicit default KB appears.
- [x] Pagination returns stable `items`, `total`, `limit`, `offset`, and `hasMore`.
- [x] API never reads stale JSON sidecars as primary search state.
- [x] Response links point to scoped document asset and diagnostics routes.

**Verification:**

- [x] Run `npm test -- src/local-service/catalog-search.test.mjs src/local-service/server.test.mjs`.
- [x] Run `git diff --check`.

**Done when:** Search has a reusable service function and scoped HTTP API with stable response shape.

### Round A3: Retrieval Manifest Readiness

**Goal:** Make search/index readiness explainable before Query Runtime depends on it.

**Work:**

- [x] Extend `src/local-service/retrieval-manifests.mjs` to report readiness dimensions separately:
  - keyword readiness;
  - structure readiness;
  - citation readiness;
  - vector readiness;
  - OSS sidecar readiness;
  - consistency between catalog chunks, citations, sidecars, and vector records.
- [x] Extend `src/local-service/index-records.mjs` to normalize provider status into `pending`, `written`, `failed`, `disabled`, and `stale`.
- [x] Add diagnostics for:
  - vector record exists but chunk is missing;
  - vector record exists but sidecar pointer is missing;
  - chunk exists but citation is missing;
  - chunk is searchable locally but vector provider is unavailable;
  - provider/index mismatch after setup changes.
- [x] Keep local catalog search marked usable even when vector provider is missing.

**Tests to write:**

- [x] Local-only KB reports keyword/structure/citation readiness and vector disabled.
- [x] Aliyun KB with valid sidecar reports vector acceleration ready.
- [x] Aliyun vector records without OSS sidecar are blocked for vector retrieval.
- [x] Partial/stale index states produce user-fixable diagnostics.
- [x] Retrieval manifest does not leak source text.

**Verification:**

- [x] Run `npm test -- src/local-service/retrieval-manifests.test.mjs src/local-service/server.test.mjs`.
- [x] Run `git diff --check`.

**Done when:** Maintenance and Query Runtime can distinguish "searchable locally" from "vector acceleration ready" without guessing.

### Round A4: Searchable Web Console Surface

**Goal:** Let users inspect searchable evidence in the console without creating a separate UI-only search path.

**Work:**

- [x] Add a search panel to Maintain > Documents or a focused Maintain subtab, using `/api/search`.
- [x] Show filters for keyword, document, page range, quality state, source type, and structure path.
- [x] Display bounded excerpts, citation source, page number, quality state, and readiness flags.
- [x] Link each result to document asset view and diagnostics.
- [x] Reuse the same scoped API path helper used by other KB routes.
- [x] Keep UI text user-facing; avoid "FTS", "rowid", or provider internals in ordinary user copy.
- [x] Extract a focused frontend helper if adding the panel would significantly grow `src/web-console/app.js` or `src/web-console/pages.mjs`.

**Tests to write:**

- [x] Search form posts to the scoped `/api/search` endpoint.
- [x] Filters are serialized correctly.
- [x] Empty state is clear and does not imply build success.
- [x] Result links include the current KB scope.
- [x] Review/archive states are visible only when requested for maintenance.

**Verification:**

- [x] Run `npm test -- src/web-console/app.test.mjs src/local-service/catalog-search.test.mjs`.
- [x] Run `git diff --check`.

**Done when:** The Web Console can show what is searchable and why, using the same API that later feeds Query Runtime.

### Round A5: Block A Integration Gate

**Goal:** Close Block A as a coherent `0.2.0 Searchable` slice before planning and starting Block B.

**Work:**

- [x] Wire Query Runtime's hybrid/local evidence lookup to consume `searchCatalog()` only after A1-A4 are green.
- [x] Confirm existing K12 structure-first routes still take precedence over general catalog search.
- [x] Confirm Aliyun vector retrieval remains blocked when sidecar contract is invalid.
- [x] Update `ROADMAP.md`, `ROADMAP.en.md`, and docs index only if the public status wording changes.
- [x] Before starting Block B, list all Block B rounds and round contents in the user-facing progress update.

**Block verification:**

- [x] Run `npm test`.
- [x] Run `npm run smoke:release`.
- [x] Run `npm run smoke:artifact`.
- [x] Run `npm run verify:package-boundary`.
- [x] Run `git diff --check`.

**Done when:** Block A acceptance is met, the working tree is clean or only contains the intended Block A commit set, and Block B's detailed round plan has been stated.

**Block A acceptance:**

- A KB can be searched locally without vector provider configuration.
- Search results are scoped to the selected KB and include citation-ready source/page/structure metadata.
- Vector and sidecar states are diagnostic accelerators, not truth.
- No search path reads old JSON as primary state.

**Completion note (2026-06-30):** Block A is implemented. `chunks_fts`, `searchCatalog()`, `/api/search`, retrieval readiness diagnostics, Web Console evidence search, and Query Runtime catalog-search fallback are in place. Verification completed with the Block A test slice and the full block gate.

---

## Block B: Build Pipeline Contract Completion

**Purpose:** Make scan, extraction, structure, chunk, index, and publish version flows explicit and recoverable.

**Why second:** Search needs rows; Query Runtime needs trustworthy rows. The build pipeline must produce them consistently.

**Files:**

- Modify: `src/local-service/local-executor.mjs`
- Extract: `src/local-service/execution/source-archive.mjs`
- Extract: `src/local-service/execution/parser-provider.mjs`
- Extract: `src/local-service/execution/ocr-provider.mjs`
- Extract: `src/local-service/execution/embedding-provider.mjs`
- Extract: `src/local-service/execution/vector-writer.mjs`
- Extract: `src/local-service/execution/build-version-publisher.mjs`
- Modify: `src/local-service/jobs.mjs`
- Modify: `src/local-service/source-catalog.mjs`
- Modify: `src/local-service/extraction-manifest.mjs`
- Modify: `src/local-service/content-catalog.mjs`
- Modify: `src/local-service/version-manifest.mjs`
- Add focused tests near extracted modules.

### Round B1: Execution Boundary Extraction

- [x] Move source archiving and processing-input preparation out of `local-executor.mjs` into `execution/source-archive.mjs`.
- [x] Move OCR batching and retry contracts into `execution/ocr-provider.mjs`.
- [x] Move embedding batching and retry contracts into `execution/embedding-provider.mjs`.
- [x] Move OSS Vector write logic into `execution/vector-writer.mjs`.
- [x] Keep existing public behavior through thin calls from `local-executor.mjs`.
- [x] Preserve all existing local executor tests before changing behavior.
- [x] Verify with `npm test -- src/local-service/local-executor.test.mjs`.

### Round B2: Parser Provider Interface

- [x] Add a provider-neutral parser contract for readable PDF, Office, WPS-converted input, Markdown/TXT/CSV/TSV/RTF, image metadata, and scanned PDF page tasks.
- [x] Represent unsupported or unsafe formats as review items, not silent skips.
- [x] Ensure macro-capable Office files are never executed.
- [x] Add tests for parser classification, legacy Office converter availability, WPS path, and review-state fallback.
- [x] Verify with `npm test -- src/core/scanner.test.mjs src/local-service/local-executor.test.mjs`.

### Round B3: Manifest-First Write Flow

- [x] Write source manifest before extraction work starts.
- [x] Write extraction manifest per file/page state after each batch.
- [x] Write structure nodes and knowledge objects before chunks.
- [x] Write chunk and index manifests before publish.
- [x] Persist checkpoints after every provider batch in `jobs` and artifact checkpoint files.
- [x] Add crash/restart tests that resume after source archive, OCR, embedding, and vector write.
- [x] Verify with `npm test -- src/local-service/local-executor.test.mjs src/local-service/extraction-manifest.test.mjs src/local-service/retrieval-manifests.test.mjs`.

### Round B4: Publish/Activate Transaction

- [x] Move build activation into `execution/build-version-publisher.mjs`.
- [x] Publish as draft, validate gates, publish release manifest, then activate in a single SQLite transaction.
- [x] Block activation if required quality gates fail.
- [x] Add rollback-safe failure tests: interrupted publish leaves previous active version intact.
- [x] Verify with `npm test -- src/local-service/knowledge-versions.test.mjs src/local-service/version-manifest.test.mjs src/local-service/local-executor.test.mjs`.

**Block B acceptance:**

- Every artifact is tied to KB, build version, document, page/block, and job.
- Failed and low-confidence content enters review.
- Completed provider batches are skipped on retry.
- Publish cannot activate a weak or incomplete build.

**Completion note (2026-06-30):** Block B is implemented. Execution stage boundaries, parser provider contracts, provider-batch artifact checkpoints, draft-to-active manifest publishing, and catalog release transaction activation are in place. Verification completed with the Block B target slice and full block gate.

---

## Block C: `0.3.0 Query Runtime` Evidence and Citation Contract

**Purpose:** Turn real questions into scoped, cited, non-fabricated answers through one runtime used by console and integrations.

**Why third:** Query quality should be built on Block A search and Block B manifest reliability.

**Files:**

- Modify: `src/local-service/query-runtime.mjs`
- Split from `src/local-service/query-engine.mjs`:
  - Create: `src/local-service/query-understanding.mjs`
  - Create: `src/local-service/query-evidence.mjs`
  - Create: `src/local-service/query-citation-validator.mjs`
  - Create: `src/local-service/query-answer-contract.mjs`
- Modify: `src/local-service/query-route-planner.mjs`
- Modify: `src/local-service/query-structure-route.mjs`
- Modify: `src/local-service/query-quality-gates.mjs`
- Modify: `src/local-service/query-maintenance-issues.mjs`
- Add: `docs/api/query-runtime.zh-CN.md`
- Add: `docs/api/query-runtime.en.md`

### Round C1: Query Request and Understanding

- [x] Define a stable request shape: `question`, optional `scope`, optional `intent`, optional `filters`, optional `debug=false`.
- [x] Extract question understanding into `query-understanding.mjs`.
- [x] Detect domain, subject, grade, volume, page, unit, lesson, concept, exercise, and out-of-scope signals.
- [x] For general KBs, detect lookup, citation, concept, comparison, and generic answer intents.
- [x] Add tests for Chinese K12 questions, English/general questions, empty question, ambiguous scope, and explicit out-of-scope.
- [x] Verify with `npm test -- src/local-service/query-route-planner.test.mjs`.

### Round C2: Evidence Retrieval

- [x] Implement `query-evidence.mjs` as the only place that reads catalog search, structure route, K12 route, and vector sidecar candidates for the online Query Runtime evidence path.
- [x] Route order: K12/catalog structure first when applicable, general structure lookup next, hybrid catalog search next, vector provider only when sidecar contract is valid.
- [x] Add metadata filters from source scope and query understanding.
- [x] Add tests proving K12 unit/lesson questions do not rely on vector similarity.
- [x] Verify with `npm test -- src/local-service/query-structure-route.test.mjs src/local-service/k12-query-router.test.mjs src/local-service/catalog-search.test.mjs`.

### Round C3: Citation Validation and No-Answer

- [x] Implement `query-citation-validator.mjs`.
- [x] Validate traceability: document, page/section anchor, chunk/object, and evidence support.
- [x] Validate scope fit before answer generation.
- [x] Make no-answer/refusal first-class statuses: `out_of_scope`, `insufficient_evidence`, `no_index`, `provider_unavailable`, `blocked_by_quality`.
- [x] Add tests for unrelated citations, weak answers, missing page anchors, out-of-scope refusal, and `[object Object]` serialization prevention.
- [x] Verify with `npm test -- src/local-service/query-quality-gates.test.mjs src/local-service/server.test.mjs`.

### Round C4: Answer Contract and OpenAPI-Ready Docs

- [x] Implement `query-answer-contract.mjs` to shape public responses.
- [x] Keep public response fields stable: `ok`, `status`, `answer`, `citations`, `checks`, `feedback`, `maintenance`.
- [x] Add machine-readable contract endpoint data in `/api/query/contract`.
- [x] Write bilingual docs under `docs/api/`.
- [x] Update README and docs index links only after contract tests pass.
- [x] Verify with `npm test -- src/local-service/server.test.mjs src/web-console/app.test.mjs`.

**Block C acceptance:**

- Console and integrations use the same endpoint.
- Weak answers are not counted as usable.
- Refusals return no unrelated citations.
- Every `answered` result has traceable citations.

**Completion note (2026-06-30):** Block C is implemented. Query understanding, evidence routing, citation validation, normalized no-answer statuses, public answer shaping, machine-readable contract data, and bilingual Query Runtime API docs are in place. Verification completed with C1-C4 target suites and the full Block C gate.

---

## Block D: `0.4.0 Expert SDK` and K12 Expert Hardening

**Purpose:** Make K12 a real Expert and define the boundary for future domain Experts.

**Why fourth:** K12 should validate the Expert architecture after Core search/query contracts are stable.

**Files:**

- Create: `src/local-service/expert-registry.mjs`
- Create: `src/experts/k12/template.json`
- Create: `src/experts/k12/schema.json`
- Move or wrap K12 modules under an Expert-facing boundary without breaking imports:
  - `src/local-service/k12-page-range-builder.mjs`
  - `src/local-service/k12-toc-builder.mjs`
  - `src/local-service/k12-object-extractor.mjs`
  - `src/local-service/k12-query-router.mjs`
  - `src/local-service/k12-evaluation-runner.mjs`
- Add: `docs/experts/k12.zh-CN.md`
- Add: `docs/experts/k12.en.md`

### Round D1: Expert Registry Boundary

- [x] Add an Expert registry that exposes capabilities: `schema`, `sourceScopeGate`, `pageClassifier`, `structureBuilder`, `objectExtractor`, `queryRouter`, `evaluationSet`.
- [x] Register K12 through the registry.
- [x] Replace direct Core K12 checks with registry capability selection where practical.
- [x] Add tests proving a general template does not load K12 processors.
- [x] Verify with `npm test -- src/core/templates.test.mjs src/local-service/k12-expert-readiness.test.mjs`.

### Round D2: K12 Schema and Object Contract

- [x] Create `src/experts/k12/schema.json` for required dimensions and object types from `docs/current-design.md`.
- [x] Map existing K12 object rows to schema object types.
- [x] Add relation types for lesson-to-vocabulary, lesson-to-exercise, formula-to-example, figure/table-to-section, citation anchor.
- [x] Add tests for schema validation and object relation persistence.
- [x] Verify with `npm test -- src/local-service/k12-object-extractor.test.mjs src/local-service/k12-math-object-extractor.test.mjs src/local-service/k12-chinese-object-extractor.test.mjs`.

### Round D3: K12 Structure and Evaluation Coverage

- [x] Tighten TOC completeness and unit/lesson page-range gates.
- [x] Add required evaluation cases from current design: TOC, unit lesson, vocabulary, writing/oral communication, math concept, math example, English theme/vocabulary, science experiment, page citation, cross-volume, publisher comparison, out-of-scope.
- [x] Store evaluation case/result rows without leaking copyrighted source text.
- [x] Add tests for 95% TOC readiness summary and 100% out-of-scope refusal gate.
- [x] Verify with `npm test -- src/local-service/k12-evaluation-runner.test.mjs src/local-service/k12-evaluation-manifest.test.mjs src/local-service/k12-query-readiness.test.mjs`.

### Round D4: Expert Authoring Docs

- [x] Write bilingual K12 Expert docs explaining object types, processor boundaries, quality gates, query routes, and evaluation set.
- [x] Add a short future Expert authoring section without promising a stable SDK before `1.0.0`.
- [x] Link docs from `docs/README.md`, `docs/README.en.md`, README, and Roadmap.
- [x] Verify docs links manually with `rg -n "experts/k12" README.md README.en.md docs`.

**Block D acceptance:**

- Core remains industry-neutral.
- K12 route and evaluation are selected via Expert capability, not ad hoc Core checks.
- K12 can answer structure questions from catalog rows before vector retrieval.
- K12 docs are useful for contributors without bundling textbook content.

**Completion note (2026-06-30):** Block D is implemented. K12 now has a lazy Expert registry boundary, template/schema files, object/relation contract normalization, canonical relation writes, 95% TOC readiness gate, 100% out-of-scope refusal target in the evaluation manifest, and bilingual Expert docs linked from README and docs.

---

## Block E: Maintenance, Feedback, Evaluation, and Version Operations

**Purpose:** Let users improve a knowledge base after build instead of rebuilding blindly.

**Why fifth:** Once answers are evidence-based, the product must close the loop on failures, feedback, and version changes.

**Files:**

- Modify: `src/local-service/document-inventory.mjs`
- Modify: `src/local-service/maintenance-review.mjs`
- Modify: `src/local-service/query-feedback.mjs`
- Modify: `src/local-service/query-maintenance-issues.mjs`
- Modify: `src/local-service/knowledge-versions.mjs`
- Modify: `src/local-service/targeted-rerun.mjs`
- Modify: `src/local-service/evaluation-dashboard.mjs`
- Modify: Web Console files after API tests pass.

### Round E1: Review Queues as Maintenance Work

- [x] Normalize build quality issues and query maintenance issues into one review surface with target type, severity, status, owner path, and retest action.
- [x] Keep positive feedback as signal, not review work.
- [x] Add list filters for issue type, severity, document, page, and status.
- [x] Add tests for queue isolation by KB and stale JSON cleanup.
- [x] Verify with `npm test -- src/local-service/maintenance-review.test.mjs src/local-service/query-feedback.test.mjs src/local-service/server.test.mjs`.

### Round E2: Version Diff, Rollback, and Publish History

- [x] Expand version diff to include source counts, extraction counts, structure counts, chunk/index counts, evaluation gates, and query feedback impact.
- [x] Keep rollback transactional and block rollback to invalid/incomplete releases.
- [x] Add Web Console version detail actions with confirm dialogs.
- [x] Verify with `npm test -- src/local-service/knowledge-versions.test.mjs src/web-console/app.test.mjs`.

### Round E3: Targeted Rerun Product Flow

- [x] Turn rerun preview into a clear plan for file, page range, unit, failed batch, or issue target.
- [x] Ensure rerun jobs carry scope into scan, extraction, structure, embedding, index, and evaluation.
- [x] Add tests for rerun scope not leaking to other documents or KBs.
- [x] Verify with `npm test -- src/local-service/targeted-rerun.test.mjs src/local-service/local-executor.test.mjs`.

### Round E4: Evaluation Dashboard as Release Gate

- [x] Show build gate status, query gate status, K12 required-case coverage, and trend across versions.
- [x] Keep evaluation questions/expected answers/source text redacted in diagnostic exports.
- [x] Add tests for dashboard privacy and gate summary.
- [x] Verify with `npm test -- src/local-service/evaluation-dashboard.test.mjs src/local-service/server.test.mjs`.

**Block E acceptance:**

- Users can see why content or answers failed.
- Users can resolve, retest, rerun affected material, and compare versions.
- Evaluation is connected to publish readiness, not a detached report.

**Completion note (2026-06-30):** Block E is implemented. Review queues now merge build quality issues and query feedback, version diff/rollback is release-aware and blocks incomplete targets, targeted rerun supports document/page/unit/failed batch/issue scopes with job checkpoints, and the evaluation dashboard includes a structured release gate with K12 required-case coverage and trend.

---

## Block F: `0.5.0 Provider Adapters` and Capability Hardening

**Purpose:** Make parser/OCR/model/embedding/rerank/vector/object-store providers replaceable and visible to users.

**Why sixth:** Provider contracts must follow stable build/query flows, not drive them.

**Files:**

- Modify: `src/local-service/provider-capabilities.mjs`
- Create: `src/local-service/providers/registry.mjs`
- Create: `src/local-service/providers/local-parser.mjs`
- Create: `src/local-service/providers/local-ocr.mjs`
- Create: `src/local-service/providers/aliyun-model-studio.mjs`
- Create: `src/local-service/providers/aliyun-oss-vector.mjs`
- Create: `src/local-service/providers/local-vector.mjs`
- Modify: `src/local-service/aliyun.mjs`
- Modify extracted execution provider modules from Block B.
- Add: `docs/providers.zh-CN.md`
- Add: `docs/providers.en.md`

### Round F1: Provider Registry

- [x] Add a registry describing provider type, capability, availability, setup requirements, privacy boundary, cost units, batch support, retry policy, and user-fixable errors.
- [x] Refactor `provider-capabilities.mjs` to read the registry instead of hardcoding only Aliyun/local catalog cards.
- [x] Add tests for no credentials, local-only, partially configured Aliyun, and fully configured Aliyun.
- [x] Verify with `npm test -- src/local-service/provider-capabilities.test.mjs`.

### Round F2: Local Parser/OCR Adapters

- [x] Implement local parser adapter stubs for supported local formats with explicit dependency checks.
- [x] Implement local OCR adapter contract with unavailable/dependency-missing states.
- [x] Do not silently call external tools; dependency detection must be visible in Platform Runtime.
- [x] Verify with `npm test -- src/local-service/platform-runtime.test.mjs src/local-service/local-executor.test.mjs`.

### Round F3: Aliyun Provider Hardening

- [x] Move Model Studio and OSS Vector calls behind provider adapters.
- [x] Preserve bounded concurrency, transient retry, batch splitting, and immediate auth/permission/model/index failures.
- [x] Keep secrets out of logs, databases, exports, reports, and sidecars.
- [x] Verify with `npm test -- src/local-service/local-executor.test.mjs src/local-service/server.test.mjs`.

### Round F4: Local Vector Provider

- [x] Add a local vector provider contract that can be disabled until a concrete local embedding/vector implementation is ready.
- [x] Ensure Query Runtime treats local vector as optional acceleration and falls back to catalog search.
- [x] Add tests proving no vector provider still yields catalog-search answers.
- [x] Verify with `npm test -- src/local-service/catalog-search.test.mjs src/local-service/query-quality-gates.test.mjs src/local-service/server.test.mjs`.

**Block F acceptance:**

- Provider substitutions do not require Core changes.
- Users can see cost/privacy/permission boundaries before provider use.
- Missing providers produce user-fixable guidance.

**Completion note (2026-06-30):** Block F is implemented. Provider registry, local parser/OCR contracts, Aliyun Model Studio/OSS Vector adapters, local vector disabled contract, Web Console provider capability/runtime visibility, and provider docs are in place. Verification completed with `npm test`, `npm run smoke:release`, `npm run smoke:artifact`, `npm run verify:package-boundary`, `git diff --check`, and a browser smoke on Maintain > Diagnostics proving provider/runtime sections render without setup redirect or console warnings.

---

## Block G: `1.0.0 Usable` Web Console, Platform, API, and Release Readiness

**Purpose:** Make KnowMesh usable by non-maintainers on Windows, macOS, and Linux.

**Why last:** The UI and release surface should sit on stable contracts, not chase internal churn.

**Files:**

- Modify: `src/web-console/pages.mjs`
- Modify: `src/web-console/app.js`
- Modify: `src/web-console/styles.css`
- Create: `src/web-console/components/` only if extracting repeated UI is necessary.
- Modify: `src/local-service/platform-runtime.mjs`
- Modify: launcher files and `src/cli/knowmesh.mjs`
- Add: `docs/api/openapi.json` or generated equivalent once query/package APIs stabilize.
- Modify: `README.md`, `README.en.md`, `CHANGELOG.md`, `ROADMAP.md`, release notes.

### Round G1: Console IA Freeze

- [x] Keep top-level IA: Overview, Build Knowledge Base, Use Knowledge Base, Maintain Knowledge Base, Setup.
- [x] Ensure Home routes by state: no KB, setup incomplete, task running/failed, KB ready, multiple KB switch.
- [x] Hide internal implementation terms outside technical pages.
- [x] Extract repeated panels/actions if adding more UI would grow the large files further.
- [x] Verify with `npm test -- src/web-console/app.test.mjs src/local-service/server.test.mjs`.

### Round G2: Cross-Platform Runtime

- [x] Finalize launcher behavior for Windows/macOS/Linux.
- [x] Confirm port fallback, browser opening, folder picking, file reveal, dependency checks, private runtime path, and Node version checks.
- [x] Add platform-specific tests where safe; keep OS-specific destructive actions mocked.
- [x] Verify with `npm test -- src/launcher/launcher.test.mjs src/local-service/platform-runtime.test.mjs`.

### Round G3: OpenAPI and Integration Docs

- [x] Publish OpenAPI-ready docs for query, feedback, search, maintenance status, package export/import preview, and version endpoints.
- [x] Include code examples that call Query Runtime, not vector bucket directly.
- [x] Add contract tests that docs examples match actual endpoint paths.
- [x] Verify with `npm test -- src/local-service/server.test.mjs`.

### Round G4: Release Gate and Public Package Discipline

- [x] Keep package boundary strict: no runtime state, secrets, local SQLite DBs, private K12 content, or tests in the package.
- [x] Generate release artifact checksums.
- [x] Update CHANGELOG with numeric version.
- [x] Publish GitHub release only after CI, CodeQL, Scorecard, local smoke, artifact smoke, and package-boundary checks pass.
- [x] Decide separately whether npm publication is enabled; do not imply npm availability until it is done.

**Block G acceptance:**

- Ordinary users can start the local Web Console through packaged launchers.
- Query/search/maintenance/version APIs are documented and stable enough for early integrations.
- Release package contains only public, intended project files.
- `1.0.0 Usable` means real questions can return scoped, cited, non-fabricated answers, not merely that files were embedded.

**Completion note (2026-06-30):** Block G is implemented. The Web Console IA uses user-facing lifecycle language, Platform Runtime reports launchers, dependencies, folder picking, file reveal, and provider adapters, the OpenAPI 3.1 contract covers integration endpoints, and release discipline now includes package-boundary private-content checks plus a machine-readable release-gate checklist. Browser smoke also caught and fixed the general-docs setup gate so K12 source-scope metadata is only required by the K12 template. Verification completed with the Block G target slices, full repository gate, artifact/package smoke, `git diff --check`, release-gate default blocking behavior, and browser smoke on the local Web Console.

---

## Block H: Public Launch Candidate

**Purpose:** Turn the now-usable product into a public-facing launch candidate that can attract developers without overstating maturity.

**Why after G:** Block G froze the usable local product, API surface, platform diagnostics, and package boundary. Block H should validate the public story, real samples, repository governance, and release evidence on top of those stable contracts.

**Files:**

- Modify: `README.md`, `README.en.md`, `docs/README.md`, `docs/README.en.md`, launch docs, GitHub metadata notes.
- Modify: `docs/api/openapi.json` only for contract corrections found by real integration samples.
- Modify: `src/web-console/pages.mjs`, `src/web-console/app.js`, `src/web-console/styles.css` only for public-facing clarity or browser-discovered UX defects.
- Add/modify: `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, `SECURITY.md`, governance docs if missing.
- Add: public sample fixtures that contain no private K12 content and can run in CI or smoke mode.

### Round H1: Public Story and README Conversion

- [x] Re-audit README first screen for search intent: local-first knowledge base builder, auditable RAG, cited answers, SQLite catalogs, K12 as first strengthened scenario.
- [x] Make the first viewport immediately answer: what it is, who it is for, why it is different, what works now, and what is still alpha.
- [x] Keep Chinese as default and English complete; align docs entry points so neither language is a partial mirror.
- [x] Verify badges, social preview references, architecture visuals, and GitHub topics/about recommendations.
- [x] Test rendered Markdown locally or through GitHub preview; fix image scaling and text overflow.

### Round H2: Real Sample Acceptance

- [x] Add a public, non-private sample source set for general-docs and a tiny K12-safe synthetic sample.
- [x] Run local setup from sample source through build preview and at least one query path.
- [x] Prove citations, no-answer behavior, feedback capture, package preview, and version manifest with sample data.
- [x] Keep private教材/K12 source material outside repository and package boundaries.
- [x] Verify with `npm test`, targeted sample tests, and browser smoke against the sample knowledge bases.

### Round H3: Public UX Copy and Setup Friction

- [x] Sweep visible Web Console copy for accidental internal terms on non-technical pages.
- [x] Separate general-docs setup from K12-only source-scope requirements in both UI and tests.
- [x] Check desktop and narrow viewport for Home, setup project, diagnostics, API Docs, and Ask result pages.
- [x] Keep interaction controls accessible: KB switcher, language/theme controls, tabs, copy buttons, and diagnostics export.
- [x] Verify with Browser screenshots, console logs, and focused DOM checks.

### Round H4: Repository Governance and Security Baseline

- [x] Add or tighten issue templates, PR template, security policy, support policy, contributing path, and code of conduct if absent.
- [x] Ensure public package boundary excludes secrets, SQLite DBs, private content, local state, test fixtures that should not ship, and generated artifacts.
- [x] Confirm license headers/third-party attribution where needed.
- [x] Ensure CI, CodeQL, Scorecard, package-boundary, release smoke, and artifact smoke are discoverable from docs.
- [x] Verify by running local gates and checking GitHub workflow definitions.

### Round H5: Release Candidate Evidence

- [x] Build the release evidence bundle: `npm test`, `npm run smoke:release`, `npm run smoke:artifact`, `npm run verify:package-boundary`, `git diff --check`, CI, CodeQL, Scorecard, artifact checksum.
- [x] Keep npm publication as a separate explicit decision.
- [x] Prepare draft release notes with honest alpha limitations and supported platforms.
- [x] Confirm release assets contain only public intended files.
- [x] Only mark release allowed when `scripts/release-gate.mjs` is supplied complete passing evidence.

**Block H acceptance:**

- A new visitor can understand KnowMesh in under one minute and can run a safe local sample.
- Public repository pages, docs, security posture, and release notes match the product's real maturity.
- Browser QA covers the primary public-facing flows, not just unit tests.
- Release is blocked until local and GitHub evidence are present.

**Completion note (2026-06-30):** Block H is implemented. The Chinese-default and English README now frame KnowMesh as a public launch candidate, public samples cover general-docs and synthetic K12 without private content, repository governance includes issue/PR templates and release-candidate docs, release-gate can evaluate explicit evidence JSON, and browser QA covers the public Web Console routes on desktop and narrow viewports. Verification completed with the Block H target tests, full repository gate, release/artifact/package checks, `git diff --check`, release-gate default blocking behavior, evidence-file allow behavior, and Browser screenshots/DOM checks.

---

## Block I: Adoption Loop and Extension Foundation

**Purpose:** Convert the public launch candidate into an adoption-ready project: safer first-run demos, clearer contributor paths, and stable extension seams for Experts, providers, and integrations.

**Why after H:** Block H makes the repository understandable and public-safe. Block I should reduce friction for new users and contributors without reopening the core SQLite, Query Runtime, and release contracts already stabilized.

**Files:**

- Modify: `src/web-console/pages.mjs`, `src/web-console/app.js`, `src/web-console/styles.css` for first-run demo creation and contributor-facing clarity.
- Modify: `src/local-service/expert-registry.mjs`, `src/experts/`, `src/local-service/providers/`, `src/local-service/provider-capabilities.mjs` for extension contracts.
- Add/modify: `examples/integrations/`, `examples/public-samples/`, `docs/experts/`, `docs/providers.*.md`, `docs/api/`, `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/`.
- Add tests around demo reset, Expert manifests, provider dry-runs, and integration examples.

### Round I1: First-Run Demo Wizard

- [x] Add a credential-free "try a sample" path that creates a general-docs sample KB from `examples/public-samples/general-docs`.
- [x] Add a separate synthetic K12 sample path that creates structured unit/object evidence without bundling private教材.
- [x] Provide reset/delete sample actions that only affect sample-owned KBs and workspaces.
- [x] Ensure Home routes clearly distinguish empty workspace, sample-ready, setup-incomplete, and real KB states.
- [x] Verify with service tests plus Browser desktop/narrow screenshots for sample creation, Ask, diagnostics, and reset.

### Round I2: Expert Authoring Kit

- [x] Freeze an Expert manifest contract: id, title, supported source types, setup fields, extraction objects, relations, gates, and query routes.
- [x] Move K12-specific assumptions behind the Expert registry where feasible; core routes should consume Expert descriptors instead of hardcoding public copy.
- [x] Add a minimal example Expert that is not K12 and proves the registry can load multiple domains.
- [x] Document how to author, validate, and test an Expert in Chinese and English.
- [x] Verify with manifest schema tests, registry tests, and a no-private-content package-boundary check.

### Round I3: Provider Adapter Readiness

- [x] Define provider adapter contracts for parser/OCR/chat/embedding/rerank/vector/object-store capabilities.
- [x] Add dry-run capability reports that show what is configured, what is missing, and what will call external services before execution.
- [x] Keep secrets in local secure paths and exclude them from diagnostics, package previews, logs, and public sample exports.
- [x] Add provider docs that explain local-only mode, Aliyun mode, and future adapter contribution rules.
- [x] Verify with provider-capability tests, diagnostics export tests, and Browser checks for provider capability pages.

### Round I4: Integration SDK Examples

- [x] Add Node.js and plain HTTP examples for Query Runtime, catalog search, feedback, package preview/import preview, maintenance status, and version manifest.
- [x] Generate examples from the OpenAPI contract or test them against the same endpoint list to prevent docs drift.
- [x] Include sample expected responses with no source text, secrets, or private教材.
- [x] Add contributor notes for building adapters on top of HTTP APIs instead of reading internal SQLite directly.
- [x] Verify examples with local service integration tests and package-boundary checks.

### Round I5: Community Backlog and Release Operations

- [x] Add contributor labels/backlog docs: good first issue, help wanted, Expert adapter, provider adapter, docs, and sample request.
- [x] Add a maintainer release checklist that maps local evidence, GitHub CI, CodeQL, Scorecard, draft release assets, and npm-publication decision.
- [x] Add issue templates for Expert requests and provider adapter requests if the existing templates are too generic.
- [x] Update roadmap milestones so new contributors can see near-term, medium-term, and stretch work.
- [x] Verify with documentation tests, public-launch readiness tests, and release-gate evidence checks.

**Block I acceptance:**

- A new user can create and reset a safe sample KB from the Web Console without cloud credentials.
- A new contributor can understand how to add an Expert, provider adapter, or HTTP integration without reading private implementation history.
- Public samples, examples, and docs remain package-safe and private-content-free.
- Extension work does not weaken SQLite authority, Query Runtime citations, or release-gate evidence requirements.

**Completion note (2026-06-30):** Block I is implemented. The Web Console now has credential-free public sample creation and reset for general-docs and synthetic K12 samples, sample-owned catalog creation stays inside SQLite-backed workspace/catalog state, public sample answers use the shared Query Runtime citation path, Expert manifests are documented and validated with a non-K12 example, provider capabilities expose adapter contracts and dry-run external-call boundaries, HTTP/Node integration examples are tested against the OpenAPI endpoint list, and community/release-operations docs plus issue templates make extension work contributor-ready. Verification covers targeted tests, the full repository gate, release/artifact/package checks, release-gate blocking and evidence-file allow behavior, `git diff --check`, and browser QA for sample create, Ask, diagnostics, and reset on desktop and narrow viewports.

---

## Block J: Public Beta Hardening and Contributor Operations

**Purpose:** Harden the adoption loop into a public-beta-ready operating model: deterministic browser sample flows, stable API compatibility evidence, governed extension lifecycle, clearer documentation navigation, and release evidence that maintainers can repeat.

**Why after I:** Block I makes KnowMesh easier to try and extend. Block J should make those entry points reliable enough for public beta contributors without weakening SQLite authority, Query Runtime citations, or the release gate.

**Files:**

- Modify: `src/web-console/pages.mjs`, `src/web-console/app.js`, `src/web-console/styles.css`, and Web Console tests for deterministic sample and diagnostics flows.
- Modify/add: `docs/api/`, `examples/integrations/`, `scripts/integration-examples.test.mjs`, and OpenAPI contract tests for compatibility evidence.
- Modify/add: `docs/experts/`, `docs/providers.*.md`, `src/local-service/expert-registry.mjs`, `src/local-service/provider-capabilities.mjs`, and validation scripts for extension governance.
- Modify: `README.md`, `README.en.md`, `docs/README*.md`, `CONTRIBUTING.md`, `ROADMAP*.md`, release docs, and issue templates for beta contributor navigation.
- Add tests around browser sample reset cleanup, API compatibility, extension manifest/provider contract validation, bilingual docs parity, package boundary, and release evidence.

### Round J1: Sample Wizard E2E and State Cleanup

- [x] Add deterministic browser E2E coverage for create sample, ask a cited question, submit feedback, inspect diagnostics, reset sample, and verify no residual sample KB remains.
- [x] Show sample ownership and reset safety in diagnostics/package previews without exposing internal paths or private source text.
- [x] Ensure reset removes only sample-owned catalog/artifact data and preserves normal user-created KBs.
- [x] Cover desktop and narrow viewports with screenshots or DOM assertions for the sample wizard, Ask, diagnostics, and reset confirmation.
- [x] Verify with Web Console tests, local service sample tests, browser E2E, package-boundary, and `git diff --check`.

### Round J2: API Compatibility and SDK Contract

- [x] Version the Query Runtime/OpenAPI examples so integrations can detect supported response contracts.
- [x] Generate or validate an endpoint manifest from `docs/api/openapi.json` and require Node/HTTP examples to match it.
- [x] Add expected response examples for success, refusal, no-answer, validation error, and provider-unavailable states without bundling private content.
- [x] Add SDK error-handling examples for timeout, non-2xx responses, and retryable local-service failures.
- [x] Verify with integration-example tests, OpenAPI contract tests, local service API tests, and package-boundary checks.

### Round J3: Extension Lifecycle Governance

- [x] Formalize Expert/provider status stages: `official`, `certified`, `community`, and `experimental`.
- [x] Add manifest/provider contract validation that fails on missing capabilities, unsafe permission claims, or direct internal SQLite dependency.
- [x] Add contributor PR checklist items for Expert, provider, and integration changes.
- [x] Document how community extensions graduate from experimental to certified without changing Core tables directly.
- [x] Verify with Expert registry tests, provider-capability tests, validation script tests, and docs parity checks.

### Round J4: Documentation Navigation and Searchability

- [x] Refresh README and docs navigation around public samples, integration examples, Expert authoring, provider adapter contracts, and release operations.
- [x] Add bilingual search-friendly summaries for KnowMesh positioning, K12 as the first Expert, and integration use cases.
- [x] Ensure all new docs have Chinese-default and English equivalents or explicit single-language rationale.
- [x] Add docs link checks for README, docs index, roadmap, contributing, issue templates, and examples.
- [x] Verify with documentation tests, public-launch readiness tests, package-boundary checks, and `git diff --check`.

### Round J5: Public Beta Release Evidence

- [x] Run the full local gate: `npm test`, `npm run smoke:release`, `npm run smoke:artifact`, `npm run verify:package-boundary`, and `git diff --check`.
- [x] Run browser QA evidence for the beta-critical flows: first-run sample, Query Runtime, diagnostics, package preview, version manifest, and reset.
- [x] Prepare beta release notes that separate supported paths, alpha/beta limitations, known gaps, and npm publication decision.
- [x] Create or update release evidence JSON with local gates, browser QA, artifact checksum, CI/CodeQL/Scorecard placeholders or live results, and release asset review.
- [x] Verify `scripts/release-gate.mjs` blocks incomplete evidence and allows complete passing beta evidence only.

**Block J acceptance:**

- Public sample flows are repeatable through the real Web Console and clean up after themselves.
- Integration examples are visibly compatible with the OpenAPI contract and include success/error/no-answer cases.
- Expert and provider contributions have explicit lifecycle stages and validation gates.
- README/docs navigation makes the adoption loop and extension paths easy to discover in Chinese and English.
- Public beta release evidence is complete enough for maintainers to repeat without relying on private context.

**Completion note (2026-06-30):** Block J is implemented. Public sample ownership is now visible through maintenance and package-preview APIs, reset safety is explicit and sample-owned-only, and the browser flow was verified through real Playwright UI on `http://127.0.0.1:30367`: create `general-docs`, ask a cited Query Runtime question, submit useful feedback, confirm the feedback records page, inspect scoped maintenance/package/version APIs from the browser context, resize to 390x844 for narrow viewport DOM verification, reset the sample, and return to a fresh homepage with no selected knowledge base. The integration contract now carries `2026-06-public-beta.1`, has an endpoint manifest, Node SDK error handling, and success/refusal/no-answer/validation/provider-unavailable response examples. Expert and Provider lifecycle stages are validated as `official` -> `certified` -> `community` -> `experimental`, with docs and PR checklist coverage. Release evidence now distinguishes base release gates from Public Beta evidence (`browserSampleFlow`, `betaReleaseNotes`, `releaseAssetReview`) and blocks incomplete evidence.

---

## Block K: Beta Distribution, Certification, and Operations Automation

**Purpose:** Turn the Public Beta hardening work into a repeatable distribution and operations path: automated browser evidence, signed/checksummed release assets, extension certification records, a first provider adapter pilot, and a public feedback operations loop.

**Why after J:** Block J proves the beta-critical paths can be exercised and documented. Block K should make those paths repeatable by maintainers and contributors without relying on ad hoc manual context.

**Files:**

- Modify/add: `scripts/`, `package.json`, and `.github/workflows/` for browser evidence automation, release evidence generation, and artifact checksum review.
- Modify/add: `docs/release-operations.*.md`, `docs/release-candidate.*.md`, `CHANGELOG.md`, and release-note templates for beta distribution.
- Modify/add: `src/local-service/extension-lifecycle.mjs`, `docs/experts/`, `docs/providers.*.md`, and certification registry docs/tests for lifecycle graduation.
- Modify/add: `src/local-service/providers/`, provider capability tests, and docs for the first concrete provider adapter pilot.
- Modify/add: `docs/community-backlog.*.md`, issue templates, and maintainer triage docs for beta feedback operations.

### Round K1: Automated Browser Evidence

- [x] Convert the Block J browser QA path into a repeatable script or npm smoke command that starts a temporary local service, creates `general-docs`, asks a cited question, submits feedback, checks maintenance/package/version APIs, verifies reset, and cleans all temp state.
- [x] Run the flow in desktop and narrow viewports with DOM assertions and optional screenshots stored under ignored evidence output.
- [x] Ensure the browser smoke never uploads files, calls OCR, calls embedding, writes vector indexes, or leaves sample KB state behind.
- [x] Add failure summaries that identify whether the break is sample creation, Query Runtime, feedback, maintenance, package preview, version manifest, responsive layout, or reset.
- [x] Verify with the new browser smoke, `npm test -- scripts/block-j-hardening.test.mjs src/web-console/app.test.mjs src/local-service/public-samples.test.mjs`, and `git diff --check`.

### Round K2: Release Evidence Generation and Asset Review

- [x] Add a release evidence generator that reads local gate outputs, artifact sha256, package boundary result, browser smoke result, and optional GitHub CI/CodeQL/Scorecard status into one JSON evidence file.
- [x] Add an asset-review check that rejects SQLite databases, workspace state, logs, `.env`, local paths, private source material, and generated test artifacts from release assets.
- [x] Keep npm publication as a separate explicit decision in generated evidence and docs.
- [x] Update release operations docs and release-candidate docs with the generated evidence format and manual override rules.
- [x] Verify with release-gate tests, package-boundary tests, smoke artifact, generated evidence dry run, and `git diff --check`.

### Round K3: Extension Certification Registry

- [x] Add a small certification registry for Expert and Provider extensions that records owner, lifecycle stage, supported KnowMesh contract version, required tests, docs links, security notes, and known limitations.
- [x] Require lifecycle graduation from `experimental` to `community` or `certified` to pass validation without direct SQLite dependencies or wildcard permissions.
- [x] Document graduation criteria in Chinese and English, including what `official` means for Core-maintained K12 and local catalog behavior.
- [x] Expose safe lifecycle/certification summaries through diagnostics or provider/expert capability APIs without leaking private paths.
- [x] Verify with extension lifecycle tests, expert registry tests, provider capability tests, docs link checks, and package-boundary.

### Round K4: First Provider Adapter Pilot

- [x] Select one low-risk local provider pilot, preferably a local parser capability already represented in provider contracts, and make its adapter interface explicit end to end.
- [x] Add dry-run, capability, permission, user-fixable error, and diagnostics behavior for the pilot adapter.
- [x] Keep provider output catalog-first and ensure no adapter directly mutates internal SQLite tables outside approved writer APIs.
- [x] Document the adapter contract, limitations, and contribution checklist in provider docs.
- [x] Verify with provider adapter tests, local-executor boundary tests, package-boundary, and a no-cloud smoke path.

### Round K5: Beta Feedback Operations Loop

- [x] Turn public beta feedback into a maintainer workflow: labels, triage states, issue templates, known-gap mapping, release-note carryover, and close criteria.
- [x] Add docs that explain how feedback from Query Runtime, public samples, integrations, providers, and Experts moves into backlog items.
- [x] Add checks that community backlog links, issue templates, release notes, and roadmap stay aligned.
- [x] Keep feedback examples free of private text, logs, local machine paths, and real source content.
- [x] Verify with community operations tests, docs link checks, public-launch readiness tests, and `git diff --check`.

**Block K acceptance:**

- Browser sample evidence is repeatable from one command and leaves no local state behind.
- Release evidence can be generated and reviewed without private context.
- Expert/provider lifecycle graduation has a concrete certification registry and validation gates.
- At least one provider adapter pilot demonstrates the adapter contract without weakening SQLite/catalog authority.
- Public beta feedback has a clear operations loop from issue intake to roadmap/release-note carryover.

**Completion note (2026-07-01):** Block K is implemented. `npm run smoke:browser-sample` now starts a temporary local service, creates the public `general-docs` sample, asks a cited Query Runtime question, submits feedback, checks maintenance/package/version APIs, verifies desktop and narrow DOM contracts, resets the sample, and removes temp state. Release evidence can be generated with asset review through `scripts/generate-release-evidence.mjs`. Expert/provider certification now has a registry and graduation validation, provider capabilities expose safe certification and local-parser pilot summaries, and beta feedback operations are documented in Chinese and English. Verification completed with targeted Block K regressions, generated release evidence dry run, `npm run smoke:release`, `npm run smoke:artifact`, `npm run verify:package-boundary`, full `npm test`, `git diff --check`, and a real Playwright browser run on `http://127.0.0.1:40192`.

---

## Block L: Searchable Runtime Productionization

**Purpose:** Move the product from repeatable beta operations into the next user-visible product core: stronger catalog search ranking, incremental source updates, vector sidecar readiness, search/maintenance UI workflows, and release evidence for the `0.2.0 Searchable` milestone.

**Why after K:** Block K makes beta operations repeatable. Block L should use that repeatability to harden the actual searchable knowledge asset loop without changing the current design authority or reintroducing JSON-first state.

**Files:**

- Modify/add: `src/local-service/catalog-search.mjs`, `src/local-service/query-engine.mjs`, `src/local-service/retrieval-manifests.mjs`, and focused tests for ranking, filters, and evidence shaping.
- Modify/add: `src/local-service/source-catalog.mjs`, `src/local-service/targeted-rerun.mjs`, `src/local-service/knowledge-versions.mjs`, and catalog/version tests for incremental updates.
- Modify/add: `src/local-service/index-records.mjs`, `src/local-service/providers/`, `docs/providers.*.md`, and provider-capability tests for local vector sidecar readiness.
- Modify/add: `src/web-console/`, focused frontend tests, and browser smoke coverage for search and maintenance review workflows.
- Modify/add: `scripts/`, `docs/release-operations.*.md`, `docs/release-candidate.*.md`, `ROADMAP.*.md`, and `CHANGELOG.md` for `0.2.0 Searchable` release evidence.

### Round L1: Search Ranking, Filters, and Evidence Shape

- [x] Strengthen `searchCatalog()` ranking so title, structure path, citation-bearing chunks, quality state, query feedback, and recency contribute predictable scores without making vector rows authoritative.
- [x] Add deterministic pagination and tie-breaking so repeated local searches return stable result order across platforms.
- [x] Add filter coverage for source type, document status, structure scope, page range, quality state, and evidence purpose.
- [x] Keep excerpts bounded and ensure result metadata is enough for Query Runtime, Web Console, and integrations to share the same evidence shape.
- [x] Verify with catalog-search, query-runtime/query-engine, and scoped API tests plus `git diff --check`.

### Round L2: Incremental Source Update and Targeted Rerun

- [x] Make changed, missing, excluded, and restored source documents produce clear catalog deltas and version notes.
- [x] Ensure targeted rerun only rebuilds affected documents, structures, chunks, citations, index records, and evaluation queues.
- [x] Preserve rollback-ready release versions and never use JSON as mutable source state.
- [x] Add user-fixable diagnostics for stale chunks, missing citations, and skipped parser/OCR work.
- [x] Verify with source-catalog, targeted-rerun, knowledge-version, local-executor boundary, and migration tests.

### Round L3: Local Vector Sidecar Readiness

- [x] Define a local vector sidecar contract that records provider, dimensions, source chunk id, checksum, status, and sidecar path while keeping catalog rows authoritative.
- [x] Add readiness diagnostics for missing sidecars, dimension mismatch, stale checksums, disabled providers, and provider/index mismatch.
- [x] Ensure Query Runtime can fall back to catalog search whenever vector acceleration is unavailable or invalid.
- [x] Keep local-parser and local-catalog certification summaries aligned with the sidecar contract.
- [x] Verify with retrieval-manifest, index-record, provider-capability, query-runtime, and no-cloud smoke tests.

### Round L4: Search and Maintenance Review UI Workflow

- [x] Add or refine the Web Console search/review workflow so users can inspect evidence, filter by maintenance state, open the source document, and see why an item is searchable or blocked.
- [x] Connect stale/missing/review diagnostics to clear user actions without exposing SQLite internals.
- [x] Add responsive behavior for desktop and narrow viewports, using the scoped API helpers and existing UI patterns.
- [x] Extend browser sample smoke or add a focused browser smoke for searchable evidence and maintenance review.
- [x] Verify with frontend tests, API tests, real Playwright browser checks, and `git diff --check`.

### Round L5: `0.2.0 Searchable` Release Evidence

- [x] Add release evidence fields for searchable readiness, incremental update proof, vector fallback proof, browser search workflow proof, and package asset review.
- [x] Update roadmap, changelog, release-candidate docs, and release operations docs for `0.2.0 Searchable`.
- [x] Add stale JSON authority audit checks for any path that still behaves like mutable primary state.
- [x] Run the full block gate and record artifact checksum, package boundary, release smoke, browser smoke, and full test results.
- [x] Before starting Block M, list every Block M round with the same detail and keep Block M scoped to the next product milestone only.

**Block L acceptance:**

- Search ranking and filters are deterministic, scoped to the selected knowledge base, and backed by SQLite catalog state.
- Incremental source updates produce reviewable catalog/version deltas and targeted reruns without stale searchable evidence.
- Vector sidecars are validated accelerators, and invalid vectors cannot override catalog truth.
- Web Console users can inspect, filter, and act on searchable evidence through the real runtime/API path.
- `0.2.0 Searchable` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block L is implemented. Catalog search now returns deterministic, citation-aware evidence with ranking signals and document-status filtering; source sync emits restored/changed/missing deltas with targeted rerun diagnostics; local vector sidecars are validated as accelerators with catalog-search fallback; the Web Console maintenance workflow exposes evidence search through the scoped runtime API; and `0.2.0 Searchable` release evidence now includes searchable readiness, incremental update proof, vector fallback proof, browser search workflow proof, stale JSON authority audit, and package asset review. Verification completed with focused L1-L5 test slices, real Playwright browser evidence-search checks, full `npm test` (`331/331` passing), `npm run smoke:release`, `npm run smoke:browser-sample`, `npm run smoke:artifact` (`sha256:1a3c8e340bb9214713eaf880bef110523658dcfcc0e525e08d3ff9f0ab3e3761`), `npm run verify:package-boundary`, `git diff --check`, generated searchable release evidence, and `node ./scripts/release-gate.mjs --stage searchable --evidence <temp-file>`.

---

## Block M: `0.3.0 Query Runtime` Evidence-First Answers

**Purpose:** Turn the searchable knowledge asset loop from Block L into a user-trustworthy Query Runtime: routed questions, evidence packs, cited answers, refusal/no-answer behavior, feedback-to-maintenance actions, integration contracts, and release evidence for `0.3.0 Query Runtime`.

**Why after L:** Query answers should not be hardened until catalog search, maintenance evidence, incremental updates, and vector fallback are deterministic. Block M uses those search contracts as the only online evidence path and keeps catalog rows/version manifests authoritative.

**Files:**

- Modify/add: `src/local-service/query-understanding.mjs`, `query-route-planner.mjs`, `query-evidence.mjs`, `query-runtime.mjs`, `query-engine.mjs`, and focused tests for route/refusal behavior.
- Modify/add: `src/local-service/query-answer-contract.mjs`, `query-citation-validator.mjs`, `query-quality-gates.mjs`, and answer/citation tests.
- Modify/add: `src/local-service/query-feedback.mjs`, `query-maintenance-issues.mjs`, `maintenance-review.mjs`, `targeted-rerun.mjs`, and review/evaluation tests for feedback-to-maintenance loops.
- Modify/add: `docs/api/openapi.json`, `docs/api/query-runtime.*.md`, `examples/integrations/`, and integration drift tests for stable external usage.
- Modify/add: `scripts/`, `docs/release-operations.*.md`, `docs/release-candidate.*.md`, `ROADMAP.*.md`, and `CHANGELOG.md` for `0.3.0 Query Runtime` release evidence.

### Round M1: Query Route Contract and Refusal Taxonomy

- [x] Normalize query intent, domain scope, source scope, route candidates, and confidence into one route contract consumed by console and integration APIs.
- [x] Define refusal/no-answer taxonomy: out-of-scope, unsupported source, insufficient evidence, low confidence, blocked provider, and maintenance-required.
- [x] Ensure K12 structure-first routes keep priority over generic catalog search when K12 readiness is valid.
- [x] Remove any fallback that answers from prompt context without citation-ready evidence.
- [x] Verify with query-understanding, route-planner, K12 router, query-runtime, and server API tests.

### Round M2: Evidence Pack and Citation-Grounded Answer Contract

- [x] Create a stable evidence-pack shape with chunk id, citation id, document status, structure path, ranking signals, quality state, and source anchors.
- [x] Make answer generation consume evidence packs only and validate every answer claim against citation-ready evidence.
- [x] Require scoped citations in public responses and explain missing evidence without leaking source text.
- [x] Add deterministic answer statuses: answered, refused, noAnswer, needsReview, providerUnavailable.
- [x] Verify with answer-contract, citation-validator, quality-gate, query-evidence, and no-provider fallback tests.

### Round M3: Feedback-to-Maintenance Loop

- [x] Convert negative query feedback into review issues with evidence target, severity, retest action, and targeted rerun scope.
- [x] Let positive feedback influence ranking only as bounded catalog feedback signal, never as answer truth.
- [x] Link feedback issues to evaluation dashboard trends and release gates without storing raw private questions in diagnostics.
- [x] Add user actions for retest, mark resolved, and rerun affected evidence.
- [x] Verify with query-feedback, maintenance-review, evaluation-dashboard, targeted-rerun, and diagnostics redaction tests.

### Round M4: Integration API and SDK Contract Hardening

- [x] Update OpenAPI and examples for route metadata, answer statuses, citations, refusal payloads, feedback submission, and maintenance issue links.
- [x] Keep Node.js and plain HTTP examples aligned with the generated endpoint manifest.
- [x] Add contract-drift tests that fail when docs/examples disagree with `docs/api/openapi.json`.
- [x] Document retryable and non-retryable errors without encouraging direct SQLite access.
- [x] Verify with integration examples, OpenAPI manifest, server API, and package-boundary tests.

### Round M5: `0.3.0 Query Runtime` Release Evidence

- [x] Add release evidence fields for route contract readiness, citation-grounded answer proof, refusal/no-answer proof, feedback-maintenance proof, integration contract proof, and browser ask workflow proof.
- [x] Extend browser sample smoke to ask answered, refused/no-answer, and feedback-maintenance questions on desktop and narrow viewports.
- [x] Update roadmap, changelog, release-candidate docs, release operations docs, and API docs for `0.3.0 Query Runtime`.
- [x] Run the full block gate and record full tests, release smoke, browser smoke, artifact checksum, package boundary, release gate, and real Playwright evidence.
- [x] Before starting Block N, list every Block N round with the same detail and keep Block N scoped to the next product milestone only.

**Block M acceptance:**

- Query Runtime answers only when citation-ready evidence supports the response.
- Unsupported or insufficient-evidence questions return explicit refusal/no-answer statuses, not weak answers.
- Feedback creates maintainable catalog issues and targeted rerun scopes without raw private question leakage.
- Integration examples and OpenAPI describe the real runtime contract and stay drift-tested.
- `0.3.0 Query Runtime` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block M is implemented. Query Runtime now exposes a route contract with refusal taxonomy, evidence-pack response shape, citation-ready answer policy, feedback-maintenance review linkage, integration examples/OpenAPI drift protection, and `0.3.0 Query Runtime` release evidence. Browser sample smoke covers answered, out-of-scope refused, and feedback-maintenance paths on desktop and narrow viewports. Verification completed with focused M1-M5 slices, real Playwright browser checks on a temporary local service, full `npm test` (`334/334` passing), `npm run smoke:release`, `npm run smoke:browser-sample`, `npm run smoke:artifact` (`sha256:51dfdd18d736aa409e098e6e966ca441c2ccbff8bd6c80b14447c64ecf82f22b`), `npm run verify:package-boundary`, `git diff --check`, generated query-runtime release evidence, and `node ./scripts/release-gate.mjs --stage query-runtime --evidence <temp-file>`.

---

## Block N: `0.4.0 Expert SDK / Extension Foundation`

**Purpose:** Turn the internal Expert idea into a contributor-safe extension foundation: authorable manifests, stable Core boundaries, a non-K12 example Expert, evaluation-set contracts, contributor workflow, and release evidence for `0.4.0 Expert SDK`.

**Why after M:** Experts should not be hardened until Query Runtime has stable route, evidence, citation, feedback, and integration contracts. Block N must let domain extensions plug into those contracts without Core forks or direct SQLite mutations.

**Files:**

- Modify/add: `src/local-service/expert-registry.mjs`, `src/local-service/extension-certification.mjs`, `src/local-service/extension-lifecycle.mjs`, and focused tests for Expert authoring contracts.
- Modify/add: `src/experts/`, `docs/experts/`, `examples/experts/`, and fixtures for a non-K12 Expert.
- Modify/add: `src/local-service/query-route-planner.mjs`, `query-evidence.mjs`, `query-answer-contract.mjs`, and focused tests only where Expert-declared route rules need public Core hooks.
- Modify/add: `scripts/`, `docs/release-operations.*.md`, `docs/release-candidate.*.md`, `ROADMAP.*.md`, and `CHANGELOG.md` for `0.4.0 Expert SDK` release evidence.

### Round N1: Expert Manifest Authoring Contract

- [x] Define the stable Expert manifest fields: id, lifecycle, supported contract version, domain objects, source-scope rules, query-route rules, quality gates, evaluation cases, migrations, and docs links.
- [x] Add manifest validation that rejects direct SQLite dependencies, wildcard permissions, missing docs/tests, unsafe lifecycle graduation, and private-data fixtures.
- [x] Keep K12 on the same manifest contract without turning Core into K12 Core.
- [x] Document the authoring contract in Chinese and English.
- [x] Verify with expert-registry, extension-lifecycle, extension-certification, docs link, and package-boundary tests.

### Round N2: Expert Runtime Boundary and Public Hooks

- [x] Expose a narrow Expert runtime API for source-scope decisions, page/block classification hints, structure/object writers, query-route rule registration, and evaluation case registration.
- [x] Ensure Experts call Core writer APIs instead of mutating `catalog.sqlite` or internal files.
- [x] Add route-planner/query-evidence hooks that consume declared Expert route rules while preserving Query Runtime answer policy.
- [x] Add diagnostics that show Expert capabilities and limitations without leaking local paths or source text.
- [x] Verify with Core/Expert boundary tests, K12 regression tests, query-runtime tests, and package-boundary.

### Round N3: Non-K12 Example Expert

- [x] Add a small public `operations-handbook` Expert that models policy/process documents with public fixtures only.
- [x] Define domain objects such as policy, procedure, role, review cadence, rollback rule, and evidence requirement.
- [x] Add source-scope, structure/object extraction, query-route rules, and citations for the example Expert.
- [x] Keep the example useful enough for contributors but small enough to avoid product bloat.
- [x] Verify with example Expert manifest tests, public sample tests, Query Runtime route/evidence tests, and docs checks.

### Round N4: Expert Evaluation Set and Quality Gates

- [x] Define the portable Expert evaluation case format with categories, expected status, required citations, refusal/no-answer expectations, and redaction rules.
- [x] Add quality gate helpers that Experts can declare without overriding Core query gates.
- [x] Make evaluation dashboard aggregate Expert cases without exposing private questions or source text.
- [x] Add failure-to-maintenance mapping for Expert evaluation gaps.
- [x] Verify with evaluation manifest/dashboard tests, maintenance review tests, and generated safe fixture tests.

### Round N5: `0.4.0 Expert SDK` Contributor Workflow and Release Evidence

- [x] Add release evidence fields for expert manifest readiness, runtime boundary proof, non-K12 example proof, evaluation gate proof, docs/contributor workflow proof, and package asset review.
- [x] Update README/docs navigation so contributors can find Expert authoring, lifecycle, examples, and acceptance commands.
- [x] Add issue/backlog templates or docs for proposing community Experts without private datasets.
- [x] Run the full block gate and record full tests, release smoke, browser smoke, artifact checksum, package boundary, release gate, and any browser/docs evidence.
- [x] Before starting Block O, list every Block O round with the same detail and keep Block O scoped to the next product milestone only.

**Block N acceptance:**

- A new Expert can be authored, validated, tested, documented, and packaged without forking Core or touching internal SQLite tables.
- K12 remains an official Expert implemented through the same public-ish contract.
- At least one non-K12 public example Expert proves the contract beyond education.
- Expert evaluation cases and quality gates feed the same dashboard, maintenance, and Query Runtime evidence model.
- `0.4.0 Expert SDK` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block N is implemented. Expert manifests now define lifecycle, contract version, source scope, domain objects, route rules, quality gates, evaluation cases, docs, fixtures, and required tests; Expert runtime hooks are narrow public Core APIs instead of direct storage access; K12 uses the same contract; `operations-handbook` proves a non-K12 public Expert; Expert evaluation cases feed dashboard and maintenance issue mapping; and `0.4.0 Expert SDK` release evidence is generated and gate-checked. Verification completed with focused N1-N5 test slices, full `npm test` (`351/351` passing), `npm run smoke:release`, `npm run smoke:browser-sample` with desktop and narrow DOM checks, `npm run smoke:artifact` (`sha256:d3e3967e67a7bda8303415690307f17b9008f1829b18ed926785e4a2732de7b4`), `npm run verify:package-boundary`, `git diff --check`, generated Expert SDK release evidence, and `node ./scripts/release-gate.mjs --stage expert-sdk --evidence <temp-file>`.

---

## Block O: `0.5.0 Provider Adapter Foundation`

**Purpose:** Make OCR, parser, embedding, rerank, vector, object-store, and export providers replaceable through one auditable adapter foundation: provider manifests, dry-run diagnostics, permission/cost/privacy metadata, checkpoint-safe execution contracts, Web Console visibility, and release evidence for `0.5.0 Provider Adapters`.

**Why after N:** Experts now have a stable extension boundary, but provider behavior is still more scattered than the current design allows. Provider work should now plug into Core and Expert contracts without allowing hidden cloud calls, direct catalog mutation, or provider-specific branches in product flows.

**Files:**

- Modify/add: `src/local-service/provider-adapters.mjs`, `provider-capabilities.mjs`, `execution-boundaries.*`, `src/local-service/providers/`, and focused provider adapter tests.
- Modify/add: parser/OCR/vector/embedding integration points in `local-executor.mjs`, `index-records.mjs`, `retrieval-manifests.mjs`, `query-engine.mjs`, and their tests only where the adapter boundary changes behavior.
- Modify/add: `src/web-console/app.js`, `pages.mjs`, `styles.css`, and browser smoke coverage for provider diagnostics and dry-run actions.
- Modify/add: `docs/providers.*.md`, `docs/release-operations.*.md`, `docs/release-candidate.*.md`, `ROADMAP.*.md`, `CHANGELOG.md`, and release evidence scripts for `0.5.0 Provider Adapters`.

### Round O1: Provider Adapter Manifest Contract

- [x] Define stable provider adapter manifest fields: id, kind, lifecycle, capabilities, supported file/data types, execution mode, permissions, secret requirements, privacy boundary, cost hints, batch limits, retry/checkpoint policy, docs, fixtures, and required tests.
- [x] Add validation that rejects wildcard permissions, direct `catalog.sqlite` writes, implicit external calls, missing dry-run support for cloud providers, missing docs/tests, and unsafe lifecycle graduation.
- [x] Register built-in adapters for local-parser, local-catalog, local-vector-sidecar, aliyun-oss, aliyun-oss-vector, dashscope-embedding, and no-provider fallbacks without changing runtime behavior yet.
- [x] Expose adapter summaries through provider capability diagnostics with redacted secret and local-path handling.
- [x] Verify with provider-adapter manifest tests, provider-capability tests, package-boundary, and no-cloud smoke tests.

**Round O1 note (2026-07-01):** Added the provider adapter manifest contract, built-in adapter registry, validation helpers, provider capability exposure, and provider docs updates. Verification passed with `npm test -- src/local-service/provider-adapters.test.mjs`, the focused provider/server/public-launch regression slice (`86/86` passing), `npm run verify:package-boundary`, `git diff --check`, and `npm run smoke:browser-sample` with `externalCalls.total: 0`.

### Round O2: Parser and OCR Execution Boundary

- [x] Route source extraction decisions through parser/OCR adapter contracts while keeping catalog rows and artifacts as the only persistent truth.
- [x] Ensure Office/PDF/WPS/image/scanned-source support is described by adapter capability, not scattered UI or template checks.
- [x] Add dry-run and preflight diagnostics for unsupported file types, unsafe macros, missing local tools, blocked OCR provider credentials, and retryable extraction failures.
- [x] Keep local-parser as the default public path with no cloud calls and no private fixture dependency.
- [x] Verify with source scan, extraction manifest, local-executor, public-sample, provider-boundary, and browser/API diagnostics tests.

**Round O2 note (2026-07-01):** Added source preparation and OCR preflight contracts that route direct text, Office, legacy/WPS conversion, OCR, and unsupported files through adapter decisions with macro-never-execute policy, dry-run requirements, user-fixable errors, and catalog/artifact persistence boundaries. Execution planning now derives handling counts from the parser provider preparation plan, and provider manifests now include `local-ocr` and `dashscope-ocr`. Verification passed with parser/OCR/execution-plan tests, provider manifest/capability tests, source catalog, local-executor, platform-runtime, public-sample, server/Web Console regressions, `npm run verify:package-boundary`, `git diff --check`, and `npm run smoke:browser-sample` with `externalCalls.total: 0`.

### Round O3: Embedding, Rerank, and Vector Adapter Boundary

- [x] Normalize embedding/vector adapter input and output contracts: chunk ids, dimensions, provider model, checksum, batch id, sidecar path, index namespace, and stale/invalid states.
- [x] Make vector stores pure accelerators by validating adapter output against catalog chunks before retrieval.
- [x] Add rerank adapter shape with deterministic no-rerank fallback and citation-safe ranking metadata.
- [x] Add checkpoint/retry behavior for partial embedding/vector batches without duplicating index records or losing catalog fallback.
- [x] Verify with index-record, retrieval-manifest, query-runtime, vector fallback, targeted-rerun, and no-provider fallback tests.

**Round O3 note (2026-07-01):** Added embedding batch/result contracts, vector write batch/result contracts, catalog-visible adapter and sidecar metadata, deterministic no-rerank fallback, and provider manifests for `dashscope-rerank` plus `no-rerank-fallback`. Vector adapter output now records dimension/checksum/sidecar state so retrieval manifests can validate local vector sidecars against catalog chunks before treating vectors as ready. Verification passed with O3 contract tests, index-record catalog integration, retrieval manifest/query runtime/provider diagnostics regressions, full `local-executor.test.mjs` (`50/50` passing), `npm run verify:package-boundary`, `git diff --check`, and `npm run smoke:browser-sample` with `externalCalls.total: 0`.

### Round O4: Provider Diagnostics API and Web Console Workflow

- [x] Add scoped provider diagnostics APIs for capability inventory, selected provider readiness, dry-run checks, cost/privacy warnings, retryability, and next actions.
- [x] Update Web Console setup and maintenance pages so users can inspect provider state and run dry-runs without seeing internal adapter jargon.
- [x] Ensure browser storage is not used for provider truth; selected providers and readiness summaries must survive service restarts through SQLite-backed state.
- [x] Add responsive desktop and narrow browser smoke coverage for provider diagnostics and user-facing recovery actions.
- [x] Verify with server API tests, Web Console tests, real Playwright browser smoke, and `git diff --check`.

**Round O4 note (2026-07-01):** Added scoped provider diagnostics through `/api/providers/diagnostics` and maintenance status, including capability inventory, manifest readiness, dry-run status, cost/privacy warnings, retryability, next actions, and explicit state authority (`workspace.sqlite`, `catalog.sqlite`, browser storage for visual preferences only). The Web Console maintenance diagnostics view now renders a user-facing provider health panel, and the browser sample smoke verifies provider diagnostics API/DOM coverage on desktop and narrow viewports with `externalCalls.total: 0`. A real in-app browser check loaded `/kb/sample-general-docs/maintain/diagnostics` at `1280x820` and `390x844`, confirmed the panel rendered from the scoped maintenance API, and verified no horizontal overflow. Verification passed with `npm test -- src/web-console/app.test.mjs src/local-service/provider-diagnostics.test.mjs src/local-service/server.test.mjs` (`102/102` passing), `npm run smoke:browser-sample`, `npm run verify:package-boundary`, and `git diff --check`.

### Round O5: `0.5.0 Provider Adapters` Release Evidence

- [x] Add release evidence fields for provider manifest readiness, parser/OCR boundary proof, embedding/vector boundary proof, provider diagnostics browser proof, no-cloud public path proof, and package asset review.
- [x] Update provider docs, release candidate docs, release operations docs, roadmap, changelog, and README navigation for `0.5.0 Provider Adapters`.
- [x] Add stale direct-provider-path audit checks for any path that bypasses provider adapter contracts for mutable product behavior.
- [x] Run the full block gate and record full tests, release smoke, browser smoke, artifact checksum, package boundary, release gate, and browser/docs evidence.
- [x] Before starting Block P, list every Block P round with the same detail and keep Block P scoped to the next product milestone only.

**Round O5 note (2026-07-01):** Added `0.5.0 Provider Adapters` release evidence gates, generator support, CLI release-gate support, direct-provider bypass audit, Block O tests, provider/release docs, roadmap, changelog, and README status notes. Maintenance status now returns a redacted provider capability summary so public-sample diagnostics do not expose secret requirement names or private sample text, while `/api/providers/capabilities` remains the technical capability endpoint. Verification passed with Block O focused tests, full `npm test` (`375/375` passing), `npm run smoke:release`, `npm run smoke:browser-sample` with provider diagnostics desktop/narrow evidence and `externalCalls.total: 0`, `npm run smoke:artifact` (`sha256:edbbe65cc9b15f26831b7ef3dacfe6297595663bca65a20e8bba7bee5a0ad91a`), `npm run verify:package-boundary`, `git diff --check`, generated `0.5.0-provider-adapters` release evidence, and `node ./scripts/release-gate.mjs --stage provider-adapters --evidence <temp-file>`.

**Block O acceptance:**

- Provider capabilities, permissions, costs, privacy boundaries, docs, fixtures, and required tests are declared in adapter manifests.
- Parser/OCR/embedding/vector/rerank behavior goes through adapter contracts and cannot silently mutate catalog truth or bypass checkpoint rules.
- Local-first public paths work without cloud credentials, while cloud providers expose dry-run diagnostics and user-fixable next actions.
- Web Console provider diagnostics use real API/runtime state on desktop and narrow viewports.
- `0.5.0 Provider Adapters` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block O is implemented. Provider adapters now have a stable manifest contract, built-in local/cloud/fallback registry, parser/OCR source preparation and dry-run preflight, embedding/rerank/vector batch boundaries, catalog-validated vector metadata, scoped provider diagnostics APIs, Web Console provider health rendering, browser sample diagnostics smoke coverage, direct-provider bypass release audit, and `0.5.0 Provider Adapters` release evidence. Verification completed with focused O1-O5 slices, a real in-app browser check on `/kb/sample-general-docs/maintain/diagnostics` at desktop and narrow viewports, full `npm test` (`375/375` passing), `npm run smoke:release`, `npm run smoke:browser-sample`, `npm run smoke:artifact` (`sha256:edbbe65cc9b15f26831b7ef3dacfe6297595663bca65a20e8bba7bee5a0ad91a`), `npm run verify:package-boundary`, `git diff --check`, generated provider-adapters release evidence, and the `provider-adapters` release gate.

---

## Block P: `0.6.0 Integration SDK / API Consumer Foundation`

**Purpose:** Make KnowMesh easy and safe for application developers to integrate without reading internal SQLite or copying Web Console behavior: versioned endpoint manifests, a small Node.js SDK client, plain HTTP examples, integration diagnostics, error/retry contracts, and release evidence for `0.6.0 Integration SDK`.

**Why after O:** Query Runtime, Expert hooks, and Provider diagnostics are now release-gated. Integrations should consume those stable contracts instead of forcing Core or Web Console response-shape changes later.

**Files:**

- Modify/add: `docs/api/endpoint-manifest.json`, `docs/api/openapi.json`, `docs/api/query-runtime.*.md`, and focused API drift tests.
- Add: `src/sdk/knowmesh-client.mjs`, `src/sdk/knowmesh-client.test.mjs`, and package export/bin-safe boundary tests.
- Modify/add: `examples/integrations/`, expected responses, README examples, and no-direct-SQLite checks.
- Modify/add: `src/local-service/server.mjs`, `src/local-service/integration-manifest.mjs`, and focused server tests for integration metadata only when needed.
- Modify/add: `scripts/generate-release-evidence.mjs`, `scripts/release-gate.mjs`, `scripts/block-p-integration-sdk.test.mjs`, release docs, roadmap, changelog, and README navigation.

### Round P1: Versioned Endpoint Manifest and Integration Metadata

- [x] Add a machine-readable integration manifest that lists supported endpoints, contract version, required path params, supported methods, response kinds, retryability, and privacy notes.
- [x] Expose a scoped and unscoped safe metadata endpoint for integration discovery without leaking local paths, source text, credentials, or browser state.
- [x] Keep OpenAPI, endpoint manifest, and server routes drift-tested.
- [x] Document that integrations use APIs only and must not read `workspace.sqlite`, `catalog.sqlite`, sidecars, or artifacts directly.
- [x] Verify with endpoint-manifest, OpenAPI, server API, integration examples, and package-boundary tests.

**Round P1 note (2026-07-01):** Added `src/local-service/integration-manifest.mjs`, unscoped and scoped `/api/integration/manifest` discovery, endpoint-manifest/OpenAPI updates, Node/HTTP example coverage, and drift tests that compare runtime endpoints, docs, OpenAPI, and examples. Verification passed with `npm test -- src/local-service/integration-manifest.test.mjs scripts/integration-examples.test.mjs scripts/block-j-hardening.test.mjs src/local-service/server.test.mjs` (`76/76` passing) and `git diff --check` with only pre-existing CRLF warnings.

### Round P2: Small Node.js SDK Client

- [x] Add a lightweight ESM client with `baseUrl`, `knowledgeBaseId`, optional `fetchImpl`, timeout, request id, and scoped route helpers.
- [x] Support query, search, feedback, maintenance status, version manifest, package preview, provider diagnostics, and integration manifest calls.
- [x] Normalize HTTP errors into a stable `KnowMeshApiError` with status, code, retryable flag, endpoint, and redacted details.
- [x] Keep the SDK local-first and dependency-light; do not add a build step or hidden browser coupling.
- [x] Verify with SDK unit tests using injected fetch, package exports/boundary tests, and existing integration drift tests.

**Round P2 note (2026-07-01):** Added the pure ESM SDK at `src/sdk/knowmesh-client.mjs`, package exports for `knowmesh` and `knowmesh/sdk`, endpoint/contract drift checks, scoped route helpers, unscoped service discovery, request id headers, timeout/network handling, retryability mapping, and redacted `KnowMeshApiError` details. Verification passed with `npm test -- src/sdk/knowmesh-client.test.mjs scripts/integration-examples.test.mjs scripts/verify-package-boundary.test.mjs scripts/block-j-hardening.test.mjs` (`15/15` passing), `npm run verify:package-boundary` (`rejected: []`), and `git diff --check` with only pre-existing CRLF warnings.

### Round P3: Plain HTTP and App Integration Examples

- [x] Update Node.js and plain HTTP examples to cover answered query, refusal/no-answer, catalog search, feedback, maintenance issue link, provider diagnostics, package preview, and version manifest.
- [x] Add expected response fixtures for success and error cases with contract version and no private text.
- [x] Add examples for local app startup assumptions: localhost URL, selected KB scope, no direct SQLite reads, timeout/retry handling, and credential-free public sample flow.
- [x] Keep examples concise enough for README/docs linking without becoming a second API spec.
- [x] Verify with examples smoke/drift tests, OpenAPI contract tests, and public sample smoke.

**Round P3 note (2026-07-01):** Updated Node examples to use the official SDK, expanded plain HTTP examples for public sample startup, answered/refusal/no-answer states, feedback summary, provider diagnostics, package preview, and version manifest, added safe expected response fixtures, and promoted feedback summary into the integration manifest/SDK endpoint map. Verification passed with `npm test -- scripts/integration-examples.test.mjs src/sdk/knowmesh-client.test.mjs src/local-service/integration-manifest.test.mjs scripts/block-j-hardening.test.mjs` (`18/18` passing), `npm run smoke:browser-sample` with desktop/narrow DOM checks and `externalCalls.total: 0`, and `git diff --check` with only pre-existing CRLF warnings.

### Round P4: Integration Safety, Retry, and Diagnostics

- [x] Define retryable vs non-retryable errors for local service unavailable, validation failure, provider unavailable, no evidence, out-of-scope, and maintenance-required states.
- [x] Add integration diagnostics that show API readiness, selected KB scope, provider readiness summary, Query Runtime readiness, and safe next actions.
- [x] Ensure diagnostics and SDK logs never include source text, query text, answer text, credentials, local absolute artifact paths, or raw provider internals.
- [x] Add CORS/localhost guidance without opening broad remote access by default.
- [x] Verify with redaction tests, server diagnostics tests, SDK error tests, and browser sample no-cloud evidence.

**Round P4 note (2026-07-01):** Added `src/local-service/integration-diagnostics.mjs`, unscoped and scoped `/api/integration/diagnostics`, SDK diagnostics helpers, retry/non-retry semantics, localhost-only CORS guidance, redacted readiness summaries, API docs guidance, and browser-sample smoke evidence for integration diagnostics. Verification passed with `npm test -- src/local-service/integration-diagnostics.test.mjs src/local-service/integration-manifest.test.mjs src/sdk/knowmesh-client.test.mjs scripts/integration-examples.test.mjs scripts/block-j-hardening.test.mjs src/local-service/server.test.mjs` (`88/88` passing), `npm run smoke:browser-sample` with integration diagnostics/no-cloud evidence, `npm run verify:package-boundary` (`rejected: []`), and `git diff --check` with only pre-existing CRLF warnings.

### Round P5: `0.6.0 Integration SDK` Release Evidence

- [x] Add release evidence fields for endpoint manifest readiness, SDK client proof, examples drift proof, integration safety proof, provider-aware no-cloud proof, and integration package asset review.
- [x] Update release candidate docs, release operations docs, API docs, roadmap, changelog, README/docs navigation, and community backlog starter tasks for integration SDK contributors.
- [x] Add release gate and generator support for `integration-sdk` / `0.6.0-integration-sdk`.
- [x] Run the full block gate and record full tests, release smoke, browser smoke, artifact checksum, package boundary, release gate, and docs evidence.
- [x] Before starting Block Q, list every Block Q round with the same detail and keep Block Q scoped to the next product milestone only.

**Round P5 note (2026-07-01):** Added `0.6.0 Integration SDK` release evidence gates, generator support, CLI release-gate support, Block P tests, release docs, roadmap, changelog, and README status notes. Verification passed with Block P focused tests, full `npm test` (`394/394` passing), `npm run smoke:release`, `npm run smoke:browser-sample` with integration diagnostics/no-cloud evidence and `externalCalls.total: 0`, `npm run smoke:artifact` (`sha256:7ef00636e66954845e73a52544c54de51163fcda8551b3e7b6d3b61be360a072`), `npm run verify:package-boundary`, `git diff --check`, generated `0.6.0-integration-sdk` release evidence, and `node ./scripts/release-gate.mjs --stage integration-sdk --evidence .tmp/integration-sdk-release-evidence.json`.

**Block P acceptance:**

- Application developers can discover supported KnowMesh APIs and call them through a small SDK or plain HTTP examples.
- The SDK and examples use the same Query Runtime, search, feedback, maintenance, version, package, and provider diagnostics contracts as the Web Console.
- Integrations do not read internal SQLite, artifacts, browser storage, or sidecars directly.
- Errors, retryability, diagnostics, and redaction are stable enough for external app developers.
- `0.6.0 Integration SDK` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block P is implemented. KnowMesh now exposes versioned integration manifest and integration diagnostics endpoints, a package-exported dependency-light ESM SDK, SDK-backed Node examples, plain HTTP examples, safe expected response fixtures, retry/redaction semantics, provider-aware no-cloud integration proof, and `0.6.0 Integration SDK` release evidence. Verification completed with focused P1-P5 slices, full `npm test` (`394/394` passing), release smoke, browser sample smoke with desktop/narrow and integration diagnostics, artifact smoke (`sha256:7ef00636e66954845e73a52544c54de51163fcda8551b3e7b6d3b61be360a072`), package boundary (`rejected: []`), diff check, generated integration-sdk release evidence, and the integration-sdk release gate.

---

## Block Q: `0.7.0 Consumer Integration Proof`

**Purpose:** Prove that downstream application developers can consume KnowMesh from an installed package and a live local service without relying on repository internals, Web Console behavior, or direct SQLite/artifact reads.

**Why after P:** Block P created the SDK and API contract. Block Q should now prove those contracts from the outside: package consumers, live public sample flows, integration recipes, privacy audits, and release evidence for consumer-facing adoption.

**Files:**

- Add/modify: `scripts/sdk-consumer-smoke.mjs`, package/artifact smoke tests, and focused SDK consumer tests.
- Add/modify: `scripts/live-integration-smoke.mjs`, public-sample SDK smoke evidence, and no-cloud checks.
- Add/modify: `docs/integrations.zh-CN.md`, `docs/integrations.en.md`, examples integration docs, README/docs index, and community backlog tasks.
- Add/modify: integration privacy/security audit scripts that scan docs/examples/SDK recipes for direct internal-state reads, local absolute paths, credential logging, broad CORS, and private content.
- Add/modify: release gate/generator tests for `0.7.0 Consumer Integration Proof`.

### Round Q1: Installed Package SDK Consumer Smoke

- [x] Add a smoke script that runs against the packed tarball or package export surface and imports `knowmesh` / `knowmesh/sdk` as an external consumer.
- [x] Verify package exports, SDK helpers, `KnowMeshApiError`, endpoint map, and injected fetch without importing `src/local-service`.
- [x] Confirm the installed package does not expose tests, runtime state, SQLite databases, private fixtures, or generated artifacts.
- [x] Add focused tests that fail if the SDK starts depending on local-service modules or direct filesystem state.
- [x] Verify with SDK consumer smoke, package boundary, artifact smoke, and SDK unit tests.

**Round Q1 note (2026-07-01):** Added `scripts/sdk-consumer-smoke.mjs`, `npm run smoke:sdk-consumer`, and Block Q consumer tests. The smoke packs the current project, installs the tarball into a temporary external app, imports `knowmesh` and `knowmesh/sdk`, exercises all SDK endpoint helpers through injected fetch, verifies `KnowMeshApiError` redaction, scans the installed package for private runtime state, and confirms the SDK has no local-service, filesystem, or SQLite dependency. Verification passed with `npm test -- scripts/block-q-consumer-integration.test.mjs` and `npm run smoke:sdk-consumer`.

### Round Q2: Live Public Sample SDK Flow

- [x] Add a live SDK smoke script that starts the local service, creates `sample-general-docs`, calls the installed/packaged SDK against real HTTP APIs, and resets sample-owned state.
- [x] Cover service manifest, scoped manifest, integration diagnostics, answered query, out-of-scope query, catalog search, feedback, feedback summary, provider diagnostics, package preview, and version manifest.
- [x] Assert no external calls before explicit provider execution, no leaked credentials/private content/local absolute artifact paths, and successful temp-state cleanup.
- [x] Reuse the same public sample path as browser smoke but keep this script framework-neutral and non-UI.
- [x] Verify with live SDK smoke, browser sample smoke, server API tests, and diff check.

**Round Q2 note (2026-07-01):** Added `scripts/live-sdk-sample-smoke.mjs` and `npm run smoke:live-sdk`. The smoke starts a temporary local service, installs the packed `knowmesh` tarball into a temporary external app, imports the SDK through package exports, creates `sample-general-docs`, calls real HTTP APIs for manifests, diagnostics, answered/refused queries, catalog search, feedback, package previews, maintenance ownership, and version manifest, then resets and removes temp state. SDK error handling now returns HTTP 200 Query Runtime refusal states such as `out_of_scope` as business results instead of throwing. Verification passed with `npm run smoke:live-sdk`, `npm run smoke:browser-sample`, `npm test -- src/local-service/server.test.mjs src/sdk/knowmesh-client.test.mjs scripts/block-q-consumer-integration.test.mjs`, and `git diff --check` with only pre-existing CRLF warnings.

### Round Q3: Integration Recipes and Framework Boundaries

- [x] Add bilingual integration docs for server-side Node, Electron/local desktop, browser-through-backend, and CI smoke usage.
- [x] Document localhost/CORS boundaries: default `127.0.0.1`, no broad remote access by default, and remote access only behind caller-managed authentication/TLS/network policy.
- [x] Show safe retry handling, request id propagation, feedback maintenance links, public sample setup, and no direct internal-state reads.
- [x] Keep examples concise and link to OpenAPI/endpoint manifest instead of duplicating the full spec.
- [x] Verify docs navigation, link coverage, examples drift, and privacy scan.

**Round Q3 note (2026-07-01):** Added bilingual app integration guides at `docs/integrations.zh-CN.md` and `docs/integrations.en.md`, covering server-side Node, Electron/local desktop, browser-through-backend, CI smoke, localhost/CORS boundaries, request id propagation, retry handling, feedback maintenance links, public sample setup, and the no-direct-internal-state rule. README, docs index, and integration examples now link to the guide while OpenAPI and endpoint manifest remain the machine contract. Verification passed with `npm test -- scripts/block-q-consumer-integration.test.mjs scripts/integration-examples.test.mjs scripts/public-launch-readiness.test.mjs` and `git diff --check` with only pre-existing CRLF warnings.

### Round Q4: Integration Privacy and Boundary Audit

- [x] Add an audit that scans integration docs, examples, expected responses, and SDK entry points for direct `workspace.sqlite` / `catalog.sqlite` reads, artifact/sidecar/browser-storage reads, credential logging, local absolute paths, private content, and broad CORS instructions.
- [x] Allow mentions only when they explicitly describe forbidden reads or state authority, not implementation recipes.
- [x] Add tests that reject new examples using repository-relative internal paths or raw provider response logging.
- [x] Wire the audit into release evidence and package boundary expectations.
- [x] Verify with audit tests, package boundary, and integration examples tests.

**Round Q4 note (2026-07-01):** Added `scripts/verify-integration-privacy.mjs` and `npm run verify:integration-privacy`. The audit scans integration guides, examples, expected responses, and the SDK entry point for direct SQLite reads, artifact/sidecar/browser-storage reads, credential logging, raw provider payloads, local absolute paths, private content, and broad CORS/default remote binding instructions. Mentions of SQLite/sidecar are allowed only in forbidden-read or state-authority context. Verification passed with `npm run verify:integration-privacy`, `npm test -- scripts/block-q-consumer-integration.test.mjs scripts/integration-examples.test.mjs`, `npm run verify:package-boundary`, and `git diff --check` with only pre-existing CRLF warnings.

### Round Q5: `0.7.0 Consumer Integration Proof` Release Evidence

- [x] Add release evidence fields for installed SDK consumer proof, live public-sample SDK proof, integration recipe proof, privacy boundary audit proof, provider-aware no-cloud consumer proof, and consumer package asset review.
- [x] Update release candidate docs, release operations docs, roadmap, changelog, README/docs navigation, and community backlog starter tasks for consumer integration contributors.
- [x] Add release gate and generator support for `consumer-integration` / `0.7.0-consumer-integration`.
- [x] Run the full block gate and record full tests, release smoke, browser smoke, live SDK smoke, artifact checksum, package boundary, release gate, and docs/audit evidence.
- [x] Before starting Block R, list every Block R round with the same detail and keep Block R scoped to the next product milestone only.

**Round Q5 note (2026-07-01):** Added `0.7.0 Consumer Integration Proof` release gates, generator support, CLI release-gate support, Block Q tests, release docs, roadmap, changelog, and README status notes. Verification passed with Block Q focused tests, release-gate CLI tests, generated `consumer-integration` evidence dry run, `npm run verify:integration-privacy`, and `git diff --check` with only pre-existing CRLF warnings.

**Block Q acceptance:**

- A downstream app can import the installed SDK and call KnowMesh without repository internals.
- A live public-sample SDK smoke proves real HTTP behavior, reset cleanup, provider-aware no-cloud behavior, and redaction.
- Integration docs explain safe localhost/CORS/retry/feedback patterns without becoming a second API spec.
- Integration examples and docs do not direct users to internal SQLite, artifacts, sidecars, browser storage, credentials, local absolute paths, or raw provider internals.
- `0.7.0 Consumer Integration Proof` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block Q is implemented. KnowMesh now proves downstream adoption from the outside: a packed tarball can be installed into a temporary external app and imported through `knowmesh` / `knowmesh/sdk`; a live public-sample SDK smoke starts the local service, creates `sample-general-docs`, calls real HTTP APIs, submits feedback, verifies provider-aware no-cloud behavior, resets sample-owned state, and removes temp state; bilingual integration guides cover server-side Node, Electron/local desktop, browser-through-backend, CI smoke, localhost/CORS, retry, request id, and feedback maintenance links; `verify:integration-privacy` audits integration docs/examples/SDK entry points; and `0.7.0 Consumer Integration Proof` release evidence is generated and gate-checked.

## Block R: `0.8.0 Operator Workflow Proof`

**Purpose:** Prove the core product workflow for maintainers and operators: a real knowledge-base owner can inspect source intake, run or recover a build, review issues, trigger targeted maintenance, publish versions, diff, and rollback through supported UI/API surfaces without touching SQLite, artifacts, sidecars, or stale JSON state.

**Why after Q:** Block Q proved application developers can integrate from outside the repo. Block R should now tighten the operator-facing product loop that those integrations depend on: intake, execution, maintenance, versioning, rollback, and release evidence.

**Files:**

- Modify/add: `scripts/operator-workflow-smoke.mjs`, Web Console/API tests, and focused operator workflow tests.
- Modify/add: local-service source intake, execution recovery, maintenance review, targeted rerun, version diff, and rollback API surfaces only where gaps remain.
- Modify/add: `docs/operator-workflow.zh-CN.md`, `docs/operator-workflow.en.md`, README/docs index, release docs, roadmap, changelog, and community backlog tasks.
- Modify/add: release gate/generator tests for `0.8.0 Operator Workflow Proof`.

### Round R1: Source Intake and Scan Planning Proof

- [x] Add or harden an operator smoke path that creates a non-sample `general-docs` KB in temp state and runs source folder precheck, scan preview, source manifest, exclusion/restoration, and execution plan preview.
- [x] Ensure source intake distinguishes included, excluded, risky, changed, missing, and restored files with stable IDs and no direct artifact/SQLite reads in UI-facing responses.
- [x] Verify K12-specific source-scope requirements do not leak into general-docs, while K12 still keeps stage/subject/grade/scope gates.
- [x] Add browser/API checks for source intake pages at desktop and narrow viewports.
- [x] Verify with source-catalog, document-inventory, scan-preview, server, Web Console, operator smoke, and privacy/package boundary tests.

**Round R1 note (2026-07-01):** Added `scripts/operator-workflow-smoke.mjs` source intake coverage for a non-sample `general-docs` KB. The smoke creates scoped KBs, runs folder precheck, scan preview, source manifest, execution plan preview, exclude/restore, changed/missing/restored source deltas, and a separate K12 gate check to prove general-docs does not inherit K12 required fields.

### Round R2: Execution Recovery and Observability Proof

- [x] Prove job creation, checkpoint persistence, progress polling, pause/resume/retry/stop semantics, task summaries, and latest-job recovery after service restart using SQLite-backed state.
- [x] Ensure execution logs and diagnostic exports redact credentials, source content, local absolute paths, and raw provider payloads.
- [x] Add operator smoke coverage for interrupted/restarted service recovery and current task display.
- [x] Keep long-running work simulated/deterministic; do not call cloud providers unless explicitly configured in test fixtures.
- [x] Verify with jobs, local-executor, maintenance export, server, browser/operator smoke, and full regression slices.

**Round R2 note (2026-07-01):** Operator smoke now confirms local job creation, pause/resume, latest-job recovery after restarting the local service, and separate stop semantics. Maintenance diagnostic export was hardened to remove source/workspace roots and recursively redact credentials, local absolute paths, and sensitive diagnostic strings.

### Round R3: Maintenance Review to Targeted Rerun Proof

- [x] Connect quality issues, evidence search, query feedback, wrong-citation/missed-point feedback, and maintenance review into one operator workflow.
- [x] Prove review items expose safe rerun scopes and that targeted rerun jobs are created under the current KB only.
- [x] Add UI/API evidence for resolving review items, linking feedback to citations, and avoiding cross-KB contamination.
- [x] Ensure review queues use catalog tables as authority and remove/ignore stale JSON/JSONL paths.
- [x] Verify with maintenance review, query feedback, targeted rerun, catalog search, browser/operator smoke, and privacy audit tests.

**Round R3 note (2026-07-01):** Operator smoke connects evidence search, Query Runtime feedback, catalog quality issues, maintenance review, safe targeted rerun preview, targeted rerun confirmation, latest rerun job recovery, and review resolution. Scoped KB state now owns jobs even when the workspace current selection points at another KB, preventing cross-KB contamination.

### Round R4: Version Publish, Diff, and Rollback Proof

- [x] Prove publishable version manifests, package preview, version listing, diff, rollback preview, confirmation, and rollback result for operator workflows.
- [x] Ensure rollback is scoped to current KB, produces auditable records, and never mutates unrelated KBs or public sample ownership.
- [x] Add UI/API evidence that operators can inspect active/previous version status and see rollback risk before confirmation.
- [x] Keep artifacts as referenced files while SQLite catalog remains state authority; no JSON-first compatibility paths.
- [x] Verify with version-manifest, package, rollback, server, browser/operator smoke, and package-boundary tests.

**Round R4 note (2026-07-01):** Local catalog-backed builds now publish active manifests and build version records even without a cloud vector stage. Version listing, package preview, diff, rollback preview, rollback confirmation, rollback result, and cross-KB isolation are proven through the operator smoke and focused version tests.

### Round R5: `0.8.0 Operator Workflow Proof` Release Evidence

- [x] Add release evidence fields for source intake proof, execution recovery proof, maintenance targeted-rerun proof, version rollback proof, operator browser workflow proof, operator privacy audit proof, and operator package asset review.
- [x] Add release gate and generator support for `operator-workflow` / `0.8.0-operator-workflow`.
- [x] Update bilingual operator workflow docs, release candidate docs, release operations docs, README/docs nav, roadmap, changelog, and community backlog starter tasks.
- [x] Run the full block gate: focused R1-R5 slices, `npm test`, release smoke, browser sample smoke, live SDK smoke, operator workflow smoke, artifact smoke, package boundary, integration privacy audit, diff check, generated operator workflow evidence, and release gate.
- [x] Before starting Block S, list every Block S round with the same detail and keep Block S scoped to the next product milestone only.

**Round R5 note (2026-07-01):** Added `0.8.0 Operator Workflow Proof` release checklist, generator support, CLI release gate support, Block R tests, bilingual operator workflow docs, release candidate and release operations updates, README/docs navigation, roadmap, changelog, and community backlog entries. Verification passed with focused R slices (`177/177`), `npm test` (`415/415`), `npm run smoke:operator-workflow`, release smoke, browser sample smoke, live SDK smoke, artifact smoke, package boundary, integration privacy audit, generated operator-workflow evidence, release gate, and `git diff --check`.

**Block R acceptance:**

- A maintainer/operator can complete source intake, execution recovery, maintenance review, targeted rerun, version publish, diff, and rollback through supported UI/API surfaces.
- Operator workflows remain SQLite-first and do not rely on stale JSON/JSONL mutable state.
- Browser/API evidence covers desktop and narrow operator surfaces without leaking credentials, private content, local absolute paths, raw provider payloads, or internal file reads.
- Public samples and ordinary user-created KBs stay isolated during reset, rerun, version, and rollback workflows.
- `0.8.0 Operator Workflow Proof` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block R is implemented. KnowMesh now proves the maintainer/operator lifecycle through supported UI/API surfaces: non-sample source intake, folder precheck, scan preview, source manifest, exclude/restore, changed/missing/restored deltas, deterministic execution recovery, redacted diagnostics, evidence search, query feedback review, catalog quality issues, safe targeted rerun, version publish, package preview, diff, rollback preview, rollback confirmation, and cross-KB isolation. Local catalog-backed builds publish active catalog versions without a cloud vector stage, scoped KB state owns jobs even when workspace current selection differs, and operator diagnostics avoid credentials, private content, local absolute paths, raw provider payloads, internal reads, and external calls before explicit execution. Block S is planned as `0.9.0 First-Run Usability Proof`.

---

## Block S: `0.9.0 First-Run Usability Proof`

**Purpose:** Prove a non-maintainer can start KnowMesh, create or select a local knowledge base, build it, ask a cited question, understand failures, recover, and find the next safe action without reading internals, editing SQLite, or relying on developer-only scripts.

**Why after R:** Block R proved the maintainer/operator workflow. Block S should now compress that power into a first-run product path for real users, while preserving SQLite authority, scoped KB isolation, release gates, and privacy boundaries.

**Files:**

- Modify/add: `scripts/first-run-usability-smoke.mjs`, Web Console first-run tests, local-service setup/readiness tests, and focused Block S tests.
- Modify/add: Web Console empty state, KB selection, setup draft, readiness, execution progress, failure recovery, query handoff, and maintenance next-action surfaces only where gaps remain.
- Modify/add: `docs/first-run-usability.zh-CN.md`, `docs/first-run-usability.en.md`, README/docs index, release docs, roadmap, changelog, and community backlog tasks.
- Modify/add: release gate/generator tests for `0.9.0 First-Run Usability Proof`.

### Round S1: Launch, Empty State, and Readiness Proof

- [x] Add a first-run smoke path that starts a temporary local service with empty user data and no selected KB.
- [x] Prove the homepage/console exposes a clear empty state, create/select KB actions, current selection, service readiness, provider readiness, and privacy-safe diagnostics.
- [x] Ensure selected KB and setup readiness come from `workspace.sqlite`, not browser storage or JSON state.
- [x] Verify desktop and narrow first-run DOM contracts through real browser or equivalent in-app browser checks.
- [x] Verify with server, Web Console, setup/readiness, diagnostics, first-run smoke, and package/privacy boundary tests.

**Round S1 note (2026-07-01):** Added `scripts/first-run-usability-smoke.mjs`, `npm run smoke:first-run-usability`, and Block S first-run tests. The smoke starts a temporary service with empty user data, verifies no implicit KB exists, checks homepage and knowledge-base empty states, validates runtime/provider/integration readiness before KB selection, creates two general-docs KBs, switches current selection through `workspace.sqlite`, checks scoped overview and diagnostics, verifies desktop/narrow DOM contracts, records zero external calls, and removes temp state. Verification passed with `npm run smoke:first-run-usability` and focused Block S/server/Web Console tests (`104/104`).

### Round S2: Guided Local KB Creation and Source Validation Proof

- [x] Let a non-maintainer create a local `general-docs` KB, choose source/workspace folders, and understand folder validation failures without stack traces.
- [x] Prove setup draft persistence, retrieval profile selection, scan preview, and execution plan preview survive navigation and restart through SQLite-backed state.
- [x] Add safe copy and API response text for missing folder, empty folder, unsupported file, and permission-denied cases.
- [x] Keep K12-specific required fields scoped to K12 templates and absent from general-docs first-run flow.
- [x] Verify with setup draft, folder precheck, scan preview, template isolation, browser first-run smoke, and focused docs tests.

**Round S2 note (2026-07-01):** Extended the first-run usability smoke to write synthetic local source files, persist local setup draft and retrieval strategy, restart the service, verify current KB and draft recovery from SQLite, block a missing source folder as user-fixable, validate source/workspace folders, run general-docs scan preview without K12 required-field leakage, and confirm local execution plan preview. Verification passed with `npm run smoke:first-run-usability` and focused Block S/server/Web Console/source/plan tests (`108/108`).

### Round S3: Build Progress, Recovery, and Error Guidance Proof

- [x] Prove a first-time user can start a local build, see progress, pause/resume/retry/stop, recover latest job after restart, and understand current task state.
- [x] Convert recoverable failures into actionable messages with next steps while keeping detailed diagnostics redacted.
- [x] Ensure failure, retry, and completion states are scoped to the selected KB and do not mutate public samples or unrelated KBs.
- [x] Add deterministic failure fixtures for validation, parser, and quality-gate errors without cloud calls.
- [x] Verify with jobs, local-executor, diagnostic export, browser first-run smoke, and full regression slices.

**Round S3 note (2026-07-01):** Extended the first-run usability smoke to confirm a local build job, pause/resume it, advance visible progress, restart the service, recover the same latest job, run it to completion, and validate maintenance diagnostic export redaction. Verification passed with `npm run smoke:first-run-usability` and focused Block S/local-executor/server/Web Console tests (`154/154`).

### Round S4: Ask, Citation, Feedback, and Maintenance Next Action Proof

- [x] Prove the first-run path reaches Query Runtime with a cited answer or explicit refusal/no-answer and no weak success state.
- [x] Show citations, evidence search links, and feedback actions in a way a non-maintainer can understand.
- [x] Connect negative feedback and quality issues to a clear maintenance next action without exposing raw internal tables.
- [x] Ensure successful query/feedback paths use scoped APIs and never direct-read SQLite, artifacts, sidecars, or browser storage.
- [x] Verify with Query Runtime, catalog search, feedback maintenance, browser first-run smoke, and integration privacy tests.

**Round S4 note (2026-07-01):** Extended the first-run usability smoke through Query Runtime, catalog evidence search, feedback submission, and maintenance review. The first question is accepted only when it returns cited evidence or an explicit no-answer/refusal, so insufficient evidence cannot be counted as a weak success. Negative feedback creates a scoped maintenance item with safe rerun scope. Verification passed with `npm run smoke:first-run-usability` and focused Block S/query/feedback/maintenance/catalog/server/Web Console tests (`110/110`).

### Round S5: `0.9.0 First-Run Usability Proof` Release Evidence

- [x] Add release evidence fields for first-run launch proof, guided setup proof, build recovery proof, first question proof, maintenance next-action proof, first-run browser workflow proof, and first-run package asset review.
- [x] Add release gate and generator support for `first-run-usability` / `0.9.0-first-run-usability`.
- [x] Update bilingual first-run usability docs, release candidate docs, release operations docs, README/docs nav, roadmap, changelog, and community backlog starter tasks.
- [x] Run the full block gate: focused S1-S5 slices, `npm test`, release smoke, browser sample smoke, live SDK smoke, operator workflow smoke, first-run usability smoke, artifact smoke, package boundary, integration privacy audit, diff check, generated first-run evidence, and release gate.
- [x] Before starting Block T, list every Block T round with the same detail and keep Block T scoped to the next product milestone only.

**Round S5 note (2026-07-01):** Added `0.9.0 First-Run Usability Proof` release gates, generator support, CLI release-gate support, Block S tests, bilingual first-run usability docs, release candidate and release operations updates, README/docs navigation, roadmap, changelog, and community backlog entries. Verification passed with focused S tests, `npm run smoke:first-run-usability`, generated `0.9.0-first-run-usability` evidence, and `node ./scripts/release-gate.mjs --stage first-run-usability --evidence .tmp/first-run-usability-release-evidence.json`.

**Block S acceptance:**

- A non-maintainer can start from empty local state, create/select a KB, validate folders, build, recover from common failures, ask a cited question, and understand the next maintenance action through supported UI/API surfaces.
- First-run state remains SQLite-first and does not reintroduce JSON-first mutable state or browser-storage truth.
- Browser evidence covers desktop and narrow first-run surfaces without leaking credentials, private content, local absolute paths, raw provider payloads, or internal file reads.
- All failure and recovery states are scoped to the selected KB and do not mutate public samples or unrelated KBs.
- `0.9.0 First-Run Usability Proof` release evidence can be generated and reviewed without private context.

**Completion note (2026-07-01):** Block S is implemented. KnowMesh now proves the ordinary first-run path from empty local state through create/select, SQLite-backed readiness, guided local setup, source/workspace precheck, scan and plan preview, recoverable local build, first Query Runtime question, explicit no-answer/refusal without weak success, feedback-to-maintenance next action, desktop/narrow first-run DOM contracts, redacted diagnostics, zero external calls, package asset review, and `0.9.0 First-Run Usability Proof` release evidence. Verification completed with S focused slices, `npm test` (`423/423` passing after re-running one isolated embedding-provider flake), `npm run smoke:release`, `npm run smoke:browser-sample`, `npm run smoke:live-sdk`, `npm run smoke:operator-workflow`, `npm run smoke:first-run-usability`, `npm run smoke:artifact` (`sha256:159f995c30583e5f636240d3bb74ea6d29f54e8e063f7ba604950a7bb115a13a`), `npm run verify:package-boundary` (`rejected: []`, `files: 230`), `npm run verify:integration-privacy` (`21` files, `0` findings), generated first-run evidence, first-run release gate, and `git diff --check`.

---

## Block T: `1.0.0 Usable Product Proof`

**Purpose:** Turn the accepted first-run path into a release-shaped usable product gate: install/launch reliability, real local document intake quality, operator-safe Web Console ergonomics, durable data/package operations, and `1.0.0 Usable` release evidence.

**Why after S:** Block S proved a non-maintainer can reach the first maintainable knowledge base. Block T should now make that path durable enough for a public usability milestone without widening scope into unrelated provider ecosystems.

**Primary files likely to change:**

- Modify/add: launcher scripts, `src/cli/knowmesh.mjs`, `src/local-service/server.mjs`, `src/local-service/platform-runtime.mjs`, `src/web-console/*`, and focused usability tests.
- Modify/add: local parser/OCR fixtures, document intake diagnostics, package/import/export preview tests, and migration/backup tests.
- Modify/add: `scripts/usable-product-smoke.mjs`, release evidence scripts, README/docs index, release docs, roadmap, changelog, and community backlog tasks.

### Round T1: Install, Launch, and First-Window Reliability Proof

- [x] Prove Windows/macOS/Linux launchers can find or prepare Node 24+, start the local service, report port fallback, and open the supported local URL without mutating system PATH.
- [x] Prove fresh launch, restart, and port conflict behavior keep `workspace.sqlite` selection and do not create implicit KBs.
- [x] Add operator-facing diagnostics for launcher/runtime failures with clear next actions and no local absolute path leakage.
- [x] Verify with launcher tests, platform runtime tests, first-run smoke, and a real browser launch check.

**Round T1 note (2026-07-01):** Added `launchReliability` to `platformRuntimeInventory`, wired `npm run smoke:usable-product`, and introduced `scripts/usable-product-smoke.mjs` plus Block T tests. The smoke creates temporary user data, occupies a fixed port to prove fallback reporting, starts the real local service, confirms no implicit KB, validates localhost-only diagnostics, checks cross-platform launcher contracts and PATH mutation guards, creates/restarts a KB to prove `workspace.sqlite` current selection, verifies legacy JSON state is not recreated, confirms maintenance diagnostics redact local absolute paths, records zero external calls, and removes temporary state. Verification passed with `npm test -- scripts/block-t-usable-product.test.mjs`, `npm run smoke:usable-product`, `npm test -- src/local-service/platform-runtime.test.mjs`, focused server tests for platform runtime/port fallback/KB library/fresh local service, and an in-app Browser check that loaded the local Web Console and found the KB/create/sample entry points.

### Round T2: Real Local Document Intake Quality Proof

- [x] Prove the supported local formats path handles PDF, modern Office, WPS/legacy fallbacks, images/scans, and rejected risky inputs through parser/OCR provider boundaries.
- [x] Add reviewable intake diagnostics for unsupported files, missing converters, OCR-needed pages, and unsafe source classes without running cloud calls by default.
- [x] Ensure document inventory, source manifest, scan preview, and targeted rerun all describe the same source set from `catalog.sqlite`.
- [x] Verify with parser/OCR fixtures, source-catalog tests, local-executor tests, operator smoke, and first-run smoke.

**Round T2 note (2026-07-01):** Added scanner-level unsupported file reporting, scan preview `sourcePreparation` and `intakeDiagnostics`, and extended `scripts/usable-product-smoke.mjs` with `documentIntakeProof`. The local intake proof now classifies PDF/image OCR needs, modern Office, macro-capable Office with never-execute policy, WPS/legacy conversion fallback, direct text, and rejected unsupported/risky inputs; exposes user-fixable review queues for missing converters and OCR engines; keeps external calls at zero before explicit execution; and verifies scan preview, catalog source manifest, document inventory, and targeted rerun resolve the same catalog-backed source set. Verification passed with Block T focused tests, `npm run smoke:usable-product`, scan/source/document/parser tests (`21/21`), `npm test -- src/local-service/local-executor.test.mjs` (`50/50`), `npm run smoke:operator-workflow`, `npm run smoke:first-run-usability`, and `git diff --check`.

### Round T3: Usable Web Console Workflow Proof

- [x] Tighten the Web Console around the everyday loop: create/select KB, setup, build, maintain documents, ask, review feedback, publish/version, rollback preview, diagnostics, and package preview.
- [x] Replace confusing internal labels with user-facing wording while preserving expert/operator precision where needed.
- [x] Add desktop and narrow browser assertions for no duplicate controls, no hidden primary actions, no text overlap, and no direct internal-state reads.
- [x] Verify with Web Console tests plus a real browser smoke for the complete usable product path.

**Round T3 note (2026-07-01):** Extended `scripts/usable-product-smoke.mjs` with `webConsoleWorkflowProof`, covering create/select, setup project, scan/plan/create task, execution, documents/evidence search, ask, feedback review, versions/rollback surface, diagnostics, package preview, duplicate primary-control checks, and no direct SQL/table/legacy JSON wording in rendered pages. Public sample card actions were downgraded from `.primary-action` to `.secondary-action sample-action` so the home page keeps one contextual primary action; the static Web Console test now guards this. Verification passed with Block T focused tests, `npm run smoke:usable-product`, `npm test -- src/web-console/app.test.mjs` (`34/34`), focused service Web Console tests (`7/7`), `npm run smoke:browser-sample`, an in-app Browser check on the live local Web Console confirming no horizontal overflow/placeholders and sample buttons as secondary actions, and `git diff --check`.

### Round T4: Durable Data, Backup, and Package Operations Proof

- [x] Prove workspace/catalog backup, package export preview, import preview, version manifest, and rollback can be understood and repeated without private state leakage.
- [x] Add migration and corruption-prevention checks for `workspace.sqlite`, per-KB `catalog.sqlite`, WAL files, and stale JSON/JSONL cleanup.
- [x] Ensure release/package assets exclude runtime state, SQLite databases, credentials, private source content, generated artifacts, and internal-only files.
- [x] Verify with migration tests, package/import/export tests, package boundary, artifact smoke, and privacy audits.

**Round T4 note (2026-07-01):** Extended `scripts/usable-product-smoke.mjs` with `durableDataPackageProof` and a `data-package` scope. The proof seeds legacy K12 JSON state, verifies one-time SQLite adoption and stale JSON/JSONL cleanup, creates the public sample, adds a catalog-backed rollback candidate, checks redacted package export preview, import preview with no writes, version manifest, version diff, rollback preview, confirmed rollback, workspace/catalog backup hash copies, WAL/SHM exclusion, stale JSON authority rejection, package file boundary, release asset privacy, and zero external calls. Verification passed with Block T focused tests, `npm run smoke:usable-product`, package manifest/version/rollback/version manifest/knowledge-base migration tests (`21/21`), `npm test -- scripts/verify-package-boundary.test.mjs`, `npm run verify:package-boundary`, `npm run verify:integration-privacy`, and `npm run smoke:artifact`.

### Round T5: `1.0.0 Usable` Release Evidence

- [x] Add release evidence fields for launch reliability, local document intake quality, Web Console usability, durable data/package operations, browser usability proof, privacy proof, and usable product package asset review.
- [x] Add release gate and generator support for `usable-product` / `1.0.0-usable-product`.
- [x] Update bilingual usable product docs, release candidate docs, release operations docs, README/docs nav, roadmap, changelog, and community backlog starter tasks.
- [x] Run the full block gate: focused T1-T5 slices, `npm test`, release smoke, browser sample smoke, live SDK smoke, operator workflow smoke, first-run usability smoke, usable product smoke, artifact smoke, package boundary, integration privacy audit, diff check, generated usable-product evidence, and release gate.
- [x] Before starting Block U, list every Block U round with the same detail and keep Block U scoped to the next product milestone only.

**Round T5 note (2026-07-01):** Added `1.0.0 Usable Product Proof` release evidence fields, generator support, `release-gate` support, docs, README/docs navigation, roadmap, changelog, community backlog lane, and the T5 focused test. The evidence generator now promotes real `usable-product` smoke proofs into `usableLaunchReliabilityProof`, `usableDocumentIntakeProof`, `usableWebConsoleWorkflowProof`, `usableDurableDataPackageProof`, `usableBrowserWorkflow`, `usablePrivacyProof`, and `usableProductPackageAssetReview`, then evaluates the full first-run/operator/consumer stack through `1.0.0-usable-product`. Verification passed with T5 focused tests, generated usable-product evidence, release smoke, browser sample smoke, SDK consumer smoke, live SDK smoke, operator workflow smoke, first-run usability smoke, usable product smoke, artifact smoke, package boundary, integration privacy audit, `git diff --check`, and full `npm test` after the K5 public-doc wording fix.

**Block T acceptance:**

- A non-maintainer can install/launch, create/select a KB, ingest realistic local documents, build, query, maintain, publish/package, and recover without maintainer-only knowledge.
- All product-visible state remains SQLite-first, scoped per KB, restart-safe, and free of JSON-first mutable state or browser-storage truth.
- Browser evidence covers the complete usable product path on desktop and narrow viewports.
- Package/export/import/release assets remain free of private state, SQLite files, credentials, local absolute paths, raw provider payloads, generated artifacts, and private content.
- `1.0.0 Usable Product Proof` release evidence can be generated and reviewed without private context.

## Block U: `1.0.0 Public Release Candidate Freeze`

**Goal:** Convert the usable product proof into a publishable release-candidate packet: reproducible evidence, fresh-clone install confidence, browser-visible acceptance, community readiness, and a go/no-go release decision.

**Why after T:** Block T proves the product path works. Block U should freeze that proof into a public release process without adding new runtime scope or widening provider behavior.

**Scope guardrails:**

- Do not add new product features unless they unblock a release-candidate acceptance test.
- Keep SQLite-first runtime state unchanged: `workspace.sqlite` for workspace truth and per-KB `catalog.sqlite` for knowledge-base truth.
- Keep JSON/JSONL limited to exports, sidecars, audit, fixtures, schemas, templates, and evidence files.
- Keep npm publication, GitHub Public status, and final release tagging as explicit release decisions, not hidden side effects.

### Round U1: Release Evidence Packet Capture

- [x] Create or extend a script that captures one release-candidate evidence JSON from actual local commands instead of hand-built fixtures.
- [x] Include artifact sha, package boundary, integration privacy, usable-product smoke, browser sample smoke, SDK consumer smoke, live SDK smoke, operator workflow smoke, first-run usability smoke, and release gate result.
- [x] Ensure the evidence packet redacts local paths and never embeds private workspace/catalog data.
- [x] Verify the generated packet passes `node ./scripts/release-gate.mjs --usable-product --evidence <packet>`.

### Round U2: Fresh Clone / Non-Maintainer Install Rehearsal

- [x] Add a fresh-clone style rehearsal that installs from the packed tarball in a temporary external directory and starts the supported user entrypoint.
- [x] Verify launcher-first startup, Web Console availability, sample creation, first query/refusal, feedback, package preview, and cleanup without relying on repository internals.
- [x] Confirm docs quick-start commands match the rehearsal exactly in Chinese and English.
- [x] Guard against implicit default KB creation, browser-storage truth, and local absolute path leakage.

### Round U3: Browser Acceptance and Visual Regression Baseline

- [x] Run the real Web Console in desktop and narrow viewports through first-run, sample, query, feedback, maintenance, diagnostics, versions, and package surfaces.
- [x] Add assertions for no horizontal overflow, no overlapping primary controls, no placeholder text, no direct internal-state wording, and stable accessible actions.
- [x] Capture release-candidate screenshots or DOM evidence to a public-safe evidence path.
- [x] Verify README visual assets and GitHub-facing diagrams remain legible after current product wording changes.

### Round U4: Community and Maintainer Readiness Freeze

- [x] Audit README, README.en, docs index, getting started, architecture, release operations, security, contributing, issue templates, and good-first docs for release-candidate consistency.
- [x] Ensure labels/backlog lanes map to supported product surfaces and current known gaps.
- [x] Add a release-candidate checklist for maintainers that separates required gates from optional publication steps.
- [x] Link accepted limitations to release notes without overstating maturity.

### Round U5: Release Dry Run and Go/No-Go Packet

- [x] Generate a draft release note from the release-candidate evidence packet with supported paths, limitations, known gaps, artifact hash, and verification commands.
- [x] Dry-run package/release assets and ensure no runtime state, SQLite files, credentials, local paths, generated browser artifacts, or private content are included.
- [x] Produce a go/no-go summary that can be reviewed before switching the repository public or publishing a release.
- [x] Run the full block gate: `npm test`, all release-candidate smokes, package boundary, integration privacy, generated evidence, release gate, artifact smoke, and `git diff --check`.

**Round U5 note (2026-07-01):** Added `release-candidate-evidence.mjs`, `smoke:release-candidate`, `generate:release-candidate`, release-gate support for nested evidence packets, bilingual release-candidate freeze docs, release operations links, docs index links, and PR template design-authority gating. The fresh-clone rehearsal now installs the packed tarball in an external temp app, starts the installed `knowmesh` entrypoint, creates the public general sample, checks cited answer/refusal/feedback/package-preview/reset, and cleans temporary state without repository internals. Package assets now explicitly include public sample source files while package-boundary checks still reject private state, SQLite/WAL files, tests, credentials, logs, and private content. Verification passed with focused Block U tests, fresh-clone rehearsal, `npm run smoke:release-candidate`, generated RC evidence plus usable-product release gate, package boundary, integration privacy audit, artifact smoke, `git diff --check`, and full `npm test`.

**Block U acceptance:**

- A release-candidate evidence packet can be generated from real commands and reviewed without private context.
- Fresh-clone install rehearsal proves a non-maintainer can start, sample, query, maintain, package-preview, and clean up.
- Browser evidence covers desktop and narrow viewports without layout regressions or internal-state leaks.
- Public docs, community workflows, and known-gap/release-note mapping are consistent with the actual supported product.
- A go/no-go packet exists before any public switch, tag, or package publication.

## Block V: Public Launch and Adoption Ramp

**Goal:** Turn a frozen release candidate into a carefully announced public project, then capture adoption feedback without destabilizing the SQLite-first product core.

**Why after U:** Block U proves the release candidate can be reviewed safely. Block V should decide publication, collect early external feedback, and protect the product from rushed feature sprawl.

**Scope guardrails:**

- Do not publish, tag, or switch repository visibility from automation without an explicit human release decision.
- Keep launch messaging honest: alpha/RC state, supported paths, limitations, known gaps, and no bundled private data.
- Treat new feedback as triage and evidence, not as immediate architecture churn.

### Round V1: Public Switch Decision Packet

- [x] Convert the Block U go/no-go packet into a human review checklist for repository visibility, release tag, npm decision, and announcement timing.
- [x] Capture final artifact hash, release evidence path, GitHub gate status, known gaps, and rollback plan.
- [x] Ensure publication decisions remain explicit and reversible.

### Round V2: Launch Page and Discovery Polish

- [x] Audit README first viewport, social preview, topics/about text, docs navigation, and search keywords after the RC evidence freezes.
- [x] Keep Chinese default and complete English support.
- [x] Verify visual assets render legibly on GitHub and do not overclaim maturity.

### Round V3: External Feedback Intake

- [x] Create or update beta feedback triage workflows for issues, discussions, sample requests, provider requests, and Expert requests.
- [x] Add a public-safe feedback template that asks for reproduction commands and excludes private data.
- [x] Map feedback into backlog labels, known gaps, release-note carryover, or blocked decisions.

### Round V4: First Contributor Path

- [x] Verify good-first issues, contribution setup, test commands, package boundary rules, and docs links from a non-maintainer perspective.
- [x] Add contributor smoke evidence for one docs-only change and one code-path change.
- [x] Keep extension contribution paths on public APIs only.

### Round V5: Post-Launch Stability Review

- [x] Review early feedback, CI trends, package boundary, privacy audit, and release-candidate evidence drift.
- [x] Decide the next product block from evidence: hardening, docs, provider adapters, K12 quality, or integration adoption.
- [x] Run the full stability gate before any follow-up release.

**Round V5 note (2026-07-01):** Added `public-launch-evidence.mjs`, `smoke:public-launch`, `generate:public-launch`, bilingual Public Launch docs, launch feedback issue template, community backlog labels, first contributor path guidance, PR public API safety checks, and Block W planning. Public launch evidence now reuses real RC evidence, checks discovery/readiness/feedback/contributor/stability gates, and keeps publication side effects blocked with `publicationDecision: human-review-required` and `releaseAllowed: false`. Verification passed with Block V focused tests and real `npm run smoke:public-launch`.

**Block V acceptance:**

- Public launch decisions are documented and separated from automation.
- README/docs/discovery assets are honest, searchable, and bilingual.
- Feedback intake is public-safe and mapped to triage/known-gap/release-note workflows.
- Contributors have a tested first path.
- Post-launch stability review produces the next block plan from evidence.

## Block W: Sustained Adoption and 1.0 Stabilization

**Goal:** Convert post-launch signals into a stable `1.0` preparation loop: prioritize evidence-backed fixes, protect the public API, harden docs and samples, and avoid broad feature sprawl.

**Why after V:** Block V prepares public launch and feedback intake. Block W should use that intake to stabilize the project for repeated external use instead of expanding the product surface prematurely.

**Scope guardrails:**

- Do not add new large feature areas without evidence from public feedback or failed launch gates.
- Keep public API and Query Runtime contracts stable unless a breaking-change note and migration path are explicit.
- Keep K12, Provider, Expert, and Integration changes behind their documented extension boundaries.

### Round W1: Launch Feedback Triage Review

- [x] Aggregate public launch feedback into known gaps, docs fixes, sample requests, provider requests, integration issues, K12 quality issues, or blocked decisions.
- [x] Require safe reproduction evidence or public sample reproduction before promoting feedback into engineering work.
- [x] Produce a prioritized stabilization queue with owners, labels, and verification commands.

### Round W2: Public API Stability Lock

- [x] Audit Query Runtime, integration endpoints, SDK exports, OpenAPI, examples, and docs for drift after public feedback.
- [x] Add compatibility tests for accepted public API shapes.
- [x] Document any breaking-change candidates as blocked until a migration plan exists.

### Round W3: Docs and Samples Hardening

- [x] Improve the paths that caused the most confusion: README, getting started, public samples, integration examples, provider diagnostics, and K12 Expert docs.
- [x] Keep examples credential-free unless explicitly documented as provider execution.
- [x] Verify bilingual docs and sample commands from a fresh checkout perspective.

### Round W4: Reliability and Privacy Regression Gate

- [x] Re-run release candidate, public launch, package boundary, integration privacy, browser smoke, and artifact smoke gates.
- [x] Add regression tests for any launch feedback that touches privacy, local paths, package assets, or SQLite authority.
- [x] Keep generated evidence public-safe and free of local/private state.

### Round W5: 1.0 Stabilization Decision

- [x] Decide whether the next block should be 1.0 hardening, K12 quality, provider adoption, integration adoption, or docs/community scale.
- [x] Produce a `1.0 stabilization` go/no-go packet with accepted gaps and deferred work.
- [x] Keep tag/npm/public announcements as human review decisions.

**Round W5 note (2026-07-01):** Added `stabilization-evidence.mjs`, `smoke:stabilization`, `generate:stabilization`, bilingual `1.0 Stabilization` docs, bilingual `Public API Stability` docs, stabilization backlog labels, integration public API wording, and K12 Query Runtime boundary notes. The stabilization evidence reuses real public-launch/RC evidence, gates launch feedback triage, public API stability, docs/samples hardening, reliability/privacy regression, and the `1.0-api-reliability-hardening` next-block decision while keeping `releaseAllowed: false` and `stabilizationDecision: human-review-required`. Verification passed with Block W focused tests, readiness review, and real `npm run smoke:stabilization`.

**Block W acceptance:**

- Launch feedback is triaged into a prioritized, public-safe stabilization queue.
- Public API contracts are protected by tests and documented compatibility boundaries.
- Docs and samples reflect the highest-friction adoption paths.
- Reliability and privacy gates remain green after launch feedback changes.
- The next block is chosen from adoption/stability evidence.

## Block X: 1.0 API Reliability and Quality Hardening

**Goal:** Turn the stabilization decision into a narrow `1.0` hardening pass: protect public APIs, improve answer reliability, expand privacy/security regression coverage, and reconcile release evidence before any human publication decision.

**Why after W:** Block W chooses the next stabilization direction from evidence. Block X should harden the default `1.0-api-reliability-hardening` path without introducing new feature surface.

**Scope guardrails:**

- Do not add new major product capabilities unless they fix a failed reliability, privacy, or public API compatibility gate.
- Do not change Query Runtime response semantics without explicit compatibility tests and a migration note.
- Keep publication, tag, npm, and announcement decisions outside automation.

### Round X1: Public API Compatibility Harness

- [x] Freeze accepted Query Runtime, Integration Manifest, Provider Diagnostics, Package Preview, Version Manifest, OpenAPI, SDK, and expected-response shapes.
- [x] Add compatibility tests that fail on accidental field removal, status drift, or direct internal-state exposure.
- [x] Document any versioned compatibility boundary in API stability docs.

### Round X2: Query Runtime Reliability Hardening

- [x] Add regression cases for answered, out-of-scope, insufficient-evidence, provider-unavailable, blocked-by-quality, and feedback-maintenance paths.
- [x] Strengthen citation support checks and display serialization guards.
- [x] Keep no-answer/refusal states explicit and citation-free when evidence is insufficient.

### Round X3: Package and Installer Reliability

- [x] Rehearse packed install, launcher-first start, public sample creation, query/refusal/feedback/package-preview/reset, and cleanup on external temp roots.
- [x] Verify package assets include public samples and exclude private state, SQLite/WAL, generated artifacts, tests, local paths, and credentials.
- [x] Keep Windows/macOS/Linux launcher contracts documented and tested.

### Round X4: Privacy and Security Regression Expansion

- [x] Expand privacy scans across docs, examples, SDK, diagnostics, release evidence, public samples, package previews, and provider outputs.
- [x] Add targeted regressions for local absolute paths, credential-like strings, private content, raw provider payloads, browser-storage truth, and direct SQLite reads.
- [x] Keep all evidence public-safe and redact by default.

### Round X5: 1.0 Release Candidate Reconciliation

- [x] Generate a `1.0 API Reliability` evidence packet from fresh local gates.
- [x] Reconcile accepted gaps, known limitations, migration notes, and deferred work.
- [x] Produce a go/no-go packet for human review before any tag, npm publication, visibility change, or announcement.

**Block X acceptance:**

- Public API shapes are protected by compatibility tests.
- Query Runtime reliability regressions cover the user-visible status matrix.
- Package and installer flows pass from packed artifacts.
- Privacy and security scans cover docs, examples, SDK, diagnostics, package, and evidence outputs.
- A human-review-only 1.0 release candidate packet exists.

### Round X5 Implementation Note

- Added `scripts/api-reliability-evidence.mjs` and `scripts/block-x-api-reliability.test.mjs`.
- Added `smoke:api-reliability` and `generate:api-reliability`.
- Added bilingual API reliability docs and API stability compatibility/status-matrix guidance.
- The generated evidence remains `releaseAllowed=false` and `releaseDecision=human-review-required`.

## Block Y: 1.0 Community Release Readiness

**Goal:** Turn the hardened 1.0 API reliability packet into a public-facing community release readiness pass: contributor experience, issue triage, docs discoverability, release-note quality, and adoption loops must be ready before a human publication decision.

**Why after X:** Block X protects the public API and package reliability boundary. Block Y can now focus on the humans around the release without reopening product/API semantics.

**Scope guardrails:**

- Do not change public API shapes unless X gates fail and a migration note is added.
- Do not publish, tag, switch visibility, or announce from automation.
- Keep all community examples credential-free and public-safe.

### Round Y1: Contributor Onboarding Rehearsal

- [x] Rehearse a docs-only contribution path from README to docs index, issue template, PR template, and verification command.
- [x] Rehearse a small code-path contribution through public API tests without touching internal SQLite state.
- [x] Make contributor guidance explain current-design authority, no JSON-first shims, package boundary, and privacy rules.

### Round Y2: Issue Triage And Support Operations

- [x] Verify bug, docs, sample request, provider adapter, expert request, and launch feedback templates collect public-safe reproduction evidence.
- [x] Add triage lanes for API compatibility, Query Runtime reliability, package/install, privacy/security, docs, and K12 Expert feedback.
- [x] Map each lane to owner expectations, labels, verification commands, and known-gap carryover.

### Round Y3: Discovery And Documentation Quality

- [x] Review README first viewport, docs index, getting started, public samples, integrations, API reliability docs, and roadmap for search/discovery clarity.
- [x] Ensure Chinese default and complete English docs stay aligned.
- [x] Keep maturity language honest: alpha/public launch candidate, local-first, SQLite-backed, citation-aware.

### Round Y4: Release Notes And Adoption Loop

- [x] Draft release-note sections for supported paths, limitations, known gaps, verification evidence, package hash, and rollback plan.
- [x] Define adoption loops for first users: feedback intake, sample requests, integration reports, provider requests, and K12 quality reports.
- [x] Keep announcement timing, tag, npm, and repository visibility as human-reviewed decisions.

### Round Y5: Community Release Readiness Evidence

- [x] Generate a `1.0 Community Release Readiness` evidence packet from X gates plus community/docs/triage checks.
- [x] Reconcile deferred work and known limitations into release notes and backlog lanes.
- [x] Produce a final human review packet before any public release side effect.

**Block Y acceptance:**

- Contributor onboarding is rehearsed through docs-only and code-path routes.
- Issue templates and triage lanes are public-safe and mapped to commands.
- README/docs discovery is clear for both Chinese and English audiences.
- Release notes and adoption loops are ready for human review.
- A human-review-only community release readiness packet exists.

### Round Y5 Implementation Note

- Added `scripts/community-release-readiness-evidence.mjs` and `scripts/block-y-community-release.test.mjs`.
- Added `smoke:community-release` and `generate:community-release`.
- Added bilingual Community Release Readiness docs and linked them from docs indexes.
- Added support lanes for API compatibility, Query Runtime reliability, package/install, privacy/security, docs discovery, K12 feedback, provider adapters, and public samples.

## Block Z: 1.0 Final Publication Review

**Goal:** Prepare the final human publication review packet from all prior gates without performing release side effects. This block is the last review layer before maintainers decide visibility, tag, GitHub release, npm publication, and announcement timing.

**Why after Y:** Block Y proves the community-facing release surface is ready. Block Z should only assemble final publication evidence, check external GitHub state, and produce a maintainer decision packet.

**Scope guardrails:**

- Do not publish npm, create tags, create releases, switch visibility, or announce automatically.
- Do not change product/API semantics unless an earlier gate fails and the relevant block is reopened.
- Keep final packets public-safe and reproducible from local commands.

### Round Z1: Final Evidence Rollup

- [x] Roll up RC, public launch, stabilization, API reliability, and community readiness evidence into one final packet.
- [x] Capture artifact hash, package file count, public-safe evidence paths, and verification commands.
- [x] Verify no packet contains private paths, credentials, raw provider payloads, or source document text.

### Round Z2: GitHub And Repository State Review

- [x] Check CI, CodeQL, Scorecard, issue templates, branch protection expectations, topics/about text, social preview, and SECURITY/CONTRIBUTING presence.
- [x] Capture repository visibility decision as human-review-required.
- [x] Keep GitHub release and tag actions draft/manual.

### Round Z3: npm And Package Publication Review

- [x] Review package metadata, exports, bin launcher, npmignore/package boundary, artifact hash, and packed install rehearsal.
- [x] Confirm npm publication remains a separate decision from GitHub release.
- [x] Produce rollback notes for failed publication or post-release package issues.

### Round Z4: Announcement And Support Readiness

- [x] Draft announcement checklist for Chinese/English audiences without overclaiming maturity.
- [x] Link support lanes, known gaps, release notes, public samples, and integration docs.
- [x] Define first 72-hour maintainer response loop for feedback, bug reports, and security reports.

### Round Z5: Human Publication Decision Packet

- [x] Generate a `1.0 Final Publication Review` packet.
- [x] List required maintainer decisions: visibility, tag, GitHub release, npm publish, announcement, rollback owner.
- [x] Mark the automation result as `publicationDecision: human-review-required`.

**Block Z acceptance:**

- Final evidence rollup is complete and public-safe.
- GitHub/repository state review is captured without side effects.
- npm/package publication remains a separate manual decision.
- Announcement and support readiness are documented.
- The final publication packet is human-review-only.

### Round Z5 Implementation Note

- Added `scripts/final-publication-review-evidence.mjs` and `scripts/block-z-final-publication.test.mjs`.
- Added `smoke:final-publication` and `generate:final-publication`.
- Added bilingual Final Publication Review docs and linked them from docs indexes.
- The final packet remains `releaseAllowed=false` and `publicationDecision=human-review-required`.

### Post-Z Decision Checklist Note

- Added bilingual `Publication Decision Checklist` docs that organize local evidence refresh, read-only GitHub/npm checks, human-approved visibility/tag/GitHub Release/npm/announcement commands, rollback ownership, release-note requirements, stop conditions, execution records, and the Block AA Round AA1 entry.
- Updated final-publication evidence readiness so the human publication decision packet requires the checklist links and command coverage while still performing no publication side effects.

## Block AA: Post-Publication Monitoring

**Goal:** Monitor the first public release after maintainers have actually completed publication decisions. This block must not start until visibility/tag/release/npm/announcement decisions have been made by humans.

**Why after Z:** Block Z only prepares the final publication decision packet. Block AA depends on external state created by maintainers, so automation can prepare the plan but should not claim it is complete before publication happens.

**Scope guardrails:**

- Do not simulate publication as monitoring success.
- Do not close known gaps without issue or release-note evidence.
- Keep security reports private and route them through SECURITY.md.

### Round AA1: First 24-Hour Health Review

- [ ] Capture CI, release asset, package install, README/docs link, issue intake, and security contact health after publication.
- [ ] Verify public samples still work from the published artifact.
- [ ] Record any launch-blocking regression as a priority rollback candidate.

### Round AA2: Feedback And Triage Loop

- [ ] Review new issues, discussions, sample requests, provider requests, and K12 quality reports.
- [ ] Map feedback to support lanes, known gaps, docs fixes, or release-note carryover.
- [ ] Keep private data out of public issues and move sensitive reports to the security path.

### Round AA3: Package And Integration Adoption Checks

- [ ] Verify real downstream install/import flows for `knowmesh` and `knowmesh/sdk`.
- [ ] Check Query Runtime, feedback, package preview, provider diagnostics, and version manifest against the published artifact.
- [ ] Capture integration friction without changing public API semantics.

### Round AA4: Docs And Announcement Follow-Up

- [ ] Update FAQ, known gaps, getting started, integrations, and release notes based on real feedback.
- [ ] Keep Chinese default and English docs aligned.
- [ ] Avoid promotional overclaiming; keep maturity and limitations explicit.

### Round AA5: Post-Publication Retrospective

- [ ] Produce a post-publication monitoring packet.
- [ ] Summarize adoption signals, regressions, security reports, rollback decisions, and next roadmap priorities.
- [ ] Decide whether to start the next product block or patch release branch.

**Block AA acceptance:**

- Real publication has happened through human decisions.
- First 24-hour health and feedback loops are captured.
- Published package/integration flows are verified.
- Docs and known gaps reflect real public feedback.
- A post-publication monitoring packet exists.

## Verification Matrix

Run after every round:

```powershell
git diff --check
npm test -- <changed-test-files>
```

Run after every block:

```powershell
npm test
npm run smoke:release
npm run smoke:artifact
npm run smoke:public-launch
npm run smoke:stabilization
npm run smoke:api-reliability
npm run smoke:community-release
npm run smoke:final-publication
npm run verify:package-boundary
git diff --check
```

Run before any public release:

```powershell
npm pack --json
gh run list --repo shineway-tech/KnowMesh --branch main --limit 10 --json workflowName,status,conclusion,headSha,url
gh release view v0.1.0-alpha --repo shineway-tech/KnowMesh --json isDraft,targetCommitish,assets,url
```

## Block Order and Rework Prevention

1. Block A before Block C: Query Runtime must consume stable catalog search/evidence records.
2. Block B before deep Provider work: provider adapters should plug into a manifest/checkpoint pipeline, not define it.
3. Block C before Web Console polish: UI should render stable runtime statuses, not force response-shape changes.
4. Block D after C: K12 Expert should use stable route/evidence/citation contracts.
5. Block E after C/D: feedback and evaluation should point at concrete evidence and Expert gates.
6. Block F after B/C: provider capabilities should describe actual execution/query boundaries.
7. Block G freezes platform and public API docs only after product contracts settle.
8. Block H turns the frozen product into a public launch candidate with real samples, public docs, governance, and release evidence.
9. Block I improves adoption and extension readiness only after the public story and release gate are stable.
10. Block J proves beta-critical paths through real public samples, integrations, lifecycle docs, and release evidence.
11. Block K turns beta proof into repeatable maintainer operations, browser smoke automation, certification, and release evidence generation.
12. Block L returns to the product core and hardens `0.2.0 Searchable` using the repeatable gates from Block K.
13. Block M hardens evidence-first Query Runtime only after Searchable retrieval and maintenance workflows are stable.
14. Block N turns Expert extensibility into a contributor-safe SDK foundation only after Query Runtime contracts settle.
15. Block O makes provider execution replaceable only after Expert and Query Runtime boundaries are stable.
16. Block P packages the public integration surface only after provider diagnostics and no-cloud guarantees exist.
17. Block Q proves downstream adoption only after the SDK and integration contract are stable.
18. Block R proves operator workflows only after downstream API/SDK adoption no longer requires internals.
19. Block S turns the operator workflow into first-run user usability only after maintainer recovery and rollback paths are proven.
20. Block T turns the proven first-run path into a usable product milestone only after launch, setup, build, query, feedback, and maintenance next action are evidence-backed.
21. Block U freezes the usable product milestone into a public release candidate only after real usable-product evidence and package/privacy boundaries pass.
22. Block V turns the frozen release candidate into a public launch/adoption ramp only after RC evidence, fresh-clone install, docs readiness, and go/no-go review pass.
23. Block W converts public launch signals into 1.0 stabilization only after public-switch decisions, feedback intake, contributor path, and post-launch stability gates pass.
24. Block X hardens 1.0 API reliability only after stabilization evidence selects it as the next block and public API/docs/sample boundaries are locked.
25. Block Y prepares community release readiness only after public API reliability, package/install, and privacy/security gates are stable.
26. Block Z prepares final publication review only after contributor onboarding, issue triage, docs discovery, release notes, and adoption loops are ready.
27. Block AA monitors the public release only after humans complete actual publication decisions.

## Suggested First Execution Chunk

The active next execution chunk is **Block AA Round AA1** only after human publication decisions are complete. It is the smallest durable move that reduces future rework:

- capture first 24-hour CI, release asset, package install, README/docs link, issue intake, and security contact health;
- verify public samples from the published artifact;
- record launch-blocking regressions as rollback candidates;
- keep publication, tag, npm, visibility, and announcement decisions outside automation.

Do not start AA1 until maintainers have actually completed visibility/tag/release/npm/announcement decisions.
