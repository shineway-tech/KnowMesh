export function localVectorProviderDescriptor(options = {}) {
  const enabled = Boolean(options.localVectorEnabled);
  return {
    id: "local-vector",
    type: "local-vector",
    configured: enabled,
    status: enabled ? "pass" : "disabled",
    optional: true,
    label: {
      zh: "本地向量检索",
      en: "Local Vector Search"
    },
    message: enabled
      ? {
          zh: "本地向量 provider 已启用，可作为 catalog 查询的加速层。",
          en: "The local vector provider is enabled and can accelerate catalog search."
        }
      : {
          zh: "本地向量 provider 当前关闭；Query Runtime 会回退到 catalog/FTS 查询。",
          en: "The local vector provider is disabled; Query Runtime falls back to catalog/FTS search."
        },
    capabilities: [
      capability("localVectorStorage", "本地向量写入", "Local vector writes", ["local-index"]),
      capability("localVectorSearch", "本地向量检索", "Local vector search", ["optional-acceleration"])
    ],
    setupRequirements: [
      requirement("localVectorEngine", "安装或启用本地 embedding/vector 引擎", "Install or enable a local embedding/vector engine", false)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: true }),
    cost: cost(["local_cpu", "local_disk", "optional_gpu"]),
    batch: batch({ supported: true, mode: "optional-provider", fallback: "catalog-search" }),
    retry: retry({ transientOnly: false, checkpointed: true }),
    permissions: [],
    userFixableErrors: [
      fix("localVectorDisabled", "可以保持关闭；KnowMesh 会使用 catalog 搜索作为权威回退。", "It can stay disabled; KnowMesh uses catalog search as the authoritative fallback.")
    ]
  };
}

export function inspectLocalVectorAdapterDependencies(state = {}) {
  const enabled = Boolean(state.localVectorEnabled || state.localVectorProvider);
  return {
    status: enabled ? "pass" : "disabled",
    adapters: [
      {
        key: "localVector",
        label: "Local vector provider",
        status: enabled ? "pass" : "disabled",
        message: enabled
          ? "Local vector acceleration is enabled."
          : "Local vector acceleration is disabled; catalog search remains available."
      }
    ],
    message: enabled
      ? label("本地向量 provider 可用。", "Local vector provider is available.")
      : label("本地向量 provider 暂未启用；catalog 搜索会继续可用。", "Local vector provider is not enabled; catalog search remains available.")
  };
}

export function localVectorSidecarContract() {
  return {
    kind: "knowmesh.localVectorSidecarContract",
    contractVersion: "1.0.0",
    authority: "catalog.sqlite",
    provider: "local-vector",
    requiredFields: [
      "provider",
      "dimensions",
      "expectedDimensions",
      "chunkId",
      "chunkTextHash",
      "checksum",
      "status",
      "uri"
    ],
    statusValues: ["ready", "missing", "stale", "dimension_mismatch", "disabled"],
    invalidVectorFallback: "catalog-search",
    catalogBoundary: "index_records.metadata_json.sidecar",
    privacy: {
      redacted: true,
      storesSourceText: false,
      storesVectorOnly: true
    }
  };
}

function capability(key, zh, en, operations) {
  return { key, label: { zh, en }, operations };
}

function requirement(key, zh, en, required) {
  return { key, required, label: { zh, en } };
}

function fix(key, zh, en) {
  return { key, message: { zh, en } };
}

function privacy(values) {
  return { redacted: true, ...values };
}

function cost(units) {
  return {
    units,
    estimateTiming: {
      zh: "启用前按片段数、维度和本地索引大小展示风险。",
      en: "Risk is shown before enabling based on chunks, dimensions, and local index size."
    }
  };
}

function batch(values) {
  return values;
}

function retry(values) {
  return {
    networkOnly: false,
    ...values
  };
}

function label(zh, en) {
  return { zh, en };
}
