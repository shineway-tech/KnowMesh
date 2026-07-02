import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { maintenanceStatus } from "./maintenance.mjs";
import { providerDiagnostics } from "./provider-diagnostics.mjs";
import { integrationContractVersion, integrationManifest } from "./integration-manifest.mjs";

export const integrationRetrySemantics = {
  retryable: [
    "local_service_unavailable",
    "timeout",
    "network_error",
    "http_408",
    "http_429",
    "http_5xx",
    "provider_unavailable"
  ],
  nonRetryable: [
    "invalid_request",
    "out_of_scope",
    "insufficient_evidence",
    "no_index",
    "knowledge_base_required"
  ],
  maintenanceRequired: [
    "blocked_by_quality",
    "wrong_citation",
    "missed_point",
    "provider_setup_required"
  ]
};

export function integrationDiagnostics(state = {}, options = {}) {
  const scoped = options.scoped !== false;
  const knowledgeBaseId = scoped
    ? String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || state.knowledgeBaseId || "")
    : "";
  const registry = safeRegistry(state);
  const selected = Boolean(knowledgeBaseId);
  const manifest = integrationManifest(state, { scoped, knowledgeBaseId });
  const provider = selected ? providerDiagnostics(state) : null;
  const maintenance = selected ? maintenanceStatus(state) : null;

  return {
    ok: true,
    kind: "knowmesh.integrationDiagnostics",
    apiVersion: "1.0.0",
    contractVersion: integrationContractVersion,
    generatedAt: new Date().toISOString(),
    service: {
      host: state.host || "127.0.0.1",
      port: Number(state.port || state.requestedPort || 7457),
      baseUrl: state.port ? `http://${state.host || "127.0.0.1"}:${state.port}` : "http://127.0.0.1:7457",
      remoteAccess: false
    },
    knowledgeBase: {
      id: knowledgeBaseId,
      scoped,
      selected,
      availableCount: Array.isArray(registry.items) ? registry.items.length : 0
    },
    readiness: {
      api: "ready",
      endpointManifest: {
        status: "ready",
        manifestVersion: manifest.manifestVersion,
        endpoints: manifest.endpoints.length
      },
      knowledgeBase: selected ? "ready" : "required",
      queryRuntime: queryRuntimeReadiness(maintenance, selected),
      provider: providerReadiness(provider, selected)
    },
    retrySemantics: integrationRetrySemantics,
    cors: {
      defaultBindHost: "127.0.0.1",
      defaultRemoteAccess: false,
      guidance: "Keep KnowMesh bound to localhost by default. Put any remote access behind explicit user-managed authentication, TLS, and network policy."
    },
    nextActions: integrationNextActions({ selected, provider, maintenance }),
    privacy: {
      redacted: true,
      excludes: ["credentials", "sourceContent", "documentText", "queryText", "answerText", "localArtifactPaths", "rawProviderResponses"]
    }
  };
}

function queryRuntimeReadiness(maintenance, selected) {
  if (!selected) {
    return {
      status: "blocked",
      reason: "knowledge_base_required",
      retryable: false
    };
  }
  const checks = Array.isArray(maintenance?.checks) ? maintenance.checks : [];
  const blocked = checks.filter((item) => ["blocked", "fail"].includes(String(item.status || "")));
  return {
    status: blocked.length ? "attention" : "ready",
    contractVersion: integrationContractVersion,
    answerPolicy: "citation_ready_evidence_only",
    blockedChecks: blocked.map((item) => String(item.key || item.label?.en || "")).filter(Boolean).slice(0, 5)
  };
}

function providerReadiness(provider, selected) {
  if (!selected) {
    return {
      status: "blocked",
      reason: "knowledge_base_required",
      retryable: false
    };
  }
  return {
    status: provider?.summary?.status || provider?.dryRun?.status || "attention",
    adapterManifests: Number(provider?.summary?.adapterManifests || 0),
    dryRunStatus: provider?.dryRun?.status || "",
    externalCallsBeforeExecution: Number(provider?.dryRun?.externalCallsBeforeExecution || 0),
    manifestValidation: provider?.manifestReadiness?.validation?.ok === true ? "pass" : "attention"
  };
}

function integrationNextActions({ selected, provider, maintenance }) {
  if (!selected) {
    return [
      {
        key: "selectKnowledgeBase",
        status: "required",
        label: "Select a knowledge base or create the public sample before scoped API calls."
      }
    ];
  }
  const actions = [];
  if (provider?.dryRun?.status && provider.dryRun.status !== "ready") {
    actions.push({
      key: "reviewProviderDiagnostics",
      status: "suggested",
      endpoint: "/api/providers/diagnostics"
    });
  }
  const quality = maintenance?.maintenance?.qualityIssues || {};
  if (Number(quality.open || 0) > 0) {
    actions.push({
      key: "reviewMaintenanceIssues",
      status: "suggested",
      page: "/maintain/review"
    });
  }
  actions.push({
    key: "callScopedApis",
    status: "ready",
    label: "Use /kb/{knowledgeBaseId}/api paths for application requests."
  });
  return actions;
}

function safeRegistry(state) {
  try {
    return listKnowledgeBases(state);
  } catch {
    return { items: [], current: null };
  }
}
