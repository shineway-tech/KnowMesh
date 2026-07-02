import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import {
  expertEvaluationCaseContract,
  mapExpertEvaluationFailuresToMaintenance,
  normalizeExpertEvaluationCases,
  seedExpertEvaluationCases
} from "./expert-evaluation.mjs";
import { evaluationDashboard } from "./evaluation-dashboard.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { maintenanceReview } from "./maintenance-review.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("Expert evaluation contract normalizes portable cases without private text", () => {
  const contract = expertEvaluationCaseContract();
  const cases = normalizeExpertEvaluationCases("operations-handbook");

  assert.equal(contract.kind, "knowmesh.expertEvaluationCaseContract");
  assert.equal(contract.version, "2026-07-expert-sdk.1");
  assert.deepEqual(contract.requiredFields, [
    "caseId",
    "expertId",
    "template",
    "category",
    "expectedStatus",
    "requiredCitations",
    "refusalExpected",
    "noAnswerExpected",
    "redaction"
  ]);
  assert.equal(contract.coreQueryGatesOverrideAllowed, false);
  assert.ok(cases.some((item) => item.category === "policy_lookup" && item.expectedStatus === "answered" && item.requiredCitations === true));
  assert.ok(cases.some((item) => item.category === "no_answer_behavior" && item.expectedStatus === "noAnswer" && item.noAnswerExpected === true));
  assert.ok(cases.every((item) => item.answerPolicy === "citation_ready_evidence_only"));
  assert.ok(cases.every((item) => item.redaction.excludes.includes("sourceContent")));
  assert.doesNotMatch(JSON.stringify({ contract, cases }), /private question|source text|AccessKey|sk-/i);
});

test("Expert evaluation cases feed dashboard gates and maintenance review", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-expert-eval-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-expert-eval", name: "Expert Eval", template: "operations-handbook" });

  const seeded = seedExpertEvaluationCases(state, "operations-handbook", { knowledgeBaseId: kb.id });
  writeExpertEvaluationResults(state, kb.id);

  const dashboard = evaluationDashboard(state);
  const mapped = mapExpertEvaluationFailuresToMaintenance(state, { knowledgeBaseId: kb.id });
  const review = maintenanceReview({ ...state, knowledgeBaseId: kb.id }, { status: "open", issueType: "expert_evaluation_gap" });

  assert.equal(seeded.ok, true);
  assert.equal(seeded.inserted, 5);
  assert.equal(dashboard.expertEvaluation.expert.id, "operations-handbook");
  assert.equal(dashboard.expertEvaluation.status, "blocked");
  assert.ok(dashboard.expertEvaluation.gates.some((item) => item.key === "expertCaseCoverage" && item.status === "pass"));
  assert.ok(dashboard.expertEvaluation.gates.some((item) => item.key === "expertCitationEvidence" && item.status === "fail"));
  assert.equal(dashboard.summary.cases, 5);
  assert.equal(dashboard.summary.failed, 1);
  assert.equal(dashboard.summary.review, 1);
  assert.equal(mapped.created, 2);
  assert.equal(review.review.items.length, 2);
  assert.ok(review.review.items.every((item) => item.issueType === "expert_evaluation_gap"));
  assert.ok(review.review.items.every((item) => item.details.rerunScope.type === "expert_evaluation"));
  assert.ok(review.review.items.some((item) => item.details.category === "rollback_rule_lookup"));
  assert.doesNotMatch(JSON.stringify({ dashboard, review }), /private expert eval question|private expected answer|private source|AccessKey|sk-/i);
});

function writeExpertEvaluationResults(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-expert-eval', 'active', 1, '', '{}', ?, ?)
      `).run(now, now);
      const insert = db.prepare(`
        INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
        VALUES (?, ?, 'build-expert-eval', ?, ?, ?, ?, ?)
      `);
      insert.run("result-policy", "operations-handbook:policy_lookup", "pass", JSON.stringify({ score: 0.96, citationBearing: true }), "{}", now, now);
      insert.run("result-workflow", "operations-handbook:workflow_step_lookup", "pass", JSON.stringify({ score: 0.92, citationBearing: true }), "{}", now, now);
      insert.run("result-review", "operations-handbook:review_cadence_lookup", "pass", JSON.stringify({ score: 0.91, citationBearing: true }), "{}", now, now);
      insert.run("result-rollback", "operations-handbook:rollback_rule_lookup", "fail", JSON.stringify({ score: 0.3, citationBearing: false }), JSON.stringify({ riskCodes: ["missing_citation"], detail: "private expert eval question" }), now, now);
      insert.run("result-no-answer", "operations-handbook:no_answer_behavior", "review", JSON.stringify({ score: 0.7, citationBearing: false }), JSON.stringify({ riskCodes: ["no_answer_needs_review"], expected: "private expected answer" }), now, now);
    })();
  } finally {
    db.close();
  }
}
