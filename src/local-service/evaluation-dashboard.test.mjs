import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { evaluationDashboard } from "./evaluation-dashboard.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("evaluation dashboard summarizes active build results without leaking case text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-evaluation-dashboard-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-evaluation-dashboard", name: "Evaluation Dashboard", template: "textbook-cn-k12" });
  writeEvaluationDashboardFixture(state, kb.id);

  const dashboard = evaluationDashboard(state);
  const serialized = JSON.stringify(dashboard);

  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.kind, "knowmesh.evaluationDashboard");
  assert.equal(dashboard.knowledgeBase.id, kb.id);
  assert.equal(dashboard.knowledgeBase.template, "textbook-cn-k12");
  assert.equal(dashboard.summary.status, "attention");
  assert.equal(dashboard.summary.activeBuildId, "build-active-eval");
  assert.equal(dashboard.summary.cases, 4);
  assert.equal(dashboard.summary.results, 3);
  assert.equal(dashboard.summary.coveragePercent, 75);
  assert.equal(dashboard.summary.passed, 1);
  assert.equal(dashboard.summary.failed, 1);
  assert.equal(dashboard.summary.review, 1);
  assert.equal(dashboard.summary.missing, 1);
  assert.equal(dashboard.summary.passRate, 25);
  assert.equal(dashboard.summary.citationBearingUsableRate, 25);
  assert.equal(dashboard.byStatus.pass, 1);
  assert.equal(dashboard.byStatus.fail, 1);
  assert.equal(dashboard.byStatus.review, 1);
  assert.equal(dashboard.byStatus.missing, 1);
  assert.equal(dashboard.categories.find((item) => item.category === "unit_lesson_lookup").status, "fail");
  assert.deepEqual(dashboard.failureGroups.map((item) => item.category), ["unit_lesson_lookup", "no_answer_behavior", "out_of_scope_refusal"]);
  assert.ok(dashboard.failureGroups.some((item) => item.riskCodes.includes("route_status_mismatch")));
  assert.equal(dashboard.recentBuilds[0].buildId, "build-active-eval");
  assert.equal(dashboard.recentBuilds[0].failed, 1);
  assert.equal(dashboard.recentBuilds[1].buildId, "build-previous-eval");
  assert.ok(dashboard.nextActions.some((item) => item.href === "/maintain/documents"));
  assert.deepEqual(dashboard.privacy.excludes, ["evaluationQuestions", "expectedAnswers", "sourceContent", "answerText"]);
  assert.doesNotMatch(serialized, /private evaluation question/);
  assert.doesNotMatch(serialized, /private expected answer/);
  assert.doesNotMatch(serialized, /private failure detail/);
  assert.doesNotMatch(serialized, /private review note/);
});

test("evaluation dashboard reports empty state for a knowledge base without cases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-evaluation-dashboard-empty-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-evaluation-empty", name: "Evaluation Empty", template: "general-docs" });

  const dashboard = evaluationDashboard(state);

  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.summary.status, "empty");
  assert.equal(dashboard.summary.cases, 0);
  assert.deepEqual(dashboard.categories, []);
  assert.deepEqual(dashboard.failureGroups, []);
  assert.equal(dashboard.nextActions[0].href, "/build");
});

function writeEvaluationDashboardFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = "2026-06-29T08:00:00.000Z";
    const active = "2026-06-29T09:00:00.000Z";
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-active-eval', 'active', 1, '', '{}', ?, ?),
               ('build-previous-eval', 'published', 0, '', '{}', ?, ?)
      `).run(now, active, now, now);
      const caseInsert = db.prepare(`
        INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
        VALUES (?, 'textbook-cn-k12', ?, ?, ?, 1, ?, ?)
      `);
      caseInsert.run("case-toc", "toc_lookup", "private evaluation question toc", JSON.stringify({ answer: "private expected answer toc" }), now, now);
      caseInsert.run("case-unit", "unit_lesson_lookup", "private evaluation question unit", JSON.stringify({ answer: "private expected answer unit" }), now, now);
      caseInsert.run("case-refusal", "out_of_scope_refusal", "private evaluation question refusal", "{}", now, now);
      caseInsert.run("case-no-answer", "no_answer_behavior", "private evaluation question no answer", "{}", now, now);
      const resultInsert = db.prepare(`
        INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      resultInsert.run(
        "result-active-toc",
        "case-toc",
        "build-active-eval",
        "pass",
        JSON.stringify({ score: 0.98, citationBearing: true }),
        "{}",
        active,
        active
      );
      resultInsert.run(
        "result-active-unit",
        "case-unit",
        "build-active-eval",
        "fail",
        JSON.stringify({ score: 0.18, citationBearing: false }),
        JSON.stringify({ riskCodes: ["route_status_mismatch"], detail: "private failure detail" }),
        active,
        active
      );
      resultInsert.run(
        "result-active-refusal",
        "case-refusal",
        "build-active-eval",
        "review",
        JSON.stringify({ score: 0.72, citationBearing: false }),
        JSON.stringify({ riskCodes: ["missing_citation"], note: "private review note" }),
        active,
        active
      );
      resultInsert.run(
        "result-previous-unit",
        "case-unit",
        "build-previous-eval",
        "pass",
        JSON.stringify({ score: 0.93, citationBearing: true }),
        "{}",
        now,
        now
      );
    });
    write();
  } finally {
    db.close();
  }
}
