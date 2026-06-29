import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { findAliyunModel } from "../core/aliyun-model-catalog.mjs";

const rpcEndpoint = "sts.aliyuncs.com";
const stsVersion = "2015-04-01";
const defaultRegion = "cn-hangzhou";
const supportedRegions = new Set([
  "cn-hangzhou",
  "cn-shanghai",
  "cn-beijing",
  "cn-shenzhen",
  "cn-heyuan",
  "cn-chengdu",
  "cn-hongkong",
  "ap-southeast-1"
]);
const supportedVectorRegions = new Set([
  "cn-hangzhou",
  "cn-shanghai",
  "cn-beijing",
  "cn-shenzhen",
  "cn-qingdao",
  "cn-wulanchabu",
  "cn-hongkong",
  "ap-southeast-1",
  "ap-southeast-5",
  "eu-central-1",
  "us-west-1",
  "us-east-1"
]);

export async function checkAliyunIdentity(credentials, options = {}) {
  if (!hasCredentials(credentials)) {
    return {
      ok: false,
      checks: [check("credential", "fail", "阿里云凭证", "Aliyun credential", "还没有保存本机凭证。", "No local credential is saved yet.")]
    };
  }

  const result = await callRpc({
    endpoint: rpcEndpoint,
    action: "GetCallerIdentity",
    version: stsVersion,
    credentials,
    fetchImpl: options.fetchImpl
  });

  if (!result.ok) {
    return {
      ok: false,
      checks: [check("identity", "fail", "阿里云身份", "Aliyun identity", friendlyCloudError(result), friendlyCloudError(result, "en"))],
      error: result.error
    };
  }

  const identity = {
    identityType: result.data.IdentityType || "",
    accountId: maskAccountId(result.data.AccountId),
    principalId: result.data.PrincipalId || "",
    arn: maskArn(result.data.Arn)
  };

  return {
    ok: true,
    identity,
    checks: [
      check(
        "identity",
        "pass",
        "阿里云身份",
        "Aliyun identity",
        `已连接 ${identity.identityType || "当前账号"}。`,
        `Connected as ${identity.identityType || "current account"}.`
      )
    ]
  };
}

export async function checkAliyunPermissions(credentials, draft = {}, options = {}) {
  const checks = [];
  const identity = await checkAliyunIdentity(credentials, options);
  checks.push(...identity.checks);

  if (!identity.ok) return { ok: false, checks };

  checks.push(ramUserCheck(identity.identity));

  const region = String(draft["aliyun.region"] || defaultRegion);
  const buckets = await listBuckets(credentials, { region, fetchImpl: options.fetchImpl });
  if (buckets.ok) {
    checks.push(check(
      "ossListBuckets",
      "pass",
      "保存空间读取权限",
      "Storage read permission",
      `可以读取当前账号的保存空间。`,
      "Can read storage spaces in the current account."
    ));
  } else {
    checks.push(check(
      "ossListBuckets",
      "fail",
      "保存空间读取权限",
      "Storage read permission",
      friendlyCloudError(buckets, "zh", "需要授予读取保存空间列表的权限。"),
      friendlyCloudError(buckets, "en", "Grant permission to read the storage-space list.")
    ));
  }

  return {
    ok: checks.every((item) => item.status !== "fail"),
    identity: identity.identity,
    checks
  };
}

export async function checkAliyunStorage(credentials, draft = {}, options = {}) {
  const locations = resolveStorageLocations(draft);
  const checks = [
    validateRegion(locations.source.region, "sourceRegion", "资料地域", "Source region"),
    validateBucketName(locations.source.bucket, {
      key: "sourceBucketName",
      labelZh: "资料 Bucket 名称",
      labelEn: "Source bucket name"
    })
  ];

  if (locations.search.mode === "separate-region") {
    checks.push(validateVectorRegion(locations.search.region, "searchRegion", "检索/向量地域", "Search/vector region"));
  } else {
    const regionCheck = validateVectorRegion(locations.search.region, "searchRegion", "检索/向量地域", "Search/vector region");
    checks.push(check(
      "searchRegion",
      regionCheck.status,
      "检索/向量地域",
      "Search/vector region",
      regionCheck.status === "pass" ? `跟随资料地域 ${locations.source.region}。` : regionCheck.message.zh,
      regionCheck.status === "pass" ? `Follows source region ${locations.source.region}.` : regionCheck.message.en
    ));
  }

  checks.push(validateVectorBucketName(locations.search.bucket, {
    key: "searchBucketName",
    labelZh: "OSS 向量 Bucket 名称",
    labelEn: "OSS vector bucket name"
  }));

  if (checks.some((item) => item.status === "fail")) {
    return { ok: false, checks, ...locations, exists: false };
  }

  if (!hasCredentials(credentials)) {
    checks.push(check("credential", "fail", "阿里云凭证", "Aliyun credential", "还没有保存本机凭证。", "No local credential is saved yet."));
    return { ok: false, checks, ...locations, exists: false };
  }

  const buckets = await listBuckets(credentials, { region: locations.source.region, fetchImpl: options.fetchImpl });
  if (!buckets.ok) {
    checks.push(cloudFailureCheck({
      key: "storageLookup",
      labelZh: "资料 Bucket 检查",
      labelEn: "Source bucket check",
      result: buckets,
      draft,
      fallbackZh: "无法读取当前账号的资料 Bucket。",
      fallbackEn: "Cannot read source buckets in the current account.",
      permission: {
        labelZh: "读取 OSS Bucket 列表",
        labelEn: "read the OSS bucket list",
        missingActions: ["oss:ListBuckets"],
        usageZh: "读取当前账号下已有的普通 OSS Bucket，判断是否需要创建新的资料 Bucket。",
        usageEn: "Reads existing standard OSS buckets in the account and decides whether a new source bucket is needed."
      }
    }));
    return { ok: false, checks, ...locations, exists: false };
  }
  const vectorBuckets = await listVectorBuckets(credentials, { region: locations.search.region, fetchImpl: options.fetchImpl });
  if (!vectorBuckets.ok) {
    checks.push(cloudFailureCheck({
      key: "vectorStorageLookup",
      labelZh: "OSS 向量 Bucket 检查",
      labelEn: "OSS vector bucket check",
      result: vectorBuckets,
      draft,
      fallbackZh: "无法读取当前账号的 OSS 向量 Bucket。",
      fallbackEn: "Cannot read OSS vector buckets in the current account.",
      permission: {
        labelZh: "读取 OSS 向量 Bucket",
        labelEn: "read OSS vector buckets",
        missingActions: ["oss:ListVectorBuckets"],
        usageZh: "读取当前账号下已有的 OSS 向量 Bucket，判断是否需要创建新的向量 Bucket。",
        usageEn: "Reads existing OSS vector buckets in the account and decides whether a new vector bucket is needed."
      }
    }));
    return { ok: false, checks, ...locations, exists: false };
  }

  const sourceFound = buckets.buckets.find((bucket) => bucket.name === locations.source.bucket);
  const searchFound = vectorBuckets.buckets.find((bucket) => bucket.name === locations.search.bucket);

  checks.push(storageBucketStateCheck({
    key: "sourceBucketLookup",
    labelZh: "资料 Bucket",
    labelEn: "Source bucket",
    bucket: locations.source.bucket,
    region: locations.source.region,
    found: sourceFound,
    action: locations.source.action
  }));

  checks.push(storageBucketStateCheck({
    key: "searchBucketLookup",
    labelZh: "OSS 向量 Bucket",
    labelEn: "OSS vector bucket",
    bucket: locations.search.bucket,
    region: locations.search.region,
    found: searchFound,
    action: "create"
  }));

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    ...locations,
    exists: Boolean(sourceFound),
    bucket: sourceFound || null,
    searchExists: Boolean(searchFound),
    searchBucket: searchFound || null
  };
}

function storageBucketStateCheck({ key, labelZh, labelEn, bucket, region, found, action }) {
  if (found) {
    const location = found.region || found.location || region;
    return check(
      key,
      "pass",
      labelZh,
      labelEn,
      `当前账号下已存在 ${bucket}，位置是 ${location}。`,
      `${bucket} already exists in the current account at ${location}.`
    );
  }
  if (action === "use-existing") {
    return check(
      key,
      "fail",
      labelZh,
      labelEn,
      `当前账号下没有找到 ${bucket}。请换一个名称，或改为创建新的 Bucket。`,
      `${bucket} was not found in the current account. Use another name or create a new bucket.`
    );
  }
  return check(
    key,
    "warn",
    labelZh,
    labelEn,
    `当前账号下没有同名 Bucket，后续创建前会再次确认 ${region} 和名称。`,
    `No same-name bucket was found in this account. Region ${region} and the name are confirmed again before creation.`
  );
}

function resolveStorageLocations(draft = {}) {
  const sourceRegion = String(draft["aliyun.region"] || "").trim();
  const sourceBucket = String(draft["aliyun.storage.bucket"] || "").trim();
  const sourceAction = String(draft["aliyun.storage.action"] || "create");
  const requestedMode = String(draft["aliyun.search.storageMode"] || "same-region");
  const mode = ["same-region", "separate-region"].includes(requestedMode) ? requestedMode : "same-region";
  const searchRegion = mode === "separate-region"
    ? String(draft["aliyun.search.region"] || "").trim()
    : sourceRegion;
  const searchBucket = String(draft["aliyun.search.bucket"] || "").trim();

  return {
    source: {
      action: sourceAction === "use-existing" ? "use-existing" : "create",
      region: sourceRegion,
      bucket: sourceBucket
    },
    search: {
      mode,
      region: searchRegion,
      bucket: searchBucket
    },
    bucketName: sourceBucket,
    region: sourceRegion
  };
}

function validateRegion(region, key, labelZh, labelEn) {
  if (!region) {
    return check(key, "fail", labelZh, labelEn, "请先选择地域。", "Choose a region first.");
  }
  if (!supportedRegions.has(region)) {
    return check(
      key,
      "fail",
      labelZh,
      labelEn,
      "请从页面提供的地域中选择。",
      "Choose a region from the list."
    );
  }
  return check(key, "pass", labelZh, labelEn, `已选择 ${region}。`, `${region} selected.`);
}

function validateVectorRegion(region, key, labelZh, labelEn) {
  if (!region) {
    return check(key, "fail", labelZh, labelEn, "请先选择地域。", "Choose a region first.");
  }
  if (!supportedVectorRegions.has(region)) {
    return check(
      key,
      "fail",
      labelZh,
      labelEn,
      "OSS 向量 Bucket 暂不支持这个地域，请选择向量 Bucket 支持的地域。",
      "OSS vector buckets do not support this region yet. Choose a supported vector-bucket region."
    );
  }
  return check(key, "pass", labelZh, labelEn, `已选择 ${region}。`, `${region} selected.`);
}

export async function previewAliyunStorage(credentials, draft = {}, options = {}) {
  const storage = await checkAliyunStorage(credentials, draft, options);
  const checks = [...storage.checks];

  if (!storage.ok) return { ok: false, checks };

  const actionText = storage.source.action === "use-existing"
    ? { zh: "使用已有保存空间", en: "Use existing storage space" }
    : { zh: "创建新的保存空间", en: "Create new storage space" };
  const searchModeText = storage.search.mode === "separate-region"
      ? { zh: "单独地域和 Bucket", en: "Separate region and bucket" }
      : { zh: "同地域，OSS 向量 Bucket", en: "Same region, OSS vector bucket" };

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    confirmation: {
      title: { zh: "云端保存位置确认", en: "Cloud Storage Confirmation" },
      summary: [
        confirmLine("资料地域", "Source region", storage.source.region, storage.source.region),
        confirmLine("资料 Bucket", "Source bucket", storage.source.bucket, storage.source.bucket),
        confirmLine("资料处理方式", "Source action", actionText.zh, actionText.en),
        confirmLine("检索/向量位置", "Search/vector location", searchModeText.zh, searchModeText.en),
        confirmLine("检索/向量地域", "Search/vector region", storage.search.region, storage.search.region),
        confirmLine("OSS 向量 Bucket", "OSS vector bucket", storage.search.bucket, storage.search.bucket)
      ],
      impacts: [
        confirmLine("会影响什么", "Impact", "资料会保存到普通 OSS Bucket，向量会保存到 OSS 向量 Bucket", "Sources are stored in a standard OSS bucket, and vectors are stored in an OSS vector bucket"),
        confirmLine("不会做什么", "What will not happen", "不会上传资料、不会删除对象、不会写入知识库", "No upload, object deletion, or knowledge-base write"),
        confirmLine("下一步", "Next step", "真正执行前还会要求你再次确认", "KnowMesh asks for confirmation again before execution")
      ],
      executionEnabled: false
    }
  };
}

export async function confirmAliyunStorage(credentials, draft = {}, options = {}) {
  const storage = await checkAliyunStorage(credentials, draft, options);
  const checks = [...storage.checks];

  if (!storage.ok) return { ok: false, checks };

  const operations = [];
  const source = await ensureStorageBucket(credentials, {
    key: "sourceBucketReady",
    labelZh: "资料 Bucket",
    labelEn: "Source bucket",
    bucket: storage.source.bucket,
    region: storage.source.region,
    found: storage.bucket,
    shouldCreate: storage.source.action === "create"
  }, options);
  checks.push(source.check);
  operations.push(source.operation);
  if (!source.ok) return storageConfirmationResult(false, checks, storage, operations);

  const search = await ensureVectorBucket(credentials, {
    key: "vectorBucketReady",
    labelZh: "OSS 向量 Bucket",
    labelEn: "OSS vector bucket",
    bucket: storage.search.bucket,
    region: storage.search.region,
    found: storage.searchBucket
  }, options);
  checks.push(search.check);
  operations.push(search.operation);

  return storageConfirmationResult(checks.every((item) => item.status !== "fail"), checks, storage, operations);
}

async function ensureStorageBucket(credentials, target, options = {}) {
  const operation = {
    key: target.key.startsWith("source") ? "source" : "search",
    action: target.found ? "bound" : "pending",
    bucket: target.bucket,
    region: target.region
  };

  if (target.found) {
    operation.action = "bound";
    return {
      ok: true,
      operation,
      check: check(
        target.key,
        "pass",
        target.labelZh,
        target.labelEn,
        `已使用当前账号下的 ${target.bucket}。`,
        `Using ${target.bucket} from the current account.`
      )
    };
  }

  if (!target.shouldCreate) {
    operation.action = "missing";
    return {
      ok: false,
      operation,
      check: check(
        target.key,
        "fail",
        target.labelZh,
        target.labelEn,
        `没有找到 ${target.bucket}，请换一个已有 Bucket 或改为创建新的 Bucket。`,
        `${target.bucket} was not found. Choose an existing bucket or create a new one.`
      )
    };
  }

  const created = await putBucket(credentials, {
    bucket: target.bucket,
    region: target.region,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs
  });

  if (created.ok) {
    operation.action = "created";
    return {
      ok: true,
      operation,
      check: check(
        target.key,
        "pass",
        target.labelZh,
        target.labelEn,
        `已创建私有 Bucket ${target.bucket}。`,
        `Created private bucket ${target.bucket}.`
      )
    };
  }

  operation.action = "failed";
  return {
    ok: false,
    operation,
    check: check(
      target.key,
      "fail",
      target.labelZh,
      target.labelEn,
      friendlyCloudError(created, "zh", `没有创建 ${target.bucket}，请检查权限或换一个名称。`),
      friendlyCloudError(created, "en", `${target.bucket} was not created. Check permission or use another name.`)
    )
  };
}

async function ensureVectorBucket(credentials, target, options = {}) {
  const operation = {
    key: "search",
    action: target.found ? "vector-bound" : "pending",
    bucket: target.bucket,
    region: target.region
  };

  if (target.found) {
    operation.action = "vector-bound";
    return {
      ok: true,
      operation,
      check: check(
        target.key,
        "pass",
        target.labelZh,
        target.labelEn,
        `已使用当前账号下的向量 Bucket ${target.bucket}。`,
        `Using vector bucket ${target.bucket} from the current account.`
      )
    };
  }

  const account = await resolveAliyunAccountId(credentials, options);
  if (!account.ok) {
    operation.action = "failed";
    return {
      ok: false,
      operation,
      check: check(
        target.key,
        "fail",
        target.labelZh,
        target.labelEn,
        friendlyCloudError(account, "zh", "没有确认阿里云账号 ID，无法创建向量 Bucket。"),
        friendlyCloudError(account, "en", "The Aliyun account ID was not confirmed, so the vector bucket was not created.")
      )
    };
  }

  const created = await putVectorBucket(credentials, {
    bucket: target.bucket,
    region: target.region,
    accountId: account.accountId,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs
  });

  if (created.ok) {
    operation.action = "vector-created";
    return {
      ok: true,
      operation,
      check: check(
        target.key,
        "pass",
        target.labelZh,
        target.labelEn,
        `已创建 OSS 向量 Bucket ${target.bucket}。`,
        `Created OSS vector bucket ${target.bucket}.`
      )
    };
  }

  operation.action = "failed";
  return {
    ok: false,
    operation,
    check: check(
      target.key,
      "fail",
      target.labelZh,
      target.labelEn,
      friendlyCloudError(created, "zh", `没有创建向量 Bucket ${target.bucket}，请检查权限或换一个名称。`),
      friendlyCloudError(created, "en", `Vector bucket ${target.bucket} was not created. Check permission or use another name.`)
    )
  };
}

function storageConfirmationResult(ok, checks, storage, operations) {
  return {
    ok,
    checks,
    storage: {
      confirmed: ok,
      operations,
      source: storage.source,
      search: storage.search
    },
    confirmation: {
      title: ok
        ? { zh: "保存位置已准备好", en: "Storage Locations Ready" }
        : { zh: "保存位置还未完成", en: "Storage Locations Not Ready" },
      summary: [
        confirmLine("资料 Bucket", "Source bucket", storage.source.bucket, storage.source.bucket),
        confirmLine("资料地域", "Source region", storage.source.region, storage.source.region),
        confirmLine("OSS 向量 Bucket", "OSS vector bucket", storage.search.bucket, storage.search.bucket),
        confirmLine("检索/向量地域", "Search/vector region", storage.search.region, storage.search.region)
      ],
      impacts: operations.map((operation) => {
        const actionText = storageOperationText(operation);
        return confirmLine(actionText.zhLabel, actionText.enLabel, actionText.zhValue, actionText.enValue);
      }),
      executionEnabled: false
    }
  };
}

function storageOperationText(operation = {}) {
  const targetZh = operation.key === "source" ? "资料保存" : "检索/向量";
  const targetEn = operation.key === "source" ? "Source storage" : "Search/vector";
  const actionZh = {
    created: "已创建",
    bound: "已绑定",
    "vector-created": "已创建向量 Bucket",
    "vector-bound": "已绑定向量 Bucket",
    missing: "未找到",
    failed: "未完成",
    pending: "待处理"
  }[operation.action] || "已处理";
  const actionEn = {
    created: "Created",
    bound: "Bound",
    "vector-created": "Created vector bucket",
    "vector-bound": "Bound vector bucket",
    missing: "Not found",
    failed: "Not completed",
    pending: "Pending"
  }[operation.action] || "Handled";

  return {
    zhLabel: targetZh,
    enLabel: targetEn,
    zhValue: `${actionZh}：${operation.bucket}`,
    enValue: `${actionEn}: ${operation.bucket}`
  };
}

export function previewAliyunSearch(draft = {}) {
  const searchName = String(draft["aliyun.search.bucket"] || "").trim();
  const indexName = String(draft["aliyun.search.index"] || "").trim();
  const action = String(draft["aliyun.search.action"] || "create");
  const embeddingModel = String(draft["aliyun.services.embedding"] || "text-embedding-v4");
  const validEmbeddingModel = findAliyunModel("embedding", embeddingModel);
  const checks = [
    textRequiredCheck("searchName", searchName, "OSS 向量 Bucket", "OSS vector bucket"),
    validateVectorIndexName(indexName, {
      key: "searchIndex",
      labelZh: "索引名称",
      labelEn: "Index name"
    }),
    check(
      "searchModelRelation",
      validEmbeddingModel ? "pass" : "fail",
      "模型关系",
      "Model relation",
      validEmbeddingModel ? `索引会按 ${embeddingModel} 的输出维度准备。` : "需要先在模型方案页选定向量化模型。",
      validEmbeddingModel ? `The index is prepared for the output dimension of ${embeddingModel}.` : "Select a valid embedding model in the model profile step first."
    )
  ];

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    confirmation: {
      title: { zh: "知识检索位置确认", en: "Knowledge Search Confirmation" },
      summary: [
        confirmLine("处理方式", "Action", action === "create" ? "创建新的索引" : "使用已有索引", action === "create" ? "Create a new index" : "Use existing index"),
        confirmLine("OSS 向量 Bucket", "OSS vector bucket", searchName || "未填写", searchName || "Not filled"),
        confirmLine("索引/版本", "Index/version", indexName || "未填写", indexName || "Not filled"),
        confirmLine("模型关系", "Model relation", `${embeddingModel} -> ${indexName || "待填写索引"}`, `${embeddingModel} -> ${indexName || "index pending"}`)
      ],
      impacts: [
        confirmLine("会影响什么", "Impact", "后续可检索知识片段会写入这个 Bucket 和索引", "Future searchable knowledge chunks are written to this bucket and index"),
        confirmLine("不会做什么", "What will not happen", "现在不会写入知识库、不会生成可检索内容", "No knowledge-base write or searchable-content creation happens now"),
        confirmLine("下一步", "Next step", "先生成过滤报告和写入预览，再确认写入", "Create a filter report and write preview before confirming writes")
      ],
      executionEnabled: false
    }
  };
}

export function previewAliyunModelProvider(draft = {}) {
  const provider = String(draft["aliyun.model.provider"] || "aliyun-bailian");
  const protocol = String(draft["aliyun.model.protocol"] || "openai-compatible");
  const region = String(draft["aliyun.model.region"] || "cn-beijing");
  const workspaceId = String(draft["aliyun.model.workspaceId"] || "").trim();
  const baseUrl = String(draft["aliyun.model.baseUrl"] || "").trim();
  const apiKey = String(draft["aliyun.model.apiKey"] || "").trim();
  const apiKeyReady = Boolean(apiKey || draft["aliyun.model.apiKey.pending"] || draft["aliyun.model.apiKey.configured"]);
  const testModel = "qwen-plus";
  const providerLabels = {
    "aliyun-bailian": { zh: "阿里百炼", en: "Alibaba Cloud Model Studio" }
  };
  const protocolLabels = {
    "openai-compatible": { zh: "OpenAI 兼容", en: "OpenAI compatible" },
    "dashscope-native": { zh: "DashScope 原生", en: "DashScope native" }
  };
  const regionLabels = {
    "cn-beijing": { zh: "中国内地（北京）", en: "Mainland China (Beijing)" },
    "ap-southeast-1": { zh: "新加坡", en: "Singapore" },
    "eu-central-1": { zh: "德国", en: "Germany" }
  };
  const requiresWorkspace = region === "ap-southeast-1" || region === "eu-central-1";
  const checks = [
    check(
      "modelProvider",
      providerLabels[provider] ? "pass" : "fail",
      "模型供应商",
      "Model provider",
      providerLabels[provider] ? `已选择${providerLabels[provider].zh}。` : "请选择支持的模型供应商。",
      providerLabels[provider] ? `${providerLabels[provider].en} is selected.` : "Choose a supported model provider."
    ),
    check(
      "modelProtocol",
      protocolLabels[protocol] ? "pass" : "fail",
      "接入方式",
      "Access mode",
      protocolLabels[protocol] ? `已选择${protocolLabels[protocol].zh}。` : "请选择接入方式。",
      protocolLabels[protocol] ? `${protocolLabels[protocol].en} is selected.` : "Choose an access mode."
    ),
    check(
      "modelRegion",
      regionLabels[region] ? "pass" : "fail",
      "服务地域",
      "Service region",
      regionLabels[region] ? `已选择${regionLabels[region].zh}。` : "请选择百炼支持的服务地域。",
      regionLabels[region] ? `${regionLabels[region].en} is selected.` : "Choose a supported Model Studio region."
    ),
    check(
      "modelWorkspace",
      requiresWorkspace && !workspaceId ? "fail" : "pass",
      "Workspace ID",
      "Workspace ID",
      requiresWorkspace && !workspaceId ? "当前地域需要填写 Workspace ID。" : "Workspace 设置可用。",
      requiresWorkspace && !workspaceId ? "This region requires a Workspace ID." : "Workspace setting is usable."
    ),
    check(
      "modelBaseUrl",
      validModelBaseUrl(baseUrl) && !baseUrl.includes("{WorkspaceId}") ? "pass" : "fail",
      "Base URL",
      "Base URL",
      validModelBaseUrl(baseUrl) && !baseUrl.includes("{WorkspaceId}") ? "Base URL 格式可用。" : "请确认 Base URL，不能留空或包含 {WorkspaceId}。",
      validModelBaseUrl(baseUrl) && !baseUrl.includes("{WorkspaceId}") ? "Base URL format is usable." : "Confirm the Base URL; it cannot be empty or contain {WorkspaceId}."
    ),
    check(
      "modelApiKey",
      apiKeyReady ? "pass" : "fail",
      "百炼 API Key",
      "Model Studio API Key",
      apiKeyReady ? "API Key 已准备好，页面不会返回明文。" : "请填写阿里百炼 API Key。",
      apiKeyReady ? "API Key is ready. The page does not echo it." : "Enter the Model Studio API Key."
    ),
    check(
      "modelSmokeTest",
      "pass",
      "连接测试",
      "Connection test",
      `系统会用 ${testModel} 做一次轻量连接测试。`,
      `${testModel} is used internally for a lightweight connection test.`
    )
  ];
  const providerLabel = providerLabels[provider] || { zh: provider || "未选择", en: provider || "Not selected" };
  const protocolLabel = protocolLabels[protocol] || { zh: protocol || "未选择", en: protocol || "Not selected" };
  const regionLabel = regionLabels[region] || { zh: region || "未选择", en: region || "Not selected" };

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    confirmation: {
      title: { zh: "模型服务连接确认", en: "Model Service Connection Confirmation" },
      summary: [
        confirmLine("模型供应商", "Model provider", providerLabel.zh, providerLabel.en),
        confirmLine("接入方式", "Access mode", protocolLabel.zh, protocolLabel.en),
        confirmLine("服务地域", "Service region", regionLabel.zh, regionLabel.en),
        confirmLine("Base URL", "Base URL", baseUrl || "未填写", baseUrl || "Not filled"),
        confirmLine("连接测试", "Connection test", `使用 ${testModel} 做轻量测试`, `Uses ${testModel} for a lightweight test`)
      ],
      impacts: [
        confirmLine("会影响什么", "Impact", "后续 OCR、内容整理、向量化和重排模型都会使用这个服务连接", "Later OCR, organization, embedding, and rerank models use this service connection"),
        confirmLine("不会做什么", "What will not happen", "现在不会上传资料、不会调用模型、不会产生费用", "No source upload, model call, or cost happens now"),
        confirmLine("下一步", "Next step", "继续选择模型与质量方案", "Continue to model and quality profile")
      ],
      executionEnabled: false
    }
  };
}

function validModelBaseUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function modelSelectionCheck(key, slotKey, value, labelZh, labelEn, passZh, passEn) {
  const selected = findAliyunModel(slotKey, value);
  return check(
    key,
    selected ? "pass" : "fail",
    labelZh,
    labelEn,
    selected ? passZh : `需要选定有效的${labelZh}。`,
    selected ? passEn : `Select a valid ${labelEn}.`
  );
}

export function previewAliyunModelQuality(draft = {}) {
  const provider = String(draft["aliyun.model.provider"] || "");
  const baseUrl = String(draft["aliyun.model.baseUrl"] || "").trim();
  const apiKey = String(draft["aliyun.model.apiKey"] || "").trim();
  const apiKeyReady = Boolean(apiKey || draft["aliyun.model.apiKey.pending"] || draft["aliyun.model.apiKey.configured"]);
  const profile = String(draft["aliyun.services.profile"] || "recommended");
  const ocr = String(draft["aliyun.services.ocr"] || "qwen-vl-ocr-2025-11-20");
  const organizer = String(draft["aliyun.services.organizer"] || "qwen-plus");
  const embedding = String(draft["aliyun.services.embedding"] || "text-embedding-v4");
  const rerank = String(draft["aliyun.services.rerank"] || "qwen3-rerank");
  const profileLabels = {
    recommended: { zh: "推荐配置", en: "Recommended" },
    "high-quality": { zh: "高质量配置", en: "High quality" },
    "low-cost": { zh: "低成本配置", en: "Lower cost" }
  };
  const profileLabel = profileLabels[profile] || { zh: profile || "未选择", en: profile || "Not selected" };
  const checks = [
    check(
      "modelProviderReady",
      provider === "aliyun-bailian" && validModelBaseUrl(baseUrl) && apiKeyReady ? "pass" : "fail",
      "模型服务",
      "Model service",
      provider === "aliyun-bailian" && validModelBaseUrl(baseUrl) && apiKeyReady ? "阿里百炼连接配置已准备好。" : "请先在上一步测试通过阿里百炼连接。",
      provider === "aliyun-bailian" && validModelBaseUrl(baseUrl) && apiKeyReady ? "Model Studio connection settings are ready." : "Test the Model Studio connection in the previous step first."
    ),
    check(
      "qualityProfile",
      profileLabels[profile] ? "pass" : "fail",
      "处理方案",
      "Processing profile",
      profileLabels[profile] ? `已选择${profileLabel.zh}。` : "请选择一个处理方案。",
      profileLabels[profile] ? `${profileLabel.en} is selected.` : "Choose a processing profile."
    ),
    modelSelectionCheck("ocrModel", "ocr", ocr, "OCR / 文档识别", "OCR / document recognition", `已选择 ${ocr}。真正调用前会展示页数和范围。`, `${ocr} is selected. Page count and scope are shown before real calls.`),
    modelSelectionCheck("organizerModel", "organizer", organizer, "内容整理模型", "organization model", `已选择 ${organizer} 处理章节、题目、表格和元数据整理。`, `${organizer} is selected for chapters, exercises, tables, and metadata.`),
    modelSelectionCheck("embeddingModel", "embedding", embedding, "向量化模型", "embedding model", `已选择 ${embedding}，下一步索引会按它的输出维度准备。`, `${embedding} is selected; the next index step uses its output dimension.`),
    modelSelectionCheck("rerankModel", "rerank", rerank, "重排模型", "rerank model", `已选择 ${rerank}，向量召回后会重新排序候选片段，提高问答命中；会增加少量延迟和模型调用费用。`, `${rerank} is selected to rerank recalled chunks, improving answer hits with some latency and model-call cost.`)
  ];

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    confirmation: {
      title: { zh: "模型与质量方案确认", en: "Model and Quality Profile Confirmation" },
      summary: [
        confirmLine("处理方案", "Processing profile", profileLabel.zh, profileLabel.en),
        confirmLine("模型服务", "Model service", "阿里百炼", "Alibaba Cloud Model Studio"),
        confirmLine("OCR / 文档识别", "OCR / document recognition", ocr, ocr),
        confirmLine("内容整理模型", "Organization model", organizer, organizer),
        confirmLine("向量化模型", "Embedding model", embedding, embedding),
        confirmLine("重排模型", "Rerank model", rerank, rerank)
      ],
      impacts: [
        confirmLine("会影响什么", "Impact", "后续 OCR、章节整理、向量化和问答检索质量会按这些配置执行", "Later OCR, organization, embedding, and retrieval quality follow these settings"),
        confirmLine("不会做什么", "What will not happen", "现在不会调用模型、不会产生费用", "No model call or cost happens now"),
        confirmLine("下一步", "Next step", "继续设置知识库索引，索引会使用已确认的向量化模型", "Continue to the knowledge index; it uses the confirmed embedding model")
      ],
      executionEnabled: false
    }
  };
}

export function previewAliyunServices(draft = {}) {
  return previewAliyunModelQuality(draft);
}

export function minimumAliyunPolicy(draft = {}) {
  const locations = resolveStorageLocations(draft);
  const region = locations.source.region || defaultRegion;
  const storageBucket = locations.source.bucket || "knowmesh-source-bucket";
  const searchSpace = locations.search.bucket || "knowmesh-vector-bucket";
  const ossResources = [
    "acs:oss:*:*:*",
    `acs:oss:*:*:${storageBucket}`,
    `acs:oss:*:*:${storageBucket}/*`
  ];
  const vectorResources = [
    "acs:ossvector:*:*:*",
    `acs:ossvector:*:*:${searchSpace}`,
    `acs:ossvector:*:*:${searchSpace}/*`
  ];
  const policy = {
    Version: "1",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "oss:ListBuckets",
          "oss:PutBucket",
          "oss:GetBucketInfo",
          "oss:GetObject",
          "oss:PutObject",
          "oss:ListObjects"
        ],
        Resource: ossResources
      },
      {
        Effect: "Allow",
        Action: [
          "oss:ListVectorBuckets",
          "oss:GetVectorBucket",
          "oss:PutVectorBucket",
          "oss:PutVectorIndex",
          "oss:GetVectorIndex",
          "oss:ListVectorIndexes",
          "oss:PutVectors",
          "oss:QueryVectors"
        ],
        Resource: vectorResources
      },
      {
        Effect: "Allow",
        Action: [
          "opensearch:List*",
          "opensearch:Describe*"
        ],
        Resource: "*"
      },
      {
        Effect: "Allow",
        Action: [
          "dashscope:Generation",
          "dashscope:Embeddings",
          "dashscope:MultiModalConversation"
        ],
        Resource: "*"
      }
    ]
  };
  const copyText = JSON.stringify(policy, null, 2);

  return {
    ok: true,
    policy,
    copyText,
    checks: [
      check(
        "leastPrivilegePolicy",
        "pass",
        "最小权限清单",
        "Least-privilege policy",
        "已生成可复制的 RAM 权限清单。",
        "A copyable RAM policy has been generated."
      ),
      check(
        "policyScope",
        "warn",
        "权限范围",
        "Permission scope",
        `请在阿里云 RAM 中绑定到 KnowMesh 专用用户，并核对地域 ${region}、资料 Bucket ${storageBucket} 和 OSS 向量 Bucket ${searchSpace}。`,
        `Bind it to the dedicated KnowMesh RAM user in Aliyun RAM, then verify region ${region}, source bucket ${storageBucket}, and OSS vector bucket ${searchSpace}.`
      )
    ],
    confirmation: {
      title: { zh: "最小权限清单确认", en: "Least-Privilege Policy Confirmation" },
      summary: [
        confirmLine("适用用户", "Applies to", "KnowMesh 专用 RAM 用户", "Dedicated KnowMesh RAM user"),
        confirmLine("资料保存空间", "Source storage", storageBucket, storageBucket),
        confirmLine("OSS 向量 Bucket", "OSS vector bucket", searchSpace, searchSpace),
        confirmLine("地域", "Region", region, region)
      ],
      impacts: [
        confirmLine("会影响什么", "Impact", "允许 KnowMesh 读取和写入指定保存空间, 并使用检索和智能服务的基础能力", "Allows KnowMesh to read/write the storage space and use basic search and smart-service capabilities"),
        confirmLine("不会做什么", "What will not happen", "不会在本地自动修改你的阿里云账号权限", "Does not automatically modify Aliyun account permissions locally"),
        confirmLine("下一步", "Next step", "复制到阿里云 RAM 权限策略后, 回到本页重新检查权限", "Copy it into Aliyun RAM, then return here and recheck access")
      ],
      executionEnabled: false
    }
  };
}

export async function callRpc(options) {
  const fetchImpl = options.fetchImpl || fetch;
  const params = {
    AccessKeyId: options.credentials.accessKeyId,
    Action: options.action,
    Format: "JSON",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: "1.0",
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: options.version,
    ...(options.params || {})
  };
  const canonical = canonicalQuery(params);
  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonical)}`;
  const signature = crypto
    .createHmac("sha1", `${options.credentials.accessKeySecret}&`)
    .update(stringToSign, "utf8")
    .digest("base64");
  const url = `https://${options.endpoint}/?${canonical}&Signature=${percentEncode(signature)}`;

  try {
    const response = await fetchWithTimeout(fetchImpl, url, { method: "GET" }, options.timeoutMs);
    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok || data.Code || data.ErrorCode) {
      return {
        ok: false,
        status: response.status,
        error: {
          code: data.Code || data.ErrorCode || String(response.status),
          message: data.Message || data.ErrorMessage || response.statusText
        }
      };
    }
    return { ok: true, data };
  } catch (error) {
    return cloudError(error);
  }
}

async function resolveAliyunAccountId(credentials, options = {}) {
  const result = await callRpc({
    endpoint: rpcEndpoint,
    action: "GetCallerIdentity",
    version: stsVersion,
    credentials,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs
  });
  if (!result.ok) return result;
  const accountId = String(result.data.AccountId || "").trim();
  if (!accountId) return cloudError(new Error("Aliyun account ID is missing from the identity response."));
  return { ok: true, accountId };
}

function ossV4Headers(credentials, options = {}) {
  const region = options.region || defaultRegion;
  const method = options.method || "GET";
  const host = options.host;
  const query = options.query || {};
  const canonicalUri = options.canonicalUri || "/";
  const timestamp = options.timestamp || new Date();
  const isoTime = timestamp.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const signDate = isoTime.slice(0, 8);
  const headers = {
    ...(options.headers || {}),
    date: timestamp.toUTCString(),
    host,
    "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
    "x-oss-date": isoTime
  };
  const additionalHeaderNames = new Set((options.additionalHeaders || []).map((item) => String(item).toLowerCase()));
  const signedHeaderNames = Object.keys(headers)
    .map((key) => key.toLowerCase())
    .filter((key) => isOssV4SignedHeader(key, additionalHeaderNames))
    .sort()
    .filter((key, index, names) => index === 0 || key !== names[index - 1]);
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const canonicalHeaders = signedHeaderNames
    .map((key) => `${key}:${String(lowerHeaders[key]).trim()}\n`)
    .join("");
  const additionalHeaders = signedHeaderNames
    .filter((key) => additionalHeaderNames.has(key))
    .join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery(query),
    canonicalHeaders,
    additionalHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const scope = `${signDate}/${region}/oss/aliyun_v4_request`;
  const stringToSign = [
    "OSS4-HMAC-SHA256",
    isoTime,
    scope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(
        hmac(`aliyun_v4${credentials.accessKeySecret}`, signDate),
        region
      ),
      "oss"
    ),
    "aliyun_v4_request"
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const additionalPart = additionalHeaders ? `,AdditionalHeaders=${additionalHeaders}` : "";
  return {
    authorization: `OSS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}${additionalPart},Signature=${signature}`,
    ...headers
  };
}

function isOssV4SignedHeader(key, additionalHeaderNames) {
  return key === "content-type"
    || key === "content-md5"
    || key.startsWith("x-oss-")
    || additionalHeaderNames.has(key);
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export async function listBuckets(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const host = `oss-${region}.aliyuncs.com`;
  const date = new Date().toUTCString();
  const stringToSign = `GET\n\n\n${date}\n/`;
  const signature = crypto
    .createHmac("sha1", credentials.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/`, {
      method: "GET",
      headers: {
        authorization: `OSS ${credentials.accessKeyId}:${signature}`,
        date,
        host
      }
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseOssError(text);
      return {
        ok: false,
        status: response.status,
        error: {
          code: parsed.Code || String(response.status),
          message: parsed.Message || response.statusText,
          requestId: parsed.RequestId || ""
        }
      };
    }
    return {
      ok: true,
      buckets: parseBuckets(text)
    };
  } catch (error) {
    return cloudError(error);
  }
}

export async function listVectorBuckets(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const host = `${region}.oss-vectors.aliyuncs.com`;
  const canonicalUri = vectorServiceCanonicalUri(region);
  const headers = ossV4Headers(credentials, {
    method: "GET",
      region,
      host,
      canonicalUri,
      query: options.prefix ? { prefix: options.prefix } : {},
      timestamp: options.timestamp
  });
  const query = options.prefix ? `?${canonicalQuery({ prefix: options.prefix })}` : "";

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/${query}`, {
      method: "GET",
      headers
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseCloudErrorPayload(text, response);
      return {
        ok: false,
        status: response.status,
        error: {
          code: parsed.Code || String(response.status),
          message: parsed.Message || response.statusText,
          requestId: parsed.RequestId || ""
        }
      };
    }
    return {
      ok: true,
      buckets: parseVectorBuckets(text)
    };
  } catch (error) {
    return cloudError(error);
  }
}

export async function putBucket(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const host = `${bucket}.oss-${region}.aliyuncs.com`;
  const date = new Date().toUTCString();
  const contentType = "application/xml";
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<CreateBucketConfiguration>",
    "<StorageClass>Standard</StorageClass>",
    "<DataRedundancyType>LRS</DataRedundancyType>",
    "</CreateBucketConfiguration>"
  ].join("");
  const stringToSign = `PUT\n\n${contentType}\n${date}\nx-oss-acl:private\n/${bucket}/`;
  const signature = crypto
    .createHmac("sha1", credentials.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/`, {
      method: "PUT",
      headers: {
        authorization: `OSS ${credentials.accessKeyId}:${signature}`,
        "content-type": contentType,
        date,
        host,
        "x-oss-acl": "private"
      },
      body
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseOssError(text);
      return {
        ok: false,
        status: response.status,
        error: {
          code: parsed.Code || String(response.status),
          message: parsed.Message || response.statusText,
          requestId: parsed.RequestId || ""
        }
      };
    }
    return { ok: true, status: response.status, bucket, region };
  } catch (error) {
    return cloudError(error);
  }
}

export async function putObject(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const objectKey = toOssObjectKey(options.objectKey || options.key || "");
  const filePath = String(options.filePath || "");
  if (!bucket) return cloudError(new Error("OSS bucket is required."));
  if (!objectKey) return cloudError(new Error("OSS object key is required."));
  if (!filePath || !fs.existsSync(filePath)) return cloudError(new Error("Source file does not exist."));

  const stat = fs.statSync(filePath);
  const host = bucket + ".oss-" + region + ".aliyuncs.com";
  const date = new Date().toUTCString();
  const contentType = options.contentType || contentTypeForObject(objectKey);
  const canonicalResource = "/" + bucket + "/" + objectKey;
  const stringToSign = "PUT\n\n" + contentType + "\n" + date + "\n" + canonicalResource;
  const signature = crypto
    .createHmac("sha1", credentials.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");
  const url = "https://" + host + "/" + encodeOssPath(objectKey);

  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "PUT",
      headers: {
        authorization: "OSS " + credentials.accessKeyId + ":" + signature,
        "content-length": String(stat.size),
        "content-type": contentType,
        date,
        host
      },
      body: fs.createReadStream(filePath),
      duplex: "half"
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseOssError(text);
      return {
        ok: false,
        status: response.status,
        error: {
          code: parsed.Code || String(response.status),
          message: parsed.Message || response.statusText,
          requestId: parsed.RequestId || ""
        }
      };
    }
    return {
      ok: true,
      status: response.status,
      bucket,
      region,
      objectKey,
      size: stat.size,
      etag: responseHeader(response, "etag")
    };
  } catch (error) {
    return cloudError(error);
  }
}

export async function getObject(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const objectKey = toOssObjectKey(options.objectKey || options.key || "");
  if (!bucket) return cloudError(new Error("OSS bucket is required."));
  if (!objectKey) return cloudError(new Error("OSS object key is required."));

  const host = bucket + ".oss-" + region + ".aliyuncs.com";
  const date = new Date().toUTCString();
  const canonicalResource = "/" + bucket + "/" + objectKey;
  const stringToSign = "GET\n\n\n" + date + "\n" + canonicalResource;
  const signature = crypto
    .createHmac("sha1", credentials.accessKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");
  const url = "https://" + host + "/" + encodeOssPath(objectKey);

  try {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "GET",
      headers: {
        authorization: "OSS " + credentials.accessKeyId + ":" + signature,
        date,
        host
      }
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseOssError(text);
      return {
        ok: false,
        status: response.status,
        error: {
          code: parsed.Code || String(response.status),
          message: parsed.Message || response.statusText,
          requestId: parsed.RequestId || ""
        }
      };
    }
    return {
      ok: true,
      status: response.status,
      bucket,
      region,
      objectKey,
      text,
      etag: responseHeader(response, "etag")
    };
  } catch (error) {
    return cloudError(error);
  }
}
export async function putVectorIndex(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const indexName = String(options.indexName || options.index || "").trim();
  const dimension = Number(options.dimension || 0);
  const distanceMetric = String(options.distanceMetric || "cosine").trim();
  if (!bucket) return cloudError(new Error("OSS vector bucket is required."));
  const indexCheck = validateVectorIndexName(indexName);
  if (indexCheck.status === "fail") return cloudError(new Error(indexCheck.message.zh));
  if (!dimension) return cloudError(new Error("OSS vector index dimension is required."));

  const account = options.accountId ? { ok: true, accountId: String(options.accountId) } : await resolveAliyunAccountId(credentials, options);
  if (!account.ok) return account;
  const host = `${bucket}-${account.accountId}.${region}.oss-vectors.aliyuncs.com`;
  const query = { putVectorIndex: "" };
  const body = JSON.stringify({
    dataType: "float32",
    dimension,
    distanceMetric,
    indexName,
    ...(options.metadata ? { metadata: options.metadata } : {})
  });
  const headers = {
    ...ossV4Headers(credentials, {
      method: "POST",
      region,
      host,
      canonicalUri: vectorBucketCanonicalUri(region, account.accountId, bucket),
      query,
      timestamp: options.timestamp,
      headers: { "content-type": "application/json" }
    })
  };

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/?putVectorIndex`, {
      method: "POST",
      headers,
      body
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseCloudErrorPayload(text, response);
      if (response.status === 409 && parsed.Code === "VectorBucketIndexAlreadyExist") {
        return { ok: true, status: response.status, bucket, region, indexName, accountId: account.accountId, existed: true, requestId: parsed.RequestId || responseHeader(response, "x-oss-request-id") };
      }
      return vectorCloudError(response, parsed);
    }
    return { ok: true, status: response.status, bucket, region, indexName, accountId: account.accountId, requestId: responseHeader(response, "x-oss-request-id") };
  } catch (error) {
    return cloudError(error);
  }
}

export async function putVectors(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const indexName = String(options.indexName || options.index || "").trim();
  const items = Array.isArray(options.items) ? options.items : [];
  if (!bucket) return cloudError(new Error("OSS vector bucket is required."));
  const indexCheck = validateVectorIndexName(indexName);
  if (indexCheck.status === "fail") return cloudError(new Error(indexCheck.message.zh));
  if (!items.length) return cloudError(new Error("No vectors to write."));

  const account = options.accountId ? { ok: true, accountId: String(options.accountId) } : await resolveAliyunAccountId(credentials, options);
  if (!account.ok) return account;
  const host = `${bucket}-${account.accountId}.${region}.oss-vectors.aliyuncs.com`;
  const query = { putVectors: "" };
  const vectors = items.map((item) => ({
    key: String(item.key || item.chunk_id || ""),
    data: { float32: item.embedding || item.vector || [] },
    ...(item.metadata ? { metadata: item.metadata } : {})
  }));
  const body = JSON.stringify({ indexName, vectors });
  const headers = {
    ...ossV4Headers(credentials, {
      method: "POST",
      region,
      host,
      canonicalUri: vectorBucketCanonicalUri(region, account.accountId, bucket),
      query,
      timestamp: options.timestamp,
      headers: { "content-type": "application/json" }
    })
  };

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/?putVectors`, {
      method: "POST",
      headers,
      body
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      return vectorCloudError(response, parseCloudErrorPayload(text, response));
    }
    return {
      ok: true,
      status: response.status,
      accountId: account.accountId,
      bucket,
      region,
      indexName,
      requestId: responseHeader(response, "x-oss-request-id"),
      count: vectors.length
    };
  } catch (error) {
    return cloudError(error);
  }
}

export async function queryVectors(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const indexName = String(options.indexName || options.index || "").trim();
  const vector = Array.isArray(options.vector || options.embedding) ? options.vector || options.embedding : [];
  const topK = Math.max(1, Math.min(100, Number(options.topK || options.limit || 5)));
  if (!bucket) return cloudError(new Error("OSS vector bucket is required."));
  const indexCheck = validateVectorIndexName(indexName);
  if (indexCheck.status === "fail") return cloudError(new Error(indexCheck.message.zh));
  if (!vector.length) return cloudError(new Error("Query vector is required."));

  const account = options.accountId ? { ok: true, accountId: String(options.accountId) } : await resolveAliyunAccountId(credentials, options);
  if (!account.ok) return account;
  const host = `${bucket}-${account.accountId}.${region}.oss-vectors.aliyuncs.com`;
  const query = { queryVectors: "" };
  const filter = normalizeVectorFilter(options.filter);
  const body = JSON.stringify({
    indexName,
    queryVector: { float32: vector },
    topK,
    ...(filter ? { filter } : {}),
    returnMetadata: options.returnMetadata !== false,
    returnDistance: options.returnDistance !== false
  });
  const headers = {
    ...ossV4Headers(credentials, {
      method: "POST",
      region,
      host,
      canonicalUri: vectorBucketCanonicalUri(region, account.accountId, bucket),
      query,
      timestamp: options.timestamp,
      headers: { "content-type": "application/json" }
    })
  };

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/?queryVectors`, {
      method: "POST",
      headers,
      body
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      return vectorCloudError(response, parseCloudErrorPayload(text, response));
    }
    const data = parseJson(text);
    const vectors = normalizeQueryVectorsResponse(data);
    return {
      ok: true,
      status: response.status,
      accountId: account.accountId,
      bucket,
      region,
      indexName,
      requestId: responseHeader(response, "x-oss-request-id"),
      count: vectors.length,
      vectors
    };
  } catch (error) {
    return cloudError(error);
  }
}

function normalizeQueryVectorsResponse(data = {}) {
  const items = Array.isArray(data.vectors)
    ? data.vectors
    : Array.isArray(data.Vectors)
      ? data.Vectors
      : Array.isArray(data.results)
        ? data.results
        : Array.isArray(data.Results)
          ? data.Results
          : [];
  return items.map((item) => ({
    key: String(item.key || item.Key || item.id || item.Id || ""),
    distance: Number(item.distance ?? item.Distance ?? item.score ?? item.Score ?? 0),
    metadata: item.metadata || item.Metadata || {}
  })).filter((item) => item.key || Object.keys(item.metadata || {}).length);
}

function normalizeVectorFilter(filter) {
  if (!filter) return null;
  if (typeof filter === "object") return filter;
  const text = String(filter).trim();
  if (!text) return null;
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  const parsed = parseJson(text);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function vectorCloudError(response, parsed = {}) {
  return {
    ok: false,
    status: response.status,
    error: {
      code: parsed.Code || String(response.status),
      message: parsed.Message || response.statusText,
      requestId: parsed.RequestId || ""
    }
  };
}

export async function putVectorBucket(credentials, options = {}) {
  if (!hasCredentials(credentials)) return cloudError(new Error("No local credential is saved yet."));
  const fetchImpl = options.fetchImpl || fetch;
  const region = options.region || defaultRegion;
  const bucket = String(options.bucket || "").trim();
  const accountId = String(options.accountId || "").trim();
  if (!accountId) return cloudError(new Error("Aliyun account ID is required to create a vector bucket."));
  const host = `${bucket}-${accountId}.${region}.oss-vectors.aliyuncs.com`;
  const canonicalUri = vectorBucketCanonicalUri(region, accountId, bucket);
  const headers = ossV4Headers(credentials, {
    method: "PUT",
    region,
    host,
    canonicalUri,
    timestamp: options.timestamp
  });

  try {
    const response = await fetchWithTimeout(fetchImpl, `https://${host}/`, {
      method: "PUT",
      headers
    }, options.timeoutMs);
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseCloudErrorPayload(text, response);
      return {
        ok: false,
        status: response.status,
        error: {
          code: parsed.Code || String(response.status),
          message: parsed.Message || response.statusText,
          requestId: parsed.RequestId || ""
        }
      };
    }
    return { ok: true, status: response.status, bucket, region };
  } catch (error) {
    return cloudError(error);
  }
}

export function validateBucketName(name, options = {}) {
  const key = options.key || "bucketName";
  const labelZh = options.labelZh || "保存空间名称";
  const labelEn = options.labelEn || "Storage-space name";
  if (!name) {
    return check(key, "fail", labelZh, labelEn, "请先填写 Bucket 名称。", "Enter a bucket name first.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
    return check(
      key,
      "fail",
      labelZh,
      labelEn,
      "名称只能使用小写字母、数字和连字符，长度 3 到 63 位，首尾不能是连字符。",
      "Use only lowercase letters, numbers, and hyphens, 3 to 63 characters, not starting or ending with a hyphen."
    );
  }
  return check(key, "pass", labelZh, labelEn, "名称格式可用。", "The name format is valid.");
}

export function validateVectorBucketName(name, options = {}) {
  const key = options.key || "vectorBucketName";
  const labelZh = options.labelZh || "向量 Bucket 名称";
  const labelEn = options.labelEn || "Vector bucket name";
  if (!name) {
    return check(key, "fail", labelZh, labelEn, "请先填写向量 Bucket 名称。", "Enter a vector bucket name first.");
  }
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(name)) {
    return check(
      key,
      "fail",
      labelZh,
      labelEn,
      "向量 Bucket 名称只能使用小写字母、数字和连字符，长度 3 到 32 位，首尾不能是连字符。",
      "Use only lowercase letters, numbers, and hyphens, 3 to 32 characters, not starting or ending with a hyphen."
    );
  }
  return check(key, "pass", labelZh, labelEn, "向量 Bucket 名称格式可用。", "The vector bucket name format is valid.");
}

export function validateVectorIndexName(name, options = {}) {
  const key = options.key || "vectorIndexName";
  const labelZh = options.labelZh || "向量索引名称";
  const labelEn = options.labelEn || "Vector index name";
  if (!name) {
    return check(key, "fail", labelZh, labelEn, "请先填写索引名称。", "Enter an index name first.");
  }
  if (!/^[A-Za-z][A-Za-z0-9]{0,62}$/.test(name)) {
    const suggestion = suggestVectorIndexName(name);
    return check(
      key,
      "fail",
      labelZh,
      labelEn,
      `索引名称必须以英文字母开头，只能使用英文字母和数字，长度 1 到 63 位。建议改为：${suggestion}。`,
      `The index name must start with a letter, use only letters and digits, and be 1 to 63 characters. Suggested: ${suggestion}.`,
      { suggestion }
    );
  }
  return check(key, "pass", labelZh, labelEn, "索引名称格式可用。", "The index name format is valid.");
}

export function suggestVectorIndexName(name) {
  const compact = String(name || "")
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 63);
  if (/^[A-Za-z]/.test(compact)) return compact || "index1";
  return `index${compact}`.slice(0, 63);
}

function toOssObjectKey(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
}

function encodeOssPath(objectKey) {
  return toOssObjectKey(objectKey).split("/").map(percentEncode).join("/");
}

function contentTypeForObject(objectKey) {
  const extension = path.extname(String(objectKey || "")).toLowerCase();
  const types = {
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jsonl": "application/x-ndjson; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  };
  return types[extension] || "application/octet-stream";
}
function hasCredentials(credentials) {
  return Boolean(credentials?.accessKeyId && credentials?.accessKeySecret);
}

function canonicalQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      if (value === "" || value === null || value === undefined) return percentEncode(key);
      return `${percentEncode(key)}=${percentEncode(value)}`;
    })
    .join("&");
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replaceAll("+", "%20")
    .replaceAll("*", "%2A")
    .replaceAll("%7E", "~");
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function parseCloudErrorPayload(text, response = null) {
  const data = parseJson(text);
  const headerCode = responseHeader(response, "x-oss-ec");
  const headerRequestId = responseHeader(response, "x-oss-request-id");
  const nestedError = data?.Error || data?.error || null;
  if (nestedError && (nestedError.Code || nestedError.Message || nestedError.RequestId || nestedError.RequestID || headerCode || headerRequestId)) {
    return {
      Code: nestedError.Code || headerCode,
      Message: nestedError.Message,
      RequestId: nestedError.RequestId || nestedError.RequestID || headerRequestId
    };
  }
  if (data && (data.Code || data.Message || data.ErrorCode || data.ErrorMessage || data.RequestId || data.requestId)) {
    return {
      Code: data.Code || data.ErrorCode,
      Message: data.Message || data.ErrorMessage,
      RequestId: data.RequestId || data.requestId
    };
  }
  if (headerCode || headerRequestId) {
    return {
      Code: headerCode,
      Message: "",
      RequestId: headerRequestId
    };
  }
  return parseOssError(text);
}

function responseHeader(response, name) {
  if (!response?.headers) return "";
  if (typeof response.headers.get === "function") return response.headers.get(name) || "";
  const lowerName = name.toLowerCase();
  return response.headers[name] || response.headers[lowerName] || "";
}

function parseBuckets(xml) {
  const buckets = [];
  const matches = String(xml).matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g);
  for (const match of matches) {
    const block = match[1];
    buckets.push({
      name: xmlValue(block, "Name"),
      location: xmlValue(block, "Location"),
      region: xmlValue(block, "Region"),
      storageClass: xmlValue(block, "StorageClass")
    });
  }
  return buckets;
}

function parseVectorBuckets(text) {
  const data = parseJson(text);
  const buckets = data?.ListAllMyBucketsResult?.Buckets || data?.Buckets || [];
  if (!Array.isArray(buckets)) return [];
  return buckets.map((bucket) => {
    const arn = String(bucket.Name || bucket.name || "");
    return {
      name: vectorBucketNameFromArn(arn),
      arn,
      location: bucket.Location || bucket.location || "",
      region: bucket.Region || bucket.region || "",
      extranetEndpoint: bucket.ExtranetEndpoint || bucket.extranetEndpoint || "",
      intranetEndpoint: bucket.IntranetEndpoint || bucket.intranetEndpoint || ""
    };
  }).filter((bucket) => bucket.name);
}

function vectorBucketNameFromArn(value) {
  const parts = String(value || "").split(":");
  return parts.length >= 5 ? parts[parts.length - 1] : String(value || "");
}

function vectorServiceCanonicalUri(region) {
  return `/${percentEncode(`acs:ossvector:${region}::`)}/`;
}

function vectorBucketCanonicalUri(region, accountId, bucket) {
  return `/${percentEncode(`acs:ossvector:${region}:${accountId}:${bucket}`)}/`;
}

function parseOssError(xml) {
  return {
    Code: xmlValue(xml, "Code"),
    Message: xmlValue(xml, "Message"),
    RequestId: xmlValue(xml, "RequestId")
  };
}

function xmlValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function cloudError(error) {
  return {
    ok: false,
    error: {
      code: error?.name === "AbortError" ? "Timeout" : "NetworkError",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}

function textRequiredCheck(key, value, zhLabel, enLabel) {
  if (value) return check(key, "pass", zhLabel, enLabel, "已填写。", "Filled.");
  return check(key, "fail", zhLabel, enLabel, "请先填写这个名称。", "Fill this name first.");
}

function confirmLine(zhLabel, enLabel, zhValue, enValue) {
  return {
    label: { zh: zhLabel, en: enLabel },
    value: { zh: zhValue, en: enValue }
  };
}

function ramUserCheck(identity = {}) {
  if (isRamUserIdentity(identity)) {
    return check(
      "ramUser",
      "pass",
      "专用 RAM 用户",
      "Dedicated RAM user",
      "当前凭证来自 RAM 用户，适合单独授权和后续轮换。",
      "The credential belongs to a RAM user and can be permissioned or rotated separately."
    );
  }
  return check(
    "ramUser",
    "fail",
    "专用 RAM 用户",
    "Dedicated RAM user",
    "请改用 KnowMesh 专用 RAM 用户，不要使用主账号或无法单独授权的身份。",
    "Use a RAM user dedicated to KnowMesh instead of a root account or an identity that cannot be permissioned separately."
  );
}

function isRamUserIdentity(identity = {}) {
  const identityType = String(identity.identityType || "");
  const arn = String(identity.arn || "");
  return /ram\s*user|ramuser/i.test(identityType) || /:user\//i.test(arn);
}

function cloudFailureCheck({ key, labelZh, labelEn, result, draft = {}, fallbackZh = "", fallbackEn = "", permission = null }) {
  const diagnostics = cloudDiagnostics(result);
  const remediation = cloudRemediation(result, { draft, permission });
  const messageZh = remediation?.summary?.zh || friendlyCloudError(result, "zh", fallbackZh);
  const messageEn = remediation?.summary?.en || friendlyCloudError(result, "en", fallbackEn);
  return check(key, "fail", labelZh, labelEn, messageZh, messageEn, { diagnostics, remediation });
}

function cloudDiagnostics(result = {}) {
  const error = result.error || {};
  return {
    status: result.status || 0,
    code: error.code || "",
    message: error.message || "",
    requestId: error.requestId || ""
  };
}

function cloudRemediation(result = {}, options = {}) {
  const code = result?.error?.code || "";
  if (/InvalidAccessKeyId|Signature/i.test(code)) {
    return {
      type: "credential",
      title: { zh: "凭证不可用", en: "Credential not usable" },
      summary: {
        zh: "AccessKey 不可用，请检查 ID 和 Secret 是否来自同一个 RAM 用户。",
        en: "The AccessKey is not usable. Check that the ID and Secret belong to the same RAM user."
      },
      steps: [
        { zh: "回到凭证页，重新粘贴 RAM 用户的 AccessKey ID 和 Secret。", en: "Go back to the credential page and paste the RAM user's AccessKey ID and Secret again." },
        { zh: "如果 Secret 已经看不到，请在阿里云 RAM 中重新创建一组 AccessKey。", en: "If the Secret is no longer visible, create a new AccessKey in Aliyun RAM." },
        { zh: "回到 KnowMesh 重新测试。", en: "Return to KnowMesh and test again." }
      ]
    };
  }
  if (isOssSignatureShapeFailure(result)) {
    return {
      type: "aliyun-signature",
      title: { zh: "阿里云请求签名未通过", en: "Aliyun request signature failed" },
      summary: {
        zh: "阿里云拒绝了本次请求签名。",
        en: "Aliyun rejected the request signature."
      },
      message: {
        zh: "先回凭证页重新测试 AccessKey；如果凭证测试通过，请更新 KnowMesh 后重试。",
        en: "First retest the AccessKey on the credential page. If that passes, update KnowMesh and retry."
      },
      steps: [
        { zh: "回到凭证页，点击测试凭证。", en: "Return to the credential page and test the credential." },
        { zh: "如果凭证测试失败，重新保存 RAM 用户 AccessKey。", en: "If the credential test fails, save a fresh RAM user AccessKey." },
        { zh: "如果凭证测试通过但本页仍失败，说明本地请求签名需要更新，先更新 KnowMesh 再重试。", en: "If the credential test passes but this page still fails, the local request signing needs an update; update KnowMesh and retry." }
      ]
    };
  }
  if (options.permission && isPermissionLikeCloudFailure(result)) {
    return aliyunPolicyRemediation(options.permission, options.draft);
  }
  if (code === "Timeout" || code === "NetworkError") {
    return {
      type: "network",
      title: { zh: "网络连接未完成", en: "Network connection did not finish" },
      summary: {
        zh: code === "Timeout" ? "连接阿里云超时，请检查网络或代理后重试。" : "无法连接阿里云，请检查网络、代理或防火墙。",
        en: code === "Timeout" ? "The Aliyun connection timed out. Check the network or proxy and retry." : "Cannot connect to Aliyun. Check the network, proxy, or firewall."
      },
      steps: [
        { zh: "确认本机能打开阿里云控制台。", en: "Confirm this computer can open the Aliyun console." },
        { zh: "如果使用代理，请确认终端和浏览器使用同一套网络配置。", en: "If a proxy is used, confirm the terminal and browser share the same network settings." },
        { zh: "网络恢复后，在 KnowMesh 中重新检查。", en: "After the network recovers, check again in KnowMesh." }
      ]
    };
  }
  if (options.permission) {
    return aliyunPolicyRemediation(options.permission, options.draft, { uncertain: true });
  }
  return null;
}

function isOssSignatureShapeFailure(result = {}) {
  const code = String(result?.error?.code || "");
  const message = String(result?.error?.message || "");
  return /^0002-000002/i.test(code) || /signature.*match|canonicalrequest/i.test(message);
}

function isPermissionLikeCloudFailure(result = {}) {
  const code = String(result?.error?.code || "");
  const status = Number(result?.status || 0);
  const message = String(result?.error?.message || "");
  return (
    /AccessDenied|Forbidden|Unauthorized|NoPermission|NotAuthorized/i.test(code)
    || status === 401
    || status === 403
    || /^40[13]$/.test(code)
    || /forbidden|unauthorized|permission|denied/i.test(message)
  );
}

function aliyunPolicyRemediation(permission, draft = {}, options = {}) {
  const policy = minimumAliyunPolicy(draft);
  const actions = Array.isArray(permission.missingActions) ? permission.missingActions : [];
  const actionText = actions.join(", ");
  return {
    type: "aliyun-ram-policy",
    title: {
      zh: options.uncertain ? "优先检查阿里云 RAM 权限" : "缺少阿里云 RAM 权限",
      en: options.uncertain ? "Check Aliyun RAM permission first" : "Missing Aliyun RAM permission"
    },
    summary: {
      zh: `当前 RAM 用户缺少${permission.labelZh} 的权限。`,
      en: `The current RAM user cannot ${permission.labelEn}.`
    },
    message: {
      zh: permission.usageZh || "给 KnowMesh 专用 RAM 用户补齐权限后，再回到这里重新检查。",
      en: permission.usageEn || "Grant the missing permission to the dedicated KnowMesh RAM user, then return and check again."
    },
    missingActions: actions,
    location: {
      zh: "阿里云 RAM 控制台 > 身份管理 > 用户 > KnowMesh 专用 RAM 用户 > 权限管理",
      en: "Aliyun RAM Console > Identities > Users > dedicated KnowMesh RAM user > Permissions"
    },
    consoleUrl: "https://ram.console.aliyun.com/users",
    copyText: policy.copyText,
    copyLabel: { zh: "复制权限清单", en: "Copy Policy" },
    openLabel: { zh: "打开 RAM 控制台", en: "Open RAM Console" },
    steps: [
      { zh: "打开阿里云 RAM 控制台，找到 KnowMesh 专用 RAM 用户。", en: "Open Aliyun RAM Console and find the dedicated KnowMesh RAM user." },
      { zh: `创建或更新自定义权限策略，确认包含 ${actionText}。`, en: `Create or update a custom policy and make sure it includes ${actionText}.` },
      { zh: "把权限策略授权给这个 RAM 用户。", en: "Attach the policy to this RAM user." },
      { zh: "回到 KnowMesh，重新检查本页。", en: "Return to KnowMesh and check this page again." }
    ]
  };
}

function friendlyCloudError(result, lang = "zh", fallback = "") {
  const code = result?.error?.code || "";
  if (code === "Timeout") {
    return lang === "zh" ? "连接阿里云超时，请检查网络或代理。" : "The Aliyun connection timed out. Check the network or proxy.";
  }
  if (code === "NetworkError") {
    return lang === "zh" ? "无法连接阿里云，请检查网络或代理。" : "Cannot connect to Aliyun. Check the network or proxy.";
  }
  if (/InvalidAccessKeyId|Signature/i.test(code)) {
    return lang === "zh" ? "凭证不可用，请检查 AccessKey ID 和 Secret。" : "The credential is not valid. Check the AccessKey ID and Secret.";
  }
  if (isOssSignatureShapeFailure(result)) {
    return lang === "zh" ? "阿里云拒绝了本次请求签名，请先重新测试凭证。" : "Aliyun rejected the request signature. Retest the credential first.";
  }
  if (/AccessDenied|Forbidden|Unauthorized/i.test(code)) {
    return fallback || (lang === "zh" ? "当前账号权限不足。" : "The current account does not have enough permission.");
  }
  return fallback || (lang === "zh" ? "检查失败，请确认凭证和网络后重试。" : "The check failed. Confirm the credential and network, then retry.");
}

function maskAccountId(value) {
  const text = String(value || "");
  if (text.length <= 6) return text;
  return `${text.slice(0, 4)}****${text.slice(-2)}`;
}

function maskArn(value) {
  return String(value || "").replace(/(user\/).+$/i, "$1****");
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage, extra = {}) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage },
    ...extra
  };
}
