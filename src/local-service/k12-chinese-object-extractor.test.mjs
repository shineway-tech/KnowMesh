import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { extractK12ChineseObjectsFromCatalog } from "./k12-chinese-object-extractor.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 Chinese extractor writes vocabulary objects and lesson relations without raw text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-chinese-extractor-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-chinese-extractor", name: "K12 Chinese", template: "textbook-cn-k12" });
  writeVocabularyFixture(state, kb.id);

  const result = extractK12ChineseObjectsFromCatalog(state);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.k12ChineseObjectExtractionResult");
  assert.equal(result.summary.vocabulary, 2);
  assert.equal(result.summary.relations, 2);

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const objects = db.prepare("SELECT object_id, object_type, title, structure_node_id, metadata_json FROM knowledge_objects WHERE object_type = 'vocabulary' ORDER BY title ASC").all();
    const relations = db.prepare("SELECT relation_type, source_object_id, target_object_id FROM object_relations ORDER BY target_object_id ASC").all();
    const metadata = JSON.parse(objects[0].metadata_json);

    assert.deepEqual(objects.map((object) => object.title), ["精巧", "配合"]);
    assert.ok(objects.every((object) => object.structure_node_id === "lesson-1"));
    assert.deepEqual(relations.map((relation) => relation.relation_type), ["lesson_to_vocabulary", "lesson_to_vocabulary"]);
    assert.ok(relations.every((relation) => relation.source_object_id === "object-lesson-1"));
    assert.deepEqual(relations.map((relation) => relation.target_object_id), ["k12-vocabulary:block-vocab:1", "k12-vocabulary:block-vocab:2"]);
    assert.equal(metadata.sourceBlockId, "block-vocab");
    assert.equal(metadata.text, undefined);
    assert.doesNotMatch(JSON.stringify(metadata), /private vocabulary text/);
  } finally {
    db.close();
  }
});

function writeVocabularyFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-chinese', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-6', 'doc-k12-chinese', 'ver-k12-chinese', 6, 'artifacts/pages/6.json', 'sha-page', 'completed', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES ('lesson-1', NULL, 'doc-k12-chinese', 'lesson', '白鹭', 1, 2, 6, '第一单元/1 白鹭', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO knowledge_objects (
          object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('object-lesson-1', 'doc-k12-chinese', 'lesson-1', 'lesson', '白鹭', 2, 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('block-vocab', 'page-6', 'doc-k12-chinese', 'vocabulary', 1, 'artifacts/text/vocab.md', 'sha-block', '', 'primary', ?, ?, ?)
      `).run(JSON.stringify({
        contentType: "vocabulary",
        page_start: 6,
        page_end: 6,
        title: "词语表",
        text: "词语表\n精巧 配合\nprivate vocabulary text"
      }), now, now);
    });
    write();
  } finally {
    db.close();
  }
}
