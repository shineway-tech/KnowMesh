import crypto from "node:crypto";

export function buildQualityLifecycle(records, context = {}) {
  const datasetVersionId = context.datasetVersionId || buildDatasetVersionId(context);
  const assessedRecords = records.map((record) => assessRecord(record, context, datasetVersionId));
  const activeRecords = assessedRecords.filter((record) => record.quality.writeEnabled);
  const archiveRecords = assessedRecords.filter((record) => record.quality.tier === "archive");
  const reviewRecords = assessedRecords.filter((record) => !record.quality.writeEnabled);
  return {
    datasetVersionId,
    records: assessedRecords,
    activeRecords,
    reviewRecords,
    archiveRecords,
    summary: {
      totalRecords: assessedRecords.length,
      activeRecords: activeRecords.length,
      primaryRecords: assessedRecords.filter((record) => record.quality.tier === "primary").length,
      weightedRecords: assessedRecords.filter((record) => record.quality.tier === "weighted").length,
      reviewRecords: reviewRecords.length,
      archiveRecords: archiveRecords.length
    }
  };
}

export function buildQualityLifecycleReport(lifecycle, context = {}) {
  return {
    kind: "knowmesh.qualityLifecycleReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    datasetVersionId: lifecycle.datasetVersionId,
    knowledgeBase: context.knowledgeBase || null,
    project: context.plan?.project || null,
    job: context.job ? { id: context.job.id, mode: context.job.mode, template: context.job.template } : null,
    summary: lifecycle.summary,
    policy: {
      primary: "直接进入当前知识库",
      weighted: "进入当前知识库, 检索时保留低权重标记",
      review: "保留到待确认队列, 默认不进入当前知识库",
      archive: "仅保留来源和处理记录, 默认不进入当前知识库"
    },
    reviewQueue: lifecycle.reviewRecords.map(reviewQueueItem),
    archiveOnly: lifecycle.archiveRecords.map(reviewQueueItem)
  };
}

function assessRecord(record, context, datasetVersionId) {
  const quality = scoreRecord(record, context);
  return {
    ...record,
    datasetVersionId,
    active: quality.writeEnabled,
    quality
  };
}

function scoreRecord(record) {
  const reasons = [];
  let score = 100;
  const text = String(record.text || "").trim();
  const metadata = record.metadata || {};

  if (text.length < 20) {
    score -= 45;
    reasons.push("内容过短, 需要确认是否是页眉、页脚、页码或残片。");
  } else if (text.length < 80) {
    score -= 18;
    reasons.push("内容较短, 检索价值可能不足。");
  }

  if (!record.sourceUri && !metadata.title) {
    score -= 12;
    reasons.push("缺少清晰来源, 后续引用可追溯性不足。");
  }

  const confidence = Number(metadata.confidence);
  if (Number.isFinite(confidence) && confidence > 0 && confidence < 0.7) {
    score -= confidence < 0.5 ? 45 : 25;
    reasons.push("OCR 置信度偏低, 需要复核识别结果。");
  }

  if (/accesskey|secret|token|password|api[-_\s]?key/i.test(text)) {
    score -= 60;
    reasons.push("疑似包含密钥或敏感信息, 默认不进入知识库。");
  }

  if (/^(页眉|页脚|目录|copyright|版权|第?\s*\d+\s*页?)$/i.test(text.replace(/\s+/g, ""))) {
    score -= 45;
    reasons.push("疑似版式噪声, 需要确认是否应删除或只保留为元数据。");
  }

  score = Math.max(0, Math.min(100, score));
  const tier = score >= 80 ? "primary" : score >= 60 ? "weighted" : score >= 35 ? "review" : "archive";
  return {
    score,
    tier,
    lifecycle: tier === "primary" || tier === "weighted" ? "active" : tier,
    writeEnabled: tier === "primary" || tier === "weighted",
    reasons: reasons.length ? reasons : ["质量检查通过。"],
    retrievalWeight: tier === "primary" ? 1 : tier === "weighted" ? 0.65 : 0
  };
}

function reviewQueueItem(record) {
  return {
    chunk_id: record.chunk_id,
    document_id: record.document_id,
    version_id: record.version_id,
    text: record.text,
    sourceUri: record.sourceUri || "",
    page_start: record.page_start || null,
    page_end: record.page_end || null,
    metadata: record.metadata || {},
    quality: record.quality
  };
}

function buildDatasetVersionId(context = {}) {
  const documents = Array.isArray(context.plan?.documents) ? context.plan.documents : [];
  const source = {
    project: context.plan?.project?.id || "",
    job: context.job?.id || "",
    versions: documents.map((item) => item.version_id).sort()
  };
  return "ds_" + crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex").slice(0, 16);
}
