import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { confirmTargetedRerunJob, latestJob } from "./jobs.mjs";
import { catalogDatabasePath } from "./storage.mjs";
import { filterScanForTargetedRerun, previewTargetedRerun } from "./targeted-rerun.mjs";

test("targeted rerun preview scopes document page range unit and failed batch without leaking text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-targeted-rerun-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-targeted-rerun", name: "Targeted Rerun", template: "textbook-cn-k12" });
  writeTargetedRerunFixture(state, kb.id);

  const documentPreview = previewTargetedRerun(state, { type: "document", documentId: "doc-alpha" });
  const pagePreview = previewTargetedRerun(state, { type: "pageRange", documentId: "doc-alpha", startPage: 2, endPage: 3 });
  const unitPreview = previewTargetedRerun(state, { type: "unit", unit: "第三单元" });
  const failedPreview = previewTargetedRerun(state, { type: "failedBatch" });
  const serialized = `${JSON.stringify(documentPreview)}\n${JSON.stringify(pagePreview)}\n${JSON.stringify(unitPreview)}\n${JSON.stringify(failedPreview)}`;

  assert.equal(documentPreview.ok, true);
  assert.equal(documentPreview.kind, "knowmesh.targetedRerunPreview");
  assert.equal(documentPreview.summary.documents, 1);
  assert.equal(documentPreview.summary.pages, 3);
  assert.equal(documentPreview.documents[0].documentId, "doc-alpha");
  assert.equal(documentPreview.documents[0].chunks, 2);
  assert.equal(documentPreview.documents[0].qualityIssues, 1);
  const filteredScan = filterScanForTargetedRerun(scanFixture(), documentPreview.rerunScope);
  assert.equal(filteredScan.manifest.logicalDocuments.length, 1);
  assert.equal(filteredScan.manifest.logicalDocuments[0].document_id, "doc-alpha");
  assert.equal(filteredScan.summary.includedFiles, 1);
  assert.equal(pagePreview.summary.documents, 1);
  assert.equal(pagePreview.summary.pages, 2);
  assert.deepEqual(pagePreview.pageRanges[0], {
    documentId: "doc-alpha",
    title: "五年级语文上册",
    relativePath: "语文/五上.pdf",
    startPage: 2,
    endPage: 3,
    pages: 2,
    retryablePages: 1
  });
  assert.equal(unitPreview.summary.structureNodes, 1);
  assert.equal(unitPreview.structureNodes[0].title, "第三单元");
  assert.equal(unitPreview.summary.pages, 2);
  assert.equal(failedPreview.summary.retryablePages, 1);
  assert.equal(failedPreview.summary.qualityIssues, 2);
  assert.equal(failedPreview.summary.evaluationFailures, 2);
  assert.equal(failedPreview.failureBatches[0].type, "retryable_pages");
  assert.ok(failedPreview.evaluationFailures.some((item) => item.category === "unit_lesson_lookup"));
  assert.deepEqual(failedPreview.privacy.excludes, ["documentText", "sourceContent", "evaluationQuestions", "expectedAnswers", "answerText"]);
  assert.doesNotMatch(serialized, /private page text/);
  assert.doesNotMatch(serialized, /private expected answer/);
  assert.doesNotMatch(serialized, /private failure detail/);
  assert.doesNotMatch(serialized, /private query preview/);
});

test("targeted rerun confirmation creates a scoped catalog job", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-targeted-rerun-job-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-targeted-rerun-job", name: "Targeted Rerun Job", template: "textbook-cn-k12" });
  writeTargetedRerunFixture(state, kb.id);

  const result = confirmTargetedRerunJob(state, { type: "pageRange", documentId: "doc-alpha", startPage: 2, endPage: 3, mode: "local" });

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.targetedRerunConfirm");
  assert.equal(result.job.kind, "knowmesh.targetedRerunJob");
  assert.equal(result.job.status, "waiting");
  assert.equal(result.job.knowledgeBaseId, kb.id);
  assert.equal(result.job.targetedRerun.target.type, "pageRange");
  assert.equal(result.job.targetedRerun.summary.documents, 1);
  assert.equal(result.job.targetedRerun.summary.pages, 2);
  assert.deepEqual(result.job.tasks.map((item) => item.key), ["scan", "pages", "clean", "embedding", "index", "report"]);
  assert.equal(latestJob(state).job.id, result.job.id);
  assert.equal(readCatalogScalar(state, kb.id, "SELECT job_id FROM jobs WHERE job_id = ?", [result.job.id]), result.job.id);
  assert.equal(readCatalogScalar(state, kb.id, "SELECT value FROM catalog_state WHERE key = 'latestJobId'"), result.job.id);
  assert.equal(readCatalogScalar(state, kb.id, "SELECT count(*) FROM task_steps WHERE job_id = ?", [result.job.id]), 6);
  assert.doesNotMatch(JSON.stringify(result), /private page text/);
  assert.doesNotMatch(JSON.stringify(result), /private failure detail/);
});

function writeTargetedRerunFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = "2026-06-29T10:00:00.000Z";
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES
          ('doc-alpha', '五年级语文上册', 'pdf', 'E:/sources/alpha.pdf', '语文/五上.pdf', 'hash-alpha', 'win32', 'included', 'primary', '{}', ?, ?),
          ('doc-beta', '五年级数学上册', 'pdf', 'E:/sources/beta.pdf', '数学/五上.pdf', 'hash-beta', 'win32', 'included', 'primary', '{}', ?, ?)
      `).run(now, now, now, now);
      db.prepare(`
        INSERT INTO document_versions (version_id, document_id, display_version, content_hash, artifact_path, status, metadata_json, created_at, updated_at)
        VALUES
          ('ver-alpha', 'doc-alpha', 'v1.0.0', 'hash-alpha', 'artifacts/alpha', 'active', '{}', ?, ?),
          ('ver-beta', 'doc-beta', 'v1.0.0', 'hash-beta', 'artifacts/beta', 'active', '{}', ?, ?)
      `).run(now, now, now, now);
      const pageInsert = db.prepare(`
        INSERT INTO pages (page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      pageInsert.run("page-alpha-1", "doc-alpha", "ver-alpha", 1, "pages/a1.json", "text-a1", "extracted", "primary", JSON.stringify({ sample: "private page text one" }), now, now);
      pageInsert.run("page-alpha-2", "doc-alpha", "ver-alpha", 2, "pages/a2.json", "text-a2", "retry", "review", JSON.stringify({ sample: "private page text retry", retry: { retryable: true } }), now, now);
      pageInsert.run("page-alpha-3", "doc-alpha", "ver-alpha", 3, "pages/a3.json", "text-a3", "extracted", "primary", JSON.stringify({ sample: "private page text three" }), now, now);
      pageInsert.run("page-beta-1", "doc-beta", "ver-beta", 1, "pages/b1.json", "text-b1", "extracted", "primary", "{}", now, now);
      db.prepare(`
        INSERT INTO structure_nodes (node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at)
        VALUES ('unit-alpha-3', NULL, 'doc-alpha', 'unit', '第三单元', 3, 2, 3, '五年级语文上册/第三单元', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO chunks (chunk_id, document_id, structure_node_id, text_hash, token_count, quality_state, metadata_json, created_at, updated_at)
        VALUES
          ('chunk-alpha-1', 'doc-alpha', 'unit-alpha-3', 'chunk-hash-1', 42, 'primary', '{}', ?, ?),
          ('chunk-alpha-2', 'doc-alpha', 'unit-alpha-3', 'chunk-hash-2', 39, 'review', '{}', ?, ?),
          ('chunk-beta-1', 'doc-beta', NULL, 'chunk-hash-3', 27, 'primary', '{}', ?, ?)
      `).run(now, now, now, now, now, now);
      db.prepare(`
        INSERT INTO quality_issues (issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at)
        VALUES
          ('issue-doc-alpha', 'document', 'doc-alpha', 'review', 'open', 'needs review', '{"detail":"private failure detail"}', ?, ?),
          ('issue-query-alpha', 'query', 'query-alpha', 'warning', 'open', 'query failed', '{"questionPreview":"private query preview"}', ?, ?)
      `).run(now, now, now, now);
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-eval-active', 'active', 1, '', '{}', ?, ?)
      `).run(now, now);
      const caseInsert = db.prepare(`
        INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
        VALUES (?, 'textbook-cn-k12', ?, ?, ?, 1, ?, ?)
      `);
      caseInsert.run("case-eval-unit", "unit_lesson_lookup", "private evaluation question unit", JSON.stringify({ expected: "private expected answer unit" }), now, now);
      caseInsert.run("case-eval-refusal", "out_of_scope_refusal", "private evaluation question refusal", "{}", now, now);
      const resultInsert = db.prepare(`
        INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
        VALUES (?, ?, 'build-eval-active', ?, ?, ?, ?, ?)
      `);
      resultInsert.run("result-eval-unit", "case-eval-unit", "fail", JSON.stringify({ score: 0.2 }), JSON.stringify({ riskCodes: ["route_status_mismatch"], detail: "private failure detail eval" }), now, now);
      resultInsert.run("result-eval-refusal", "case-eval-refusal", "review", JSON.stringify({ score: 0.5 }), "{}", now, now);
    });
    write();
  } finally {
    db.close();
  }
}

function readCatalogScalar(state, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return Object.values(db.prepare(sql).get(...params) || {})[0];
  } finally {
    db.close();
  }
}

function scanFixture() {
  return {
    summary: { includedFiles: 2, logicalDocuments: 2 },
    manifest: {
      files: { included: 2 },
      scopeFilter: {},
      logicalDocuments: [
        { document_id: "doc-alpha", relativePath: "语文/五上.pdf", sourceParts: [{ path: "alpha.pdf" }] },
        { document_id: "doc-beta", relativePath: "数学/五上.pdf", sourceParts: [{ path: "beta.pdf" }] }
      ]
    }
  };
}
