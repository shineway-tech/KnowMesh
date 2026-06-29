# KnowMesh README Redesign Design

Date: 2026-06-30
Status: approved direction, ready for implementation planning
Authority boundary: `docs/current-design.md` remains the single product design authority. This spec only defines the public README, documentation entry, and README visual strategy.

## Purpose

The current README is accurate but does not yet create a strong first impression. It explains many pieces of KnowMesh, but the opening experience still feels like a list of capabilities rather than a clear open-source product story. The architecture image also fails visually on GitHub because too much text is packed into one fixed SVG, causing overlap and poor legibility when rendered at README width.

The redesign should make a new visitor understand within 30 seconds:

- what KnowMesh is;
- why it is different from a normal RAG demo or vector database UI;
- who should care;
- what is already real today;
- how to try it or follow the project.

## Reference Patterns

The redesign is informed by three reference README patterns:

- `NousResearch/hermes-agent`: strong banner, short product promise, trust badges, compact capability table, quick install, documentation and community links.
- `kevin2li/PDF-Guru`: pain-led story, concrete user benefits, broad audience mapping, visual proof, clear call to action.
- `ZhuLinsen/daily_stock_analysis`: centered first screen, product preview, feature table, multiple quick-start paths, output screenshots, docs index, disclaimer.

KnowMesh should not copy their tone or visuals. It should borrow the information architecture: promise first, proof second, quick start third, deeper docs after that.

## Primary Narrative

Use `Knowledge Asset Compiler` as the README spine.

Primary positioning:

> KnowMesh compiles real document folders into auditable, traceable, maintainable knowledge assets.

Chinese default wording:

> 把真实文档文件夹编译成可审计、可追溯、可维护、可集成的知识资产。

English support wording:

> Compile real document folders into trustworthy knowledge assets for auditable RAG, traceable citations, and maintainable document intelligence.

RAG, SQLite, Query Runtime, quality gates, and K12 are supporting proof points under this spine. K12 must be presented as the first Expert scenario, not as the whole project identity.

## Target Audiences

The README should make four groups feel that KnowMesh is relevant:

1. RAG and AI application builders
   - Pain: answers lack citations, vector chunks become ungoverned data, feedback and evaluation are afterthoughts.
   - Hook: build knowledge assets your application can trust.

2. Knowledge engineering and document intelligence teams
   - Pain: source files change, but pipelines lack versioning, partial reruns, quality queues, and rollback.
   - Hook: treat documents as maintainable assets instead of one-time uploads.

3. Education and K12 teams
   - Pain: textbooks are structured domains, not ordinary PDFs; a useful system must understand units, lessons, vocabulary, formulas, exercises, and page anchors.
   - Hook: K12 is the first strengthened Expert scenario.

4. Open-source infrastructure contributors
   - Pain: many RAG demos are UI-heavy but lack durable local state, provider boundaries, or plugin surfaces.
   - Hook: contribute to a local-first SQLite-based foundation for governed RAG.

## README Structure

### 1. Hero

The first screen should communicate the product in one pass:

- project name: `KnowMesh / 知络`;
- one-line promise based on the `Knowledge Asset Compiler` narrative;
- concise Chinese default paragraph;
- English one-liner for search and international readers;
- badges for CI, CodeQL, Scorecard, license, Node.js, SQLite-first, local-first, alpha;
- a visual that shows source folders becoming knowledge assets, not a decorative AI illustration.

Avoid opening with internal architecture layers. The first screen should answer "what do I get?" before "how is it built?"

### 2. Why It Exists

Use a before/after contrast:

| Ordinary RAG demo | KnowMesh |
| --- | --- |
| Upload files | Compile source folders |
| Chunk and embed | Extract pages, blocks, structure, chunks, citations |
| Vector store as truth | SQLite catalog as truth, vectors as acceleration |
| Weak answers can look successful | Query gates require evidence and citations |
| Rebuild from scratch | Checkpoint, rerun, version, rollback |

This section should be compact and concrete. It should not become a philosophical essay.

### 3. How It Works

Replace the current `architecture.svg` with a legible five-stage README diagram:

```text
Source Folder -> Catalog -> Quality Gates -> Versioned Asset -> Query Runtime
```

Each stage gets only a few words:

- Source Folder: PDF, Office, WPS, images, scans.
- Catalog: workspace.sqlite, catalog.sqlite, artifacts.
- Quality Gates: review queues, evaluation, citation checks.
- Versioned Asset: releases, rollback, sidecars.
- Query Runtime: cited answers, feedback, integration APIs.

This diagram is the main README workflow visual. It must have enough spacing to remain legible when GitHub scales it.

### 4. What Is Real Today

Keep the alpha honesty, but pair it with credible proof:

- SQLite-first workspace and per-KB catalog;
- multiple knowledge bases and scoped routes;
- task checkpoints, logs, pause, retry, and recovery;
- Query Runtime shared by console and integration paths;
- document maintenance, feedback review, version records, diagnostics;
- CI on Ubuntu and Windows with Node 24;
- CodeQL, OpenSSF Scorecard, secret scanning, push protection, and private vulnerability reporting;
- draft release smoke and package-boundary checks.

Do not overclaim production maturity. Say it is alpha and still moving toward a stable commercial-quality baseline.

### 5. K12 Expert First Scenario

Show K12 after the general story. It proves the Expert model:

- textbooks are not generic PDFs;
- TOC, units, lessons, vocabulary, formulas, exercises, page anchors are structured objects;
- out-of-scope subjects and unowned books are refused before retrieval;
- no copyrighted textbook content is bundled.

This section should attract education users while preserving the larger platform identity.

### 6. Quick Start

Keep startup direct:

- ordinary user launchers first;
- maintainer/dev commands second;
- clearly state no cloud calls happen during local smoke/demo checks;
- link to Getting Started for details.

### 7. Docs and Contribution Paths

Make the bottom of README a navigation surface:

- Getting Started;
- Architecture Overview;
- Current Design;
- Operations Runbook;
- Changelog;
- Contributing;
- Security Policy;
- issue/discussion paths.

## Visual Asset Strategy

### Replace `assets/readme/architecture.svg`

The current architecture SVG should not be patched in place with smaller fonts. It should be replaced with a simpler workflow diagram optimized for README rendering.

Requirements:

- no overlapping text at 100%, 75%, or mobile-width README scaling;
- no long labels inside small cards;
- no dense multi-layer container with many arrows;
- use short node names and supporting captions;
- prefer one conceptual path over multiple simultaneous layer diagrams;
- keep bilingual text minimal in the image. Let the README text carry bilingual explanation.

### Add or revise visual assets

Recommended assets:

- `assets/readme/hero.svg`: first impression, source folder to knowledge asset, non-decorative.
- `assets/readme/architecture.svg`: simplified five-stage workflow diagram.
- `assets/readme/storage-truth.svg`: optional docs-level diagram for workspace.sqlite, catalog.sqlite, artifacts, sidecars.
- `assets/readme/k12-expert.svg`: scenario proof for K12 Expert.
- `assets/social/knowmesh-social-preview.png`: should match the new hero narrative.

The README should not rely on fake product screenshots unless the screenshot reflects real working UI.

## Documentation Changes

The README should become a high-quality public entry page, not a duplicate of `current-design.md`.

Keep:

- `docs/current-design.md` as the only product design authority;
- `docs/README.md` and `docs/README.en.md` as documentation indexes;
- getting-started docs for practical local usage;
- architecture docs for deeper storage and runtime explanation.

Adjust if needed:

- architecture docs can host the deeper storage diagram;
- operations runbook can stay operational and release-gate focused;
- English README must be complete enough for search and international readers, not a partial translation.

## Non-Goals

- Do not rewrite product architecture in README.
- Do not introduce a second product blueprint.
- Do not claim stable production readiness.
- Do not make K12 the primary product identity.
- Do not add large copyrighted sample content.
- Do not include visual assets that look impressive but fail to explain the product.

## Acceptance Criteria

The implementation is successful when:

- a first-time visitor can explain KnowMesh in one sentence after the first screen;
- the README makes the four target audiences visible without feeling scattered;
- the main diagram has no text overlap on GitHub desktop and mobile widths;
- K12 is clearly positioned as the first Expert scenario;
- quick start remains practical and launcher-first;
- alpha status is honest but paired with proof of engineering seriousness;
- README, README.en, docs index, and visual assets point to one coherent story;
- local checks and GitHub Actions still pass after the documentation and asset changes.

## Implementation Planning Notes

The next implementation plan should split work into small reviewable steps:

1. Rewrite README and README.en around the approved narrative.
2. Replace the broken architecture SVG with the simplified five-stage workflow.
3. Decide whether to regenerate hero and social preview to match the new narrative.
4. Update docs index and architecture docs only where navigation or diagrams change.
5. Run markdown/link/asset checks, launcher README test, package-boundary checks, smoke checks, and GitHub CI.

Do not start implementation until this spec is reviewed and approved.
