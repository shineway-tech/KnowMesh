import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function syncK12UnitLessonRangesToCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyResult();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableResult(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const tocEntries = readTocEntries(db);
    const units = buildUnitRanges(tocEntries);
    writeRanges(db, units);
    return {
      ok: true,
      kind: "knowmesh.k12PageRangeBuildResult",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary: {
        documents: new Set(units.map((unit) => unit.documentId)).size,
        units: units.length,
        lessons: units.reduce((total, unit) => total + unit.lessons.length, 0),
        tocEntries: tocEntries.length
      },
      units: units.map(publicUnit)
    };
  } finally {
    db.close();
  }
}

function readTocEntries(db) {
  return db.prepare(`
    SELECT node_id, document_id, title, sort_order, page_start, page_end, path, metadata_json
    FROM structure_nodes
    WHERE node_type = 'toc_entry'
    ORDER BY document_id ASC, sort_order ASC, page_start ASC, node_id ASC
  `).all().map((row) => {
    const metadata = parseJson(row.metadata_json, {});
    return {
      nodeId: String(row.node_id || ""),
      documentId: String(row.document_id || ""),
      title: String(row.title || ""),
      sortOrder: Number(row.sort_order || 0),
      pageStart: Number(row.page_start || 0) || null,
      pageEnd: Number(row.page_end || row.page_start || 0) || null,
      path: String(row.path || ""),
      unitNo: Number(metadata.unitNo || 0) || null,
      unitTitle: String(metadata.unitTitle || ""),
      lessonOrder: Number(metadata.lessonOrder || 0) || null,
      metadata
    };
  }).filter((entry) => entry.documentId && entry.title && entry.pageStart);
}

function buildUnitRanges(tocEntries) {
  const unitsByKey = new Map();
  for (const entry of tocEntries) {
    const key = `${entry.documentId}:${entry.unitNo || 0}`;
    if (!unitsByKey.has(key)) {
      unitsByKey.set(key, {
        documentId: entry.documentId,
        unitNo: entry.unitNo,
        title: entry.unitTitle || (entry.unitNo ? `第${entry.unitNo}单元` : "目录"),
        sortOrder: entry.sortOrder,
        pageStart: entry.pageStart,
        pageEnd: entry.pageStart,
        tocEntries: []
      });
    }
    const unit = unitsByKey.get(key);
    unit.pageStart = Math.min(unit.pageStart, entry.pageStart);
    unit.pageEnd = Math.max(unit.pageEnd, entry.pageStart);
    unit.tocEntries.push(entry);
  }

  return [...unitsByKey.values()].map((unit) => {
    const tocEntries = unit.tocEntries.sort((a, b) => a.pageStart - b.pageStart || (a.lessonOrder || 0) - (b.lessonOrder || 0) || a.nodeId.localeCompare(b.nodeId));
    const lessons = tocEntries.map((entry, index) => {
      const next = tocEntries[index + 1] || null;
      const pageEnd = next?.pageStart ? Math.max(entry.pageStart, next.pageStart - 1) : entry.pageStart;
      return {
        nodeId: lessonNodeId(entry),
        tocNodeId: entry.nodeId,
        documentId: entry.documentId,
        unitNo: unit.unitNo,
        unitTitle: unit.title,
        lessonOrder: entry.lessonOrder || index + 1,
        title: entry.title,
        sortOrder: entry.sortOrder,
        pageStart: entry.pageStart,
        pageEnd,
        path: `${unit.title}/${entry.lessonOrder || index + 1} ${entry.title}`
      };
    });
    unit.lessons = lessons;
    unit.pageEnd = lessons.length ? Math.max(...lessons.map((lesson) => lesson.pageEnd)) : unit.pageEnd;
    unit.nodeId = unitNodeId(unit);
    unit.path = unit.title;
    return unit;
  }).sort((a, b) => a.documentId.localeCompare(b.documentId) || (a.unitNo || 0) - (b.unitNo || 0));
}

function writeRanges(db, units) {
  const upsertNode = db.prepare(`
    INSERT INTO structure_nodes (
      node_id, parent_id, document_id, node_type, title, sort_order,
      page_start, page_end, path, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      parent_id = excluded.parent_id,
      document_id = excluded.document_id,
      node_type = excluded.node_type,
      title = excluded.title,
      sort_order = excluded.sort_order,
      page_start = excluded.page_start,
      page_end = excluded.page_end,
      path = excluded.path,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const updateToc = db.prepare(`
    UPDATE structure_nodes
    SET parent_id = ?, metadata_json = ?, updated_at = ?
    WHERE node_id = ?
  `);
  const write = db.transaction(() => {
    const now = nowIso();
    for (const unit of units) {
      upsertNode.run(
        unit.nodeId,
        null,
        unit.documentId,
        "unit",
        unit.title,
        unit.sortOrder,
        unit.pageStart,
        unit.pageEnd,
        unit.path,
        JSON.stringify({ unitNo: unit.unitNo }),
        now,
        now
      );
      for (const lesson of unit.lessons) {
        upsertNode.run(
          lesson.nodeId,
          unit.nodeId,
          lesson.documentId,
          "lesson",
          lesson.title,
          lesson.sortOrder,
          lesson.pageStart,
          lesson.pageEnd,
          lesson.path,
          JSON.stringify({
            unitNo: lesson.unitNo,
            unitTitle: lesson.unitTitle,
            lessonOrder: lesson.lessonOrder,
            tocNodeId: lesson.tocNodeId
          }),
          now,
          now
        );
        const toc = unit.tocEntries.find((entry) => entry.nodeId === lesson.tocNodeId);
        updateToc.run(
          unit.nodeId,
          JSON.stringify({
            ...(toc?.metadata || {}),
            lessonNodeId: lesson.nodeId,
            unitNodeId: unit.nodeId
          }),
          now,
          lesson.tocNodeId
        );
      }
    }
  });
  write();
}

function unitNodeId(unit) {
  return `unit:${unit.documentId}:${unit.unitNo || 0}`;
}

function lessonNodeId(entry) {
  return `lesson:${entry.documentId}:${entry.unitNo || 0}:${entry.lessonOrder || 0}:${entry.pageStart || 0}`;
}

function publicUnit(unit) {
  return {
    nodeId: unit.nodeId,
    documentId: unit.documentId,
    title: unit.title,
    unitNo: unit.unitNo,
    pageStart: unit.pageStart,
    pageEnd: unit.pageEnd,
    lessons: unit.lessons.map((lesson) => ({
      nodeId: lesson.nodeId,
      title: lesson.title,
      lessonOrder: lesson.lessonOrder,
      pageStart: lesson.pageStart,
      pageEnd: lesson.pageEnd
    }))
  };
}

function notApplicableResult(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12PageRangeBuildResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      template: knowledgeBase.template || ""
    },
    summary: {
      status: "not_applicable",
      documents: 0,
      units: 0,
      lessons: 0,
      tocEntries: 0
    },
    units: []
  };
}

function emptyResult() {
  return {
    ok: false,
    kind: "knowmesh.k12PageRangeBuildResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", template: "" },
    summary: {
      status: "empty",
      documents: 0,
      units: 0,
      lessons: 0,
      tocEntries: 0
    },
    units: []
  };
}
