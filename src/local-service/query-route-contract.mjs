export const queryRouteContractVersion = "2026-07-query-runtime.1";
export const queryRouteAnswerPolicy = "citation_ready_evidence_only";

export function buildQueryRouteContract(plan = {}, options = {}) {
  const refusalReason = options.refusalReason || (plan.ok ? "" : plan.status || "insufficient_evidence");
  const allowedToAnswer = Boolean(plan.ok && plan.route?.key !== "reject");
  return {
    version: queryRouteContractVersion,
    answerPolicy: queryRouteAnswerPolicy,
    allowedToAnswer,
    noEvidenceStatus: "insufficient_evidence",
    evidenceRule: evidenceRule(),
    candidateRoutes: allowedToAnswer ? candidateRoutesForPlan(plan) : [],
    expertRouteRules: normalizeExpertRouteRules(plan.expert?.routeRules),
    refusalTaxonomy: queryRefusalTaxonomy(),
    refusal: allowedToAnswer
      ? null
      : {
          reason: refusalReason,
          status: refusalReasonToStatus(refusalReason)
        }
  };
}

function normalizeExpertRouteRules(rules) {
  return (Array.isArray(rules) ? rules : []).map((rule) => ({
    key: String(rule.key || ""),
    intent: String(rule.intent || ""),
    priority: Number.isFinite(rule.priority) ? rule.priority : 0,
    evidencePolicy: rule.evidencePolicy || queryRouteAnswerPolicy,
    answerPolicy: queryRouteAnswerPolicy,
    requiresEvidence: rule.evidencePolicy !== "refuse_before_retrieval",
    allowsUncitedAnswer: false
  })).filter((rule) => rule.key);
}

export function queryRouteContractSummary() {
  return {
    version: queryRouteContractVersion,
    answerPolicy: queryRouteAnswerPolicy,
    noEvidenceStatus: "insufficient_evidence",
    evidenceRule: evidenceRule(),
    refusalTaxonomy: queryRefusalTaxonomy(),
    candidateRouteKeys: ["k12Catalog", "structureCatalog", "catalogSearch", "vectorSidecar"]
  };
}

export function queryRefusalTaxonomy() {
  return [
    refusalType("out_of_scope", "out_of_scope"),
    refusalType("unsupported_source", "no_index"),
    refusalType("insufficient_evidence", "insufficient_evidence"),
    refusalType("low_confidence", "blocked_by_quality"),
    refusalType("provider_unavailable", "provider_unavailable"),
    refusalType("maintenance_required", "blocked_by_quality")
  ];
}

function candidateRoutesForPlan(plan = {}) {
  const key = plan.route?.key || "";
  if (key === "k12Catalog") {
    return [
      routeCandidate("k12Catalog", ["structure_nodes", "knowledge_objects", "object_relations", "citations"])
    ];
  }
  if (key === "structureCatalog") {
    return [
      routeCandidate("structureCatalog", ["structure_nodes", "citations", "source_documents"]),
      routeCandidate("catalogSearch", ["chunks", "citations"])
    ];
  }
  if (key === "hybridRetrieval") {
    return [
      routeCandidate("structureCatalog", ["structure_nodes", "citations"]),
      routeCandidate("catalogSearch", ["chunks", "citations"]),
      routeCandidate("vectorSidecar", ["index_records"], { acceleratorOnly: true })
    ];
  }
  return [];
}

function routeCandidate(key, evidenceSources, extra = {}) {
  return {
    key,
    evidenceSources,
    answerPolicy: queryRouteAnswerPolicy,
    ...extra
  };
}

function evidenceRule() {
  return {
    required: true,
    citationReady: true,
    uncitedAnswerFallback: "refuse"
  };
}

function refusalType(key, status) {
  return { key, status };
}

function refusalReasonToStatus(reason) {
  const found = queryRefusalTaxonomy().find((item) => item.key === reason || item.status === reason);
  return found?.status || reason || "insufficient_evidence";
}
