# KnowMesh Roadmap

[中文](ROADMAP.md) | [README](README.en.md) | [Current Design](docs/current-design.md)

KnowMesh moves toward one goal: compiling source materials into trustworthy, inspectable, maintainable, and integrable knowledge assets. This page is the public roadmap entry, not a second design authority. Product, architecture, and data constraints live in [docs/current-design.md](docs/current-design.md).

## Current Stage

KnowMesh is in `0.1.0-alpha`. The foundation has moved from JSON-first state to SQLite-first state:

- `workspace.sqlite` stores global workspace state, knowledge-base registry, current selection, and setup/task summaries.
- Each knowledge base owns one `catalog.sqlite` for documents, pages, structures, chunks, tasks, quality state, feedback, versions, and releases.
- Web Console, Query Runtime, job recovery, document maintenance, and version records now converge on per-KB catalogs.
- K12 is the first major Expert scenario, proving that domain structure matters more than generic PDF QA.

## Near-Term Roadmap

| Phase | Goal | Main Work |
| --- | --- | --- |
| `0.1.x` Alpha Foundation | Make the public repository credible, runnable, and contributor-ready | Docs entry points, release draft, CI/CodeQL/Scorecard, security settings, Good First Issues, contribution flow |
| `0.2.0` Searchable | Make knowledge assets reliably searchable | Local full-text search, structure search, vector sidecar contract, source scope, index diagnostics |
| `0.3.0` Query Runtime | Make real questions return evidence-backed answers | Cited answer contract, refusal, feedback entry, integration API, evaluation samples |
| `0.4.0` Expert SDK | Make domain scenarios extensible | Expert plugin boundaries, K12 processor docs, evaluation set format, authoring guide |
| `0.5.0` Provider Adapters | Make parsing/OCR/embedding replaceable | Local parser/OCR adapters, stronger Aliyun mode, provider capability matrix |
| `1.0.0` Usable | Let non-maintainers reliably build and use knowledge bases | Stable Web Console, migration discipline, error recovery, version publishing, query API docs |

## Focus Areas

### Query Runtime Usability

- The same Query Runtime must serve console QA and external integrations.
- Answers must cite source documents, pages, or structure anchors.
- Out-of-scope, unsupported, and low-confidence answers must be refused or explained instead of being counted as success.

### Knowledge Asset Layer

- Documents, pages, blocks, structures, chunks, citations, evaluations, feedback, and versions use the catalog as truth.
- JSON/JSONL remain export, audit, and sidecar formats, not primary runtime state.
- Published versions need diff, rollback, and diagnostics.

### Expert Scenarios

- Core stays domain-neutral.
- K12 remains the first enhanced scenario, covering TOC, units, lessons, vocabulary, formulas, exercises, experiments, and page citations.
- Future Experts must declare domain objects, quality gates, evaluation sets, and query-router rules.

### Contributor Experience

- First contributions should be possible through docs, tests, examples, provider adapters, or small K12 Expert tasks.
- Every starter task should include scope, acceptance commands, and safety notes.
- README, docs, issue templates, release notes, and roadmap should stay aligned.

## Non-Goals

- Do not turn KnowMesh into a generic vector database UI.
- Do not make the CLI the primary ordinary-user entry.
- Do not bundle textbooks or private document content.
- Do not preserve replaced JSON-first flows to support abandoned local drafts.
- Do not pretend weak answers are successful.

## How To Join

- New contributors should start with [Good First Issues](docs/good-first-issues.en.md).
- To understand the codebase, read the [Project Map](docs/project-map.en.md).
- Before opening a PR, read [CONTRIBUTING.md](CONTRIBUTING.md).
- For directional discussions, compare proposals against [Current Design](docs/current-design.md) to avoid creating a second product blueprint.
