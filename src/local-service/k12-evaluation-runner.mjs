import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { routeK12QueryFromCatalog } from "./k12-query-router.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export const k12RequiredEvaluationCases = [
  ["toc_lookup", "五年级统编版语文第三单元第一课是什么？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["unit_lesson_lookup", "五年级统编版语文第三单元有哪些课文？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["vocabulary_lookup", "五年级统编版语文第三单元猎人海力布有哪些词语？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["writing_oral_communication_lookup", "五年级统编版语文第三单元有哪些习作或口语交际？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["math_concept_lookup", "五年级人教版数学第五单元有哪些公式？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["math_example_lookup", "五年级人教版数学第五单元有哪些例题或练习？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["english_unit_theme", "五年级英语第三单元的主题是什么？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["english_vocabulary", "五年级英语第三单元有哪些单词？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["science_experiment", "五年级科学第三单元有哪些实验？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["page_citation", "五年级统编版语文第三单元第一课在哪一页？", { expectedStatus: "evidence_found", citationRequired: true }],
  ["cross_volume_comparison", "比较五年级统编版语文上册和下册第三单元第一课。", { expectedStatus: "evidence_found", citationRequired: true }],
  ["publisher_comparison", "比较统编版和人教版五年级语文第三单元第一课。", { expectedStatus: "evidence_found", citationRequired: true }],
  ["out_of_scope_refusal", "五年级人教版物理第三单元第一课是什么？", { expectedStatus: "out_of_scope", refusalRequired: true }],
  ["no_answer_behavior", "五年级统编版语文第九十九单元第一课是什么？", { expectedStatus: "no_evidence", noAnswerRequired: true }]
].map(([category, question, expected]) => ({
  caseId: `k12-required:${category}`,
  category,
  question,
  expected
}));

export function seedK12EvaluationCases(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, kind: "knowmesh.k12EvaluationSeedResult", seeded: 0, updated: 0 };
  if (!isK12KnowledgeBase(state, knowledgeBaseId)) {
    return { ok: true, kind: "knowmesh.k12EvaluationSeedResult", knowledgeBaseId, seeded: 0, updated: 0, status: "not_applicable" };
  }
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const existing = new Set(db.prepare("SELECT case_id FROM evaluation_cases WHERE template = ?").all(k12TemplateId).map((row) => row.case_id));
    const upsert = db.prepare(`
      INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        template = excluded.template,
        category = excluded.category,
        question = excluded.question,
        expected_json = excluded.expected_json,
        active = 1,
        updated_at = excluded.updated_at
    `);
    const now = nowIso();
    const write = db.transaction(() => {
      for (const item of k12RequiredEvaluationCases) {
        upsert.run(item.caseId, k12TemplateId, item.category, item.question, stableJson(item.expected), now, now);
      }
    });
    write();
    const seeded = k12RequiredEvaluationCases.filter((item) => !existing.has(item.caseId)).length;
    return {
      ok: true,
      kind: "knowmesh.k12EvaluationSeedResult",
      knowledgeBaseId,
      status: "seeded",
      requiredCases: k12RequiredEvaluationCases.length,
      seeded,
      updated: k12RequiredEvaluationCases.length - seeded,
      categories: k12RequiredEvaluationCases.map((item) => item.category)
    };
  } finally {
    db.close();
  }
}

export function runK12CatalogEvaluation(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyRunResult("", "missing_knowledge_base");
  if (!isK12KnowledgeBase(state, knowledgeBaseId)) return emptyRunResult(knowledgeBaseId, "not_applicable", true);
  seedK12EvaluationCases(state, { knowledgeBaseId });

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeBuildId = String(options.buildId || readActiveBuildId(db) || "").trim();
    if (!activeBuildId) return emptyRunResult(knowledgeBaseId, "missing_active_build");
    const cases = db.prepare(`
      SELECT case_id, category, question, expected_json
      FROM evaluation_cases
      WHERE template = ? AND active = 1
      ORDER BY category ASC, case_id ASC
    `).all(k12TemplateId);
    const now = nowIso();
    const upsertResult = db.prepare(`
      INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(result_id) DO UPDATE SET
        status = excluded.status,
        scores_json = excluded.scores_json,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at
    `);
    const results = cases.map((row) => {
      const route = routeK12QueryFromCatalog({ ...state, knowledgeBaseId }, { question: row.question });
      const expected = parseJson(row.expected_json, {});
      return evaluateRoute(row, expected, route);
    });
    const write = db.transaction(() => {
      for (const evaluation of results) {
        upsertResult.run(
          `k12-eval:${activeBuildId}:${evaluation.caseId}`,
          evaluation.caseId,
          activeBuildId,
          evaluation.status,
          stableJson(evaluation.scores),
          stableJson(evaluation.details),
          now,
          now
        );
      }
    });
    write();
    return {
      ok: true,
      kind: "knowmesh.k12EvaluationRunResult",
      knowledgeBaseId,
      buildId: activeBuildId,
      status: "completed",
      summary: summarizeRun(results),
      categories: summarizeCategories(results)
    };
  } finally {
    db.close();
  }
}

export function syncK12EvaluationForJob(state, job = {}) {
  if (job?.template !== k12TemplateId) return null;
  try {
    const knowledgeBaseId = String(job.knowledgeBaseId || job.knowledgeBase?.id || currentKnowledgeBaseId(state) || "").trim();
    const seed = seedK12EvaluationCases(state, { knowledgeBaseId });
    const run = runK12CatalogEvaluation(state, {
      knowledgeBaseId,
      buildId: job.datasetVersionId || job.summary?.datasetVersionId || ""
    });
    return { seed, run };
  } catch (error) {
    return {
      seed: null,
      run: {
        ok: false,
        kind: "knowmesh.k12EvaluationRunResult",
        status: "error",
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function evaluateRoute(row = {}, expected = {}, route = {}) {
  const citationCount = Array.isArray(route.citations) ? route.citations.length : 0;
  const routeStatus = route.status || "no_evidence";
  const expectedStatus = String(expected.expectedStatus || "evidence_found");
  const statusMatches = routeStatus === expectedStatus
    || (expected.noAnswerRequired === true && routeStatus === "no_evidence")
    || (expected.refusalRequired === true && routeStatus === "out_of_scope");
  const citationOk = expected.citationRequired === true ? citationCount > 0 : true;
  const passed = statusMatches && citationOk;
  return {
    caseId: row.case_id,
    category: row.category || "uncategorized",
    status: passed ? "pass" : "fail",
    scores: {
      score: passed ? 1 : 0,
      citationBearing: citationCount > 0,
      routeMatched: statusMatches,
      citationCount
    },
    details: {
      category: row.category || "uncategorized",
      expectedStatus,
      routeStatus,
      routeIntent: route.route?.intent || "",
      citationCount,
      riskCodes: passed ? [] : failedRiskCodes(expected, routeStatus, citationCount)
    }
  };
}

function failedRiskCodes(expected = {}, routeStatus = "", citationCount = 0) {
  const risks = [];
  if (expected.expectedStatus && routeStatus !== expected.expectedStatus) risks.push("route_status_mismatch");
  if (expected.citationRequired === true && citationCount <= 0) risks.push("missing_citation");
  if (expected.refusalRequired === true && routeStatus !== "out_of_scope") risks.push("refusal_missing");
  if (expected.noAnswerRequired === true && routeStatus !== "no_evidence") risks.push("no_answer_policy_mismatch");
  return risks;
}

function readActiveBuildId(db) {
  const row = db.prepare(`
    SELECT build_id
    FROM build_versions
    WHERE active = 1
    ORDER BY updated_at DESC, build_id DESC
    LIMIT 1
  `).get();
  return row?.build_id || "";
}

function summarizeRun(results = []) {
  const passed = results.filter((item) => item.status === "pass").length;
  const failed = results.filter((item) => item.status === "fail").length;
  const citationBearing = results.filter((item) => item.scores?.citationBearing === true).length;
  return {
    cases: results.length,
    passed,
    failed,
    citationBearing,
    citationBearingRate: results.length ? Math.round((citationBearing / results.length) * 100) : 0
  };
}

function summarizeCategories(results = []) {
  const categories = {};
  for (const result of results) {
    const key = result.category || "uncategorized";
    if (!categories[key]) categories[key] = { cases: 0, passed: 0, failed: 0 };
    categories[key].cases += 1;
    if (result.status === "pass") categories[key].passed += 1;
    if (result.status === "fail") categories[key].failed += 1;
  }
  return categories;
}

function isK12KnowledgeBase(state, knowledgeBaseId) {
  const registry = listKnowledgeBases(state);
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current;
  return knowledgeBase?.template === k12TemplateId;
}

function emptyRunResult(knowledgeBaseId, status, ok = false) {
  return {
    ok,
    kind: "knowmesh.k12EvaluationRunResult",
    knowledgeBaseId,
    buildId: "",
    status,
    summary: { cases: 0, passed: 0, failed: 0, citationBearing: 0, citationBearingRate: 0 },
    categories: {}
  };
}
