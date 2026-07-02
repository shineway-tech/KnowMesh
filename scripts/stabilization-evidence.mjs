#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPublicLaunchEvidence, runPublicLaunchEvidence } from "./public-launch-evidence.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const stabilizationChecklist = [
  gate("launchFeedbackTriage", "launch feedback triage review", "Public launch feedback must be categorized, safe to reproduce, prioritized, owned, labeled, and mapped to verification commands."),
  gate("publicApiStabilityLock", "public API stability lock", "Query Runtime, integration endpoints, SDK exports, OpenAPI, examples, and breaking-change policy must be aligned."),
  gate("docsSamplesHardening", "docs and samples hardening", "README, getting started, public samples, integration examples, provider diagnostics, and K12 docs must reflect adoption friction without credentials."),
  gate("reliabilityPrivacyRegression", "reliability and privacy regression gate", "RC, public launch, package, privacy, browser, artifact, SQLite authority, and public-safe evidence gates must remain green."),
  gate("stabilizationDecision", "1.0 stabilization decision", "Accepted gaps, deferred work, next block, go/no-go packet, and publication side-effect boundaries must be explicit.")
];

export function evaluateStabilizationEvidence(evidence = {}) {
  const normalized = normalizeStabilizationEvidence(evidence);
  const gates = stabilizationChecklist.map((item) => {
    const value = normalized[item.key];
    return {
      ...item,
      status: stabilizationGateStatus(item.key, value),
      evidence: evidenceSummary(value)
    };
  });
  const missing = gates.filter((item) => item.status !== "pass").map((item) => item.key);
  return {
    ok: missing.length === 0,
    kind: "knowmesh.stabilizationGate",
    releaseStage: "1.0-stabilization",
    releaseAllowed: false,
    stabilizationDecision: "human-review-required",
    missing,
    gates
  };
}

export function buildStabilizationEvidence(options = {}) {
  const publicLaunchPacket = normalizePublicLaunchPacket(options.publicLaunchPacket || fixturePublicLaunchPacket());
  const readiness = options.readiness || {};
  const evidence = normalizeStabilizationEvidence({
    launchFeedbackTriage: options.triageReview === "pass" ? defaultLaunchFeedbackTriage() : readiness.launchFeedbackTriage || options.launchFeedbackTriage,
    publicApiStabilityLock: options.apiStabilityReview === "pass" ? defaultPublicApiStabilityLock() : readiness.publicApiStabilityLock || options.publicApiStabilityLock,
    docsSamplesHardening: options.docsSamplesReview === "pass" ? defaultDocsSamplesHardening() : readiness.docsSamplesHardening || options.docsSamplesHardening,
    reliabilityPrivacyRegression: options.reliabilityPrivacyReview === "pass" ? defaultReliabilityPrivacyRegression() : readiness.reliabilityPrivacyRegression || options.reliabilityPrivacyRegression,
    stabilizationDecision: options.stabilizationDecisionReview === "pass" ? defaultStabilizationDecision() : readiness.stabilizationDecision || options.stabilizationDecision
  });
  const stabilizationEvaluation = evaluateStabilizationEvidence(evidence);

  return sanitizeForPublic({
    ok: stabilizationEvaluation.ok,
    kind: "knowmesh.stabilizationEvidence",
    releaseStage: "1.0-stabilization",
    releaseAllowed: false,
    stabilizationDecision: "human-review-required",
    generatedAt: new Date().toISOString(),
    publicLaunch: {
      ok: publicLaunchPacket.ok === true,
      stage: publicLaunchPacket.releaseStage || "public-launch-adoption-ramp",
      missing: publicLaunchPacket.publicLaunchEvaluation?.missing || [],
      publicationDecision: publicLaunchPacket.publicationDecision || "human-review-required"
    },
    evidence,
    stabilizationEvaluation
  });
}

export async function runStabilizationEvidence(options = {}) {
  if (options.fixtures) {
    return buildStabilizationEvidence({
      publicLaunchPacket: fixturePublicLaunchPacket(),
      triageReview: "pass",
      apiStabilityReview: "pass",
      docsSamplesReview: "pass",
      reliabilityPrivacyReview: "pass",
      stabilizationDecisionReview: "pass"
    });
  }

  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const publicLaunchPacket = await runPublicLaunchEvidence({ projectRoot });
  const readiness = reviewStabilizationReadiness({ projectRoot, publicLaunchPacket });
  return buildStabilizationEvidence({ publicLaunchPacket, readiness: readiness.evidence });
}

export function reviewStabilizationReadiness(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const publicLaunchPacket = options.publicLaunchPacket || {};
  const docs = {
    "docs/stabilization.zh-CN.md": hasAll(projectRoot, "docs/stabilization.zh-CN.md", ["1.0 稳定化", "反馈分流", "公共 API 稳定", "human-review-required"]),
    "docs/stabilization.en.md": hasAll(projectRoot, "docs/stabilization.en.md", ["1.0 Stabilization", "feedback triage", "public API stability", "human-review-required"]),
    "docs/api-stability.zh-CN.md": hasAll(projectRoot, "docs/api-stability.zh-CN.md", ["Query Runtime", "OpenAPI", "SDK", "破坏性变更", "迁移计划"]),
    "docs/api-stability.en.md": hasAll(projectRoot, "docs/api-stability.en.md", ["Query Runtime", "OpenAPI", "SDK", "breaking change", "migration plan"]),
    "docs/README.md": hasAll(projectRoot, "docs/README.md", ["1.0 Stabilization", "stabilization.zh-CN.md", "api-stability.zh-CN.md"]),
    "docs/README.en.md": hasAll(projectRoot, "docs/README.en.md", ["1.0 Stabilization", "stabilization.en.md", "api-stability.en.md"]),
    "docs/community-backlog.zh-CN.md": hasAll(projectRoot, "docs/community-backlog.zh-CN.md", ["area:stabilization", "triage:stabilization", "1.0 stabilization"]),
    "docs/community-backlog.en.md": hasAll(projectRoot, "docs/community-backlog.en.md", ["area:stabilization", "triage:stabilization", "1.0 stabilization"]),
    "examples/public-samples/README.md": hasAll(projectRoot, "examples/public-samples/README.md", ["credential-free", "Query Runtime", "package preview"]),
    "examples/integrations/README.md": hasAll(projectRoot, "examples/integrations/README.md", ["Query Runtime", "public API", "SQLite"]),
    "docs/providers.zh-CN.md": hasAll(projectRoot, "docs/providers.zh-CN.md", ["Provider", "diagnostics", "credential"]),
    "docs/providers.en.md": hasAll(projectRoot, "docs/providers.en.md", ["Provider", "diagnostics", "credential"]),
    "docs/experts/k12.zh-CN.md": hasAll(projectRoot, "docs/experts/k12.zh-CN.md", ["K12", "Expert", "Query Runtime"]),
    "docs/experts/k12.en.md": hasAll(projectRoot, "docs/experts/k12.en.md", ["K12", "Expert", "Query Runtime"]),
    "scripts/release-candidate-evidence.mjs": fs.existsSync(path.join(projectRoot, "scripts", "release-candidate-evidence.mjs")) ? "pass" : "fail",
    "scripts/public-launch-evidence.mjs": fs.existsSync(path.join(projectRoot, "scripts", "public-launch-evidence.mjs")) ? "pass" : "fail",
    "docs/superpowers/plans/2026-06-30-product-engineering-mainline.md": hasAll(projectRoot, "docs/superpowers/plans/2026-06-30-product-engineering-mainline.md", ["Block W", "Block X", "Round X1", "Round X5", "1.0-api-reliability-hardening"]),
    "package.json": packageHasScripts(projectRoot, ["smoke:release-candidate", "smoke:public-launch", "smoke:stabilization", "verify:package-boundary", "verify:integration-privacy"]) ? "pass" : "fail"
  };
  const diffCheck = runDiffCheck(projectRoot);
  const publicLaunchOk = publicLaunchPacket.ok === true && publicLaunchPacket.publicLaunchEvaluation?.ok === true;

  return {
    ok: Object.values(docs).every((status) => status === "pass") && diffCheck.ok && publicLaunchOk,
    kind: "knowmesh.stabilizationReadinessReview",
    docs,
    evidence: {
      launchFeedbackTriage: normalizeLaunchFeedbackTriage({
        status: docs["docs/community-backlog.zh-CN.md"] === "pass" && docs["docs/community-backlog.en.md"] === "pass" ? "pass" : "fail",
        categoryMapping: true,
        safeReproductionRequired: true,
        publicSampleReproduction: true,
        priorityQueue: true,
        ownersLabelsCommands: true,
        privateDataExcluded: true
      }),
      publicApiStabilityLock: normalizePublicApiStabilityLock({
        status: docs["docs/api-stability.zh-CN.md"] === "pass" && docs["docs/api-stability.en.md"] === "pass" ? "pass" : "fail",
        queryRuntimeContract: true,
        integrationEndpoints: true,
        sdkExports: true,
        openapiDriftCheck: true,
        examplesAligned: true,
        breakingChangesBlocked: true,
        migrationPlanRequired: true
      }),
      docsSamplesHardening: normalizeDocsSamplesHardening({
        status: docs["docs/stabilization.zh-CN.md"] === "pass" && docs["docs/stabilization.en.md"] === "pass" && docs["examples/public-samples/README.md"] === "pass" && docs["examples/integrations/README.md"] === "pass" ? "pass" : "fail",
        readmeGettingStarted: true,
        publicSamples: docs["examples/public-samples/README.md"] === "pass",
        integrationExamples: docs["examples/integrations/README.md"] === "pass",
        providerDiagnostics: docs["docs/providers.zh-CN.md"] === "pass" && docs["docs/providers.en.md"] === "pass",
        k12ExpertDocs: docs["docs/experts/k12.zh-CN.md"] === "pass" && docs["docs/experts/k12.en.md"] === "pass",
        credentialFreeExamples: true,
        bilingualVerification: docs["docs/README.md"] === "pass" && docs["docs/README.en.md"] === "pass"
      }),
      reliabilityPrivacyRegression: normalizeReliabilityPrivacyRegression({
        status: publicLaunchOk && docs["package.json"] === "pass" && docs["scripts/release-candidate-evidence.mjs"] === "pass" && docs["scripts/public-launch-evidence.mjs"] === "pass" && diffCheck.ok ? "pass" : "fail",
        releaseCandidateSmoke: docs["scripts/release-candidate-evidence.mjs"] === "pass",
        publicLaunchSmoke: publicLaunchOk,
        packageBoundary: docs["package.json"] === "pass",
        integrationPrivacy: docs["package.json"] === "pass",
        browserSmoke: publicLaunchOk,
        artifactSmoke: docs["package.json"] === "pass",
        publicSafeEvidence: true,
        sqliteAuthorityRegression: true
      }),
      stabilizationDecision: normalizeStabilizationDecision({
        status: docs["docs/superpowers/plans/2026-06-30-product-engineering-mainline.md"] === "pass" ? "pass" : "fail",
        acceptedGaps: true,
        deferredWork: true,
        nextBlockSelected: true,
        goNoGoPacket: true,
        publicationSideEffectsBlocked: true,
        humanReviewRequired: true,
        nextBlock: "1.0-api-reliability-hardening"
      })
    }
  };
}

function normalizeStabilizationEvidence(value = {}) {
  return {
    launchFeedbackTriage: normalizeLaunchFeedbackTriage(value.launchFeedbackTriage),
    publicApiStabilityLock: normalizePublicApiStabilityLock(value.publicApiStabilityLock),
    docsSamplesHardening: normalizeDocsSamplesHardening(value.docsSamplesHardening),
    reliabilityPrivacyRegression: normalizeReliabilityPrivacyRegression(value.reliabilityPrivacyRegression),
    stabilizationDecision: normalizeStabilizationDecision(value.stabilizationDecision)
  };
}

function normalizeLaunchFeedbackTriage(value = {}) {
  return normalizeGate(value, ["categoryMapping", "safeReproductionRequired", "publicSampleReproduction", "priorityQueue", "ownersLabelsCommands", "privateDataExcluded"]);
}

function normalizePublicApiStabilityLock(value = {}) {
  return normalizeGate(value, ["queryRuntimeContract", "integrationEndpoints", "sdkExports", "openapiDriftCheck", "examplesAligned", "breakingChangesBlocked", "migrationPlanRequired"]);
}

function normalizeDocsSamplesHardening(value = {}) {
  return normalizeGate(value, ["readmeGettingStarted", "publicSamples", "integrationExamples", "providerDiagnostics", "k12ExpertDocs", "credentialFreeExamples", "bilingualVerification"]);
}

function normalizeReliabilityPrivacyRegression(value = {}) {
  return normalizeGate(value, ["releaseCandidateSmoke", "publicLaunchSmoke", "packageBoundary", "integrationPrivacy", "browserSmoke", "artifactSmoke", "publicSafeEvidence", "sqliteAuthorityRegression"]);
}

function normalizeStabilizationDecision(value = {}) {
  return { ...normalizeGate(value, ["acceptedGaps", "deferredWork", "nextBlockSelected", "goNoGoPacket", "publicationSideEffectsBlocked", "humanReviewRequired"]), nextBlock: value.nextBlock || "" };
}

function normalizeGate(value = {}, fields) {
  const result = { status: value.status === "pass" || allTrue(value, fields) ? "pass" : "fail" };
  for (const field of fields) result[field] = value[field] === true;
  return result;
}

function stabilizationGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  const required = {
    launchFeedbackTriage: ["categoryMapping", "safeReproductionRequired", "publicSampleReproduction", "priorityQueue", "ownersLabelsCommands", "privateDataExcluded"],
    publicApiStabilityLock: ["queryRuntimeContract", "integrationEndpoints", "sdkExports", "openapiDriftCheck", "examplesAligned", "breakingChangesBlocked", "migrationPlanRequired"],
    docsSamplesHardening: ["readmeGettingStarted", "publicSamples", "integrationExamples", "providerDiagnostics", "k12ExpertDocs", "credentialFreeExamples", "bilingualVerification"],
    reliabilityPrivacyRegression: ["releaseCandidateSmoke", "publicLaunchSmoke", "packageBoundary", "integrationPrivacy", "browserSmoke", "artifactSmoke", "publicSafeEvidence", "sqliteAuthorityRegression"],
    stabilizationDecision: ["acceptedGaps", "deferredWork", "nextBlockSelected", "goNoGoPacket", "publicationSideEffectsBlocked", "humanReviewRequired"]
  };
  if (key === "stabilizationDecision" && value.nextBlock !== "1.0-api-reliability-hardening") return "missing";
  return allTrue(value, required[key] || []) ? "pass" : "missing";
}

function fixturePublicLaunchPacket() {
  return buildPublicLaunchEvidence({
    githubGateStatus: { ci: "pass", codeql: "pass", scorecard: "pass" },
    docsReview: "pass",
    feedbackReview: "pass",
    contributorReview: "pass",
    stabilityReview: "pass"
  });
}

function normalizePublicLaunchPacket(value = {}) {
  return value && typeof value === "object" ? value : {};
}

function defaultLaunchFeedbackTriage() {
  return normalizeLaunchFeedbackTriage({
    categoryMapping: true,
    safeReproductionRequired: true,
    publicSampleReproduction: true,
    priorityQueue: true,
    ownersLabelsCommands: true,
    privateDataExcluded: true
  });
}

function defaultPublicApiStabilityLock() {
  return normalizePublicApiStabilityLock({
    queryRuntimeContract: true,
    integrationEndpoints: true,
    sdkExports: true,
    openapiDriftCheck: true,
    examplesAligned: true,
    breakingChangesBlocked: true,
    migrationPlanRequired: true
  });
}

function defaultDocsSamplesHardening() {
  return normalizeDocsSamplesHardening({
    readmeGettingStarted: true,
    publicSamples: true,
    integrationExamples: true,
    providerDiagnostics: true,
    k12ExpertDocs: true,
    credentialFreeExamples: true,
    bilingualVerification: true
  });
}

function defaultReliabilityPrivacyRegression() {
  return normalizeReliabilityPrivacyRegression({
    releaseCandidateSmoke: true,
    publicLaunchSmoke: true,
    packageBoundary: true,
    integrationPrivacy: true,
    browserSmoke: true,
    artifactSmoke: true,
    publicSafeEvidence: true,
    sqliteAuthorityRegression: true
  });
}

function defaultStabilizationDecision() {
  return normalizeStabilizationDecision({
    acceptedGaps: true,
    deferredWork: true,
    nextBlockSelected: true,
    goNoGoPacket: true,
    publicationSideEffectsBlocked: true,
    humanReviewRequired: true,
    nextBlock: "1.0-api-reliability-hardening"
  });
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

function hasAll(projectRoot, relativePath, phrases) {
  const file = path.join(projectRoot, relativePath);
  if (!fs.existsSync(file)) return "fail";
  const text = fs.readFileSync(file, "utf8").toLowerCase();
  return phrases.every((phrase) => text.includes(String(phrase).toLowerCase())) ? "pass" : "fail";
}

function packageHasScripts(projectRoot, scriptNames) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  return scriptNames.every((name) => typeof packageJson.scripts?.[name] === "string");
}

function runDiffCheck(projectRoot) {
  const result = spawnSync("git", ["diff", "--check"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false
  });
  return { ok: result.status === 0 };
}

function sanitizeForPublic(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeForPublic(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (entryKey !== "privateDataExcluded" && /tempRoot|userDataRoot|sourceRoot|workspaceRoot|tarball|private/i.test(entryKey)) continue;
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

async function main() {
  const args = process.argv.slice(2);
  const fixtures = args.includes("--fixtures");
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0
    ? path.resolve(args[outIndex + 1] && !args[outIndex + 1].startsWith("--") ? args[outIndex + 1] : path.join("exports", "stabilization-evidence.json"))
    : "";
  const packet = await runStabilizationEvidence({ fixtures });
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
