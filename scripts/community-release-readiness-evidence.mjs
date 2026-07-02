#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runApiReliabilityEvidence } from "./api-reliability-evidence.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const communityReleaseChecklist = [
  gate("contributorOnboardingRehearsal", "contributor onboarding rehearsal", "Docs-only and code-path contributor routes must be public-safe, verifiable, and aligned with current-design authority."),
  gate("issueTriageSupportOps", "issue triage and support operations", "Public issue templates, support lanes, labels, owners, commands, and known-gap carryover must be explicit."),
  gate("discoveryDocsQuality", "discovery and documentation quality", "README, docs index, samples, integration docs, API reliability docs, roadmap, maturity language, and bilingual coverage must be searchable and aligned."),
  gate("releaseNotesAdoptionLoop", "release notes and adoption loop", "Supported paths, limitations, known gaps, evidence, artifact hash, rollback plan, and first-user feedback loops must be ready."),
  gate("communityReleaseReadinessDecision", "community release readiness decision", "The final community readiness packet must remain human-reviewed and block release side effects.")
];

const requiredTemplates = [
  "bug_report.yml",
  "docs.yml",
  "expert_request.yml",
  "feature_request.yml",
  "launch_feedback.yml",
  "provider_adapter.yml",
  "sample_request.yml"
];

const supportLanes = [
  "api-compatibility",
  "query-runtime-reliability",
  "package-install",
  "privacy-security",
  "docs-discovery",
  "k12-expert-feedback",
  "provider-adapter",
  "public-sample"
];

export function evaluateCommunityReleaseReadiness(evidence = {}) {
  const normalized = normalizeCommunityReleaseEvidence(evidence);
  const gates = communityReleaseChecklist.map((item) => {
    const value = normalized[item.key];
    return {
      ...item,
      status: communityReleaseGateStatus(item.key, value),
      evidence: evidenceSummary(value)
    };
  });
  const missing = gates.filter((item) => item.status !== "pass").map((item) => item.key);
  return {
    ok: missing.length === 0,
    kind: "knowmesh.communityReleaseReadinessGate",
    releaseStage: "1.0-community-release-readiness",
    releaseAllowed: false,
    releaseDecision: "human-review-required",
    missing,
    gates
  };
}

export async function buildCommunityReleaseReadinessEvidence(options = {}) {
  const readiness = options.readiness || {};
  const evidence = normalizeCommunityReleaseEvidence({
    contributorOnboardingRehearsal: options.contributorReview === "pass" ? defaultContributorOnboarding() : readiness.contributorOnboardingRehearsal || options.contributorOnboardingRehearsal,
    issueTriageSupportOps: options.triageReview === "pass" ? defaultIssueTriageSupportOps() : readiness.issueTriageSupportOps || options.issueTriageSupportOps,
    discoveryDocsQuality: options.discoveryReview === "pass" ? defaultDiscoveryDocsQuality() : readiness.discoveryDocsQuality || options.discoveryDocsQuality,
    releaseNotesAdoptionLoop: options.adoptionReview === "pass" ? defaultReleaseNotesAdoptionLoop() : readiness.releaseNotesAdoptionLoop || options.releaseNotesAdoptionLoop,
    communityReleaseReadinessDecision: options.decisionReview === "pass" ? defaultCommunityReleaseDecision() : readiness.communityReleaseReadinessDecision || options.communityReleaseReadinessDecision
  });
  const communityReleaseEvaluation = evaluateCommunityReleaseReadiness(evidence);

  return sanitizeForPublic({
    ok: communityReleaseEvaluation.ok,
    kind: "knowmesh.communityReleaseReadinessEvidence",
    releaseStage: "1.0-community-release-readiness",
    releaseAllowed: false,
    releaseDecision: "human-review-required",
    generatedAt: new Date().toISOString(),
    apiReliability: summarizeApiReliabilityPacket(options.apiReliabilityPacket),
    evidence,
    communityReleaseEvaluation
  });
}

export async function runCommunityReleaseReadinessEvidence(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  if (options.fixtures) {
    return buildCommunityReleaseReadinessEvidence({
      contributorReview: "pass",
      triageReview: "pass",
      discoveryReview: "pass",
      adoptionReview: "pass",
      decisionReview: "pass",
      apiReliabilityPacket: fixtureApiReliabilityPacket()
    });
  }

  const apiReliabilityPacket = await runApiReliabilityEvidence({ projectRoot });
  const contributorOnboardingRehearsal = buildContributorOnboardingReport({ projectRoot });
  const issueTriageSupportOps = buildIssueTriageSupportReport({ projectRoot });
  const discoveryDocsQuality = buildDiscoveryDocsQualityReport({ projectRoot });
  const releaseNotesAdoptionLoop = buildReleaseNotesAdoptionLoopReport({ projectRoot, apiReliabilityPacket });
  const communityReleaseReadinessDecision = buildCommunityReleaseDecisionReport({
    projectRoot,
    apiReliabilityPacket,
    contributorOnboardingRehearsal,
    issueTriageSupportOps,
    discoveryDocsQuality,
    releaseNotesAdoptionLoop
  });

  return buildCommunityReleaseReadinessEvidence({
    apiReliabilityPacket,
    readiness: {
      contributorOnboardingRehearsal,
      issueTriageSupportOps,
      discoveryDocsQuality,
      releaseNotesAdoptionLoop,
      communityReleaseReadinessDecision
    }
  });
}

export function buildContributorOnboardingReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const goodFirstZh = readText(projectRoot, "docs/good-first-issues.zh-CN.md");
  const goodFirstEn = readText(projectRoot, "docs/good-first-issues.en.md");
  const contributing = readText(projectRoot, "CONTRIBUTING.md");
  const prTemplate = readText(projectRoot, ".github/PULL_REQUEST_TEMPLATE.md");
  const currentDesign = readText(projectRoot, "docs/current-design.md");

  return normalizeContributorOnboarding({
    status: "pass",
    docsOnlyPath: includesAll(`${goodFirstZh}\n${goodFirstEn}\n${contributing}`, ["docs-only", "git diff --check"]),
    codePathPublicApiOnly: includesAll(`${goodFirstZh}\n${goodFirstEn}\n${prTemplate}`, ["code-path", "public API", "internal SQLite"]),
    currentDesignAuthority: includesAll(`${contributing}\n${prTemplate}`, ["current-design.md", "single current design authority"]),
    noJsonFirstShims: includesAll(`${contributing}\n${currentDesign}`, ["JSON-first", "compatibility shims"]),
    packageBoundaryVisible: includesAll(contributing, ["verify:package-boundary"]),
    privacyRulesVisible: includesAny(contributing, ["private documents", "private source text"]) && includesAny(prTemplate, ["No secrets", "private source text"]),
    bilingualContributorDocs: goodFirstZh.length > 0 && goodFirstEn.length > 0,
    verificationCommands: includesAll(contributing, ["npm test", "git diff --check"]),
    noInternalStateReads: includesAll(`${goodFirstZh}\n${goodFirstEn}\n${prTemplate}`, ["internal SQLite"])
  });
}

export function buildIssueTriageSupportReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const templateDir = path.join(projectRoot, ".github", "ISSUE_TEMPLATE");
  const templates = requiredTemplates.filter((name) => fs.existsSync(path.join(templateDir, name))).sort();
  const templateText = templates.map((name) => readText(projectRoot, path.join(".github", "ISSUE_TEMPLATE", name))).join("\n");
  const backlogZh = readText(projectRoot, "docs/community-backlog.zh-CN.md");
  const backlogEn = readText(projectRoot, "docs/community-backlog.en.md");
  const backlog = `${backlogZh}\n${backlogEn}`;

  return normalizeIssueTriageSupportOps({
    status: "pass",
    templates,
    supportLanes,
    publicSafeReproduction: templates.length === requiredTemplates.length && includesAll(templateText, ["private", "Reproduction"]),
    labelsMapped: supportLanes.every((lane) => backlog.includes(lane)),
    ownersMapped: includesAll(backlog, ["owner", "维护"]),
    commandsMapped: includesAll(backlog, ["npm test", "verify:package-boundary", "smoke:community-release"]),
    knownGapCarryover: includesAll(backlog, ["known-gap", "release-note"]),
    apiCompatibilityLane: backlog.includes("api-compatibility"),
    privacySecurityLane: backlog.includes("privacy-security")
  });
}

export function buildDiscoveryDocsQualityReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const readmeZh = readText(projectRoot, "README.md");
  const readmeEn = readText(projectRoot, "README.en.md");
  const docsZh = readText(projectRoot, "docs/README.md");
  const docsEn = readText(projectRoot, "docs/README.en.md");
  const roadmapZh = readText(projectRoot, "ROADMAP.md");
  const roadmapEn = readText(projectRoot, "ROADMAP.en.md");

  const report = {
    readmeFirstViewport: includesAll(`${readmeZh}\n${readmeEn}`, ["Knowledge Asset Compiler", "Local-first"]),
    docsIndexChineseDefault: docsZh.includes("KnowMesh 文档中心") && docsZh.includes("[English]"),
    englishComplete: docsEn.includes("KnowMesh Documentation") && docsEn.includes("1.0 API Reliability"),
    apiReliabilityLinked: includesAll(`${docsZh}\n${docsEn}`, ["api-reliability.zh-CN.md", "api-reliability.en.md"]),
    communityReadinessLinked: includesAll(`${docsZh}\n${docsEn}`, ["community-release-readiness.zh-CN.md", "community-release-readiness.en.md"]),
    publicSamplesLinked: includesAll(`${docsZh}\n${docsEn}`, ["Public Samples", "公开样例"]),
    roadmapLinked: roadmapZh.length > 0 && roadmapEn.length > 0,
    maturityHonest: includesAny(`${readmeZh}\n${readmeEn}`, ["Alpha", "alpha", "Public Launch Candidate"]),
    searchTermsCovered: includesAll(`${readmeZh}\n${readmeEn}`, ["RAG", "SQLite", "citations", "local-first"]),
    bilingualParity: Math.abs(docsZh.split("\n").length - docsEn.split("\n").length) < 30
  };
  return normalizeDiscoveryDocsQuality({
    ...report,
    status: allTrue(report, discoveryFields()) ? "pass" : "fail"
  });
}

export function buildReleaseNotesAdoptionLoopReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const communityZh = readText(projectRoot, "docs/community-release-readiness.zh-CN.md");
  const communityEn = readText(projectRoot, "docs/community-release-readiness.en.md");
  const releaseOps = `${readText(projectRoot, "docs/release-operations.zh-CN.md")}\n${readText(projectRoot, "docs/release-operations.en.md")}`;
  const backlog = `${readText(projectRoot, "docs/community-backlog.zh-CN.md")}\n${readText(projectRoot, "docs/community-backlog.en.md")}`;
  const artifactHash = options.apiReliabilityPacket?.releaseCandidate?.artifactHash || "";

  return normalizeReleaseNotesAdoptionLoop({
    status: "pass",
    supportedPaths: includesAll(`${communityZh}\n${communityEn}`, ["supported paths", "支持路径"]),
    limitations: includesAll(`${communityZh}\n${communityEn}`, ["limitations", "限制"]),
    knownGaps: includesAll(`${communityZh}\n${communityEn}`, ["known gaps", "已知缺口"]),
    verificationEvidence: includesAll(releaseOps, ["smoke:community-release", "generate:community-release"]),
    packageHash: /^[a-f0-9]{64}$/i.test(String(artifactHash || "")) || includesAll(`${communityZh}\n${communityEn}`, ["package hash", "artifact hash"]),
    rollbackPlan: includesAll(`${communityZh}\n${communityEn}`, ["rollback plan", "回滚"]),
    feedbackIntake: includesAll(backlog, ["feedback", "triage"]),
    sampleRequests: backlog.includes("public-sample"),
    integrationReports: backlog.includes("integration"),
    providerRequests: backlog.includes("provider-adapter"),
    k12QualityReports: backlog.includes("k12-expert-feedback"),
    publicationSideEffectsBlocked: includesAll(`${communityZh}\n${communityEn}`, ["human-review-required"])
  });
}

export function buildCommunityReleaseDecisionReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const communityDocsReady = docsHaveAll(projectRoot, "docs/community-release-readiness.zh-CN.md", ["deferred work", "go/no-go", "human-review-required"])
    && docsHaveAll(projectRoot, "docs/community-release-readiness.en.md", ["deferred work", "go/no-go", "human-review-required"]);
  const components = [
    options.contributorOnboardingRehearsal,
    options.issueTriageSupportOps,
    options.discoveryDocsQuality,
    options.releaseNotesAdoptionLoop
  ].filter(Boolean);

  return normalizeCommunityReleaseDecision({
    status: options.apiReliabilityPacket?.ok === true && components.every((item) => item.status === "pass") && communityDocsReady ? "pass" : "fail",
    apiReliabilityFresh: options.apiReliabilityPacket?.ok === true,
    contributorReady: options.contributorOnboardingRehearsal?.status === "pass",
    triageReady: options.issueTriageSupportOps?.status === "pass",
    discoveryReady: options.discoveryDocsQuality?.status === "pass",
    adoptionReady: options.releaseNotesAdoptionLoop?.status === "pass",
    deferredWorkReconciled: communityDocsReady,
    goNoGoPacket: communityDocsReady,
    releaseSideEffectsBlocked: communityDocsReady,
    humanReviewRequired: true,
    nextBlock: "1.0-final-publication-review"
  });
}

function normalizeCommunityReleaseEvidence(value = {}) {
  return {
    contributorOnboardingRehearsal: normalizeContributorOnboarding(value.contributorOnboardingRehearsal),
    issueTriageSupportOps: normalizeIssueTriageSupportOps(value.issueTriageSupportOps),
    discoveryDocsQuality: normalizeDiscoveryDocsQuality(value.discoveryDocsQuality),
    releaseNotesAdoptionLoop: normalizeReleaseNotesAdoptionLoop(value.releaseNotesAdoptionLoop),
    communityReleaseReadinessDecision: normalizeCommunityReleaseDecision(value.communityReleaseReadinessDecision)
  };
}

function normalizeContributorOnboarding(value = {}) {
  return normalizeGate(value, contributorFields());
}

function normalizeIssueTriageSupportOps(value = {}) {
  return {
    ...normalizeGate(value, triageFields()),
    templates: Array.isArray(value.templates) ? value.templates : [...requiredTemplates],
    supportLanes: Array.isArray(value.supportLanes) ? value.supportLanes : [...supportLanes]
  };
}

function normalizeDiscoveryDocsQuality(value = {}) {
  return normalizeGate(value, discoveryFields());
}

function normalizeReleaseNotesAdoptionLoop(value = {}) {
  return normalizeGate(value, adoptionFields());
}

function normalizeCommunityReleaseDecision(value = {}) {
  return {
    ...normalizeGate(value, decisionFields()),
    nextBlock: value.nextBlock || ""
  };
}

function normalizeGate(value = {}, fields) {
  const result = { status: value.status === "pass" || allTrue(value, fields) ? "pass" : "fail" };
  for (const field of fields) result[field] = value[field] === true;
  return result;
}

function communityReleaseGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  const required = {
    contributorOnboardingRehearsal: contributorFields(),
    issueTriageSupportOps: triageFields(),
    discoveryDocsQuality: discoveryFields(),
    releaseNotesAdoptionLoop: adoptionFields(),
    communityReleaseReadinessDecision: decisionFields()
  };
  if (key === "issueTriageSupportOps" && requiredTemplates.some((name) => !value.templates?.includes(name))) return "missing";
  if (key === "communityReleaseReadinessDecision" && value.nextBlock !== "1.0-final-publication-review") return "missing";
  return allTrue(value, required[key] || []) ? "pass" : "missing";
}

function contributorFields() {
  return ["docsOnlyPath", "codePathPublicApiOnly", "currentDesignAuthority", "noJsonFirstShims", "packageBoundaryVisible", "privacyRulesVisible", "bilingualContributorDocs", "verificationCommands", "noInternalStateReads"];
}

function triageFields() {
  return ["publicSafeReproduction", "labelsMapped", "ownersMapped", "commandsMapped", "knownGapCarryover", "apiCompatibilityLane", "privacySecurityLane"];
}

function discoveryFields() {
  return ["readmeFirstViewport", "docsIndexChineseDefault", "englishComplete", "apiReliabilityLinked", "communityReadinessLinked", "publicSamplesLinked", "roadmapLinked", "maturityHonest", "searchTermsCovered", "bilingualParity"];
}

function adoptionFields() {
  return ["supportedPaths", "limitations", "knownGaps", "verificationEvidence", "packageHash", "rollbackPlan", "feedbackIntake", "sampleRequests", "integrationReports", "providerRequests", "k12QualityReports", "publicationSideEffectsBlocked"];
}

function decisionFields() {
  return ["apiReliabilityFresh", "contributorReady", "triageReady", "discoveryReady", "adoptionReady", "deferredWorkReconciled", "goNoGoPacket", "releaseSideEffectsBlocked", "humanReviewRequired"];
}

function defaultContributorOnboarding() {
  return normalizeContributorOnboarding(Object.fromEntries(contributorFields().map((field) => [field, true])));
}

function defaultIssueTriageSupportOps() {
  return normalizeIssueTriageSupportOps({
    ...Object.fromEntries(triageFields().map((field) => [field, true])),
    templates: [...requiredTemplates],
    supportLanes: [...supportLanes]
  });
}

function defaultDiscoveryDocsQuality() {
  return normalizeDiscoveryDocsQuality(Object.fromEntries(discoveryFields().map((field) => [field, true])));
}

function defaultReleaseNotesAdoptionLoop() {
  return normalizeReleaseNotesAdoptionLoop(Object.fromEntries(adoptionFields().map((field) => [field, true])));
}

function defaultCommunityReleaseDecision() {
  return normalizeCommunityReleaseDecision({
    ...Object.fromEntries(decisionFields().map((field) => [field, true])),
    nextBlock: "1.0-final-publication-review"
  });
}

function fixtureApiReliabilityPacket() {
  return {
    ok: true,
    releaseStage: "1.0-api-reliability-hardening",
    releaseDecision: "human-review-required",
    releaseCandidate: { artifactHash: "b".repeat(64) },
    apiReliabilityEvaluation: { missing: [] }
  };
}

function summarizeApiReliabilityPacket(value = {}) {
  return {
    ok: value.ok === true,
    releaseStage: value.releaseStage || "",
    releaseDecision: value.releaseDecision || "human-review-required",
    artifactHash: value.releaseCandidate?.artifactHash || "",
    missing: value.apiReliabilityEvaluation?.missing || []
  };
}

function readText(projectRoot, relativePath) {
  const file = path.join(projectRoot, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function docsHaveAll(projectRoot, relativePath, phrases) {
  return includesAll(readText(projectRoot, relativePath), phrases);
}

function includesAll(text, phrases) {
  const lower = String(text || "").toLowerCase();
  return phrases.every((phrase) => lower.includes(String(phrase).toLowerCase()));
}

function includesAny(text, phrases) {
  const lower = String(text || "").toLowerCase();
  return phrases.some((phrase) => lower.includes(String(phrase).toLowerCase()));
}

function allTrue(value, fields) {
  return fields.every((field) => value[field] === true);
}

function gate(key, command, description) {
  return { key, command, description };
}

function evidenceSummary(value) {
  if (!value || typeof value !== "object") return "";
  return value.status || "provided";
}

function sanitizeForPublic(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeForPublic(item));
  if (value && typeof value === "object") {
    const result = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (/tempRoot|userDataRoot|sourceRoot|workspaceRoot|tarball|privatePath|localPath/i.test(entryKey)) continue;
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
    ? path.resolve(args[outIndex + 1] && !args[outIndex + 1].startsWith("--") ? args[outIndex + 1] : path.join("exports", "community-release-readiness-evidence.json"))
    : "";
  const packet = await runCommunityReleaseReadinessEvidence({ fixtures });
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
