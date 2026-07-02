import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { normalizeK12ObjectType } from "./k12-object-contract.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const extractableTypes = new Set([
  "text",
  "exercise",
  "formula",
  "vocabulary",
  "table",
  "figure",
  "example",
  "knowledge_point",
  "answer_explanation",
  "experiment",
  "activity"
]);

export function extractK12ObjectsFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyResult();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableResult(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const nodes = readStructureNodes(db);
    const blocks = readClassifiedBlocks(db).filter((block) => extractableTypes.has(block.contentType));
    const objects = blocks.map((block) => objectFromBlock(block, nodes)).filter(Boolean);
    writeObjects(db, objects);
    return {
      ok: true,
      kind: "knowmesh.k12ObjectExtractionResult",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary: {
        blocks: blocks.length,
        objects: objects.length,
        objectTypes: countBy(objects, (object) => object.objectType)
      },
      objects: objects.map(publicObject)
    };
  } finally {
    db.close();
  }
}

function readStructureNodes(db) {
  return db.prepare(`
    SELECT node_id, document_id, node_type, title, page_start, page_end
    FROM structure_nodes
    WHERE node_type IN ('lesson', 'unit', 'section', 'page')
    ORDER BY
      CASE node_type WHEN 'lesson' THEN 0 WHEN 'section' THEN 1 WHEN 'unit' THEN 2 ELSE 3 END,
      page_start ASC,
      node_id ASC
  `).all().map((row) => ({
    nodeId: String(row.node_id || ""),
    documentId: String(row.document_id || ""),
    nodeType: String(row.node_type || ""),
    title: String(row.title || ""),
    pageStart: row.page_start === null || row.page_start === undefined ? null : Number(row.page_start),
    pageEnd: row.page_end === null || row.page_end === undefined ? null : Number(row.page_end)
  }));
}

function readClassifiedBlocks(db) {
  return db.prepare(`
    SELECT b.block_id, b.document_id, b.block_type, b.quality_state, b.metadata_json, p.page_number
    FROM blocks b
    LEFT JOIN pages p ON p.page_id = b.page_id
    ORDER BY b.document_id ASC, p.page_number ASC, b.sort_order ASC, b.block_id ASC
  `).all().map((row) => {
    const metadata = parseJson(row.metadata_json, {});
    const rawContentType = String(metadata.contentType || row.block_type || "");
    const contentType = normalizeK12ObjectType(rawContentType) || rawContentType;
    const pageStart = Number(metadata.page_start || row.page_number || 0) || null;
    const pageEnd = Number(metadata.page_end || pageStart || 0) || pageStart;
    return {
      blockId: String(row.block_id || ""),
      documentId: String(row.document_id || ""),
      blockType: String(row.block_type || ""),
      contentType,
      qualityState: String(row.quality_state || "primary"),
      title: String(metadata.title || labelForContentType(contentType)),
      pageStart,
      pageEnd
    };
  });
}

function objectFromBlock(block, nodes) {
  if (!block.blockId || !block.documentId || !block.contentType) return null;
  const node = findNodeForBlock(block, nodes);
  return {
    objectId: `k12-object:${block.blockId}`,
    documentId: block.documentId,
    structureNodeId: node?.nodeId || "",
    objectType: block.contentType,
    title: block.title || labelForContentType(block.contentType),
    sourcePage: block.pageStart,
    qualityState: block.qualityState || "primary",
    metadata: {
      sourceBlockId: block.blockId,
      contentType: block.contentType,
      page_start: block.pageStart,
      page_end: block.pageEnd,
      structureNodeType: node?.nodeType || "",
      structureNodeTitle: node?.title || ""
    }
  };
}

function findNodeForBlock(block, nodes) {
  return nodes.find((node) => {
    if (node.documentId !== block.documentId) return false;
    if (node.pageStart === null || node.pageEnd === null || block.pageStart === null) return false;
    return block.pageStart >= node.pageStart && block.pageStart <= node.pageEnd;
  }) || null;
}

function writeObjects(db, objects) {
  const upsert = db.prepare(`
    INSERT INTO knowledge_objects (
      object_id, document_id, structure_node_id, object_type, title,
      source_page, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(object_id) DO UPDATE SET
      document_id = excluded.document_id,
      structure_node_id = excluded.structure_node_id,
      object_type = excluded.object_type,
      title = excluded.title,
      source_page = excluded.source_page,
      quality_state = excluded.quality_state,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    const now = nowIso();
    for (const object of objects) {
      upsert.run(
        object.objectId,
        object.documentId,
        object.structureNodeId || null,
        object.objectType,
        object.title,
        object.sourcePage,
        object.qualityState,
        JSON.stringify(object.metadata),
        now,
        now
      );
    }
  });
  write();
}

function publicObject(object) {
  return {
    objectId: object.objectId,
    documentId: object.documentId,
    structureNodeId: object.structureNodeId,
    objectType: object.objectType,
    title: object.title,
    sourcePage: object.sourcePage,
    qualityState: object.qualityState
  };
}

function labelForContentType(contentType) {
  return {
    lesson_text: "Lesson text",
    text: "Lesson text",
    exercise: "Exercise",
    formula: "Formula",
    vocabulary: "Vocabulary",
    vocabulary_table: "Vocabulary",
    table: "Table",
    figure: "Figure",
    example: "Example",
    experiment: "Experiment",
    activity: "Activity"
  }[contentType] || contentType || "K12 object";
}

function countBy(items, resolveKey) {
  const counts = {};
  for (const item of items) {
    const key = resolveKey(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function notApplicableResult(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12ObjectExtractionResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: knowledgeBase.id || "", template: knowledgeBase.template || "" },
    summary: { status: "not_applicable", blocks: 0, objects: 0, objectTypes: {} },
    objects: []
  };
}

function emptyResult() {
  return {
    ok: false,
    kind: "knowmesh.k12ObjectExtractionResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", template: "" },
    summary: { status: "empty", blocks: 0, objects: 0, objectTypes: {} },
    objects: []
  };
}
