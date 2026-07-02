import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { getExpert, resolveExpertForKnowledgeBase } from "./expert-registry.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";
import { queryRouteAnswerPolicy } from "./query-route-contract.mjs";

const contractVersion = "2026-07-expert-sdk.1";
const redactionExcludes = ["evaluationQuestions", "expectedAnswers", "sourceContent", "answerText"];

export function expertEvaluationCaseContract() {
  return {
    kind: "knowmesh.expertEvaluationCaseContract",
    version: contractVersion,
    requiredFields: [
      "caseId",
      "expertId",
      "template",
      "category",
      "expectedStatus",
      "requiredCitations",
      "refusalExpected",
      "noAnswerExpected",
      "redaction"
    ],
    answerPolicy: queryRouteAnswerPolicy,
    coreQueryGatesOverrideAllowed: false,
    redaction: {
      redacted: true,
      excludes: redactionExcludes
    }
  };
}

export function normalizeExpertEvaluationCases(expertOrId) {
  const expert = resolveExpert(expertOrId);
  if (!expert) return [];
  return (expert.evaluationCases || []).map((category) => expertEvaluationCase(expert, category));
}

export function seedExpertEvaluationCases(state, expertOrId, options = {}) {
  const expert = resolveExpert(expertOrId);
  if (!expert) return { ok: false, inserted: 0, cases: [] };
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, inserted: 0, cases: [] };
  const cases = normalizeExpertEvaluationCases(expert);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const now = nowIso();
    const insert = db.prepare(`
      INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        template = excluded.template,
        category = excluded.category,
        question = excluded.question,
        expected_json = excluded.expected_json,
        active = excluded.active,
        updated_at = excluded.updated_at
    `);
    db.transaction(() => {
      for (const item of cases) {
        insert.run(
          item.caseId,
          item.template,
          item.category,
          publicEvaluationPrompt(item),
          stableJson(publicExpectedPayload(item)),
          now,
          now
        );
      }
    })();
  } finally {
    db.close();
  }
  return {
    ok: true,
    inserted: cases.length,
    cases
  };
}

export function expertEvaluationForDashboard(knowledgeBase = {}, summary = {}, categories = [], failureGroups = []) {
  const expert = resolveExpertForKnowledgeBase(knowledgeBase);
  if (!expert) {
    return {
      status: "not_applicable",
      expert: null,
      gates: [],
      failureCategories: [],
      privacy: privacy()
    };
  }
  const gates = expertQualityGates(expert, summary, categories);
  const failed = gates.filter((item) => item.status === "fail").length;
  const warned = gates.filter((item) => item.status === "warn").length;
  return {
    status: !summary.cases ? "empty" : failed ? "blocked" : warned ? "attention" : "ready",
    expert: {
      id: expert.id,
      templateId: expert.templateId,
      lifecycle: { ...(expert.lifecycle || { stage: "experimental" }) }
    },
    gates,
    failureCategories: failureGroups.map((item) => ({
      category: item.category,
      status: item.status,
      affectedCases: item.affectedCases,
      riskCodes: item.riskCodes || []
    })),
    privacy: privacy()
  };
}

export function mapExpertEvaluationFailuresToMaintenance(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, created: 0, items: [] };
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  const expert = resolveExpertForKnowledgeBase(knowledgeBase);
  if (!expert) return { ok: true, created: 0, items: [] };
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeBuild = readActiveBuild(db);
    const rows = readEvaluationFailureRows(db, {
      template: expert.templateId,
      buildId: activeBuild?.buildId || ""
    });
    const now = nowIso();
    const insert = db.prepare(`
      INSERT INTO quality_issues (issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at)
      VALUES (?, 'evaluation', ?, ?, 'open', ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        severity = excluded.severity,
        status = excluded.status,
        reason = excluded.reason,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at
    `);
    db.transaction(() => {
      for (const row of rows) {
        insert.run(
          `expert-eval:${expert.id}:${row.caseId}`,
          row.caseId,
          row.status === "fail" || row.status === "missing" ? "fail" : "review",
          "Expert evaluation case needs maintenance review.",
          stableJson(evaluationIssueDetails(expert, row, activeBuild)),
          now,
          now
        );
      }
    })();
    return {
      ok: true,
      created: rows.length,
      items: rows.map((row) => evaluationIssueDetails(expert, row, activeBuild))
    };
  } finally {
    db.close();
  }
}

function expertEvaluationCase(expert, category) {
  const expectedStatus = expectedStatusForCategory(category);
  return {
    caseId: `${expert.id}:${category}`,
    expertId: expert.id,
    template: expert.templateId,
    category,
    expectedStatus,
    requiredCitations: expectedStatus === "answered",
    refusalExpected: expectedStatus === "refused",
    noAnswerExpected: expectedStatus === "noAnswer",
    answerPolicy: queryRouteAnswerPolicy,
    redaction: privacy()
  };
}

function expectedStatusForCategory(category) {
  if (category === "out_of_scope_refusal") return "refused";
  if (category === "no_answer_behavior") return "noAnswer";
  return "answered";
}

function publicEvaluationPrompt(item) {
  return `Public ${item.expertId} evaluation case: ${item.category}`;
}

function publicExpectedPayload(item) {
  return {
    expectedStatus: item.expectedStatus,
    requiredCitations: item.requiredCitations,
    refusalExpected: item.refusalExpected,
    noAnswerExpected: item.noAnswerExpected,
    redacted: true
  };
}

function expertQualityGates(expert, summary = {}, categories = []) {
  const byCategory = new Map(categories.map((item) => [item.category, item]));
  return [
    gate(
      "expertCaseCoverage",
      summary.coveragePercent >= 100 ? "pass" : "fail",
      "Expert evaluation coverage",
      `${summary.coveragePercent || 0}%`
    ),
    gate(
      "expertCitationEvidence",
      summary.failed === 0 && summary.review === 0 && summary.citationBearingUsableRate >= 85 ? "pass" : "fail",
      "Citation-bearing Expert answers",
      `${summary.citationBearingUsableRate || 0}%`
    ),
    gate(
      "expertNoAnswerPolicy",
      categoryReady(byCategory.get("no_answer_behavior")) ? "pass" : "fail",
      "No-answer behavior",
      byCategory.get("no_answer_behavior")?.status || "missing"
    ),
    gate(
      "coreQueryGates",
      "pass",
      "Core query gates remain authoritative",
      queryRouteAnswerPolicy
    )
  ];
}

function categoryReady(category) {
  return Boolean(category && category.failed === 0 && category.review === 0 && category.missing === 0 && category.results > 0);
}

function gate(key, status, label, value) {
  return {
    key,
    status,
    label: { zh: label, en: label },
    value
  };
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

function readEvaluationFailureRows(db, options = {}) {
  const template = String(options.template || "").trim();
  const buildId = String(options.buildId || "").trim();
  return db.prepare(`
    SELECT
      ec.case_id,
      ec.category,
      er.result_id,
      er.status,
      er.scores_json,
      er.details_json
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
      AND ec.template = ?
    ORDER BY ec.category ASC, ec.case_id ASC
  `).all(buildId, buildId, template).map((row) => {
    const details = parseJson(row.details_json, {});
    const status = row.result_id ? normalizeStatus(row.status) : "missing";
    return {
      caseId: String(row.case_id || ""),
      category: String(row.category || ""),
      resultId: String(row.result_id || ""),
      status,
      riskCodes: safeRiskCodes(details)
    };
  }).filter((row) => row.status !== "pass");
}

function evaluationIssueDetails(expert, row, activeBuild) {
  return {
    issueType: "expert_evaluation_gap",
    expertId: expert.id,
    template: expert.templateId,
    category: row.category,
    caseId: row.caseId,
    resultId: row.resultId,
    status: row.status,
    buildId: activeBuild?.buildId || "",
    riskCodes: row.riskCodes,
    rerunScope: {
      type: "expert_evaluation",
      expertId: expert.id,
      template: expert.templateId,
      category: row.category,
      caseId: row.caseId,
      buildId: activeBuild?.buildId || ""
    },
    redacted: true
  };
}

function normalizeStatus(value) {
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

function resolveExpert(expertOrId) {
  if (!expertOrId) return null;
  if (typeof expertOrId === "string") return getExpert(expertOrId);
  if (expertOrId.id && getExpert(expertOrId.id)) return getExpert(expertOrId.id);
  return expertOrId;
}

function privacy() {
  return {
    redacted: true,
    excludes: redactionExcludes
  };
}
