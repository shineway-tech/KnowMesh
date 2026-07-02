import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { readK12ExpertReadinessFromCatalog } from "./k12-expert-readiness.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 expert readiness summarizes catalog structure retrieval version and evaluation without leaking text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-readiness-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-readiness", name: "K12 Readiness", template: "textbook-cn-k12" });
  writeReadyK12CatalogFixture(state, kb.id);

  const readiness = readK12ExpertReadinessFromCatalog(state);

  assert.equal(readiness.ok, true);
  assert.equal(readiness.kind, "knowmesh.k12ExpertReadiness");
  assert.equal(readiness.phase, "phase3-k12-expert");
  assert.equal(readiness.knowledgeBase.id, kb.id);
  assert.equal(readiness.knowledgeBase.template, "textbook-cn-k12");
  assert.deepEqual(readiness.knowledgeBase.expert, {
    id: "k12",
    templateId: "textbook-cn-k12",
    name: "KnowMesh Expert · K12",
    status: "alpha",
    lifecycle: {
      stage: "official",
      since: "0.1.0-alpha",
      graduation: "K12 is the first official Expert scenario maintained with Core."
    },
    manifestVersion: "1.0.0",
    capabilities: [
      "schema",
      "sourceScopeGate",
      "pageClassifier",
      "structureBuilder",
      "objectExtractor",
      "queryRouter",
      "evaluationSet"
    ],
    supportedSourceTypes: ["pdf", "office", "wps", "markdown", "text", "image"],
    gates: ["sourceScope", "structureCompleteness", "citationCoverage", "outOfScopeRefusal", "displaySerialization"]
  });
  assert.deepEqual(readiness.summary.expertCapabilities, [
    "schema",
    "sourceScopeGate",
    "pageClassifier",
    "structureBuilder",
    "objectExtractor",
    "queryRouter",
    "evaluationSet"
  ]);
  assert.equal(readiness.summary.status, "ready");
  assert.equal(readiness.summary.documents, 1);
  assert.equal(readiness.summary.structureNodes, 3);
  assert.equal(readiness.summary.units, 1);
  assert.equal(readiness.summary.lessons, 1);
  assert.equal(readiness.summary.tocEntries, 1);
  assert.equal(readiness.summary.knowledgeObjects, 4);
  assert.equal(readiness.summary.chunks, 2);
  assert.equal(readiness.summary.indexedChunks, 2);
  assert.equal(readiness.summary.evaluationCases, 3);
  assert.equal(readiness.summary.evaluationResults, 3);
  assert.equal(readiness.summary.passedEvaluationResults, 2);
  assert.equal(readiness.summary.activeBuildId, "build-k12-ready");
  assert.deepEqual(readiness.summary.gates, {
    sourceScope: "pass",
    tocStructure: "pass",
    domainObjects: "pass",
    retrieval: "pass",
    evaluation: "pass"
  });
  assert.deepEqual(readiness.dimensions.stage, ["小学"]);
  assert.deepEqual(readiness.dimensions.subject, ["语文"]);
  assert.deepEqual(readiness.dimensions.grade, ["五年级"]);
  assert.deepEqual(readiness.dimensions.volume, ["上册"]);
  assert.deepEqual(readiness.dimensions.publisher, ["人民教育出版社"]);
  assert.deepEqual(readiness.dimensions.bookTitle, ["语文五年级上册"]);
  assert.deepEqual(readiness.gaps, []);
  assert.doesNotMatch(JSON.stringify(readiness), /private source excerpt/);
  assert.doesNotMatch(JSON.stringify(readiness), /sk-test/);
});

test("K12 expert readiness stays not applicable for non K12 knowledge bases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-readiness-general-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-general-readiness", name: "General", template: "general-docs" });

  const readiness = readK12ExpertReadinessFromCatalog(state);

  assert.equal(readiness.ok, true);
  assert.equal(readiness.kind, "knowmesh.k12ExpertReadiness");
  assert.equal(readiness.summary.status, "not_applicable");
  assert.equal(readiness.knowledgeBase.id, kb.id);
  assert.equal(readiness.knowledgeBase.template, "general-docs");
  assert.equal(readiness.knowledgeBase.expert, null);
  assert.deepEqual(readiness.summary.expertCapabilities, []);
  assert.deepEqual(readiness.gaps, []);
});

function writeReadyK12CatalogFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO setup_state (id, draft_json, updated_at)
        VALUES (1, ?, ?)
      `).run(JSON.stringify({
        "project.template": "textbook-cn-k12",
        "metadata.stage": ["小学"],
        "metadata.subject": ["语文"],
        "metadata.grade": ["五年级"],
        "metadata.volume": ["上册"],
        "metadata.publisher": "人民教育出版社"
      }), now);
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-ready', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', ?, ?, ?)
      `).run(JSON.stringify({
        education: {
          stage: "小学",
          subject: "语文",
          grade: "五年级",
          volume: "上册",
          publisher: "人民教育出版社",
          bookTitle: "语文五年级上册"
        },
        privateNote: "private source excerpt"
      }), now, now);
      db.prepare(`
        INSERT INTO document_versions (
          version_id, document_id, display_version, content_hash, artifact_path, status, metadata_json, created_at, updated_at
        ) VALUES ('ver-k12-ready', 'doc-k12-ready', 'v1.0.0', 'sha-ver', 'artifacts/source.pdf', 'active', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-toc', 'doc-k12-ready', 'ver-k12-ready', 3, 'artifacts/pages/3.json', 'sha-page', 'completed', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('block-toc', 'page-toc', 'doc-k12-ready', 'toc_entry', 1, 'artifacts/text/toc.md', 'sha-block', '第一单元/1 白鹭', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("unit-1", null, "unit", "第一单元", 1, 1, 30, "第一单元", JSON.stringify({ unit: 1 }), now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("lesson-1", "unit-1", "lesson", "白鹭", 2, 2, 6, "第一单元/1 白鹭", JSON.stringify({ lessonOrder: 1 }), now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-ready', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("toc-lesson-1", "unit-1", "toc_entry", "1 白鹭", 3, 3, 3, "目录/第一单元/1 白鹭", JSON.stringify({ contentType: "toc_entry" }), now, now);
      const objectInsert = db.prepare(`
        INSERT INTO knowledge_objects (
          object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, 'doc-k12-ready', ?, ?, ?, ?, 'primary', ?, ?, ?)
      `);
      objectInsert.run("object-book", "unit-1", "book", "语文五年级上册", 1, "{}", now, now);
      objectInsert.run("object-unit", "unit-1", "unit", "第一单元", 1, "{}", now, now);
      objectInsert.run("object-lesson", "lesson-1", "lesson", "白鹭", 2, "{}", now, now);
      objectInsert.run("object-vocabulary", "lesson-1", "vocabulary", "精巧", 5, JSON.stringify({ private: "private source excerpt" }), now, now);
      const chunkInsert = db.prepare(`
        INSERT INTO chunks (
          chunk_id, document_id, object_id, block_id, structure_node_id, text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, 'doc-k12-ready', ?, 'block-toc', ?, ?, ?, ?, 'primary', ?, ?, ?)
      `);
      chunkInsert.run("chunk-toc", "object-lesson", "toc-lesson-1", "artifacts/chunks/toc.md", "sha-chunk-toc", 80, JSON.stringify({ content_type: "toc_entry" }), now, now);
      chunkInsert.run("chunk-lesson", "object-lesson", "lesson-1", "artifacts/chunks/lesson.md", "sha-chunk-lesson", 240, JSON.stringify({ education: { lesson_title: "白鹭" } }), now, now);
      const citationInsert = db.prepare(`
        INSERT INTO citations (
          citation_id, chunk_id, document_id, page_id, block_id, structure_node_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'doc-k12-ready', 'page-toc', 'block-toc', ?, '语文五年级上册', ?, ?, '{}', ?, ?)
      `);
      citationInsert.run("citation-toc", "chunk-toc", "toc-lesson-1", 3, "p3", now, now);
      citationInsert.run("citation-lesson", "chunk-lesson", "lesson-1", 5, "p5", now, now);
      const indexInsert = db.prepare(`
        INSERT INTO index_records (
          record_id, chunk_id, provider, index_name, status, vector_id, keyword_key, structure_key, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'aliyun-oss-vector', 'k12ready', 'written', ?, ?, ?, ?, ?, ?)
      `);
      indexInsert.run("index-toc", "chunk-toc", "vector-toc", "keyword-toc", "structure-toc", "{}", now, now);
      indexInsert.run("index-lesson", "chunk-lesson", "vector-lesson", "keyword-lesson", "structure-lesson", "{}", now, now);
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-k12-ready', 'active', 1, '', ?, ?, ?)
      `).run(JSON.stringify({ secret: "sk-test" }), now, now);
      db.prepare(`
        INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
        VALUES ('release-k12-ready', 'build-k12-ready', 'active', 'published/k12-ready/manifest.json', '{}', ?, ?)
      `).run(now, now);
      const caseInsert = db.prepare(`
        INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
        VALUES (?, 'textbook-cn-k12', ?, ?, '{}', 1, ?, ?)
      `);
      caseInsert.run("case-toc", "toc_lookup", "第一单元第一课是什么", now, now);
      caseInsert.run("case-unit", "unit_lesson_lookup", "第一单元有哪些课文", now, now);
      caseInsert.run("case-refusal", "out_of_scope_refusal", "六年级数学问题", now, now);
      const resultInsert = db.prepare(`
        INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
        VALUES (?, ?, 'build-k12-ready', ?, ?, ?, ?, ?)
      `);
      resultInsert.run("result-toc", "case-toc", "pass", JSON.stringify({ score: 0.98 }), JSON.stringify({ excerpt: "private source excerpt" }), now, now);
      resultInsert.run("result-unit", "case-unit", "pass", JSON.stringify({ score: 0.9 }), "{}", now, now);
      resultInsert.run("result-refusal", "case-refusal", "fail", JSON.stringify({ score: 0.3 }), "{}", now, now);
    });
    write();
  } finally {
    db.close();
  }
}
