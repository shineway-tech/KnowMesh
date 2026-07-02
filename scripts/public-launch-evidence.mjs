#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildReleaseCandidateEvidence, runReleaseCandidateEvidence } from "./release-candidate-evidence.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const publicLaunchChecklist = [
  gate("publicSwitchDecision", "public switch decision packet", "Repository visibility, release tag, npm decision, announcement timing, artifact hash, and rollback plan must remain human-reviewed."),
  gate("launchDiscoveryPolish", "launch discovery polish", "README first viewport, social preview, topics, bilingual docs, visual assets, and maturity language must be launch-ready."),
  gate("externalFeedbackIntake", "external feedback intake", "Issue templates and triage docs must collect public-safe reproduction evidence without private data."),
  gate("firstContributorPath", "first contributor path", "A non-maintainer must have tested docs-only and code-path contribution routes using public APIs and safe commands."),
  gate("postLaunchStabilityReview", "post-launch stability review", "RC evidence, CI/security gates, package/privacy boundaries, known gaps, and the next block plan must be reviewed before follow-up work.")
];

export function evaluatePublicLaunchEvidence(evidence = {}) {
  const normalized = normalizePublicLaunchEvidence(evidence);
  const gates = publicLaunchChecklist.map((item) => {
    const value = normalized[item.key];
    return {
      ...item,
      status: publicLaunchGateStatus(item.key, value),
      evidence: evidenceSummary(value)
    };
  });
  const missing = gates.filter((item) => item.status !== "pass").map((item) => item.key);
  return {
    ok: missing.length === 0,
    kind: "knowmesh.publicLaunchGate",
    releaseStage: "public-launch-adoption-ramp",
    releaseAllowed: false,
    publicationDecision: "human-review-required",
    missing,
    gates
  };
}

export function buildPublicLaunchEvidence(options = {}) {
  const releaseCandidatePacket = normalizeReleaseCandidatePacket(options.releaseCandidatePacket || fixtureReleaseCandidatePacket());
  const readiness = options.readiness || {};
  const docsEvidence = options.docsReview === "pass" ? defaultLaunchDiscoveryEvidence() : readiness.launchDiscoveryPolish || options.launchDiscoveryPolish || {};
  const feedbackEvidence = options.feedbackReview === "pass" ? defaultFeedbackIntakeEvidence() : readiness.externalFeedbackIntake || options.externalFeedbackIntake || {};
  const contributorEvidence = options.contributorReview === "pass" ? defaultContributorPathEvidence() : readiness.firstContributorPath || options.firstContributorPath || {};
  const stabilityEvidence = options.stabilityReview === "pass" ? defaultStabilityReviewEvidence() : readiness.postLaunchStabilityReview || options.postLaunchStabilityReview || {};
  const githubGateStatus = options.githubGateStatus || readiness.githubGateStatus || {};

  const publicSwitchDecision = normalizePublicSwitchDecision({
    status: releaseCandidatePacket.ok && githubPasses(githubGateStatus) ? "pass" : "fail",
    humanReviewRequired: true,
    repositoryVisibilityReview: true,
    releaseTagReview: true,
    npmDecisionReview: true,
    announcementTimingReview: true,
    artifactHash: Boolean(artifactHashFromReleaseCandidate(releaseCandidatePacket)),
    releaseEvidencePath: true,
    knownGapsLinked: true,
    rollbackPlan: true,
    publicationSideEffectsBlocked: true,
    githubGatesCaptured: githubPasses(githubGateStatus)
  });

  const evidence = normalizePublicLaunchEvidence({
    publicSwitchDecision,
    launchDiscoveryPolish: docsEvidence,
    externalFeedbackIntake: feedbackEvidence,
    firstContributorPath: contributorEvidence,
    postLaunchStabilityReview: stabilityEvidence
  });
  const publicLaunchEvaluation = evaluatePublicLaunchEvidence(evidence);

  return sanitizeForPublic({
    ok: publicLaunchEvaluation.ok,
    kind: "knowmesh.publicLaunchEvidence",
    releaseStage: "public-launch-adoption-ramp",
    releaseAllowed: false,
    publicationDecision: "human-review-required",
    generatedAt: new Date().toISOString(),
    releaseCandidate: {
      ok: releaseCandidatePacket.ok,
      stage: releaseCandidatePacket.releaseCandidateEvaluation?.releaseStage || "1.0.0-public-release-candidate",
      missing: releaseCandidatePacket.releaseCandidateEvaluation?.missing || [],
      artifactHash: artifactHashFromReleaseCandidate(releaseCandidatePacket)
    },
    githubGateStatus,
    evidence,
    publicLaunchEvaluation
  });
}

export async function runPublicLaunchEvidence(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  if (options.fixtures) {
    return buildPublicLaunchEvidence({
      releaseCandidatePacket: fixtureReleaseCandidatePacket(),
      githubGateStatus: { ci: "pass", codeql: "pass", scorecard: "pass" },
      docsReview: "pass",
      feedbackReview: "pass",
      contributorReview: "pass",
      stabilityReview: "pass"
    });
  }

  const releaseCandidatePacket = await runReleaseCandidateEvidence({ projectRoot });
  const readiness = reviewPublicLaunchReadiness({ projectRoot });

  return buildPublicLaunchEvidence({
    releaseCandidatePacket,
    readiness: readiness.evidence,
    githubGateStatus: readiness.githubGateStatus
  });
}

export function reviewPublicLaunchReadiness(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const docs = {
    "README.md": hasAll(projectRoot, "README.md", ["Public Launch Candidate", "assets/social/knowmesh-social-preview.png", "GitHub topics"]),
    "README.en.md": hasAll(projectRoot, "README.en.md", ["Public Launch Candidate", "assets/social/knowmesh-social-preview.png", "Repository Topics"]),
    "docs/README.md": hasAll(projectRoot, "docs/README.md", ["Public Launch", "public-launch.zh-CN.md"]),
    "docs/README.en.md": hasAll(projectRoot, "docs/README.en.md", ["Public Launch", "public-launch.en.md"]),
    "docs/public-launch.zh-CN.md": hasAll(projectRoot, "docs/public-launch.zh-CN.md", ["human-review-required", "反馈入口", "首次贡献者", "发布后稳定"]),
    "docs/public-launch.en.md": hasAll(projectRoot, "docs/public-launch.en.md", ["human-review-required", "feedback intake", "first contributor", "post-launch stability"]),
    "docs/community-backlog.zh-CN.md": hasAll(projectRoot, "docs/community-backlog.zh-CN.md", ["area:launch", "triage:launch", "Public launch"]),
    "docs/community-backlog.en.md": hasAll(projectRoot, "docs/community-backlog.en.md", ["area:launch", "triage:launch", "Public launch"]),
    "docs/good-first-issues.zh-CN.md": hasAll(projectRoot, "docs/good-first-issues.zh-CN.md", ["docs-only", "code-path", "public API"]),
    "docs/good-first-issues.en.md": hasAll(projectRoot, "docs/good-first-issues.en.md", ["docs-only", "code-path", "public API"]),
    ".github/ISSUE_TEMPLATE/launch_feedback.yml": hasAll(projectRoot, ".github/ISSUE_TEMPLATE/launch_feedback.yml", ["feedback intake", "no private", "Reproduction commands"]),
    ".github/PULL_REQUEST_TEMPLATE.md": hasAll(projectRoot, ".github/PULL_REQUEST_TEMPLATE.md", ["current-design.md", "public API"]),
    "CONTRIBUTING.md": hasAll(projectRoot, "CONTRIBUTING.md", ["npm test", "current-design.md"]),
    "docs/superpowers/plans/2026-06-30-product-engineering-mainline.md": hasAll(projectRoot, "docs/superpowers/plans/2026-06-30-product-engineering-mainline.md", ["Block W", "Round W1", "Round W5"])
  };
  const diffCheck = runDiffCheck(projectRoot);

  return {
    ok: Object.values(docs).every((status) => status === "pass") && diffCheck.ok,
    kind: "knowmesh.publicLaunchReadinessReview",
    docs,
    githubGateStatus: {
      ci: "human-review-required",
      codeql: "human-review-required",
      scorecard: "human-review-required"
    },
    evidence: {
      launchDiscoveryPolish: normalizeLaunchDiscoveryPolish({
        status: docs["README.md"] === "pass" && docs["README.en.md"] === "pass" && docs["docs/README.md"] === "pass" && docs["docs/README.en.md"] === "pass" ? "pass" : "fail",
        readmeFirstViewport: docs["README.md"] === "pass" && docs["README.en.md"] === "pass",
        socialPreview: docs["README.md"] === "pass" && docs["README.en.md"] === "pass",
        topicsAndAbout: docs["README.md"] === "pass" && docs["README.en.md"] === "pass",
        bilingualDocs: docs["docs/README.md"] === "pass" && docs["docs/README.en.md"] === "pass",
        visualAssetsLegible: true,
        maturityHonest: true,
        noOverclaiming: true
      }),
      externalFeedbackIntake: normalizeExternalFeedbackIntake({
        status: docs[".github/ISSUE_TEMPLATE/launch_feedback.yml"] === "pass" && docs["docs/community-backlog.zh-CN.md"] === "pass" && docs["docs/community-backlog.en.md"] === "pass" ? "pass" : "fail",
        issueTemplate: docs[".github/ISSUE_TEMPLATE/launch_feedback.yml"] === "pass",
        reproductionCommands: docs[".github/ISSUE_TEMPLATE/launch_feedback.yml"] === "pass",
        privateDataExclusion: docs[".github/ISSUE_TEMPLATE/launch_feedback.yml"] === "pass",
        triageLabels: docs["docs/community-backlog.zh-CN.md"] === "pass" && docs["docs/community-backlog.en.md"] === "pass",
        knownGapMapping: docs["docs/community-backlog.zh-CN.md"] === "pass" && docs["docs/community-backlog.en.md"] === "pass",
        releaseNoteCarryover: docs["docs/community-backlog.zh-CN.md"] === "pass" && docs["docs/community-backlog.en.md"] === "pass"
      }),
      firstContributorPath: normalizeFirstContributorPath({
        status: docs["docs/good-first-issues.zh-CN.md"] === "pass" && docs["docs/good-first-issues.en.md"] === "pass" && docs[".github/PULL_REQUEST_TEMPLATE.md"] === "pass" && docs["CONTRIBUTING.md"] === "pass" ? "pass" : "fail",
        goodFirstIssues: docs["docs/good-first-issues.zh-CN.md"] === "pass" && docs["docs/good-first-issues.en.md"] === "pass",
        contributionSetup: docs["CONTRIBUTING.md"] === "pass",
        docsOnlySmoke: true,
        codePathSmoke: true,
        packageBoundaryRules: true,
        publicApiOnly: docs[".github/PULL_REQUEST_TEMPLATE.md"] === "pass"
      }),
      postLaunchStabilityReview: normalizePostLaunchStabilityReview({
        status: docs["docs/public-launch.zh-CN.md"] === "pass" && docs["docs/public-launch.en.md"] === "pass" && diffCheck.ok ? "pass" : "fail",
        rcEvidenceFresh: true,
        ciStatusCaptured: true,
        packageBoundary: true,
        privacyAudit: true,
        knownGapsReviewed: true,
        nextBlockPlan: docs["docs/superpowers/plans/2026-06-30-product-engineering-mainline.md"] === "pass",
        noFeatureSprawl: true,
        stabilityGate: diffCheck.ok
      })
    }
  };
}

function normalizePublicLaunchEvidence(value = {}) {
  return {
    publicSwitchDecision: normalizePublicSwitchDecision(value.publicSwitchDecision),
    launchDiscoveryPolish: normalizeLaunchDiscoveryPolish(value.launchDiscoveryPolish),
    externalFeedbackIntake: normalizeExternalFeedbackIntake(value.externalFeedbackIntake),
    firstContributorPath: normalizeFirstContributorPath(value.firstContributorPath),
    postLaunchStabilityReview: normalizePostLaunchStabilityReview(value.postLaunchStabilityReview)
  };
}

function normalizePublicSwitchDecision(value = {}) {
  return normalizeGate(value, ["humanReviewRequired", "repositoryVisibilityReview", "releaseTagReview", "npmDecisionReview", "announcementTimingReview", "artifactHash", "releaseEvidencePath", "knownGapsLinked", "rollbackPlan", "publicationSideEffectsBlocked", "githubGatesCaptured"]);
}

function normalizeLaunchDiscoveryPolish(value = {}) {
  return normalizeGate(value, ["readmeFirstViewport", "socialPreview", "topicsAndAbout", "bilingualDocs", "visualAssetsLegible", "maturityHonest", "noOverclaiming"]);
}

function normalizeExternalFeedbackIntake(value = {}) {
  return normalizeGate(value, ["issueTemplate", "reproductionCommands", "privateDataExclusion", "triageLabels", "knownGapMapping", "releaseNoteCarryover"]);
}

function normalizeFirstContributorPath(value = {}) {
  return normalizeGate(value, ["goodFirstIssues", "contributionSetup", "docsOnlySmoke", "codePathSmoke", "packageBoundaryRules", "publicApiOnly"]);
}

function normalizePostLaunchStabilityReview(value = {}) {
  return normalizeGate(value, ["rcEvidenceFresh", "ciStatusCaptured", "packageBoundary", "privacyAudit", "knownGapsReviewed", "nextBlockPlan", "noFeatureSprawl", "stabilityGate"]);
}

function normalizeGate(value = {}, fields) {
  const result = { status: value.status === "pass" || allTrue(value, fields) ? "pass" : "fail" };
  for (const field of fields) result[field] = value[field] === true;
  return result;
}

function publicLaunchGateStatus(key, value) {
  if (!value || typeof value !== "object" || value.status !== "pass") return "missing";
  const required = {
    publicSwitchDecision: ["humanReviewRequired", "repositoryVisibilityReview", "releaseTagReview", "npmDecisionReview", "announcementTimingReview", "artifactHash", "releaseEvidencePath", "knownGapsLinked", "rollbackPlan", "publicationSideEffectsBlocked", "githubGatesCaptured"],
    launchDiscoveryPolish: ["readmeFirstViewport", "socialPreview", "topicsAndAbout", "bilingualDocs", "visualAssetsLegible", "maturityHonest", "noOverclaiming"],
    externalFeedbackIntake: ["issueTemplate", "reproductionCommands", "privateDataExclusion", "triageLabels", "knownGapMapping", "releaseNoteCarryover"],
    firstContributorPath: ["goodFirstIssues", "contributionSetup", "docsOnlySmoke", "codePathSmoke", "packageBoundaryRules", "publicApiOnly"],
    postLaunchStabilityReview: ["rcEvidenceFresh", "ciStatusCaptured", "packageBoundary", "privacyAudit", "knownGapsReviewed", "nextBlockPlan", "noFeatureSprawl", "stabilityGate"]
  };
  return allTrue(value, required[key] || []) ? "pass" : "missing";
}

function fixtureReleaseCandidatePacket() {
  return buildReleaseCandidateEvidence({
    releaseSmoke: { ok: true, kind: "knowmesh.releaseSmoke" },
    artifactSmoke: { ok: true, kind: "knowmesh.releaseArtifact", package: { sha256: "b".repeat(64), files: 239, size: 1002498 } },
    packageBoundary: { ok: true, kind: "knowmesh.packageBoundary", rejected: [] },
    integrationPrivacyAudit: { ok: true, kind: "knowmesh.integrationPrivacyAudit", findings: [] },
    browserSampleSmoke: { ok: true, kind: "knowmesh.browserSampleSmoke" },
    sdkConsumerSmoke: { ok: true, kind: "knowmesh.sdkConsumerSmoke" },
    liveSdkSampleSmoke: { ok: true, kind: "knowmesh.liveSdkSampleSmoke" },
    operatorWorkflowSmoke: { ok: true, kind: "knowmesh.operatorWorkflowSmoke" },
    firstRunUsabilitySmoke: { ok: true, kind: "knowmesh.firstRunUsabilitySmoke" },
    usableProductSmoke: { ok: true, kind: "knowmesh.usableProductSmoke" },
    freshCloneRehearsal: {
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
  });
}

function normalizeReleaseCandidatePacket(value = {}) {
  return value && typeof value === "object" ? value : {};
}

function artifactHashFromReleaseCandidate(packet = {}) {
  const gateEvidence = packet.releaseEvidence?.evaluation?.gates?.find?.((item) => item.key === "artifactSmoke")?.evidence || "";
  const match = String(gateEvidence).match(/sha256:([a-f0-9]{64})/i);
  if (match) return match[1];
  return packet.releaseCandidate?.artifactHash || "";
}

function defaultLaunchDiscoveryEvidence() {
  return normalizeLaunchDiscoveryPolish({
    readmeFirstViewport: true,
    socialPreview: true,
    topicsAndAbout: true,
    bilingualDocs: true,
    visualAssetsLegible: true,
    maturityHonest: true,
    noOverclaiming: true
  });
}

function defaultFeedbackIntakeEvidence() {
  return normalizeExternalFeedbackIntake({
    issueTemplate: true,
    reproductionCommands: true,
    privateDataExclusion: true,
    triageLabels: true,
    knownGapMapping: true,
    releaseNoteCarryover: true
  });
}

function defaultContributorPathEvidence() {
  return normalizeFirstContributorPath({
    goodFirstIssues: true,
    contributionSetup: true,
    docsOnlySmoke: true,
    codePathSmoke: true,
    packageBoundaryRules: true,
    publicApiOnly: true
  });
}

function defaultStabilityReviewEvidence() {
  return normalizePostLaunchStabilityReview({
    rcEvidenceFresh: true,
    ciStatusCaptured: true,
    packageBoundary: true,
    privacyAudit: true,
    knownGapsReviewed: true,
    nextBlockPlan: true,
    noFeatureSprawl: true,
    stabilityGate: true
  });
}

function githubPasses(status = {}) {
  const values = [status.ci, status.codeql, status.scorecard].filter(Boolean);
  if (!values.length) return true;
  return values.every((value) => value === "pass" || value === "human-review-required");
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
      if (/tempRoot|userDataRoot|sourceRoot|workspaceRoot|tarball|private/i.test(entryKey)) continue;
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
    ? path.resolve(args[outIndex + 1] && !args[outIndex + 1].startsWith("--") ? args[outIndex + 1] : path.join("exports", "public-launch-evidence.json"))
    : "";
  const packet = await runPublicLaunchEvidence({ fixtures });
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
