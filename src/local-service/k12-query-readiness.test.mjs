import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { readK12QueryReadinessFromCatalog } from "./k12-query-readiness.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 query readiness reports structure object relation and evaluation routes without leaking text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-query-ready-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-query-ready", name: "K12 Query Ready", template: "textbook-cn-k12" });
  writeQueryReadinessFixture(state, kb.id, { ready: true });

  const readiness = readK12QueryReadinessFromCatalog(state);

  assert.equal(readiness.ok, true);
  assert.equal(readiness.kind, "knowmesh.k12QueryReadiness");
  assert.equal(readiness.knowledgeBase.id, kb.id);
  assert.equal(readiness.summary.status, "ready");
  assert.equal(readiness.summary.activeDocuments, 1);
  assert.equal(readiness.summary.tocAnchors, 1);
  assert.equal(readiness.summary.objectTypes.vocabulary, 1);
  assert.equal(readiness.summary.relationTypes.lesson_to_vocabulary, 1);
  assert.equal(readiness.routes.firstLessonLookup, "ready");
  assert.equal(readiness.routes.unitLessonLookup, "ready");
  assert.equal(readiness.routes.outOfScopeRefusal, "ready");
  assert.equal(readiness.routes.evaluationClosure, "ready");
  assert.equal(readiness.objectRoutes.vocabularyLookup, "ready");
  assert.equal(readiness.objectRoutes.mathExerciseLookup, "ready");
  assert.equal(readiness.evaluation.coveragePercent, 100);
  assert.deepEqual(readiness.gaps, []);
  assert.doesNotMatch(JSON.stringify(readiness), /private query readiness text/);
  assert.doesNotMatch(JSON.stringify(readiness), /private expected/);
});

test("K12 query readiness reports blocked object and evaluation gaps", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-query-gap-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-query-gap", name: "K12 Query Gap", template: "textbook-cn-k12" });
  writeQueryReadinessFixture(state, kb.id, { ready: false });

  const readiness = readK12QueryReadinessFromCatalog(state);

  assert.equal(readiness.summary.status, "partial");
  assert.equal(readiness.routes.firstLessonLookup, "ready");
  assert.equal(readiness.objectRoutes.vocabularyLookup, "blocked");
  assert.equal(readiness.objectRoutes.mathExerciseLookup, "blocked");
  assert.equal(readiness.routes.evaluationClosure, "blocked");
  assert.ok(readiness.gaps.some((gap) => gap.key === "vocabularyLookup"));
  assert.ok(readiness.gaps.some((gap) => gap.key === "evaluationClosure"));
});

function writeQueryReadinessFixture(state, knowledgeBaseId, options = {}) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-query-ready', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      const nodeInsert = db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-query-ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      nodeInsert.run("unit-1", null, "unit", "第一单元", 1, 1, 36, "第一单元", JSON.stringify({ unitNo: 1 }), now, now);
      nodeInsert.run("lesson-1", "unit-1", "lesson", "白鹭", 1, 2, 6, "第一单元/1 白鹭", JSON.stringify({ unitNo: 1, lessonOrder: 1, education: { unit_no: 1, lesson_order_no: 1 } }), now, now);
      nodeInsert.run("toc-lesson-1", "unit-1", "toc_entry", "1 白鹭", 1, 3, 3, "目录/第一单元/1 白鹭", JSON.stringify({ unitNo: 1, lessonOrder: 1, education: { unit_no: 1, lesson_order_no: 1 } }), now, now);
      if (options.ready) {
        const objectInsert = db.prepare(`
          INSERT INTO knowledge_objects (
            object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
          ) VALUES (?, 'doc-k12-query-ready', ?, ?, ?, ?, 'primary', ?, ?, ?)
        `);
        objectInsert.run("object-lesson-1", "lesson-1", "lesson", "白鹭", 2, JSON.stringify({ note: "private query readiness text" }), now, now);
        objectInsert.run("object-vocabulary-1", "lesson-1", "vocabulary", "精巧", 5, "{}", now, now);
        objectInsert.run("object-formula-1", "lesson-1", "formula", "S = a × h", 8, "{}", now, now);
        objectInsert.run("object-exercise-1", "lesson-1", "exercise", "练习", 9, "{}", now, now);
        const relationInsert = db.prepare(`
          INSERT INTO object_relations (
            relation_id, source_object_id, target_object_id, relation_type, document_id, structure_node_id, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'doc-k12-query-ready', 'lesson-1', '{}', ?, ?)
        `);
        relationInsert.run("rel-lesson-vocabulary", "object-lesson-1", "object-vocabulary-1", "lesson_to_vocabulary", now, now);
        relationInsert.run("rel-formula-exercise", "object-formula-1", "object-exercise-1", "formula_to_exercise", now, now);
        db.prepare(`
          INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
          VALUES ('build-query-ready', 'active', 1, '', '{}', ?, ?)
        `).run(now, now);
        db.prepare(`
          INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
          VALUES ('case-query-ready', 'textbook-cn-k12', 'toc_lookup', 'private query readiness text', '{"answer":"private expected"}', 1, ?, ?)
        `).run(now, now);
        db.prepare(`
          INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
          VALUES ('result-query-ready', 'case-query-ready', 'build-query-ready', 'pass', '{"score":1,"citationBearing":true}', '{}', ?, ?)
        `).run(now, now);
      }
    });
    write();
  } finally {
    db.close();
  }
}
