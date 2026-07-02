const contractVersion = "1.0.0";

const adapterKinds = [
  "catalog",
  "parser",
  "ocr",
  "embedding",
  "rerank",
  "vector-store",
  "object-store",
  "export",
  "fallback"
];

const lifecycleStages = ["experimental", "certified", "official", "deprecated"];
const executionModes = ["local", "external", "disabled"];

export function providerAdapterManifestContract() {
  return {
    kind: "knowmesh.providerAdapterManifestContract",
    contractVersion,
    requiredFields: [
      "id",
      "kind",
      "lifecycle",
      "capabilities",
      "execution",
      "permissions",
      "secretRequirements",
      "privacyBoundary",
      "costHints",
      "batchLimits",
      "retryPolicy",
      "checkpointPolicy",
      "storageBoundary",
      "docs",
      "fixtures",
      "requiredTests"
    ],
    adapterKinds,
    lifecycleStages,
    executionModes,
    forbidden: [
      "wildcard permissions",
      "direct catalog writes",
      "implicit external calls",
      "private fixtures",
      "secret values in diagnostics"
    ]
  };
}

export function builtinProviderAdapterManifests() {
  return [
    localCatalogManifest(),
    localParserManifest(),
    localOcrManifest(),
    localVectorSidecarManifest(),
    aliyunOssManifest(),
    dashscopeOcrManifest(),
    aliyunOssVectorManifest(),
    dashscopeEmbeddingManifest(),
    dashscopeRerankManifest(),
    noRerankFallbackManifest(),
    noProviderFallbackManifest()
  ];
}

export function providerAdapterManifestSummary(manifests = builtinProviderAdapterManifests()) {
  const validation = validateProviderAdapterRegistry(manifests);
  return {
    kind: "knowmesh.providerAdapterManifestSummary",
    contractVersion,
    total: manifests.length,
    localFirst: manifests.filter((item) => item.privacyBoundary?.dataLeavesDevice === false).length,
    external: manifests.filter((item) => item.execution?.mode === "external").length,
    disabled: manifests.filter((item) => item.execution?.mode === "disabled").length,
    byKind: countBy(manifests, (item) => item.kind || "unknown"),
    validation
  };
}

export function validateProviderAdapterRegistry(manifests = builtinProviderAdapterManifests()) {
  const errors = [];
  const seen = new Set();
  for (const manifest of manifests) {
    const id = String(manifest?.id || "");
    if (!id) {
      errors.push(error("missing_id", "id", "Provider adapter manifest id is required."));
    } else if (seen.has(id)) {
      errors.push(error("duplicate_id", "id", `Duplicate provider adapter manifest id: ${id}.`));
    }
    seen.add(id);
    errors.push(...validateProviderAdapterManifest(manifest).errors);
  }
  return {
    ok: errors.length === 0,
    errors
  };
}

export function validateProviderAdapterManifest(manifest = {}) {
  const errors = [];
  const contract = providerAdapterManifestContract();
  for (const field of contract.requiredFields) {
    if (manifest[field] === undefined || manifest[field] === null) {
      errors.push(error("missing_field", field, `Missing provider adapter manifest field: ${field}.`));
    }
  }

  if (manifest.kind && !adapterKinds.includes(manifest.kind)) {
    errors.push(error("unknown_kind", "kind", `Unknown provider adapter kind: ${manifest.kind}.`));
  }

  if (manifest.lifecycle?.stage && !lifecycleStages.includes(manifest.lifecycle.stage)) {
    errors.push(error("unknown_lifecycle_stage", "lifecycle.stage", `Unknown provider adapter lifecycle stage: ${manifest.lifecycle.stage}.`));
  }

  if (manifest.execution?.mode && !executionModes.includes(manifest.execution.mode)) {
    errors.push(error("unknown_execution_mode", "execution.mode", `Unknown provider adapter execution mode: ${manifest.execution.mode}.`));
  }

  if (hasWildcardPermission(manifest.permissions)) {
    errors.push(error("wildcard_permission", "permissions", "Provider adapter permissions must be least-privilege and cannot use wildcards."));
  }

  if (hasDirectCatalogWrite(manifest.storageBoundary)) {
    errors.push(error("direct_catalog_sqlite", "storageBoundary", "Provider adapters must write through Core writer APIs, not direct catalog storage."));
  }

  if (manifest.execution?.mode === "external" && manifest.execution.dryRunSupported !== true) {
    errors.push(error("external_dry_run_missing", "execution.dryRunSupported", "External provider adapters must expose dry-run diagnostics before execution."));
  }

  if (manifest.execution?.mode === "external" && (manifest.execution.requiresExplicitUserAction !== true || manifest.execution.externalCallsBeforeDryRun === true)) {
    errors.push(error("implicit_external_call", "execution", "External provider adapters cannot make implicit calls before an explicit dry-run/user action."));
  }

  if (!Array.isArray(manifest.docs) || manifest.docs.length === 0) {
    errors.push(error("missing_docs", "docs", "Provider adapter manifests must link contributor-facing docs."));
  }

  if (!Array.isArray(manifest.requiredTests) || manifest.requiredTests.length === 0) {
    errors.push(error("missing_required_tests", "requiredTests", "Provider adapter manifests must name required tests."));
  }

  if (hasPrivateFixture(manifest.fixtures)) {
    errors.push(error("private_fixture", "fixtures", "Provider adapter fixtures must be public and safe to package."));
  }

  if (isUnsafeLifecycleGraduation(manifest)) {
    errors.push(error("unsafe_lifecycle_graduation", "lifecycle", "Certified or official provider adapters must declare graduation criteria and required tests."));
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function localCatalogManifest() {
  return manifest({
    id: "local-catalog",
    kind: "catalog",
    lifecycle: officialLifecycle("0.1.0-alpha", "Core catalog state is always local, migration-tested, and package-boundary reviewed."),
    capabilities: [
      capability("workspaceState", ["knowledge-base-registry", "current-selection"]),
      capability("catalogSearch", ["fts", "metadata-filter", "citation-evidence"])
    ],
    execution: localExecution({ dryRunSupported: true }),
    permissions: [],
    secretRequirements: [],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    costHints: cost(["local_cpu", "local_disk"]),
    batchLimits: batch({ mode: "sqlite-transaction", splitStrategy: "transaction-boundary" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: false }),
    checkpointPolicy: checkpoint({ required: true, scope: "transaction" }),
    storageBoundary: storageBoundary("core-catalog-api"),
    docs: ["docs/current-design.md", "docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/catalog-search.test.mjs"
    ]
  });
}

function localParserManifest() {
  return manifest({
    id: "local-parser",
    kind: "parser",
    lifecycle: certifiedLifecycle("0.1.0-alpha", "Certified while local parser fixtures, diagnostics, and package-boundary evidence stay green."),
    capabilities: [
      capability("directText", ["txt", "md", "csv", "tsv", "rtf"]),
      capability("modernOffice", ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"]),
      capability("legacyOfficeReview", ["doc", "xls", "ppt", "wps", "et", "dps"])
    ],
    execution: localExecution({ dryRunSupported: true }),
    permissions: [],
    secretRequirements: [],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    costHints: cost(["local_cpu", "local_disk"]),
    batchLimits: batch({ mode: "file-queue", splitStrategy: "by-source-file" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: false }),
    checkpointPolicy: checkpoint({ required: true, scope: "source-file" }),
    storageBoundary: storageBoundary("core-extraction-writer-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/execution/parser-provider.test.mjs"
    ]
  });
}

function localVectorSidecarManifest() {
  return manifest({
    id: "local-vector-sidecar",
    kind: "vector-store",
    lifecycle: certifiedLifecycle("0.2.0-searchable", "Certified as an optional accelerator only while catalog fallback tests pass."),
    capabilities: [
      capability("localVectorSidecar", ["chunk-id", "dimension", "checksum", "sidecar-uri"]),
      capability("catalogFallback", ["missing", "stale", "dimension-mismatch", "disabled"])
    ],
    execution: localExecution({ dryRunSupported: true }),
    permissions: [],
    secretRequirements: [],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: true }),
    costHints: cost(["local_cpu", "local_disk", "optional_gpu"]),
    batchLimits: batch({ mode: "optional-sidecar", splitStrategy: "by-chunk-batch" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: false }),
    checkpointPolicy: checkpoint({ required: true, scope: "index-record-batch" }),
    storageBoundary: storageBoundary("core-index-record-writer-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/retrieval-manifests.test.mjs",
      "src/local-service/query-runtime.test.mjs"
    ]
  });
}

function localOcrManifest() {
  return manifest({
    id: "local-ocr",
    kind: "ocr",
    lifecycle: experimentalLifecycle("0.5.0-provider-adapters", "Graduates after local OCR dependency checks, page-queue checkpoints, and browser diagnostics are release-gated."),
    capabilities: [
      capability("localOcr", ["pdf-page", "image", "scan"]),
      capability("localLayoutReview", ["table", "formula", "layout"])
    ],
    execution: localExecution({ dryRunSupported: true }),
    permissions: [],
    secretRequirements: [],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    costHints: cost(["local_cpu", "local_disk", "optional_gpu"]),
    batchLimits: batch({ mode: "page-queue", splitStrategy: "by-page" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: false }),
    checkpointPolicy: checkpoint({ required: true, scope: "ocr-page" }),
    storageBoundary: storageBoundary("core-ocr-writer-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/execution/ocr-provider.test.mjs",
      "src/local-service/provider-capabilities.test.mjs"
    ]
  });
}

function aliyunOssManifest() {
  return manifest({
    id: "aliyun-oss",
    kind: "object-store",
    lifecycle: experimentalLifecycle("0.5.0-provider-adapters", "Graduates after dry-run diagnostics, least-privilege review, and sidecar publication tests are release-gated."),
    capabilities: [
      capability("sourceArchive", ["put-object", "get-object", "list-objects"]),
      capability("sidecarPublish", ["publish-sidecar", "read-sidecar"])
    ],
    execution: externalExecution(),
    permissions: ["oss:ListBuckets", "oss:GetBucketInfo", "oss:GetObject", "oss:PutObject", "oss:ListObjects"],
    secretRequirements: [
      secret("ALIYUN_ACCESS_KEY_ID", "local-secure-files-only"),
      secret("ALIYUN_ACCESS_KEY_SECRET", "local-secure-files-only")
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: true, storesVectors: false }),
    costHints: cost(["storage_gb_month", "request_count", "egress_if_applicable"]),
    batchLimits: batch({ mode: "bounded-object-upload", splitStrategy: "by-object" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: true }),
    checkpointPolicy: checkpoint({ required: true, scope: "object-key" }),
    storageBoundary: storageBoundary("core-source-archive-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/execution/source-archive.test.mjs"
    ]
  });
}

function dashscopeOcrManifest() {
  return manifest({
    id: "dashscope-ocr",
    kind: "ocr",
    lifecycle: experimentalLifecycle("0.5.0-provider-adapters", "Graduates after dry-run page counts, model selection, cost warnings, and no-secret diagnostics are release-gated."),
    capabilities: [
      capability("documentOcr", ["pdf-page", "image", "layout"]),
      capability("ocrDryRun", ["page-count", "model-id", "cost-risk"])
    ],
    execution: externalExecution({ writesRemoteState: false }),
    permissions: ["dashscope:MultiModalConversation"],
    secretRequirements: [
      secret("DASHSCOPE_API_KEY", "local-secure-files-only")
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: false, storesVectors: false }),
    costHints: cost(["model_calls", "input_tokens", "output_tokens", "ocr_pages"]),
    batchLimits: batch({ mode: "provider-batch-first", splitStrategy: "by-page-and-size" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: true }),
    checkpointPolicy: checkpoint({ required: true, scope: "ocr-page-batch" }),
    storageBoundary: storageBoundary("core-ocr-writer-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/execution/ocr-provider.test.mjs",
      "src/local-service/provider-capabilities.test.mjs"
    ]
  });
}

function aliyunOssVectorManifest() {
  return manifest({
    id: "aliyun-oss-vector",
    kind: "vector-store",
    lifecycle: experimentalLifecycle("0.5.0-provider-adapters", "Graduates after vector dry-runs, index consistency checks, and catalog fallback tests are release-gated."),
    capabilities: [
      capability("vectorWrite", ["put-vector-index", "put-vectors"]),
      capability("vectorQuery", ["query-vectors"]),
      capability("indexConsistency", ["dimension", "embedding-model", "namespace"])
    ],
    execution: externalExecution(),
    permissions: ["oss:ListVectorBuckets", "oss:PutVectorBucket", "oss:PutVectorIndex", "oss:PutVectors", "oss:QueryVectors"],
    secretRequirements: [
      secret("ALIYUN_ACCESS_KEY_ID", "local-secure-files-only"),
      secret("ALIYUN_ACCESS_KEY_SECRET", "local-secure-files-only")
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: false, storesVectors: true }),
    costHints: cost(["vector_storage", "vector_writes", "vector_queries"]),
    batchLimits: batch({ mode: "provider-batch-first", splitStrategy: "split-and-retry" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: true }),
    checkpointPolicy: checkpoint({ required: true, scope: "vector-batch" }),
    storageBoundary: storageBoundary("core-index-record-writer-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/retrieval-manifests.test.mjs",
      "src/local-service/query-runtime.test.mjs"
    ]
  });
}

function dashscopeEmbeddingManifest() {
  return manifest({
    id: "dashscope-embedding",
    kind: "embedding",
    lifecycle: experimentalLifecycle("0.5.0-provider-adapters", "Graduates after batch limits, dry-runs, checkpoint recovery, and no-secret diagnostics are release-gated."),
    capabilities: [
      capability("embeddingBatch", ["chunk-text", "model-id", "dimension"]),
      capability("batchRecovery", ["batch-id", "retryable-status", "checkpoint"])
    ],
    execution: externalExecution(),
    permissions: ["dashscope:Embeddings"],
    secretRequirements: [
      secret("DASHSCOPE_API_KEY", "local-secure-files-only")
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: false, storesVectors: false }),
    costHints: cost(["model_calls", "input_tokens"]),
    batchLimits: batch({ mode: "provider-batch-first", splitStrategy: "by-token-and-count" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: true }),
    checkpointPolicy: checkpoint({ required: true, scope: "embedding-batch" }),
    storageBoundary: storageBoundary("core-embedding-result-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/local-executor.test.mjs"
    ]
  });
}

function dashscopeRerankManifest() {
  return manifest({
    id: "dashscope-rerank",
    kind: "rerank",
    lifecycle: experimentalLifecycle("0.5.0-provider-adapters", "Graduates after dry-run evidence counts, citation-safe ranking metadata, and no-secret diagnostics are release-gated."),
    capabilities: [
      capability("rerankEvidence", ["query", "candidate-chunk", "citation-id"]),
      capability("rankingMetadata", ["score", "rank", "citation-safe"])
    ],
    execution: externalExecution({ writesRemoteState: false }),
    permissions: ["dashscope:Rerank"],
    secretRequirements: [
      secret("DASHSCOPE_API_KEY", "local-secure-files-only")
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: false, storesVectors: false }),
    costHints: cost(["model_calls", "input_tokens"]),
    batchLimits: batch({ mode: "provider-batch-first", splitStrategy: "by-candidate-count" }),
    retryPolicy: retry({ checkpointed: true, transientOnly: true }),
    checkpointPolicy: checkpoint({ required: true, scope: "rerank-batch" }),
    storageBoundary: storageBoundary("core-query-ranking-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md", "docs/api/query-runtime.zh-CN.md", "docs/api/query-runtime.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/execution/embedding-provider.test.mjs",
      "src/local-service/query-evidence.test.mjs"
    ]
  });
}

function noRerankFallbackManifest() {
  return manifest({
    id: "no-rerank-fallback",
    kind: "rerank",
    lifecycle: officialLifecycle("0.3.0-query-runtime", "Official while original-rank fallback remains deterministic and citation-safe."),
    capabilities: [
      capability("originalRankFallback", ["candidate-rank", "catalog-score"]),
      capability("citationSafeRanking", ["citation-id", "quality-state"])
    ],
    execution: {
      mode: "disabled",
      dryRunSupported: true,
      externalCallsBeforeDryRun: false,
      requiresExplicitUserAction: false,
      writesRemoteState: false
    },
    permissions: [],
    secretRequirements: [],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    costHints: cost(["local_cpu"]),
    batchLimits: batch({ mode: "none", splitStrategy: "not-applicable" }),
    retryPolicy: retry({ checkpointed: false, transientOnly: false }),
    checkpointPolicy: checkpoint({ required: false, scope: "not-applicable" }),
    storageBoundary: storageBoundary("core-query-ranking-api"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md", "docs/api/query-runtime.zh-CN.md", "docs/api/query-runtime.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/execution/embedding-provider.test.mjs",
      "src/local-service/query-evidence.test.mjs"
    ]
  });
}

function noProviderFallbackManifest() {
  return manifest({
    id: "no-provider-fallback",
    kind: "fallback",
    lifecycle: officialLifecycle("0.3.0-query-runtime", "Official while unsupported provider paths refuse, no-answer, or fall back to catalog evidence without weak answers."),
    capabilities: [
      capability("catalogSearchFallback", ["keyword", "metadata", "structure"]),
      capability("providerUnavailableStatus", ["refused", "no-answer", "needs-review"])
    ],
    execution: {
      mode: "disabled",
      dryRunSupported: true,
      externalCallsBeforeDryRun: false,
      requiresExplicitUserAction: false,
      writesRemoteState: false
    },
    permissions: [],
    secretRequirements: [],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    costHints: cost(["local_cpu", "local_disk"]),
    batchLimits: batch({ mode: "none", splitStrategy: "not-applicable" }),
    retryPolicy: retry({ checkpointed: false, transientOnly: false }),
    checkpointPolicy: checkpoint({ required: false, scope: "not-applicable" }),
    storageBoundary: storageBoundary("none"),
    docs: ["docs/providers.zh-CN.md", "docs/providers.en.md", "docs/api/query-runtime.zh-CN.md", "docs/api/query-runtime.en.md"],
    fixtures: ["examples/public-samples/general-docs/source/general-operations-note.md"],
    requiredTests: [
      "src/local-service/provider-adapters.test.mjs",
      "src/local-service/query-runtime.test.mjs",
      "src/local-service/query-quality-gates.test.mjs"
    ]
  });
}

function manifest(values) {
  return {
    contractVersion,
    ...values
  };
}

function capability(key, dataTypes) {
  return {
    key,
    dataTypes
  };
}

function localExecution(overrides = {}) {
  return {
    mode: "local",
    dryRunSupported: false,
    externalCallsBeforeDryRun: false,
    requiresExplicitUserAction: false,
    writesRemoteState: false,
    ...overrides
  };
}

function externalExecution(overrides = {}) {
  return {
    mode: "external",
    dryRunSupported: true,
    externalCallsBeforeDryRun: false,
    requiresExplicitUserAction: true,
    writesRemoteState: true,
    ...overrides
  };
}

function officialLifecycle(since, graduationCriteria) {
  return {
    stage: "official",
    since,
    graduationCriteria
  };
}

function certifiedLifecycle(since, graduationCriteria) {
  return {
    stage: "certified",
    since,
    graduationCriteria
  };
}

function experimentalLifecycle(since, graduationCriteria) {
  return {
    stage: "experimental",
    since,
    graduationCriteria
  };
}

function secret(key, storage) {
  return {
    key,
    storage,
    valueExposed: false
  };
}

function privacy(values) {
  return {
    redacted: true,
    ...values
  };
}

function cost(units) {
  return {
    units,
    estimateBeforeRun: true
  };
}

function batch(values) {
  return {
    maxItems: null,
    ...values
  };
}

function retry(values) {
  return {
    maxAttempts: 3,
    backoff: "bounded-exponential",
    ...values
  };
}

function checkpoint(values) {
  return values;
}

function storageBoundary(method) {
  return {
    method,
    writesCatalog: method !== "none",
    directCatalogSqlite: false,
    writesLargeBlobs: false
  };
}

function hasWildcardPermission(permissions) {
  return ensureArray(permissions).some((permission) => {
    const text = typeof permission === "string" ? permission : permission?.action || permission?.key || "";
    return text === "*" || /:\*$/.test(text) || /\*/.test(text);
  });
}

function hasDirectCatalogWrite(storage = {}) {
  if (storage.directCatalogSqlite === true) return true;
  const text = JSON.stringify(storage || {});
  if (/catalog\.sqlite|workspace\.sqlite/i.test(text)) return true;
  return storage.writesCatalog === true && !/api$/i.test(String(storage.method || ""));
}

function hasPrivateFixture(fixtures) {
  return ensureArray(fixtures).some((fixture) => /(^|\/|\\)(private|workspace|knowledge-bases|secrets|\.runtime|logs|artifacts)(\/|\\|$)/i.test(String(fixture || "")));
}

function isUnsafeLifecycleGraduation(manifest = {}) {
  const stage = manifest.lifecycle?.stage;
  if (stage !== "certified" && stage !== "official") return false;
  return !manifest.lifecycle?.graduationCriteria || !Array.isArray(manifest.requiredTests) || manifest.requiredTests.length === 0;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function error(code, path, message) {
  return {
    code,
    path,
    message
  };
}
