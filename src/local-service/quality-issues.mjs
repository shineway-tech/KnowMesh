import crypto from "node:crypto";

import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, stableJson } from "./storage.mjs";

export function syncCleanReviewToQualityIssues(state, review = [], context = {}) {
  const issues = (Array.isArray(review) ? review : [])
    .map((record, index) => cleanReviewIssue(record, context, index))
    .filter(Boolean);
  return replaceQualityIssues(state, issues, { ...context, stage: "clean" });
}

export function syncQualityLifecycleIssuesToCatalog(state, lifecycle = {}, context = {}) {
  const issues = (Array.isArray(lifecycle.reviewRecords) ? lifecycle.reviewRecords : [])
    .map((record, index) => lifecycleReviewIssue(record, lifecycle, context, index))
    .filter(Boolean);
  return replaceQualityIssues(state, issues, { ...context, stage: "quality-lifecycle" });
}

function replaceQualityIssues(state, issues, context = {}) {
  const knowledgeBaseId = String(context.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, issues: 0 };
  const prefix = issuePrefix(context);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const removeStageIssues = db.prepare("DELETE FROM quality_issues WHERE issue_id LIKE ?");
    const insertIssue = db.prepare(`
      INSERT INTO quality_issues (
        issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const write = db.transaction(() => {
      const now = nowIso();
      removeStageIssues.run(`${prefix}%`);
      for (const issue of uniqueIssues(issues)) {
        insertIssue.run(
          issue.issueId,
          issue.targetType,
          issue.targetId,
          issue.severity,
          issue.status,
          issue.reason,
          stableJson(issue.details),
          now,
          now
        );
      }
    });
    write();
    return { ok: true, issues: issues.length };
  } finally {
    db.close();
  }
}

function cleanReviewIssue(record = {}, context = {}, index = 0) {
  const targetId = String(record.version_id || record.document_id || record.title || `review-${index}`).trim();
  if (!targetId) return null;
  const reason = String(record.reason || record.reasonZh || record.message || "需要人工复核。");
  const details = {
    stage: "clean",
    jobId: context.job?.id || "",
    project: context.plan?.project || null,
    document_id: record.document_id || "",
    version_id: record.version_id || "",
    title: record.title || "",
    sourceType: record.sourceType || "",
    action: record.action || "",
    rule_id: record.rule_id || "",
    line_number: record.line_number || null,
    confidence: record.confidence ?? null
  };
  return {
    issueId: `${issuePrefix({ ...context, stage: "clean" })}${issueHash(targetId, reason, details)}`,
    targetType: "document",
    targetId,
    severity: "review",
    status: "open",
    reason,
    details
  };
}

function lifecycleReviewIssue(record = {}, lifecycle = {}, context = {}, index = 0) {
  const targetId = String(record.chunk_id || record.chunkId || record.document_id || `chunk-review-${index}`).trim();
  if (!targetId) return null;
  const quality = record.quality || {};
  const reasons = Array.isArray(quality.reasons) ? quality.reasons : [];
  const reason = reasons.join("；") || "质量生命周期要求人工复核。";
  const details = {
    stage: "quality-lifecycle",
    jobId: context.job?.id || "",
    datasetVersionId: lifecycle.datasetVersionId || context.datasetVersionId || "",
    document_id: record.document_id || "",
    version_id: record.version_id || "",
    chunk_id: record.chunk_id || record.chunkId || "",
    sourceUri: record.sourceUri || "",
    page_start: record.page_start ?? null,
    page_end: record.page_end ?? null,
    metadata: record.metadata || {},
    quality
  };
  return {
    issueId: `${issuePrefix({ ...context, stage: "quality-lifecycle" })}${issueHash(targetId, reason, details)}`,
    targetType: "chunk",
    targetId,
    severity: String(quality.tier || "review"),
    status: "open",
    reason,
    details
  };
}

function uniqueIssues(issues) {
  const byId = new Map();
  for (const issue of issues) {
    if (!issue?.issueId || byId.has(issue.issueId)) continue;
    byId.set(issue.issueId, issue);
  }
  return [...byId.values()];
}

function issuePrefix(context = {}) {
  const jobId = safeId(context.job?.id || context.jobId || "unscoped");
  const stage = safeId(context.stage || "quality");
  return `job:${jobId}:${stage}:`;
}

function issueHash(...parts) {
  return crypto.createHash("sha256").update(stableJson(parts)).digest("hex").slice(0, 16);
}

function safeId(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "_") || "unknown";
}
