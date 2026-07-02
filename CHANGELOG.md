# Changelog

All notable user-facing changes are recorded here with numeric versions.

## Unreleased

- Added credential-free public samples for general document and synthetic K12
  launch-candidate acceptance checks.
- Added issue templates, a pull request template, and release-candidate evidence
  docs for public repository governance.
- Added `--evidence` support to the release gate script so a release candidate
  can be evaluated from a machine-readable evidence JSON file.
- Added the OpenAPI 3.1 local-service contract for Query Runtime, feedback,
  search, maintenance, package preview, and version endpoints.
- Added platform runtime diagnostics for folder picking and file reveal
  capability across Windows, macOS, and Linux.
- Added a machine-readable release gate checklist that requires local tests,
  release smoke, artifact smoke with checksum, package boundary, diff check,
  CI, CodeQL, and OpenSSF Scorecard before GitHub release publication.
- Added `smoke:browser-sample`, release evidence generation, extension
  certification records, and beta feedback operations docs for Public Beta
  release-note carryover.
- Added `0.2.0 Searchable` release evidence gates for catalog search readiness,
  incremental update proof, vector fallback proof, browser evidence search,
  stale JSON authority audit, and package asset review.
- Added `0.3.0 Query Runtime` release evidence gates for route contract
  readiness, citation-grounded answers, refusal/no-answer behavior,
  feedback-maintenance proof, integration contract proof, and browser ask
  workflow proof.
- Added `0.4.0 Expert SDK` release evidence gates for Expert manifest
  readiness, runtime boundary proof, the operations-handbook non-K12 example,
  Expert evaluation gates, contributor workflow docs, and Expert package asset
  review.
- Added `0.5.0 Provider Adapters` release evidence gates for provider manifest
  readiness, parser/OCR boundary proof, embedding/vector boundary proof,
  provider diagnostics browser proof, no-cloud public path proof, and provider
  package asset review.
- Added `0.6.0 Integration SDK` release evidence gates for endpoint manifest
  readiness, SDK client proof, examples drift proof, integration safety proof,
  provider-aware no-cloud proof, and integration package asset review.
- Added `0.7.0 Consumer Integration Proof` release evidence gates for installed
  SDK consumer proof, live public-sample SDK proof, integration recipes,
  privacy boundary audit, provider-aware no-cloud consumer proof, and consumer
  package asset review.
- Added `0.8.0 Operator Workflow Proof` release evidence gates for source
  intake proof, execution recovery proof, maintenance targeted-rerun proof,
  version rollback proof, operator browser workflow, operator privacy audit
  proof, and operator package asset review.
- Added `0.9.0 First-Run Usability Proof` release evidence gates for first-run
  launch proof, guided setup proof, build recovery proof, first question proof,
  maintenance next-action proof, first-run browser workflow, and first-run
  package asset review.
- Added `1.0.0 Usable Product Proof` release evidence gates for launch
  reliability, local document intake, Web Console workflow, durable data and
  package operations, browser usability, privacy proof, and package asset
  review.
- Added a bilingual publication decision checklist that separates local
  evidence refresh, read-only GitHub/npm checks, human-approved publication
  actions, rollback ownership, and the Block AA post-publication monitoring
  entry.
- Added `smoke:sdk-consumer`, `smoke:live-sdk`, and
  `verify:integration-privacy` to prove downstream apps can use the installed
  SDK and live local service without repository internals.
- Added `smoke:operator-workflow` to prove a non-sample operator KB can move
  through source intake, execution recovery, maintenance review, targeted
  rerun, version rollback, desktop/narrow browser contracts, and privacy audit.
- Added `smoke:first-run-usability` to prove an empty local state can reach a
  created and selected knowledge base, guided setup, recoverable build, first
  question, feedback maintenance next action, and desktop/narrow first-run
  browser contracts.
- Added `smoke:usable-product` to prove the launch, intake, Web Console,
  durable data/package, legacy JSON cleanup, rollback, and zero-external-call
  usable product path.
- Added the ESM SDK entry point with scoped API helpers, injected fetch,
  timeout/request id support, redacted `KnowMeshApiError`, integration
  manifest discovery, and integration diagnostics.
- Added a portable Expert evaluation case contract, Expert dashboard gate
  aggregation, and failure-to-maintenance mapping for Expert evaluation gaps.
- Added the `operations-handbook` public Expert SDK sample with schema,
  template, docs, public fixture, domain objects, route rules, and
  citation-ready Query Runtime evidence.
- Added the Query Runtime route contract, evidence pack response surface,
  citation-ready answer policy, and explicit refusal taxonomy for console and
  integration callers.
- Connected negative query feedback to maintenance review issues with evidence
  targets and targeted rerun scope while keeping useful feedback as a bounded
  positive signal.
- Expanded `smoke:browser-sample` to verify answered, out-of-scope refused, and
  feedback-maintenance Query Runtime paths on desktop and narrow viewports.
- Strengthened catalog evidence search with deterministic ranking signals,
  scoped document-status filters, citation-ready result metadata, and Web
  Console maintenance search links.
- Added incremental source delta summaries, targeted rerun dependency scope, and
  local vector sidecar readiness diagnostics while keeping catalog rows
  authoritative.
- Tightened package-boundary checks to reject private content folders in
  addition to runtime state, credentials, SQLite files, and tests.
- Added CodeQL and OpenSSF Scorecard workflows for public repository security
  and supply-chain visibility.
- Updated public README status notes to reflect enabled security gates and branch
  protection.

## 0.1.0

Initial local-first KnowMesh release line.

Current scope:

- Local Web Console on `127.0.0.1:7457`.
- Multi-knowledge-base isolation.
- Guided setup for Aliyun mode and local mode.
- K12 and general document templates.
- Source scanning, execution preview, task execution, checkpoints, and realtime logs.
- Query Runtime shared by console testing and integration APIs.
- Document maintenance, version records, answer feedback, and diagnostics.
- Aliyun OSS Vector plus OSS Sidecar metadata contract.
- Node.js 24 baseline with Node-independent launchers for Windows, macOS, and
  Linux.
- Release smoke, release-artifact install smoke, package-boundary verification,
  and GitHub Actions CI on ubuntu-latest and windows-latest.

This version is still pre-publication and is being prepared for GitHub open source release.
