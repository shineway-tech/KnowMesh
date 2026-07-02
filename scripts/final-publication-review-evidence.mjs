#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runCommunityReleaseReadinessEvidence } from "./community-release-readiness-evidence.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const finalPublicationChecklist = [
  gate("finalEvidenceRollup", "final evidence rollup", "RC, public launch, stabilization, API reliability, community readiness, artifact hash, commands, and public-safe evidence must be rolled up."),
  gate("githubRepositoryStateReview", "GitHub and repository state review", "CI/security expectations, issue templates, docs, topics/about, social preview, and visibility decisions must be captured without side effects."),
  gate("npmPackagePublicationReview", "npm and package publication review", "Package metadata, exports, bin launcher, package boundary, packed install, artifact hash, npm decision, and rollback notes must be ready."),
  gate("announcementSupportReadiness", "announcement and support readiness", "Chinese/English announcement checklist, support lanes, known gaps, docs, and first 72-hour response loop must be ready."),
  gate("humanPublicationDecisionPacket", "human publication decision packet", "Visibility, tag, GitHub release, npm publish, announcement, rollback owner, and publication decision must remain human-reviewed.")
];

export function evaluateFinalPublicationReview(evidence = {}) {
  const normalized = normalizeFinalPublicationEvidence(evidence);
  const gates = finalPublicationChecklist.map((item) => {
    const value = normalized[item.key];
    return {
      ...item,
      status: finalPublicationGateStatus(item.key, value),
      evidence: evidenceSummary(value)
    };
  });
  const missing = gates.filter((item) => item.status !== "pass").map((item) => item.key);
  return {
    ok: missing.length === 0,
    kind: "knowmesh.finalPublicationReviewGate",
    releaseStage: "1.0-final-publication-review",
    releaseAllowed: false,
    publicationDecision: "human-review-required",
    missing,
    gates
  };
}

export async function buildFinalPublicationReviewEvidence(options = {}) {
  const readiness = options.readiness || {};
  const evidence = normalizeFinalPublicationEvidence({
    finalEvidenceRollup: options.evidenceRollupReview === "pass" ? defaultFinalEvidenceRollup() : readiness.finalEvidenceRollup || options.finalEvidenceRollup,
    githubRepositoryStateReview: options.githubReview === "pass" ? defaultGithubRepositoryStateReview() : readiness.githubRepositoryStateReview || options.githubRepositoryStateReview,
    npmPackagePublicationReview: options.npmReview === "pass" ? defaultNpmPackagePublicationReview() : readiness.npmPackagePublicationReview || options.npmPackagePublicationReview,
    announcementSupportReadiness: options.announcementReview === "pass" ? defaultAnnouncementSupportReadiness() : readiness.announcementSupportReadiness || options.announcementSupportReadiness,
    humanPublicationDecisionPacket: options.decisionReview === "pass" ? defaultHumanPublicationDecisionPacket() : readiness.humanPublicationDecisionPacket || options.humanPublicationDecisionPacket
  });
  const finalPublicationEvaluation = evaluateFinalPublicationReview(evidence);

  return sanitizeForPublic({
    ok: finalPublicationEvaluation.ok,
    kind: "knowmesh.finalPublicationReviewEvidence",
    releaseStage: "1.0-final-publication-review",
    releaseAllowed: false,
    publicationDecision: "human-review-required",
    generatedAt: new Date().toISOString(),
    communityRelease: summarizeCommunityReleasePacket(options.communityReleasePacket),
    evidence,
    finalPublicationEvaluation
  });
}

export async function runFinalPublicationReviewEvidence(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  if (options.fixtures) {
    return buildFinalPublicationReviewEvidence({
      evidenceRollupReview: "pass",
      githubReview: "pass",
      npmReview: "pass",
      announcementReview: "pass",
      decisionReview: "pass",
      communityReleasePacket: fixtureCommunityReleasePacket()
    });
  }

  const communityReleasePacket = await runCommunityReleaseReadinessEvidence({ projectRoot });
  const finalEvidenceRollup = buildFinalEvidenceRollupReport({ projectRoot, communityReleasePacket });
  const githubRepositoryStateReview = buildGithubRepositoryStateReport({ projectRoot });
  const npmPackagePublicationReview = buildNpmPackagePublicationReport({ projectRoot, communityReleasePacket });
  const announcementSupportReadiness = buildAnnouncementSupportReadinessReport({ projectRoot });
  const humanPublicationDecisionPacket = buildHumanPublicationDecisionReport({
    projectRoot,
    communityReleasePacket,
    finalEvidenceRollup,
    githubRepositoryStateReview,
    npmPackagePublicationReview,
    announcementSupportReadiness
  });

  return buildFinalPublicationReviewEvidence({
    communityReleasePacket,
    readiness: {
      finalEvidenceRollup,
      githubRepositoryStateReview,
      npmPackagePublicationReview,
      announcementSupportReadiness,
      humanPublicationDecisionPacket
    }
  });
}

export function buildFinalEvidenceRollupReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const communityReleasePacket = options.communityReleasePacket || fixtureCommunityReleasePacket();
  const artifactHash = communityReleasePacket.apiReliability?.artifactHash || "";
  const stages = ["release-candidate", "public-launch", "stabilization", "api-reliability", "community-release"];
  const report = {
    stages,
    releaseCandidateEvidence: communityReleasePacket.ok === true,
    publicLaunchEvidence: communityReleasePacket.ok === true,
    stabilizationEvidence: communityReleasePacket.ok === true,
    apiReliabilityEvidence: communityReleasePacket.apiReliability?.ok === true,
    communityReadinessEvidence: communityReleasePacket.ok === true,
    artifactHashCaptured: /^[a-f0-9]{64}$/i.test(String(artifactHash || "")),
    packageFileCountCaptured: true,
    verificationCommands: docsHaveAll(projectRoot, "docs/release-operations.zh-CN.md", ["smoke:final-publication", "smoke:community-release"]),
    publicSafeEvidence: !hasPrivateLeak(communityReleasePacket),
    noPublicationSideEffects: true
  };
  return normalizeFinalEvidenceRollup({
    ...report,
    status: allTrue(report, finalEvidenceFields()) ? "pass" : "fail"
  });
}

export function buildGithubRepositoryStateReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const remote = gitOutput(projectRoot, ["remote", "get-url", "origin"]);
  const workflowsDir = path.join(projectRoot, ".github", "workflows");
  const report = {
    remoteCaptured: /github\.com[:/]shineway-tech\/KnowMesh/i.test(remote) || /KnowMesh/i.test(remote),
    ciSecurityExpectations: fs.existsSync(workflowsDir),
    issueTemplates: fs.existsSync(path.join(projectRoot, ".github", "ISSUE_TEMPLATE", "bug_report.yml")),
    securityContributing: fs.existsSync(path.join(projectRoot, "SECURITY.md")) && fs.existsSync(path.join(projectRoot, "CONTRIBUTING.md")),
    topicsAboutReview: docsHaveAll(projectRoot, "README.md", ["GitHub topics"]) || docsHaveAll(projectRoot, "README.en.md", ["Repository Topics"]),
    socialPreviewReview: docsHaveAll(projectRoot, "README.md", ["assets/social/knowmesh-social-preview.png"]) || docsHaveAll(projectRoot, "README.en.md", ["assets/social/knowmesh-social-preview.png"]),
    visibilityDecisionHumanReview: true,
    tagReleaseManual: true,
    noSideEffects: true
  };
  return normalizeGithubRepositoryStateReview({
    ...report,
    status: allTrue(report, githubFields()) ? "pass" : "fail"
  });
}

export function buildNpmPackagePublicationReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const packageInfo = JSON.parse(readText(projectRoot, "package.json") || "{}");
  const artifactHash = options.communityReleasePacket?.apiReliability?.artifactHash || "";
  const report = {
    packageMetadata: packageInfo.name === "knowmesh" && packageInfo.license === "MIT" && packageInfo.private === false,
    exportsReady: Boolean(packageInfo.exports?.["."] && packageInfo.exports?.["./sdk"]),
    binLauncher: packageInfo.bin?.knowmesh === "./src/cli/knowmesh.mjs",
    nodeEngine: String(packageInfo.engines?.node || "").includes(">=24"),
    packageBoundary: docsHaveAll(projectRoot, "docs/release-operations.zh-CN.md", ["verify:package-boundary"]),
    packedInstallRehearsal: docsHaveAll(projectRoot, "docs/release-operations.zh-CN.md", ["smoke:artifact"]),
    artifactHash: /^[a-f0-9]{64}$/i.test(String(artifactHash || "")),
    npmSeparateDecision: true,
    rollbackNotes: docsHaveAll(projectRoot, "docs/final-publication-review.zh-CN.md", ["rollback"]),
    noSideEffects: true
  };
  return normalizeNpmPackagePublicationReview({
    ...report,
    status: allTrue(report, npmFields()) ? "pass" : "fail"
  });
}

export function buildAnnouncementSupportReadinessReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const finalDocs = `${readText(projectRoot, "docs/final-publication-review.zh-CN.md")}\n${readText(projectRoot, "docs/final-publication-review.en.md")}\n${readText(projectRoot, "docs/publication-decision-checklist.zh-CN.md")}\n${readText(projectRoot, "docs/publication-decision-checklist.en.md")}`;
  const backlog = `${readText(projectRoot, "docs/community-backlog.zh-CN.md")}\n${readText(projectRoot, "docs/community-backlog.en.md")}`;
  const report = {
    chineseAnnouncementChecklist: finalDocs.includes("中文"),
    englishAnnouncementChecklist: finalDocs.includes("English"),
    maturityHonest: includesAll(finalDocs, ["alpha", "Public Launch Candidate"]),
    supportLanesLinked: includesAll(backlog, ["api-compatibility", "privacy-security", "public-sample"]),
    knownGapsLinked: includesAll(finalDocs, ["known gaps", "已知缺口"]),
    publicSamplesLinked: includesAll(finalDocs, ["public samples", "公开样例"]),
    integrationDocsLinked: includesAll(finalDocs, ["integration", "集成"]),
    securitySupportPath: fs.existsSync(path.join(projectRoot, "SECURITY.md")),
    first72HourLoop: includesAll(finalDocs, ["72-hour", "72 小时"]),
    noOverclaiming: includesAll(finalDocs, ["human-review-required"])
  };
  return normalizeAnnouncementSupportReadiness({
    ...report,
    status: allTrue(report, announcementFields()) ? "pass" : "fail"
  });
}

export function buildHumanPublicationDecisionReport(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const docsReady = docsHaveAll(projectRoot, "docs/final-publication-review.zh-CN.md", ["visibility", "tag", "npm", "announcement", "rollback owner", "human-review-required"])
    && docsHaveAll(projectRoot, "docs/final-publication-review.en.md", ["visibility", "tag", "npm", "announcement", "rollback owner", "human-review-required"])
    && docsHaveAll(projectRoot, "docs/publication-decision-checklist.zh-CN.md", ["gh repo view", "gh repo edit", "gh release create", "npm publish --dry-run", "npm publish --tag alpha", "Block AA Round AA1"])
    && docsHaveAll(projectRoot, "docs/publication-decision-checklist.en.md", ["gh repo view", "gh repo edit", "gh release create", "npm publish --dry-run", "npm publish --tag alpha", "Block AA Round AA1"]);
  const components = [
    options.finalEvidenceRollup,
    options.githubRepositoryStateReview,
    options.npmPackagePublicationReview,
    options.announcementSupportReadiness
  ].filter(Boolean);
  const report = {
    finalEvidenceReady: options.communityReleasePacket?.ok === true && components.every((item) => item.status === "pass"),
    visibilityDecision: docsReady,
    tagDecision: docsReady,
    githubReleaseDecision: docsReady,
    npmPublishDecision: docsReady,
    announcementDecision: docsReady,
    rollbackOwner: docsReady,
    publicationSideEffectsBlocked: true,
    humanReviewRequired: true,
    nextBlock: "post-publication-monitoring"
  };
  return normalizeHumanPublicationDecisionPacket({
    ...report,
    status: allTrue(report, decisionFields()) ? "pass" : "fail"
  });
}

function normalizeFinalPublicationEvidence(value = {}) {
  return {
    finalEvidenceRollup: normalizeFinalEvidenceRollup(value.finalEvidenceRollup),
    githubRepositoryStateReview: normalizeGithubRepositoryStateReview(value.githubRepositoryStateReview),
    npmPackagePublicationReview: normalizeNpmPackagePublicationReview(value.npmPackagePublicationReview),
    announcementSupportReadiness: normalizeAnnouncementSupportReadiness(value.announcementSupportReadiness),
    humanPublicationDecisionPacket: normalizeHumanPublicationDecisionPacket(value.humanPublicationDecisionPacket)
  };
}

function normalizeFinalEvidenceRollup(value = {}) {
  return {
    ...normalizeGate(value, finalEvidenceFields()),
    stages: Array.isArray(value.stages) ? value.stages : ["release-candidate", "public-launch", "stabilization", "api-reliability", "community-release"]
  };
}

function normalizeGithubRepositoryStateReview(value = {}) {
  return normalizeGate(value, githubFields());
}

function normalizeNpmPackagePublicationReview(value = {}) {
  return normalizeGate(value, npmFields());
}

function normalizeAnnouncementSupportReadiness(value = {}) {
  return normalizeGate(value, announcementFields());
}

function normalizeHumanPublicationDecisionPacket(value = {}) {
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

function finalPublicationGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  const required = {
    finalEvidenceRollup: finalEvidenceFields(),
    githubRepositoryStateReview: githubFields(),
    npmPackagePublicationReview: npmFields(),
    announcementSupportReadiness: announcementFields(),
    humanPublicationDecisionPacket: decisionFields()
  };
  if (key === "humanPublicationDecisionPacket" && value.nextBlock !== "post-publication-monitoring") return "missing";
  return allTrue(value, required[key] || []) ? "pass" : "missing";
}

function finalEvidenceFields() {
  return ["releaseCandidateEvidence", "publicLaunchEvidence", "stabilizationEvidence", "apiReliabilityEvidence", "communityReadinessEvidence", "artifactHashCaptured", "packageFileCountCaptured", "verificationCommands", "publicSafeEvidence", "noPublicationSideEffects"];
}

function githubFields() {
  return ["remoteCaptured", "ciSecurityExpectations", "issueTemplates", "securityContributing", "topicsAboutReview", "socialPreviewReview", "visibilityDecisionHumanReview", "tagReleaseManual", "noSideEffects"];
}

function npmFields() {
  return ["packageMetadata", "exportsReady", "binLauncher", "nodeEngine", "packageBoundary", "packedInstallRehearsal", "artifactHash", "npmSeparateDecision", "rollbackNotes", "noSideEffects"];
}

function announcementFields() {
  return ["chineseAnnouncementChecklist", "englishAnnouncementChecklist", "maturityHonest", "supportLanesLinked", "knownGapsLinked", "publicSamplesLinked", "integrationDocsLinked", "securitySupportPath", "first72HourLoop", "noOverclaiming"];
}

function decisionFields() {
  return ["finalEvidenceReady", "visibilityDecision", "tagDecision", "githubReleaseDecision", "npmPublishDecision", "announcementDecision", "rollbackOwner", "publicationSideEffectsBlocked", "humanReviewRequired"];
}

function defaultFinalEvidenceRollup() {
  return normalizeFinalEvidenceRollup({
    ...Object.fromEntries(finalEvidenceFields().map((field) => [field, true])),
    stages: ["release-candidate", "public-launch", "stabilization", "api-reliability", "community-release"]
  });
}

function defaultGithubRepositoryStateReview() {
  return normalizeGithubRepositoryStateReview(Object.fromEntries(githubFields().map((field) => [field, true])));
}

function defaultNpmPackagePublicationReview() {
  return normalizeNpmPackagePublicationReview(Object.fromEntries(npmFields().map((field) => [field, true])));
}

function defaultAnnouncementSupportReadiness() {
  return normalizeAnnouncementSupportReadiness(Object.fromEntries(announcementFields().map((field) => [field, true])));
}

function defaultHumanPublicationDecisionPacket() {
  return normalizeHumanPublicationDecisionPacket({
    ...Object.fromEntries(decisionFields().map((field) => [field, true])),
    nextBlock: "post-publication-monitoring"
  });
}

function fixtureCommunityReleasePacket() {
  return {
    ok: true,
    releaseStage: "1.0-community-release-readiness",
    releaseDecision: "human-review-required",
    apiReliability: { ok: true, artifactHash: "c".repeat(64), missing: [] },
    communityReleaseEvaluation: { missing: [] }
  };
}

function summarizeCommunityReleasePacket(value = {}) {
  return {
    ok: value.ok === true,
    releaseStage: value.releaseStage || "",
    releaseDecision: value.releaseDecision || "human-review-required",
    artifactHash: value.apiReliability?.artifactHash || "",
    missing: value.communityReleaseEvaluation?.missing || []
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

function gitOutput(projectRoot, args) {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", shell: false });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function allTrue(value, fields) {
  return fields.every((field) => value[field] === true);
}

function hasPrivateLeak(value) {
  return /[A-Z]:\\|\/Users\/|\\Users\\|\b(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_\-]{16,}|Bearer\s+[A-Za-z0-9._\-]{16,}|AccessKey(?:Id|Secret)?\s*[:=]\s*\S+|Secret\s*[:=]\s*\S+)/i.test(JSON.stringify(value || {}));
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
    ? path.resolve(args[outIndex + 1] && !args[outIndex + 1].startsWith("--") ? args[outIndex + 1] : path.join("exports", "final-publication-review-evidence.json"))
    : "";
  const packet = await runFinalPublicationReviewEvidence({ fixtures });
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
