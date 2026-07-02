import {
  expertManifestAuthoringContract,
  getExpert,
  listExperts,
  resolveExpertForKnowledgeBase,
  validateExpertAuthoringManifest
} from "./expert-registry.mjs";
import { queryRouteAnswerPolicy, queryRouteContractVersion } from "./query-route-contract.mjs";

const allowedEvidencePolicies = new Set([
  "citation_ready_evidence_only",
  "refuse_before_retrieval",
  "no_weak_answer"
]);

const publicHooks = [
  hook("sourceScope.decide", "source-scope", ["readSourceManifest", "returnScopeDecision"]),
  hook("classification.hintPageBlocks", "classification", ["readExtractionManifest", "returnHints"]),
  hook("catalogWriter.writeStructureNodes", "catalog-writer", ["writeStructureNodes"]),
  hook("catalogWriter.writeKnowledgeObjects", "catalog-writer", ["writeKnowledgeObjects", "writeObjectRelations"]),
  hook("queryRoutes.registerRules", "query-runtime", ["registerRouteRules"]),
  hook("evaluation.registerCases", "evaluation", ["registerEvaluationCases"])
];

export function expertRuntimeContract() {
  const authoring = expertManifestAuthoringContract();
  return {
    kind: "knowmesh.expertRuntimeContract",
    version: authoring.version,
    queryRuntimeContractVersion: queryRouteContractVersion,
    manifestVersion: authoring.manifestVersion,
    publicHooks: publicHooks.map((item) => ({ ...item })),
    writeBoundary: "catalog-writer-api",
    directStorageAccess: false,
    answerPolicy: queryRouteAnswerPolicy,
    allowedEvidencePolicies: [...allowedEvidencePolicies],
    statePolicy: "core-managed-runtime-state",
    artifactPolicy: "core-managed-artifact-paths"
  };
}

export function expertRuntimeBoundaryForExpert(expertOrId) {
  const expert = resolveExpert(expertOrId);
  if (!expert) return null;
  return {
    expertId: expert.id,
    id: expert.id,
    templateId: expert.templateId,
    lifecycle: { ...(expert.lifecycle || { stage: "experimental" }) },
    supportedContractVersion: expert.supportedContractVersion || "",
    writeBoundary: "catalog-writer-api",
    directStorageAccess: false,
    publicHooks: publicHooks.map((item) => ({
      ...item,
      required: hookRequiredForExpert(item.key, expert)
    })),
    routeRules: normalizeExpertRouteRules(expert),
    qualityGates: [...(expert.qualityGates || [])],
    evaluationCases: [...(expert.evaluationCases || [])],
    capabilities: Object.keys(expert.capabilities || {})
  };
}

export function validateExpertRuntimeBoundary(expertOrId) {
  const expert = resolveExpert(expertOrId);
  const validation = expert ? validateExpertAuthoringManifest(expert) : { ok: false, issues: ["expert"] };
  const issues = validation.issues.slice();
  if (hasUnsafePermissions(expert?.permissions)) issues.push("unsafePermissions");
  if (hasDirectStorageDependency(expert)) issues.push("directStorageAccess");
  if (hasUnsupportedEvidencePolicy(expert?.queryRouteRules)) issues.push("unsupportedEvidencePolicy");
  return {
    ok: unique(issues).length === 0,
    issues: unique(issues)
  };
}

export function expertRouteRulesForKnowledgeBase(state, knowledgeBase = {}) {
  const expert = resolveExpertForKnowledgeBase(knowledgeBase);
  if (!expert) {
    return {
      expert: null,
      rules: [],
      diagnostics: {
        status: "not_applicable",
        redacted: true
      }
    };
  }
  const boundary = expertRuntimeBoundaryForExpert(expert);
  return {
    expert: publicRuntimeExpert(boundary),
    rules: boundary.routeRules,
    diagnostics: {
      status: "registered",
      redacted: true,
      hookCount: boundary.publicHooks.length,
      ruleCount: boundary.routeRules.length,
      writeBoundary: boundary.writeBoundary,
      directStorageAccess: boundary.directStorageAccess
    }
  };
}

export function expertRuntimeDiagnostics() {
  return {
    kind: "knowmesh.expertRuntimeDiagnostics",
    version: expertRuntimeContract().version,
    queryRuntimeContractVersion: queryRouteContractVersion,
    redacted: true,
    writeBoundary: "catalog-writer-api",
    directStorageAccess: false,
    hooks: publicHooks.map((item) => ({ key: item.key, area: item.area })),
    experts: listExperts().map((summary) => publicRuntimeExpert(expertRuntimeBoundaryForExpert(summary.id)))
  };
}

export function publicRuntimeExpert(boundary) {
  if (!boundary) return null;
  return {
    id: boundary.id || boundary.expertId,
    templateId: boundary.templateId,
    lifecycle: { ...(boundary.lifecycle || { stage: "experimental" }) },
    supportedContractVersion: boundary.supportedContractVersion || "",
    writeBoundary: boundary.writeBoundary,
    directStorageAccess: boundary.directStorageAccess === true ? true : false,
    hookKeys: (boundary.publicHooks || []).map((item) => item.key),
    routeRules: (boundary.routeRules || []).map((item) => ({ ...item })),
    qualityGates: [...(boundary.qualityGates || [])],
    evaluationCases: [...(boundary.evaluationCases || [])]
  };
}

export function normalizeExpertRouteRules(expertOrId) {
  const expert = resolveExpert(expertOrId);
  return (expert?.queryRouteRules || []).map((rule) => ({
    key: String(rule.key || ""),
    intent: String(rule.intent || ""),
    priority: Number.isFinite(rule.priority) ? rule.priority : 0,
    evidencePolicy: allowedEvidencePolicies.has(rule.evidencePolicy) ? rule.evidencePolicy : "citation_ready_evidence_only",
    answerPolicy: queryRouteAnswerPolicy,
    requiresEvidence: rule.evidencePolicy !== "refuse_before_retrieval",
    allowsUncitedAnswer: false
  })).filter((rule) => rule.key);
}

function resolveExpert(expertOrId) {
  if (!expertOrId) return null;
  if (typeof expertOrId === "string") return getExpert(expertOrId);
  if (expertOrId.id && getExpert(expertOrId.id)) return getExpert(expertOrId.id);
  return expertOrId;
}

function hook(key, area, operations) {
  return {
    key,
    area,
    operations,
    boundary: "public-core-api"
  };
}

function hookRequiredForExpert(key, expert) {
  if (key === "sourceScope.decide") return Boolean(expert.sourceScope);
  if (key === "queryRoutes.registerRules") return Array.isArray(expert.queryRouteRules) && expert.queryRouteRules.length > 0;
  if (key === "evaluation.registerCases") return Array.isArray(expert.evaluationCases) && expert.evaluationCases.length > 0;
  if (key === "catalogWriter.writeStructureNodes" || key === "catalogWriter.writeKnowledgeObjects") {
    return Array.isArray(expert.extraction?.objects) && expert.extraction.objects.length > 0;
  }
  return false;
}

function hasUnsafePermissions(permissions) {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((item) => ["*", "admin", "root", "filesystem:all", "sqlite:write"].includes(String(item || "").trim()));
}

function hasDirectStorageDependency(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    const text = typeof item === "string" ? item : String(key || "");
    if (/catalog\.sqlite|workspace\.sqlite|direct-sqlite|directCatalog|internalStorage|coreTable/i.test(text)) return true;
    if (item && typeof item === "object" && hasDirectStorageDependency(item, seen)) return true;
  }
  return false;
}

function hasUnsupportedEvidencePolicy(rules) {
  if (!Array.isArray(rules)) return false;
  return rules.some((rule) => rule?.evidencePolicy && !allowedEvidencePolicies.has(rule.evidencePolicy));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
