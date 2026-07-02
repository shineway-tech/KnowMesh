import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Block Y exposes community release readiness commands", () => {
  const packageInfo = JSON.parse(read("package.json"));

  assert.equal(packageInfo.scripts["smoke:community-release"], "node ./scripts/community-release-readiness-evidence.mjs");
  assert.equal(packageInfo.scripts["generate:community-release"], "node ./scripts/community-release-readiness-evidence.mjs --out");
});

test("Block Y evaluator requires every community release readiness gate", async () => {
  const { communityReleaseChecklist, evaluateCommunityReleaseReadiness } = await import("./community-release-readiness-evidence.mjs");

  assert.deepEqual(communityReleaseChecklist.map((item) => item.key), [
    "contributorOnboardingRehearsal",
    "issueTriageSupportOps",
    "discoveryDocsQuality",
    "releaseNotesAdoptionLoop",
    "communityReleaseReadinessDecision"
  ]);

  const blocked = evaluateCommunityReleaseReadiness({});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing, communityReleaseChecklist.map((item) => item.key));
});

test("Block Y contributor onboarding report covers docs-only and code paths", async () => {
  const { buildContributorOnboardingReport } = await import("./community-release-readiness-evidence.mjs");

  const report = buildContributorOnboardingReport({ projectRoot });

  assert.equal(report.status, "pass");
  assert.equal(report.docsOnlyPath, true);
  assert.equal(report.codePathPublicApiOnly, true);
  assert.equal(report.currentDesignAuthority, true);
  assert.equal(report.noJsonFirstShims, true);
  assert.equal(report.packageBoundaryVisible, true);
  assert.equal(report.privacyRulesVisible, true);
});

test("Block Y issue triage report maps public-safe templates to support lanes", async () => {
  const { buildIssueTriageSupportReport } = await import("./community-release-readiness-evidence.mjs");

  const report = buildIssueTriageSupportReport({ projectRoot });

  assert.equal(report.status, "pass");
  assert.deepEqual(report.templates.sort(), [
    "bug_report.yml",
    "docs.yml",
    "expert_request.yml",
    "feature_request.yml",
    "launch_feedback.yml",
    "provider_adapter.yml",
    "sample_request.yml"
  ]);
  assert.ok(report.supportLanes.includes("api-compatibility"));
  assert.ok(report.supportLanes.includes("privacy-security"));
  assert.equal(report.publicSafeReproduction, true);
  assert.equal(report.commandsMapped, true);
});

test("Block Y builds a human-review-only community release packet", async () => {
  const { buildCommunityReleaseReadinessEvidence } = await import("./community-release-readiness-evidence.mjs");

  const packet = await buildCommunityReleaseReadinessEvidence({
    contributorReview: "pass",
    triageReview: "pass",
    discoveryReview: "pass",
    adoptionReview: "pass",
    decisionReview: "pass"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.releaseAllowed, false);
  assert.equal(packet.releaseDecision, "human-review-required");
  assert.deepEqual(packet.communityReleaseEvaluation.missing, []);
  assert.equal(packet.evidence.communityReleaseReadinessDecision.nextBlock, "1.0-final-publication-review");
});

test("Block Y community release CLI writes an evidence packet", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-y-"));
  const outFile = path.join(tempRoot, "community-release.json");
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "community-release-readiness-evidence.mjs"),
      "--fixtures",
      "--out",
      outFile
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packet = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(packet.ok, true);
    assert.equal(packet.kind, "knowmesh.communityReleaseReadinessEvidence");
    assert.equal(packet.releaseDecision, "human-review-required");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Block Y docs and plan list community readiness gates and next Block Z rounds", () => {
  const plan = read("docs/superpowers/plans/2026-06-30-product-engineering-mainline.md");
  const docsIndex = read("docs/README.md");
  const docsIndexEn = read("docs/README.en.md");
  const communityZh = read("docs/community-release-readiness.zh-CN.md");
  const communityEn = read("docs/community-release-readiness.en.md");
  const releaseOpsZh = read("docs/release-operations.zh-CN.md");
  const releaseOpsEn = read("docs/release-operations.en.md");

  for (const marker of ["Round Y1", "Round Y2", "Round Y3", "Round Y4", "Round Y5", "Block Z", "Round Z1", "Round Z5"]) {
    assert.match(plan, new RegExp(marker));
  }

  for (const content of [docsIndex, docsIndexEn, communityZh, communityEn]) {
    assert.match(content, /Community Release Readiness|社区发布准备/i);
    assert.match(content, /contributor onboarding|贡献者/i);
    assert.match(content, /issue triage|triage|分流/i);
    assert.match(content, /adoption loop|adoption|采用/i);
    assert.match(content, /human-review-required|人工审核/i);
  }

  for (const content of [releaseOpsZh, releaseOpsEn]) {
    assert.match(content, /smoke:community-release/);
    assert.match(content, /generate:community-release/);
  }
});
