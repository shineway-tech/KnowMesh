export const knowMeshIntegrationEndpoints = {
  integrationManifest: "/api/integration/manifest",
  scopedIntegrationManifest: "/kb/{knowledgeBaseId}/api/integration/manifest",
  integrationDiagnostics: "/api/integration/diagnostics",
  scopedIntegrationDiagnostics: "/kb/{knowledgeBaseId}/api/integration/diagnostics",
  query: "/kb/{knowledgeBaseId}/api/query",
  search: "/kb/{knowledgeBaseId}/api/search",
  feedback: "/kb/{knowledgeBaseId}/api/query/feedback",
  feedbackSummary: "/kb/{knowledgeBaseId}/api/query/feedback/summary",
  providerDiagnostics: "/kb/{knowledgeBaseId}/api/providers/diagnostics",
  packageExportPreview: "/kb/{knowledgeBaseId}/api/package/export/preview",
  packageImportPreview: "/kb/{knowledgeBaseId}/api/package/import/preview",
  maintenanceStatus: "/kb/{knowledgeBaseId}/api/maintenance/status",
  versionManifest: "/kb/{knowledgeBaseId}/api/version/manifest"
};

export const knowMeshIntegrationContract = {
  apiVersion: "1.0.0",
  contractVersion: "2026-07-query-runtime.1",
  queryRouteContractVersion: "2026-07-query-runtime.1",
  manifestVersion: "2026-07-integration-manifest.1",
  answerPolicy: "citation_ready_evidence_only",
  queryEvidenceField: "query.evidencePack",
  responseStatuses: ["answered", "out_of_scope", "insufficient_evidence", "no_index", "provider_unavailable", "blocked_by_quality"],
  retryableErrors: ["timeout", "network_error", "http_408", "http_429", "http_5xx", "provider_unavailable"],
  endpoints: knowMeshIntegrationEndpoints
};

let generatedRequestCounter = 0;

export class KnowMeshApiError extends Error {
  constructor(message, options = {}) {
    super(redactText(message || "KnowMesh request failed."));
    this.name = "KnowMeshApiError";
    this.status = Number(options.status || 0);
    this.code = String(options.code || "");
    this.retryable = options.retryable === true;
    this.endpoint = String(options.endpoint || "");
    this.method = String(options.method || "");
    this.requestId = String(options.requestId || "");
    this.details = redactErrorDetails(options.details || null);
    if (options.cause) this.cause = options.cause;
  }
}

export function createKnowMeshClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl || "http://127.0.0.1:7457");
  const knowledgeBaseId = String(options.knowledgeBaseId || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const requestTimeoutMs = Number(options.requestTimeoutMs ?? options.timeoutMs ?? 15000);
  const defaultHeaders = normalizeHeaders(options.headers || {});
  if (typeof fetchImpl !== "function") throw new Error("fetch is required.");

  const client = {
    contract: knowMeshIntegrationContract,
    endpoints: knowMeshIntegrationEndpoints,
    endpoint(key, input = {}) {
      return buildUrl(baseUrl, endpointPath(key, input.knowledgeBaseId ?? knowledgeBaseId));
    },
    serviceIntegrationManifest(input = {}) {
      return request("integrationManifest", { ...input, scoped: false });
    },
    integrationManifest(input = {}) {
      return request("scopedIntegrationManifest", input);
    },
    serviceIntegrationDiagnostics(input = {}) {
      return request("integrationDiagnostics", { ...input, scoped: false });
    },
    integrationDiagnostics(input = {}) {
      return request("scopedIntegrationDiagnostics", input);
    },
    query(question, input = {}) {
      return request("query", {
        method: "POST",
        body: {
          question,
          scope: input.scope || {},
          intent: input.intent,
          filters: input.filters || {},
          debug: input.debug === true
        },
        requestId: input.requestId,
        signal: input.signal
      });
    },
    search(input = {}) {
      return request("search", {
        query: input,
        requestId: input.requestId,
        signal: input.signal
      });
    },
    feedback(input = {}) {
      return request("feedback", {
        method: "POST",
        body: input,
        requestId: input.requestId,
        signal: input.signal
      });
    },
    feedbackSummary(input = {}) {
      return request("feedbackSummary", input);
    },
    providerDiagnostics(input = {}) {
      return request("providerDiagnostics", input);
    },
    packageExportPreview(input = {}) {
      return request("packageExportPreview", input);
    },
    packageImportPreview(manifest, input = {}) {
      return request("packageImportPreview", {
        ...input,
        method: "POST",
        body: { manifest }
      });
    },
    maintenanceStatus(input = {}) {
      return request("maintenanceStatus", input);
    },
    versionManifest(input = {}) {
      return request("versionManifest", input);
    }
  };

  async function request(key, input = {}) {
    const method = String(input.method || endpointDefaultMethod(key)).toUpperCase();
    const path = endpointPath(key, input.knowledgeBaseId ?? knowledgeBaseId, { scoped: input.scoped });
    const endpoint = buildUrl(baseUrl, path, input.query || {});
    const requestId = resolveRequestId(input.requestId ?? options.requestId);
    const headers = {
      accept: "application/json",
      ...defaultHeaders,
      ...normalizeHeaders(input.headers || {})
    };
    if (input.body !== undefined) headers["content-type"] = headers["content-type"] || "application/json";
    if (requestId) headers["x-knowmesh-request-id"] = requestId;

    const controller = new AbortController();
    const timeout = Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0
      ? setTimeout(() => controller.abort(), requestTimeoutMs)
      : null;

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method,
        signal: input.signal || controller.signal,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body)
      });
    } catch (error) {
      const code = error?.name === "AbortError" ? "timeout" : "network_error";
      throw new KnowMeshApiError(error?.name === "AbortError" ? "KnowMesh request timed out." : error?.message, {
        code,
        endpoint: path,
        method,
        requestId,
        retryable: true,
        details: { code },
        cause: error
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    const data = await safeJson(response);
    if (!response.ok || (data?.ok === false && hasApiErrorPayload(data))) {
      const code = normalizeErrorCode(data, response.status);
      throw new KnowMeshApiError(errorMessage(data, response.status), {
        status: response.status,
        code,
        endpoint: path,
        method,
        requestId: response.headers?.get?.("x-knowmesh-request-id") || requestId,
        retryable: retryableStatus(response.status) || retryableCode(code),
        details: data
      });
    }
    return data;
  }

  return client;
}

export function buildKnowMeshEndpoint(key, options = {}) {
  return endpointPath(key, options.knowledgeBaseId || "", options);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_json",
        message: `KnowMesh returned non-JSON response: ${response.status}`
      }
    };
  }
}

function endpointPath(key, knowledgeBaseId, options = {}) {
  const template = knowMeshIntegrationEndpoints[key];
  if (!template) throw new Error(`Unknown KnowMesh endpoint: ${key}`);
  if (!template.includes("{knowledgeBaseId}")) return template;
  const id = String(knowledgeBaseId || "");
  if (!id) throw new Error(`knowledgeBaseId is required for ${key}.`);
  return template.replace("{knowledgeBaseId}", encodeURIComponent(id));
}

function endpointDefaultMethod(key) {
  return key === "query" || key === "feedback" || key === "packageImportPreview" ? "POST" : "GET";
}

function buildUrl(baseUrl, pathname, query = {}) {
  const url = new URL(pathname, `${baseUrl}/`);
  for (const [key, value] of Object.entries(query || {})) {
    if (key === "requestId" || key === "signal" || value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function normalizeBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("baseUrl is required.");
  return text.replace(/\/+$/, "");
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  );
}

function resolveRequestId(value) {
  if (typeof value === "function") return String(value() || "");
  if (value === true) {
    generatedRequestCounter += 1;
    return `km-${Date.now().toString(36)}-${generatedRequestCounter.toString(36)}`;
  }
  return value ? String(value) : "";
}

function normalizeErrorCode(data, status) {
  return String(data?.error?.code || data?.code || data?.status || `http_${status}`);
}

function errorMessage(data, status) {
  const message = data?.error?.message || data?.message || data?.error;
  if (typeof message === "string" && message.trim()) return message.trim();
  if (message?.en || message?.zh) return message.en || message.zh;
  return `KnowMesh request failed: ${status}`;
}

function retryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function retryableCode(code) {
  return ["timeout", "network_error", "provider_unavailable", "http_408", "http_429", "http_5xx"].includes(String(code || ""));
}

function hasApiErrorPayload(data) {
  return Boolean(data?.error || data?.code);
}

function redactErrorDetails(data) {
  if (!data || typeof data !== "object") return null;
  const error = data.error && typeof data.error === "object" ? data.error : {};
  return {
    ok: data.ok === undefined ? undefined : Boolean(data.ok),
    kind: data.kind ? String(data.kind) : undefined,
    status: data.status ? String(data.status) : undefined,
    code: String(error.code || data.code || data.status || ""),
    message: redactText(error.message || data.message || ""),
    requestId: redactText(data.requestId || error.requestId || "")
  };
}

function redactText(value) {
  return String(value || "")
    .replace(/[A-Z]:\\[^\s"',}]+/g, "[redacted-path]")
    .replace(/\/Users\/[^\s"',}]+/g, "[redacted-path]")
    .replace(/\\Users\\[^\s"',}]+/g, "[redacted-path]")
    .replace(/\b(?:AccessKey|Secret|Token|Bearer|sk-)[A-Za-z0-9_\-:=.\/+]*/gi, "[redacted-secret]");
}
