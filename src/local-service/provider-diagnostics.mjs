import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { providerCapabilities } from "./provider-capabilities.mjs";

export function providerDiagnostics(state = {}, options = {}) {
  const capabilities = options.capabilities || providerCapabilities(state, options);
  const manifests = Array.isArray(capabilities.providerAdapterManifests) ? capabilities.providerAdapterManifests : [];
  const dryRun = capabilities.dryRun || {};
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || state.knowledgeBaseId || "");
  return {
    ok: true,
    kind: "knowmesh.providerDiagnostics",
    apiVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    knowledgeBase: { id: knowledgeBaseId },
    summary: {
      status: capabilities.summary?.status || "attention",
      providers: capabilities.summary?.providers || {},
      capabilities: capabilities.summary?.capabilities || {},
      adapterManifests: manifests.length,
      externalCallsBeforeExecution: Number(dryRun.summary?.externalCallsBeforeExecution || 0),
      missingAdapters: Array.isArray(dryRun.missing) ? dryRun.missing.length : 0,
      nextActions: Array.isArray(capabilities.guidedActions) ? capabilities.guidedActions.length : 0
    },
    stateAuthority: {
      providerSelection: "workspace.sqlite",
      knowledgeBaseState: "catalog.sqlite",
      browserStorage: "visual-preferences-only"
    },
    manifestReadiness: {
      contractVersion: capabilities.providerAdapterManifestContract?.contractVersion || "",
      total: capabilities.providerAdapterManifestSummary?.total || manifests.length,
      byKind: capabilities.providerAdapterManifestSummary?.byKind || {},
      validation: capabilities.providerAdapterManifestSummary?.validation || { ok: false, errors: [] }
    },
    capabilityInventory: (capabilities.capabilities || []).map((item) => ({
      key: item.key,
      providerId: item.providerId,
      status: item.status,
      operations: item.operations || []
    })),
    dryRun: {
      status: dryRun.ok === true ? "ready" : "attention",
      externalCallsBeforeExecution: Number(dryRun.summary?.externalCallsBeforeExecution || 0),
      configured: dryRun.configured || [],
      missing: dryRun.missing || [],
      externalCalls: dryRun.externalCalls || []
    },
    costPrivacyWarnings: (capabilities.costPrivacyCards || []).map((item) => ({
      providerId: item.providerId,
      configured: Boolean(item.configured),
      units: item.cost?.units || [],
      dataLeavesDevice: item.privacy?.dataLeavesDevice === true,
      storesSource: item.privacy?.storesSource === true,
      storesVectors: item.privacy?.storesVectors === true
    })),
    retryability: manifests.map((manifest) => ({
      adapterId: manifest.id,
      kind: manifest.kind,
      executionMode: manifest.execution?.mode || "",
      checkpointed: manifest.retryPolicy?.checkpointed === true || manifest.checkpointPolicy?.required === true,
      transientOnly: manifest.retryPolicy?.transientOnly === true,
      splitStrategy: manifest.batchLimits?.splitStrategy || "",
      catalogFallback: manifest.id.includes("vector") || manifest.kind === "fallback" ? "catalog-search" : ""
    })),
    nextActions: capabilities.guidedActions || [],
    privacy: {
      redacted: true,
      excludes: ["providerTokens", "sourceContent", "documentText", "queryText", "answerText", "rawSecrets"]
    }
  };
}
