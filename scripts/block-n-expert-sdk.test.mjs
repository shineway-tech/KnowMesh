import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  evaluateExpertSdkReleaseEvidence,
  expertSdkReleaseEvidenceChecklist
} from "./release-gate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseGateScript = path.join(projectRoot, "scripts", "release-gate.mjs");

test("Block N5 Expert SDK release evidence requires extension foundation proofs", () => {
  assert.deepEqual(expertSdkReleaseEvidenceChecklist.map((item) => item.key), [
    "expertManifestReadiness",
    "expertRuntimeBoundaryProof",
    "nonK12ExampleProof",
    "expertEvaluationGateProof",
    "expertDocsContributorWorkflowProof",
    "expertPackageAssetReview"
  ]);

  const partial = evaluateExpertSdkReleaseEvidence({
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence()
  });
  const complete = evaluateExpertSdkReleaseEvidence(completeExpertSdkEvidence());

  assert.equal(partial.releaseAllowed, false);
  assert.equal(partial.releaseStage, "0.4.0-expert-sdk");
  assert.ok(partial.missing.includes("expertManifestReadiness"));
  assert.ok(partial.missing.includes("nonK12ExampleProof"));
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.missing.length, 0);
});

test("Block N5 release evidence generator emits Expert SDK milestone evidence", async () => {
  const { generateReleaseEvidence } = await import(pathToFileURL(path.join(projectRoot, "scripts", "generate-release-evidence.mjs")).href);

  const generated = generateReleaseEvidence({
    stage: "expert-sdk",
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
    expertManifestReadiness: { manifestContract: true, validation: true, lifecycleCertification: true },
    expertRuntimeBoundaryProof: { publicHooks: true, directStorageBlocked: true, queryRouteHooks: true },
    nonK12ExampleProof: { operationsHandbook: true, publicFixture: true, queryEvidence: true },
    expertEvaluationGateProof: { portableCases: true, dashboardAggregation: true, maintenanceMapping: true },
    expertDocsContributorWorkflowProof: { authoringDocs: true, exampleDocs: true, requiredTests: true, communityProposalPath: true },
    expertPackageAssetReview: { noPrivateState: true, noSqlite: true, noSecrets: true, noPrivateFixtures: true },
    assetPaths: ["README.md", "docs/experts/authoring.en.md", "examples/public-samples/operations-handbook/source/incident-operations-handbook.md"],
    sourceAuditPaths: ["exports/expert-sdk-evidence.json"]
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evaluation.releaseStage, "0.4.0-expert-sdk");
  assert.equal(generated.evidence.expertManifestReadiness.status, "pass");
  assert.equal(generated.evidence.expertEvaluationGateProof.status, "pass");
  assert.equal(evaluateExpertSdkReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block N5 release gate CLI can enforce expert-sdk-stage evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-expert-sdk-release-gate-"));
  const completePath = path.join(tempDir, "complete.json");
  const missingPath = path.join(tempDir, "missing.json");
  try {
    fs.writeFileSync(completePath, `${JSON.stringify(completeExpertSdkEvidence(), null, 2)}\n`, "utf8");
    fs.writeFileSync(missingPath, `${JSON.stringify({ ...baseReleaseEvidence(), ...publicBetaEvidence(), ...searchableEvidence(), ...queryRuntimeEvidence() }, null, 2)}\n`, "utf8");

    const blocked = spawnSync(process.execPath, [releaseGateScript, "--stage", "expert-sdk", "--evidence", missingPath], { encoding: "utf8" });
    const allowed = spawnSync(process.execPath, [releaseGateScript, "--stage", "expert-sdk", "--evidence", completePath], { encoding: "utf8" });

    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseStage": "0.4.0-expert-sdk"/);
    assert.match(blocked.stdout, /expertManifestReadiness/);
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /"releaseAllowed": true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Block N5 contributor docs expose Expert SDK workflow and proposal path", () => {
  const combined = [
    "README.md",
    "README.en.md",
    "CONTRIBUTING.md",
    "docs/README.md",
    "docs/README.en.md",
    "docs/experts/authoring.zh-CN.md",
    "docs/experts/authoring.en.md",
    "docs/experts/operations-handbook.zh-CN.md",
    "docs/experts/operations-handbook.en.md",
    "docs/community-backlog.zh-CN.md",
    "docs/community-backlog.en.md"
  ].map(readText).join("\n\n");

  for (const phrase of [
    "Expert SDK",
    "operations-handbook",
    "expert-runtime.test.mjs",
    "expert-evaluation.test.mjs",
    "community Expert",
    "public fixture",
    "proposal"
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), "i"), `${phrase} should be documented`);
  }
  assert.doesNotMatch(combined, /AccessKey Secret|sk-|真实教材正文|C:\\Users|E:\\KnowMesh\\workspace/i);
});

function baseLocalGates() {
  return {
    npmTest: { ok: true },
    releaseSmoke: { ok: true },
    artifactSmoke: { ok: true, package: { sha256: "d".repeat(64) } },
    packageBoundary: { ok: true },
    diffCheck: { ok: true }
  };
}

function baseReleaseEvidence() {
  return {
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "d".repeat(64) },
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

function expertSdkEvidence() {
  return {
    expertManifestReadiness: { status: "pass", manifestContract: true, validation: true, lifecycleCertification: true },
    expertRuntimeBoundaryProof: { status: "pass", publicHooks: true, directStorageBlocked: true, queryRouteHooks: true },
    nonK12ExampleProof: { status: "pass", operationsHandbook: true, publicFixture: true, queryEvidence: true },
    expertEvaluationGateProof: { status: "pass", portableCases: true, dashboardAggregation: true, maintenanceMapping: true },
    expertDocsContributorWorkflowProof: { status: "pass", authoringDocs: true, exampleDocs: true, requiredTests: true, communityProposalPath: true },
    expertPackageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noPrivateFixtures: true }
  };
}

function completeExpertSdkEvidence() {
  return {
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence(),
    ...expertSdkEvidence()
  };
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
