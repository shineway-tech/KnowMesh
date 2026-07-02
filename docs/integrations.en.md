# KnowMesh Integration Guide

[中文](integrations.zh-CN.md) | [Documentation](README.en.md) | [Integration Examples](../examples/integrations/README.md) | [OpenAPI](api/openapi.json)

KnowMesh integrations use the local HTTP API and the package SDK. Downstream applications should not read `workspace.sqlite`, per-knowledge-base `catalog.sqlite`, artifacts, sidecar files, or browser storage directly; those are KnowMesh internal state and maintainer diagnostics surfaces.

## Start with the Public Sample

The local service binds to `127.0.0.1:7457` by default. If the user chooses another port, your app should let them set `baseUrl` or receive it from your launcher.

```bash
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:browser-sample
```

For credential-free testing, create the public sample first:

```http
POST http://127.0.0.1:7457/api/public-samples/create
content-type: application/json

{ "sampleId": "general-docs" }
```

The sample knowledge-base id is `sample-general-docs`. It performs no upload, no OCR call, no embedding call, no vector write, and no cloud resource creation.

## Integration Boundary

- SDK entry: `import { createKnowMeshClient } from "knowmesh"` or `knowmesh/sdk`.
- Runtime discovery: `GET /api/integration/manifest` and `GET /api/integration/diagnostics`.
- Scoped calls: use `/kb/:knowledgeBaseId/...`; do not depend on the Web Console's selected knowledge base.
- Machine contract: [OpenAPI](api/openapi.json) and [Endpoint Manifest](api/endpoint-manifest.json).
- Response examples: [examples/integrations/expected-responses](../examples/integrations/expected-responses).

## Server-side Node

Use this for RAG apps, API services, CLIs, background jobs, and internal tools. Store the user's `baseUrl` and `knowledgeBaseId` in your application, then call KnowMesh through the SDK.

```js
import { createKnowMeshClient } from "knowmesh";

const client = createKnowMeshClient({
  baseUrl: process.env.KNOWMESH_BASE_URL || "http://127.0.0.1:7457",
  knowledgeBaseId: "sample-general-docs",
  requestId: true
});

const result = await client.query("What review cadence is required?");

if (result.status === "answered") {
  await client.feedback({
    action: "useful",
    question: "What review cadence is required?",
    answerStatus: result.status,
    resultKey: result.resultKey,
    citationRefs: result.citations.slice(0, 1)
  });
}

if (result.status === "out_of_scope" || result.status === "insufficient_evidence") {
  // Show the product state to the user; do not blindly retry.
}
```

## Electron / Local Desktop Apps

Desktop apps should call KnowMesh from the main process and let the renderer ask the main process over IPC. This keeps `baseUrl`, request ids, feedback, and error handling in a trusted process.

- Connect to `127.0.0.1` by default.
- Do not expose the KnowMesh local service directly to the LAN.
- The renderer should not read local state, artifacts, or sidecar paths.
- If the user changes the port, the main process should call integration diagnostics first.

## Browser Apps Through a Backend

Public browser frontends should not directly call a user's local KnowMesh service. Prefer:

```text
Browser UI -> your backend/API -> KnowMesh local service
```

Your backend owns login, authorization, TLS, network policy, and audit. KnowMesh does not provide a remote-access auth layer by default, and it does not enable broad CORS by default. Remote access must be wrapped by caller-managed auth, TLS, proxying, and network boundaries.

## CI / Integration Acceptance

Downstream projects can validate KnowMesh as a local integration dependency:

```bash
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run verify:package-boundary
```

`smoke:sdk-consumer` proves package SDK exports from an installed tarball; `smoke:live-sdk` starts a temporary service, creates the public sample, calls real HTTP APIs through the installed SDK, submits feedback, and resets the sample; `verify:package-boundary` prevents private runtime state from entering the release package.

## Retry and Error Handling

The SDK's `KnowMeshApiError` is for transport/API failures such as timeout, network error, HTTP 408/429/5xx, and `provider_unavailable`. Use `error.retryable` for bounded retries.

Query Runtime statuses such as `answered`, `out_of_scope`, `insufficient_evidence`, and `blocked_by_quality` are product states. HTTP 200 refusals or no-evidence results are returned as results, not thrown as exceptions.

## Feedback and Maintenance Links

Integrations should send user feedback back to KnowMesh instead of inventing a hidden maintenance system.

- `wrong_citation`: citation issue, enters maintenance review.
- `missed_point`: missing answer point, enters maintenance review.
- `useful`: positive signal.
- Feedback summary: `GET /kb/:knowledgeBaseId/api/query/feedback/summary`.
- User-facing maintenance pages: `/kb/:knowledgeBaseId/use/feedback` and `/kb/:knowledgeBaseId/maintain/diagnostics`.

## Privacy and Local Boundaries

- Local by default: `127.0.0.1`.
- No upload, sync, or cloud resource creation by default.
- Do not log credentials, source document text, raw provider responses, or local absolute paths in public logs.
- Do not treat SQLite, artifacts, sidecars, or browser storage as integration APIs.
- If cloud providers are enabled, require explicit user configuration and confirmation inside KnowMesh before execution.

## References

- [Integration Examples](../examples/integrations/README.md)
- [Query Runtime API](api/query-runtime.en.md)
- [OpenAPI](api/openapi.json)
- [Endpoint Manifest](api/endpoint-manifest.json)
- [Provider Adapters](providers.en.md)
