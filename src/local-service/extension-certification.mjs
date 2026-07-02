import { extensionLifecycleStages } from "./extension-lifecycle.mjs";

export const extensionCertificationRegistry = [
  certification({
    kind: "expert",
    id: "k12",
    owner: "KnowMesh Core",
    stage: "official",
    supportedContractVersion: "2026-07-query-runtime.1",
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
    securityNotes: [
      "Does not bundle textbook content.",
      "Uses catalog writer/query interfaces rather than direct private storage paths."
    ],
    knownLimitations: [
      "K12 remains the first strengthened Expert scenario and does not define Core product scope."
    ]
  }),
  certification({
    kind: "expert",
    id: "operations-handbook",
    owner: "Community Example",
    stage: "experimental",
    supportedContractVersion: "2026-07-query-runtime.1",
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
    securityNotes: [
      "Example extension; no private handbook content is bundled."
    ],
    knownLimitations: [
      "Requires processor, evaluation, and Query Runtime route coverage before graduation."
    ]
  }),
  certification({
    kind: "provider",
    id: "local-catalog",
    owner: "KnowMesh Core",
    stage: "official",
    supportedContractVersion: "2026-07-query-runtime.1",
    docs: [
      "docs/providers.zh-CN.md",
      "docs/providers.en.md"
    ],
    requiredTests: [
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/catalog-search.test.mjs"
    ],
    securityNotes: [
      "Local-only provider; credentials are excluded from diagnostics and package previews."
    ],
    knownLimitations: [
      "Analytical exports remain sidecar/report formats rather than mutable runtime state."
    ]
  }),
  certification({
    kind: "provider",
    id: "local-parser",
    owner: "KnowMesh Core",
    stage: "certified",
    supportedContractVersion: "2026-07-query-runtime.1",
    docs: [
      "docs/providers.zh-CN.md",
      "docs/providers.en.md"
    ],
    requiredTests: [
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/execution/parser-provider.test.mjs"
    ],
    securityNotes: [
      "Runs locally, never executes macros, and records extraction results through public writer APIs."
    ],
    knownLimitations: [
      "Legacy Office and WPS formats require a compatible converter or manual conversion."
    ]
  }),
  certification({
    kind: "provider",
    id: "local-vector",
    owner: "KnowMesh Core",
    stage: "certified",
    supportedContractVersion: "2026-07-query-runtime.1",
    docs: [
      "docs/providers.zh-CN.md",
      "docs/providers.en.md"
    ],
    requiredTests: [
      "src/local-service/retrieval-manifests.test.mjs",
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/query-evidence.test.mjs",
      "src/local-service/server.test.mjs"
    ],
    securityNotes: [
      "Local vectors are accelerators only; catalog rows remain the authority.",
      "Invalid sidecars must fall back to catalog search instead of serving vector-only truth."
    ],
    knownLimitations: [
      "Local vector engines are optional and disabled by default until a local adapter is configured."
    ]
  })
];

export function extensionCertificationSummary() {
  const experts = extensionCertificationRegistry.filter((item) => item.kind === "expert").map(publicCertificationSummary);
  const providers = extensionCertificationRegistry.filter((item) => item.kind === "provider").map(publicCertificationSummary);
  return {
    kind: "knowmesh.extensionCertification",
    contractVersion: "2026-07-query-runtime.1",
    experts,
    providers
  };
}

export function findExtensionCertification(kind, id) {
  return extensionCertificationRegistry.find((item) => item.kind === kind && item.id === id) || null;
}

export function validateExtensionCertification(entry = {}) {
  const issues = [];
  if (!entry.kind || !["expert", "provider"].includes(entry.kind)) issues.push("kind");
  if (!entry.id) issues.push("id");
  if (!entry.owner) issues.push("owner");
  if (!extensionLifecycleStages.includes(entry.lifecycle?.stage)) issues.push("lifecycle.stage");
  if (!entry.supportedContractVersion) issues.push("supportedContractVersion");
  if (!nonEmptyArray(entry.docs)) issues.push("docs");
  if (!nonEmptyArray(entry.requiredTests)) issues.push("requiredTests");
  if (!nonEmptyArray(entry.securityNotes)) issues.push("securityNotes");
  if (!Array.isArray(entry.knownLimitations)) issues.push("knownLimitations");
  if (hasUnsafePermissions(entry.permissions)) issues.push("unsafePermissions");
  if (hasInternalSqliteDependency(entry)) issues.push("internalSQLiteDependency");
  return {
    ok: issues.length === 0,
    issues
  };
}

export function validateLifecycleGraduation(entry = {}) {
  const validation = validateExtensionCertification(entry);
  const stage = entry.lifecycle?.stage || "";
  if (["certified", "official"].includes(stage)) {
    if ((entry.requiredTests || []).length < 1 && !validation.issues.includes("requiredTests")) validation.issues.push("requiredTests");
    if ((entry.securityNotes || []).length < 1 && !validation.issues.includes("securityNotes")) validation.issues.push("securityNotes");
  }
  return {
    ok: validation.issues.length === 0,
    issues: unique(validation.issues)
  };
}

function certification({ kind, id, owner, stage, supportedContractVersion, docs, requiredTests, securityNotes, knownLimitations }) {
  return {
    kind,
    id,
    owner,
    lifecycle: {
      stage,
      since: "0.1.0-alpha"
    },
    supportedContractVersion,
    docs,
    requiredTests,
    securityNotes,
    knownLimitations
  };
}

function publicCertificationSummary(entry) {
  return {
    kind: entry.kind,
    id: entry.id,
    owner: entry.owner,
    lifecycle: { ...entry.lifecycle },
    supportedContractVersion: entry.supportedContractVersion,
    docs: [...entry.docs],
    requiredTests: [...entry.requiredTests],
    securityNotes: [...entry.securityNotes],
    knownLimitations: [...entry.knownLimitations]
  };
}

function hasInternalSqliteDependency(value, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, item] of Object.entries(value)) {
    const text = typeof item === "string" ? item : String(key || "");
    if (/catalog\.sqlite|workspace\.sqlite|internal-sqlite|directCatalog/i.test(text)) return true;
    if (item && typeof item === "object" && hasInternalSqliteDependency(item, seen)) return true;
  }
  return false;
}

function hasUnsafePermissions(permissions) {
  if (!Array.isArray(permissions)) return false;
  return permissions.some((item) => ["*", "admin", "root", "filesystem:all", "sqlite:write"].includes(String(item || "").trim()));
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function unique(values) {
  return [...new Set(values)];
}
