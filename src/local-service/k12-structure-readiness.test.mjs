import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { readK12StructureReadinessFromCatalog } from "./k12-structure-readiness.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 structure readiness exposes TOC unit and lesson routes from catalog sidecar rows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-structure-ready-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-structure-ready", name: "K12 Structure", template: "textbook-cn-k12" });
  writeStructureFixture(state, kb.id, { includeToc: true, lessonPageEnd: 6 });

  const readiness = readK12StructureReadinessFromCatalog(state);

  assert.equal(readiness.ok, true);
  assert.equal(readiness.kind, "knowmesh.k12StructureReadiness");
  assert.equal(readiness.knowledgeBase.id, kb.id);
  assert.equal(readiness.summary.status, "ready");
  assert.equal(readiness.summary.documents, 1);
  assert.equal(readiness.summary.units, 1);
  assert.equal(readiness.summary.lessons, 2);
  assert.equal(readiness.summary.tocEntries, 2);
  assert.equal(readiness.summary.tocCompletenessTarget, 0.95);
  assert.equal(readiness.summary.tocCompletenessRate, 1);
  assert.equal(readiness.summary.tocCompletenessPercent, 100);
  assert.deepEqual(readiness.summary.requiredGates, {
    tocCompleteness: "pass",
    lessonPageRanges: "pass",
    unitLessonLinks: "pass"
  });
  assert.equal(readiness.summary.lessonsWithPageRange, 2);
  assert.equal(readiness.summary.lessonsWithChunks, 2);
  assert.equal(readiness.summary.lessonsWithCitations, 2);
  assert.deepEqual(readiness.summary.queryRoutes, {
    tocLookup: "ready",
    unitLessonLookup: "ready",
    firstLessonLookup: "ready"
  });
  assert.equal(readiness.documents[0].units[0].firstLesson.title, "白鹭");
  assert.deepEqual(readiness.documents[0].units[0].lessons.map((lesson) => lesson.title), ["白鹭", "落花生"]);
  assert.deepEqual(readiness.gaps, []);
  assert.doesNotMatch(JSON.stringify(readiness), /private source excerpt/);
});

test("K12 structure readiness reports gaps when TOC or lesson page ranges are missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-structure-gap-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-structure-gap", name: "K12 Structure Gap", template: "textbook-cn-k12" });
  writeStructureFixture(state, kb.id, { includeToc: false, lessonPageEnd: null });

  const readiness = readK12StructureReadinessFromCatalog(state);

  assert.equal(readiness.summary.status, "partial");
  assert.equal(readiness.summary.tocCompletenessRate, 0);
  assert.equal(readiness.summary.requiredGates.tocCompleteness, "fail");
  assert.equal(readiness.summary.queryRoutes.tocLookup, "blocked");
  assert.equal(readiness.summary.queryRoutes.unitLessonLookup, "blocked");
  assert.ok(readiness.gaps.some((gap) => gap.key === "tocCompleteness"));
  assert.ok(readiness.gaps.some((gap) => gap.key === "tocEntries"));
  assert.ok(readiness.gaps.some((gap) => gap.key === "lessonPageRanges"));
});

function writeStructureFixture(state, knowledgeBaseId, options = {}) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-structure', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      const nodeInsert = db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-structure', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      nodeInsert.run("unit-1", null, "unit", "第一单元", 1, 1, 36, "第一单元", JSON.stringify({ unit: 1 }), now, now);
      nodeInsert.run("lesson-1", "unit-1", "lesson", "白鹭", 1, 2, options.lessonPageEnd, "第一单元/1 白鹭", JSON.stringify({ lessonOrder: 1 }), now, now);
      nodeInsert.run("lesson-2", "unit-1", "lesson", "落花生", 2, 7, 11, "第一单元/2 落花生", JSON.stringify({ lessonOrder: 2 }), now, now);
      if (options.includeToc) {
        nodeInsert.run("toc-lesson-1", "unit-1", "toc_entry", "1 白鹭", 1, 3, 3, "目录/第一单元/1 白鹭", JSON.stringify({ lessonNodeId: "lesson-1" }), now, now);
        nodeInsert.run("toc-lesson-2", "unit-1", "toc_entry", "2 落花生", 2, 3, 3, "目录/第一单元/2 落花生", JSON.stringify({ lessonNodeId: "lesson-2" }), now, now);
      }
      const objectInsert = db.prepare(`
        INSERT INTO knowledge_objects (
          object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, 'doc-k12-structure', ?, ?, ?, ?, 'primary', ?, ?, ?)
      `);
      objectInsert.run("object-unit-1", "unit-1", "unit", "第一单元", 1, "{}", now, now);
      objectInsert.run("object-lesson-1", "lesson-1", "lesson", "白鹭", 2, JSON.stringify({ private: "private source excerpt" }), now, now);
      objectInsert.run("object-lesson-2", "lesson-2", "lesson", "落花生", 7, "{}", now, now);
      const chunkInsert = db.prepare(`
        INSERT INTO chunks (
          chunk_id, document_id, object_id, block_id, structure_node_id, text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, 'doc-k12-structure', ?, NULL, ?, ?, ?, 120, 'primary', '{}', ?, ?)
      `);
      chunkInsert.run("chunk-lesson-1", "object-lesson-1", "lesson-1", "artifacts/chunks/lesson-1.md", "sha-chunk-1", now, now);
      chunkInsert.run("chunk-lesson-2", "object-lesson-2", "lesson-2", "artifacts/chunks/lesson-2.md", "sha-chunk-2", now, now);
      const citationInsert = db.prepare(`
        INSERT INTO citations (
          citation_id, chunk_id, document_id, page_id, block_id, structure_node_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-structure', NULL, NULL, ?, '语文五年级上册', ?, ?, '{}', ?, ?)
      `);
      citationInsert.run("citation-lesson-1", "chunk-lesson-1", "lesson-1", 2, "p2", now, now);
      citationInsert.run("citation-lesson-2", "chunk-lesson-2", "lesson-2", 7, "p7", now, now);
    });
    write();
  } finally {
    db.close();
  }
}
