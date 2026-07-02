import { putVectorIndex, putVectors } from "../aliyun.mjs";
import { readAliyunCredentials } from "../setup-store.mjs";
import { isRetryableStatus, retryExternalProviderCall } from "./aliyun-model-studio.mjs";

export function aliyunOssVectorProviderDescriptor({ configured = false } = {}) {
  return {
    id: "aliyun-oss-vector",
    type: "cloud-vector",
    configured,
    status: configured ? "pass" : "setupRequired",
    label: {
      zh: "OSS 向量检索",
      en: "OSS Vector Search"
    },
    message: configured
      ? {
          zh: "向量 Bucket 与索引已配置。",
          en: "Vector bucket and index are configured."
        }
      : {
          zh: "需要配置 OSS 向量 Bucket 与索引。",
          en: "Configure the OSS vector bucket and index."
        },
    capabilities: [
      capability("vectorStorage", "向量写入", "Vector writes", ["PutVectors"]),
      capability("vectorSearch", "向量检索", "Vector search", ["QueryVectors"]),
      capability("vectorIndexAdmin", "向量索引准备", "Vector index preparation", ["PutVectorIndex"])
    ],
    setupRequirements: [
      requirement("aliyunCredential", "保存阿里云 RAM 用户凭证", "Save dedicated Aliyun RAM user credentials", true),
      requirement("ossVectorBucket", "配置 OSS Vector Bucket 与索引名", "Configure OSS Vector bucket and index name", true)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: false, storesVectors: true }),
    cost: cost(["vector_storage", "vector_writes", "vector_queries"]),
    batch: batch({ supported: true, mode: "provider-batch-first", fallback: "split-and-retry" }),
    retry: retry({ transientOnly: true, checkpointed: true }),
    permissions: ["oss:ListVectorBuckets", "oss:PutVectorBucket", "oss:PutVectorIndex", "oss:PutVectors", "oss:QueryVectors"],
    userFixableErrors: [
      fix("vectorBucketMissing", "检查向量 Bucket、地域和账号 ID 是否一致。", "Check whether vector bucket, region, and account ID match."),
      fix("vectorIndexInvalid", "确认索引名称、维度和 distance metric。", "Confirm index name, dimensions, and distance metric."),
      fix("permissionDenied", "给 KnowMesh 专用 RAM 用户补充 OSS Vector 权限。", "Grant OSS Vector permissions to the dedicated KnowMesh RAM user.")
    ]
  };
}

export function createAliyunOssVectorAdapter(state = {}, options = {}) {
  const retry = options.retry || { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 5000 };
  const metadataForItem = options.metadataForItem || ((item) => item.metadata || {});
  return {
    id: "aliyun-oss-vector",
    async writeBatch(request) {
      if (request.target?.provider !== "aliyun-vector") return null;
      const credentials = await readAliyunCredentials(state);
      if (!credentials?.accessKeyId || !credentials?.accessKeySecret) throw new Error("没有找到本机阿里云凭证，不能写入 OSS 向量 Bucket。");

      const dimension = request.items.find((item) => Array.isArray(item.embedding))?.embedding?.length || 0;
      if (!dimension) throw new Error("没有找到可写入的向量数据。");

      const common = {
        bucket: request.target.bucket,
        region: request.target.region,
        indexName: request.target.index,
        accountId: state.__aliyunVectorAccountId || state.aliyunAccountId || request.target.accountId || "",
        fetchImpl: state.fetchImpl,
        timeoutMs: state.indexTimeoutMs || state.cloudTimeoutMs || 60000
      };

      if (request.batchPolicy?.ensureIndex !== false) {
        const indexReady = await retryExternalProviderCall(async () => retryableCloudResult(await putVectorIndex(credentials, {
          ...common,
          dimension,
          distanceMetric: request.job?.draft?.["aliyun.search.distanceMetric"] || "cosine"
        })), retry);
        if (indexReady?.accountId) {
          state.__aliyunVectorAccountId = indexReady.accountId;
          common.accountId = indexReady.accountId;
        }
      }

      const written = await retryExternalProviderCall(async () => retryableCloudResult(await putVectors(credentials, {
        ...common,
        items: request.items.map((item) => ({
          key: item.chunk_id,
          embedding: item.embedding,
          metadata: metadataForItem(item)
        }))
      })), retry);

      if (written?.accountId) state.__aliyunVectorAccountId = written.accountId;

      if (!written.ok) {
        return request.items.map((item) => ({
          chunkId: item.chunk_id,
          status: "failed",
          providerMessage: written.error?.message || "OSS Vector 写入失败。"
        }));
      }

      return request.items.map((item) => ({
        chunkId: item.chunk_id,
        status: "written",
        remoteId: `ossvector://${request.target.bucket}/${request.target.index}/${item.chunk_id}`,
        requestId: written.requestId || ""
      }));
    }
  };
}

function retryableCloudResult(result) {
  if (!result || result.ok !== false || !isRetryableStatus(result.status)) return result;
  const message = result.error?.message || result.message || `外部服务返回 ${result.status}`;
  const error = new Error(message);
  error.status = result.status;
  error.retryable = true;
  throw error;
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
      zh: "正式执行前按片段数、维度和查询规模展示风险。",
      en: "Risk is shown before execution based on chunks, dimensions, and query scale."
    }
  };
}

function batch(values) {
  return values;
}

function retry(values) {
  return {
    networkOnly: true,
    ...values
  };
}
