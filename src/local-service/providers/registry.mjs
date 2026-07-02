import { aliyunModelStudioProviderDescriptor } from "./aliyun-model-studio.mjs";
import { aliyunOssVectorProviderDescriptor } from "./aliyun-oss-vector.mjs";
import { localOcrProviderDescriptor } from "./local-ocr.mjs";
import { localParserProviderDescriptor } from "./local-parser.mjs";
import { localVectorProviderDescriptor } from "./local-vector.mjs";

export function buildProviderRegistry(setupState = {}, options = {}) {
  const draft = {
    ...(setupState.draft || {}),
    ...(options.draft || {})
  };
  const credentialReady = Boolean(setupState.credential?.configured);
  const storageReady = credentialReady && Boolean(
    draft["aliyun.storage.confirmed"] === true
      || draft["aliyun.storage.bucket"]
      || draft["aliyun.oss.bucket"]
  );
  const modelProviderReady = Boolean(setupState.modelProvider?.configured);
  const modelQualityReady = Boolean(setupState.modelQuality?.configured);
  const searchReady = Boolean(setupState.search?.configured || (draft["aliyun.search.bucket"] && draft["aliyun.search.index"]));
  const localOptions = {
    localOcrConfigured: Boolean(options.state?.localOcrCommand || options.state?.localOcrRecognizer || draft["local.ocr.enabled"]),
    localVectorEnabled: Boolean(options.state?.localVectorEnabled || options.state?.localVectorProvider || draft["local.vector.enabled"])
  };
  const providers = [
    localCatalogProviderDescriptor(),
    localParserProviderDescriptor(),
    localOcrProviderDescriptor(localOptions),
    localVectorProviderDescriptor(localOptions),
    aliyunOssStorageProviderDescriptor({ configured: storageReady }),
    aliyunModelStudioProviderDescriptor({ configured: modelProviderReady && modelQualityReady }),
    aliyunOssVectorProviderDescriptor({ configured: credentialReady && searchReady })
  ];
  return providers.map(normalizeProviderDescriptor);
}

export function providerById(providers, id) {
  return providers.find((item) => item.id === id) || null;
}

export function providerMode(setupState = {}, draft = {}) {
  return String(draft["setup.mode"] || setupState.draft?.["setup.mode"] || setupState.mode || "").trim();
}

function localCatalogProviderDescriptor() {
  return {
    id: "local-catalog",
    type: "local-state",
    configured: true,
    status: "pass",
    label: {
      zh: "本地目录与 SQLite",
      en: "Local Catalog and SQLite"
    },
    message: {
      zh: "workspace.sqlite 与每个知识库 catalog.sqlite 始终在本机运行。",
      en: "workspace.sqlite and each knowledge-base catalog.sqlite always run locally."
    },
    capabilities: [
      capability("localCatalog", "本地目录查询", "Local catalog queries", ["workspace.sqlite", "catalog.sqlite"]),
      capability("catalogSearch", "Catalog / FTS 检索", "Catalog / FTS search", ["catalog.sqlite", "FTS5"])
    ],
    setupRequirements: [
      requirement("workspaceSqlite", "workspace.sqlite 可写", "workspace.sqlite is writable", true),
      requirement("catalogSqlite", "每个知识库 catalog.sqlite 可写", "Each knowledge-base catalog.sqlite is writable", true)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    cost: cost(["local_cpu", "local_disk"]),
    batch: batch({ supported: true, mode: "sqlite-transaction", fallback: "transaction-rollback" }),
    retry: retry({ transientOnly: false, checkpointed: true }),
    permissions: [],
    userFixableErrors: [
      fix("workspaceLocked", "关闭占用 workspace.sqlite 的进程后重试。", "Close the process locking workspace.sqlite and retry."),
      fix("catalogMigrationFailed", "查看迁移错误并修复 catalog.sqlite 所在目录权限。", "Review migration errors and fix permissions for the catalog.sqlite folder.")
    ]
  };
}

function aliyunOssStorageProviderDescriptor({ configured }) {
  return {
    id: "aliyun-oss-storage",
    type: "cloud-storage",
    configured,
    status: configured ? "pass" : "setupRequired",
    label: {
      zh: "阿里云 OSS 资料保存",
      en: "Alibaba Cloud OSS Source Storage"
    },
    message: configured
      ? {
          zh: "资料保存空间已配置。",
          en: "Source storage is configured."
        }
      : {
          zh: "需要先确认阿里云资料保存空间。",
          en: "Confirm Alibaba Cloud source storage first."
        },
    capabilities: [
      capability("sourceArchive", "资料归档", "Source archive", ["oss:ObjectReadWrite"]),
      capability("sidecarPublish", "Sidecar 发布", "Sidecar publication", ["oss:PutObject"])
    ],
    setupRequirements: [
      requirement("aliyunCredential", "保存阿里云 RAM 用户凭证", "Save dedicated Aliyun RAM user credentials", true),
      requirement("sourceBucket", "确认资料 Bucket 和地域", "Confirm source bucket and region", true)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: true, storesVectors: false }),
    cost: cost(["storage_gb_month", "request_count", "egress_if_applicable"]),
    batch: batch({ supported: true, mode: "bounded-object-upload", fallback: "checkpoint-retry" }),
    retry: retry({ transientOnly: true, checkpointed: true }),
    permissions: ["oss:ListBuckets", "oss:PutBucket", "oss:GetBucketInfo", "oss:GetObject", "oss:PutObject", "oss:ListObjects"],
    userFixableErrors: [
      fix("bucketMissing", "检查资料 Bucket 名称、地域和账号。", "Check source bucket name, region, and account."),
      fix("permissionDenied", "给 KnowMesh 专用 RAM 用户补充 OSS 读写权限。", "Grant OSS read/write permissions to the dedicated KnowMesh RAM user.")
    ]
  };
}

function normalizeProviderDescriptor(provider) {
  return {
    ...provider,
    configured: Boolean(provider.configured),
    status: provider.status || (provider.configured ? "pass" : "setupRequired"),
    capabilities: Array.isArray(provider.capabilities) ? provider.capabilities : [],
    setupRequirements: Array.isArray(provider.setupRequirements) ? provider.setupRequirements : [],
    privacyBoundary: provider.privacyBoundary || privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    cost: provider.cost || cost([]),
    batch: provider.batch || batch({ supported: false, mode: "none", fallback: "review" }),
    retry: provider.retry || retry({ transientOnly: false, checkpointed: false }),
    permissions: Array.isArray(provider.permissions) ? provider.permissions : [],
    userFixableErrors: Array.isArray(provider.userFixableErrors) ? provider.userFixableErrors : []
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
      zh: "执行前按数据规模展示风险。",
      en: "Risk is shown before execution based on data scale."
    }
  };
}

function batch(values) {
  return values;
}

function retry(values) {
  return values;
}
