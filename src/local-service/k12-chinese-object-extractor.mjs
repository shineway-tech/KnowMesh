import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function extractK12ChineseObjectsFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyResult();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableResult(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const lessonObjects = readLessonObjects(db);
    const blocks = readVocabularyBlocks(db);
    const objects = [];
    const relations = [];
    for (const block of blocks) {
      const lesson = findLessonForBlock(block, lessonObjects);
      const terms = parseChineseVocabularyTerms(block.text);
      terms.forEach((term, index) => {
        const object = {
          objectId: `k12-vocabulary:${block.blockId}:${index + 1}`,
          documentId: block.documentId,
          structureNodeId: lesson?.structureNodeId || block.structureNodeId || "",
          objectType: "vocabulary",
          title: term,
          sourcePage: block.pageStart,
          qualityState: block.qualityState,
          metadata: {
            sourceBlockId: block.blockId,
            contentType: "vocabulary",
            termIndex: index + 1,
            page_start: block.pageStart,
            page_end: block.pageEnd
          }
        };
        objects.push(object);
        if (lesson) {
          relations.push({
            relationId: `relation:${object.objectId}:belongs_to_lesson:${lesson.objectId}`,
            sourceObjectId: object.objectId,
            targetObjectId: lesson.objectId,
            relationType: "belongs_to_lesson",
            documentId: block.documentId,
            structureNodeId: lesson.structureNodeId,
            qualityState: block.qualityState,
            metadata: {
              sourceBlockId: block.blockId
            }
          });
        }
      });
    }
    writeObjectsAndRelations(db, objects, relations);
    return {
      ok: true,
      kind: "knowmesh.k12ChineseObjectExtractionResult",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary: {
        blocks: blocks.length,
        vocabulary: objects.length,
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

function readLessonObjects(db) {
  return db.prepare(`
    SELECT object_id, document_id, structure_node_id, title
    FROM knowledge_objects
    WHERE object_type = 'lesson'
    ORDER BY document_id ASC, source_page ASC, object_id ASC
  `).all().map((row) => ({
    objectId: String(row.object_id || ""),
    documentId: String(row.document_id || ""),
    structureNodeId: String(row.structure_node_id || ""),
    title: String(row.title || "")
  }));
}

function readVocabularyBlocks(db) {
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
      structureNodeId: String(metadata.structureNodeId || ""),
      text: String(metadata.text || "")
    };
  }).filter((block) => block.contentType === "vocabulary" || block.contentType === "vocabulary_table");
}

function findLessonForBlock(block, lessonObjects) {
  return lessonObjects.find((lesson) => lesson.documentId === block.documentId && lesson.structureNodeId === block.structureNodeId)
    || lessonObjects.find((lesson) => lesson.documentId === block.documentId)
    || null;
}

function parseChineseVocabularyTerms(text) {
  const withoutHeading = String(text || "").replace(/词语表|生字表|词汇|读读写写/g, " ");
  const terms = withoutHeading.match(/[\u4e00-\u9fff]{2,8}/g) || [];
  return [...new Set(terms.filter((term) => !/^[一二三四五六七八九十]+$/.test(term)))].slice(0, 80);
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

function notApplicableResult(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12ChineseObjectExtractionResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: knowledgeBase.id || "", template: knowledgeBase.template || "" },
    summary: { status: "not_applicable", blocks: 0, vocabulary: 0, relations: 0 },
    objects: []
  };
}

function emptyResult() {
  return {
    ok: false,
    kind: "knowmesh.k12ChineseObjectExtractionResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", template: "" },
    summary: { status: "empty", blocks: 0, vocabulary: 0, relations: 0 },
    objects: []
  };
}
