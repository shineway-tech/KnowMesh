import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function readK12EvaluationManifestFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyManifest();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableManifest(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeBuild = readActiveBuild(db);
    const cases = db.prepare(`
      SELECT case_id, category
      FROM evaluation_cases
      WHERE template = ? AND active = 1
      ORDER BY category ASC, case_id ASC
    `).all(k12TemplateId).map(caseRow);
    const results = activeBuild ? db.prepare(`
      SELECT er.result_id, er.case_id, er.status, er.scores_json, er.created_at
      FROM evaluation_results er
      JOIN evaluation_cases ec ON ec.case_id = er.case_id
      WHERE ec.template = ? AND ec.active = 1 AND er.build_id = ?
      ORDER BY er.created_at DESC, er.result_id DESC
    `).all(k12TemplateId, activeBuild.buildId).map(resultRow) : [];
    const latestResults = latestResultByCase(results);
    const summary = summarizeEvaluation(cases, latestResults, activeBuild);
    const risks = buildRisks(summary);
    return {
      ok: true,
      kind: "knowmesh.k12EvaluationManifest",
      apiVersion: "v1",
      phase: "phase3-k12-expert",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary: {
        ...summary,
        status: manifestStatus(summary, risks)
      },
      risks
    };
  } finally {
    db.close();
  }
}

function readActiveBuild(db) {
  const row = db.prepare(`
    SELECT build_id, status
    FROM build_versions
    WHERE active = 1
    ORDER BY updated_at DESC, build_id DESC
    LIMIT 1
  `).get();
  if (!row) return null;
  return {
    buildId: String(row.build_id || ""),
    status: String(row.status || "")
  };
}

function caseRow(row = {}) {
  return {
    caseId: String(row.case_id || ""),
    category: String(row.category || "uncategorized")
  };
}

function resultRow(row = {}) {
  const scores = parseJson(row.scores_json, {});
  return {
    resultId: String(row.result_id || ""),
    caseId: String(row.case_id || ""),
    status: normalizeResultStatus(row.status),
    score: Number(scores.score ?? 0),
    citationBearing: scores.citationBearing === true
  };
}

function latestResultByCase(results) {
  const latest = new Map();
  for (const result of results) {
    if (!latest.has(result.caseId)) latest.set(result.caseId, result);
  }
  return latest;
}

function summarizeEvaluation(cases, latestResults, activeBuild) {
  const categories = {};
  let passed = 0;
  let failed = 0;
  let review = 0;
  let citationBearingPassed = 0;
  for (const item of cases) {
    const category = item.category || "uncategorized";
    if (!categories[category]) {
      categories[category] = { cases: 0, results: 0, passed: 0, failed: 0, review: 0, missing: 0 };
    }
    const bucket = categories[category];
    bucket.cases += 1;
    const result = latestResults.get(item.caseId);
    if (!result) {
      bucket.missing += 1;
      continue;
    }
    bucket.results += 1;
    if (result.status === "pass") {
      bucket.passed += 1;
      passed += 1;
      if (result.citationBearing) citationBearingPassed += 1;
    } else if (result.status === "fail") {
      bucket.failed += 1;
      failed += 1;
    } else {
      bucket.review += 1;
      review += 1;
    }
  }
  const caseCount = cases.length;
  const resultCount = [...latestResults.keys()].filter((caseId) => cases.some((item) => item.caseId === caseId)).length;
  const coveragePercent = caseCount ? Math.round((resultCount / caseCount) * 100) : 0;
  const usableAnswerRate = caseCount ? Math.round((passed / caseCount) * 100) : 0;
  const citationBearingUsableRate = caseCount ? Math.round((citationBearingPassed / caseCount) * 100) : 0;
  const requiredGates = {
    evaluationCoverage: caseCount > 0 && resultCount >= caseCount ? "pass" : "fail",
    outOfScopeRefusal: categoryPass(categories.out_of_scope_refusal),
    tocLookup: categoryPass(categories.toc_lookup),
    citationBearingUsableAnswers: citationBearingUsableRate >= 85 ? "pass" : "review"
  };
  return {
    activeBuildId: activeBuild?.buildId || "",
    cases: caseCount,
    results: resultCount,
    coveragePercent,
    passed,
    failed,
    review,
    usableAnswerRate,
    citationBearingUsableRate,
    categories,
    requiredGates
  };
}

function categoryPass(bucket) {
  if (!bucket || bucket.cases === 0 || bucket.missing > 0) return "fail";
  return bucket.failed === 0 ? "pass" : "fail";
}

function buildRisks(summary) {
  const risks = [];
  if (summary.requiredGates.outOfScopeRefusal === "fail") {
    risks.push({
      key: "outOfScopeRefusal",
      status: "fail",
      category: "out_of_scope_refusal",
      message: "K12 out-of-scope refusal must pass before the build can be trusted."
    });
  }
  if (summary.requiredGates.evaluationCoverage === "fail") {
    risks.push({
      key: "evaluationCoverage",
      status: "fail",
      message: "Every active K12 evaluation case needs a result for the active build."
    });
  }
  if (summary.requiredGates.tocLookup === "fail") {
    risks.push({
      key: "tocLookup",
      status: "fail",
      category: "toc_lookup",
      message: "K12 TOC lookup coverage is missing or failing."
    });
  }
  if (summary.requiredGates.citationBearingUsableAnswers !== "pass") {
    risks.push({
      key: "citationBearingUsableAnswers",
      status: "review",
      message: "Citation-bearing usable answers are below the K12 target."
    });
  }
  return risks;
}

function manifestStatus(summary, risks) {
  if (!summary.cases) return "empty";
  if (summary.results < summary.cases) return "partial";
  return risks.some((risk) => risk.status === "fail") ? "attention" : "ready";
}

function normalizeResultStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "passed") return "pass";
  if (status === "failed") return "fail";
  if (status === "pass" || status === "fail") return status;
  return status || "review";
}

function notApplicableManifest(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12EvaluationManifest",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      name: knowledgeBase.name || knowledgeBase.id || "",
      template: knowledgeBase.template || ""
    },
    summary: emptySummary("not_applicable"),
    risks: []
  };
}

function emptyManifest() {
  return {
    ok: false,
    kind: "knowmesh.k12EvaluationManifest",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "" },
    summary: emptySummary("empty"),
    risks: []
  };
}

function emptySummary(status) {
  return {
    status,
    activeBuildId: "",
    cases: 0,
    results: 0,
    coveragePercent: 0,
    passed: 0,
    failed: 0,
    review: 0,
    usableAnswerRate: 0,
    citationBearingUsableRate: 0,
    categories: {},
    requiredGates: {
      evaluationCoverage: "fail",
      outOfScopeRefusal: "fail",
      tocLookup: "fail",
      citationBearingUsableAnswers: "review"
    }
  };
}
