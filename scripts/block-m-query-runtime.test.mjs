import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  evaluateQueryRuntimeReleaseEvidence,
  queryRuntimeReleaseEvidenceChecklist
} from "./release-gate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseGateScript = path.join(projectRoot, "scripts", "release-gate.mjs");

test("Block M5 query runtime release evidence requires evidence-first runtime proofs", () => {
  assert.deepEqual(queryRuntimeReleaseEvidenceChecklist.map((item) => item.key), [
    "routeContractReadiness",
    "citationGroundedAnswerProof",
    "refusalNoAnswerProof",
    "feedbackMaintenanceProof",
    "integrationContractProof",
    "browserAskWorkflow"
  ]);

  const partial = evaluateQueryRuntimeReleaseEvidence({
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence()
  });
  const complete = evaluateQueryRuntimeReleaseEvidence(completeQueryRuntimeEvidence());

  assert.equal(partial.releaseAllowed, false);
  assert.equal(partial.releaseStage, "0.3.0-query-runtime");
  assert.ok(partial.missing.includes("routeContractReadiness"));
  assert.ok(partial.missing.includes("browserAskWorkflow"));
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.missing.length, 0);
});

test("Block M5 release evidence generator emits query runtime milestone evidence", async () => {
  const { generateReleaseEvidence } = await import(pathToFileURL(path.join(projectRoot, "scripts", "generate-release-evidence.mjs")).href);

  const generated = generateReleaseEvidence({
    stage: "query-runtime",
    localGates: baseLocalGates(),
    github: { githubCi: "pass", githubCodeql: "pass", githubScorecard: "pass" },
    browserSampleSmoke: {
      ok: true,
      evidence: {
        browserSampleFlow: { status: "pass", desktop: true, narrow: true, resetVerified: true },
        evidenceSearch: { status: "pass", desktop: true, narrow: true, maintenanceEvidence: true, evidenceLink: true },
        queryRuntimeFlow: { status: "pass", answered: true, refused: true, feedbackMaintenance: true, desktop: true, narrow: true }
      }
    },
    betaReleaseNotes: { supportedPaths: true, limitations: true, knownGaps: true },
    searchableReadiness: { catalogSearch: true, queryEvidence: true, citationReady: true, scopedApi: true },
    incrementalUpdateProof: { catalogDelta: true, targetedRerun: true, versionRollback: true },
    vectorFallbackProof: { sidecarContract: true, invalidVectorBlocked: true, catalogFallback: true },
    routeContractReadiness: { routeContract: true, refusalTaxonomy: true, evidencePolicy: true },
    citationGroundedAnswerProof: { citedAnswer: true, evidencePack: true, qualityGates: true },
    refusalNoAnswerProof: { outOfScope: true, insufficientEvidence: true, noWeakAnswer: true },
    feedbackMaintenanceProof: { negativeFeedbackIssue: true, rerunScope: true, positiveSignalOnly: true },
    integrationContractProof: { openApi: true, nodeExample: true, httpExample: true, driftTest: true },
    assetPaths: ["README.md", "docs/api/query-runtime.en.md"],
    sourceAuditPaths: ["exports/query-runtime-evidence.json"]
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evaluation.releaseStage, "0.3.0-query-runtime");
  assert.equal(generated.evidence.routeContractReadiness.status, "pass");
  assert.equal(generated.evidence.browserAskWorkflow.status, "pass");
  assert.equal(evaluateQueryRuntimeReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block M5 release gate CLI can enforce query-runtime-stage evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-runtime-release-gate-"));
  const completePath = path.join(tempDir, "complete.json");
  const missingPath = path.join(tempDir, "missing.json");
  try {
    fs.writeFileSync(completePath, `${JSON.stringify(completeQueryRuntimeEvidence(), null, 2)}\n`, "utf8");
    fs.writeFileSync(missingPath, `${JSON.stringify({ ...baseReleaseEvidence(), ...publicBetaEvidence(), ...searchableEvidence() }, null, 2)}\n`, "utf8");

    const blocked = spawnSync(process.execPath, [releaseGateScript, "--stage", "query-runtime", "--evidence", missingPath], { encoding: "utf8" });
    const allowed = spawnSync(process.execPath, [releaseGateScript, "--stage", "query-runtime", "--evidence", completePath], { encoding: "utf8" });

    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseStage": "0.3.0-query-runtime"/);
    assert.match(blocked.stdout, /routeContractReadiness/);
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
    artifactSmoke: { ok: true, package: { sha256: "c".repeat(64) } },
    packageBoundary: { ok: true },
    diffCheck: { ok: true }
  };
}

function baseReleaseEvidence() {
  return {
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "c".repeat(64) },
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

function queryRuntimeEvidence() {
  return {
    routeContractReadiness: { status: "pass", routeContract: true, refusalTaxonomy: true, evidencePolicy: true },
    citationGroundedAnswerProof: { status: "pass", citedAnswer: true, evidencePack: true, qualityGates: true },
    refusalNoAnswerProof: { status: "pass", outOfScope: true, insufficientEvidence: true, noWeakAnswer: true },
    feedbackMaintenanceProof: { status: "pass", negativeFeedbackIssue: true, rerunScope: true, positiveSignalOnly: true },
    integrationContractProof: { status: "pass", openApi: true, nodeExample: true, httpExample: true, driftTest: true },
    browserAskWorkflow: { status: "pass", answered: true, refused: true, feedbackMaintenance: true, desktop: true, narrow: true }
  };
}

function completeQueryRuntimeEvidence() {
  return {
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence()
  };
}
