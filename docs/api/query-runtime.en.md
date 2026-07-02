# Query Runtime API

[中文](query-runtime.zh-CN.md) | [OpenAPI Spec](openapi.json) | [Documentation](../README.en.md) | [Current Design](../current-design.md)

Query Runtime is the shared answer contract for the KnowMesh console and external integrations. It is not a UI-only shortcut, and it is not a thin wrapper over a vector bucket. Callers should use Query Runtime to obtain answers, citations, checks, and feedback actions.

The machine-readable [OpenAPI 3.1 spec](openapi.json) covers Query, feedback, search, maintenance, package preview, and version endpoints.

## Endpoints

```text
POST /kb/:knowledgeBaseId/api/query
GET  /kb/:knowledgeBaseId/api/query/contract
POST /kb/:knowledgeBaseId/api/query/plan
POST /kb/:knowledgeBaseId/api/query/feedback
GET  /kb/:knowledgeBaseId/api/query/feedback/summary
POST /kb/:knowledgeBaseId/api/query/feedback/resolve
```

When no knowledge base is selected, `/api/query` must not silently fall back to an implicit default. Integrations should use scoped paths.

## Request

```json
{
  "question": "Which page explains the refund policy?",
  "scope": {},
  "intent": "",
  "filters": {},
  "debug": false
}
```

Fields:

- `question`: required natural-language question.
- `scope`: optional caller-provided scope hint, such as document, textbook, or business scope.
- `intent`: optional intent hint; KnowMesh still performs query understanding.
- `filters`: optional catalog filters such as `documentId`, `pageStart`, `pageEnd`, or `sourceType`.
- `debug`: optional diagnostics flag; defaults to `false`.

## Response Fields

Stable public fields:

- `ok`
- `status`
- `answer`
- `citations`
- `checks`
- `feedback`
- `maintenance`

Render `answer.text` as a reliable answer only when `ok=true` and `status=answered`. For refusals or insufficient evidence, `answer.text` is empty; show `answer.message`, `checks`, or maintenance guidance instead.

`query.evidencePack` is the stable evidence handoff for integrations. It uses contract version `2026-07-query-runtime.1` and `answerPolicy: "citation_ready_evidence_only"`. Each item may include `chunkId`, `citationId`, `documentId`, `documentStatus`, `qualityState`, `structurePath`, `rankingSignals`, `sourceAnchor`, and scoped links.

## Status Values

| Status | Meaning |
| --- | --- |
| `answered` | A cited, evidence-supported answer passed quality gates. |
| `out_of_scope` | The question is outside the current knowledge-base scope. |
| `insufficient_evidence` | There is not enough traceable evidence to answer. |
| `no_index` | The retrieval index or sidecar contract is missing. |
| `provider_unavailable` | A required provider is not configured or unavailable. |
| `blocked_by_quality` | Citation, support, weak-answer, or display-serialization gates failed. |
| `invalid_request` | The request is malformed or the question is empty. |
| `runtime_error` | Query Runtime failed internally. |

## Citations

Every usable answer must include traceable citations. A citation should lead back to:

- source document;
- page number or structure anchor;
- bounded excerpt;
- document or diagnostics link.

Refusals should not return unrelated citations. If a citation lacks a page or structure anchor, or if the citation does not support the answer, the response must not count as `answered`.

## Quality Gates

Query Runtime returns at least these checks:

- `scopeFit`
- `evidenceFound`
- `citationTraceability`
- `citationSupportsAnswer`
- `noOutOfScopeLeakage`
- `noWeakAnswer`
- `displaySerialization`

Callers may render `checks` as diagnostics, but should not wrap failed checks as successful answers.

## Feedback

`feedback.endpoint` points to the current knowledge base's feedback API. Recommended actions:

- `useful`: positive signal; does not enter the review queue.
- `wrong_citation`: citation issue; enters answer feedback review.
- `missed_point`: incomplete answer; enters answer feedback review.

Feedback must stay scoped to the current knowledge base. Do not merge feedback queues across knowledge bases.

## Discovery And Diagnostics

- `GET /api/integration/manifest` returns supported integration endpoints, response kinds, retryability, and privacy notes.
- `GET /api/integration/diagnostics` returns API readiness, retry semantics, selected knowledge-base requirements, and localhost/CORS guidance.
- Scoped apps should prefer `/kb/:knowledgeBaseId/api/integration/diagnostics` before sending user requests.
- KnowMesh binds to `127.0.0.1` by default. Do not expose the local service to a remote network unless you add explicit authentication, TLS, and network policy outside KnowMesh.
- Retry only timeout, local service unavailable, HTTP 408/429/5xx, network errors, and `provider_unavailable`.
- Do not retry `invalid_request`, `out_of_scope`, `insufficient_evidence`, or `knowledge_base_required`; show the product state or maintenance action.

## Integration Rules

- Call Query Runtime instead of bypassing directly to a vector bucket.
- Show answer text only for `ok=true && status=answered`.
- Treat `query.evidencePack` as the evidence surface; do not read internal SQLite.
- Always show source, page, or structure anchor.
- Treat `out_of_scope` and `insufficient_evidence` as refusal or add-more-sources states.
- Treat `provider_unavailable` and `blocked_by_quality` as actionable product states, not generic transport failures.
- Do not log credentials, full source text, or provider internals to external systems.

## `0.3.0` Release Evidence

Before Query Runtime is accepted as `0.3.0`, release evidence must pass route contract readiness, citation-grounded answer proof, refusal/no-answer proof, feedback-maintenance proof, integration contract proof, and browser ask workflow. See [Release Operations](../release-operations.en.md) for the validation command.
