import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { currentKnowledgeBaseId, knowledgeBaseDataRoot } from "./knowledge-bases.mjs";
import { catalogDatabasePath, nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

const allowedActions = new Set(["useful", "wrong_citation", "missed_point"]);
const maintenanceActions = new Set(["wrong_citation", "missed_point"]);

export function recordQueryFeedback(state, input = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const action = normalizeAction(input.action);
  const now = nowIso();
  const needsReview = maintenanceActions.has(action);
  const record = {
    id: randomUUID(),
    kind: "knowmesh.queryFeedback",
    apiVersion: "1.0.0",
    knowledgeBaseId,
    action,
    question: String(input.question || "").trim(),
    answerStatus: String(input.answerStatus || "").trim(),
    resultKey: String(input.resultKey || "").trim(),
    citationIds: normalizeCitationIds(input.citationIds),
    citationRefs: normalizeCitationRefs(input.citationRefs || input.citations),
    message: String(input.message || "").trim(),
    createdAt: now
  };
  const db = openFeedbackDatabase(state, knowledgeBaseId);
  try {
    insertFeedbackRecord(db, record);
  } finally {
    db.close();
  }
  return {
    ok: true,
    feedback: {
      id: record.id,
      action: record.action,
      createdAt: record.createdAt,
      needsReview,
      path: catalogDatabasePath(state, knowledgeBaseId),
      reviewHref: needsReview ? `/kb/${knowledgeBaseId}/maintain/feedback` : "",
      retestHref: record.question ? `/kb/${knowledgeBaseId}/use/ask?question=${encodeURIComponent(record.question)}` : ""
    },
    checks: [{
      key: "feedback",
      status: "pass",
      label: { zh: "反馈已记录", en: "Feedback saved" },
      message: {
        zh: "这条反馈已保存到当前知识库，后续维护时可以查看。",
        en: "This feedback was saved to the current knowledge base for later maintenance."
      }
    }]
  };
}

export function queryFeedbackSummary(state, options = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const db = openFeedbackDatabase(state, knowledgeBaseId);
  let records = [];
  let resolutions = [];
  try {
    records = db.prepare(`
      SELECT id, action, question, answer_status, result_key, citation_ids_json,
             citation_refs_json, message, created_at
      FROM query_feedback
      ORDER BY created_at ASC, id ASC
    `).all().map((row) => feedbackRowToRecord(row, knowledgeBaseId));
    resolutions = db.prepare(`
      SELECT resolution_id, feedback_id, action, message, created_at
      FROM query_feedback_resolutions
      ORDER BY created_at ASC, resolution_id ASC
    `).all().map(resolutionRowToRecord);
  } finally {
    db.close();
  }
  const resolutionByFeedbackId = feedbackResolutionMap(resolutions);
  const resolvedIds = new Set(resolutionByFeedbackId.keys());
  const limit = Math.max(1, Math.min(50, Number(options.limit || 6)));
  const byAction = {
    useful: 0,
    wrong_citation: 0,
    missed_point: 0
  };
  const openByAction = {
    wrong_citation: 0,
    missed_point: 0
  };
  const openRecords = [];
  for (const record of records) {
    const action = normalizeAction(record.action);
    byAction[action] = (byAction[action] || 0) + 1;
    const resolved = resolvedIds.has(String(record.id || ""));
    if (maintenanceActions.has(action) && !resolved) {
      openByAction[action] = (openByAction[action] || 0) + 1;
      openRecords.push(record);
    }
  }
  const recent = openRecords.slice(-limit).reverse().map((record) => publicFeedbackRecord(record, { resolved: false }));
  const recentRecords = records.slice(-limit).reverse().map((record) => {
    const resolved = resolvedIds.has(String(record.id || ""));
    return publicFeedbackRecord(record, { resolved, resolution: resolutionByFeedbackId.get(String(record.id || "")) });
  });
  return {
    knowledgeBaseId,
    total: records.length,
    open: openRecords.length,
    positive: byAction.useful || 0,
    resolved: resolvedIds.size,
    byAction,
    openByAction,
    recent,
    recentRecords,
    path: catalogDatabasePath(state, knowledgeBaseId),
    resolutionPath: catalogDatabasePath(state, knowledgeBaseId)
  };
}

export function resolveQueryFeedback(state, input = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const feedbackId = String(input.id || input.feedbackId || "").trim();
  if (!feedbackId) {
    return {
      ok: false,
      error: {
        code: "missing_feedback_id",
        message: "Missing feedback id."
      }
    };
  }

  const db = openFeedbackDatabase(state, knowledgeBaseId);
  let feedback = null;
  let alreadyResolved = null;
  let insertedResolution = null;
  try {
    const row = db.prepare(`
      SELECT id, action, question, answer_status, result_key, citation_ids_json,
             citation_refs_json, message, created_at
      FROM query_feedback
      WHERE id = ?
    `).get(feedbackId);
    feedback = row ? feedbackRowToRecord(row, knowledgeBaseId) : null;
    if (!feedback) {
      return {
        ok: false,
        error: {
          code: "feedback_not_found",
          message: "Feedback was not found in the current knowledge base."
        }
      };
    }

    const action = normalizeAction(feedback.action);
    if (!maintenanceActions.has(action)) {
      return {
        ok: true,
        skipped: true,
        feedback: publicFeedbackRecord(feedback, { resolved: false }),
        message: "This feedback does not require maintenance."
      };
    }

    const existing = db.prepare(`
      SELECT resolution_id, feedback_id, action, message, created_at
      FROM query_feedback_resolutions
      WHERE feedback_id = ?
    `).get(feedbackId);
    alreadyResolved = existing ? resolutionRowToRecord(existing) : null;
    if (!alreadyResolved) {
      const now = nowIso();
      insertedResolution = {
        id: randomUUID(),
        kind: "knowmesh.queryFeedbackResolution",
        apiVersion: "1.0.0",
        knowledgeBaseId,
        feedbackId,
        action: "resolved",
        message: String(input.message || "").trim(),
        createdAt: now
      };
      const write = db.transaction(() => {
        insertFeedbackResolution(db, insertedResolution);
        db.prepare("UPDATE query_feedback SET resolved = 1, resolved_at = ? WHERE id = ?").run(now, feedbackId);
      });
      write();
    }
  } finally {
    db.close();
  }

  return {
    ok: true,
    resolved: true,
    feedback: publicFeedbackRecord(feedback, {
      resolved: true,
      resolution: alreadyResolved || insertedResolution
    }),
    summary: queryFeedbackSummary(state, { limit: 6 })
  };
}

function openFeedbackDatabase(state, knowledgeBaseId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  cleanupLegacyFeedbackFiles(state, knowledgeBaseId);
  return db;
}

function legacyQueryFeedbackPath(state, knowledgeBaseId) {
  return path.join(knowledgeBaseDataRoot(state, knowledgeBaseId), "feedback", "query-feedback.jsonl");
}

function legacyQueryFeedbackResolutionPath(state, knowledgeBaseId) {
  return path.join(knowledgeBaseDataRoot(state, knowledgeBaseId), "feedback", "query-feedback-resolutions.jsonl");
}

function legacyQaFeedbackPath(state, knowledgeBaseId) {
  return path.join(knowledgeBaseDataRoot(state, knowledgeBaseId), "feedback", "qa-feedback.jsonl");
}

function cleanupLegacyFeedbackFiles(state, knowledgeBaseId) {
  const feedbackFile = legacyQueryFeedbackPath(state, knowledgeBaseId);
  const resolutionFile = legacyQueryFeedbackResolutionPath(state, knowledgeBaseId);
  const qaFeedbackFile = legacyQaFeedbackPath(state, knowledgeBaseId);
  removeFile(feedbackFile);
  removeFile(resolutionFile);
  removeFile(qaFeedbackFile);
  removeEmptyDirectory(path.dirname(feedbackFile));
}

function insertFeedbackRecord(db, record, options = {}) {
  const sql = options.ignore ? `
    INSERT OR IGNORE INTO query_feedback (
      id, action, needs_review, resolved, question, answer_status, result_key,
      citation_ids_json, citation_refs_json, message, created_at, resolved_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL)
  ` : `
    INSERT INTO query_feedback (
      id, action, needs_review, resolved, question, answer_status, result_key,
      citation_ids_json, citation_refs_json, message, created_at, resolved_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL)
  `;
  db.prepare(sql).run(
    String(record.id || ""),
    normalizeAction(record.action),
    maintenanceActions.has(normalizeAction(record.action)) ? 1 : 0,
    String(record.question || ""),
    String(record.answerStatus || ""),
    String(record.resultKey || ""),
    stableJson(normalizeCitationIds(record.citationIds)),
    stableJson(normalizeCitationRefs(record.citationRefs || record.citations)),
    String(record.message || ""),
    String(record.createdAt || nowIso())
  );
}

function insertFeedbackResolution(db, resolution, options = {}) {
  const sql = options.ignore ? `
    INSERT OR IGNORE INTO query_feedback_resolutions (
      resolution_id, feedback_id, action, message, created_at
    ) VALUES (?, ?, ?, ?, ?)
  ` : `
    INSERT INTO query_feedback_resolutions (
      resolution_id, feedback_id, action, message, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `;
  db.prepare(sql).run(
    String(resolution.id || resolution.resolutionId || ""),
    String(resolution.feedbackId || ""),
    String(resolution.action || "resolved"),
    String(resolution.message || ""),
    String(resolution.createdAt || nowIso())
  );
}

function feedbackRowToRecord(row, knowledgeBaseId) {
  return {
    id: String(row.id || ""),
    kind: "knowmesh.queryFeedback",
    apiVersion: "1.0.0",
    knowledgeBaseId,
    action: normalizeAction(row.action),
    question: String(row.question || ""),
    answerStatus: String(row.answer_status || ""),
    resultKey: String(row.result_key || ""),
    citationIds: parseJson(row.citation_ids_json, []),
    citationRefs: parseJson(row.citation_refs_json, []),
    message: String(row.message || ""),
    createdAt: String(row.created_at || "")
  };
}

function resolutionRowToRecord(row) {
  return {
    id: String(row.resolution_id || row.id || ""),
    feedbackId: String(row.feedback_id || row.feedbackId || ""),
    action: String(row.action || "resolved"),
    message: String(row.message || ""),
    createdAt: String(row.created_at || row.createdAt || "")
  };
}

function removeFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    // Legacy cleanup is best-effort after SQLite migration has been written.
  }
}

function removeEmptyDirectory(directory) {
  try {
    if (directory && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  } catch {
    // Empty legacy folder cleanup is best-effort.
  }
}

function feedbackResolutionMap(resolutions = []) {
  const byFeedbackId = new Map();
  for (const record of resolutions) {
    const feedbackId = String(record.feedbackId || "").trim();
    if (!feedbackId || byFeedbackId.has(feedbackId)) continue;
    byFeedbackId.set(feedbackId, {
      id: String(record.id || ""),
      feedbackId,
      action: String(record.action || "resolved"),
      message: String(record.message || "").trim(),
      createdAt: String(record.createdAt || "")
    });
  }
  return byFeedbackId;
}

function publicFeedbackRecord(record, options = {}) {
  const action = normalizeAction(record.action);
  const resolved = Boolean(options.resolved);
  const resolution = options.resolution && typeof options.resolution === "object" ? options.resolution : null;
  const knowledgeBaseId = String(record.knowledgeBaseId || "").trim();
  const question = String(record.question || "").trim();
  return {
    id: String(record.id || ""),
    action,
    needsMaintenance: maintenanceActions.has(action) && !resolved,
    resolved,
    question,
    answerStatus: String(record.answerStatus || "").trim(),
    resultKey: String(record.resultKey || "").trim(),
    citationIds: normalizeCitationIds(record.citationIds),
    citationRefs: normalizeCitationRefs(record.citationRefs || record.citations),
    message: String(record.message || "").trim(),
    createdAt: String(record.createdAt || ""),
    retestHref: knowledgeBaseId && question ? `/kb/${knowledgeBaseId}/use/ask?question=${encodeURIComponent(question)}` : "",
    resolution: resolution ? {
      createdAt: String(resolution.createdAt || ""),
      message: String(resolution.message || "").trim()
    } : null
  };
}

function normalizeAction(value) {
  const action = String(value || "").trim();
  return allowedActions.has(action) ? action : "missed_point";
}

function normalizeCitationIds(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return list
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeCitationRefs(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = String(item.id || item.chunk_id || item.chunkId || "").trim();
      const title = String(item.title || item.sourceTitle || "").trim();
      const sourceUri = String(item.sourceUri || item.source || "").trim();
      const documentHref = String(item.documentHref || item.links?.document || item.links?.documentHref || "").trim();
      const excerpt = String(item.excerpt || "").replace(/\s+/g, " ").trim();
      const pageNumber = item.pageNumber ?? item.page ?? null;
      const lessonTitle = String(item.lessonTitle || item.metadata?.lessonTitle || item.metadata?.education?.lesson_title || "").trim();
      const ref = {
        id,
        title,
        sourceUri,
        documentHref,
        pageNumber: Number.isFinite(Number(pageNumber)) ? Number(pageNumber) : null,
        lessonTitle,
        excerpt: excerpt.slice(0, 240)
      };
      return Object.values(ref).some((entry) => entry !== "" && entry !== null) ? ref : null;
    })
    .filter(Boolean)
    .slice(0, 8);
}
