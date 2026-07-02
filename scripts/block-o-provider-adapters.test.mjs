import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  evaluateProviderAdaptersReleaseEvidence,
  providerAdaptersReleaseEvidenceChecklist
} from "./release-gate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseGateScript = path.join(projectRoot, "scripts", "release-gate.mjs");

test("Block O5 Provider Adapter release evidence requires provider foundation proofs", () => {
  assert.deepEqual(providerAdaptersReleaseEvidenceChecklist.map((item) => item.key), [
    "providerManifestReadiness",
    "parserOcrBoundaryProof",
    "embeddingVectorBoundaryProof",
    "providerDiagnosticsBrowserProof",
    "noCloudPublicPathProof",
    "providerPackageAssetReview"
  ]);

  const partial = evaluateProviderAdaptersReleaseEvidence({
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence(),
    ...expertSdkEvidence()
  });
  const complete = evaluateProviderAdaptersReleaseEvidence(completeProviderAdaptersEvidence());

  assert.equal(partial.releaseAllowed, false);
  assert.equal(partial.releaseStage, "0.5.0-provider-adapters");
  assert.ok(partial.missing.includes("providerManifestReadiness"));
  assert.ok(partial.missing.includes("providerDiagnosticsBrowserProof"));
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.missing.length, 0);
});

test("Block O5 release evidence generator emits Provider Adapter milestone evidence", async () => {
  const { generateReleaseEvidence, auditProviderDirectPaths } = await import(pathToFileURL(path.join(projectRoot, "scripts", "generate-release-evidence.mjs")).href);

  const directPathAudit = auditProviderDirectPaths([
    "docs/providers.en.md",
    "published/oss-sidecar/provider-summary.json"
  ]);
  const blockedAudit = auditProviderDirectPaths([
    "workspace/knowledge-bases/demo/provider-state.json",
    "src/local-service/provider-bypass/cloud-upload.jsonl"
  ]);
  assert.equal(directPathAudit.ok, true);
  assert.equal(blockedAudit.ok, false);
  assert.equal(blockedAudit.forbiddenDirectProviderPaths, 2);

  const generated = generateReleaseEvidence({
    stage: "provider-adapters",
    localGates: baseLocalGates(),
    github: { githubCi: "pass", githubCodeql: "pass", githubScorecard: "pass" },
    browserSampleSmoke: browserSampleSmokeEvidence(),
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
    providerManifestReadiness: { manifestContract: true, validation: true, capabilityInventory: true },
    parserOcrBoundaryProof: { parserPreflight: true, ocrPreflight: true, unsafeInputsReviewed: true },
    embeddingVectorBoundaryProof: { embeddingBatchContract: true, vectorOutputValidation: true, catalogFallback: true },
    providerAuditPaths: ["docs/providers.zh-CN.md", "examples/public-samples/general-docs/source/operations-handbook.md"],
    assetPaths: ["README.md", "docs/providers.en.md", "examples/public-samples/general-docs/source/operations-handbook.md"],
    sourceAuditPaths: ["exports/provider-adapter-evidence.json"]
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evaluation.releaseStage, "0.5.0-provider-adapters");
  assert.equal(generated.evidence.providerManifestReadiness.status, "pass");
  assert.equal(generated.evidence.providerDiagnosticsBrowserProof.status, "pass");
  assert.equal(generated.evidence.noCloudPublicPathProof.status, "pass");
  assert.equal(generated.evidence.providerPackageAssetReview.noDirectProviderBypass, true);
  assert.equal(evaluateProviderAdaptersReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block O5 release gate CLI can enforce provider-adapters-stage evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-provider-adapters-release-gate-"));
  const completePath = path.join(tempDir, "complete.json");
  const missingPath = path.join(tempDir, "missing.json");
  try {
    fs.writeFileSync(completePath, `${JSON.stringify(completeProviderAdaptersEvidence(), null, 2)}\n`, "utf8");
    fs.writeFileSync(missingPath, `${JSON.stringify({ ...baseReleaseEvidence(), ...publicBetaEvidence(), ...searchableEvidence(), ...queryRuntimeEvidence(), ...expertSdkEvidence() }, null, 2)}\n`, "utf8");

    const blocked = spawnSync(process.execPath, [releaseGateScript, "--stage", "provider-adapters", "--evidence", missingPath], { encoding: "utf8" });
    const allowed = spawnSync(process.execPath, [releaseGateScript, "--provider-adapters", "--evidence", completePath], { encoding: "utf8" });

    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseStage": "0.5.0-provider-adapters"/);
    assert.match(blocked.stdout, /providerManifestReadiness/);
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /"releaseAllowed": true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Block O5 docs expose Provider Adapter release workflow and no-cloud path", () => {
  const combined = [
    "README.md",
    "README.en.md",
    "docs/README.md",
    "docs/README.en.md",
    "docs/providers.zh-CN.md",
    "docs/providers.en.md",
    "docs/release-candidate.zh-CN.md",
    "docs/release-candidate.en.md",
    "docs/release-operations.zh-CN.md",
    "docs/release-operations.en.md",
    "ROADMAP.md",
    "ROADMAP.en.md",
    "CHANGELOG.md"
  ].map(readText).join("\n\n");

  for (const phrase of [
    "0.5.0 Provider Adapters",
    "providerManifestReadiness",
    "parserOcrBoundaryProof",
    "embeddingVectorBoundaryProof",
    "providerDiagnosticsBrowserProof",
    "noCloudPublicPathProof",
    "providerPackageAssetReview",
    "no-cloud",
    "workspace.sqlite",
    "catalog.sqlite"
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), "i"), `${phrase} should be documented`);
  }
  assert.doesNotMatch(combined, /AccessKey Secret|sk-|真实教材正文|C:\\Users|E:\\KnowMesh\\workspace/i);
});

function baseLocalGates() {
  return {
    npmTest: { ok: true },
    releaseSmoke: { ok: true },
    artifactSmoke: { ok: true, package: { sha256: "e".repeat(64) } },
    packageBoundary: { ok: true },
    diffCheck: { ok: true }
  };
}

function baseReleaseEvidence() {
  return {
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "e".repeat(64) },
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

function providerAdaptersEvidence() {
  return {
    providerManifestReadiness: { status: "pass", manifestContract: true, validation: true, capabilityInventory: true },
    parserOcrBoundaryProof: { status: "pass", parserPreflight: true, ocrPreflight: true, unsafeInputsReviewed: true },
    embeddingVectorBoundaryProof: { status: "pass", embeddingBatchContract: true, vectorOutputValidation: true, catalogFallback: true },
    providerDiagnosticsBrowserProof: { status: "pass", scopedApi: true, desktop: true, narrow: true, sqliteAuthority: true, noExternalCallsBeforeExecution: true },
    noCloudPublicPathProof: { status: "pass", publicSample: true, credentialFree: true, externalCallsBlocked: true, localFallback: true },
    providerPackageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectProviderBypass: true }
  };
}

function completeProviderAdaptersEvidence() {
  return {
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence(),
    ...expertSdkEvidence(),
    ...providerAdaptersEvidence()
  };
}

function browserSampleSmokeEvidence() {
  return {
    ok: true,
    evidence: {
      browserSampleFlow: { status: "pass", desktop: true, narrow: true, resetVerified: true },
      evidenceSearch: { status: "pass", desktop: true, narrow: true, maintenanceEvidence: true, evidenceLink: true },
      queryRuntimeFlow: { status: "pass", answered: true, refused: true, feedbackMaintenance: true, desktop: true, narrow: true },
      providerDiagnostics: { status: "pass", scopedApi: true, desktop: true, narrow: true, sqliteAuthority: true, noExternalCallsBeforeExecution: true },
      externalCalls: { total: 0, calls: [] }
    },
    checks: [
      { key: "providerDiagnostics", status: "pass" }
    ]
  };
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
