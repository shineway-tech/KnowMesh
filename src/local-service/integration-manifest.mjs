import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";

export const integrationContractVersion = "2026-07-query-runtime.1";

export const integrationBoundary = {
  mode: "http-api-only",
  summary: "Use the local HTTP API. Do not read internal SQLite files, artifacts, sidecars, or browser storage.",
  forbiddenReads: ["workspace.sqlite", "catalog.sqlite", "artifacts", "published sidecars", "browser storage"],
  stateAuthority: {
    workspace: "workspace.sqlite",
    knowledgeBase: "catalog.sqlite",
    browserStorage: "visual-preferences-only"
  }
};

export const integrationEndpoints = [
  endpoint("integrationManifest", "GET", "/api/integration/manifest", {
    scoped: false,
    responseKind: "knowmesh.integrationManifest",
    statusCases: ["ready"],
    retryable: false,
    privacy: "No source text, credentials, answers, queries, or local artifact paths."
  }),
  endpoint("scopedIntegrationManifest", "GET", "/kb/{knowledgeBaseId}/api/integration/manifest", {
    responseKind: "knowmesh.integrationManifest",
    statusCases: ["ready"],
    retryable: false,
    privacy: "Scoped to one knowledge base; no source text, credentials, answers, queries, or local artifact paths."
  }),
  endpoint("integrationDiagnostics", "GET", "/api/integration/diagnostics", {
    scoped: false,
    responseKind: "knowmesh.integrationDiagnostics",
    statusCases: ["ready", "knowledge_base_required", "attention"],
    retryable: false,
    privacy: "Redacted API readiness, retry, CORS, provider, and Query Runtime summary."
  }),
  endpoint("scopedIntegrationDiagnostics", "GET", "/kb/{knowledgeBaseId}/api/integration/diagnostics", {
    responseKind: "knowmesh.integrationDiagnostics",
    statusCases: ["ready", "attention"],
    retryable: false,
    privacy: "Scoped redacted integration readiness; no credentials, content, questions, answers, or local artifact paths."
  }),
  endpoint("query", "POST", "/kb/{knowledgeBaseId}/api/query", {
    responseKind: "knowmesh.queryRuntimeResult",
    statusCases: ["answered", "out_of_scope", "insufficient_evidence", "provider_unavailable", "invalid_request"],
    retryable: "provider_unavailable, timeout, HTTP 408/429/5xx",
    privacy: "Request may contain user question text; diagnostics and examples must not store private questions."
  }),
  endpoint("search", "GET", "/kb/{knowledgeBaseId}/api/search", {
    responseKind: "knowmesh.catalogSearch",
    statusCases: ["ready", "empty", "invalid_request"],
    retryable: false,
    privacy: "Returns bounded excerpts and citation metadata, not full source files."
  }),
  endpoint("feedback", "POST", "/kb/{knowledgeBaseId}/api/query/feedback", {
    responseKind: "knowmesh.queryFeedback",
    statusCases: ["recorded", "invalid_request"],
    retryable: false,
    privacy: "Feedback may reference result ids and citation ids; avoid private free-form text."
  }),
  endpoint("feedbackSummary", "GET", "/kb/{knowledgeBaseId}/api/query/feedback/summary", {
    responseKind: "knowmesh.queryFeedbackSummary",
    statusCases: ["ready", "empty"],
    retryable: false,
    privacy: "Returns scoped counts and review signals; no question text or answer text."
  }),
  endpoint("providerDiagnostics", "GET", "/kb/{knowledgeBaseId}/api/providers/diagnostics", {
    responseKind: "knowmesh.providerDiagnostics",
    statusCases: ["ready", "attention"],
    retryable: false,
    privacy: "Redacted provider readiness; no credential values, source text, query text, or answer text."
  }),
  endpoint("packageExportPreview", "GET", "/kb/{knowledgeBaseId}/api/package/export/preview", {
    responseKind: "knowmesh.packageExportPreview",
    statusCases: ["ready", "knowledge_base_required"],
    retryable: false,
    privacy: "Redacted package manifest preview; no SQLite files or private source text."
  }),
  endpoint("packageImportPreview", "POST", "/kb/{knowledgeBaseId}/api/package/import/preview", {
    responseKind: "knowmesh.packageImportPreview",
    statusCases: ["ready", "blocked", "attention"],
    retryable: false,
    privacy: "Preview only; does not write workspace or catalog state."
  }),
  endpoint("maintenanceStatus", "GET", "/kb/{knowledgeBaseId}/api/maintenance/status", {
    responseKind: "knowmesh.maintenanceStatus",
    statusCases: ["ready", "attention", "blocked"],
    retryable: false,
    privacy: "Redacted status for runtime, provider, quality, sample ownership, and next actions."
  }),
  endpoint("versionManifest", "GET", "/kb/{knowledgeBaseId}/api/version/manifest", {
    responseKind: "knowmesh.versionManifest",
    statusCases: ["ready", "empty"],
    retryable: false,
    privacy: "Version summary and manifest paths only; no source text."
  })
];

export function integrationManifest(state = {}, options = {}) {
  const knowledgeBaseId = options.scoped === false
    ? ""
    : String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || state.knowledgeBaseId || "");
  return {
    ok: true,
    kind: "knowmesh.integrationManifest",
    apiVersion: "1.0.0",
    contractVersion: integrationContractVersion,
    manifestVersion: "2026-07-integration-manifest.1",
    generatedAt: new Date().toISOString(),
    knowledgeBase: {
      id: knowledgeBaseId,
      scoped: Boolean(knowledgeBaseId)
    },
    integrationBoundary,
    endpoints: integrationEndpoints.map((item) => ({
      ...item,
      scopedPath: knowledgeBaseId && item.path.includes("{knowledgeBaseId}")
        ? item.path.replace("{knowledgeBaseId}", encodeURIComponent(knowledgeBaseId))
        : item.path
    })),
    retryPolicy: {
      retryable: ["timeout", "network_error", "http_408", "http_429", "http_5xx", "provider_unavailable"],
      nonRetryable: ["invalid_request", "out_of_scope", "insufficient_evidence", "blocked_by_quality", "knowledge_base_required"]
    },
    privacy: {
      redacted: true,
      excludes: ["credentials", "sourceContent", "documentText", "queryText", "answerText", "localArtifactPaths", "rawProviderResponses"]
    }
  };
}

function endpoint(key, method, path, options = {}) {
  return {
    key,
    method,
    path,
    scoped: options.scoped !== false,
    pathParams: path.includes("{knowledgeBaseId}") ? ["knowledgeBaseId"] : [],
    responseKind: options.responseKind || "application/json",
    statusCases: options.statusCases || [],
    retryable: options.retryable,
    privacy: options.privacy || "Redacted integration response."
  };
}
