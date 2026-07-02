import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { readK12EvaluationManifestFromCatalog } from "./k12-evaluation-manifest.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 evaluation manifest summarizes build results and quality risks without leaking case text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-evaluation-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-evaluation", name: "K12 Evaluation", template: "textbook-cn-k12" });
  writeEvaluationFixture(state, kb.id);

  const manifest = readK12EvaluationManifestFromCatalog(state);

  assert.equal(manifest.ok, true);
  assert.equal(manifest.kind, "knowmesh.k12EvaluationManifest");
  assert.equal(manifest.knowledgeBase.id, kb.id);
  assert.equal(manifest.summary.status, "attention");
  assert.equal(manifest.summary.activeBuildId, "build-k12-eval");
  assert.equal(manifest.summary.cases, 4);
  assert.equal(manifest.summary.results, 4);
  assert.equal(manifest.summary.coveragePercent, 100);
  assert.deepEqual(manifest.summary.qualityTargets, {
    evaluationCoverageRate: 1,
    outOfScopeRefusalRate: 1,
    tocLookupPassRate: 0.95,
    citationBearingUsableAnswerRate: 0.85
  });
  assert.equal(manifest.summary.passed, 2);
  assert.equal(manifest.summary.failed, 1);
  assert.equal(manifest.summary.review, 1);
  assert.equal(manifest.summary.categories.toc_lookup.cases, 1);
  assert.equal(manifest.summary.categories.out_of_scope_refusal.failed, 1);
  assert.equal(manifest.summary.categoryRates.out_of_scope_refusal.passRate, 0);
  assert.equal(manifest.summary.categoryRates.toc_lookup.passRate, 1);
  assert.equal(manifest.summary.outOfScopeRefusalRate, 0);
  assert.equal(manifest.summary.requiredGates.outOfScopeRefusal, "fail");
  assert.equal(manifest.summary.requiredGates.evaluationCoverage, "pass");
  assert.equal(manifest.risks[0].key, "outOfScopeRefusal");
  assert.doesNotMatch(JSON.stringify(manifest), /private evaluation question/);
  assert.doesNotMatch(JSON.stringify(manifest), /private expected answer/);
  assert.doesNotMatch(JSON.stringify(manifest), /private failure detail/);
});

test("K12 evaluation manifest reports partial coverage for active cases without build results", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-evaluation-partial-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-evaluation-partial", name: "K12 Evaluation Partial", template: "textbook-cn-k12" });
  writeEvaluationFixture(state, kb.id, { omitResults: true });

  const manifest = readK12EvaluationManifestFromCatalog(state);

  assert.equal(manifest.summary.status, "partial");
  assert.equal(manifest.summary.cases, 4);
  assert.equal(manifest.summary.results, 0);
  assert.equal(manifest.summary.coveragePercent, 0);
  assert.equal(manifest.summary.outOfScopeRefusalRate, 0);
  assert.ok(manifest.risks.some((risk) => risk.key === "evaluationCoverage"));
});

function writeEvaluationFixture(state, knowledgeBaseId, options = {}) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-k12-eval', 'active', 1, '', '{}', ?, ?)
      `).run(now, now);
      const caseInsert = db.prepare(`
        INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
        VALUES (?, 'textbook-cn-k12', ?, ?, ?, 1, ?, ?)
      `);
      caseInsert.run("case-toc", "toc_lookup", "private evaluation question toc", JSON.stringify({ answer: "private expected answer" }), now, now);
      caseInsert.run("case-unit", "unit_lesson_lookup", "private evaluation question unit", "{}", now, now);
      caseInsert.run("case-refusal", "out_of_scope_refusal", "private evaluation question refusal", "{}", now, now);
      caseInsert.run("case-no-answer", "no_answer_behavior", "private evaluation question no answer", "{}", now, now);
      if (options.omitResults) return;
      const resultInsert = db.prepare(`
        INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
        VALUES (?, ?, 'build-k12-eval', ?, ?, ?, ?, ?)
      `);
      resultInsert.run("result-toc", "case-toc", "pass", JSON.stringify({ score: 0.96, citationBearing: true }), "{}", now, now);
      resultInsert.run("result-unit", "case-unit", "pass", JSON.stringify({ score: 0.91, citationBearing: true }), "{}", now, now);
      resultInsert.run("result-refusal", "case-refusal", "fail", JSON.stringify({ score: 0.2 }), JSON.stringify({ detail: "private failure detail" }), now, now);
      resultInsert.run("result-no-answer", "case-no-answer", "review", JSON.stringify({ score: 0.72 }), "{}", now, now);
    });
    write();
  } finally {
    db.close();
  }
}
