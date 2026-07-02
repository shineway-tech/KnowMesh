import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  evaluateSearchableReleaseEvidence,
  searchableReleaseEvidenceChecklist
} from "./release-gate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseGateScript = path.join(projectRoot, "scripts", "release-gate.mjs");

test("Block L5 searchable release evidence blocks missing product-core proofs", () => {
  const keys = searchableReleaseEvidenceChecklist.map((item) => item.key);

  assert.deepEqual(keys, [
    "searchableReadiness",
    "incrementalUpdateProof",
    "vectorFallbackProof",
    "browserSearchWorkflow",
    "staleJsonAuthorityAudit",
    "packageAssetReview"
  ]);

  const partial = evaluateSearchableReleaseEvidence({
    ...baseReleaseEvidence(),
    ...publicBetaEvidence()
  });
  const complete = evaluateSearchableReleaseEvidence(completeSearchableEvidence());

  assert.equal(partial.releaseAllowed, false);
  assert.equal(partial.releaseStage, "0.2.0-searchable");
  assert.ok(partial.missing.includes("searchableReadiness"));
  assert.ok(partial.missing.includes("staleJsonAuthorityAudit"));
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.ok, true);
  assert.equal(complete.gates.find((item) => item.key === "browserSearchWorkflow")?.status, "pass");
});

test("Block L5 release evidence generator emits searchable milestone evidence and stale JSON authority audit", async () => {
  const { auditStaleJsonAuthority, generateReleaseEvidence, reviewReleaseAssets } = await import(pathToFileURL(path.join(projectRoot, "scripts", "generate-release-evidence.mjs")).href);

  const stale = auditStaleJsonAuthority([
    "workspace/workspace.json",
    "knowledge-bases/k12/setup.json",
    "artifacts/local-chunks.jsonl",
    "exports/k12/release-export.json"
  ]);
  const allowed = auditStaleJsonAuthority([
    "exports/k12/release-export.json",
    "artifacts/audit/review-report.json",
    "knowledge-bases/k12/oss-sidecar/vector-sidecar.json",
    "workspace/checkpoints/build-job.json"
  ]);
  const assetReview = reviewReleaseAssets([
    "README.md",
    "docs/release-operations.zh-CN.md",
    "assets/social/knowmesh-social-preview.png"
  ]);

  assert.equal(stale.ok, false);
  assert.ok(stale.rejected.some((item) => item.reason === "workspace-json-authority"));
  assert.ok(stale.rejected.some((item) => item.reason === "kb-json-authority"));
  assert.ok(stale.rejected.some((item) => item.reason === "jsonl-search-authority"));
  assert.equal(allowed.ok, true);
  assert.equal(assetReview.noGeneratedArtifacts, true);

  const generated = generateReleaseEvidence({
    localGates: baseLocalGates(),
    github: {
      githubCi: "pass",
      githubCodeql: "pass",
      githubScorecard: "pass"
    },
    browserSampleSmoke: {
      ok: true,
      evidence: {
        browserSampleFlow: { status: "pass", desktop: true, narrow: true, resetVerified: true },
        evidenceSearch: { status: "pass", desktop: true, narrow: true, maintenanceEvidence: true, evidenceLink: true }
      }
    },
    betaReleaseNotes: { supportedPaths: true, limitations: true, knownGaps: true },
    searchableReadiness: { catalogSearch: true, queryEvidence: true, citationReady: true, scopedApi: true },
    incrementalUpdateProof: { catalogDelta: true, targetedRerun: true, versionRollback: true },
    vectorFallbackProof: { sidecarContract: true, invalidVectorBlocked: true, catalogFallback: true },
    sourceAuditPaths: ["exports/k12/release-export.json", "artifacts/audit/review-report.json"],
    assetPaths: ["README.md", "docs/release-operations.zh-CN.md"]
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evaluation.releaseStage, "0.2.0-searchable");
  assert.equal(generated.evidence.searchableReadiness.status, "pass");
  assert.equal(generated.evidence.staleJsonAuthorityAudit.forbiddenMutableStatePaths, 0);
  assert.equal(evaluateSearchableReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block L5 release gate CLI can enforce searchable-stage evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-searchable-release-gate-"));
  const completePath = path.join(tempDir, "complete.json");
  const missingPath = path.join(tempDir, "missing.json");
  try {
    fs.writeFileSync(completePath, `${JSON.stringify(completeSearchableEvidence(), null, 2)}\n`, "utf8");
    fs.writeFileSync(missingPath, `${JSON.stringify({ ...baseReleaseEvidence(), ...publicBetaEvidence() }, null, 2)}\n`, "utf8");

    const blocked = spawnSync(process.execPath, [releaseGateScript, "--stage", "searchable", "--evidence", missingPath], { encoding: "utf8" });
    const allowed = spawnSync(process.execPath, [releaseGateScript, "--stage", "searchable", "--evidence", completePath], { encoding: "utf8" });

    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseStage": "0.2.0-searchable"/);
    assert.match(blocked.stdout, /searchableReadiness/);
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /"releaseAllowed": true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function baseLocalGates() {
  return {
    npmTest: { ok: true },
    releaseSmoke: { ok: true },
    artifactSmoke: { ok: true, package: { sha256: "b".repeat(64) } },
    packageBoundary: { ok: true },
    diffCheck: { ok: true }
  };
}

function baseReleaseEvidence() {
  return {
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "b".repeat(64) },
    packageBoundary: "pass",
    diffCheck: "pass",
    githubCi: "pass",
    githubCodeql: "pass",
    githubScorecard: "pass"
  };
}

function publicBetaEvidence() {
  return {
    browserSampleFlow: { status: "pass", desktop: true, narrow: true, resetVerified: true },
    betaReleaseNotes: { status: "pass", supportedPaths: true, limitations: true, knownGaps: true, npmPublication: "separate-decision" },
    releaseAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true }
  };
}

function searchableEvidence() {
  return {
    searchableReadiness: { status: "pass", catalogSearch: true, queryEvidence: true, citationReady: true, scopedApi: true },
    incrementalUpdateProof: { status: "pass", catalogDelta: true, targetedRerun: true, versionRollback: true },
    vectorFallbackProof: { status: "pass", sidecarContract: true, invalidVectorBlocked: true, catalogFallback: true },
    browserSearchWorkflow: { status: "pass", desktop: true, narrow: true, maintenanceEvidence: true, evidenceLink: true, resetVerified: true },
    staleJsonAuthorityAudit: { status: "pass", forbiddenMutableStatePaths: 0, rejected: [] },
    packageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true }
  };
}

function completeSearchableEvidence() {
  return {
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence()
  };
}
