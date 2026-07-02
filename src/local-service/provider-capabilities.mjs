import { getAliyunModelSlots, findAliyunModel, recommendedAliyunModel } from "../core/aliyun-model-catalog.mjs";
import { extensionCertificationSummary } from "./extension-certification.mjs";
import { expertRuntimeDiagnostics } from "./expert-runtime.mjs";
import {
  builtinProviderAdapterManifests,
  providerAdapterManifestContract,
  providerAdapterManifestSummary
} from "./provider-adapters.mjs";
import { localParserAdapterPilotContract } from "./providers/local-parser.mjs";
import { localVectorSidecarContract } from "./providers/local-vector.mjs";
import { buildProviderRegistry, providerById, providerMode } from "./providers/registry.mjs";
import { readSetupState } from "./setup-store.mjs";

export function providerCapabilities(state, options = {}) {
  const setupState = options.setupState || safeReadSetupState(state);
  const draft = {
    ...(setupState.draft || {}),
    ...(options.draft || {})
  };
  const modelSelections = buildModelSelections(setupState);
  const providers = buildProviders(setupState, draft, { state });
  const capabilities = buildCapabilities(providers, modelSelections);
  const permissionBundles = buildPermissionBundles(providers);
  const costPrivacyCards = buildCostPrivacyCards(providers, modelSelections);
  const guidedActions = buildGuidedActions(providers, setupState, draft);
  const providerAdapterManifests = builtinProviderAdapterManifests();
  const adapterContracts = buildAdapterContracts();
  const adapterPilotContracts = buildAdapterPilotContracts();
  const dryRun = buildProviderDryRun(providers, adapterContracts);
  const sensitiveDataPolicy = buildSensitiveDataPolicy();
  const extensionCertification = extensionCertificationSummary();
  const expertRuntime = expertRuntimeDiagnostics();
  const localVectorContract = localVectorSidecarContract();
  const summary = summarizeProviders(providers, capabilities, guidedActions);

  return {
    ok: guidedActions.length === 0,
    kind: "knowmesh.providerCapabilities",
    apiVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    phase: "phase6-provider-hardening",
    summary,
    providers,
    capabilities,
    modelSelections,
    permissionBundles,
    costPrivacyCards,
    providerAdapterManifestContract: providerAdapterManifestContract(),
    providerAdapterManifests,
    providerAdapterManifestSummary: providerAdapterManifestSummary(providerAdapterManifests),
    adapterContracts,
    adapterPilotContracts,
    localVectorSidecarContract: localVectorContract,
    dryRun,
    extensionCertification,
    expertRuntime,
    sensitiveDataPolicy,
    guidedActions,
    privacy: {
      redacted: true,
      excludes: ["providerTokens", "sourceContent", "documentText", "queryText", "answerText"]
    }
  };
}

function buildAdapterPilotContracts() {
  return [
    localParserAdapterPilotContract()
  ];
}

function buildAdapterContracts() {
  return [
    adapterContract("parser", "local-or-provider parsing", ["scan", "extract", "writeExtractionManifest"], "local"),
    adapterContract("ocr", "OCR and layout recognition", ["prepareBatch", "submitBatch", "readResult", "checkpoint"], "local-or-external"),
    adapterContract("chat", "citation-grounded answer generation", ["complete", "countTokens", "redactRequest"], "external"),
    adapterContract("embedding", "chunk embedding generation", ["embedBatch", "splitBatch", "checkpoint"], "external"),
    adapterContract("rerank", "retrieval reranking", ["rerank", "scoreEvidence"], "external"),
    adapterContract("vector", "vector index write and query", ["upsertBatch", "query", "deleteByVersion", "health"], "external"),
    adapterContract("object-store", "source archive and sidecar storage", ["putObject", "getObject", "listObjects", "publishSidecar"], "external")
  ];
}

function adapterContract(id, purpose, requiredMethods, boundary) {
  return {
    id,
    interfaceVersion: "1.0.0",
    purpose,
    lifecycle: {
      stage: id === "parser" ? "official" : "experimental",
      since: "0.1.0-alpha",
      graduation: "Adapter contracts graduate when implementations declare permissions, dry-run behavior, docs, and tests."
    },
    requiredMethods,
    externalCallBoundary: boundary,
    checkpointRequired: ["ocr", "embedding", "vector", "object-store"].includes(id),
    sensitiveDataPolicy: "redacted-local-only"
  };
}

function buildProviderDryRun(providers, adapterContracts) {
  const mappings = adapterContracts.map((contract) => adapterMapping(contract.id, providers));
  const configured = mappings.filter((item) => item.status === "configured");
  const missing = mappings.filter((item) => item.status === "missing");
  const externalCalls = configured
    .filter((item) => item.boundary === "external")
    .map((item) => ({
      adapter: item.adapter,
      providerId: item.providerId,
      operation: item.operation,
      confirmationRequired: true,
      sendsSourceContent: ["ocr", "chat", "embedding", "rerank"].includes(item.adapter),
      writesRemoteState: ["vector", "object-store"].includes(item.adapter)
    }));
  return {
    ok: missing.length === 0,
    kind: "knowmesh.providerDryRun",
    summary: {
      configured: configured.length,
      missing: missing.length,
      externalCallsBeforeExecution: externalCalls.length
    },
    configured,
    missing,
    externalCalls
  };
}

function adapterMapping(adapter, providers) {
  const localParser = providerById(providers, "local-parser");
  const localOcr = providerById(providers, "local-ocr");
  const localVector = providerById(providers, "local-vector");
  const modelStudio = providerById(providers, "aliyun-model-studio");
  const ossVector = providerById(providers, "aliyun-oss-vector");
  const ossStorage = providerById(providers, "aliyun-oss-storage");
  if (adapter === "parser") return mapping(adapter, localParser, "local", "extract");
  if (adapter === "ocr") {
    if (modelStudio?.configured) return mapping(adapter, modelStudio, "external", "documentOcr");
    return localOcr?.configured ? mapping(adapter, localOcr, "local", "documentOcr") : missingMapping(adapter, "Configure local OCR or Model Studio OCR before OCR execution.");
  }
  if (adapter === "chat") return modelStudio?.configured ? mapping(adapter, modelStudio, "external", "chatAnswer") : missingMapping(adapter, "Configure a chat provider before answer generation.");
  if (adapter === "embedding") return modelStudio?.configured ? mapping(adapter, modelStudio, "external", "embedding") : missingMapping(adapter, "Configure an embedding provider before vector writes.");
  if (adapter === "rerank") return modelStudio?.configured ? mapping(adapter, modelStudio, "external", "rerank") : missingMapping(adapter, "Configure a rerank provider before reranking.");
  if (adapter === "vector") {
    if (ossVector?.configured) return mapping(adapter, ossVector, "external", "vectorSearch");
    return localVector?.configured ? mapping(adapter, localVector, "local", "localVectorSearch") : missingMapping(adapter, "Configure OSS Vector or enable a local vector provider before vector search.");
  }
  if (adapter === "object-store") return ossStorage?.configured ? mapping(adapter, ossStorage, "external", "sourceArchive") : missingMapping(adapter, "Configure object storage before source archive or sidecar publication.");
  return missingMapping(adapter, "No provider mapping is registered.");
}

function mapping(adapter, provider, boundary, operation) {
  return {
    adapter,
    providerId: provider?.id || "",
    boundary,
    operation,
    status: "configured"
  };
}

function missingMapping(adapter, reason) {
  return {
    adapter,
    providerId: "",
    boundary: "",
    operation: "",
    status: "missing",
    reason
  };
}

function buildSensitiveDataPolicy() {
  return {
    redacted: true,
    storage: "local-secure-files-only",
    excludedFrom: ["sqlite", "diagnostics", "packagePreviews", "logs", "publicSamples", "sidecars"],
    diagnostics: "capabilities-only",
    packagePreviews: "paths-counts-checks-only"
  };
}

function safeReadSetupState(state) {
  try {
    return readSetupState(state);
  } catch {
    return {
      draft: {},
      credential: { configured: false },
      modelProvider: { configured: false },
      modelQuality: { configured: false },
      search: { configured: false }
    };
  }
}

function buildProviders(setupState, draft, options = {}) {
  return buildProviderRegistry(setupState, { draft, state: options.state });
}

function buildModelSelections(setupState) {
  const quality = setupState.modelQuality || {};
  const selectedBySlot = {
    ocr: quality.ocr,
    organizer: quality.organizer,
    embedding: quality.embedding,
    rerank: quality.rerank
  };
  const selections = {};
  for (const slot of getAliyunModelSlots()) {
    const selectedId = selectedBySlot[slot.key] || recommendedAliyunModel(slot.key)?.id || "";
    const model = findAliyunModel(slot.key, selectedId) || recommendedAliyunModel(slot.key);
    selections[slot.key] = {
      slot: slot.key,
      label: slot.label,
      purpose: slot.purpose,
      configured: Boolean(quality.configured && selectedBySlot[slot.key]),
      modelId: model?.id || selectedId,
      modelLabel: model?.label || { zh: selectedId, en: selectedId },
      status: model?.status || "available",
      costSignal: model?.impact || { zh: "", en: "" },
      docUrl: model?.docUrl || "",
      pricingUrl: model?.pricingUrl || "",
      ...(Number.isFinite(model?.batchSizeLimit) ? { batchSizeLimit: model.batchSizeLimit } : {})
    };
  }
  return selections;
}

function buildCapabilities(providers, modelSelections) {
  return providers.flatMap((provider) => provider.capabilities.map((item) => ({
    ...item,
    providerId: provider.id,
    operations: capabilityOperations(item, modelSelections),
    status: capabilityStatus(provider)
  })));
}

function capabilityOperations(item, modelSelections) {
  const selectedModels = {
    documentOcr: modelSelections.ocr?.modelId,
    contentOrganization: modelSelections.organizer?.modelId,
    embedding: modelSelections.embedding?.modelId,
    rerank: modelSelections.rerank?.modelId,
    chatAnswer: modelSelections.organizer?.modelId
  };
  return unique([selectedModels[item.key], ...(item.operations || [])]);
}

function capabilityStatus(provider) {
  if (provider.status === "disabled") return "disabled";
  return provider.configured ? "available" : "setupRequired";
}

function buildPermissionBundles(providers) {
  return providers
    .filter((item) => item.permissions.length)
    .map((item) => permissionBundle(item.id, item.permissions));
}

function buildCostPrivacyCards(providers, modelSelections) {
  return providers.map((provider) => costPrivacyCard(
    provider.id,
    provider.label.zh,
    provider.label.en,
    provider.cost?.units || [],
    provider.privacyBoundary,
    provider.id === "aliyun-model-studio" ? modelPricingLinks(modelSelections) : []
  )).map((card) => ({
    ...card,
    configured: Boolean(providerById(providers, card.providerId)?.configured)
  }));
}

function buildGuidedActions(providers, setupState, draft) {
  const actions = [];
  const mode = providerMode(setupState, draft);
  if (mode === "local") return actions;
  if (!setupState.credential?.configured) {
    actions.push(guidedAction("configureCloudCredential", "/setup/aliyun/credential", "配置阿里云凭证", "Configure Aliyun Credential", "用于 OSS、OSS Vector 和权限检查。", "Used for OSS, OSS Vector, and permission checks."));
  }
  if (!providerById(providers, "aliyun-oss-storage")?.configured) {
    actions.push(guidedAction("configureSourceStorage", "/setup/aliyun/storage", "确认资料保存空间", "Confirm Source Storage", "选择资料 Bucket 和地域。", "Choose the source bucket and region."));
  }
  if (!setupState.modelProvider?.configured) {
    actions.push(guidedAction("configureModelProvider", "/setup/aliyun/services", "配置模型服务", "Configure Model Provider", "保存百炼连接与访问方式。", "Save the Model Studio connection and access mode."));
  }
  if (!setupState.modelQuality?.configured) {
    actions.push(guidedAction("configureModelQuality", "/setup/aliyun/model-quality", "保存模型方案", "Save Model Profile", "选择 OCR、整理、向量化和重排模型。", "Choose OCR, organization, embedding, and rerank models."));
  }
  if (!providerById(providers, "aliyun-oss-vector")?.configured) {
    actions.push(guidedAction("configureVectorSearch", "/setup/aliyun/search", "配置知识检索", "Configure Knowledge Search", "配置 OSS 向量 Bucket、索引和向量模型关系。", "Configure OSS vector bucket, index, and embedding-model relation."));
  }
  if (draft["aliyun.search.embedding"] && draft["aliyun.services.embedding"] && draft["aliyun.search.embedding"] !== draft["aliyun.services.embedding"]) {
    actions.push(guidedAction("alignEmbeddingModel", "/setup/aliyun/search", "同步向量模型", "Align Embedding Model", "知识检索索引应与当前向量化模型一致。", "The knowledge-search index should match the current embedding model."));
  }
  return uniqueActions(actions);
}

function summarizeProviders(providers, capabilities, guidedActions) {
  const providerCounts = {
    total: providers.length,
    configured: providers.filter((item) => item.configured).length,
    setupRequired: providers.filter((item) => item.status === "setupRequired").length,
    disabled: providers.filter((item) => item.status === "disabled").length
  };
  return {
    status: guidedActions.length ? "attention" : "ready",
    providers: providerCounts,
    capabilities: {
      total: capabilities.length,
      available: capabilities.filter((item) => item.status === "available").length,
      setupRequired: capabilities.filter((item) => item.status === "setupRequired").length,
      disabled: capabilities.filter((item) => item.status === "disabled").length
    },
    actionCount: guidedActions.length
  };
}

function permissionBundle(providerId, actions) {
  return {
    providerId,
    actions,
    scope: "leastPrivilege",
    review: {
      zh: "复制最小权限策略前，请核对 Bucket、地域和专用 RAM 用户。",
      en: "Before copying the least-privilege policy, verify bucket, region, and the dedicated RAM user."
    }
  };
}

function costPrivacyCard(providerId, zhTitle, enTitle, units, privacy, links = []) {
  return {
    providerId,
    title: { zh: zhTitle, en: enTitle },
    cost: {
      units,
      estimateTiming: {
        zh: "正式执行前按页数、片段数或调用规模展示风险。",
        en: "Risk is shown before execution based on pages, chunks, or call scale."
      }
    },
    privacy,
    links
  };
}

function modelPricingLinks(modelSelections) {
  return unique(Object.values(modelSelections)
    .map((item) => item.pricingUrl)
    .filter(Boolean))
    .map((href) => ({ href, label: { zh: "价格说明", en: "Pricing" } }));
}

function guidedAction(key, href, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    href,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueActions(actions) {
  const seen = new Set();
  return actions.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}
