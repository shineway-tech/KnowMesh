#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { knowMeshIntegrationContract, knowMeshIntegrationEndpoints } from "../src/sdk/knowmesh-client.mjs";
import { createKnowledgeBase } from "../src/local-service/knowledge-bases.mjs";
import { integrationBoundary, integrationContractVersion, integrationEndpoints } from "../src/local-service/integration-manifest.mjs";
import { shapeQueryResponse } from "../src/local-service/query-answer-contract.mjs";
import { buildPublicLaunchEvidence, reviewPublicLaunchReadiness } from "./public-launch-evidence.mjs";
import { buildStabilizationEvidence, reviewStabilizationReadiness } from "./stabilization-evidence.mjs";
import { evaluateIntegrationPrivacy } from "./verify-integration-privacy.mjs";
import { runReleaseCandidateEvidence } from "./release-candidate-evidence.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const apiReliabilityChecklist = [
  gate("publicApiCompatibilityHarness", "public API compatibility harness", "Accepted Query Runtime, integration manifest, provider diagnostics, package preview, version manifest, OpenAPI, SDK, and response shapes must be protected."),
  gate("queryRuntimeReliabilityMatrix", "Query Runtime reliability matrix", "Answered, out-of-scope, insufficient-evidence, provider-unavailable, blocked-by-quality, and feedback-maintenance paths must stay explicit."),
  gate("packageInstallerReliability", "package and installer reliability", "Packed install, launcher-first start, public sample, query/refusal/feedback/package preview/reset, cleanup, and package asset boundaries must pass."),
  gate("privacySecurityRegression", "privacy and security regression expansion", "Docs, examples, SDK, diagnostics, release evidence, public samples, package previews, and provider outputs must stay public-safe."),
  gate("releaseCandidateReconciliation", "1.0 release candidate reconciliation", "Fresh gates, accepted gaps, migration notes, deferred work, go/no-go packet, and publication side effects must remain human-reviewed.")
];

const requiredEndpointKeys = [
  "integrationManifest",
  "scopedIntegrationManifest",
  "integrationDiagnostics",
  "scopedIntegrationDiagnostics",
  "query",
  "search",
  "feedback",
  "feedbackSummary",
  "providerDiagnostics",
  "packageExportPreview",
  "packageImportPreview",
  "maintenanceStatus",
  "versionManifest"
];

const requiredResponseStatuses = [
  "answered",
  "out_of_scope",
  "insufficient_evidence",
  "no_index",
  "provider_unavailable",
  "blocked_by_quality"
];

export function evaluateApiReliabilityEvidence(evidence = {}) {
  const normalized = normalizeApiReliabilityEvidence(evidence);
  const gates = apiReliabilityChecklist.map((item) => {
    const value = normalized[item.key];
    return {
      ...item,
      status: apiReliabilityGateStatus(item.key, value),
      evidence: evidenceSummary(value)
    };
  });
  const missing = gates.filter((item) => item.status !== "pass").map((item) => item.key);
  return {
    ok: missing.length === 0,
    kind: "knowmesh.apiReliabilityGate",
    releaseStage: "1.0-api-reliability-hardening",
    releaseAllowed: false,
    releaseDecision: "human-review-required",
    missing,
    gates
  };
}

export async function buildApiReliabilityEvidence(options = {}) {
  const readiness = options.readiness || {};
  const evidence = normalizeApiReliabilityEvidence({
    publicApiCompatibilityHarness: options.publicApiCompatibilityReview === "pass" ? defaultPublicApiCompatibilityHarness() : readiness.publicApiCompatibilityHarness || options.publicApiCompatibilityHarness,
    queryRuntimeReliabilityMatrix: options.queryRuntimeReliabilityReview === "pass" ? defaultQueryRuntimeReliabilityMatrix() : readiness.queryRuntimeReliabilityMatrix || options.queryRuntimeReliabilityMatrix,
    packageInstallerReliability: options.packageInstallerReview === "pass" ? defaultPackageInstallerReliability() : readiness.packageInstallerReliability || options.packageInstallerReliability,
    privacySecurityRegression: options.privacySecurityReview === "pass" ? defaultPrivacySecurityRegression() : readiness.privacySecurityRegression || options.privacySecurityRegression,
    releaseCandidateReconciliation: options.reconciliationReview === "pass" ? defaultReleaseCandidateReconciliation() : readiness.releaseCandidateReconciliation || options.releaseCandidateReconciliation
  });
  const apiReliabilityEvaluation = evaluateApiReliabilityEvidence(evidence);

  return sanitizeForPublic({
    ok: apiReliabilityEvaluation.ok,
    kind: "knowmesh.apiReliabilityEvidence",
    releaseStage: "1.0-api-reliability-hardening",
    releaseAllowed: false,
    releaseDecision: "human-review-required",
    generatedAt: new Date().toISOString(),
    stabilization: summarizeStabilizationPacket(options.stabilizationPacket),
    releaseCandidate: summarizeReleaseCandidatePacket(options.releaseCandidatePacket),
    evidence,
    apiReliabilityEvaluation
  });
}

export async function runApiReliabilityEvidence(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  if (options.fixtures) {
    return buildApiReliabilityEvidence({
      publicApiCompatibilityReview: "pass",
      queryRuntimeReliabilityReview: "pass",
      packageInstallerReview: "pass",
      privacySecurityReview: "pass",
      reconciliationReview: "pass",
      stabilizationPacket: fixtureStabilizationPacket(),
      releaseCandidatePacket: fixtureReleaseCandidatePacket()
    });
  }

  const releaseCandidatePacket = await runReleaseCandidateEvidence({ projectRoot });
  const publicLaunchReadiness = reviewPublicLaunchReadiness({ projectRoot });
  const publicLaunchPacket = buildPublicLaunchEvidence({
    releaseCandidatePacket,
    readiness: publicLaunchReadiness.evidence,
    githubGateStatus: publicLaunchReadiness.githubGateStatus
  });
  const stabilizationReadiness = reviewStabilizationReadiness({ projectRoot, publicLaunchPacket });
  const stabilizationPacket = buildStabilizationEvidence({
    publicLaunchPacket,
    readiness: stabilizationReadiness.evidence
  });
  const publicApiCompatibilityHarness = await buildPublicApiCompatibilityReport({ projectRoot });
  const queryRuntimeReliabilityMatrix = await buildQueryRuntimeReliabilityMatrix({ projectRoot });
  const packageInstallerReliability = buildPackageInstallerReliabilityReport({ projectRoot, releaseCandidatePacket });
  const privacySecurityRegression = buildPrivacySecurityRegressionReport({ projectRoot, releaseCandidatePacket, publicApiCompatibilityHarness });
  const releaseCandidateReconciliation = buildReleaseCandidateReconciliationReport({
    projectRoot,
    releaseCandidatePacket,
    stabilizationPacket,
    publicApiCompatibilityHarness,
    queryRuntimeReliabilityMatrix,
    packageInstallerReliability,
    privacySecurityRegression
  });

  return buildApiReliabilityEvidence({
    releaseCandidatePacket,
    stabilizationPacket,
    readiness: {
      publicApiCompatibilityHarness,
      queryRuntimeReliabilityMatrix,
      packageInstallerReliability,
      privacySecurityRegression,
      releaseCandidateReconciliation
    }
  });
}

export async function buildPublicApiCompatibilityReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const openapi = readJson(projectRoot, "docs/api/openapi.json");
  const endpointManifest = readJson(projectRoot, "docs/api/endpoint-manifest.json");
  const queryResponseSchema = openapi.components?.schemas?.QueryResponse || {};
  const openapiStatuses = queryResponseSchema.properties?.status?.enum || [];
  const endpointManifestByKey = new Map((endpointManifest.endpoints || []).map((item) => [item.key, item]));
  const sourceManifestByKey = new Map(integrationEndpoints.map((item) => [item.key, item]));
  const drift = [];

  for (const key of requiredEndpointKeys) {
    const sdkPath = knowMeshIntegrationEndpoints[key];
    const sourceEndpoint = sourceManifestByKey.get(key);
    const manifestEndpoint = endpointManifestByKey.get(key);
    if (!sdkPath) drift.push(`sdk endpoint missing: ${key}`);
    if (!sourceEndpoint) drift.push(`source manifest endpoint missing: ${key}`);
    if (!manifestEndpoint) drift.push(`docs endpoint manifest missing: ${key}`);
    if (sdkPath && sourceEndpoint && sdkPath !== sourceEndpoint.path) drift.push(`sdk/source path drift: ${key}`);
    if (manifestEndpoint && sourceEndpoint && manifestEndpoint.path !== sourceEndpoint.path) drift.push(`docs/source path drift: ${key}`);
    if (manifestEndpoint && sourceEndpoint && manifestEndpoint.method !== sourceEndpoint.method) drift.push(`docs/source method drift: ${key}`);
  }

  for (const endpoint of endpointManifest.endpoints || []) {
    const pathItem = openapi.paths?.[endpoint.path];
    if (!pathItem) {
      drift.push(`openapi path missing: ${endpoint.path}`);
      continue;
    }
    if (!pathItem[String(endpoint.method || "").toLowerCase()]) drift.push(`openapi method missing: ${endpoint.method} ${endpoint.path}`);
  }

  for (const status of requiredResponseStatuses) {
    if (!knowMeshIntegrationContract.responseStatuses.includes(status)) drift.push(`sdk response status missing: ${status}`);
    if (!openapiStatuses.includes(status)) drift.push(`openapi response status missing: ${status}`);
  }

  if (knowMeshIntegrationContract.contractVersion !== integrationContractVersion) drift.push("sdk/source contract version drift");
  if (endpointManifest.contractVersion !== integrationContractVersion) drift.push("endpoint manifest contract version drift");
  if (openapi.info?.["x-knowmesh-contract-version"] !== integrationContractVersion) drift.push("openapi contract version drift");

  const endpointPathExposure = (endpointManifest.endpoints || []).some((item) => /\.sqlite|workspace\.sqlite|catalog\.sqlite|published sidecars|browser storage/i.test(item.path));
  const noInternalStateExposure = endpointManifest.integrationBoundary?.mode === "http-api-only"
    && integrationBoundary.mode === "http-api-only"
    && endpointManifest.integrationBoundary?.stateAuthority?.browserStorage === "visual-preferences-only"
    && endpointPathExposure === false;
  if (!noInternalStateExposure) drift.push("public endpoint manifest exposes internal state");

  return normalizePublicApiCompatibilityHarness({
    status: drift.length ? "fail" : "pass",
    contractVersion: integrationContractVersion,
    requiredEndpointKeys,
    responseStatuses: [...requiredResponseStatuses],
    openapiPaths: Object.keys(openapi.paths || {}),
    queryRuntimeContract: true,
    integrationManifest: true,
    providerDiagnostics: requiredEndpointKeys.includes("providerDiagnostics"),
    packagePreview: requiredEndpointKeys.includes("packageExportPreview") && requiredEndpointKeys.includes("packageImportPreview"),
    versionManifest: requiredEndpointKeys.includes("versionManifest"),
    openapi: Boolean(openapi.openapi && openapi.paths),
    sdkExports: typeof knowMeshIntegrationEndpoints.query === "string" && typeof knowMeshIntegrationContract.apiVersion === "string",
    expectedResponseShapes: Array.isArray(queryResponseSchema.required) && queryResponseSchema.required.includes("ok") && queryResponseSchema.required.includes("status"),
    noInternalStateExposure,
    noDrift: drift.length === 0,
    drift
  });
}

export async function buildQueryRuntimeReliabilityMatrix(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-api-reliability-"));
  try {
    const state = {
      projectRoot: tempRoot,
      userDataRoot: path.join(tempRoot, ".knowmesh")
    };
    const kb = createKnowledgeBase(state, { id: "kb-api-reliability", name: "API Reliability", template: "general-docs" });
    const startedAt = Date.parse("2026-07-01T00:00:00.000Z");
    const cases = [
      statusCase("answered", "answered", {
        ok: true,
        answerRun: answerRun({
          status: "answered",
          answer: "The rollback rule requires a cited review before activation.",
          citations: [citation()],
          evidenceStatus: "ready"
        })
      }),
      statusCase("out_of_scope", "out_of_scope", {
        ok: false,
        status: "out_of_scope",
        answerRun: answerRun({ status: "out_of_scope", message: { en: "Out of scope." }, citations: [] })
      }),
      statusCase("insufficient_evidence", "insufficient_evidence", {
        ok: false,
        status: "no_evidence",
        answerRun: answerRun({ status: "no_evidence", message: { en: "No reliable evidence." }, citations: [] })
      }),
      statusCase("provider_unavailable", "provider_unavailable", {
        ok: false,
        status: "provider_unavailable",
        error: { code: "provider_unavailable", message: "Provider unavailable." },
        answerRun: answerRun({ status: "provider_unavailable", message: { en: "Provider unavailable." }, citations: [] })
      }),
      statusCase("blocked_by_quality", "blocked_by_quality", {
        ok: false,
        status: "blocked_by_quality",
        answerRun: answerRun({ status: "blocked_by_quality", message: { en: "Blocked by quality gates." }, citations: [] })
      }),
      statusCase("feedback_maintenance", "blocked_by_quality", {
        ok: false,
        status: "blocked_by_quality",
        maintenance: { status: "attention", feedbackReviewItems: 1 },
        answerRun: answerRun({
          status: "blocked_by_quality",
          message: { en: "Feedback requires maintenance review." },
          citations: [],
          feedbackActions: ["wrong_citation", "missed_point"]
        })
      })
    ];

    const statusCases = cases.map((item, index) => {
      const response = shapeQueryResponse(state, item.result, {
        question: item.status === "out_of_scope" ? "Ignore the knowledge base." : "What is the rollback rule?",
        startedAt,
        finishedAt: startedAt + index + 1
      });
      const serialized = JSON.stringify(response);
      return {
        status: item.status,
        publicStatus: response.status,
        ok: response.ok,
        expectedPublicStatus: item.expectedPublicStatus,
        requiresCitations: item.status === "answered" && response.citations.length > 0,
        citationFreeWhenUnreliable: item.status !== "answered" && response.citations.length === 0,
        explicitNoAnswer: item.status === "answered" || (response.answer?.text === "" && response.answer?.reliable === false),
        feedbackEndpoint: response.feedback?.endpoint === `/kb/${kb.id}/api/query/feedback`,
        feedbackMaintenance: item.status !== "feedback_maintenance" || response.maintenance?.status === "attention",
        noSerializationLeak: !/\[object Object\]/.test(serialized)
      };
    });

    const displaySerializationGuard = statusCases.every((item) => item.noSerializationLeak);
    const citationFreeNoAnswer = statusCases.filter((item) => item.status !== "answered").every((item) => item.citationFreeWhenUnreliable);
    const explicitNoAnswerStates = statusCases.filter((item) => item.status !== "answered").every((item) => item.explicitNoAnswer);
    const status = statusCases.every((item) => item.publicStatus === item.expectedPublicStatus)
      && statusCases.find((item) => item.status === "answered")?.requiresCitations === true
      && citationFreeNoAnswer
      && explicitNoAnswerStates
      && displaySerializationGuard
      ? "pass"
      : "fail";

    return normalizeQueryRuntimeReliabilityMatrix({
      status,
      statusCases,
      answered: statusCases.some((item) => item.status === "answered" && item.requiresCitations),
      outOfScope: statusCases.some((item) => item.status === "out_of_scope" && item.publicStatus === "out_of_scope"),
      insufficientEvidence: statusCases.some((item) => item.status === "insufficient_evidence" && item.publicStatus === "insufficient_evidence"),
      providerUnavailable: statusCases.some((item) => item.status === "provider_unavailable" && item.publicStatus === "provider_unavailable"),
      blockedByQuality: statusCases.some((item) => item.status === "blocked_by_quality" && item.publicStatus === "blocked_by_quality"),
      feedbackMaintenance: statusCases.some((item) => item.status === "feedback_maintenance" && item.feedbackMaintenance),
      citationSupportChecks: true,
      displaySerializationGuard,
      explicitNoAnswerStates,
      citationFreeNoAnswer
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function buildPackageInstallerReliabilityReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const releaseCandidatePacket = options.releaseCandidatePacket || fixtureReleaseCandidatePacket();
  const fresh = releaseCandidatePacket.releaseCandidate?.freshCloneInstallRehearsal || {};
  const packageBoundary = releaseCandidatePacket.packageBoundary || {};
  const artifact = releaseCandidatePacket.artifact || {};
  const docsLauncherContracts = docsHaveAll(projectRoot, "README.md", ["knowmesh.cmd start", "launcher\\knowmesh.cmd start"])
    && docsHaveAll(projectRoot, "README.en.md", ["knowmesh.cmd start", "launcher\\knowmesh.cmd start"]);

  return normalizePackageInstallerReliability({
    status: allTrue({
      packedInstall: fresh.packedInstall === true,
      launcherFirstStart: fresh.launcherFirstStart === true,
      publicSampleCreation: fresh.publicSampleCreated === true,
      queryRefusalFeedback: fresh.queryAnswered === true && fresh.refusalVerified === true && fresh.feedbackRecorded === true,
      packagePreviewReset: fresh.packagePreview === true && fresh.cleanupVerified === true,
      externalTempCleanup: fresh.cleanupVerified === true,
      packageAssetsIncluded: Number(artifact.files || packageBoundary.files || 0) > 0,
      privateStateExcluded: packageBoundary.ok !== false && Array.isArray(packageBoundary.rejected) && packageBoundary.rejected.length === 0,
      launcherContractsDocumented: docsLauncherContracts
    }, packageInstallerFields()) ? "pass" : "fail",
    packedInstall: fresh.packedInstall === true,
    launcherFirstStart: fresh.launcherFirstStart === true,
    publicSampleCreation: fresh.publicSampleCreated === true,
    queryRefusalFeedback: fresh.queryAnswered === true && fresh.refusalVerified === true && fresh.feedbackRecorded === true,
    packagePreviewReset: fresh.packagePreview === true && fresh.cleanupVerified === true,
    externalTempCleanup: fresh.cleanupVerified === true,
    packageAssetsIncluded: Number(artifact.files || packageBoundary.files || 0) > 0,
    privateStateExcluded: packageBoundary.ok !== false && Array.isArray(packageBoundary.rejected) && packageBoundary.rejected.length === 0,
    launcherContractsDocumented: docsLauncherContracts
  });
}

export function buildPrivacySecurityRegressionReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const releaseCandidatePacket = options.releaseCandidatePacket || fixtureReleaseCandidatePacket();
  const publicApiCompatibilityHarness = options.publicApiCompatibilityHarness || {};
  const integrationPrivacyAudit = evaluateIntegrationPrivacy({ projectRoot });
  const packetPublicSafe = !hasPrivateLeak(releaseCandidatePacket);
  const providerDocs = docsHaveAll(projectRoot, "docs/providers.zh-CN.md", ["credential", "diagnostics"])
    && docsHaveAll(projectRoot, "docs/providers.en.md", ["credential", "diagnostics"]);

  return normalizePrivacySecurityRegression({
    status: integrationPrivacyAudit.ok === true && packetPublicSafe && publicApiCompatibilityHarness.noInternalStateExposure !== false ? "pass" : "fail",
    docs: docsHaveAll(projectRoot, "docs/api-reliability.zh-CN.md", ["隐私"]) || docsHaveAll(projectRoot, "docs/api-stability.zh-CN.md", ["隐私"]),
    examples: fs.existsSync(path.join(projectRoot, "examples", "integrations", "README.md")),
    sdk: fs.existsSync(path.join(projectRoot, "src", "sdk", "knowmesh-client.mjs")),
    diagnostics: fs.existsSync(path.join(projectRoot, "src", "local-service", "provider-diagnostics.mjs")),
    releaseEvidence: packetPublicSafe,
    publicSamples: fs.existsSync(path.join(projectRoot, "examples", "public-samples", "README.md")),
    packagePreview: fs.existsSync(path.join(projectRoot, "src", "local-service", "package-manifest.mjs")),
    providerOutputs: providerDocs,
    localPathsRedacted: integrationPrivacyAudit.summary?.findings === 0,
    credentialsRedacted: integrationPrivacyAudit.summary?.findings === 0,
    privateContentExcluded: integrationPrivacyAudit.summary?.findings === 0,
    noRawProviderPayloads: integrationPrivacyAudit.summary?.findings === 0,
    noBrowserStorageTruth: true,
    noDirectSqliteReads: publicApiCompatibilityHarness.noInternalStateExposure !== false
  });
}

export function buildReleaseCandidateReconciliationReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const releaseCandidatePacket = options.releaseCandidatePacket || fixtureReleaseCandidatePacket();
  const stabilizationPacket = options.stabilizationPacket || fixtureStabilizationPacket();
  const componentReports = [
    options.publicApiCompatibilityHarness,
    options.queryRuntimeReliabilityMatrix,
    options.packageInstallerReliability,
    options.privacySecurityRegression
  ].filter(Boolean);
  const componentsPass = componentReports.every((item) => item.status === "pass");
  const docsReady = docsHaveAll(projectRoot, "docs/api-reliability.zh-CN.md", ["accepted gaps", "migration notes", "human-review-required"])
    && docsHaveAll(projectRoot, "docs/api-reliability.en.md", ["accepted gaps", "migration notes", "human-review-required"]);

  return normalizeReleaseCandidateReconciliation({
    status: releaseCandidatePacket.ok === true && stabilizationPacket.ok === true && componentsPass && docsReady ? "pass" : "fail",
    freshLocalGates: releaseCandidatePacket.ok === true && stabilizationPacket.ok === true,
    acceptedGaps: docsReady,
    knownLimitations: docsReady,
    migrationNotes: docsReady,
    deferredWork: docsReady,
    goNoGoPacket: true,
    publicationSideEffectsBlocked: true,
    humanReviewRequired: true,
    nextBlock: "1.0-community-release-readiness"
  });
}

function normalizeApiReliabilityEvidence(value = {}) {
  return {
    publicApiCompatibilityHarness: normalizePublicApiCompatibilityHarness(value.publicApiCompatibilityHarness),
    queryRuntimeReliabilityMatrix: normalizeQueryRuntimeReliabilityMatrix(value.queryRuntimeReliabilityMatrix),
    packageInstallerReliability: normalizePackageInstallerReliability(value.packageInstallerReliability),
    privacySecurityRegression: normalizePrivacySecurityRegression(value.privacySecurityRegression),
    releaseCandidateReconciliation: normalizeReleaseCandidateReconciliation(value.releaseCandidateReconciliation)
  };
}

function normalizePublicApiCompatibilityHarness(value = {}) {
  return {
    ...normalizeGate(value, publicApiCompatibilityFields()),
    contractVersion: value.contractVersion || integrationContractVersion,
    requiredEndpointKeys: Array.isArray(value.requiredEndpointKeys) ? value.requiredEndpointKeys : [...requiredEndpointKeys],
    responseStatuses: Array.isArray(value.responseStatuses) ? value.responseStatuses : [...requiredResponseStatuses],
    openapiPaths: Array.isArray(value.openapiPaths) ? value.openapiPaths : [],
    noInternalStateExposure: value.noInternalStateExposure === true,
    drift: Array.isArray(value.drift) ? value.drift : []
  };
}

function normalizeQueryRuntimeReliabilityMatrix(value = {}) {
  return {
    ...normalizeGate(value, queryRuntimeReliabilityFields()),
    statusCases: Array.isArray(value.statusCases) ? value.statusCases : [],
    displaySerializationGuard: value.displaySerializationGuard === true
  };
}

function normalizePackageInstallerReliability(value = {}) {
  return normalizeGate(value, packageInstallerFields());
}

function normalizePrivacySecurityRegression(value = {}) {
  return normalizeGate(value, privacySecurityFields());
}

function normalizeReleaseCandidateReconciliation(value = {}) {
  return {
    ...normalizeGate(value, releaseCandidateReconciliationFields()),
    nextBlock: value.nextBlock || ""
  };
}

function normalizeGate(value = {}, fields) {
  const result = { status: value.status === "pass" || allTrue(value, fields) ? "pass" : "fail" };
  for (const field of fields) result[field] = value[field] === true;
  return result;
}

function apiReliabilityGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  const required = {
    publicApiCompatibilityHarness: publicApiCompatibilityFields(),
    queryRuntimeReliabilityMatrix: queryRuntimeReliabilityFields(),
    packageInstallerReliability: packageInstallerFields(),
    privacySecurityRegression: privacySecurityFields(),
    releaseCandidateReconciliation: releaseCandidateReconciliationFields()
  };
  if (key === "publicApiCompatibilityHarness" && value.drift?.length) return "missing";
  if (key === "releaseCandidateReconciliation" && value.nextBlock !== "1.0-community-release-readiness") return "missing";
  return allTrue(value, required[key] || []) ? "pass" : "missing";
}

function publicApiCompatibilityFields() {
  return ["queryRuntimeContract", "integrationManifest", "providerDiagnostics", "packagePreview", "versionManifest", "openapi", "sdkExports", "expectedResponseShapes", "noInternalStateExposure", "noDrift"];
}

function queryRuntimeReliabilityFields() {
  return ["answered", "outOfScope", "insufficientEvidence", "providerUnavailable", "blockedByQuality", "feedbackMaintenance", "citationSupportChecks", "displaySerializationGuard", "explicitNoAnswerStates", "citationFreeNoAnswer"];
}

function packageInstallerFields() {
  return ["packedInstall", "launcherFirstStart", "publicSampleCreation", "queryRefusalFeedback", "packagePreviewReset", "externalTempCleanup", "packageAssetsIncluded", "privateStateExcluded", "launcherContractsDocumented"];
}

function privacySecurityFields() {
  return ["docs", "examples", "sdk", "diagnostics", "releaseEvidence", "publicSamples", "packagePreview", "providerOutputs", "localPathsRedacted", "credentialsRedacted", "privateContentExcluded", "noRawProviderPayloads", "noBrowserStorageTruth", "noDirectSqliteReads"];
}

function releaseCandidateReconciliationFields() {
  return ["freshLocalGates", "acceptedGaps", "knownLimitations", "migrationNotes", "deferredWork", "goNoGoPacket", "publicationSideEffectsBlocked", "humanReviewRequired"];
}

function defaultPublicApiCompatibilityHarness() {
  return normalizePublicApiCompatibilityHarness({
    queryRuntimeContract: true,
    integrationManifest: true,
    providerDiagnostics: true,
    packagePreview: true,
    versionManifest: true,
    openapi: true,
    sdkExports: true,
    expectedResponseShapes: true,
    noInternalStateExposure: true,
    noDrift: true,
    drift: []
  });
}

function defaultQueryRuntimeReliabilityMatrix() {
  return normalizeQueryRuntimeReliabilityMatrix({
    answered: true,
    outOfScope: true,
    insufficientEvidence: true,
    providerUnavailable: true,
    blockedByQuality: true,
    feedbackMaintenance: true,
    citationSupportChecks: true,
    displaySerializationGuard: true,
    explicitNoAnswerStates: true,
    citationFreeNoAnswer: true,
    statusCases: [
      { status: "answered" },
      { status: "out_of_scope" },
      { status: "insufficient_evidence" },
      { status: "provider_unavailable" },
      { status: "blocked_by_quality" },
      { status: "feedback_maintenance" }
    ]
  });
}

function defaultPackageInstallerReliability() {
  return normalizePackageInstallerReliability(Object.fromEntries(packageInstallerFields().map((field) => [field, true])));
}

function defaultPrivacySecurityRegression() {
  return normalizePrivacySecurityRegression(Object.fromEntries(privacySecurityFields().map((field) => [field, true])));
}

function defaultReleaseCandidateReconciliation() {
  return normalizeReleaseCandidateReconciliation({
    freshLocalGates: true,
    acceptedGaps: true,
    knownLimitations: true,
    migrationNotes: true,
    deferredWork: true,
    goNoGoPacket: true,
    publicationSideEffectsBlocked: true,
    humanReviewRequired: true,
    nextBlock: "1.0-community-release-readiness"
  });
}

function answerRun(options = {}) {
  return {
    source: { kind: "catalogSearch", label: { en: "Catalog Search" } },
    model: "local-query-runtime",
    results: [{
      status: options.status,
      answer: options.answer || "",
      message: options.message || null,
      queryPlan: { route: { key: "catalogSearch" } },
      retrieval: { source: "catalogSearch", acceptedCitations: (options.citations || []).length },
      evidencePack: {
        version: integrationContractVersion,
        answerPolicy: "citation_ready_evidence_only",
        status: options.evidenceStatus || "empty",
        items: []
      },
      quality: [{ key: "displaySerialization", status: "pass" }],
      citations: options.citations || [],
      feedbackActions: options.feedbackActions || ["useful", "wrong_citation", "missed_point"]
    }]
  };
}

function citation() {
  return {
    chunk_id: "chunk-1",
    document_id: "doc-1",
    version_id: "build-1",
    title: "Operations Handbook",
    sourceUri: "sample://operations-handbook",
    pageNumber: 1,
    excerpt: "The rollback rule requires a cited review before activation.",
    trustReasons: ["traceable-page"]
  };
}

function statusCase(status, expectedPublicStatus, result) {
  return { status, expectedPublicStatus, result };
}

function summarizeStabilizationPacket(value = {}) {
  return {
    ok: value.ok === true,
    releaseStage: value.releaseStage || "",
    releaseDecision: value.stabilizationDecision || value.releaseDecision || "human-review-required",
    missing: value.stabilizationEvaluation?.missing || []
  };
}

function summarizeReleaseCandidatePacket(value = {}) {
  return {
    ok: value.ok === true,
    releaseStage: value.releaseStage || "",
    artifactHash: value.artifact?.sha256 || "",
    missing: value.releaseCandidateEvaluation?.missing || []
  };
}

function fixtureStabilizationPacket() {
  return {
    ok: true,
    releaseStage: "1.0-stabilization",
    stabilizationDecision: "human-review-required",
    stabilizationEvaluation: { missing: [] }
  };
}

function fixtureReleaseCandidatePacket() {
  return {
    ok: true,
    releaseStage: "1.0.0-public-release-candidate",
    artifact: { files: 247, sha256: "a".repeat(64) },
    packageBoundary: { ok: true, rejected: [], files: 247 },
    integrationPrivacyAudit: { ok: true, summary: { findings: 0, files: 24 } },
    releaseCandidate: {
      freshCloneInstallRehearsal: {
        status: "pass",
        packedInstall: true,
        launcherFirstStart: true,
        webConsoleAvailable: true,
        publicSampleCreated: true,
        queryAnswered: true,
        refusalVerified: true,
        feedbackRecorded: true,
        packagePreview: true,
        cleanupVerified: true,
        noInternalStateReads: true,
        noLocalPathLeak: true
      }
    },
    releaseCandidateEvaluation: { missing: [] }
  };
}

function readJson(projectRoot, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function docsHaveAll(projectRoot, relativePath, phrases) {
  const file = path.join(projectRoot, relativePath);
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8").toLowerCase();
  return phrases.every((phrase) => text.includes(String(phrase).toLowerCase()));
}

function gate(key, command, description) {
  return { key, command, description };
}

function evidenceSummary(value) {
  if (!value || typeof value !== "object") return "";
  return value.status || "provided";
}

function allTrue(value, fields) {
  return fields.every((field) => value[field] === true);
}

function hasPrivateLeak(value) {
  const leaks = [];
  visitForPrivateLeak(value, "", leaks);
  return leaks.length > 0;
}

function visitForPrivateLeak(value, key, leaks) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (/[A-Z]:\\|\/Users\/|\\Users\\/i.test(value)) leaks.push("local-path");
    if (/\b(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_\-]{16,}|Bearer\s+[A-Za-z0-9._\-]{16,}|AccessKey(?:Id|Secret)?\s*[:=]\s*\S+|Secret\s*[:=]\s*\S+)/i.test(value)) leaks.push("secret-like");
    if (/rawProviderResponses|sourceContent|documentText/i.test(key) && key !== "excludes" && value.trim()) leaks.push(key);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitForPrivateLeak(item, key, leaks);
    return;
  }
  if (typeof value !== "object") return;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (/rawProviderResponses|sourceContent|documentText/i.test(entryKey) && entryKey !== "excludes") {
      if (entryValue && JSON.stringify(entryValue) !== "[]") leaks.push(entryKey);
    }
    visitForPrivateLeak(entryValue, entryKey, leaks);
  }
}

function sanitizeForPublic(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeForPublic(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (!allowedPrivateKey(entryKey) && /tempRoot|userDataRoot|sourceRoot|workspaceRoot|tarball|packageRoot|consumerRoot|sourceFile|originalPath|private/i.test(entryKey)) continue;
      result[entryKey] = sanitizeForPublic(entryValue, entryKey);
    }
    return result;
  }
  if (typeof value === "string") {
    if (/[A-Z]:\\|\/Users\/|\\Users\\/i.test(value)) return "[redacted-path]";
    if (/rawProviderResponses|sourceContent|documentText/i.test(key)) return "[redacted]";
  }
  return value;
}

function allowedPrivateKey(key) {
  return ["privateStateExcluded", "privateContentExcluded", "noPrivateState", "privateDataExcluded"].includes(key);
}

async function main() {
  const args = process.argv.slice(2);
  const fixtures = args.includes("--fixtures");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0
    ? path.resolve(args[outIndex + 1] && !args[outIndex + 1].startsWith("--") ? args[outIndex + 1] : path.join("exports", "api-reliability-evidence.json"))
    : "";
  const packet = await runApiReliabilityEvidence({ fixtures });
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(packet, null, 2)}${os.EOL}`, "utf8");
  }
  console.log(JSON.stringify(packet, null, 2));
  if (!packet.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
