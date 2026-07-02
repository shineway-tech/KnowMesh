#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const releaseGateChecklist = [
  gate("npmTest", "npm test", "Full local test suite must pass."),
  gate("releaseSmoke", "npm run smoke:release", "Temporary local service smoke must pass."),
  gate("artifactSmoke", "npm run smoke:artifact", "Packed tarball install smoke must pass and report a sha256 checksum."),
  gate("packageBoundary", "npm run verify:package-boundary", "Package dry-run must exclude private state, secrets, SQLite files, tests, and private content."),
  gate("diffCheck", "git diff --check", "Working tree diff must have no whitespace errors."),
  gate("githubCi", "gh run list --workflow CI --limit 1 --json status,conclusion,headSha", "Latest GitHub CI run for the release commit must pass."),
  gate("githubCodeql", "gh run list --workflow CodeQL --limit 1 --json status,conclusion,headSha", "Latest CodeQL run for the release commit must pass."),
  gate("githubScorecard", "gh run list --workflow Scorecard --limit 1 --json status,conclusion,headSha", "Latest OpenSSF Scorecard run for the release commit must pass.")
];

export const publicBetaEvidenceChecklist = [
  gate("browserSampleFlow", "npm run smoke:browser-sample or recorded Playwright evidence", "First-run sample, Query Runtime, diagnostics, package preview, version manifest, and reset must pass on desktop and narrow viewports."),
  gate("betaReleaseNotes", "docs release notes review", "Beta release notes must separate supported paths, limitations, known gaps, and npm publication decision."),
  gate("releaseAssetReview", "release asset review", "Release assets must exclude private state, SQLite files, secrets, logs, and unintended local artifacts.")
];

export const searchableReleaseEvidenceChecklist = [
  gate("searchableReadiness", "catalog/query/search readiness review", "Catalog search, scoped search API, citation-ready evidence, and Query Runtime evidence lookup must pass."),
  gate("incrementalUpdateProof", "incremental source update proof", "Source deltas, targeted rerun scope, and rollback-ready versions must be verified."),
  gate("vectorFallbackProof", "vector sidecar fallback proof", "Invalid vector sidecars must be blocked and Query Runtime must fall back to catalog search."),
  gate("browserSearchWorkflow", "real browser evidence-search workflow", "Desktop and narrow Web Console evidence search must show maintainable citation evidence through the real API path."),
  gate("staleJsonAuthorityAudit", "stale JSON authority audit", "No JSON or JSONL path may behave like mutable primary workspace or catalog state."),
  gate("packageAssetReview", "0.2.0 package asset review", "Release/package assets must exclude private state, SQLite files, secrets, generated browser artifacts, and stale JSON authority files.")
];

export const queryRuntimeReleaseEvidenceChecklist = [
  gate("routeContractReadiness", "query route contract review", "Route contract, refusal taxonomy, and citation-ready evidence policy must be verified."),
  gate("citationGroundedAnswerProof", "citation-grounded answer proof", "Answered responses must be backed by evidence packs, citations, and query quality gates."),
  gate("refusalNoAnswerProof", "refusal/no-answer proof", "Out-of-scope and insufficient-evidence questions must refuse or no-answer without weak answers."),
  gate("feedbackMaintenanceProof", "feedback-maintenance proof", "Negative feedback must produce maintenance review issues with targeted rerun scope; positive feedback stays a bounded signal."),
  gate("integrationContractProof", "integration contract proof", "OpenAPI, Node.js example, HTTP example, and drift tests must describe the same Query Runtime contract."),
  gate("browserAskWorkflow", "real browser ask workflow", "Desktop and narrow Web Console ask flows must prove answered, refused/no-answer, and feedback-maintenance behavior.")
];

export const expertSdkReleaseEvidenceChecklist = [
  gate("expertManifestReadiness", "expert manifest readiness", "Expert manifest contract, validation, and lifecycle certification must be verified."),
  gate("expertRuntimeBoundaryProof", "expert runtime boundary proof", "Public hooks, direct-storage blocking, and query-route hook consumption must be verified."),
  gate("nonK12ExampleProof", "non-K12 example Expert proof", "The operations-handbook Expert must prove public fixtures, domain objects, citations, and Query Runtime evidence."),
  gate("expertEvaluationGateProof", "expert evaluation gate proof", "Portable Expert evaluation cases, dashboard aggregation, and maintenance mapping must be verified."),
  gate("expertDocsContributorWorkflowProof", "Expert SDK contributor workflow proof", "Authoring docs, example docs, required tests, and community proposal paths must be documented."),
  gate("expertPackageAssetReview", "Expert SDK package asset review", "Expert SDK release assets must exclude private state, SQLite files, secrets, and private fixtures.")
];

export const providerAdaptersReleaseEvidenceChecklist = [
  gate("providerManifestReadiness", "provider manifest readiness", "Provider adapter manifests, validation, and capability inventory must be verified."),
  gate("parserOcrBoundaryProof", "parser/OCR boundary proof", "Parser and OCR execution must go through adapter preflight, review unsafe inputs, and preserve catalog/artifact truth."),
  gate("embeddingVectorBoundaryProof", "embedding/vector boundary proof", "Embedding, rerank, and vector outputs must be checkpointed and validated against catalog chunks before use."),
  gate("providerDiagnosticsBrowserProof", "provider diagnostics browser proof", "Scoped provider diagnostics must render through the Web Console on desktop and narrow viewports without browser-storage truth."),
  gate("noCloudPublicPathProof", "no-cloud public path proof", "The public sample path must work without credentials or external calls before explicit provider execution."),
  gate("providerPackageAssetReview", "Provider Adapter package asset review", "Provider Adapter release assets must exclude private state, SQLite files, secrets, generated artifacts, and direct-provider bypass paths.")
];

export const integrationSdkReleaseEvidenceChecklist = [
  gate("endpointManifestReadiness", "endpoint manifest readiness", "Endpoint manifest, OpenAPI, scoped discovery, and integration diagnostics discovery must be verified."),
  gate("sdkClientProof", "SDK client proof", "The ESM SDK must prove package exports, scoped helpers, injected fetch, timeout/request id handling, and redacted errors."),
  gate("examplesDriftProof", "integration examples drift proof", "Node example, HTTP example, expected responses, and drift tests must cover the same integration contract."),
  gate("integrationSafetyProof", "integration safety proof", "Retry semantics, diagnostics redaction, localhost-only defaults, and no internal state reads must be verified."),
  gate("providerAwareNoCloudProof", "provider-aware no-cloud proof", "Integration diagnostics and provider diagnostics must prove the public sample path performs no external calls before explicit provider execution."),
  gate("integrationPackageAssetReview", "Integration SDK package asset review", "Integration SDK release assets must exclude private state, SQLite files, secrets, generated artifacts, and direct internal-state read paths.")
];

export const consumerIntegrationReleaseEvidenceChecklist = [
  gate("installedSdkConsumerProof", "installed SDK consumer proof", "An external app must import the installed package through public exports and use SDK helpers without repository internals."),
  gate("livePublicSampleSdkProof", "live public-sample SDK proof", "The installed SDK must call a live local service public sample through real HTTP, including answer, refusal, search, feedback, diagnostics, package preview, version manifest, and reset."),
  gate("integrationRecipeProof", "integration recipe proof", "Integration docs must cover server-side Node, Electron/local desktop, browser-through-backend, CI smoke, localhost/CORS, retry, request id, and feedback maintenance links."),
  gate("privacyBoundaryAuditProof", "integration privacy audit proof", "Integration docs, examples, expected responses, and SDK entry points must pass the privacy boundary audit with no direct internal reads or leaks."),
  gate("providerAwareNoCloudConsumerProof", "provider-aware no-cloud consumer proof", "Consumer-facing public sample integration must remain credential-free and make no external provider calls before explicit execution."),
  gate("consumerPackageAssetReview", "Consumer Integration package asset review", "Consumer Integration release assets must exclude private state, SQLite files, secrets, generated artifacts, direct internal-state reads, and private package files.")
];

export const operatorWorkflowReleaseEvidenceChecklist = [
  gate("sourceIntakeProof", "operator source intake proof", "A non-sample operator KB must prove folder precheck, scan preview, source manifest, exclusion/restoration, source delta handling, plan preview, and K12 gate isolation."),
  gate("executionRecoveryProof", "operator execution recovery proof", "Operator execution must prove job creation, checkpoint persistence, progress polling, pause/resume/stop semantics, service restart recovery, task summary, and redacted diagnostics."),
  gate("maintenanceTargetedRerunProof", "operator maintenance targeted-rerun proof", "Evidence search, query feedback, quality issues, safe rerun scopes, targeted rerun jobs, and review resolution must work as one maintenance loop."),
  gate("versionRollbackProof", "operator version rollback proof", "Operator version flows must prove manifest, package preview, version listing, diff, rollback preview, rollback confirmation, and cross-KB isolation."),
  gate("operatorBrowserWorkflow", "operator browser workflow proof", "Desktop and narrow Web Console surfaces must expose source intake, execution, maintenance, versions, feedback, and diagnostics without direct internal state reads."),
  gate("operatorPrivacyAuditProof", "operator privacy audit proof", "Operator diagnostics and browser/API surfaces must redact credentials, private content, local absolute paths, raw provider payloads, and avoid external calls before explicit execution."),
  gate("operatorPackageAssetReview", "Operator Workflow package asset review", "Operator Workflow release assets must exclude private state, SQLite files, secrets, generated artifacts, direct internal-state reads, and private package files.")
];

export const firstRunUsabilityReleaseEvidenceChecklist = [
  gate("firstRunLaunchProof", "first-run launch proof", "A fresh local user data root must prove empty launch, create/sample actions, runtime diagnostics, provider readiness, and localhost-only diagnostics."),
  gate("guidedSetupProof", "guided setup proof", "The first local KB path must persist setup draft, validate folders, block missing folders, preview scan, preview execution, and avoid K12-field leakage for general docs."),
  gate("buildRecoveryProof", "first-run build recovery proof", "The first build must prove job creation, visible progress, pause/resume, restart recovery, completion, and redacted diagnostics."),
  gate("firstQuestionProof", "first question proof", "The first query must use Query Runtime with cited evidence or explicit no-answer/refusal, evidence search, and no weak success state."),
  gate("maintenanceNextActionProof", "maintenance next-action proof", "First-run feedback must be stored, create a review item, expose safe rerun scope, and stay on scoped APIs."),
  gate("firstRunBrowserWorkflow", "first-run browser workflow proof", "Desktop and narrow Web Console first-run surfaces must expose empty state, create/select, readiness, and diagnostics without browser-storage truth."),
  gate("firstRunPackageAssetReview", "First-Run Usability package asset review", "First-Run Usability release assets must exclude private state, SQLite files, secrets, generated artifacts, direct internal-state reads, and private package files.")
];

export const usableProductReleaseEvidenceChecklist = [
  gate("usableLaunchReliabilityProof", "usable launch reliability proof", "The real local service must prove port fallback, no implicit KB, localhost-only access, PATH-safe launchers, restart selection persistence, SQLite authority, no legacy JSON state, and redacted diagnostics."),
  gate("usableDocumentIntakeProof", "usable document intake proof", "Local document intake must prove parser/OCR boundaries, rejected risky inputs, catalog consistency, targeted rerun source sets, and zero external calls before execution."),
  gate("usableWebConsoleWorkflowProof", "usable Web Console workflow proof", "The Web Console must expose create/select/setup/build/execution/ask/feedback/documents/versions/diagnostics/package surfaces without duplicate primary controls or direct internal-state reads."),
  gate("usableDurableDataPackageProof", "usable durable data/package proof", "Workspace/catalog backup, WAL exclusion, stale JSON cleanup, package export/import preview, version manifest, rollback preview, confirmed rollback, package privacy, and zero external calls must pass."),
  gate("usableBrowserWorkflow", "usable browser workflow proof", "Desktop and narrow browser evidence must cover the public usable path, Query Runtime, feedback, maintenance, diagnostics, and no horizontal overflow."),
  gate("usablePrivacyProof", "usable privacy proof", "Usable-product diagnostics, integrations, and package evidence must avoid credential leaks, private content, local paths, and external calls before explicit execution."),
  gate("usableProductPackageAssetReview", "Usable Product package asset review", "Usable Product release assets must exclude private state, SQLite/WAL files, secrets, generated artifacts, direct internal reads, private package files, and stale JSON authority.")
];

export function evaluateReleaseGate(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const gates = releaseGateChecklist.map((item) => {
    const value = evidence[item.key];
    const status = gateStatus(value, item);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const missing = gates.filter((item) => item.status !== "pass").map((item) => item.key);
  return {
    ok: missing.length === 0,
    kind: "knowmesh.releaseGate",
    releaseAllowed: missing.length === 0,
    npmPublication: "separate-decision",
    missing,
    gates
  };
}

export function evaluateReleaseGateEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateReleaseGate(evidence);
}

export function evaluatePublicBetaReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const base = evaluateReleaseGate(evidence);
  const betaGates = publicBetaEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = betaGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const betaMissing = betaGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...base.missing, ...betaMissing];
  return {
    ...base,
    ok: missing.length === 0,
    releaseStage: "public-beta",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...base.gates, ...betaGates]
  };
}

export function evaluateSearchableReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const beta = evaluatePublicBetaReleaseEvidence(evidence);
  const searchableGates = searchableReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = searchableGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const searchableMissing = searchableGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...beta.missing, ...searchableMissing];
  return {
    ...beta,
    ok: missing.length === 0,
    releaseStage: "0.2.0-searchable",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...beta.gates, ...searchableGates]
  };
}

export function evaluateSearchableReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateSearchableReleaseEvidence(evidence);
}

export function evaluateQueryRuntimeReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const searchable = evaluateSearchableReleaseEvidence(evidence);
  const queryRuntimeGates = queryRuntimeReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = queryRuntimeGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const queryRuntimeMissing = queryRuntimeGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...searchable.missing, ...queryRuntimeMissing];
  return {
    ...searchable,
    ok: missing.length === 0,
    releaseStage: "0.3.0-query-runtime",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...searchable.gates, ...queryRuntimeGates]
  };
}

export function evaluateQueryRuntimeReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateQueryRuntimeReleaseEvidence(evidence);
}

export function evaluateExpertSdkReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const queryRuntime = evaluateQueryRuntimeReleaseEvidence(evidence);
  const expertSdkGates = expertSdkReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = expertSdkGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const expertSdkMissing = expertSdkGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...queryRuntime.missing, ...expertSdkMissing];
  return {
    ...queryRuntime,
    ok: missing.length === 0,
    releaseStage: "0.4.0-expert-sdk",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...queryRuntime.gates, ...expertSdkGates]
  };
}

export function evaluateExpertSdkReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateExpertSdkReleaseEvidence(evidence);
}

export function evaluateProviderAdaptersReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const expertSdk = evaluateExpertSdkReleaseEvidence(evidence);
  const providerGates = providerAdaptersReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = providerAdaptersGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const providerMissing = providerGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...expertSdk.missing, ...providerMissing];
  return {
    ...expertSdk,
    ok: missing.length === 0,
    releaseStage: "0.5.0-provider-adapters",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...expertSdk.gates, ...providerGates]
  };
}

export function evaluateProviderAdaptersReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateProviderAdaptersReleaseEvidence(evidence);
}

export function evaluateIntegrationSdkReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const providerAdapters = evaluateProviderAdaptersReleaseEvidence(evidence);
  const integrationGates = integrationSdkReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = integrationSdkGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const integrationMissing = integrationGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...providerAdapters.missing, ...integrationMissing];
  return {
    ...providerAdapters,
    ok: missing.length === 0,
    releaseStage: "0.6.0-integration-sdk",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...providerAdapters.gates, ...integrationGates]
  };
}

export function evaluateIntegrationSdkReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateIntegrationSdkReleaseEvidence(evidence);
}

export function evaluateConsumerIntegrationReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const integrationSdk = evaluateIntegrationSdkReleaseEvidence(evidence);
  const consumerGates = consumerIntegrationReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = consumerIntegrationGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const consumerMissing = consumerGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...integrationSdk.missing, ...consumerMissing];
  return {
    ...integrationSdk,
    ok: missing.length === 0,
    releaseStage: "0.7.0-consumer-integration",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...integrationSdk.gates, ...consumerGates]
  };
}

export function evaluateConsumerIntegrationReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateConsumerIntegrationReleaseEvidence(evidence);
}

export function evaluateOperatorWorkflowReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const consumerIntegration = evaluateConsumerIntegrationReleaseEvidence(evidence);
  const operatorGates = operatorWorkflowReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = operatorWorkflowGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const operatorMissing = operatorGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...consumerIntegration.missing, ...operatorMissing];
  return {
    ...consumerIntegration,
    ok: missing.length === 0,
    releaseStage: "0.8.0-operator-workflow",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...consumerIntegration.gates, ...operatorGates]
  };
}

export function evaluateOperatorWorkflowReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateOperatorWorkflowReleaseEvidence(evidence);
}

export function evaluateFirstRunUsabilityReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const operatorWorkflow = evaluateOperatorWorkflowReleaseEvidence(evidence);
  const firstRunGates = firstRunUsabilityReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = firstRunUsabilityGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const firstRunMissing = firstRunGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...operatorWorkflow.missing, ...firstRunMissing];
  return {
    ...operatorWorkflow,
    ok: missing.length === 0,
    releaseStage: "0.9.0-first-run-usability",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...operatorWorkflow.gates, ...firstRunGates]
  };
}

export function evaluateFirstRunUsabilityReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateFirstRunUsabilityReleaseEvidence(evidence);
}

export function evaluateUsableProductReleaseEvidence(evidence = {}) {
  evidence = releaseEvidencePayload(evidence);
  const firstRunUsability = evaluateFirstRunUsabilityReleaseEvidence(evidence);
  const usableProductGates = usableProductReleaseEvidenceChecklist.map((item) => {
    const value = evidence[item.key];
    const status = usableProductGateStatus(item.key, value);
    return {
      ...item,
      status,
      evidence: evidenceSummary(value)
    };
  });
  const usableMissing = usableProductGates.filter((item) => item.status !== "pass").map((item) => item.key);
  const missing = [...firstRunUsability.missing, ...usableMissing];
  return {
    ...firstRunUsability,
    ok: missing.length === 0,
    releaseStage: "1.0.0-usable-product",
    releaseAllowed: missing.length === 0,
    missing,
    gates: [...firstRunUsability.gates, ...usableProductGates]
  };
}

export function evaluateUsableProductReleaseEvidenceFile(evidencePath) {
  const resolvedPath = path.resolve(String(evidencePath || ""));
  const evidence = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  return evaluateUsableProductReleaseEvidence(evidence);
}

function gate(key, command, description) {
  return { key, command, description };
}

function gateStatus(value, gateItem) {
  if (value === "pass" || value === true) {
    return gateItem.key === "artifactSmoke" ? "missing-checksum" : "pass";
  }
  if (value && typeof value === "object") {
    if (value.status === "pass" && gateItem.key === "artifactSmoke") return value.sha256 ? "pass" : "missing-checksum";
    if (value.status === "pass") return "pass";
  }
  return "missing";
}

function evidenceSummary(value) {
  if (value === "pass" || value === true) return "pass";
  if (value && typeof value === "object") {
    return value.sha256 ? `sha256:${value.sha256}` : String(value.status || "provided");
  }
  return "";
}

function betaGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "browserSampleFlow") {
    return value.desktop === true && value.narrow === true && value.resetVerified === true ? "pass" : "missing";
  }
  if (key === "betaReleaseNotes") {
    return value.supportedPaths === true && value.limitations === true && value.knownGaps === true && value.npmPublication === "separate-decision" ? "pass" : "missing";
  }
  if (key === "releaseAssetReview") {
    return value.noPrivateState === true && value.noSqlite === true && value.noSecrets === true ? "pass" : "missing";
  }
  return "missing";
}

function searchableGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "searchableReadiness") {
    return allTrue(value, ["catalogSearch", "queryEvidence", "citationReady", "scopedApi"]) ? "pass" : "missing";
  }
  if (key === "incrementalUpdateProof") {
    return allTrue(value, ["catalogDelta", "targetedRerun", "versionRollback"]) ? "pass" : "missing";
  }
  if (key === "vectorFallbackProof") {
    return allTrue(value, ["sidecarContract", "invalidVectorBlocked", "catalogFallback"]) ? "pass" : "missing";
  }
  if (key === "browserSearchWorkflow") {
    return allTrue(value, ["desktop", "narrow", "maintenanceEvidence", "evidenceLink", "resetVerified"]) ? "pass" : "missing";
  }
  if (key === "staleJsonAuthorityAudit") {
    return Number(value.forbiddenMutableStatePaths || 0) === 0 ? "pass" : "missing";
  }
  if (key === "packageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts"]) ? "pass" : "missing";
  }
  return "missing";
}

function queryRuntimeGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "routeContractReadiness") {
    return allTrue(value, ["routeContract", "refusalTaxonomy", "evidencePolicy"]) ? "pass" : "missing";
  }
  if (key === "citationGroundedAnswerProof") {
    return allTrue(value, ["citedAnswer", "evidencePack", "qualityGates"]) ? "pass" : "missing";
  }
  if (key === "refusalNoAnswerProof") {
    return allTrue(value, ["outOfScope", "insufficientEvidence", "noWeakAnswer"]) ? "pass" : "missing";
  }
  if (key === "feedbackMaintenanceProof") {
    return allTrue(value, ["negativeFeedbackIssue", "rerunScope", "positiveSignalOnly"]) ? "pass" : "missing";
  }
  if (key === "integrationContractProof") {
    return allTrue(value, ["openApi", "nodeExample", "httpExample", "driftTest"]) ? "pass" : "missing";
  }
  if (key === "browserAskWorkflow") {
    return allTrue(value, ["answered", "refused", "feedbackMaintenance", "desktop", "narrow"]) ? "pass" : "missing";
  }
  return "missing";
}

function expertSdkGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "expertManifestReadiness") {
    return allTrue(value, ["manifestContract", "validation", "lifecycleCertification"]) ? "pass" : "missing";
  }
  if (key === "expertRuntimeBoundaryProof") {
    return allTrue(value, ["publicHooks", "directStorageBlocked", "queryRouteHooks"]) ? "pass" : "missing";
  }
  if (key === "nonK12ExampleProof") {
    return allTrue(value, ["operationsHandbook", "publicFixture", "queryEvidence"]) ? "pass" : "missing";
  }
  if (key === "expertEvaluationGateProof") {
    return allTrue(value, ["portableCases", "dashboardAggregation", "maintenanceMapping"]) ? "pass" : "missing";
  }
  if (key === "expertDocsContributorWorkflowProof") {
    return allTrue(value, ["authoringDocs", "exampleDocs", "requiredTests", "communityProposalPath"]) ? "pass" : "missing";
  }
  if (key === "expertPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noPrivateFixtures"]) ? "pass" : "missing";
  }
  return "missing";
}

function providerAdaptersGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "providerManifestReadiness") {
    return allTrue(value, ["manifestContract", "validation", "capabilityInventory"]) ? "pass" : "missing";
  }
  if (key === "parserOcrBoundaryProof") {
    return allTrue(value, ["parserPreflight", "ocrPreflight", "unsafeInputsReviewed"]) ? "pass" : "missing";
  }
  if (key === "embeddingVectorBoundaryProof") {
    return allTrue(value, ["embeddingBatchContract", "vectorOutputValidation", "catalogFallback"]) ? "pass" : "missing";
  }
  if (key === "providerDiagnosticsBrowserProof") {
    return allTrue(value, ["scopedApi", "desktop", "narrow", "sqliteAuthority", "noExternalCallsBeforeExecution"]) ? "pass" : "missing";
  }
  if (key === "noCloudPublicPathProof") {
    return allTrue(value, ["publicSample", "credentialFree", "externalCallsBlocked", "localFallback"]) ? "pass" : "missing";
  }
  if (key === "providerPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts", "noDirectProviderBypass"]) ? "pass" : "missing";
  }
  return "missing";
}

function integrationSdkGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "endpointManifestReadiness") {
    return allTrue(value, ["endpointManifest", "openApi", "scopedDiscovery", "diagnosticsDiscovery"]) ? "pass" : "missing";
  }
  if (key === "sdkClientProof") {
    return allTrue(value, ["packageExports", "scopedHelpers", "injectedFetch", "errorRedaction"]) ? "pass" : "missing";
  }
  if (key === "examplesDriftProof") {
    return allTrue(value, ["nodeExample", "httpExample", "expectedResponses", "driftTest"]) ? "pass" : "missing";
  }
  if (key === "integrationSafetyProof") {
    return allTrue(value, ["retrySemantics", "diagnosticsRedaction", "localhostOnly", "noInternalReads"]) ? "pass" : "missing";
  }
  if (key === "providerAwareNoCloudProof") {
    return allTrue(value, ["providerDiagnostics", "integrationDiagnostics", "noExternalCalls", "publicSample"]) ? "pass" : "missing";
  }
  if (key === "integrationPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts", "noDirectInternalReads"]) ? "pass" : "missing";
  }
  return "missing";
}

function consumerIntegrationGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "installedSdkConsumerProof") {
    return allTrue(value, ["packageExports", "subpathExport", "injectedFetch", "noInternalImports", "noPrivatePackageFiles"]) ? "pass" : "missing";
  }
  if (key === "livePublicSampleSdkProof") {
    return allTrue(value, ["installedPackage", "realHttp", "answered", "refused", "search", "feedback", "providerDiagnostics", "packagePreview", "versionManifest", "resetVerified"]) ? "pass" : "missing";
  }
  if (key === "integrationRecipeProof") {
    return allTrue(value, ["serverSideNode", "electronLocalDesktop", "browserBackend", "ciSmoke", "localhostCors", "feedbackLinks"]) ? "pass" : "missing";
  }
  if (key === "privacyBoundaryAuditProof") {
    return Number(value.findings || 0) === 0
      && allTrue(value, ["noSqliteReads", "noArtifactReads", "noCredentialLogging", "noLocalPaths", "noBroadCors"])
      ? "pass"
      : "missing";
  }
  if (key === "providerAwareNoCloudConsumerProof") {
    return allTrue(value, ["publicSample", "credentialFree", "externalCallsBlocked", "localFallback"]) ? "pass" : "missing";
  }
  if (key === "consumerPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts", "noDirectInternalReads", "noPrivatePackageFiles"]) ? "pass" : "missing";
  }
  return "missing";
}

function operatorWorkflowGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "sourceIntakeProof") {
    return allTrue(value, ["folderPrecheck", "scanPreview", "sourceManifest", "excludeRestore", "changedMissingRestored", "executionPlanPreview", "k12GateIsolation"]) ? "pass" : "missing";
  }
  if (key === "executionRecoveryProof") {
    return allTrue(value, ["jobCreation", "checkpointPersistence", "progressPolling", "pauseResumeStop", "restartRecovery", "taskSummary", "diagnosticRedaction"]) ? "pass" : "missing";
  }
  if (key === "maintenanceTargetedRerunProof") {
    return allTrue(value, ["evidenceSearch", "queryFeedbackReview", "qualityIssueReview", "safeRerunScope", "targetedRerunJob", "reviewResolution"]) ? "pass" : "missing";
  }
  if (key === "versionRollbackProof") {
    return allTrue(value, ["versionManifest", "packagePreview", "versionList", "diff", "rollbackPreview", "rollbackConfirmation", "crossKbIsolation"]) ? "pass" : "missing";
  }
  if (key === "operatorBrowserWorkflow") {
    return allTrue(value, ["desktop", "narrow", "sourceIntake", "execution", "maintenance", "versions", "feedback", "diagnostics"]) ? "pass" : "missing";
  }
  if (key === "operatorPrivacyAuditProof") {
    return allTrue(value, ["diagnosticRedaction", "noCredentialLeak", "noPrivateContentLeak", "localhostOnly", "noExternalCallsBeforeExecution", "noInternalReads"]) ? "pass" : "missing";
  }
  if (key === "operatorPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts", "noDirectInternalReads", "noPrivatePackageFiles"]) ? "pass" : "missing";
  }
  return "missing";
}

function firstRunUsabilityGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "firstRunLaunchProof") {
    return allTrue(value, ["emptyWorkspace", "createAction", "sampleAction", "runtimeDiagnostics", "providerReadiness", "localhostOnly"]) ? "pass" : "missing";
  }
  if (key === "guidedSetupProof") {
    return allTrue(value, ["setupDraftPersistence", "folderPrecheck", "missingFolderBlocked", "scanPreview", "executionPlanPreview", "generalDocsNoK12Leak"]) ? "pass" : "missing";
  }
  if (key === "buildRecoveryProof") {
    return allTrue(value, ["jobCreation", "visibleProgress", "pauseResume", "restartRecovery", "completion", "diagnosticRedaction"]) ? "pass" : "missing";
  }
  if (key === "firstQuestionProof") {
    return allTrue(value, ["queryRuntime", "citationOrExplicitNoAnswer", "evidenceSearch", "noWeakSuccess"]) ? "pass" : "missing";
  }
  if (key === "maintenanceNextActionProof") {
    return allTrue(value, ["feedbackStored", "reviewItemCreated", "safeRerunScope", "scopedApi"]) ? "pass" : "missing";
  }
  if (key === "firstRunBrowserWorkflow") {
    return allTrue(value, ["desktop", "narrow", "emptyState", "createSelect", "readiness", "diagnostics"]) ? "pass" : "missing";
  }
  if (key === "firstRunPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts", "noDirectInternalReads", "noPrivatePackageFiles"]) ? "pass" : "missing";
  }
  return "missing";
}

function usableProductGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  if (key === "usableLaunchReliabilityProof") {
    return allTrue(value, ["portFallback", "noImplicitKnowledgeBase", "localhostOnly", "pathMutationGuard", "restartSelectionPersistence", "workspaceSqliteAuthority", "noLegacyJsonState", "diagnosticRedaction"]) ? "pass" : "missing";
  }
  if (key === "usableDocumentIntakeProof") {
    return allTrue(value, ["parserBoundary", "ocrBoundary", "rejectedRiskyInputs", "catalogConsistency", "targetedRerunSourceSet", "externalCallsBeforeExecutionZero"]) ? "pass" : "missing";
  }
  if (key === "usableWebConsoleWorkflowProof") {
    return allTrue(value, ["createSelectSetup", "buildExecutionLoop", "askFeedbackReview", "documentsVersionsDiagnostics", "packagePreview", "noDuplicatePrimaryControls", "noDirectInternalStateReads"]) ? "pass" : "missing";
  }
  if (key === "usableDurableDataPackageProof") {
    return allTrue(value, ["workspaceCatalogBackup", "walFilesExcluded", "staleJsonCleanup", "packageExportPreview", "importPreviewNoWrites", "versionManifest", "rollbackPreview", "rollbackConfirmation", "packageBoundaryPrivacy", "externalCallsBeforeExecutionZero"]) ? "pass" : "missing";
  }
  if (key === "usableBrowserWorkflow") {
    return allTrue(value, ["desktop", "narrow", "publicSample", "queryRuntime", "feedback", "maintenance", "diagnostics", "noHorizontalOverflow"]) ? "pass" : "missing";
  }
  if (key === "usablePrivacyProof") {
    return allTrue(value, ["diagnosticRedaction", "noCredentialLeak", "noPrivateContentLeak", "noLocalPaths", "noExternalCallsBeforeExecution", "integrationPrivacyAudit"]) ? "pass" : "missing";
  }
  if (key === "usableProductPackageAssetReview") {
    return allTrue(value, ["noPrivateState", "noSqlite", "noSecrets", "noGeneratedArtifacts", "noDirectInternalReads", "noPrivatePackageFiles", "noStaleJsonAuthority", "noWalFiles"]) ? "pass" : "missing";
  }
  return "missing";
}

function allTrue(value, fields) {
  return fields.every((field) => value[field] === true);
}

function releaseEvidencePayload(value = {}) {
  if (value?.releaseEvidence?.evidence) return value.releaseEvidence.evidence;
  if (value?.kind === "knowmesh.releaseEvidence" && value.evidence) return value.evidence;
  return value;
}

function cliEvidencePath(argv = process.argv.slice(2)) {
  const evidenceFlagIndex = argv.findIndex((item) => item === "--evidence" || item === "-e");
  if (evidenceFlagIndex >= 0) return argv[evidenceFlagIndex + 1] || "";
  const prefixed = argv.find((item) => item.startsWith("--evidence="));
  return prefixed ? prefixed.slice("--evidence=".length) : "";
}

function cliStage(argv = process.argv.slice(2)) {
  if (argv.includes("--usable-product")) return "usable-product";
  if (argv.includes("--first-run-usability")) return "first-run-usability";
  if (argv.includes("--operator-workflow")) return "operator-workflow";
  if (argv.includes("--consumer-integration")) return "consumer-integration";
  if (argv.includes("--integration-sdk")) return "integration-sdk";
  if (argv.includes("--provider-adapters")) return "provider-adapters";
  if (argv.includes("--expert-sdk")) return "expert-sdk";
  if (argv.includes("--query-runtime")) return "query-runtime";
  if (argv.includes("--searchable")) return "searchable";
  if (argv.includes("--public-beta")) return "public-beta";
  const stageFlagIndex = argv.findIndex((item) => item === "--stage");
  if (stageFlagIndex >= 0) return argv[stageFlagIndex + 1] || "base";
  const prefixed = argv.find((item) => item.startsWith("--stage="));
  return prefixed ? prefixed.slice("--stage=".length) : "base";
}

function evaluateCliEvidence(stage, evidencePath) {
  const evidence = evidencePath
    ? JSON.parse(fs.readFileSync(path.resolve(String(evidencePath)), "utf8"))
    : {};
  if (stage === "usable-product" || stage === "1.0.0-usable-product") return evaluateUsableProductReleaseEvidence(evidence);
  if (stage === "first-run-usability" || stage === "0.9.0-first-run-usability") return evaluateFirstRunUsabilityReleaseEvidence(evidence);
  if (stage === "operator-workflow" || stage === "0.8.0-operator-workflow") return evaluateOperatorWorkflowReleaseEvidence(evidence);
  if (stage === "consumer-integration" || stage === "0.7.0-consumer-integration") return evaluateConsumerIntegrationReleaseEvidence(evidence);
  if (stage === "integration-sdk" || stage === "0.6.0-integration-sdk") return evaluateIntegrationSdkReleaseEvidence(evidence);
  if (stage === "provider-adapters" || stage === "0.5.0-provider-adapters") return evaluateProviderAdaptersReleaseEvidence(evidence);
  if (stage === "expert-sdk" || stage === "0.4.0-expert-sdk") return evaluateExpertSdkReleaseEvidence(evidence);
  if (stage === "query-runtime" || stage === "0.3.0-query-runtime") return evaluateQueryRuntimeReleaseEvidence(evidence);
  if (stage === "searchable" || stage === "0.2.0-searchable") return evaluateSearchableReleaseEvidence(evidence);
  if (stage === "public-beta") return evaluatePublicBetaReleaseEvidence(evidence);
  return evaluateReleaseGate(evidence);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidencePath = cliEvidencePath();
  const result = evaluateCliEvidence(cliStage(), evidencePath);
  console.log(JSON.stringify(result, null, 2));
  if (!result.releaseAllowed) process.exitCode = 1;
}
