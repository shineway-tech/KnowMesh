# KnowMesh Project Map

[中文](project-map.zh-CN.md) | [Documentation](README.en.md) | [Current Design](current-design.md)

This page helps contributors find the right code entry point. It is a navigation document, not an architecture authority. The design authority remains `docs/current-design.md`.

## Understand the Layers First

| Layer | Where To Look | Contribution Entry |
| --- | --- | --- |
| Platform Layer | `launcher/`, `src/cli/` | Launchers, Node gate, cross-platform paths, ordinary-user startup |
| Web Console | `src/web-console/`, `src/local-service/` | Local console, API routes, user workflows, copy, accessibility |
| KnowMesh Core | `src/core/`, `src/local-service/` | Scan, setup, tasks, source scope, version, maintenance |
| Knowledge Asset Layer | `src/local-service/`, SQLite migrations/tests | `workspace.sqlite`, `catalog.sqlite`, documents, pages, structures, chunks, feedback, versions |
| KnowMesh Expert | `src/core/`, K12 tests and examples | K12 structure, domain objects, evaluations, query routing |
| Provider Layer | provider-related modules and examples | Parser, OCR, embedding, rerank, vector store, object store boundaries |

## Where To Start

| Goal | Start Here |
| --- | --- |
| Run the credential-free local demo | `docs/getting-started.en.md`, `examples/local-demo/` |
| Understand the current architecture | `docs/architecture.en.md`, `docs/current-design.md` |
| Change a Web Console page | `src/web-console/`, then the matching `src/local-service/` API |
| Change a local service API | `src/local-service/`, then the matching node test |
| Change knowledge-base state or task recovery | Read Storage / Pipeline in `docs/current-design.md`, then find catalog/workspace tests |
| Change K12 Expert behavior | Start with `examples/textbook-cn-k12/`, then K12 page classifier / query router / evaluation tests |
| Change release package boundaries | `scripts/verify-package-boundary.mjs`, `scripts/verify-release-artifact.mjs` |
| Change launchers | `launcher/`, root `knowmesh.cmd`, root `knowmesh`, `src/launcher/launcher.test.mjs` |
| Change public docs | README, `docs/README.en.md`, `ROADMAP.en.md`, `CONTRIBUTING.md`, and Chinese mirrors |

## Development Route

1. Identify which layer owns the problem.
2. Read related tests and follow existing patterns.
3. If the change affects product direction, data model, or durable UX, compare it against `docs/current-design.md`.
4. If an old JSON/JSONL path has been replaced by SQLite/catalog state, do not add compatibility padding.
5. Before submitting, run tests related to the change; for package, README, launcher, or public docs changes, also run package boundary checks.

## Recommended First Contributions

- Documentation clarity: improve README, Getting Started, Project Map, or Roadmap.
- Test coverage: add a missing test for an existing API or migration path.
- Examples: make `examples/local-demo/` easier for new users to understand.
- Provider research: add provider capability matrix notes without using real credentials.
- K12 Expert docs: explain one structure object or query routing behavior without adding textbook content.

See [Good First Issues](good-first-issues.en.md) for starter task shapes.
