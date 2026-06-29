# KnowMesh Current Design

Design version: `1.0.0`  
Target product baseline: `0.2.0`  
Status: current implementation contract before public release

This is the single current design document for KnowMesh. It replaces the former
product blueprint, data standard, configuration guide, user guide, and
development principles documents. When the product direction changes, useful
information must be merged into this file and the replaced text must be removed.

## 1. Positioning

KnowMesh is a local-first, open-source system that compiles source materials into
verifiable, traceable, maintainable, and integrable knowledge assets.

KnowMesh is not:

- a vector database UI;
- an OCR-only tool;
- a local chatbot demo;
- a CLI-first tool for ordinary users.

The ordinary user entry is the local Web Console. The CLI, launchers, and scripts
exist to start the local service, automate local work, and support development.

The product promise is:

> Turn source materials into knowledge assets that users can trust, inspect,
> update, version, and integrate into other applications.

## 2. Non-Negotiable Product Principles

1. Start from a knowledge base, not from global loose configuration.
2. Every knowledge base has isolated setup, credentials selection, source scope,
   tasks, versions, logs, feedback, generated assets, and recovery state.
3. Product state must not depend on browser storage, port number, or a single
   page session. Browser storage is only for visual preferences such as language,
   theme, and sidebar state.
4. The console question page and third-party integrations must use the same
   Query Runtime. No hardcoded UI-only answer path is allowed.
5. Long tasks must checkpoint, log, pause, resume, retry, and recover without
   starting from the beginning.
6. Quality problems must become reviewable maintenance work. Do not silently
   drop imperfect content and do not pretend weak answers are successful.
7. User-facing UI must show user goals, current state, risks, and next actions,
   not internal plans or implementation details.
8. The repository must stay clean. Remove replaced code, abandoned routes,
   obsolete docs, unused helpers, and temporary examples.
9. The project is not publicly released yet, so compatibility with abandoned
   local drafts is not a reason to keep old architecture.
10. Every feature must answer: does it make the knowledge asset more reliable,
    traceable, maintainable, or easier to integrate?

## 3. Product Readiness Levels

KnowMesh must not call a knowledge base "done" merely because files were
embedded.

| Level | Name | Meaning |
| --- | --- | --- |
| `0.1.0` | Importable | Sources can be scanned, extracted, chunked, and written. |
| `0.2.0` | Searchable | Keyword, vector, metadata, and source filters can find relevant records. |
| `1.0.0` | Usable | Real user questions produce scoped, cited, non-fabricated answers. |
| `2.0.0` | Commercial | The knowledge base is maintainable, evaluable, versioned, recoverable, and integrable at scale. |

The current implementation is between `0.2.0` and `1.0.0`. The next architecture
reset must move KnowMesh toward `1.0.0` usability instead of adding surface-level
patches.

## 4. Required Architecture

KnowMesh is organized into five layers.

```text
KnowMesh Core
  Universal lifecycle: scan, extract, OCR orchestration, clean, structure,
  chunk, embed, write, version, evaluate, recover.

KnowMesh Expert
  Domain plugins. They define industry semantics, special processors,
  quality gates, evaluation sets, and query-router rules.

Knowledge Asset Layer
  The storage and version truth for documents, pages, blocks, structures,
  chunks, citations, evaluations, feedback, and releases.

Provider Layer
  Replaceable OCR, parser, model, embedding, rerank, vector store, object
  store, and export providers.

Platform Layer
  Windows, macOS, and Linux differences for paths, launchers, file picking,
  opening folders, process management, and local runtime setup.
```

Core must not become K12 Core. Industry logic belongs in Expert plugins. Avoid
main-flow checks like `if template === "k12"` except where the template registry
selects a declared Expert capability.

## 5. Storage Architecture

JSON files are not the primary state store. JSON remains useful for exports,
audit artifacts, sidecar publication, and human-readable reports, but not for
large-scale query, paging, filtering, recovery, or maintenance.

### 5.1 Storage Principles

- `workspace.sqlite` stores global workspace state.
- Each knowledge base owns one `catalog.sqlite`.
- The file system stores large artifacts.
- Parquet stores large immutable or analytical intermediate outputs.
- JSON and JSONL are export, audit, and cloud sidecar formats.
- Vector stores accelerate retrieval; they are not the business truth source.

### 5.2 Workspace Layout

```text
workspace/
  workspace.sqlite
  knowledge-bases/
    <knowledgeBaseId>/
      catalog.sqlite
      artifacts/
        sources/
        pages/
        figures/
        ocr/
        normalized/
        markdown/
        reports/
      parquet/
        pages.parquet
        chunks.parquet
        evaluation.parquet
      published/
        oss-sidecar/
      logs/
```

### 5.3 Global Database

`workspace.sqlite` stores:

- knowledge-base registry;
- current selected knowledge base;
- display name, template, mode, state summary;
- recent task summary;
- configured workspace paths;
- UI-independent user preferences that must survive port changes;
- schema migration history.

### 5.4 Knowledge-Base Database

Each `catalog.sqlite` stores:

- source documents and logical document versions;
- pages, blocks, structure nodes, and knowledge objects;
- template-specific extension objects;
- chunks, citations, quality states, and index records;
- tasks, task steps, checkpoints, and append-only event pointers;
- evaluation cases and evaluation results;
- query feedback and feedback resolutions;
- build versions, activation state, rollback state, and release manifests.

Large text, original files, page images, OCR raw responses, figure crops, and
export reports stay in artifacts. Database rows store paths, hashes, state, and
queryable metadata.

### 5.5 SQLite Requirements

- Use WAL mode.
- Use migrations with `schema_version` and `migration_history`.
- Add indexes for knowledge-base pages, document lists, quality filters,
  structure lookups, and feedback queues.
- Use FTS5 for local full-text search where appropriate.
- Do not store secrets.
- Do not store unbounded large blobs in tables.
- Use transactions for build and publish state changes.
- Write new versions as draft, validate, publish, then activate.

## 6. Knowledge Asset Manifests

Every generated knowledge base version must have these logical manifests. They
may be database tables, Parquet outputs, or published JSON/JSONL exports.

| Manifest | Purpose |
| --- | --- |
| Source Manifest | Which files are included, excluded, changed, missing, or out of scope. |
| Extraction Manifest | Per-file and per-page extraction, OCR, confidence, retry, and failure state. |
| Structure Sidecar | Document hierarchy, sections, pages, domain objects, and relations. |
| Chunk Manifest | Chunk text, context, source, quality, page, block, and structure path. |
| Index Manifest | What was written to vector/keyword/structure indexes and why. |
| Evaluation Manifest | Template evaluation cases, outcomes, scores, and failures. |
| Version Manifest | Build version, active state, rollback target, and diff summary. |

These manifests are the basis for diagnostics, maintenance, API answers,
exports, and future incremental updates.

## 7. Knowledge Build Pipeline

The build pipeline is not "upload files then vectorize." It is a knowledge
compilation pipeline.

```text
1. Create or select knowledge base
2. Configure mode, providers, template, source scope, and retrieval policy
3. Scan source folder and classify files
4. Resolve logical documents and split-file groups
5. Extract text, pages, tables, images, formulas, and layout
6. Classify pages and blocks
7. Generate domain structures through Expert plugins
8. Clean, normalize, and quality-score content
9. Create chunks by knowledge object, not fixed size only
10. Build structure index, keyword index, vector index, and sidecars
11. Run template evaluation set and quality gates
12. Publish a version only when required gates pass
13. Expose query, citations, feedback, maintenance, and integration APIs
```

### 7.1 Source Intake

Supported source families:

- PDF: readable, scanned, and mixed;
- Word: DOCX, DOCM, DOC when a converter is available;
- Excel: XLSX, XLSM, XLS when a converter is available;
- PowerPoint: PPTX, PPTM, PPT when a converter is available;
- WPS formats: WPS, ET, DPS when a converter is available;
- Markdown, TXT, CSV, TSV, RTF;
- images and scanned materials.

Macros are never executed. Unsupported or unsafe files enter review instead of
being silently skipped.

### 7.2 Original Archive vs Processing Input

Original sources are archived for traceability and rollback. Processing input is
derived from extraction, OCR, cleanup, and structure rules. Vectorization uses
processing input, not raw PDF files.

Aliyun mode may upload original files and sidecars to OSS, but must not create a
"upload then download to process" loop.

### 7.3 OCR and Parsing Providers

Provider choices must remain replaceable.

Default provider classes:

- local parsers: Docling, Marker, MinerU, or equivalent parser adapters;
- local OCR/layout fallback: PaddleOCR / PP-Structure or equivalent adapter;
- Aliyun OCR: Qwen OCR / Qwen VL OCR through Model Studio;
- embedding: provider batch API when available;
- rerank: provider rerank model or local rerank adapter;
- vector: Aliyun OSS Vector for Aliyun mode; local vector provider later.

OCR is not the source of truth for structure. OCR recognizes content; Expert
processors turn content into domain objects and validate it.

### 7.4 Batch and Retry

- OCR, embedding, rerank, vector writes, and evaluation must prefer provider
  batch or async batch APIs.
- If a provider does not support batch, fallback must be logged.
- External calls must use bounded concurrency.
- Retry only network errors, timeouts, 429, 5xx, and provider-declared
  transient errors.
- Batch-size errors must auto-split into smaller batches and continue.
- Authentication, permission, model-not-found, and invalid index errors fail
  immediately with a user-fixable diagnosis.
- Every long step writes checkpoints after each batch.

## 8. Query Runtime

Query Runtime is a product contract, not a UI shortcut. Console testing,
integration examples, and third-party applications use the same runtime.

### 8.1 Query Route

```text
Question
  -> detect domain and scope
  -> reject if clearly outside knowledge-base scope
  -> classify intent
  -> choose query route
  -> retrieve evidence
  -> validate evidence
  -> generate answer only when evidence is sufficient
  -> return citations, checks, and feedback actions
```

### 8.2 Query Routes

| Intent | Route |
| --- | --- |
| Table of contents, unit, lesson, page lookup | Structure Sidecar first |
| Concept explanation | Structure + vector + rerank |
| Original text or page citation | Citation/structure lookup |
| Exercise or example | Domain object lookup + vector |
| Cross-book or cross-volume comparison | Multi-scope retrieval, then compare |
| Out-of-scope question | Refuse before retrieval |
| General document answer | Hybrid retrieval + citation validation |

### 8.3 Answer Success Definition

`answered` is not enough. A usable answer must:

- match the requested scope;
- cite source document and page or section;
- use evidence that supports the answer;
- avoid unsupported claims;
- avoid returning unrelated citations for a refusal;
- avoid weak answers that only say "the current source does not confirm";
- never expose `[object Object]`, raw exceptions, or provider internals.

## 9. Quality Gates

Quality Gates are mandatory before publish and before claiming a query response
is usable.

### 9.1 Build Gates

- Source scope is enforced.
- Extraction success is measured per file and per page.
- OCR failures are recorded with retry state.
- Every chunk has source, page or block, structure path, and quality state.
- High-risk or low-confidence content enters review.
- Template-required structure exists.
- Sidecar and vector records are consistent.
- Evaluation set passes minimum thresholds.

### 9.2 Query Gates

- Scope fit.
- Evidence found.
- Citation traceability.
- Citation supports answer.
- No out-of-scope leakage.
- No weak answer counted as success.
- No display serialization errors.

### 9.3 Quality States

| State | Behavior |
| --- | --- |
| `primary` | Main trusted content, write-enabled. |
| `weighted` | Write-enabled with lower retrieval weight. |
| `review` | Not written by default; needs user or maintainer review. |
| `archive` | Preserved for traceability only. |

## 10. Template and Expert System

Templates are processing strategies, not marketing descriptions.

Each Expert must contain:

```text
template.json
schema.json
processors/
quality-gates/
evaluation-cases/
query-router-rules/
migrations/
```

Templates must define:

- commercial fit;
- unsuitable scenarios;
- required user choices;
- metadata fields;
- source-scope rules;
- archive policy;
- processing-input policy;
- filtering policy;
- structure policy;
- chunking policy;
- citation policy;
- quality gates;
- evaluation questions;
- update policy;
- migrations;
- optional Expert processors.

Community Experts must use public Core interfaces. They must not mutate Core
tables directly or depend on internal file paths.

## 11. KnowMesh Expert - K12

K12 is a course-structure knowledge domain. It is not a generic document folder.

### 11.1 K12 Required Dimensions

- stage: primary, junior, senior;
- grade;
- subject;
- volume: upper, lower, compulsory, elective;
- publisher / edition;
- book title;
- unit;
- lesson / section;
- page;
- column type;
- knowledge point;
- exercise / example / experiment / activity;
- figure / table / formula relations.

### 11.2 K12 Page Classification

Every page should be classified as one or more of:

- cover;
- copyright;
- preface;
- table of contents;
- unit guide;
- lesson text;
- annotation;
- oral communication;
- writing;
- vocabulary table;
- exercise;
- example;
- experiment;
- activity;
- table;
- figure;
- appendix;
- review material;
- noise / archive-only.

### 11.3 K12 Domain Objects

KnowMesh Expert - K12 must generate these object types when evidence exists:

- `book`;
- `unit`;
- `lesson`;
- `section`;
- `column`;
- `text`;
- `vocabulary`;
- `knowledge_point`;
- `formula`;
- `table`;
- `figure`;
- `example`;
- `exercise`;
- `answer_explanation`;
- `experiment`;
- `activity`;
- `citation_anchor`.

### 11.4 K12 Subject Rules

Chinese:

- Preserve lesson title, author, body, annotations, after-class questions,
  reading links, oral communication, writing, Chinese garden, vocabulary lists,
  and word tables.
- Vocabulary and word tables are structured objects, not ordinary paragraphs.

Math:

- Preserve concepts, examples, formulas, diagrams, conditions, solution steps,
  exercises, answers, and explanations as connected objects.
- Formulas should be stored as LaTeX or structured formula text when possible.

English:

- Preserve Unit, Lesson, Words, Sentences, Dialogue, Phonics, Culture, and
  theme objects.

Science:

- Preserve experiment purpose, materials, steps, observations, conclusion, and
  safety notes.

Ethics / morality:

- Preserve theme, case, activity, discussion prompt, and value objective.

Music, art, PE, labor, and other non-text-heavy subjects:

- Preserve image, score, action, artwork, material, activity, and task context.

### 11.5 K12 Query Requirements

K12 Query Router must support:

- "Which texts are in Unit N?";
- "What is the first lesson of Unit N?";
- "Which vocabulary words are in this book/unit/lesson?";
- "What does this math unit teach?";
- "Which examples or exercises explain this concept?";
- "What is the English Unit N topic and vocabulary?";
- "Which page contains this knowledge point?";
- "Compare upper and lower books";
- "Compare publishers or editions";
- strict refusal for out-of-scope subjects and non-owned books.

### 11.6 K12 Evaluation Set

Every K12 build must run evaluation cases covering:

- TOC lookup;
- unit lesson lookup;
- vocabulary lookup;
- writing/oral communication lookup;
- math concept lookup;
- math example lookup;
- English unit theme;
- English vocabulary;
- science experiment;
- page citation;
- cross-volume comparison;
- publisher comparison;
- out-of-scope refusal;
- no-answer behavior.

Minimum gates:

- out-of-scope refusal: 100%;
- display serialization errors: 0;
- citation-bearing usable answers for required K12 evaluation set: target 85%
  before `usable`, higher before `commercial`;
- TOC structure completeness: target 95% for K12 books;
- every usable answer must cite source and page or structure anchor.

## 12. Cross-Platform Requirements

KnowMesh must support Windows, macOS, and Linux.

### 12.1 Path Rules

Store all of:

- original path;
- normalized relative path;
- content hash;
- workspace-relative artifact path;
- platform path hint.

Path handling must support:

- Windows drive letters;
- slash and backslash normalization;
- Chinese paths;
- paths with spaces;
- case-sensitive and case-insensitive filesystems;
- long paths;
- symbolic links;
- locked files.

### 12.2 Platform Layer

Platform code owns:

- launcher behavior;
- private runtime setup;
- file and folder picking;
- opening a folder and selecting a file;
- process management;
- port conflict handling;
- OS-specific dependency checks.

Business code must not scatter OS conditionals.

## 13. Open-Source Project Requirements

KnowMesh should grow as a trustworthy open-source project, not a private demo.

### 13.1 Governance

Maintain:

- README as entry and navigation;
- CHANGELOG with numeric versions;
- CONTRIBUTING with contribution rules;
- SECURITY with private vulnerability reporting;
- LICENSE;
- current design document;
- future OpenAPI and Expert authoring documentation when stable.

Recommended license remains `MIT` unless the project deliberately switches to
`Apache-2.0` before public release.

### 13.2 Security

- Secrets must not enter databases, logs, exports, reports, or sidecars.
- Diagnostic export must redact credentials and private source text by default.
- Remote actions require explicit confirmation.
- Provider plugins must declare cost, privacy, and permission boundaries.
- Future release packages should include checksums and preferably signatures.

### 13.3 Plugin Ecosystem

Plugins and Experts should be categorized:

- official;
- certified;
- community;
- experimental.

Every non-official plugin must show capability and permission requirements
before installation or activation.

### 13.4 Copyright and Data Boundary

- KnowMesh does not bundle copyrighted textbooks or private data.
- Templates provide processing strategy, not content.
- Users are responsible for source authorization.
- Exports must clearly indicate whether original files, page images, or text
  snippets are included.

## 14. User Experience Contract

### 14.1 Home

The home page should introduce the product and route users to the right next
action:

- no knowledge base: create one;
- setup incomplete: continue setup;
- task running or failed: open task execution;
- knowledge base ready: use or maintain;
- multiple knowledge bases: switch without forcing unfinished setup.

It should express the design idea without becoming a marketing site.

### 14.2 Console Information Architecture

Top-level console goals:

- Overview;
- Build Knowledge Base;
- Use Knowledge Base;
- Maintain Knowledge Base;
- Setup.

Second-level functions appear as tabs or local navigation inside the selected
goal. Avoid duplicate entry points unless each one serves a distinct decision.

### 14.3 UI Rules

- Default language: Chinese.
- Default theme: dark.
- Theme and language changes must not cause layout shift.
- Page header height must be stable.
- Menu collapse icons must align to the same vertical center.
- Buttons must have visual hierarchy.
- Dangerous actions require custom confirmation dialogs.
- Toast handles short feedback.
- Result dialogs handle detailed results, risks, and next actions.
- Browser system dialogs are not allowed for product confirmations.
- Internal implementation terms are hidden from ordinary user flows unless the
  page is explicitly technical, such as integration docs.

## 15. Implementation Reset Plan

The next implementation conversation should be based on this plan. Do not patch
around the old JSON-first implementation.

### Phase 1 - Architecture Foundation

Goal: replace file-state sprawl with the Knowledge Asset Layer.

Tasks:

1. Add `workspace.sqlite` and per-KB `catalog.sqlite` creation.
2. Add migrations and schema versioning.
3. Move KB registry, current selection, setup state, task state, and summaries
   out of ad-hoc JSON into SQLite.
4. Keep artifact files on disk and store paths/hashes in SQLite.
5. Remove abandoned JSON state writers once the SQLite path is active.
6. Add tests for multiple knowledge bases, switching, restart recovery, and
   no implicit default knowledge base.

Acceptance:

- A clean environment starts by creating a knowledge base.
- Existing active KB can be migrated once for development convenience.
- Refresh and port changes do not affect current KB state.
- No old default-KB fallback remains.

### Phase 2 - Build Pipeline Restructure

Goal: build source, extraction, structure, chunk, index, and version manifests.

Tasks:

1. Implement source manifest and logical document resolver.
2. Implement extraction manifest with per-page/per-file state.
3. Add parser provider interface.
4. Add OCR provider interface with batch/checkpoint contract.
5. Add page/block classification storage.
6. Add structure nodes and knowledge objects.
7. Add chunk manifest and index manifest.
8. Add publish/activate transaction flow.

Acceptance:

- Every artifact is tied to KB, version, document, page, and task.
- Failed and low-confidence content enters review state.
- Completed batches are skipped on retry.
- No step requires starting from the beginning after crash or refresh.

### Phase 3 - K12 Expert

Goal: make K12 a real domain Expert, not a prompt or label.

Tasks:

1. Add K12 schema and object tables.
2. Add K12 page classifier.
3. Add TOC extractor and unit/lesson page-range builder.
4. Add subject-specific object extractors.
5. Add formula/table/figure/exercise binding records.
6. Add K12 source-scope gate reused by scan, build, index, and query.
7. Add K12 evaluation set.

Acceptance:

- TOC questions use structure Sidecar.
- Unit and lesson questions do not rely only on vector similarity.
- Scope leakage is blocked before retrieval.
- K12 evaluation report is generated after each build.

### Phase 4 - Query Runtime Reset

Goal: one runtime for console and integrations, with routes and quality gates.

Tasks:

1. Implement query understanding and domain/scope extraction.
2. Implement route selection.
3. Implement structure lookup route.
4. Implement hybrid retrieval route.
5. Implement citation validation.
6. Implement no-answer and refusal states.
7. Fix answer serialization contract.
8. Add OpenAPI-ready request/response schema.

Acceptance:

- The same endpoint powers local question test and integration examples.
- `[object Object]` cannot appear.
- Weak answers are not counted as usable.
- Out-of-scope questions refuse without unrelated citations.

### Phase 5 - Maintenance and Evaluation

Goal: let users improve knowledge bases after build.

Tasks:

1. Build document inventory on SQLite pagination/search.
2. Add quality issue queues.
3. Add feedback review and resolution.
4. Add version diff and rollback.
5. Add evaluation dashboard.
6. Add targeted rerun: file, page range, unit, or failed batch.

Acceptance:

- Users can find documents, open source location, exclude/restore, and update.
- Users can see why a question failed.
- Users can rerun only affected material.
- Version history shows what changed and can roll back.

### Phase 6 - Cross-Platform Launcher and Provider Hardening

Goal: make ordinary users able to run KnowMesh on Windows, macOS, and Linux.

Tasks:

1. Finalize Platform Layer.
2. Make launchers Node-independent for ordinary users.
3. Add dependency detection and guided installation actions.
4. Add provider capability discovery.
5. Add provider cost/privacy displays.
6. Add export/import package format.

Acceptance:

- `knowmesh start` works through packaged launchers on all target OSes.
- Missing dependencies produce user-fixable guidance.
- Provider substitutions do not require Core changes.

## 16. Document Discipline

This file is the current design authority.

Rules:

- Do not add a second product blueprint.
- Do not add a second data standard.
- Do not add a second development-principles document.
- Do not add progress notes, phase findings, or temporary plans to long-term
  docs.
- If a new design replaces this one, merge useful content into the replacement
  and delete this file.
- README should link here instead of duplicating the full design.

## 17. Handoff Prompt for the Next Codex Conversation

Use this prompt when starting the implementation conversation:

```text
We are in E:\KnowMesh. Read docs/current-design.md first and treat it as the
single current design authority. The project is not publicly released, so do not
preserve abandoned JSON-first state flows or compatibility shims. Start Phase 1:
Architecture Foundation. Implement workspace.sqlite and per-knowledge-base
catalog.sqlite with migrations, move KB registry/setup/task summaries out of
ad-hoc JSON, preserve the current K12全科知识库 through a one-time migration, and
delete old state paths once replaced. Keep code lean, high-performance, and
cross-platform. Do not patch old flows; refactor boldly according to the design
document. Update README only if the user-facing path changes.
```

## 18. External Practice Baseline

KnowMesh is not inventing knowledge-base quality from scratch. The design should
continue to align with these external practice areas:

- RAG quality should be evaluated by retrieval precision/recall, answer
  relevance, faithfulness, and citation quality. Ragas is the current reference
  family for component-level RAG evaluation.
- Production RAG should use metadata filters, hybrid retrieval, reranking,
  scoped evaluation sets, and continuous quality measurement. This matches AWS
  Bedrock Knowledge Bases and Databricks retrieval-quality guidance.
- Open-source project maturity should follow SemVer, Keep a Changelog, security
  reporting, and supply-chain checks such as OpenSSF Scorecard.
- K12 and other industries need domain structure, not only vector chunks.
  K12-specific implementations should be informed by textbook QA, education
  knowledge graphs, curriculum metadata, and learning-object structures.

Reference URLs:

- `https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/`
- `https://aws.amazon.com/blogs/machine-learning/evaluate-and-improve-performance-of-amazon-bedrock-knowledge-bases/`
- `https://docs.databricks.com/aws/en/ai-search/retrieval-quality`
- `https://semver.org/`
- `https://keepachangelog.com/en/1.1.0/`
- `https://github.com/ossf/scorecard`
- `https://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html`
