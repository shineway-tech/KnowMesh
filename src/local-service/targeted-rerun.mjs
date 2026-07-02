import path from "node:path";

import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { evaluationDashboard } from "./evaluation-dashboard.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const privacyExcludes = ["documentText", "sourceContent", "evaluationQuestions", "expectedAnswers", "answerText"];
const retryableExtractionStates = new Set(["failed", "failure", "error", "retry", "retryable"]);

export function previewTargetedRerun(state, input = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(input.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyPreview(input);
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  const target = normalizeTarget(input);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const selected = selectTarget(db, target);
    const issueSummary = readQualityIssueSummary(db, selected, { allOpen: target.type === "failedBatch" });
    const evaluation = evaluationDashboard(state, { knowledgeBaseId });
    const evaluationFailures = target.type === "failedBatch" ? safeEvaluationFailures(evaluation.failureGroups) : [];
    const failureBatches = target.type === "failedBatch" ? buildFailureBatches(selected, issueSummary, evaluationFailures) : [];
    const summary = buildSummary(selected, issueSummary, evaluationFailures);
    const diagnostics = buildRerunDiagnostics(selected);
    const ok = summary.canConfirm;
    return {
      ok,
      kind: "knowmesh.targetedRerunPreview",
      apiVersion: "v1",
      phase: "phase5-maintenance-evaluation",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      target,
      summary,
      documents: selected.documents,
      pageRanges: selected.pageRanges,
      structureNodes: selected.structureNodes,
      failureBatches,
      evaluationFailures,
      qualityIssues: issueSummary,
      diagnostics,
      checks: buildPreviewChecks(summary, target),
      nextActions: buildNextActions(summary),
      rerunScope: buildRerunScope(target, selected, summary, evaluationFailures),
      privacy: {
        redacted: true,
        excludes: privacyExcludes
      }
    };
  } finally {
    db.close();
  }
}

export function filterScanForTargetedRerun(scan, rerunScope = null) {
  if (!scan || !rerunScope || !Array.isArray(scan.manifest?.logicalDocuments)) return scan;
  const documentKeys = new Set([
    ...(rerunScope.documentIds || []),
    ...(rerunScope.relativePaths || []).map(normalizeRelativePath)
  ].filter(Boolean));
  if (!documentKeys.size) return scan;
  const logicalDocuments = scan.manifest.logicalDocuments.filter((document) => {
    const keys = [
      String(document.document_id || ""),
      normalizeRelativePath(document.relativePath || document.normalized_relative_path || "")
    ];
    return keys.some((key) => documentKeys.has(key));
  });
  const includedFiles = logicalDocuments.reduce((total, document) => total + Math.max(1, document.sourceParts?.length || 0), 0);
  return {
    ...scan,
    summary: {
      ...(scan.summary || {}),
      includedFiles,
      logicalDocuments: logicalDocuments.length
    },
    manifest: {
      ...(scan.manifest || {}),
      logicalDocuments,
      files: {
        ...(scan.manifest?.files || {}),
        included: includedFiles
      },
      scopeFilter: {
        ...(scan.manifest?.scopeFilter || {}),
        targetedRerun: true,
        targetedDocuments: logicalDocuments.length
      }
    }
  };
}

function selectTarget(db, target) {
  if (target.type === "pageRange") return selectPageRangeTarget(db, target);
  if (target.type === "unit") return selectUnitTarget(db, target);
  if (target.type === "failedBatch") return selectFailedBatchTarget(db, target);
  if (target.type === "issue") return selectIssueTarget(db, target);
  return selectDocumentTarget(db, target);
}

function selectIssueTarget(db, target) {
  const issueId = String(target.issueId || "").trim();
  if (!issueId) return emptySelection();
  const issue = db.prepare(`
    SELECT issue_id, target_type, target_id, severity, status
    FROM quality_issues
    WHERE issue_id = ? AND status = 'open'
    LIMIT 1
  `).get(issueId);
  if (!issue) return emptySelection();
  const issueRow = qualityIssueRow(issue);
  if (issueRow.targetType === "document") {
    const document = readDocument(db, { documentId: issueRow.targetId });
    if (!document) return { ...emptySelection(), issueRows: [issueRow] };
    return {
      ...withPageRanges(db, {
        documents: [summarizeDocument(db, document)],
        pageRows: readPagesForDocuments(db, [document.documentId]),
        structureNodes: readStructureNodesForDocuments(db, [document.documentId])
      }),
      issueRows: [issueRow]
    };
  }
  if (issueRow.targetType === "page") {
    const page = readPageById(db, issueRow.targetId);
    const document = page ? readDocument(db, { documentId: page.documentId }) : null;
    if (!page || !document) return { ...emptySelection(), issueRows: [issueRow] };
    return {
      ...withPageRanges(db, {
        documents: [summarizeDocument(db, document, { pageRows: [page] })],
        pageRows: [page],
        structureNodes: readStructureNodesForDocuments(db, [document.documentId])
          .filter((node) => rangesOverlap(page.pageNumber, page.pageNumber, node.pageStart, node.pageEnd)),
        explicitRange: { document, startPage: page.pageNumber, endPage: page.pageNumber }
      }),
      issueRows: [issueRow]
    };
  }
  if (issueRow.targetType === "chunk") {
    const chunk = db.prepare("SELECT chunk_id, document_id, structure_node_id FROM chunks WHERE chunk_id = ? LIMIT 1").get(issueRow.targetId);
    const document = chunk?.document_id ? readDocument(db, { documentId: chunk.document_id }) : null;
    const structureNodes = chunk?.structure_node_id ? readStructureNodesById(db, [chunk.structure_node_id]) : [];
    if (!document) return { ...emptySelection(), issueRows: [issueRow] };
    return {
      ...withPageRanges(db, {
        documents: [summarizeDocument(db, document)],
        pageRows: structureNodes.length ? readPagesForStructureNodes(db, structureNodes) : readPagesForDocuments(db, [document.documentId]),
        structureNodes
      }),
      issueRows: [issueRow]
    };
  }
  return { ...emptySelection(), issueRows: [issueRow] };
}

function selectDocumentTarget(db, target) {
  const document = readDocument(db, target);
  const documents = document ? [summarizeDocument(db, document)] : [];
  return withPageRanges(db, {
    documents,
    pageRows: document ? readPagesForDocuments(db, [document.documentId]) : [],
    structureNodes: []
  });
}

function selectPageRangeTarget(db, target) {
  const document = readDocument(db, target);
  if (!document) return emptySelection();
  const startPage = Math.max(1, Number(target.startPage || 1));
  const endPage = Math.max(startPage, Number(target.endPage || startPage));
  const pageRows = db.prepare(`
    SELECT page_id, document_id, page_number, extraction_state, quality_state, metadata_json
    FROM pages
    WHERE document_id = ? AND page_number BETWEEN ? AND ?
    ORDER BY page_number ASC
  `).all(document.documentId, startPage, endPage).map(pageRow);
  const structureNodes = readStructureNodesForDocuments(db, [document.documentId])
    .filter((node) => rangesOverlap(startPage, endPage, node.pageStart, node.pageEnd));
  return withPageRanges(db, {
    documents: [summarizeDocument(db, document, { pageRows })],
    pageRows,
    structureNodes,
    explicitRange: { document, startPage, endPage }
  });
}

function selectUnitTarget(db, target) {
  const unit = String(target.nodeId || target.unit || target.unitTitle || "").trim();
  if (!unit) return emptySelection();
  const rows = db.prepare(`
    SELECT sn.node_id, sn.document_id, sd.title AS document_title, sd.normalized_relative_path,
           sn.node_type, sn.title, sn.page_start, sn.page_end, sn.path, sn.metadata_json
    FROM structure_nodes sn
    JOIN source_documents sd ON sd.document_id = sn.document_id
    WHERE sn.node_id = ?
       OR sn.title = ?
       OR sn.path LIKE ?
       OR (sn.node_type LIKE '%unit%' AND sn.title LIKE ?)
    ORDER BY sn.document_id ASC, sn.page_start ASC, sn.sort_order ASC
    LIMIT 20
  `).all(unit, unit, `%${unit}%`, `%${unit}%`).map(structureNodeRow);
  const documentIds = unique(rows.map((row) => row.documentId));
  const documents = documentIds.map((documentId) => {
    const document = readDocument(db, { documentId });
    return document ? summarizeDocument(db, document) : null;
  }).filter(Boolean);
  const pageRows = readPagesForStructureNodes(db, rows);
  return withPageRanges(db, { documents, pageRows, structureNodes: rows });
}

function selectFailedBatchTarget(db) {
  const retryPages = db.prepare(`
    SELECT page_id, document_id, page_number, extraction_state, quality_state, metadata_json
    FROM pages
    WHERE lower(extraction_state) IN ('failed', 'failure', 'error', 'retry', 'retryable')
       OR json_extract(metadata_json, '$.retry.retryable') = 1
    ORDER BY document_id ASC, page_number ASC
  `).all().map(pageRow);
  const issueRows = db.prepare(`
    SELECT target_type, target_id, severity, status
    FROM quality_issues
    WHERE status = 'open'
    ORDER BY target_type ASC, target_id ASC
  `).all();
  const documentIds = unique([
    ...retryPages.map((row) => row.documentId),
    ...issueRows.filter((row) => row.target_type === "document").map((row) => row.target_id)
  ]);
  const documents = documentIds.map((documentId) => {
    const document = readDocument(db, { documentId });
    return document ? summarizeDocument(db, document) : null;
  }).filter(Boolean);
  return withPageRanges(db, {
    documents,
    pageRows: retryPages,
    structureNodes: readStructureNodesForDocuments(db, documentIds)
  });
}

function readDocument(db, target = {}) {
  const documentId = String(target.documentId || target.document_id || "").trim();
  const relativePath = normalizeRelativePath(target.relativePath || target.path || "");
  const row = documentId
    ? db.prepare(documentSql("sd.document_id = ?")).get(documentId)
    : relativePath
      ? db.prepare(documentSql("sd.normalized_relative_path = ?")).get(relativePath)
      : null;
  return row ? documentRow(row) : null;
}

function documentSql(where) {
  return `
    SELECT sd.document_id, sd.title, sd.source_type, sd.normalized_relative_path, sd.status, sd.quality_state, sd.metadata_json
    FROM source_documents sd
    WHERE ${where}
    LIMIT 1
  `;
}

function summarizeDocument(db, document, options = {}) {
  const pageRows = options.pageRows || readPagesForDocuments(db, [document.documentId]);
  const chunkCount = scalar(db, "SELECT count(*) FROM chunks WHERE document_id = ?", [document.documentId]);
  const qualityIssues = scalar(db, "SELECT count(*) FROM quality_issues WHERE status = 'open' AND target_type = 'document' AND target_id = ?", [document.documentId]);
  return {
    documentId: document.documentId,
    title: document.title,
    relativePath: document.relativePath,
    status: document.status,
    qualityState: document.qualityState,
    pages: pageRows.length,
    retryablePages: pageRows.filter((row) => row.retryable).length,
    chunks: chunkCount,
    qualityIssues
  };
}

function withPageRanges(db, selection = {}) {
  const documents = selection.documents || [];
  const pageRows = selection.pageRows || [];
  const structureNodes = selection.structureNodes || [];
  const pageRanges = selection.explicitRange
    ? [rangeSummary(selection.explicitRange.document, selection.explicitRange.startPage, selection.explicitRange.endPage, pageRows)]
    : summarizePageRanges(documents, pageRows);
  const chunkIds = readChunkIds(db, documents.map((item) => item.documentId), structureNodes);
  return {
    documents,
    pageRows,
    pageRanges,
    structureNodes,
    chunkIds,
    citationIds: readCitationIds(db, chunkIds),
    indexRecordIds: readIndexRecordIds(db, chunkIds),
    staleIndexRecordIds: readStaleIndexRecordIds(db, chunkIds),
    missingCitationChunkIds: readMissingCitationChunkIds(db, chunkIds),
    skippedExtractionPages: pageRows.filter((row) => row.skipped)
  };
}

function summarizePageRanges(documents = [], pageRows = []) {
  const byDocument = new Map(documents.map((item) => [item.documentId, item]));
  const grouped = new Map();
  for (const page of pageRows) {
    if (!grouped.has(page.documentId)) grouped.set(page.documentId, []);
    grouped.get(page.documentId).push(page);
  }
  return [...grouped.entries()].map(([documentId, pages]) => {
    const document = byDocument.get(documentId) || { documentId, title: "", relativePath: "" };
    const numbers = pages.map((page) => page.pageNumber).filter((item) => Number.isFinite(item));
    return rangeSummary(document, Math.min(...numbers), Math.max(...numbers), pages);
  });
}

function rangeSummary(document, startPage, endPage, pages = []) {
  return {
    documentId: document.documentId,
    title: document.title || "",
    relativePath: document.relativePath || "",
    startPage: Number.isFinite(startPage) ? startPage : 0,
    endPage: Number.isFinite(endPage) ? endPage : 0,
    pages: pages.length,
    retryablePages: pages.filter((row) => row.retryable).length
  };
}

function readPagesForDocuments(db, documentIds = []) {
  if (!documentIds.length) return [];
  return db.prepare(`
    SELECT page_id, document_id, page_number, extraction_state, quality_state, metadata_json
    FROM pages
    WHERE document_id IN (${placeholders(documentIds)})
    ORDER BY document_id ASC, page_number ASC
  `).all(...documentIds).map(pageRow);
}

function readPageById(db, pageId) {
  const row = db.prepare(`
    SELECT page_id, document_id, page_number, extraction_state, quality_state, metadata_json
    FROM pages
    WHERE page_id = ?
    LIMIT 1
  `).get(pageId);
  return row ? pageRow(row) : null;
}

function readPagesForStructureNodes(db, nodes = []) {
  const pages = [];
  for (const node of nodes) {
    const start = Number(node.pageStart || 0);
    const end = Number(node.pageEnd || start || 0);
    if (!node.documentId || !start || !end) continue;
    pages.push(...db.prepare(`
      SELECT page_id, document_id, page_number, extraction_state, quality_state, metadata_json
      FROM pages
      WHERE document_id = ? AND page_number BETWEEN ? AND ?
      ORDER BY page_number ASC
    `).all(node.documentId, start, end).map(pageRow));
  }
  return uniqueBy(pages, (page) => page.pageId);
}

function readStructureNodesForDocuments(db, documentIds = []) {
  if (!documentIds.length) return [];
  return db.prepare(`
    SELECT sn.node_id, sn.document_id, sd.title AS document_title, sd.normalized_relative_path,
           sn.node_type, sn.title, sn.page_start, sn.page_end, sn.path, sn.metadata_json
    FROM structure_nodes sn
    JOIN source_documents sd ON sd.document_id = sn.document_id
    WHERE sn.document_id IN (${placeholders(documentIds)})
    ORDER BY sn.document_id ASC, sn.page_start ASC, sn.sort_order ASC
  `).all(...documentIds).map(structureNodeRow);
}

function readStructureNodesById(db, nodeIds = []) {
  const ids = unique(nodeIds);
  if (!ids.length) return [];
  return db.prepare(`
    SELECT sn.node_id, sn.document_id, sd.title AS document_title, sd.normalized_relative_path,
           sn.node_type, sn.title, sn.page_start, sn.page_end, sn.path, sn.metadata_json
    FROM structure_nodes sn
    JOIN source_documents sd ON sd.document_id = sn.document_id
    WHERE sn.node_id IN (${placeholders(ids)})
    ORDER BY sn.document_id ASC, sn.page_start ASC, sn.sort_order ASC
  `).all(...ids).map(structureNodeRow);
}

function readChunkIds(db, documentIds = [], structureNodes = []) {
  const ids = new Set();
  if (documentIds.length) {
    for (const row of db.prepare(`SELECT chunk_id FROM chunks WHERE document_id IN (${placeholders(documentIds)})`).all(...documentIds)) {
      ids.add(String(row.chunk_id || ""));
    }
  }
  const nodeIds = structureNodes.map((item) => item.nodeId).filter(Boolean);
  if (nodeIds.length) {
    for (const row of db.prepare(`SELECT chunk_id FROM chunks WHERE structure_node_id IN (${placeholders(nodeIds)})`).all(...nodeIds)) {
      ids.add(String(row.chunk_id || ""));
    }
  }
  return [...ids].filter(Boolean).sort();
}

function readCitationIds(db, chunkIds = []) {
  const ids = unique(chunkIds);
  if (!ids.length) return [];
  return db.prepare(`
    SELECT citation_id
    FROM citations
    WHERE chunk_id IN (${placeholders(ids)})
    ORDER BY citation_id ASC
  `).all(...ids).map((row) => String(row.citation_id || "")).filter(Boolean);
}

function readIndexRecordIds(db, chunkIds = []) {
  const ids = unique(chunkIds);
  if (!ids.length) return [];
  return db.prepare(`
    SELECT record_id
    FROM index_records
    WHERE chunk_id IN (${placeholders(ids)})
    ORDER BY record_id ASC
  `).all(...ids).map((row) => String(row.record_id || "")).filter(Boolean);
}

function readStaleIndexRecordIds(db, chunkIds = []) {
  const ids = unique(chunkIds);
  if (!ids.length) return [];
  return db.prepare(`
    SELECT record_id
    FROM index_records
    WHERE chunk_id IN (${placeholders(ids)}) AND lower(status) = 'stale'
    ORDER BY record_id ASC
  `).all(...ids).map((row) => String(row.record_id || "")).filter(Boolean);
}

function readMissingCitationChunkIds(db, chunkIds = []) {
  const ids = unique(chunkIds);
  if (!ids.length) return [];
  return db.prepare(`
    SELECT c.chunk_id
    FROM chunks c
    LEFT JOIN citations ci ON ci.chunk_id = c.chunk_id
    WHERE c.chunk_id IN (${placeholders(ids)})
    GROUP BY c.chunk_id
    HAVING count(ci.citation_id) = 0
    ORDER BY c.chunk_id ASC
  `).all(...ids).map((row) => String(row.chunk_id || "")).filter(Boolean);
}

function readQualityIssueSummary(db, selected = {}, options = {}) {
  if (Array.isArray(selected.issueRows) && selected.issueRows.length) {
    return {
      total: selected.issueRows.length,
      byTargetType: countBy(selected.issueRows, (row) => row.targetType || "unknown"),
      bySeverity: countBy(selected.issueRows, (row) => row.severity || "review")
    };
  }
  const documentIds = new Set((selected.documents || []).map((item) => item.documentId));
  const pageIds = new Set((selected.pageRows || []).map((item) => item.pageId));
  const rows = db.prepare(`
    SELECT target_type, target_id, severity, status
    FROM quality_issues
    WHERE status = 'open'
    ORDER BY target_type ASC, severity ASC
  `).all();
  const scoped = options.allOpen ? rows : rows.filter((row) => {
    if (documentIds.size === 0 && pageIds.size === 0) return true;
    if (row.target_type === "document") return documentIds.has(String(row.target_id || ""));
    if (row.target_type === "page") return pageIds.has(String(row.target_id || ""));
    return false;
  });
  return {
    total: scoped.length,
    byTargetType: countBy(scoped, (row) => row.target_type || "unknown"),
    bySeverity: countBy(scoped, (row) => row.severity || "review")
  };
}

function buildSummary(selected, issueSummary, evaluationFailures = []) {
  const retryablePages = (selected.pageRows || []).filter((row) => row.retryable).length;
  const summary = {
    status: "empty",
    documents: (selected.documents || []).length,
    pages: (selected.pageRows || []).length,
    retryablePages,
    structureNodes: (selected.structureNodes || []).length,
    chunks: (selected.chunkIds || []).length,
    qualityIssues: issueSummary.total || 0,
    evaluationFailures: evaluationFailures.length,
    canConfirm: false
  };
  summary.canConfirm = summary.documents > 0 || summary.pages > 0 || summary.qualityIssues > 0 || summary.evaluationFailures > 0;
  summary.status = summary.canConfirm ? "ready" : "empty";
  return summary;
}

function buildFailureBatches(selected, issueSummary, evaluationFailures = []) {
  const batches = [];
  const retryablePages = (selected.pageRows || []).filter((row) => row.retryable).length;
  if (retryablePages) batches.push({ type: "retryable_pages", status: "ready", pages: retryablePages });
  if (issueSummary.total) batches.push({ type: "quality_issues", status: "ready", issues: issueSummary.total, byTargetType: issueSummary.byTargetType });
  if (evaluationFailures.length) batches.push({ type: "evaluation_failures", status: "ready", failures: evaluationFailures.length });
  return batches;
}

function safeEvaluationFailures(failureGroups = []) {
  return failureGroups.map((item) => ({
    category: String(item.category || ""),
    status: String(item.status || "review"),
    affectedCases: Number(item.affectedCases || 0),
    failed: Number(item.failed || 0),
    missing: Number(item.missing || 0),
    review: Number(item.review || 0),
    riskCodes: Array.isArray(item.riskCodes) ? item.riskCodes.slice(0, 12) : []
  }));
}

function buildRerunScope(target, selected, summary, evaluationFailures) {
  return {
    target,
    summary,
    qualityIssueIds: unique((selected.issueRows || []).map((item) => item.issueId)),
    documentIds: unique((selected.documents || []).map((item) => item.documentId)),
    relativePaths: unique((selected.documents || []).map((item) => normalizeRelativePath(item.relativePath))),
    pageRanges: selected.pageRanges || [],
    structureNodeIds: unique((selected.structureNodes || []).map((item) => item.nodeId)),
    chunkIds: selected.chunkIds || [],
    citationIds: selected.citationIds || [],
    indexRecordIds: selected.indexRecordIds || [],
    evaluationCategories: unique((evaluationFailures || []).map((item) => item.category)),
    rebuildPlan: {
      catalogTables: [
        "source_documents",
        "document_versions",
        "pages",
        "blocks",
        "structure_nodes",
        "chunks",
        "citations",
        "index_records",
        "quality_issues",
        "evaluation_results"
      ],
      artifactScopes: ["sources", "pages", "normalized", "reports"],
      preserves: ["workspace.sqlite", "catalog.sqlite authority"]
    }
  };
}

function buildRerunDiagnostics(selected = {}) {
  const items = [];
  const missingCitations = selected.missingCitationChunkIds || [];
  const staleIndexRecords = selected.staleIndexRecordIds || [];
  const skippedExtractionPages = selected.skippedExtractionPages || [];
  if (missingCitations.length) {
    items.push(rerunDiagnostic(
      "missingCitations",
      missingCitations.length,
      "缺少引用锚点",
      "Missing citation anchors",
      "部分可搜索片段没有引用锚点，重跑会重建 citations。",
      "Some searchable chunks are missing citation anchors; rerun rebuilds citations.",
      "/maintain/documents"
    ));
  }
  if (staleIndexRecords.length) {
    items.push(rerunDiagnostic(
      "staleIndexRecords",
      staleIndexRecords.length,
      "索引记录已过期",
      "Stale index records",
      "部分索引记录已标记过期，重跑会重建 index_records。",
      "Some index records are stale; rerun rebuilds index_records.",
      "/maintain/diagnostics"
    ));
  }
  if (skippedExtractionPages.length) {
    items.push(rerunDiagnostic(
      "skippedExtraction",
      skippedExtractionPages.length,
      "解析或 OCR 被跳过",
      "Skipped parser or OCR work",
      "部分页面处于 skipped/pending 状态，重跑会重新进入解析或 OCR。",
      "Some pages are skipped or pending; rerun sends them back through parser or OCR.",
      "/build/execution"
    ));
  }
  return {
    summary: {
      total: items.length,
      missingCitations: missingCitations.length,
      staleIndexRecords: staleIndexRecords.length,
      skippedExtraction: skippedExtractionPages.length
    },
    items
  };
}

function rerunDiagnostic(key, count, labelZh, labelEn, messageZh, messageEn, href) {
  return {
    key,
    status: "warn",
    count,
    fixable: true,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn },
    action: { href, label: { zh: "创建局部重跑", en: "Create targeted rerun" } }
  };
}

function buildPreviewChecks(summary, target) {
  return [
    {
      key: "targetScope",
      status: summary.canConfirm ? "pass" : "fail",
      label: { zh: "重跑范围", en: "Rerun scope" },
      message: summary.canConfirm
        ? { zh: "已找到可重跑范围。", en: "A rerunnable scope was found." }
        : { zh: `没有找到 ${target.type} 对应的可重跑范围。`, en: `No rerunnable scope was found for ${target.type}.` }
    },
    {
      key: "privacy",
      status: "pass",
      label: { zh: "隐私边界", en: "Privacy boundary" },
      message: { zh: "预览只返回资料、页码、类别和计数，不返回正文或评测题干。", en: "Preview returns sources, pages, categories, and counts, not body text or evaluation questions." }
    }
  ];
}

function buildNextActions(summary) {
  if (!summary.canConfirm) return [{ key: "adjustScope", href: "/maintain/documents", label: { zh: "调整范围", en: "Adjust scope" } }];
  return [{ key: "confirmTargetedRerun", href: "/build/execution", label: { zh: "创建局部重跑任务", en: "Create targeted rerun job" } }];
}

function documentRow(row = {}) {
  return {
    documentId: String(row.document_id || ""),
    title: String(row.title || row.document_id || ""),
    sourceType: String(row.source_type || ""),
    relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
    status: String(row.status || ""),
    qualityState: String(row.quality_state || "")
  };
}

function pageRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  const extractionState = String(row.extraction_state || "").toLowerCase();
  return {
    pageId: String(row.page_id || ""),
    documentId: String(row.document_id || ""),
    pageNumber: Number(row.page_number || 0),
    extractionState,
    qualityState: String(row.quality_state || ""),
    retryable: retryableExtractionStates.has(extractionState) || metadata.retry?.retryable === true,
    skipped: ["skipped", "pending", "not_started", "blocked"].includes(extractionState)
  };
}

function structureNodeRow(row = {}) {
  return {
    nodeId: String(row.node_id || ""),
    documentId: String(row.document_id || ""),
    documentTitle: String(row.document_title || ""),
    relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
    nodeType: String(row.node_type || ""),
    title: String(row.title || row.node_id || ""),
    pageStart: Number(row.page_start || 0),
    pageEnd: Number(row.page_end || row.page_start || 0),
    path: String(row.path || "")
  };
}

function normalizeTarget(input = {}) {
  const type = normalizeTargetType(input.type || input.targetType || "document");
  return {
    type,
    ...(input.issueId || input.issue_id ? { issueId: String(input.issueId || input.issue_id).trim() } : {}),
    ...(input.documentId || input.document_id ? { documentId: String(input.documentId || input.document_id).trim() } : {}),
    ...(input.relativePath || input.path ? { relativePath: normalizeRelativePath(input.relativePath || input.path) } : {}),
    ...(input.startPage || input.pageStart ? { startPage: Number(input.startPage || input.pageStart) } : {}),
    ...(input.endPage || input.pageEnd ? { endPage: Number(input.endPage || input.pageEnd) } : {}),
    ...(input.unit || input.unitTitle ? { unit: String(input.unit || input.unitTitle).trim() } : {}),
    ...(input.nodeId ? { nodeId: String(input.nodeId).trim() } : {})
  };
}

function normalizeTargetType(value) {
  const type = String(value || "document").trim() || "document";
  if (type === "file") return "document";
  if (type === "page" || type === "page_range" || type === "page-range") return "pageRange";
  if (type === "failed_batch" || type === "failed-batch") return "failedBatch";
  if (type === "qualityIssue" || type === "quality_issue" || type === "reviewIssue" || type === "review_issue") return "issue";
  return type;
}

function qualityIssueRow(row = {}) {
  return {
    issueId: String(row.issue_id || ""),
    targetType: String(row.target_type || ""),
    targetId: String(row.target_id || ""),
    severity: String(row.severity || ""),
    status: String(row.status || "")
  };
}

function emptySelection() {
  return { documents: [], pageRows: [], pageRanges: [], structureNodes: [], chunkIds: [], issueRows: [] };
}

function emptyPreview(input = {}) {
  const target = normalizeTarget(input);
  const summary = {
    status: "empty",
    documents: 0,
    pages: 0,
    retryablePages: 0,
    structureNodes: 0,
    chunks: 0,
    qualityIssues: 0,
    evaluationFailures: 0,
    canConfirm: false
  };
  return {
    ok: false,
    kind: "knowmesh.targetedRerunPreview",
    apiVersion: "v1",
    phase: "phase5-maintenance-evaluation",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "" },
    target,
    summary,
    documents: [],
    pageRanges: [],
    structureNodes: [],
    failureBatches: [],
    evaluationFailures: [],
    qualityIssues: { total: 0, byTargetType: {}, bySeverity: {} },
    diagnostics: { summary: { total: 0, missingCitations: 0, staleIndexRecords: 0, skippedExtraction: 0 }, items: [] },
    checks: buildPreviewChecks(summary, target),
    nextActions: buildNextActions(summary),
    rerunScope: buildRerunScope(target, emptySelection(), summary, []),
    privacy: { redacted: true, excludes: privacyExcludes }
  };
}

function scalar(db, sql, params = []) {
  return Number(Object.values(db.prepare(sql).get(...params) || {})[0] || 0);
}

function placeholders(values = []) {
  return values.map(() => "?").join(", ");
}

function unique(values = []) {
  return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
}

function uniqueBy(values = [], keyFn) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function countBy(values = [], keyFn) {
  const counts = {};
  for (const value of values) {
    const key = String(keyFn(value) || "unknown");
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function normalizeRelativePath(value = "") {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

export function targetedRerunWorkspaceRoot(baseWorkspaceRoot, knowledgeBaseId, jobId) {
  const safeKb = String(knowledgeBaseId || "knowledge-base").replace(/[^a-zA-Z0-9._-]/g, "-") || "knowledge-base";
  const safeJob = String(jobId || "targeted-rerun").replace(/[^a-zA-Z0-9._-]/g, "-") || "targeted-rerun";
  return baseWorkspaceRoot ? path.join(baseWorkspaceRoot, "knowledge-bases", safeKb, "reruns", safeJob) : "";
}
