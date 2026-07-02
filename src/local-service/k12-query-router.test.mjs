import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { routeK12QueryFromCatalog } from "./k12-query-router.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 query router answers unit first-lesson and vocabulary intents from catalog structure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-query-router-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-query-router", name: "K12 Query Router", template: "textbook-cn-k12" });
  writeK12QueryFixture(state, kb.id);

  const firstLesson = routeK12QueryFromCatalog(state, {
    question: "五年级统编版语文第三单元第一课是什么？"
  });
  const vocabulary = routeK12QueryFromCatalog(state, {
    question: "五年级统编版语文第三单元猎人海力布有哪些词语？"
  });

  assert.equal(firstLesson.ok, true);
  assert.equal(firstLesson.status, "evidence_found");
  assert.equal(firstLesson.route.intent, "first_lesson_lookup");
  assert.deepEqual(firstLesson.citations.map((item) => item.metadata.lessonTitle), ["猎人海力布"]);
  assert.equal(firstLesson.citations[0].pageNumber, 24);
  assert.equal(firstLesson.citations[0].metadata.contentType, "toc_entry");
  assert.doesNotMatch(JSON.stringify(firstLesson), /private/);

  assert.equal(vocabulary.ok, true);
  assert.equal(vocabulary.status, "evidence_found");
  assert.equal(vocabulary.route.intent, "vocabulary_lookup");
  assert.deepEqual(vocabulary.citations.map((item) => item.metadata.objectTitle), ["精巧", "配合"]);
  assert.ok(vocabulary.citations.every((item) => item.metadata.objectType === "vocabulary"));
  assert.ok(vocabulary.citations.every((item) => item.metadata.lessonTitle === "猎人海力布"));
  assert.doesNotMatch(JSON.stringify(vocabulary), /private/);
});

test("K12 query router uses domain objects for math formulas and exercises", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-query-router-math-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-query-router-math", name: "K12 Query Router Math", template: "textbook-cn-k12" });
  writeK12QueryFixture(state, kb.id);

  const result = routeK12QueryFromCatalog(state, {
    question: "五年级人教版数学第五单元有哪些公式和练习？"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "evidence_found");
  assert.equal(result.route.intent, "exercise_example_lookup");
  assert.deepEqual(result.citations.map((item) => item.metadata.objectType).sort(), ["exercise", "formula"]);
  assert.ok(result.citations.some((item) => item.metadata.relations.some((relation) => relation.type === "formula_to_exercise")));
  assert.ok(result.citations.every((item) => item.metadata.subject === "数学"));
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test("K12 query router refuses clearly out-of-scope subjects before retrieval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-query-router-scope-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-query-router-scope", name: "K12 Query Router Scope", template: "textbook-cn-k12" });
  writeChineseOnlyFixture(state, kb.id);

  const result = routeK12QueryFromCatalog(state, {
    question: "五年级人教版数学第三单元第一课是什么？"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "out_of_scope");
  assert.equal(result.route.intent, "out_of_scope");
  assert.deepEqual(result.citations, []);
  assert.equal(result.retrieval.scanned, 0);
});

function writeK12QueryFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      insertDocument(db, {
        id: "doc-chinese-g5-v1",
        title: "义务教育教科书·语文五年级上册",
        path: "小学/语文/统编版/义务教育教科书·语文五年级上册.pdf",
        metadata: { education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册" } },
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
        metadata: { unitNo: 3, education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册", unit_no: 3 } },
        now
      });
      insertNode(db, {
        id: "toc-chinese-u3-l1",
        parentId: "unit-chinese-3",
        documentId: "doc-chinese-g5-v1",
        type: "toc_entry",
        title: "猎人海力布",
        sortOrder: 1,
        pageStart: 24,
        pageEnd: 24,
        path: "目录/第三单元/1 猎人海力布",
        metadata: {
          unitNo: 3,
          lessonOrder: 1,
          lessonTitle: "猎人海力布",
          education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册", unit_no: 3, lesson_order_no: 1 }
        },
        now
      });
      insertNode(db, {
        id: "lesson-chinese-u3-l1",
        parentId: "unit-chinese-3",
        documentId: "doc-chinese-g5-v1",
        type: "lesson",
        title: "猎人海力布",
        sortOrder: 1,
        pageStart: 24,
        pageEnd: 31,
        path: "第三单元/1 猎人海力布",
        metadata: {
          unitNo: 3,
          lessonOrder: 1,
          lessonTitle: "猎人海力布",
          education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册", unit_no: 3, lesson_order_no: 1 }
        },
        now
      });
      insertObject(db, {
        id: "object-lesson-hunter",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-u3-l1",
        type: "lesson",
        title: "猎人海力布",
        page: 24,
        metadata: { unitNo: 3, lessonOrder: 1 },
        now
      });
      insertObject(db, {
        id: "object-vocab-jingqiao",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-u3-l1",
        type: "vocabulary",
        title: "精巧",
        page: 28,
        metadata: { sourceBlockId: "block-vocab", privateText: undefined },
        now
      });
      insertObject(db, {
        id: "object-vocab-peihe",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-u3-l1",
        type: "vocabulary",
        title: "配合",
        page: 28,
        metadata: { sourceBlockId: "block-vocab", privateText: undefined },
        now
      });
      insertRelation(db, {
        id: "rel-vocab-jingqiao",
        sourceId: "object-lesson-hunter",
        targetId: "object-vocab-jingqiao",
        type: "lesson_to_vocabulary",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-u3-l1",
        now
      });
      insertRelation(db, {
        id: "rel-vocab-peihe",
        sourceId: "object-lesson-hunter",
        targetId: "object-vocab-peihe",
        type: "lesson_to_vocabulary",
        documentId: "doc-chinese-g5-v1",
        nodeId: "lesson-chinese-u3-l1",
        now
      });

      insertDocument(db, {
        id: "doc-math-g5-v1",
        title: "义务教育教科书·数学五年级上册",
        path: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
        metadata: { education: { stage: "小学", grade: "五年级", subject: "数学", publisher: "人教版", volume: "上册" } },
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
        metadata: { unitNo: 5, education: { stage: "小学", grade: "五年级", subject: "数学", publisher: "人教版", volume: "上册", unit_no: 5 } },
        now
      });
      insertObject(db, {
        id: "object-math-formula-area",
        documentId: "doc-math-g5-v1",
        nodeId: "unit-math-5",
        type: "formula",
        title: "S = a × h",
        page: 86,
        metadata: { formula: "S = a × h" },
        now
      });
      insertObject(db, {
        id: "object-math-exercise-area",
        documentId: "doc-math-g5-v1",
        nodeId: "unit-math-5",
        type: "exercise",
        title: "平行四边形面积练习",
        page: 88,
        metadata: { concept: "平行四边形面积" },
        now
      });
      insertRelation(db, {
        id: "rel-formula-exercise",
        sourceId: "object-math-formula-area",
        targetId: "object-math-exercise-area",
        type: "formula_to_exercise",
        documentId: "doc-math-g5-v1",
        nodeId: "unit-math-5",
        now
      });
    });
    write();
  } finally {
    db.close();
  }
}

function writeChineseOnlyFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    insertDocument(db, {
      id: "doc-chinese-only",
      title: "义务教育教科书·语文五年级上册",
      path: "小学/语文/统编版/义务教育教科书·语文五年级上册.pdf",
      metadata: { education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册" } },
      now
    });
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
  `).run(
    input.id,
    input.title,
    input.path,
    input.path,
    `sha-${input.id}`,
    JSON.stringify(input.metadata || {}),
    input.now,
    input.now
  );
}

function insertNode(db, input) {
  db.prepare(`
    INSERT INTO structure_nodes (
      node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
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
    input.path || "",
    JSON.stringify(input.metadata || {}),
    input.now,
    input.now
  );
}

function insertObject(db, input) {
  db.prepare(`
    INSERT INTO knowledge_objects (
      object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'primary', ?, ?, ?)
  `).run(
    input.id,
    input.documentId,
    input.nodeId || null,
    input.type,
    input.title,
    input.page ?? null,
    JSON.stringify(input.metadata || {}),
    input.now,
    input.now
  );
}

function insertRelation(db, input) {
  db.prepare(`
    INSERT INTO object_relations (
      relation_id, source_object_id, target_object_id, relation_type, document_id, structure_node_id, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(
    input.id,
    input.sourceId,
    input.targetId,
    input.type,
    input.documentId,
    input.nodeId || null,
    input.now,
    input.now
  );
}
