import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const defaultPrivacyExcludes = ["evaluationQuestions", "expectedAnswers", "sourceContent", "answerText"];

export function evaluationDashboard(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyDashboard();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  const template = String(options.template || knowledgeBase.template || "").trim();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeBuild = readActiveBuild(db);
    const caseRows = readEvaluationRows(db, { template, activeBuildId: activeBuild?.buildId || "" });
    const recentBuilds = readRecentBuilds(db, { template, limit: Number(options.recentBuildLimit || 5) });
    const summary = summarizeRows(caseRows, activeBuild);
    const categories = summarizeCategories(caseRows);
    const failureGroups = summarizeFailureGroups(categories);
    return {
      ok: true,
      kind: "knowmesh.evaluationDashboard",
      apiVersion: "v1",
      phase: "phase5-maintenance-evaluation",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template
      },
      summary,
      byStatus: summary.byStatus,
      categories,
      failureGroups,
      recentBuilds,
      nextActions: buildNextActions(summary, failureGroups),
      privacy: {
        redacted: true,
        excludes: defaultPrivacyExcludes
      }
    };
  } finally {
    db.close();
  }
}

function readActiveBuild(db) {
  const row = db.prepare(`
    SELECT build_id, status, updated_at
    FROM build_versions
    WHERE active = 1
    ORDER BY updated_at DESC, build_id DESC
    LIMIT 1
  `).get();
  if (!row) return null;
  return {
    buildId: String(row.build_id || ""),
    status: String(row.status || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function readEvaluationRows(db, options = {}) {
  const template = String(options.template || "").trim();
  const activeBuildId = String(options.activeBuildId || "").trim();
  return db.prepare(`
    SELECT
      ec.case_id,
      ec.template,
      ec.category,
      er.result_id,
      er.build_id,
      er.status,
      er.scores_json,
      er.details_json,
      er.created_at AS result_created_at,
      er.updated_at AS result_updated_at
    FROM evaluation_cases ec
    LEFT JOIN evaluation_results er ON er.result_id = (
      SELECT er2.result_id
      FROM evaluation_results er2
      WHERE er2.case_id = ec.case_id
        AND (? = '' OR er2.build_id = ?)
      ORDER BY er2.created_at DESC, er2.result_id DESC
      LIMIT 1
    )
    WHERE ec.active = 1
      AND (? = '' OR ec.template = ?)
    ORDER BY ec.category ASC, ec.case_id ASC
  `).all(activeBuildId, activeBuildId, template, template).map(evaluationRow);
}

function readRecentBuilds(db, options = {}) {
  const template = String(options.template || "").trim();
  const limit = Math.max(1, Math.min(20, Number.isFinite(options.limit) ? options.limit : 5));
  return db.prepare(`
    SELECT
      er.build_id,
      COUNT(*) AS results,
      SUM(CASE WHEN lower(er.status) IN ('pass', 'passed') THEN 1 ELSE 0 END) AS passed,
      SUM(CASE WHEN lower(er.status) IN ('fail', 'failed') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN lower(er.status) NOT IN ('pass', 'passed', 'fail', 'failed') THEN 1 ELSE 0 END) AS review,
      MAX(er.created_at) AS last_result_at
    FROM evaluation_results er
    JOIN evaluation_cases ec ON ec.case_id = er.case_id
    WHERE ec.active = 1
      AND (? = '' OR ec.template = ?)
    GROUP BY er.build_id
    ORDER BY last_result_at DESC, er.build_id DESC
    LIMIT ?
  `).all(template, template, limit).map((row) => {
    const results = numberValue(row.results);
    const passed = numberValue(row.passed);
    const failed = numberValue(row.failed);
    const review = numberValue(row.review);
    return {
      buildId: String(row.build_id || ""),
      status: failed > 0 ? "attention" : review > 0 ? "review" : "ready",
      results,
      passed,
      failed,
      review,
      passRate: results ? Math.round((passed / results) * 100) : 0,
      lastResultAt: String(row.last_result_at || "")
    };
  });
}

function evaluationRow(row = {}) {
  const scores = parseJson(row.scores_json, {});
  const details = parseJson(row.details_json, {});
  const status = row.result_id ? normalizeResultStatus(row.status) : "missing";
  return {
    caseId: String(row.case_id || ""),
    template: String(row.template || ""),
    category: String(row.category || "uncategorized"),
    resultId: String(row.result_id || ""),
    buildId: String(row.build_id || ""),
    status,
    score: numberValue(scores.score),
    citationBearing: scores.citationBearing === true,
    riskCodes: safeRiskCodes(details),
    resultCreatedAt: String(row.result_created_at || ""),
    resultUpdatedAt: String(row.result_updated_at || "")
  };
}

function summarizeRows(rows = [], activeBuild) {
  const byStatus = statusCounts();
  let citationBearingPassed = 0;
  let scoreTotal = 0;
  let scoredResults = 0;
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    if (row.status !== "missing") {
      scoreTotal += row.score;
      scoredResults += 1;
    }
    if (row.status === "pass" && row.citationBearing) citationBearingPassed += 1;
  }
  const cases = rows.length;
  const results = cases - byStatus.missing;
  const passed = byStatus.pass;
  const failed = byStatus.fail;
  const review = byStatus.review;
  const missing = byStatus.missing;
  const coveragePercent = cases ? Math.round((results / cases) * 100) : 0;
  const passRate = cases ? Math.round((passed / cases) * 100) : 0;
  const resultPassRate = results ? Math.round((passed / results) * 100) : 0;
  const citationBearingUsableRate = cases ? Math.round((citationBearingPassed / cases) * 100) : 0;
  return {
    status: dashboardStatus({ cases, activeBuild, missing, failed, review, passRate }),
    activeBuildId: activeBuild?.buildId || "",
    activeBuildStatus: activeBuild?.status || "",
    cases,
    results,
    coveragePercent,
    passed,
    failed,
    review,
    missing,
    passRate,
    resultPassRate,
    averageScore: scoredResults ? Number((scoreTotal / scoredResults).toFixed(3)) : 0,
    citationBearingPassed,
    citationBearingUsableRate,
    byStatus
  };
}

function summarizeCategories(rows = []) {
  const buckets = new Map();
  for (const row of rows) {
    const key = row.category || "uncategorized";
    if (!buckets.has(key)) {
      buckets.set(key, {
        category: key,
        cases: 0,
        results: 0,
        passed: 0,
        failed: 0,
        review: 0,
        missing: 0,
        citationBearingPassed: 0,
        riskCodes: new Set(),
        lastResultAt: "",
        buildId: ""
      });
    }
    const bucket = buckets.get(key);
    bucket.cases += 1;
    if (row.status !== "missing") {
      bucket.results += 1;
      bucket.lastResultAt = maxString(bucket.lastResultAt, row.resultCreatedAt || row.resultUpdatedAt);
      if (!bucket.buildId) bucket.buildId = row.buildId;
    }
    if (row.status === "pass") {
      bucket.passed += 1;
      if (row.citationBearing) bucket.citationBearingPassed += 1;
    } else if (row.status === "fail") {
      bucket.failed += 1;
    } else if (row.status === "missing") {
      bucket.missing += 1;
      bucket.riskCodes.add("missing_result");
    } else {
      bucket.review += 1;
    }
    for (const code of row.riskCodes) bucket.riskCodes.add(code);
  }
  return [...buckets.values()].map((bucket) => ({
    category: bucket.category,
    status: categoryStatus(bucket),
    cases: bucket.cases,
    results: bucket.results,
    passed: bucket.passed,
    failed: bucket.failed,
    review: bucket.review,
    missing: bucket.missing,
    passRate: bucket.cases ? Math.round((bucket.passed / bucket.cases) * 100) : 0,
    citationBearingUsableRate: bucket.cases ? Math.round((bucket.citationBearingPassed / bucket.cases) * 100) : 0,
    riskCodes: [...bucket.riskCodes].sort(),
    lastResultAt: bucket.lastResultAt,
    buildId: bucket.buildId
  }));
}

function summarizeFailureGroups(categories = []) {
  const severity = { fail: 0, missing: 1, review: 2, attention: 3 };
  return categories
    .filter((item) => item.failed > 0 || item.missing > 0 || item.review > 0)
    .map((item) => ({
      category: item.category,
      status: item.failed > 0 ? "fail" : item.missing > 0 ? "missing" : "review",
      affectedCases: item.failed + item.missing + item.review,
      cases: item.cases,
      failed: item.failed,
      missing: item.missing,
      review: item.review,
      riskCodes: item.riskCodes,
      buildId: item.buildId,
      lastResultAt: item.lastResultAt,
      action: failureAction(item)
    }))
    .sort((a, b) => (severity[a.status] ?? 9) - (severity[b.status] ?? 9) || a.category.localeCompare(b.category));
}

function buildNextActions(summary, failureGroups = []) {
  if (!summary.cases) {
    return [
      action("buildEvaluation", "/build", "生成或重新生成知识库", "Build or rebuild the knowledge base")
    ];
  }
  const actions = [];
  if (summary.missing > 0) actions.push(action("rerunEvaluation", "/build", "补跑缺失评测", "Run missing evaluations"));
  if (failureGroups.some((item) => item.failed > 0 || item.review > 0)) {
    actions.push(action("reviewSources", "/maintain/documents", "复核相关资料", "Review related sources"));
  }
  if (summary.failed === 0 && summary.review === 0 && summary.missing === 0) {
    actions.push(action("ask", "/use/ask", "提问验证", "Ask and verify"));
  }
  return actions;
}

function failureAction(item = {}) {
  if (item.missing > 0) return action("rerunEvaluation", "/build", "补跑评测", "Run evaluation");
  return action("reviewSources", "/maintain/documents", "复核资料与引用", "Review sources and citations");
}

function action(key, href, labelZh, labelEn) {
  return {
    key,
    href,
    label: { zh: labelZh, en: labelEn }
  };
}

function dashboardStatus(summary = {}) {
  if (!summary.cases) return "empty";
  if (!summary.activeBuild) return "blocked";
  if (summary.failed > 0 || summary.review > 0 || summary.missing > 0) return "attention";
  return summary.passRate >= 85 ? "ready" : "attention";
}

function categoryStatus(bucket = {}) {
  if (!bucket.cases) return "empty";
  if (bucket.failed > 0) return "fail";
  if (bucket.missing > 0) return "missing";
  if (bucket.review > 0) return "review";
  return "ready";
}

function normalizeResultStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "passed") return "pass";
  if (status === "failed") return "fail";
  if (status === "pass" || status === "fail") return status;
  return status ? "review" : "missing";
}

function safeRiskCodes(details = {}) {
  const rawCodes = Array.isArray(details.riskCodes) ? details.riskCodes : [];
  return rawCodes
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => /^[a-z0-9_.:-]{1,80}$/i.test(item))
    .slice(0, 12);
}

function statusCounts() {
  return { pass: 0, fail: 0, review: 0, missing: 0 };
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function maxString(left = "", right = "") {
  return String(right || "") > String(left || "") ? String(right || "") : String(left || "");
}

function emptyDashboard() {
  return {
    ok: false,
    kind: "knowmesh.evaluationDashboard",
    apiVersion: "v1",
    phase: "phase5-maintenance-evaluation",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "" },
    summary: {
      status: "empty",
      activeBuildId: "",
      activeBuildStatus: "",
      cases: 0,
      results: 0,
      coveragePercent: 0,
      passed: 0,
      failed: 0,
      review: 0,
      missing: 0,
      passRate: 0,
      resultPassRate: 0,
      averageScore: 0,
      citationBearingPassed: 0,
      citationBearingUsableRate: 0,
      byStatus: statusCounts()
    },
    byStatus: statusCounts(),
    categories: [],
    failureGroups: [],
    recentBuilds: [],
    nextActions: [action("createKnowledgeBase", "/knowledge-bases", "创建知识库", "Create a knowledge base")],
    privacy: {
      redacted: true,
      excludes: defaultPrivacyExcludes
    }
  };
}
