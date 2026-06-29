import { getAliyunModelSlots, findAliyunModel, recommendedAliyunModel } from "../core/aliyun-model-catalog.mjs";
import { minimumAliyunPolicy } from "./aliyun.mjs";
import { readSetupState } from "./setup-store.mjs";

export function providerCapabilities(state, options = {}) {
  const setupState = options.setupState || safeReadSetupState(state);
  const draft = {
    ...(setupState.draft || {}),
    ...(options.draft || {})
  };
  const modelSelections = buildModelSelections(setupState);
  const permissionPolicy = minimumAliyunPolicy(draft).policy;
  const providers = buildProviders(setupState, draft);
  const capabilities = buildCapabilities(providers, modelSelections);
  const permissionBundles = buildPermissionBundles(permissionPolicy);
  const costPrivacyCards = buildCostPrivacyCards(providers, modelSelections);
  const guidedActions = buildGuidedActions(providers, setupState, draft);
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
    guidedActions,
    privacy: {
      redacted: true,
      excludes: ["providerTokens", "sourceContent", "documentText", "queryText", "answerText"]
    }
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

function buildProviders(setupState, draft) {
  const credentialReady = Boolean(setupState.credential?.configured);
  const storageReady = credentialReady && Boolean(
    draft["aliyun.storage.confirmed"] === true
      || draft["aliyun.storage.bucket"]
      || draft["aliyun.oss.bucket"]
  );
  const modelProviderReady = Boolean(setupState.modelProvider?.configured);
  const modelQualityReady = Boolean(setupState.modelQuality?.configured);
  const searchReady = Boolean(setupState.search?.configured || (draft["aliyun.search.bucket"] && draft["aliyun.search.index"]));

  return [
    provider(
      "local-catalog",
      "本地目录与 SQLite",
      "Local Catalog and SQLite",
      "local",
      true,
      "pass",
      "workspace.sqlite 与每个知识库 catalog.sqlite 始终在本机运行。",
      "workspace.sqlite and each knowledge-base catalog.sqlite always run locally."
    ),
    provider(
      "aliyun-oss-storage",
      "阿里云 OSS 资料保存",
      "Alibaba Cloud OSS Source Storage",
      "cloud-storage",
      storageReady,
      storageReady ? "pass" : "setupRequired",
      storageReady ? "资料保存空间已配置。" : "需要先确认阿里云资料保存空间。",
      storageReady ? "Source storage is configured." : "Confirm Alibaba Cloud source storage first."
    ),
    provider(
      "aliyun-model-studio",
      "阿里百炼模型服务",
      "Alibaba Cloud Model Studio",
      "cloud-model",
      modelProviderReady && modelQualityReady,
      modelProviderReady && modelQualityReady ? "pass" : "setupRequired",
      modelProviderReady && modelQualityReady ? "模型连接与模型方案已配置。" : "需要配置模型连接并保存模型方案。",
      modelProviderReady && modelQualityReady ? "Model connection and model profile are configured." : "Configure the model connection and save the model profile."
    ),
    provider(
      "aliyun-oss-vector",
      "OSS 向量检索",
      "OSS Vector Search",
      "cloud-vector",
      credentialReady && searchReady,
      credentialReady && searchReady ? "pass" : "setupRequired",
      credentialReady && searchReady ? "向量 Bucket 与索引已配置。" : "需要配置 OSS 向量 Bucket 与索引。",
      credentialReady && searchReady ? "Vector bucket and index are configured." : "Configure the OSS vector bucket and index."
    )
  ];
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
  return [
    capability("localCatalog", "local-catalog", "本地目录查询", "Local catalog queries", ["workspace.sqlite", "catalog.sqlite"]),
    capability("sourceArchive", "aliyun-oss-storage", "资料归档", "Source archive", ["oss:ObjectReadWrite"]),
    capability("documentOcr", "aliyun-model-studio", "OCR / 文档识别", "OCR / document recognition", [modelSelections.ocr?.modelId]),
    capability("contentOrganization", "aliyun-model-studio", "内容整理", "Content organization", [modelSelections.organizer?.modelId]),
    capability("embedding", "aliyun-model-studio", "向量化", "Embedding", [modelSelections.embedding?.modelId]),
    capability("rerank", "aliyun-model-studio", "重排", "Rerank", [modelSelections.rerank?.modelId]),
    capability("chatAnswer", "aliyun-model-studio", "回答生成", "Answer generation", [modelSelections.organizer?.modelId]),
    capability("vectorStorage", "aliyun-oss-vector", "向量写入", "Vector writes", ["PutVectors"]),
    capability("vectorSearch", "aliyun-oss-vector", "向量检索", "Vector search", ["QueryVectors"])
  ].map((item) => ({
    ...item,
    status: providerById(providers, item.providerId)?.configured ? "available" : "setupRequired"
  }));
}

function buildPermissionBundles(policy) {
  const actions = (providerId, predicate) => unique(policy.Statement
    .flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [])
    .filter(predicate));
  return [
    permissionBundle("aliyun-oss-storage", actions("aliyun-oss-storage", (item) => item.startsWith("oss:") && !item.includes("Vector"))),
    permissionBundle("aliyun-oss-vector", actions("aliyun-oss-vector", (item) => item.startsWith("oss:") && item.includes("Vector"))),
    permissionBundle("aliyun-model-studio", actions("aliyun-model-studio", (item) => item.startsWith("dashscope:")))
  ].filter((item) => item.actions.length);
}

function buildCostPrivacyCards(providers, modelSelections) {
  return [
    costPrivacyCard("local-catalog", "本地计算与磁盘", "Local CPU and disk", ["local_cpu", "local_disk"], {
      dataLeavesDevice: false,
      storesSource: false,
      storesVectors: false,
      redacted: true
    }),
    costPrivacyCard("aliyun-oss-storage", "OSS 存储与请求", "OSS storage and requests", ["storage_gb_month", "request_count", "egress_if_applicable"], {
      dataLeavesDevice: true,
      storesSource: true,
      storesVectors: false,
      redacted: true
    }),
    costPrivacyCard("aliyun-model-studio", "模型调用", "Model calls", ["model_calls", "input_tokens", "output_tokens", "ocr_pages"], {
      dataLeavesDevice: true,
      storesSource: false,
      storesVectors: false,
      redacted: true
    }, modelPricingLinks(modelSelections)),
    costPrivacyCard("aliyun-oss-vector", "OSS Vector 存储与查询", "OSS Vector storage and queries", ["vector_storage", "vector_writes", "vector_queries"], {
      dataLeavesDevice: true,
      storesSource: false,
      storesVectors: true,
      redacted: true
    })
  ].map((card) => ({
    ...card,
    configured: Boolean(providerById(providers, card.providerId)?.configured)
  }));
}

function buildGuidedActions(providers, setupState, draft) {
  const actions = [];
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
    setupRequired: providers.filter((item) => !item.configured).length
  };
  return {
    status: guidedActions.length ? "attention" : "ready",
    providers: providerCounts,
    capabilities: {
      total: capabilities.length,
      available: capabilities.filter((item) => item.status === "available").length,
      setupRequired: capabilities.filter((item) => item.status === "setupRequired").length
    },
    actionCount: guidedActions.length
  };
}

function provider(id, zhLabel, enLabel, type, configured, status, zhMessage, enMessage) {
  return {
    id,
    type,
    configured,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function capability(key, providerId, zhLabel, enLabel, operations) {
  return {
    key,
    providerId,
    label: { zh: zhLabel, en: enLabel },
    operations: operations.filter(Boolean)
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

function providerById(providers, id) {
  return providers.find((item) => item.id === id) || null;
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
