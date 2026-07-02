# KnowMesh Good First Issues

[中文](good-first-issues.zh-CN.md) | [Project Map](project-map.en.md) | [Contributing](../CONTRIBUTING.md)

KnowMesh starter tasks should be small, clear, verifiable, and safe. They should not require private documents, cloud credentials, or real textbook content.

## Good First Issue Types

| Type | Good For | Acceptance |
| --- | --- | --- |
| `area:docs` | Clarifying README, Getting Started, Roadmap, Project Map | Valid links, bilingual sync, `git diff --check` |
| `area:examples` | Improving `examples/local-demo/` wording, names, expected output | `npm run doctor`, `npm run demo:plan` |
| `area:tests` | Adding tests for existing APIs, migrations, task recovery, launchers | Related `node --test ...` or `npm test` |
| `area:web-console` | Copy, empty states, labels, credential-free demo clarity | Local page remains understandable, API behavior unchanged |
| `area:provider` | Provider capability notes, error wording, credential-free matrix | No real secrets, no cloud calls |
| `area:expert` | Expert manifests, schemas, authoring docs, and small synthetic fixtures | No Core domain creep; manifest tests first |
| `area:integration` | HTTP examples, OpenAPI docs, Query Runtime SDK examples | API-first, no internal SQLite reads |
| `sample request` | Request a new public sample or synthetic scenario | No private data; explain public boundary |
| `area:expert-k12` | K12 structure notes, evaluation sample format, query router docs | No textbook text, no domain logic pushed into Core |

## Starter Issue Template

A good starter issue should include:

- Context: why the task helps knowledge assets become more reliable, traceable, maintainable, or integrable.
- Scope: the files or behavior to change, without turning it into a broad refactor.
- Non-scope: no cloud integration, no real textbooks, no design authority rewrite.
- Acceptance: commands such as `npm run verify:package-boundary` or a specific `node --test`.
- Safety: do not commit `.env`, SQLite, workspace state, private documents, logs, or local paths.

## First Contributor Path

- docs-only: update README, docs, examples, or public sample guidance, keep Chinese and English in sync, then verify with `git diff --check` and the matching docs tests.
- code-path: use only public APIs, public samples, and focused tests; do not read internal SQLite or introduce JSON-first runtime state.
- public API: integrations and examples should use Query Runtime, integration endpoints, or the SDK instead of treating `workspace.sqlite` or `catalog.sqlite` as external APIs.

## First Suggested Tasks

Maintainers can copy these into GitHub issues.

### 1. Improve local demo explanation

Labels: `good first issue`, `area:examples`, `documentation`

Scope:

- Review `examples/local-demo/` and `docs/getting-started.en.md`.
- Clarify what `npm run doctor` and `npm run demo:plan` do and do not do.
- Keep the no-upload/no-OCR/no-embedding guarantee explicit.

Acceptance:

- `npm run doctor`
- `npm run demo:plan`
- `git diff --check`

### 2. Add a provider capability matrix doc section

Labels: `good first issue`, `area:provider`, `documentation`

Scope:

- Add a small provider matrix to architecture docs or a new docs section.
- Explain parser, OCR, embedding, rerank, vector store, and object store at a capability level.
- Do not add real credentials or provider-specific secret examples.

Acceptance:

- `git diff --check`
- Docs home links are valid.

### 3. Document one K12 Expert object

Labels: `good first issue`, `area:expert-k12`, `documentation`

Scope:

- Pick one object type such as TOC entry, lesson, vocabulary, formula, exercise, or experiment.
- Explain what it means, what source anchor it should keep, and how citations should reference it.
- Do not include textbook content.

Acceptance:

- `git diff --check`
- The doc states that K12 is an Expert scenario, not Core.

### 4. Add a focused test for a documented behavior

Labels: `good first issue`, `area:tests`

Scope:

- Pick one existing behavior already described in docs or tests.
- Add a narrow regression test without changing product behavior.
- Prefer local-only paths that do not require cloud credentials.

Acceptance:

- The targeted `node --test ...` command passes.
- `npm test` passes if the change touches shared behavior.

### 5. Add an integration example note

Labels: `good first issue`, `area:integration`, `help wanted`

Scope:

- Improve `examples/integrations/` wording or expected responses.
- Keep examples API-first.
- Do not read internal SQLite or introduce private data.

Acceptance:

- `npm test -- scripts/integration-examples.test.mjs`
- `git diff --check`

## Not Good First Issues

- Redesigning SQLite schema or migration strategy.
- Changing Query Runtime success/failure semantics.
- Integrating real cloud providers, real credentials, or real textbooks.
- Changing the long-term direction in `docs/current-design.md`.
- Preserving replaced JSON-first runtime paths.
