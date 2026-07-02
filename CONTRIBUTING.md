# Contributing to KnowMesh

KnowMesh is a local-first Knowledge Asset Compiler for auditable RAG, traceable citations, and maintainable document intelligence.

This project is still alpha, but the architecture direction is intentional. Contributions are welcome when they make knowledge assets more reliable, traceable, maintainable, or easier to integrate.

## Start Here

- Product and architecture authority: [docs/current-design.md](docs/current-design.md)
- Roadmap: [ROADMAP.md](ROADMAP.md) / [ROADMAP.en.md](ROADMAP.en.md)
- Code navigation: [docs/project-map.zh-CN.md](docs/project-map.zh-CN.md) / [docs/project-map.en.md](docs/project-map.en.md)
- Starter tasks: [docs/good-first-issues.zh-CN.md](docs/good-first-issues.zh-CN.md) / [docs/good-first-issues.en.md](docs/good-first-issues.en.md)
- Security reporting: [SECURITY.md](SECURITY.md)

`docs/current-design.md` is the single current design authority. Do not create a second product blueprint, data standard, or long-term design document.

## Good Contribution Shapes

- Documentation clarity: README, Getting Started, Roadmap, Project Map, examples, or translation fixes.
- Local-only examples: improve `examples/local-demo/` without credentials, uploads, OCR, embeddings, or vector writes.
- Focused tests: add coverage for existing behavior without changing product direction.
- Web Console clarity: empty states, labels, copy, or accessibility improvements that match current UX rules.
- Provider research: capability notes or adapter boundaries without real secrets.
- Expert docs: K12 structure, evaluation, or query routing explanations without textbook content.

Avoid broad rewrites unless the issue or design authority explicitly calls for them.

## Development Setup

Requirements:

- Node.js 24 or newer.
- Windows, macOS, or Linux.
- Optional local tools such as Ghostscript or LibreOffice only when a task explicitly needs them.

Install and run local checks:

```bash
npm install
npm run doctor
npm run demo:plan
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
```

The default local demo checks do not upload files, call OCR, call embedding, or write vector indexes.

## Development Discipline

- Start from a knowledge base, not global loose state.
- Keep `workspace.sqlite` and per-KB `catalog.sqlite` as the mutable runtime truth.
- Keep JSON/JSONL as export, audit, sidecar, or report formats, not primary state.
- Delete replaced code, stale docs, dead examples, and abandoned configuration.
- Do not keep compatibility shims for old JSON-first flows unless `docs/current-design.md` explicitly says so.
- Keep Core domain-neutral; K12 and future industries belong in Expert boundaries.
- Preserve explicit execution gates before uploads, deletes, OCR calls, embedding calls, or vector writes.

## Extension Lifecycle

Expert and Provider contributions must declare one lifecycle stage:

| Stage | Meaning |
| --- | --- |
| `official` | Maintained with Core and covered by release gates. |
| `certified` | Community or partner extension reviewed against docs, tests, security, and runtime boundaries. |
| `community` | Useful extension maintained outside Core, with clear owner and limitations. |
| `experimental` | Exploration only; not a stable API or release promise. |

The order is intentionally `official` -> `certified` -> `community` -> `experimental`. New extensions usually start as `experimental` unless maintainers explicitly accept a stronger stage. Extensions must not read or mutate internal SQLite paths directly; use public Core, Expert, Provider, and Query Runtime interfaces.

## Expert SDK Proposals

To propose a community Expert, open an issue or discussion with:

- the intended domain and why it belongs outside Core;
- a public fixture or synthetic sample that can be committed safely;
- the manifest fields, source-scope rules, query route rules, quality gates, and evaluation cases;
- the expected lifecycle stage, usually `experimental` first;
- the required tests, including `expert-runtime.test.mjs`, `expert-evaluation.test.mjs`, and a domain-specific sample test.

The `operations-handbook` Expert is the reference public fixture for non-K12 Expert SDK work. A proposal must not require private datasets, direct SQLite writes, credentials, or local absolute paths.

## Safety Rules

Never commit:

- `.env` files or secrets;
- SQLite databases or WAL/SHM files;
- workspace, knowledge-base, artifact, log, output, or test-result directories;
- source document text, textbook content, OCR outputs, model outputs, or private local paths.

Public issues and PRs should not include vulnerability details, credentials, private documents, generated artifacts, logs with local paths, or screenshots containing sensitive data.

## Data Model Expectations

- Every logical document needs a stable `document_id`.
- Every content version needs a distinct `version_id`.
- New versions should be proposed first, validated, published, then activated.
- OCR failures must be recorded rather than silently dropped.
- Query answers must cite source documents, pages, or structure anchors when they claim support.

## Pull Request Checklist

Before opening a PR:

- Link the issue or explain the user-facing problem.
- State which layer is affected: Platform, Web Console, Core, Knowledge Asset Layer, Expert, or Provider.
- Explain whether `workspace.sqlite`, `catalog.sqlite`, credentials, local files, cloud operations, or generated artifacts are affected.
- For Expert or Provider changes, declare lifecycle stage and prove the extension avoids internal SQLite dependencies and unsafe permissions.
- Keep Chinese and English docs in sync when changing public docs.
- Run the narrowest relevant test first, then broader checks when shared behavior or release assets are touched.

Recommended verification:

```bash
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
```

For docs-only changes, at minimum run:

```bash
git diff --check
npm run verify:package-boundary
```

## Issue Labels

Useful labels include:

- `good first issue`
- `help wanted`
- `area:docs`
- `area:examples`
- `area:tests`
- `area:web-console`
- `area:provider`
- `area:expert-k12`
- `area:platform`

Starter issues should include context, scope, non-scope, acceptance checks, and safety notes.
