import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function readK12StructureReadinessFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyReadiness();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableReadiness(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const documents = db.prepare(`
      SELECT document_id, title, normalized_relative_path, status, quality_state
      FROM source_documents
      ORDER BY normalized_relative_path ASC, document_id ASC
    `).all().map(documentRow);
    const nodes = db.prepare(`
      SELECT node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json
      FROM structure_nodes
      ORDER BY document_id ASC, sort_order ASC, node_id ASC
    `).all().map(nodeRow);
    const chunks = db.prepare(`
      SELECT chunk_id, structure_node_id
      FROM chunks
      WHERE structure_node_id IS NOT NULL AND structure_node_id <> ''
    `).all().map((row) => ({
      chunkId: String(row.chunk_id || ""),
      structureNodeId: String(row.structure_node_id || "")
    }));
    const citations = db.prepare(`
      SELECT citation_id, chunk_id, structure_node_id
      FROM citations
      WHERE structure_node_id IS NOT NULL AND structure_node_id <> ''
    `).all().map((row) => ({
      citationId: String(row.citation_id || ""),
      chunkId: String(row.chunk_id || ""),
      structureNodeId: String(row.structure_node_id || "")
    }));
    const outline = buildDocuments(documents, nodes, chunks, citations);
    const summary = summarizeStructure(documents, nodes, outline);

    return {
      ok: true,
      kind: "knowmesh.k12StructureReadiness",
      apiVersion: "v1",
      phase: "phase3-k12-expert",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary,
      documents: outline,
      gaps: buildGaps(summary)
    };
  } finally {
    db.close();
  }
}

function buildDocuments(documents, nodes, chunks, citations) {
  const nodesByDocument = groupBy(nodes, (node) => node.documentId);
  const chunksByNode = groupBy(chunks, (chunk) => chunk.structureNodeId);
  const citationsByNode = groupBy(citations, (citation) => citation.structureNodeId);
  return documents.map((document) => {
    const documentNodes = nodesByDocument.get(document.documentId) || [];
    const units = documentNodes
      .filter((node) => node.nodeType === "unit")
      .sort(sortNode)
      .map((unit) => {
        const lessons = documentNodes
          .filter((node) => node.nodeType === "lesson" && node.parentId === unit.nodeId)
          .sort(sortLesson)
          .map((lesson) => compactLesson(lesson, chunksByNode, citationsByNode));
        const tocEntries = documentNodes
          .filter((node) => node.nodeType === "toc_entry" && node.parentId === unit.nodeId)
          .sort(sortNode)
          .map(compactTocEntry);
        return {
          nodeId: unit.nodeId,
          title: unit.title,
          sortOrder: unit.sortOrder,
          pageStart: unit.pageStart,
          pageEnd: unit.pageEnd,
          path: unit.path,
          lessonCount: lessons.length,
          tocEntryCount: tocEntries.length,
          firstLesson: lessons[0] || null,
          lessons,
          tocEntries
        };
      });
    return {
      documentId: document.documentId,
      title: document.title,
      relativePath: document.relativePath,
      status: document.status,
      units
    };
  });
}

function compactLesson(lesson, chunksByNode, citationsByNode) {
  const chunkCount = (chunksByNode.get(lesson.nodeId) || []).length;
  const citationCount = (citationsByNode.get(lesson.nodeId) || []).length;
  return {
    nodeId: lesson.nodeId,
    title: lesson.title,
    sortOrder: lesson.sortOrder,
    lessonOrder: lesson.lessonOrder,
    pageStart: lesson.pageStart,
    pageEnd: lesson.pageEnd,
    path: lesson.path,
    hasPageRange: Number.isFinite(lesson.pageStart) && Number.isFinite(lesson.pageEnd),
    chunkCount,
    citationCount,
    hasChunk: chunkCount > 0,
    hasCitation: citationCount > 0
  };
}

function compactTocEntry(node) {
  return {
    nodeId: node.nodeId,
    title: node.title,
    sortOrder: node.sortOrder,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    path: node.path,
    lessonNodeId: node.lessonNodeId
  };
}

function summarizeStructure(documents, nodes, outline) {
  const units = outline.reduce((total, document) => total + document.units.length, 0);
  const lessons = outline.reduce((total, document) => total + document.units.reduce((sum, unit) => sum + unit.lessons.length, 0), 0);
  const tocEntries = outline.reduce((total, document) => total + document.units.reduce((sum, unit) => sum + unit.tocEntries.length, 0), 0);
  const allLessons = outline.flatMap((document) => document.units.flatMap((unit) => unit.lessons));
  const lessonsWithPageRange = allLessons.filter((lesson) => lesson.hasPageRange).length;
  const lessonsWithChunks = allLessons.filter((lesson) => lesson.hasChunk).length;
  const lessonsWithCitations = allLessons.filter((lesson) => lesson.hasCitation).length;
  const unitsWithLessons = outline.reduce((total, document) => total + document.units.filter((unit) => unit.lessons.length > 0).length, 0);
  const queryRoutes = {
    tocLookup: tocEntries > 0 ? "ready" : "blocked",
    unitLessonLookup: units > 0 && lessons > 0 && lessonsWithPageRange === lessons ? "ready" : "blocked",
    firstLessonLookup: units > 0 && unitsWithLessons === units ? "ready" : "blocked"
  };
  return {
    status: readinessStatus(nodes.length, queryRoutes),
    documents: documents.length,
    structureNodes: nodes.length,
    units,
    lessons,
    tocEntries,
    unitsWithLessons,
    lessonsWithPageRange,
    lessonsWithChunks,
    lessonsWithCitations,
    queryRoutes
  };
}

function buildGaps(summary) {
  const gaps = [];
  if (summary.tocEntries === 0) {
    gaps.push({
      key: "tocEntries",
      status: "blocked",
      message: "K12 TOC lookup needs toc_entry structure nodes."
    });
  }
  if (summary.lessons > 0 && summary.lessonsWithPageRange < summary.lessons) {
    gaps.push({
      key: "lessonPageRanges",
      status: "blocked",
      message: "Every lesson needs page_start and page_end before unit/lesson lookup is structure-first."
    });
  }
  if (summary.units > 0 && summary.unitsWithLessons < summary.units) {
    gaps.push({
      key: "unitLessonLinks",
      status: "blocked",
      message: "Every unit needs at least one child lesson."
    });
  }
  if (summary.lessons > 0 && summary.lessonsWithCitations < summary.lessons) {
    gaps.push({
      key: "lessonCitations",
      status: "review",
      message: "Lessons without citations can answer structure questions but need source anchors before release."
    });
  }
  return gaps;
}

function readinessStatus(nodeCount, queryRoutes) {
  if (!nodeCount) return "empty";
  return Object.values(queryRoutes).every((status) => status === "ready") ? "ready" : "partial";
}

function documentRow(row = {}) {
  return {
    documentId: String(row.document_id || ""),
    title: String(row.title || ""),
    relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
    status: String(row.status || ""),
    qualityState: String(row.quality_state || "")
  };
}

function nodeRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    nodeId: String(row.node_id || ""),
    parentId: String(row.parent_id || ""),
    documentId: String(row.document_id || ""),
    nodeType: String(row.node_type || ""),
    title: String(row.title || ""),
    sortOrder: Number(row.sort_order || 0),
    lessonOrder: numericOrNull(metadata.lessonOrder ?? metadata.lesson_order_no),
    pageStart: numericOrNull(row.page_start),
    pageEnd: numericOrNull(row.page_end),
    path: normalizeRelativePath(row.path || ""),
    lessonNodeId: String(metadata.lessonNodeId || metadata.lesson_node_id || "")
  };
}

function sortNode(a, b) {
  return a.sortOrder - b.sortOrder || a.nodeId.localeCompare(b.nodeId);
}

function sortLesson(a, b) {
  return (a.lessonOrder ?? a.sortOrder) - (b.lessonOrder ?? b.sortOrder) || sortNode(a, b);
}

function groupBy(items, resolveKey) {
  const groups = new Map();
  for (const item of items) {
    const key = resolveKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function notApplicableReadiness(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12StructureReadiness",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      name: knowledgeBase.name || knowledgeBase.id || "",
      template: knowledgeBase.template || ""
    },
    summary: emptySummary("not_applicable"),
    documents: [],
    gaps: []
  };
}

function emptyReadiness() {
  return {
    ok: false,
    kind: "knowmesh.k12StructureReadiness",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "" },
    summary: emptySummary("empty"),
    documents: [],
    gaps: []
  };
}

function emptySummary(status) {
  return {
    status,
    documents: 0,
    structureNodes: 0,
    units: 0,
    lessons: 0,
    tocEntries: 0,
    unitsWithLessons: 0,
    lessonsWithPageRange: 0,
    lessonsWithChunks: 0,
    lessonsWithCitations: 0,
    queryRoutes: {
      tocLookup: "blocked",
      unitLessonLookup: "blocked",
      firstLessonLookup: "blocked"
    }
  };
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}
