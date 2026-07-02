const k12TemplateId = "textbook-cn-k12";
const expertSdkContractVersion = "2026-07-expert-sdk.1";
const queryRuntimeContractVersion = "2026-07-query-runtime.1";
const expertManifestRequiredFields = [
  "id",
  "templateId",
  "manifestVersion",
  "supportedContractVersion",
  "lifecycle",
  "title",
  "supportedSourceTypes",
  "setupFields",
  "sourceScope",
  "extraction.objects",
  "extraction.relations",
  "queryRouteRules",
  "qualityGates",
  "evaluationCases",
  "migrations",
  "capabilities",
  "docs",
  "requiredTests",
  "permissions"
];

const k12CapabilityOrder = [
  "schema",
  "sourceScopeGate",
  "pageClassifier",
  "structureBuilder",
  "objectExtractor",
  "queryRouter",
  "evaluationSet"
];

const experts = [
  {
    id: "k12",
    templateId: k12TemplateId,
    name: "KnowMesh Expert · K12",
    status: "alpha",
    lifecycle: {
      stage: "official",
      since: "0.1.0-alpha",
      graduation: "K12 is the first official Expert scenario maintained with Core."
    },
    manifestVersion: "1.0.0",
    supportedContractVersion: queryRuntimeContractVersion,
    title: {
      zh: "K12 教材 Expert",
      en: "K12 Textbook Expert"
    },
    supportedSourceTypes: ["pdf", "office", "wps", "markdown", "text", "image"],
    setupFields: [
      setupField("metadata.stage", true),
      setupField("metadata.subject", true),
      setupField("metadata.grade", true),
      setupField("metadata.volume", false),
      setupField("metadata.publisher", false),
      setupField("metadata.edition", false)
    ],
    extraction: {
      objects: [
        "book",
        "unit",
        "lesson",
        "section",
        "column",
        "text",
        "vocabulary",
        "knowledge_point",
        "formula",
        "table",
        "figure",
        "example",
        "exercise",
        "answer_explanation",
        "experiment",
        "activity",
        "citation_anchor"
      ],
      relations: ["contains", "teaches", "explains", "cites", "appears_on_page", "belongs_to_unit"]
    },
    sourceScope: {
      policy: "required-metadata-scope",
      rules: ["stage", "subject", "grade", "volume", "publisher", "sourceFolder"]
    },
    gates: ["sourceScope", "structureCompleteness", "citationCoverage", "outOfScopeRefusal", "displaySerialization"],
    qualityGates: ["sourceScope", "structureCompleteness", "citationCoverage", "outOfScopeRefusal", "displaySerialization"],
    queryRoutes: ["structureLookup", "domainObjectLookup", "hybridCitation", "outOfScopeRefusal"],
    queryRouteRules: [
      { key: "k12Catalog", intent: "structureLookup", priority: 10, evidencePolicy: "citation_ready_evidence_only" },
      { key: "domainObjectLookup", intent: "domainObjectLookup", priority: 9, evidencePolicy: "citation_ready_evidence_only" },
      { key: "outOfScopeRefusal", intent: "out_of_scope", priority: 100, evidencePolicy: "refuse_before_retrieval" }
    ],
    evaluationCases: ["toc_lookup", "unit_lesson_lookup", "vocabulary_lookup", "page_citation", "out_of_scope_refusal", "no_answer_behavior"],
    migrations: [
      { id: "k12-001-object-contract", scope: "catalog", required: true }
    ],
    docs: [
      "docs/experts/k12.zh-CN.md",
      "docs/experts/k12.en.md",
      "docs/experts/authoring.zh-CN.md",
      "docs/experts/authoring.en.md"
    ],
    requiredTests: [
      "src/local-service/expert-registry.test.mjs",
      "src/local-service/expert-runtime.test.mjs",
      "src/local-service/expert-evaluation.test.mjs",
      "src/local-service/k12-expert-readiness.test.mjs",
      "src/local-service/k12-query-router.test.mjs"
    ],
    permissions: [],
    fixtures: [],
    capabilities: {
      schema: {
        kind: "json-schema",
        path: "src/experts/k12/schema.json",
        url: "../experts/k12/schema.json"
      },
      sourceScopeGate: {
        kind: "module",
        module: "../core/document-scope.mjs",
        exports: ["buildK12SourceScopeGate"]
      },
      pageClassifier: {
        kind: "module",
        module: "../core/k12-page-classifier.mjs",
        exports: ["classifyK12Page", "k12ContentTypeForRecord"]
      },
      structureBuilder: {
        kind: "module",
        module: "./k12-toc-builder.mjs",
        exports: ["syncK12TocEntriesToCatalog", "parseK12TocEntries"]
      },
      objectExtractor: {
        kind: "module",
        module: "./k12-object-extractor.mjs",
        exports: ["extractK12ObjectsFromCatalog"]
      },
      queryRouter: {
        kind: "module",
        module: "./k12-query-router.mjs",
        exports: ["routeK12QueryFromCatalog", "classifyK12QueryIntent"]
      },
      evaluationSet: {
        kind: "module",
        module: "./k12-evaluation-runner.mjs",
        exports: ["k12RequiredEvaluationCases", "seedK12EvaluationCases", "runK12CatalogEvaluation", "syncK12EvaluationForJob"]
      }
    }
  },
  {
    id: "operations-handbook",
    templateId: "operations-handbook",
    name: "KnowMesh Expert · Operations Handbook",
    status: "example",
    lifecycle: {
      stage: "experimental",
      since: "0.1.0-alpha",
      graduation: "Example Experts must add processors, tests, and docs before community use."
    },
    manifestVersion: "1.0.0",
    supportedContractVersion: queryRuntimeContractVersion,
    title: {
      zh: "运营手册 Expert 示例",
      en: "Operations Handbook Expert Example"
    },
    supportedSourceTypes: ["markdown", "text", "pdf", "office"],
    setupFields: [
      setupField("metadata.domain", false),
      setupField("metadata.owner", false),
      setupField("metadata.effective_date", false)
    ],
    extraction: {
      objects: ["policy", "procedure", "workflow", "workflow_step", "role", "exception", "owner", "review_cadence", "rollback_rule", "evidence_requirement"],
      relations: ["owned_by", "requires", "supersedes", "cites", "has_exception", "has_role", "requires_evidence"]
    },
    sourceScope: {
      policy: "public-handbook-scope",
      rules: ["documentType", "owner", "effectiveDate"]
    },
    gates: ["citationCoverage", "currentVersion", "secretRedaction", "reviewCadence"],
    qualityGates: ["citationCoverage", "currentVersion", "credentialRedaction", "reviewCadence"],
    queryRoutes: ["policyScopeLookup", "workflowStepLookup", "hybridCitation", "noAnswerWithoutEvidence"],
    queryRouteRules: [
      { key: "policyScopeLookup", intent: "structure_lookup", priority: 8, evidencePolicy: "citation_ready_evidence_only" },
      { key: "workflowStepLookup", intent: "procedure_lookup", priority: 8, evidencePolicy: "citation_ready_evidence_only" },
      { key: "noAnswerWithoutEvidence", intent: "insufficient_evidence", priority: 90, evidencePolicy: "no_weak_answer" }
    ],
    evaluationCases: ["policy_lookup", "workflow_step_lookup", "review_cadence_lookup", "rollback_rule_lookup", "no_answer_behavior"],
    migrations: [
      { id: "operations-handbook-001-object-contract", scope: "catalog", required: false }
    ],
    docs: [
      "docs/experts/operations-handbook.zh-CN.md",
      "docs/experts/operations-handbook.en.md",
      "docs/experts/authoring.zh-CN.md",
      "docs/experts/authoring.en.md"
    ],
    requiredTests: [
      "src/local-service/expert-registry.test.mjs",
      "src/local-service/expert-runtime.test.mjs",
      "src/local-service/expert-evaluation.test.mjs",
      "src/local-service/operations-handbook-expert.test.mjs"
    ],
    permissions: [],
    fixtures: ["examples/public-samples/operations-handbook/source/incident-operations-handbook.md"],
    capabilities: {
      schema: {
        kind: "json-schema",
        path: "src/experts/operations-handbook/schema.json",
        url: "../experts/operations-handbook/schema.json"
      }
    }
  }
];

export function listExperts() {
  return experts.map(publicExpertSummary);
}

export function getExpert(expertId) {
  const id = String(expertId || "").trim();
  return experts.find((expert) => expert.id === id) || null;
}

export function resolveExpertForTemplate(templateId) {
  const id = String(templateId || "").trim();
  if (!id) return null;
  return experts.find((expert) => expert.templateId === id) || null;
}

export function resolveExpertForKnowledgeBase(knowledgeBase = {}) {
  return resolveExpertForTemplate(knowledgeBase.template || knowledgeBase.templateId || "");
}

export function expertManifestAuthoringContract() {
  return {
    kind: "knowmesh.expertManifestAuthoringContract",
    version: expertSdkContractVersion,
    supportedRuntimeContractVersion: queryRuntimeContractVersion,
    manifestVersion: "1.0.0",
    requiredFields: [...expertManifestRequiredFields],
    forbiddenPatterns: [
      "direct-sqlite",
      "core-table-mutation",
      "wildcard-permission",
      "private-fixture",
      "private-workspace-path"
    ],
    publicInterfaces: [
      "source-manifest",
      "catalog-writer-api",
      "quality-gates",
      "query-route-rules",
      "evaluation-manifest",
      "maintenance-review"
    ]
  };
}

export function expertCapabilityKeys(expert) {
  if (!expert) return [];
  if (Array.isArray(expert.capabilities)) return expert.capabilities.slice();
  const capabilities = expert.capabilities || {};
  const keys = Object.keys(capabilities);
  return k12CapabilityOrder.filter((key) => keys.includes(key)).concat(keys.filter((key) => !k12CapabilityOrder.includes(key)));
}

export function publicExpertSummary(expert) {
  if (!expert) return null;
  return {
    id: expert.id,
    templateId: expert.templateId,
    name: expert.name,
    status: expert.status,
    lifecycle: {
      ...(expert.lifecycle || { stage: "experimental" })
    },
    manifestVersion: expert.manifestVersion,
    capabilities: expertCapabilityKeys(expert),
    supportedSourceTypes: [...(expert.supportedSourceTypes || [])],
    gates: [...(expert.gates || [])]
  };
}

export function validateExpertManifest(expert) {
  const issues = [];
  if (!expert?.id) issues.push("id");
  if (!expert?.templateId) issues.push("templateId");
  if (expert?.manifestVersion !== "1.0.0") issues.push("manifestVersion");
  if (!expert?.title?.zh || !expert?.title?.en) issues.push("title");
  if (!nonEmptyArray(expert?.supportedSourceTypes)) issues.push("supportedSourceTypes");
  if (!Array.isArray(expert?.setupFields)) issues.push("setupFields");
  if (!nonEmptyArray(expert?.extraction?.objects)) issues.push("extraction.objects");
  if (!Array.isArray(expert?.extraction?.relations)) issues.push("extraction.relations");
  if (!nonEmptyArray(expert?.gates)) issues.push("gates");
  if (!nonEmptyArray(expert?.queryRoutes)) issues.push("queryRoutes");
  if (!["official", "certified", "community", "experimental"].includes(expert?.lifecycle?.stage)) issues.push("lifecycle.stage");
  return {
    ok: issues.length === 0,
    issues
  };
}

export function validateExpertAuthoringManifest(expert) {
  const issues = validateExpertManifest(expert).issues.slice();
  if (!expert?.supportedContractVersion) issues.push("supportedContractVersion");
  if (!nonEmptyArray(expert?.sourceScope?.rules)) issues.push("sourceScope");
  if (!nonEmptyArray(expert?.queryRouteRules)) issues.push("queryRouteRules");
  if (!nonEmptyArray(expert?.qualityGates)) issues.push("qualityGates");
  if (!nonEmptyArray(expert?.evaluationCases)) issues.push("evaluationCases");
  if (!Array.isArray(expert?.migrations)) issues.push("migrations");
  if (!expert?.capabilities || typeof expert.capabilities !== "object") issues.push("capabilities");
  if (!nonEmptyArray(expert?.docs)) issues.push("docs");
  if (!nonEmptyArray(expert?.requiredTests)) issues.push("requiredTests");
  if (!Array.isArray(expert?.permissions)) issues.push("permissions");
  if (hasUnsafePermissions(expert?.permissions)) issues.push("unsafePermissions");
  if (hasInternalSqliteDependency(expert)) issues.push("internalSQLiteDependency");
  if (expert?.mutatesCoreTables === true) issues.push("coreTableMutation");
  if (hasPrivateFixture(expert?.fixtures)) issues.push("privateFixture");
  return {
    ok: issues.length === 0,
    issues: unique(issues)
  };
}

export async function loadExpertCapability(expertOrId, capabilityKey) {
  const expert = typeof expertOrId === "string" ? getExpert(expertOrId) : expertOrId;
  const capability = expert?.capabilities?.[capabilityKey];
  if (!capability) return null;
  if (capability.kind === "json-schema") {
    return {
      ...capability,
      fileUrl: new URL(capability.url, import.meta.url)
    };
  }
  if (capability.kind === "module") {
    const module = await import(new URL(capability.module, import.meta.url).href);
    return Object.fromEntries(capability.exports.map((name) => [name, module[name]]));
  }
  return { ...capability };
}

function setupField(key, required) {
  return { key, required: required === true };
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasUnsafePermissions(permissions) {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((item) => ["*", "admin", "root", "filesystem:all", "sqlite:write"].includes(String(item || "").trim()));
}

function hasInternalSqliteDependency(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    const text = typeof item === "string" ? item : String(key || "");
    if (/catalog\.sqlite|workspace\.sqlite|internal-sqlite|directCatalog|direct-catalog-sqlite/i.test(text)) return true;
    if (item && typeof item === "object" && hasInternalSqliteDependency(item, seen)) return true;
  }
  return false;
}

function hasPrivateFixture(fixtures) {
  if (!Array.isArray(fixtures)) return false;
  return fixtures.some((item) => /(?:^[A-Z]:[\\/]|\/Users\/|\\Users\\|private|workspace|真实教材|客户|student)/i.test(String(item || "")));
}

function unique(values) {
  return [...new Set(values)];
}
