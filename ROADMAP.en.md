# KnowMesh Roadmap

[中文](ROADMAP.md) | [README](README.en.md) | [Current Design](docs/current-design.md) | [K12 Expert](docs/experts/k12.en.md)

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
| `0.1.x` Adoption Loop | Let new users try KnowMesh without credentials and let contributors find safe entry points | Public sample wizard, sample reset, community backlog, issue templates, release operations |
| `0.1.x` Public Beta Hardening | Make public samples and contribution entry points repeatably verifiable | browserSampleFlow, Integration Examples contract, Expert/Provider lifecycle, releaseAssetReview, betaReleaseNotes |
| `0.1.x` Beta Operations Automation | Make beta feedback and release evidence operable | smoke:browser-sample, generate:release-evidence, known-gap, triage, release-note carryover |
| `0.2.0` Searchable | Make knowledge assets reliably searchable | Stable catalog ranking, evidence-search UI, incremental source deltas, targeted rerun, vector sidecar fallback, Searchable release evidence |
| `0.3.0` Query Runtime | Make real questions return evidence-backed answers | Route contract, evidence pack, cited answer gates, refusal/no-answer, feedback-maintenance, OpenAPI/examples drift, Query Runtime release evidence |
| `0.4.0` Expert SDK / Extension Foundation | Make domain scenarios extensible | Expert manifests, runtime hooks, operations-handbook non-K12 example, evaluation format, maintenance mapping, authoring guide, Expert SDK release evidence |
| `0.5.0` Provider Adapters | Make parsing/OCR/embedding replaceable | Provider manifests, parser/OCR boundary, embedding/vector validation, provider diagnostics browser proof, no-cloud public path, Provider Adapters release evidence |
| `0.6.0` Integration SDK | Let application developers integrate reliably | Endpoint manifest, ESM SDK, plain HTTP examples, integration diagnostics, retry/redaction, Integration SDK release evidence |
| `0.7.0` Consumer Integration Proof | Prove downstream apps can integrate from the installed package and a live local service | Installed SDK consumer smoke, live public-sample SDK smoke, bilingual integration guides, privacy boundary audit, Consumer Integration release evidence |
| `0.8.0` Operator Workflow Proof | Prove maintainers can complete the knowledge-asset lifecycle through supported surfaces | Source intake, execution recovery, maintenance review, targeted rerun, version rollback, operator browser proof, Operator Workflow release evidence |
| `0.9.0` First-Run Usability Proof | Prove non-maintainers can reliably reach the first maintainable knowledge base from empty local state | Empty launch, create/select, guided setup, build recovery, first question, maintenance next action, First-Run Usability release evidence |
| `1.0.0` Usable Product Proof | Let non-maintainers reliably build, use, maintain, package, and recover knowledge bases | usable-product smoke, launch reliability, document intake, Web Console workflow, durable data/package, browser/privacy/package evidence |

## Focus Areas

### Query Runtime Usability

- The same Query Runtime must serve console QA and external integrations.
- Answers must cite source documents, pages, or structure anchors.
- Out-of-scope, unsupported, and low-confidence answers must be refused or explained instead of being counted as success.
- `0.3.0 Query Runtime` requires release evidence for route contract, citation-grounded answers, refusal/no-answer, feedback-maintenance, integration contract, and browser ask workflow.

### Knowledge Asset Layer

- Documents, pages, blocks, structures, chunks, citations, evaluations, feedback, and versions use the catalog as truth.
- JSON/JSONL remain export, audit, and sidecar formats, not primary runtime state.
- Published versions need diff, rollback, and diagnostics.
- `0.2.0 Searchable` requires release evidence for catalog search, Query Runtime evidence, browser maintenance search, incremental updates, vector fallback, and stale JSON authority audit.

### Expert Scenarios

- Core stays domain-neutral.
- [K12](docs/experts/k12.en.md) remains the first enhanced scenario, covering TOC, units, lessons, vocabulary, formulas, exercises, experiments, and page citations.
- Future Experts must declare domain objects, quality gates, evaluation sets, and query-router rules, and must connect through public Expert runtime hooks.
- `operations-handbook` is the first non-K12 public Expert SDK sample, using a public fixture to prove that policies, procedures, review cadence, rollback rules, and evidence requirements can share the same Query Runtime.
- `0.4.0 Expert SDK` requires release evidence for manifest readiness, runtime boundary proof, the non-K12 example, Expert evaluation gates, contributor workflow, and package asset review.
- Expert and Provider lifecycle stages use `official` -> `certified` -> `community` -> `experimental`; the public roadmap only promises behavior accepted at the matching stage.

### Provider Adapters

- Parser, OCR, embedding, rerank, vector, object-store, and export providers must declare manifests, permissions, privacy, cost, dry-run, batch, retry, and checkpoint policies before joining runtime flows.
- Provider diagnostics must render through scoped Web Console APIs, with state authority in `workspace.sqlite` and each knowledge base's `catalog.sqlite`; browser storage is limited to visual preferences.
- The public sample path must remain no-cloud and credential-free; before explicit configuration and confirmation, external calls before execution must stay `0`.
- `0.5.0 Provider Adapters` requires release evidence for `providerManifestReadiness`, `parserOcrBoundaryProof`, `embeddingVectorBoundaryProof`, `providerDiagnosticsBrowserProof`, `noCloudPublicPathProof`, and `providerPackageAssetReview`.

### Integration SDK

- Integrations discover endpoints, retry semantics, localhost/CORS boundaries, and selected knowledge-base readiness through `/api/integration/manifest` and `/api/integration/diagnostics`.
- `src/sdk/knowmesh-client.mjs` is a no-build, lightweight ESM SDK with scoped route helpers, injected fetch, timeout, request id, error redaction, and provider-aware diagnostics.
- Node.js examples, plain HTTP examples, and expected response fixtures must stay drift-tested against OpenAPI, the endpoint manifest, and the SDK endpoint map.
- `0.6.0 Integration SDK` requires release evidence for `endpointManifestReadiness`, `sdkClientProof`, `examplesDriftProof`, `integrationSafetyProof`, `providerAwareNoCloudProof`, and `integrationPackageAssetReview`.
- `0.7.0 Consumer Integration Proof` requires release evidence for the installed SDK consumer, live public-sample SDK HTTP flow, integration guides, privacy boundary audit, consumer no-cloud proof, and package asset review.

### Operator Workflow

- Operators must complete source intake, execution recovery, maintenance review, targeted rerun, version diff, and rollback through the Web Console and scoped APIs.
- `workspace.sqlite` and each knowledge base's `catalog.sqlite` remain state authority; browser storage and JSON/JSONL must not store selected KB, setup draft, job summary, or release decisions.
- Diagnostic exports must be redacted and must not expose credentials, private documents, local paths, raw provider payloads, or internal artifact paths.
- `0.8.0 Operator Workflow Proof` requires release evidence for `sourceIntakeProof`, `executionRecoveryProof`, `maintenanceTargetedRerunProof`, `versionRollbackProof`, `operatorBrowserWorkflow`, `operatorPrivacyAuditProof`, and `operatorPackageAssetReview`.

### First-Run Usability

- The first-run path must start from empty local state, create no implicit knowledge base, and let users create/select knowledge bases through the Web Console.
- Guided setup must persist to SQLite and recover after service restart; the general-docs path must not inherit K12 required fields.
- The first build must show progress, pause/resume, restart recovery, completion, and redacted diagnostics.
- The first question must use Query Runtime and return a cited answer or explicit no-answer/refusal; weak answers must not appear as success.
- `0.9.0 First-Run Usability Proof` requires release evidence for `firstRunLaunchProof`, `guidedSetupProof`, `buildRecoveryProof`, `firstQuestionProof`, `maintenanceNextActionProof`, `firstRunBrowserWorkflow`, and `firstRunPackageAssetReview`.

### Usable Product Proof

- `1.0.0 Usable Product Proof` builds on First-Run and proves launch reliability, document intake quality, Web Console workflow, durable data/package operations, browser usability, privacy boundaries, and package asset boundaries together.
- `smoke:usable-product` must prove `usableLaunchReliabilityProof`, `usableDocumentIntakeProof`, `usableWebConsoleWorkflowProof`, and `usableDurableDataPackageProof`, while keeping external calls before execution at `0`.
- `1.0.0-usable-product` release evidence also requires `usableBrowserWorkflow`, `usablePrivacyProof`, and `usableProductPackageAssetReview`, blocking local paths, credentials, private content, SQLite/WAL files, generated artifacts, and stale JSON authority paths from release materials.

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
