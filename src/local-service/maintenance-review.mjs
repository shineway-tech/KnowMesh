import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { catalogDatabasePath, nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function maintenanceReview(state, options = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const status = normalizeStatusFilter(options.status);
  const limit = normalizeLimit(options.limit);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const allRows = db.prepare(`
      SELECT issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      FROM quality_issues
      ORDER BY updated_at DESC, issue_id ASC
    `).all();
    const rows = db.prepare(`
      SELECT issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      FROM quality_issues
      WHERE (? = 'all' OR status = ?)
      ORDER BY
        CASE status WHEN 'open' THEN 0 WHEN 'resolved' THEN 1 ELSE 2 END,
        updated_at DESC,
        issue_id ASC
      LIMIT ?
    `).all(status, status, limit);
    const review = {
      summary: summarizeQualityIssues(allRows),
      items: rows.map((row) => qualityIssueRowToItem(row, knowledgeBaseId)),
      status,
      limit,
      path: catalogDatabasePath(state, knowledgeBaseId)
    };
    return {
      ok: true,
      kind: "knowmesh.maintenanceReview",
      apiVersion: "1.0.0",
      knowledgeBaseId,
      review,
      checks: [reviewCheck(review.summary)]
    };
  } finally {
    db.close();
  }
}

export function resolveMaintenanceReviewIssue(state, input = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const issueId = String(input.id || input.issueId || "").trim();
  if (!issueId) {
    return {
      ok: false,
      error: {
        code: "missing_issue_id",
        message: "Missing maintenance review issue id."
      }
    };
  }

  const db = openCatalogDatabase(state, knowledgeBaseId);
  let issue = null;
  try {
    const row = db.prepare(`
      SELECT issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      FROM quality_issues
      WHERE issue_id = ?
    `).get(issueId);
    if (!row) {
      return {
        ok: false,
        error: {
          code: "issue_not_found",
          message: "Maintenance review issue was not found in the current knowledge base."
        }
      };
    }

    if (row.status !== "resolved") {
      const now = nowIso();
      const details = {
        ...parseJson(row.details_json, {}),
        resolution: {
          status: "resolved",
          message: String(input.message || "").trim(),
          resolvedAt: now
        }
      };
      db.prepare(`
        UPDATE quality_issues
        SET status = 'resolved', details_json = ?, updated_at = ?
        WHERE issue_id = ?
      `).run(stableJson(details), now, issueId);
      issue = qualityIssueRowToItem({ ...row, status: "resolved", details_json: stableJson(details), updated_at: now }, knowledgeBaseId);
    } else {
      issue = qualityIssueRowToItem(row, knowledgeBaseId);
    }
  } finally {
    db.close();
  }

  return {
    ok: true,
    resolved: true,
    issue,
    review: maintenanceReview(state, { status: "all", limit: 50 }).review
  };
}

function qualityIssueRowToItem(row, knowledgeBaseId) {
  const details = parseJson(row.details_json, {});
  const targetQuery = targetQueryForIssue(row, details);
  const targetHref = row.target_type === "query" && details.retestHref
    ? scopedKnowledgeBaseHref(knowledgeBaseId, details.retestHref)
    : targetQuery
    ? `/kb/${knowledgeBaseId}/maintain/documents?query=${encodeURIComponent(targetQuery)}`
    : `/kb/${knowledgeBaseId}/maintain/documents`;
  return {
    id: row.issue_id,
    targetType: row.target_type,
    targetId: row.target_id,
    severity: row.severity,
    status: row.status,
    reason: row.reason,
    details,
    resolution: details.resolution || null,
    targetHref,
    targetLabel: details.title || details.questionPreview || details.sourceUri || details.relativePath || row.target_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function summarizeQualityIssues(rows = []) {
  const summary = {
    total: rows.length,
    open: 0,
    resolved: 0,
    bySeverity: {},
    byTargetType: {}
  };
  for (const row of rows) {
    if (row.status === "resolved") summary.resolved += 1;
    else if (row.status === "open") summary.open += 1;
    summary.bySeverity[row.severity] = (summary.bySeverity[row.severity] || 0) + 1;
    summary.byTargetType[row.target_type] = (summary.byTargetType[row.target_type] || 0) + 1;
  }
  return summary;
}

function reviewCheck(summary) {
  const clear = Number(summary.open || 0) === 0;
  return {
    key: "qualityIssues",
    status: clear ? "pass" : "warn",
    label: { zh: "质量复核", en: "Quality review" },
    message: {
      zh: clear ? "没有待处理的质量复核项。" : `还有 ${summary.open} 个质量复核项待处理。`,
      en: clear ? "No quality review items are open." : `${summary.open} quality review item(s) are open.`
    }
  };
}

function targetQueryForIssue(row, details = {}) {
  if (row.target_type === "query") return String(details.questionPreview || row.target_id || "").trim();
  return String(
    details.relativePath ||
    details.sourceUri ||
    details.title ||
    details.document_id ||
    details.chunk_id ||
    row.target_id ||
    ""
  ).trim();
}

function normalizeStatusFilter(value) {
  const status = String(value || "open").trim();
  if (status === "all" || status === "resolved" || status === "open") return status;
  return "open";
}

function normalizeLimit(value) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function scopedKnowledgeBaseHref(knowledgeBaseId, href = "") {
  const value = String(href || "").trim();
  if (!value) return `/kb/${knowledgeBaseId}/maintain/documents`;
  if (value.startsWith(`/kb/${knowledgeBaseId}/`)) return value;
  if (value.startsWith("/kb/")) return value;
  const clean = value.startsWith("/") ? value : `/${value}`;
  return `/kb/${knowledgeBaseId}${clean}`;
}
