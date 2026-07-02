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

test("Block W exposes stabilization review and evidence commands", () => {
  const packageInfo = JSON.parse(read("package.json"));

  assert.equal(packageInfo.scripts["smoke:stabilization"], "node ./scripts/stabilization-evidence.mjs");
  assert.equal(packageInfo.scripts["generate:stabilization"], "node ./scripts/stabilization-evidence.mjs --out");
});

test("Block W evaluator requires every 1.0 stabilization gate", async () => {
  const { evaluateStabilizationEvidence, stabilizationChecklist } = await import("./stabilization-evidence.mjs");

  assert.deepEqual(stabilizationChecklist.map((item) => item.key), [
    "launchFeedbackTriage",
    "publicApiStabilityLock",
    "docsSamplesHardening",
    "reliabilityPrivacyRegression",
    "stabilizationDecision"
  ]);

  const blocked = evaluateStabilizationEvidence({});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing, stabilizationChecklist.map((item) => item.key));
});

test("Block W builds a public-safe stabilization packet from public-launch evidence", async () => {
  const { buildStabilizationEvidence } = await import("./stabilization-evidence.mjs");
  const { buildPublicLaunchEvidence } = await import("./public-launch-evidence.mjs");

  const publicLaunchPacket = buildPublicLaunchEvidence({
    githubGateStatus: { ci: "pass", codeql: "pass", scorecard: "pass" },
    docsReview: "pass",
    feedbackReview: "pass",
    contributorReview: "pass",
    stabilityReview: "pass"
  });

  const packet = buildStabilizationEvidence({
    publicLaunchPacket,
    triageReview: "pass",
    apiStabilityReview: "pass",
    docsSamplesReview: "pass",
    reliabilityPrivacyReview: "pass",
    stabilizationDecisionReview: "pass"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.releaseAllowed, false);
  assert.equal(packet.stabilizationDecision, "human-review-required");
  assert.deepEqual(packet.stabilizationEvaluation.missing, []);
  assert.equal(packet.evidence.launchFeedbackTriage.status, "pass");
  assert.equal(packet.evidence.publicApiStabilityLock.status, "pass");
  assert.equal(packet.evidence.stabilizationDecision.nextBlock, "1.0-api-reliability-hardening");
});

test("Block W stabilization CLI writes an evidence packet", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-w-"));
  const outFile = path.join(tempRoot, "stabilization.json");
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "stabilization-evidence.mjs"),
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
    assert.equal(packet.kind, "knowmesh.stabilizationEvidence");
    assert.equal(packet.stabilizationEvaluation.ok, true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Block W docs and plan list stabilization gates and next Block X rounds", () => {
  const plan = read("docs/superpowers/plans/2026-06-30-product-engineering-mainline.md");
  const docsIndex = read("docs/README.md");
  const docsIndexEn = read("docs/README.en.md");
  const stabilizationZh = read("docs/stabilization.zh-CN.md");
  const stabilizationEn = read("docs/stabilization.en.md");
  const apiZh = read("docs/api-stability.zh-CN.md");
  const apiEn = read("docs/api-stability.en.md");

  for (const round of ["Round W1", "Round W2", "Round W3", "Round W4", "Round W5", "Block X", "Round X1", "Round X5"]) {
    assert.match(plan, new RegExp(round));
  }

  for (const content of [docsIndex, docsIndexEn, stabilizationZh, stabilizationEn]) {
    assert.match(content, /1\.0 Stabilization|1\.0 稳定化/i);
    assert.match(content, /feedback triage|反馈分流/i);
    assert.match(content, /public API stability|公共 API 稳定/i);
    assert.match(content, /reliability.*privacy|可靠性.*隐私/i);
    assert.match(content, /human-review-required|人工审核/i);
  }

  for (const content of [apiZh, apiEn]) {
    assert.match(content, /Query Runtime/);
    assert.match(content, /OpenAPI/);
    assert.match(content, /SDK/);
    assert.match(content, /breaking change|破坏性变更/i);
    assert.match(content, /migration plan|迁移计划/i);
  }
});
