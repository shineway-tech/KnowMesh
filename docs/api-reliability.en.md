# 1.0 API Reliability

[中文](api-reliability.zh-CN.md) | [Public API Stability](api-stability.en.md) | [Release Operations](release-operations.en.md)

Block X turns the stabilization decision into a narrow 1.0 API reliability gate. It does not add new product surface; it protects the public API shapes, Query Runtime statuses, package/install path, and privacy/security evidence that external users will depend on.

Release tags, npm publication, repository visibility changes, and announcements remain `human-review-required`; scripts never perform those side effects.

## Compatibility Harness

`scripts/api-reliability-evidence.mjs` checks public API compatibility across:

- Query Runtime response shape: `ok`, `status`, `answer`, `citations`, `checks`, `feedback`, and `maintenance`.
- Integration Manifest: manifest, diagnostics, search, feedback, package preview, and version manifest.
- Provider Diagnostics: redacted readiness, capabilities, retry, and cost/privacy summaries only.
- Package Preview: manifest summary, hash, reset safety, and privacy excludes only.
- Version Manifest: version summary, active build, rollback candidates, and manifest path only.
- OpenAPI: `docs/api/openapi.json` must cover every public path in the endpoint manifest.
- SDK: `createKnowMeshClient`, endpoint helpers, timeout, request id, retryable errors, and business-state handling must stay aligned with the manifest.

Field removal, status drift, endpoint path drift, missing OpenAPI entries, or direct internal-state exposure fails the API reliability gate.

## Query Runtime Status Matrix

The status matrix covers:

- `answered`: must include citations; only this state may display `answer.text`.
- `out_of_scope`: explicit refusal with no citations.
- `insufficient_evidence`: explicit no-answer state with no citations.
- `provider_unavailable`: retryable semantics with no citations.
- `blocked_by_quality`: quality gates block weak answers instead of pretending success.
- `feedback_maintenance`: feedback enters maintenance without bypassing the Query Runtime contract.

The status matrix also checks citation support, display serialization guards, explicit no-answer/refusal states, and citation-free fallbacks.

## Package And Installer Reliability

The API reliability gate reuses the release candidate fresh-clone rehearsal:

- packed install
- launcher-first start
- public sample creation
- query / refusal / feedback
- package preview / reset
- external temp cleanup
- package assets included
- private state excluded
- Windows / macOS / Linux launcher contracts documented

Package boundaries are still protected by `verify:package-boundary` and release artifact smoke. SQLite/WAL files, private state, generated artifacts, tests, local paths, and credentials must not enter the public package.

## Privacy And Security Regression

The privacy regression covers docs, examples, SDK, diagnostics, release evidence, public samples, package preview, and provider outputs.

Regression checks include:

- local absolute paths redacted
- credentials redacted
- private content excluded
- raw provider payloads excluded
- browser storage is visual-preferences-only
- no direct SQLite reads through public integrations

## Reconciliation

The 1.0 API reliability packet generates go/no-go evidence only. It never performs publication side effects. The packet must include:

- accepted gaps
- known limitations
- migration notes
- deferred work
- fresh local gates
- human-review-required decision

The next default block is `1.0-community-release-readiness`, focused on contributor paths, issue triage, release notes, and long-term adoption loops before a human publication decision.
