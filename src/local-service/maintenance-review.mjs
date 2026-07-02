import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { queryFeedbackSummary, resolveQueryFeedback } from "./query-feedback.mjs";
import { catalogDatabasePath, nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function maintenanceReview(state, options = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const filters = normalizeReviewFilters(options);
  const limit = normalizeLimit(options.limit);
  const feedback = queryFeedbackSummary(state, { limit: 50 });
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const qualityRows = db.prepare(`
      SELECT issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      FROM quality_issues
      ORDER BY updated_at DESC, issue_id ASC
    `).all();
    const feedbackRows = db.prepare(`
      SELECT id, action, needs_review, resolved, question, answer_status, result_key,
             citation_ids_json, citation_refs_json, message, created_at, resolved_at
      FROM query_feedback
      WHERE needs_review = 1
      ORDER BY created_at DESC, id ASC
    `).all();
    const feedbackResolutions = db.prepare(`
      SELECT resolution_id, feedback_id, action, message, created_at
      FROM query_feedback_resolutions
      ORDER BY created_at DESC, resolution_id ASC
    `).all();
    const resolutionByFeedbackId = feedbackResolutionMap(feedbackResolutions);
    const qualityItems = qualityRows.map((row) => qualityIssueRowToItem(row, knowledgeBaseId));
    const feedbackItems = feedbackRows.map((row) => feedbackRowToReviewItem(row, resolutionByFeedbackId.get(String(row.id || "")), knowledgeBaseId));
    const allItems = [...qualityItems, ...feedbackItems].sort(sortReviewItems);
    const items = allItems.filter((item) => reviewItemMatches(item, filters)).slice(0, limit);
    const review = {
      summary: summarizeReviewItems(allItems, feedback),
      items,
      status: filters.status,
      filters,
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

  if (issueId.startsWith("feedback:")) {
    const feedbackId = issueId.slice("feedback:".length);
    const result = resolveQueryFeedback(state, {
      id: feedbackId,
      message: input.message || ""
    });
    if (!result.ok) return result;
    const review = maintenanceReview(state, { status: "all", limit: 50 }).review;
    const issue = review.items.find((item) => item.id === issueId) || feedbackRecordToResolvedIssue(result.feedback, knowledgeBaseId);
    return {
      ok: true,
      resolved: true,
      issue,
      review
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
  const issueType = String(details.issueType || details.issue_type || details.stage || row.target_type || "quality_issue").trim();
  const document = documentTarget(details);
  const page = pageTarget(details);
  return {
    id: row.issue_id,
    source: "quality_issue",
    issueType,
    targetType: row.target_type,
    targetId: row.target_id,
    severity: row.severity,
    status: row.status,
    reason: row.reason,
    details,
    resolution: details.resolution || null,
    ownerPath: details.reviewHref || targetHref,
    retestAction: retestActionForIssue(row, details, knowledgeBaseId, targetHref),
    document,
    page,
    targetHref,
    targetLabel: details.title || details.questionPreview || details.sourceUri || details.relativePath || row.target_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function feedbackRowToReviewItem(row, resolution, knowledgeBaseId) {
  const action = normalizeFeedbackAction(row.action);
  const citationRefs = parseJson(row.citation_refs_json, []);
  const citationIds = parseJson(row.citation_ids_json, []);
  const primaryCitation = citationRefs.find((item) => item && typeof item === "object") || {};
  const question = String(row.question || "").trim();
  const resolved = Boolean(row.resolved) || Boolean(resolution);
  const retestHref = question ? `/kb/${knowledgeBaseId}/use/ask?question=${encodeURIComponent(question)}` : "";
  const document = {
    id: String(primaryCitation.id || ""),
    title: String(primaryCitation.title || ""),
    path: String(primaryCitation.sourceUri || ""),
    href: String(primaryCitation.documentHref || "")
  };
  const page = {
    number: numericOrNull(primaryCitation.pageNumber),
    start: numericOrNull(primaryCitation.pageNumber),
    end: numericOrNull(primaryCitation.pageNumber)
  };
  return {
    id: `feedback:${row.id}`,
    source: "query_feedback",
    issueType: action,
    targetType: "query",
    targetId: String(row.result_key || row.id || ""),
    severity: "review",
    status: resolved ? "resolved" : "open",
    reason: feedbackReason(action),
    details: {
      stage: "query-feedback",
      issueType: action,
      questionPreview: question.slice(0, 240),
      answerStatus: String(row.answer_status || ""),
      resultKey: String(row.result_key || ""),
      citationIds,
      citationRefs
    },
    resolution: resolution ? {
      createdAt: String(resolution.created_at || ""),
      message: String(resolution.message || "")
    } : null,
    ownerPath: `/kb/${knowledgeBaseId}/maintain/feedback`,
    retestAction: {
      kind: "query",
      label: { zh: "重新提问", en: "Retest query" },
      href: retestHref,
      scope: {
        resultKey: String(row.result_key || ""),
        hasQuestion: Boolean(question)
      }
    },
    evidenceTarget: feedbackEvidenceTarget(primaryCitation),
    rerunScope: feedbackRerunScope(row, citationIds, citationRefs),
    document,
    page,
    targetHref: retestHref || `/kb/${knowledgeBaseId}/maintain/feedback`,
    targetLabel: question || String(row.result_key || row.id || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.resolved_at || resolution?.created_at || row.created_at || "")
  };
}

function feedbackRecordToResolvedIssue(feedback, knowledgeBaseId) {
  const action = normalizeFeedbackAction(feedback?.action);
  const question = String(feedback?.question || "").trim();
  return {
    id: `feedback:${feedback?.id || ""}`,
    source: "query_feedback",
    issueType: action,
    targetType: "query",
    targetId: String(feedback?.resultKey || feedback?.id || ""),
    severity: "review",
    status: "resolved",
    reason: feedbackReason(action),
    details: {
      stage: "query-feedback",
      issueType: action,
      questionPreview: question.slice(0, 240)
    },
    resolution: feedback?.resolution || null,
    ownerPath: `/kb/${knowledgeBaseId}/maintain/feedback`,
    retestAction: {
      kind: "query",
      label: { zh: "重新提问", en: "Retest query" },
      href: question ? `/kb/${knowledgeBaseId}/use/ask?question=${encodeURIComponent(question)}` : ""
    },
    document: emptyDocumentTarget(),
    page: emptyPageTarget(),
    targetHref: `/kb/${knowledgeBaseId}/maintain/feedback`,
    targetLabel: question,
    createdAt: String(feedback?.createdAt || ""),
    updatedAt: String(feedback?.resolution?.createdAt || feedback?.createdAt || "")
  };
}

function feedbackEvidenceTarget(citation = {}) {
  const pageNumber = numericOrNull(citation.pageNumber);
  const citationId = String(citation.id || citation.chunk_id || citation.chunkId || "").trim();
  return {
    kind: citationId ? "citation" : "query",
    citationId,
    title: String(citation.title || "").trim(),
    sourceUri: String(citation.sourceUri || "").trim(),
    pageNumber,
    href: String(citation.documentHref || citation.links?.document || citation.links?.documentHref || "").trim()
  };
}

function feedbackRerunScope(row = {}, citationIds = [], citationRefs = []) {
  const sourceUris = uniqueStrings(citationRefs.map((item) => item?.sourceUri));
  const pages = uniqueNumbers(citationRefs.map((item) => item?.pageNumber));
  return {
    type: "query_feedback",
    feedbackId: String(row.id || ""),
    resultKey: String(row.result_key || ""),
    citationIds: uniqueStrings([
      ...citationIds,
      ...citationRefs.map((item) => item?.id || item?.chunk_id || item?.chunkId)
    ]),
    sourceUris,
    pages
  };
}

function summarizeReviewItems(items = [], feedback = {}) {
  const summary = {
    total: items.length,
    open: 0,
    resolved: 0,
    bySeverity: {},
    byTargetType: {},
    byIssueType: {},
    bySource: {},
    signals: {
      positiveFeedback: Number(feedback.positive || 0)
    }
  };
  for (const item of items) {
    if (item.status === "resolved") summary.resolved += 1;
    else if (item.status === "open") summary.open += 1;
    summary.bySeverity[item.severity] = (summary.bySeverity[item.severity] || 0) + 1;
    summary.byTargetType[item.targetType] = (summary.byTargetType[item.targetType] || 0) + 1;
    summary.byIssueType[item.issueType] = (summary.byIssueType[item.issueType] || 0) + 1;
    summary.bySource[item.source] = (summary.bySource[item.source] || 0) + 1;
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

function normalizeReviewFilters(options = {}) {
  return {
    status: normalizeStatusFilter(options.status),
    issueType: normalizeFilterText(options.issueType || options.type),
    severity: normalizeFilterText(options.severity),
    document: normalizeFilterText(options.document || options.query),
    page: normalizeFilterText(options.page)
  };
}

function normalizeStatusFilter(value) {
  const status = String(value || "open").trim();
  if (status === "all" || status === "resolved" || status === "open") return status;
  return "open";
}

function normalizeFilterText(value) {
  return String(value || "").trim();
}

function normalizeLimit(value) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function reviewItemMatches(item, filters = {}) {
  if (filters.status !== "all" && item.status !== filters.status) return false;
  if (filters.issueType && item.issueType !== filters.issueType) return false;
  if (filters.severity && item.severity !== filters.severity) return false;
  if (filters.document && !containsText([
    item.document?.id,
    item.document?.title,
    item.document?.path,
    item.targetLabel,
    item.targetId
  ], filters.document)) return false;
  if (filters.page) {
    const expected = Number(filters.page);
    if (!Number.isFinite(expected)) return false;
    const page = item.page || {};
    const start = Number(page.start ?? page.number ?? 0);
    const end = Number(page.end ?? page.number ?? start);
    if (!Number.isFinite(start) || !Number.isFinite(end) || expected < start || expected > end) return false;
  }
  return true;
}

function containsText(values = [], needle = "") {
  const query = String(needle || "").trim().toLowerCase();
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
}

function sortReviewItems(a, b) {
  return statusRank(a.status) - statusRank(b.status)
    || severityRank(a.severity) - severityRank(b.severity)
    || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
}

function statusRank(status) {
  return status === "open" ? 0 : status === "resolved" ? 1 : 2;
}

function severityRank(severity) {
  return severity === "fail" ? 0 : severity === "review" ? 1 : severity === "warn" ? 2 : 3;
}

function retestActionForIssue(row, details, knowledgeBaseId, targetHref) {
  if (row.target_type === "query" || details.retestHref) {
    return {
      kind: "query",
      label: { zh: "重新提问", en: "Retest query" },
      href: scopedKnowledgeBaseHref(knowledgeBaseId, details.retestHref || targetHref)
    };
  }
  return {
    kind: "targeted_rerun",
    label: { zh: "创建定向重跑", en: "Create targeted rerun" },
    href: `/kb/${knowledgeBaseId}/maintain/maintenance?target=${encodeURIComponent(row.target_id || "")}`
  };
}

function documentTarget(details = {}) {
  return {
    id: String(details.document_id || details.documentId || ""),
    title: String(details.title || details.sourceTitle || ""),
    path: String(details.relativePath || details.sourceUri || details.normalized_relative_path || ""),
    href: String(details.documentHref || "")
  };
}

function pageTarget(details = {}) {
  const start = numericOrNull(details.page_start ?? details.pageStart ?? details.page_number ?? details.pageNumber);
  const end = numericOrNull(details.page_end ?? details.pageEnd ?? start);
  return {
    number: start,
    start,
    end
  };
}

function emptyDocumentTarget() {
  return { id: "", title: "", path: "", href: "" };
}

function emptyPageTarget() {
  return { number: null, start: null, end: null };
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function uniqueNumbers(values = []) {
  return [...new Set(values.map(numericOrNull).filter((item) => item !== null))];
}

function feedbackResolutionMap(rows = []) {
  const byFeedbackId = new Map();
  for (const row of rows) {
    const feedbackId = String(row.feedback_id || "").trim();
    if (feedbackId && !byFeedbackId.has(feedbackId)) byFeedbackId.set(feedbackId, row);
  }
  return byFeedbackId;
}

function normalizeFeedbackAction(value) {
  const action = String(value || "").trim();
  if (action === "wrong_citation" || action === "missed_point") return action;
  return "missed_point";
}

function feedbackReason(action) {
  return action === "wrong_citation"
    ? "用户反馈引用不正确。"
    : "用户反馈回答遗漏要点。";
}

function scopedKnowledgeBaseHref(knowledgeBaseId, href = "") {
  const value = String(href || "").trim();
  if (!value) return `/kb/${knowledgeBaseId}/maintain/documents`;
  if (value.startsWith(`/kb/${knowledgeBaseId}/`)) return value;
  if (value.startsWith("/kb/")) return value;
  const clean = value.startsWith("/") ? value : `/${value}`;
  return `/kb/${knowledgeBaseId}${clean}`;
}
