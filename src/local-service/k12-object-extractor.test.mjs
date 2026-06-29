import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { extractK12ObjectsFromCatalog } from "./k12-object-extractor.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 object extractor writes classified block objects linked to lesson nodes without text payload", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-object-extractor-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-object-extractor", name: "K12 Objects", template: "textbook-cn-k12" });
  writeClassifiedBlockFixture(state, kb.id);

  const result = extractK12ObjectsFromCatalog(state);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.k12ObjectExtractionResult");
  assert.equal(result.summary.objects, 1);
  assert.equal(result.objects[0].objectType, "exercise");
  assert.equal(result.objects[0].structureNodeId, "lesson-1");

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const row = db.prepare("SELECT object_type, title, structure_node_id, source_page, metadata_json FROM knowledge_objects WHERE object_id = ?")
      .get("k12-object:block-exercise");
    const metadata = JSON.parse(row.metadata_json);

    assert.equal(row.object_type, "exercise");
    assert.equal(row.structure_node_id, "lesson-1");
    assert.equal(row.source_page, 5);
    assert.equal(metadata.sourceBlockId, "block-exercise");
    assert.equal(metadata.text, undefined);
    assert.equal(metadata.textPreview, undefined);
    assert.doesNotMatch(JSON.stringify(metadata), /private exercise text/);
  } finally {
    db.close();
  }
});

function writeClassifiedBlockFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-objects', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-5', 'doc-k12-objects', 'ver-k12-objects', 5, 'artifacts/pages/5.json', 'sha-page', 'completed', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES ('lesson-1', NULL, 'doc-k12-objects', 'lesson', '白鹭', 1, 2, 6, '第一单元/1 白鹭', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('block-exercise', 'page-5', 'doc-k12-objects', 'exercise', 1, 'artifacts/text/lesson.md', 'sha-block', '', 'primary', ?, ?, ?)
      `).run(JSON.stringify({
        contentType: "exercise",
        page_start: 5,
        page_end: 5,
        title: "课后练习",
        text: "private exercise text"
      }), now, now);
    });
    write();
  } finally {
    db.close();
  }
}
