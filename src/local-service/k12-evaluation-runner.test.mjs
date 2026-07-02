import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { readK12EvaluationManifestFromCatalog } from "./k12-evaluation-manifest.mjs";
import { k12RequiredEvaluationCases, runK12CatalogEvaluation, seedK12EvaluationCases } from "./k12-evaluation-runner.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 evaluation runner seeds required cases and writes safe build results", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-evaluation-runner-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-evaluation-runner", name: "K12 Evaluation Runner", template: "textbook-cn-k12" });
  writeK12EvaluationRouteFixture(state, kb.id);

  const seed = seedK12EvaluationCases(state);
  const run = runK12CatalogEvaluation(state);
  const manifest = readK12EvaluationManifestFromCatalog(state);

  assert.equal(seed.ok, true);
  assert.equal(seed.requiredCases, k12RequiredEvaluationCases.length);
  assert.equal(seed.seeded, k12RequiredEvaluationCases.length);
  assert.deepEqual(seed.categories, [
    "toc_lookup",
    "unit_lesson_lookup",
    "vocabulary_lookup",
    "writing_oral_communication_lookup",
    "math_concept_lookup",
    "math_example_lookup",
    "english_unit_theme",
    "english_vocabulary",
    "science_experiment",
    "page_citation",
    "cross_volume_comparison",
    "publisher_comparison",
    "out_of_scope_refusal",
    "no_answer_behavior"
  ]);

  assert.equal(run.ok, true);
  assert.equal(run.buildId, "build-k12-evaluation-runner");
  assert.equal(run.summary.cases, k12RequiredEvaluationCases.length);
  assert.ok(run.summary.passed >= 4);
  assert.ok(run.summary.failed >= 1);
  assert.equal(run.categories.out_of_scope_refusal.passed, 1);
  assert.equal(run.categories.no_answer_behavior.passed, 1);

  assert.equal(manifest.summary.cases, k12RequiredEvaluationCases.length);
  assert.equal(manifest.summary.results, k12RequiredEvaluationCases.length);
  assert.equal(manifest.summary.coveragePercent, 100);
  assert.equal(manifest.summary.categories.out_of_scope_refusal.passed, 1);
  assert.equal(manifest.summary.requiredGates.evaluationCoverage, "pass");
  assert.doesNotMatch(JSON.stringify(manifest), /猎人海力布有哪些词语/);
  assert.doesNotMatch(JSON.stringify(manifest), /expectedStatus/);

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const rows = db.prepare("SELECT status, scores_json, details_json FROM evaluation_results ORDER BY result_id ASC").all();
    assert.equal(rows.length, k12RequiredEvaluationCases.length);
    assert.ok(rows.some((row) => row.status === "pass"));
    assert.ok(rows.some((row) => row.status === "fail"));
    assert.ok(rows.some((row) => JSON.parse(row.scores_json).citationBearing === true));
    assert.doesNotMatch(JSON.stringify(rows.map((row) => JSON.parse(row.details_json))), /五年级统编版/);
    assert.doesNotMatch(JSON.stringify(rows.map((row) => JSON.parse(row.details_json))), /猎人海力布/);
  } finally {
    db.close();
  }
});

test("K12 evaluation runner only seeds cases when no active build exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-evaluation-no-build-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-evaluation-no-build", name: "K12 Evaluation No Build", template: "textbook-cn-k12" });

  const run = runK12CatalogEvaluation(state);
  const manifest = readK12EvaluationManifestFromCatalog(state);

  assert.equal(run.ok, false);
  assert.equal(run.status, "missing_active_build");
  assert.equal(manifest.summary.cases, k12RequiredEvaluationCases.length);
  assert.equal(manifest.summary.results, 0);
  assert.equal(manifest.summary.status, "partial");

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) AS count FROM evaluation_cases WHERE active = 1").get().count, k12RequiredEvaluationCases.length);
    assert.equal(db.prepare("SELECT count(*) AS count FROM evaluation_results").get().count, 0);
  } finally {
    db.close();
  }
});

function writeK12EvaluationRouteFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-k12-evaluation-runner', 'active', 1, '', '{}', ?, ?)
      `).run(now, now);
      insertDocument(db, {
        id: "doc-chinese-g5-v1",
        title: "义务教育教科书·语文五年级上册",
        path: "小学/语文/统编版/义务教育教科书·语文五年级上册.pdf",
        education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册" },
        now
      });
      insertDocument(db, {
        id: "doc-chinese-g5-v2",
        title: "义务教育教科书·语文五年级下册",
        path: "小学/语文/统编版/义务教育教科书·语文五年级下册.pdf",
        education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "下册" },
        now
      });
      insertDocument(db, {
        id: "doc-math-g5-v1",
        title: "义务教育教科书·数学五年级上册",
        path: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
        education: { stage: "小学", grade: "五年级", subject: "数学", publisher: "人教版", volume: "上册" },
        now
      });
      insertNode(db, {
        id: "unit-chinese-3",
        documentId: "doc-chinese-g5-v1",
        type: "unit",
        title: "第三单元",
        sortOrder: 3,
        pageStart: 24,
        pageEnd: 45,
        path: "第三单元",
        education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册", unit_no: 3 },
        now
      });
      insertNode(db, {
        id: "toc-chinese-v1-u3-l1",
        parentId: "unit-chinese-3",
        documentId: "doc-chinese-g5-v1",
        type: "toc_entry",
        title: "猎人海力布",
        sortOrder: 1,
        pageStart: 24,
        pageEnd: 24,
        path: "目录/第三单元/1 猎人海力布",
        education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册", unit_no: 3, lesson_order_no: 1, lesson_title: "猎人海力布" },
        now
      });
      insertNode(db, {
        id: "lesson-chinese-v1-u3-l1",
        parentId: "unit-chinese-3",
        documentId: "doc-chinese-g5-v1",
        type: "lesson",
        title: "猎人海力布",
        sortOrder: 1,
        pageStart: 24,
        pageEnd: 31,
        path: "第三单元/1 猎人海力布",
        education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册", unit_no: 3, lesson_order_no: 1, lesson_title: "猎人海力布" },
        now
      });
      insertNode(db, {
        id: "toc-chinese-v2-u3-l1",
        documentId: "doc-chinese-g5-v2",
        type: "toc_entry",
        title: "汉字真有趣",
        sortOrder: 1,
        pageStart: 42,
        pageEnd: 42,
        path: "目录/第三单元/1 汉字真有趣",
        education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "下册", unit_no: 3, lesson_order_no: 1, lesson_title: "汉字真有趣" },
        now
      });
      insertNode(db, {
        id: "unit-math-5",
        documentId: "doc-math-g5-v1",
        type: "unit",
        title: "第五单元 多边形的面积",
        sortOrder: 5,
        pageStart: 80,
        pageEnd: 103,
        path: "第五单元/多边形的面积",
        education: { stage: "小学", grade: "五年级", subject: "数学", publisher: "人教版", volume: "上册", unit_no: 5 },
        now
      });
      insertObject(db, {
        id: "object-lesson-hunter",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-v1-u3-l1",
        type: "lesson",
        title: "猎人海力布",
        page: 24,
        now
      });
      insertObject(db, {
        id: "object-vocabulary-jingqiao",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-v1-u3-l1",
        type: "vocabulary",
        title: "精巧",
        page: 28,
        now
      });
      insertObject(db, {
        id: "object-math-formula",
        documentId: "doc-math-g5-v1",
        nodeId: "unit-math-5",
        type: "formula",
        title: "S = a × h",
        page: 86,
        now
      });
      insertObject(db, {
        id: "object-math-exercise",
        documentId: "doc-math-g5-v1",
        nodeId: "unit-math-5",
        type: "exercise",
        title: "平行四边形面积练习",
        page: 88,
        now
      });
      insertRelation(db, "rel-lesson-vocab", "object-lesson-hunter", "object-vocabulary-jingqiao", "lesson_to_vocabulary", "doc-chinese-g5-v1", "lesson-chinese-v1-u3-l1", now);
      insertRelation(db, "rel-formula-exercise", "object-math-formula", "object-math-exercise", "formula_to_exercise", "doc-math-g5-v1", "unit-math-5", now);
    });
    write();
  } finally {
    db.close();
  }
}

function insertDocument(db, input) {
  db.prepare(`
    INSERT INTO source_documents (
      document_id, title, source_type, original_path, normalized_relative_path,
      content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, 'pdf', ?, ?, ?, 'windows', 'active', 'primary', ?, ?, ?)
  `).run(input.id, input.title, input.path, input.path, `sha-${input.id}`, JSON.stringify({ education: input.education }), input.now, input.now);
}

function insertNode(db, input) {
  db.prepare(`
    INSERT INTO structure_nodes (
      node_id, parent_id, document_id, node_type, title, sort_order,
      page_start, page_end, path, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.parentId || null,
    input.documentId,
    input.type,
    input.title,
    input.sortOrder || 0,
    input.pageStart ?? null,
    input.pageEnd ?? null,
    input.path,
    JSON.stringify({
      unitNo: input.education?.unit_no || null,
      lessonOrder: input.education?.lesson_order_no || null,
      lessonTitle: input.education?.lesson_title || "",
      education: input.education
    }),
    input.now,
    input.now
  );
}

function insertObject(db, input) {
  db.prepare(`
    INSERT INTO knowledge_objects (
      object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'primary', '{}', ?, ?)
  `).run(input.id, input.documentId, input.nodeId || null, input.type, input.title, input.page ?? null, input.now, input.now);
}

function insertRelation(db, id, sourceId, targetId, type, documentId, nodeId, now) {
  db.prepare(`
    INSERT INTO object_relations (
      relation_id, source_object_id, target_object_id, relation_type, document_id, structure_node_id, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(id, sourceId, targetId, type, documentId, nodeId || null, now, now);
}
