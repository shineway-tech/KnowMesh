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

test("Block V exposes public-launch review and evidence commands", () => {
  const packageInfo = JSON.parse(read("package.json"));

  assert.equal(packageInfo.scripts["smoke:public-launch"], "node ./scripts/public-launch-evidence.mjs");
  assert.equal(packageInfo.scripts["generate:public-launch"], "node ./scripts/public-launch-evidence.mjs --out");
});

test("Block V evaluator requires every public launch adoption gate", async () => {
  const { evaluatePublicLaunchEvidence, publicLaunchChecklist } = await import("./public-launch-evidence.mjs");

  assert.deepEqual(publicLaunchChecklist.map((item) => item.key), [
    "publicSwitchDecision",
    "launchDiscoveryPolish",
    "externalFeedbackIntake",
    "firstContributorPath",
    "postLaunchStabilityReview"
  ]);

  const blocked = evaluatePublicLaunchEvidence({});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing, publicLaunchChecklist.map((item) => item.key));
});

test("Block V builds a public-safe launch packet from release-candidate evidence", async () => {
  const { buildPublicLaunchEvidence } = await import("./public-launch-evidence.mjs");
  const { buildReleaseCandidateEvidence } = await import("./release-candidate-evidence.mjs");

  const rcPacket = buildReleaseCandidateEvidence({
    releaseSmoke: { ok: true, kind: "knowmesh.releaseSmoke" },
    artifactSmoke: {
      ok: true,
      kind: "knowmesh.releaseArtifact",
      package: { sha256: "a".repeat(64), files: 10, size: 1024 }
    },
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

  const packet = buildPublicLaunchEvidence({
    releaseCandidatePacket: rcPacket,
    githubGateStatus: { ci: "pass", codeql: "pass", scorecard: "pass" },
    docsReview: "pass",
    feedbackReview: "pass",
    contributorReview: "pass",
    stabilityReview: "pass"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.releaseAllowed, false);
  assert.equal(packet.publicationDecision, "human-review-required");
  assert.deepEqual(packet.publicLaunchEvaluation.missing, []);
  assert.equal(packet.evidence.publicSwitchDecision.status, "pass");
  assert.equal(packet.evidence.externalFeedbackIntake.status, "pass");
  assert.equal(packet.evidence.firstContributorPath.status, "pass");
});

test("Block V public-launch CLI writes an evidence packet", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-v-"));
  const outFile = path.join(tempRoot, "public-launch.json");
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "public-launch-evidence.mjs"),
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
    assert.equal(packet.kind, "knowmesh.publicLaunchEvidence");
    assert.equal(packet.publicLaunchEvaluation.ok, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Block V docs and plan list every public launch round", () => {
  const plan = read("docs/superpowers/plans/2026-06-30-product-engineering-mainline.md");
  const docsIndex = read("docs/README.md");
  const docsIndexEn = read("docs/README.en.md");
  const launchZh = read("docs/public-launch.zh-CN.md");
  const launchEn = read("docs/public-launch.en.md");

  for (const round of ["Round V1", "Round V2", "Round V3", "Round V4", "Round V5", "Block W"]) {
    assert.match(plan, new RegExp(round));
  }

  for (const content of [docsIndex, docsIndexEn, launchZh, launchEn]) {
    assert.match(content, /Public Launch|公开发布/);
    assert.match(content, /human-review-required|人工审核|human review/i);
    assert.match(content, /feedback intake|反馈入口/i);
    assert.match(content, /first contributor|首次贡献者/i);
    assert.match(content, /post-launch stability|发布后稳定/i);
  }
});
