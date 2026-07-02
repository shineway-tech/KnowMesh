# Public API Stability

[中文](api-stability.zh-CN.md) | [1.0 Stabilization](stabilization.en.md) | [Query Runtime API](api/query-runtime.en.md)

During 1.0 stabilization, external users should rely on public APIs, not internal SQLite files, artifacts, sidecars, or browser state.

## Stable Contracts

- Query Runtime: request, status, answer, citations, checks, and feedback actions for `POST /kb/:knowledgeBaseId/api/query`.
- OpenAPI: `docs/api/openapi.json` is the machine-readable contract.
- SDK: `createKnowMeshClient`, timeout, request id, error type, and business-state handling.
- Integration endpoints: manifest, diagnostics, search, feedback, package preview, and version manifest.
- Examples: Node, HTTP, and expected responses must stay aligned with OpenAPI.

## Public API Compatibility

Before 1.0, public API compatibility is checked by `npm run smoke:api-reliability`. It aligns SDK exports, the Integration Manifest, the endpoint manifest, OpenAPI paths, Query Runtime response shape, and expected-response shapes.

Compatibility tests block:

- Removing accepted public fields.
- Changing endpoint path, method, contract version, or response kind.
- Letting OpenAPI miss a public path from the endpoint manifest.
- Exposing internal SQLite, artifacts, sidecars, or browser storage through integration APIs.

## Status Matrix

The Query Runtime status matrix is fixed to answered, out_of_scope, insufficient_evidence, no_index, provider_unavailable, and blocked_by_quality, with the API reliability gate also covering the feedback-maintenance path.

Only `answered` may carry displayable answer text and citations. Other no-answer/refusal states must remain explicit, citation-free, and keep user-readable message, checks, feedback, and maintenance information.

## Internal And Unstable

- `workspace.sqlite` and `catalog.sqlite` are internal state authority, not external APIs.
- JSON/JSONL is export, audit, sidecar, report, or evidence data, not runtime truth.
- Integrations must not read artifacts, logs, browser storage, or raw provider payloads.

## Breaking Change Policy

Any breaking change must first include:

1. The affected public API field or endpoint.
2. A migration plan.
3. Updated OpenAPI, SDK, examples, expected responses, and docs.
4. Compatibility tests or an explicit version boundary.
5. Release-note wording; it is never executed by stabilization scripts.

Breaking changes without a migration plan become blocked decisions.
