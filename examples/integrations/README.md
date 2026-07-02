# KnowMesh Integration Examples

These examples show how an application should call KnowMesh through the local HTTP API or the lightweight ESM SDK. Do not read internal SQLite files; the public API is the integration boundary. For app-level recipes across server-side Node, Electron/local desktop, browser-through-backend, and CI smoke usage, read [KnowMesh Integration Guide](../../docs/integrations.en.md) or [应用集成指南](../../docs/integrations.zh-CN.md).

Current `contractVersion`: `2026-07-query-runtime.1`. Keep `docs/api/openapi.json`, `docs/api/endpoint-manifest.json`, the Node client, HTTP examples, and expected responses in sync.

## Startup Assumptions

- KnowMesh is running on `http://127.0.0.1:7457` unless the user picked another local port.
- Apps should use a scoped `knowledgeBaseId`; the public sample id is `sample-general-docs`.
- For credential-free local testing, create the public sample through `POST /api/public-samples/create` with `{ "sampleId": "general-docs" }`.
- Use `/api/integration/manifest` at startup to discover endpoint support, retry policy, and privacy notes.
- Use `/api/integration/diagnostics` before scoped calls when an app needs readiness, retry semantics, and localhost/CORS guidance.
- Treat Query Runtime states as product states. Do not retry `out_of_scope` or `insufficient_evidence`; show the user the scoped result and maintenance action.

## Endpoint Map

- `GET /api/integration/manifest` - service-level integration discovery.
- `GET /kb/:knowledgeBaseId/api/integration/manifest` - scoped integration discovery.
- `GET /api/integration/diagnostics` - service-level readiness, retry, and localhost/CORS guidance.
- `GET /kb/:knowledgeBaseId/api/integration/diagnostics` - scoped readiness for Query Runtime and providers.
- `POST /kb/:knowledgeBaseId/api/query` - Query Runtime answer with citations and feedback actions.
- `GET /kb/:knowledgeBaseId/api/search` - catalog evidence search.
- `POST /kb/:knowledgeBaseId/api/query/feedback` - scoped feedback.
- `GET /kb/:knowledgeBaseId/api/query/feedback/summary` - feedback totals and maintenance review signals.
- `GET /kb/:knowledgeBaseId/api/providers/diagnostics` - redacted provider readiness and recovery actions.
- `GET /kb/:knowledgeBaseId/api/package/export/preview` - redacted package export preview.
- `POST /kb/:knowledgeBaseId/api/package/import/preview` - package import preview.
- `GET /kb/:knowledgeBaseId/api/maintenance/status` - provider, runtime, quality, and diagnostics status.
- `GET /kb/:knowledgeBaseId/api/version/manifest` - active version manifest.

## Files

- `node/query-runtime-client.mjs`: small dependency-free Node.js client.
- `http/query-runtime.http`: plain HTTP examples for REST clients.
- `expected-responses/`: safe response shapes for tests and docs. They include counts, ids, citations, checks, and paths, but no private material.

Use `docs/api/openapi.json` as the machine-readable contract.
Use `/api/integration/manifest` at runtime when an app needs the current endpoint map, retry policy, and privacy notes.
Use the package entry point for SDK-based integrations:

```js
import { createKnowMeshClient } from "knowmesh";

const client = createKnowMeshClient({
  baseUrl: "http://127.0.0.1:7457",
  knowledgeBaseId: "sample-general-docs",
  requestId: true
});

const result = await client.query("What review cadence is required?");
if (result.status === "answered") {
  await client.feedback({ action: "useful", resultKey: result.resultKey });
}
```

## Query Runtime Contract

- `answerPolicy`: `citation_ready_evidence_only`.
- `query.evidencePack`: stable evidence pack for route, chunk, citation, quality, ranking, and source-anchor metadata.
- `status`: handle `answered`, `out_of_scope`, `insufficient_evidence`, `provider_unavailable`, and `blocked_by_quality` as product states.
- `feedback`: use `wrong_citation` and `missed_point` to create maintainable review items; do not read internal SQLite.

## Error Handling

The Node example exposes `KnowMeshApiError` for non-2xx responses, Query Runtime errors, provider unavailable states, and timeout/network failures. Retry only timeout, HTTP 408/429/5xx, and `provider_unavailable` cases. Validation errors, out-of-scope responses, and no-answer responses should be shown to users as product states, not retried blindly.

When a feedback or no-answer path needs follow-up, link users back to the scoped maintenance page or feedback summary rather than reading package internals.
