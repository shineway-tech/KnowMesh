import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { extractK12MathObjectsFromCatalog } from "./k12-math-object-extractor.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 math extractor writes formula exercise objects and support relations without raw text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-math-extractor-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-math-extractor", name: "K12 Math", template: "textbook-cn-k12" });
  writeMathFixture(state, kb.id);

  const result = extractK12MathObjectsFromCatalog(state);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.k12MathObjectExtractionResult");
  assert.equal(result.summary.formulas, 1);
  assert.equal(result.summary.exercises, 1);
  assert.equal(result.summary.relations, 1);

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const objects = db.prepare("SELECT object_type, title, metadata_json FROM knowledge_objects WHERE object_id LIKE 'k12-math:%' ORDER BY object_type ASC").all();
    const relation = db.prepare("SELECT relation_type, source_object_id, target_object_id, metadata_json FROM object_relations WHERE relation_type = 'formula_to_exercise'").get();
    const metadata = JSON.parse(objects[0].metadata_json);

    assert.deepEqual(objects.map((object) => object.object_type).sort(), ["exercise", "formula"]);
    assert.ok(objects.some((object) => object.title.includes("S = a")));
    assert.equal(relation.relation_type, "formula_to_exercise");
    assert.match(relation.source_object_id, /formula/);
    assert.match(relation.target_object_id, /exercise/);
    assert.equal(metadata.text, undefined);
    assert.doesNotMatch(JSON.stringify(metadata), /private math text/);
  } finally {
    db.close();
  }
});

function writeMathFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-math', '数学五年级上册', 'pdf', 'source.pdf', '小学/数学/五年级/数学五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-12', 'doc-k12-math', 'ver-k12-math', 12, 'artifacts/pages/12.json', 'sha-page', 'completed', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES ('lesson-math-1', NULL, 'doc-k12-math', 'lesson', '多边形的面积', 1, 10, 16, '第五单元/多边形的面积', '{}', ?, ?)
      `).run(now, now);
      const blockInsert = db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, 'page-12', 'doc-k12-math', ?, ?, 'artifacts/text/math.md', ?, '', 'primary', ?, ?, ?)
      `);
      blockInsert.run("block-formula", "formula", 1, "sha-formula", JSON.stringify({
        contentType: "formula",
        page_start: 12,
        page_end: 12,
        title: "面积公式",
        text: "S = a × h private math text"
      }), now, now);
      blockInsert.run("block-exercise", "exercise", 2, "sha-exercise", JSON.stringify({
        contentType: "exercise",
        page_start: 12,
        page_end: 12,
        title: "练习题",
        text: "练习：求平行四边形面积。private math text"
      }), now, now);
    });
    write();
  } finally {
    db.close();
  }
}
