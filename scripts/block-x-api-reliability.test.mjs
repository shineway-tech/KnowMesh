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

test("Block X exposes 1.0 API reliability commands", () => {
  const packageInfo = JSON.parse(read("package.json"));

  assert.equal(packageInfo.scripts["smoke:api-reliability"], "node ./scripts/api-reliability-evidence.mjs");
  assert.equal(packageInfo.scripts["generate:api-reliability"], "node ./scripts/api-reliability-evidence.mjs --out");
});

test("Block X evaluator requires every API reliability gate", async () => {
  const { apiReliabilityChecklist, evaluateApiReliabilityEvidence } = await import("./api-reliability-evidence.mjs");

  assert.deepEqual(apiReliabilityChecklist.map((item) => item.key), [
    "publicApiCompatibilityHarness",
    "queryRuntimeReliabilityMatrix",
    "packageInstallerReliability",
    "privacySecurityRegression",
    "releaseCandidateReconciliation"
  ]);

  const blocked = evaluateApiReliabilityEvidence({});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing, apiReliabilityChecklist.map((item) => item.key));
});

test("Block X public API compatibility harness protects accepted shapes", async () => {
  const { buildPublicApiCompatibilityReport } = await import("./api-reliability-evidence.mjs");

  const report = await buildPublicApiCompatibilityReport({ projectRoot });

  assert.equal(report.status, "pass");
  assert.equal(report.contractVersion, "2026-07-query-runtime.1");
  assert.deepEqual(report.requiredEndpointKeys, [
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
  ]);
  assert.ok(report.responseStatuses.includes("blocked_by_quality"));
  assert.ok(report.openapiPaths.includes("/kb/{knowledgeBaseId}/api/query"));
  assert.equal(report.noInternalStateExposure, true);
  assert.deepEqual(report.drift, []);
});

test("Block X query reliability matrix covers user-visible status paths", async () => {
  const { buildQueryRuntimeReliabilityMatrix } = await import("./api-reliability-evidence.mjs");

  const matrix = await buildQueryRuntimeReliabilityMatrix({ projectRoot });

  assert.equal(matrix.status, "pass");
  assert.deepEqual(matrix.statusCases.map((item) => item.status), [
    "answered",
    "out_of_scope",
    "insufficient_evidence",
    "provider_unavailable",
    "blocked_by_quality",
    "feedback_maintenance"
  ]);
  assert.equal(matrix.statusCases.find((item) => item.status === "answered").requiresCitations, true);
  for (const item of matrix.statusCases.filter((entry) => entry.status !== "answered")) {
    assert.equal(item.citationFreeWhenUnreliable, true, item.status);
  }
  assert.equal(matrix.displaySerializationGuard, true);
});

test("Block X builds a human-review-only API reliability packet", async () => {
  const { buildApiReliabilityEvidence } = await import("./api-reliability-evidence.mjs");

  const packet = await buildApiReliabilityEvidence({
    publicApiCompatibilityReview: "pass",
    queryRuntimeReliabilityReview: "pass",
    packageInstallerReview: "pass",
    privacySecurityReview: "pass",
    reconciliationReview: "pass"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.releaseAllowed, false);
  assert.equal(packet.releaseDecision, "human-review-required");
  assert.deepEqual(packet.apiReliabilityEvaluation.missing, []);
  assert.equal(packet.evidence.releaseCandidateReconciliation.nextBlock, "1.0-community-release-readiness");
});

test("Block X API reliability CLI writes an evidence packet", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-x-"));
  const outFile = path.join(tempRoot, "api-reliability.json");
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "api-reliability-evidence.mjs"),
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
    assert.equal(packet.kind, "knowmesh.apiReliabilityEvidence");
    assert.equal(packet.releaseDecision, "human-review-required");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Block X docs and plan list reliability gates and next Block Y rounds", () => {
  const plan = read("docs/superpowers/plans/2026-06-30-product-engineering-mainline.md");
  const docsIndex = read("docs/README.md");
  const docsIndexEn = read("docs/README.en.md");
  const reliabilityZh = read("docs/api-reliability.zh-CN.md");
  const reliabilityEn = read("docs/api-reliability.en.md");
  const stabilityZh = read("docs/api-stability.zh-CN.md");
  const stabilityEn = read("docs/api-stability.en.md");

  for (const marker of ["Round X1", "Round X2", "Round X3", "Round X4", "Round X5", "Block Y", "Round Y1", "Round Y5"]) {
    assert.match(plan, new RegExp(marker));
  }

  for (const content of [docsIndex, docsIndexEn, reliabilityZh, reliabilityEn]) {
    assert.match(content, /1\.0 API Reliability|1\.0 API 可靠性/i);
    assert.match(content, /compatibility harness|兼容性/i);
    assert.match(content, /Query Runtime/i);
    assert.match(content, /privacy|隐私/i);
    assert.match(content, /human-review-required|人工审核/i);
  }

  for (const content of [stabilityZh, stabilityEn]) {
    assert.match(content, /public API compatibility|公共 API 兼容/i);
    assert.match(content, /status matrix|状态矩阵/i);
  }
});
