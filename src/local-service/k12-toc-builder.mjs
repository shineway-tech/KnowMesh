import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function syncK12TocEntriesToCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyResult();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableResult(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const blocks = readTocBlocks(db);
    const entries = blocks.flatMap((block) => parseK12TocEntries(block.text).map((entry, index) => ({
      ...entry,
      documentId: block.documentId,
      sourceBlockId: block.blockId,
      sourcePageId: block.pageId,
      sourcePageNumber: block.pageNumber,
      sortOrder: block.sortOrder * 1000 + index
    })));
    writeTocEntries(db, entries);
    const documents = new Set(entries.map((entry) => entry.documentId)).size;
    return {
      ok: true,
      kind: "knowmesh.k12TocBuildResult",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary: {
        documents,
        tocBlocks: blocks.length,
        tocEntries: entries.length
      },
      entries: entries.map(publicEntry)
    };
  } finally {
    db.close();
  }
}

export function parseK12TocEntries(text) {
  const entries = [];
  let unitNo = null;
  let unitTitle = "";
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const unit = line.match(/^(第([一二三四五六七八九十\d]+)单元)/);
    if (unit) {
      unitNo = chineseNumberToArabic(unit[2]);
      unitTitle = unit[1];
      continue;
    }
    const entry = parseTocLine(line);
    if (!entry) continue;
    entries.push({
      unitNo,
      unitTitle,
      lessonOrder: entry.lessonOrder,
      title: entry.title,
      pageNumber: entry.pageNumber
    });
  }
  return entries;
}

function readTocBlocks(db) {
  return db.prepare(`
    SELECT
      b.block_id,
      b.page_id,
      b.document_id,
      b.block_type,
      b.sort_order,
      b.metadata_json,
      p.page_number
    FROM blocks b
    LEFT JOIN pages p ON p.page_id = b.page_id
    ORDER BY b.document_id ASC, p.page_number ASC, b.sort_order ASC, b.block_id ASC
  `).all().map(blockRow).filter((block) => block.text && isTocBlock(block));
}

function blockRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  const pageClassification = metadata.pageClassification || {};
  return {
    blockId: String(row.block_id || ""),
    pageId: String(row.page_id || ""),
    documentId: String(row.document_id || ""),
    blockType: String(row.block_type || ""),
    sortOrder: Number(row.sort_order || 0),
    pageNumber: Number(row.page_number || metadata.page_start || 0) || null,
    text: String(metadata.text || metadata.textPreview || ""),
    contentType: String(metadata.contentType || ""),
    pageClassification
  };
}

function isTocBlock(block) {
  return block.blockType === "toc_entry"
    || block.contentType === "toc_entry"
    || block.pageClassification.primaryType === "table_of_contents";
}

function writeTocEntries(db, entries) {
  const upsert = db.prepare(`
    INSERT INTO structure_nodes (
      node_id, parent_id, document_id, node_type, title, sort_order,
      page_start, page_end, path, metadata_json, created_at, updated_at
    ) VALUES (?, NULL, ?, 'toc_entry', ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
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
  const write = db.transaction(() => {
    const now = nowIso();
    for (const entry of entries) {
      upsert.run(
        tocNodeId(entry),
        entry.documentId,
        entry.title,
        entry.sortOrder,
        entry.pageNumber,
        entry.pageNumber,
        tocPath(entry),
        JSON.stringify({
          unitNo: entry.unitNo,
          unitTitle: entry.unitTitle,
          lessonOrder: entry.lessonOrder,
          sourceBlockId: entry.sourceBlockId,
          sourcePageId: entry.sourcePageId,
          sourcePageNumber: entry.sourcePageNumber
        }),
        now,
        now
      );
    }
  });
  write();
}

function parseTocLine(line) {
  const normalized = line.replace(/…/g, ".").replace(/·/g, ".");
  const match = normalized.match(/^\s*(\d{1,2})\s+(.+?)\s*(?:\.{2,}|\s{2,})\s*(\d{1,3})\s*$/);
  if (!match) return null;
  return {
    lessonOrder: Number(match[1]),
    title: cleanupTitle(match[2]),
    pageNumber: Number(match[3])
  };
}

function cleanupTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tocNodeId(entry) {
  return `toc:${entry.documentId}:${entry.unitNo || 0}:${entry.lessonOrder || 0}:${entry.pageNumber || 0}`;
}

function tocPath(entry) {
  return ["目录", entry.unitTitle || "", entry.lessonOrder ? `${entry.lessonOrder} ${entry.title}` : entry.title]
    .filter(Boolean)
    .join("/");
}

function publicEntry(entry) {
  return {
    documentId: entry.documentId,
    title: entry.title,
    unitNo: entry.unitNo,
    unitTitle: entry.unitTitle,
    lessonOrder: entry.lessonOrder,
    pageNumber: entry.pageNumber,
    sourceBlockId: entry.sourceBlockId
  };
}

function chineseNumberToArabic(value) {
  if (/^\d+$/.test(String(value))) return Number(value);
  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  if (String(value).startsWith("十")) return 10 + (digits[String(value).slice(1)] || 0);
  if (String(value).includes("十")) {
    const [tens, ones] = String(value).split("十");
    return (digits[tens] || 1) * 10 + (digits[ones] || 0);
  }
  return digits[value] || null;
}

function notApplicableResult(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12TocBuildResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      template: knowledgeBase.template || ""
    },
    summary: {
      status: "not_applicable",
      documents: 0,
      tocBlocks: 0,
      tocEntries: 0
    },
    entries: []
  };
}

function emptyResult() {
  return {
    ok: false,
    kind: "knowmesh.k12TocBuildResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", template: "" },
    summary: {
      status: "empty",
      documents: 0,
      tocBlocks: 0,
      tocEntries: 0
    },
    entries: []
  };
}
