import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { requireK12RelationType } from "./k12-object-contract.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function extractK12MathObjectsFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyResult();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableResult(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const nodes = readStructureNodes(db);
    const blocks = readMathBlocks(db);
    const objects = blocks.map((block) => objectFromBlock(block, nodes)).filter(Boolean);
    const relations = buildFormulaExerciseRelations(objects);
    writeObjectsAndRelations(db, objects, relations);
    return {
      ok: true,
      kind: "knowmesh.k12MathObjectExtractionResult",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId, template: knowledgeBase.template || "" },
      summary: {
        blocks: blocks.length,
        formulas: objects.filter((object) => object.objectType === "formula").length,
        exercises: objects.filter((object) => object.objectType === "exercise").length,
        relations: relations.length
      },
      objects: objects.map((object) => ({
        objectId: object.objectId,
        objectType: object.objectType,
        title: object.title,
        structureNodeId: object.structureNodeId
      }))
    };
  } finally {
    db.close();
  }
}

function readStructureNodes(db) {
  return db.prepare(`
    SELECT node_id, document_id, node_type, title, page_start, page_end
    FROM structure_nodes
    WHERE node_type IN ('lesson', 'unit', 'section')
    ORDER BY CASE node_type WHEN 'lesson' THEN 0 WHEN 'section' THEN 1 ELSE 2 END, page_start ASC
  `).all().map((row) => ({
    nodeId: String(row.node_id || ""),
    documentId: String(row.document_id || ""),
    nodeType: String(row.node_type || ""),
    title: String(row.title || ""),
    pageStart: row.page_start === null || row.page_start === undefined ? null : Number(row.page_start),
    pageEnd: row.page_end === null || row.page_end === undefined ? null : Number(row.page_end)
  }));
}

function readMathBlocks(db) {
  return db.prepare(`
    SELECT b.block_id, b.document_id, b.block_type, b.quality_state, b.metadata_json, p.page_number
    FROM blocks b
    LEFT JOIN pages p ON p.page_id = b.page_id
    ORDER BY b.document_id ASC, p.page_number ASC, b.sort_order ASC, b.block_id ASC
  `).all().map((row) => {
    const metadata = parseJson(row.metadata_json, {});
    const contentType = String(metadata.contentType || row.block_type || "");
    return {
      blockId: String(row.block_id || ""),
      documentId: String(row.document_id || ""),
      contentType,
      qualityState: String(row.quality_state || "primary"),
      pageStart: Number(metadata.page_start || row.page_number || 0) || null,
      pageEnd: Number(metadata.page_end || metadata.page_start || row.page_number || 0) || null,
      title: String(metadata.title || ""),
      text: String(metadata.text || "")
    };
  }).filter((block) => block.contentType === "formula" || block.contentType === "exercise" || block.contentType === "example");
}

function objectFromBlock(block, nodes) {
  const node = findNodeForBlock(block, nodes);
  const objectType = block.contentType === "example" ? "example" : block.contentType;
  return {
    objectId: `k12-math:${objectType}:${block.blockId}`,
    documentId: block.documentId,
    structureNodeId: node?.nodeId || "",
    objectType,
    title: objectType === "formula" ? extractFormulaTitle(block.text, block.title) : block.title || labelForType(objectType),
    sourcePage: block.pageStart,
    qualityState: block.qualityState,
    metadata: {
      sourceBlockId: block.blockId,
      contentType: objectType,
      page_start: block.pageStart,
      page_end: block.pageEnd,
      structureNodeType: node?.nodeType || "",
      structureNodeTitle: node?.title || ""
    }
  };
}

function buildFormulaExerciseRelations(objects) {
  const formulas = objects.filter((object) => object.objectType === "formula");
  const exercises = objects.filter((object) => object.objectType === "exercise");
  const relations = [];
  for (const formula of formulas) {
    const exercise = exercises.find((item) => item.documentId === formula.documentId && item.structureNodeId === formula.structureNodeId && item.sourcePage === formula.sourcePage)
      || exercises.find((item) => item.documentId === formula.documentId && item.structureNodeId === formula.structureNodeId);
    if (!exercise) continue;
    const relationType = requireK12RelationType("formula_to_exercise");
    relations.push({
      relationId: `relation:${formula.objectId}:${relationType}:${exercise.objectId}`,
      sourceObjectId: formula.objectId,
      targetObjectId: exercise.objectId,
      relationType,
      documentId: formula.documentId,
      structureNodeId: formula.structureNodeId,
      qualityState: formula.qualityState,
      metadata: {
        sourcePage: formula.sourcePage
      }
    });
  }
  return relations;
}

function findNodeForBlock(block, nodes) {
  return nodes.find((node) => {
    if (node.documentId !== block.documentId) return false;
    if (node.pageStart === null || node.pageEnd === null || block.pageStart === null) return false;
    return block.pageStart >= node.pageStart && block.pageStart <= node.pageEnd;
  }) || null;
}

function writeObjectsAndRelations(db, objects, relations) {
  const upsertObject = db.prepare(`
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
  const upsertRelation = db.prepare(`
    INSERT INTO object_relations (
      relation_id, source_object_id, target_object_id, relation_type,
      document_id, structure_node_id, citation_id, quality_state,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(relation_id) DO UPDATE SET
      source_object_id = excluded.source_object_id,
      target_object_id = excluded.target_object_id,
      relation_type = excluded.relation_type,
      document_id = excluded.document_id,
      structure_node_id = excluded.structure_node_id,
      quality_state = excluded.quality_state,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction(() => {
    const now = nowIso();
    for (const object of objects) {
      upsertObject.run(
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
    for (const relation of relations) {
      upsertRelation.run(
        relation.relationId,
        relation.sourceObjectId,
        relation.targetObjectId,
        relation.relationType,
        relation.documentId,
        relation.structureNodeId || null,
        relation.qualityState,
        JSON.stringify(relation.metadata),
        now,
        now
      );
    }
  });
  write();
}

function extractFormulaTitle(text, fallback) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  const match = compact.match(/[A-Za-z][A-Za-z0-9_]*\s*[=＝]\s*[^。；;\n]{1,32}/);
  return match?.[0] || fallback || "Formula";
}

function labelForType(type) {
  return { exercise: "Exercise", example: "Example", formula: "Formula" }[type] || type;
}

function notApplicableResult(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12MathObjectExtractionResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: knowledgeBase.id || "", template: knowledgeBase.template || "" },
    summary: { status: "not_applicable", blocks: 0, formulas: 0, exercises: 0, relations: 0 },
    objects: []
  };
}

function emptyResult() {
  return {
    ok: false,
    kind: "knowmesh.k12MathObjectExtractionResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", template: "" },
    summary: { status: "empty", blocks: 0, formulas: 0, exercises: 0, relations: 0 },
    objects: []
  };
}
