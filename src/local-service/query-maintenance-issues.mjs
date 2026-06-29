import { createHash } from "node:crypto";

import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

const nonMaintenanceStatuses = new Set(["invalid_request", "out_of_scope", "runtime_error"]);

export function recordQueryMaintenanceIssue(state, result = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const question = String(result.request?.question || "").trim();
  if (!knowledgeBaseId || !question) return null;

  const failedGates = queryQualityChecks(result, "fail");
  const warningGates = queryQualityChecks(result, "warn");
  const status = String(result.status || result.answer?.status || "").trim();
  if (nonMaintenanceStatuses.has(status)) return null;
  if (status === "answered" && failedGates.length === 0) return null;

  const issueType = queryIssueType(status, failedGates);
  if (!issueType) return null;

  const now = nowIso();
  const questionHash = hashText(question);
  const issueId = `query-${hashText([knowledgeBaseId, issueType, questionHash, routeKey(result)].join("|")).slice(0, 20)}`;
  const existing = readExistingIssue(state, knowledgeBaseId, issueId);
  const occurrences = Number(existing.details.occurrences || 0) + 1;
  const reason = issueReason(issueType);
  const retestHref = `/kb/${knowledgeBaseId}/use/ask?question=${encodeURIComponent(question)}`;
  const reviewHref = `/kb/${knowledgeBaseId}/maintain/feedback`;
  const details = {
    ...existing.details,
    stage: "query-runtime",
    issueType,
    reason: reason.localized,
    status,
    questionHash,
    questionPreview: question.slice(0, 240),
    occurrences,
    firstSeenAt: existing.details.firstSeenAt || now,
    lastSeenAt: now,
    route: routeSummary(result),
    runtime: runtimeSummary(result),
    quality: {
      status: result.query?.quality?.status || "",
      failedGates,
      warningGates
    },
    checks: publicChecksNeedingAttention(result),
    fixes: publicFixes(result),
    retestHref,
    reviewHref
  };

  writeIssue(state, knowledgeBaseId, {
    issueId,
    targetId: questionHash,
    severity: issueSeverity(issueType, failedGates),
    status: "open",
    reason: reason.zh,
    details,
    createdAt: existing.createdAt || now,
    updatedAt: now
  });

  return {
    queued: true,
    issue: {
      id: issueId,
      targetType: "query",
      targetId: questionHash,
      status: "open",
      severity: issueSeverity(issueType, failedGates),
      reason: reason.localized,
      reviewHref,
      retestHref
    }
  };
}

function readExistingIssue(state, knowledgeBaseId, issueId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const row = db.prepare(`
      SELECT details_json, created_at
      FROM quality_issues
      WHERE issue_id = ?
    `).get(issueId);
    return row
      ? { details: parseJson(row.details_json, {}), createdAt: String(row.created_at || "") }
      : { details: {}, createdAt: "" };
  } finally {
    db.close();
  }
}

function writeIssue(state, knowledgeBaseId, issue) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    db.prepare(`
      INSERT INTO quality_issues (
        issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      ) VALUES (?, 'query', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        severity = excluded.severity,
        status = excluded.status,
        reason = excluded.reason,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at
    `).run(
      issue.issueId,
      issue.targetId,
      issue.severity,
      issue.status,
      issue.reason,
      stableJson(issue.details),
      issue.createdAt,
      issue.updatedAt
    );
  } finally {
    db.close();
  }
}

function queryIssueType(status, failedGates = []) {
  const failed = new Set(failedGates.map((item) => item.key));
  if (failed.has("displaySerialization")) return "display_serialization";
  if (failed.has("noWeakAnswer")) return "weak_answer";
  if (status === "no_evidence" || status === "no_answer" || failed.has("evidenceFound")) return "no_evidence";
  if (status === "model_unavailable") return "model_unavailable";
  if (status === "model_failed") return "model_failed";
  return failedGates.length ? "quality_gate_failed" : "";
}

function issueReason(issueType) {
  const reasons = {
    no_evidence: {
      zh: "查询没有找到可引用证据。",
      en: "The query found no citable evidence."
    },
    model_unavailable: {
      zh: "查询已有证据但缺少可用模型服务。",
      en: "The query has evidence but no usable model service."
    },
    model_failed: {
      zh: "模型服务没有完成回答生成。",
      en: "The model service did not finish answer generation."
    },
    weak_answer: {
      zh: "弱答案不能计为可用回答。",
      en: "A weak answer cannot count as usable."
    },
    display_serialization: {
      zh: "回答展示出现序列化错误。",
      en: "Answer display contains a serialization error."
    },
    quality_gate_failed: {
      zh: "查询结果没有通过质量闸门。",
      en: "The query result failed quality gates."
    }
  };
  const reason = reasons[issueType] || reasons.quality_gate_failed;
  return {
    zh: reason.zh,
    en: reason.en,
    localized: { zh: reason.zh, en: reason.en }
  };
}

function issueSeverity(issueType, failedGates = []) {
  if (issueType === "display_serialization" || issueType === "weak_answer") return "fail";
  if (failedGates.length > 1) return "review";
  return "review";
}

function queryQualityChecks(result, status) {
  const checks = Array.isArray(result.query?.quality?.checks) ? result.query.quality.checks : [];
  return checks
    .filter((item) => item?.status === status)
    .map((item) => ({
      key: String(item.key || ""),
      status: String(item.status || ""),
      label: localizedCopy(item.label),
      message: localizedCopy(item.message)
    }))
    .filter((item) => item.key);
}

function publicChecksNeedingAttention(result) {
  const checks = Array.isArray(result.checks) ? result.checks : [];
  return checks
    .filter((item) => item?.status && item.status !== "pass")
    .map((item) => ({
      key: String(item.key || ""),
      status: String(item.status || ""),
      label: localizedCopy(item.label),
      message: localizedCopy(item.message)
    }))
    .filter((item) => item.key)
    .slice(0, 12);
}

function publicFixes(result) {
  const fixes = Array.isArray(result.fixes) ? result.fixes : [];
  return fixes
    .map((item) => ({
      key: String(item.key || ""),
      step: String(item.step || ""),
      label: localizedCopy(item.label),
      message: localizedCopy(item.message)
    }))
    .filter((item) => item.key || item.step)
    .slice(0, 8);
}

function routeSummary(result = {}) {
  const plan = result.query?.plan || {};
  const retrieval = result.query?.retrieval || {};
  const understanding = result.query?.understanding || {};
  return {
    domain: String(understanding.kind || ""),
    intent: String(plan.route?.intent || retrieval.route || ""),
    key: routeKey(result),
    source: String(retrieval.source || result.runtime?.source?.kind || ""),
    acceptedCitations: Number(retrieval.acceptedCitations || 0),
    rejectedCitations: Number(retrieval.rejectedCitations || 0)
  };
}

function routeKey(result = {}) {
  const plan = result.query?.plan || {};
  const retrieval = result.query?.retrieval || {};
  return String(plan.route?.source || retrieval.source || result.runtime?.source?.kind || "query");
}

function runtimeSummary(result = {}) {
  return {
    status: String(result.status || ""),
    source: String(result.runtime?.source?.kind || ""),
    citationCount: Array.isArray(result.citations) ? result.citations.length : 0
  };
}

function localizedCopy(value) {
  if (!value || typeof value !== "object") return { zh: String(value || ""), en: String(value || "") };
  return {
    zh: String(value.zh || value.en || ""),
    en: String(value.en || value.zh || "")
  };
}

function hashText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}
