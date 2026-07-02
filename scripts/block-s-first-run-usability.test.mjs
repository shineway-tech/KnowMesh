import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateReleaseEvidence } from "./generate-release-evidence.mjs";
import { runFirstRunUsabilitySmoke } from "./first-run-usability-smoke.mjs";
import {
  evaluateFirstRunUsabilityReleaseEvidence,
  firstRunUsabilityReleaseEvidenceChecklist
} from "./release-gate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseGateScript = path.join(projectRoot, "scripts", "release-gate.mjs");

test("Block S1 first-run usability smoke is wired as a package-level command", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["smoke:first-run-usability"], "node ./scripts/first-run-usability-smoke.mjs");
});

test("Block S1 first-run smoke proves empty launch create select readiness and cleanup", async () => {
  const result = await runFirstRunUsabilitySmoke({
    projectRoot,
    viewports: [
      { name: "desktop", width: 1280, height: 820 },
      { name: "narrow", width: 390, height: 844 }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.firstRunUsabilitySmoke");
  assert.equal(result.evidence.firstRunLaunchProof.status, "pass");
  assert.equal(result.evidence.firstRunBrowserWorkflow.status, "pass");
  assert.equal(result.evidence.sqliteStateAuthorityProof.status, "pass");
  assert.equal(result.evidence.guidedSetupProof.status, "pass");
  assert.equal(result.evidence.guidedSetupProof.missingFolderBlocked, true);
  assert.equal(result.evidence.guidedSetupProof.generalDocsNoK12Leak, true);
  assert.equal(result.evidence.buildRecoveryProof.status, "pass");
  assert.equal(result.evidence.buildRecoveryProof.restartRecovery, true);
  assert.equal(result.evidence.buildRecoveryProof.diagnosticRedaction, true);
  assert.equal(result.evidence.firstQuestionProof.status, "pass");
  assert.equal(result.evidence.firstQuestionProof.noWeakSuccess, true);
  assert.equal(result.evidence.maintenanceNextActionProof.status, "pass");
  assert.equal(result.evidence.maintenanceNextActionProof.safeRerunScope, true);
  assert.equal(result.evidence.externalCalls.total, 0);
  assert.equal(result.evidence.cleanup.userDataRootRemoved, true);
  assert.ok(result.evidence.knowledgeBase.primaryKnowledgeBaseId);
  assert.equal(result.evidence.knowledgeBase.selectedKnowledgeBaseId, result.evidence.knowledgeBase.primaryKnowledgeBaseId);
});

test("Block S1 first-run Web Console keeps setup and selection off browser-storage truth", () => {
  const appSource = fs.readFileSync(path.join(projectRoot, "src", "web-console", "app.js"), "utf8");
  const pagesSource = fs.readFileSync(path.join(projectRoot, "src", "web-console", "pages.mjs"), "utf8");

  assert.match(appSource, /const hasInitialKnowledgeBase = Boolean\(pageState\.knowledgeBases\?\.current\?\.id\);/);
  assert.match(appSource, /const setupStateRequest = hasInitialKnowledgeBase \? loadSetupState\(\) : Promise\.resolve\(\);/);
  assert.match(pagesSource, /data-knowledge-base-create/);
  assert.match(pagesSource, /renderKnowledgeBaseContext\(service\)/);
  assert.match(pagesSource, /pageHref\(service, "\/knowledge-bases"\)/);
  assert.match(pagesSource, /scopedPagePath\(service, "\/overview"\)/);
  assert.doesNotMatch(appSource, /localStorage\.(?:setItem|getItem)\(["'](?:currentKnowledgeBaseId|selectedKnowledgeBaseId|setupDraft|taskSummary)/);
});

test("Block S1 plan lists the next first-run usability rounds", () => {
  const plan = fs.readFileSync(
    path.join(projectRoot, "docs", "superpowers", "plans", "2026-06-30-product-engineering-mainline.md"),
    "utf8"
  );

  for (const phrase of [
    "Block S: `0.9.0 First-Run Usability Proof`",
    "Round S1: Launch, Empty State, and Readiness Proof",
    "Round S2: Guided Local KB Creation and Source Validation Proof",
    "Round S3: Build Progress, Recovery, and Error Guidance Proof",
    "Round S4: Ask, Citation, Feedback, and Maintenance Next Action Proof",
    "Round S5: `0.9.0 First-Run Usability Proof` Release Evidence"
  ]) {
    assert.match(plan, new RegExp(escapeRegExp(phrase)));
  }
});

test("Block S5 release evidence requires first-run usability proofs", () => {
  assert.deepEqual(firstRunUsabilityReleaseEvidenceChecklist.map((item) => item.key), [
    "firstRunLaunchProof",
    "guidedSetupProof",
    "buildRecoveryProof",
    "firstQuestionProof",
    "maintenanceNextActionProof",
    "firstRunBrowserWorkflow",
    "firstRunPackageAssetReview"
  ]);

  const partial = evaluateFirstRunUsabilityReleaseEvidence(completeOperatorWorkflowEvidence());
  const complete = evaluateFirstRunUsabilityReleaseEvidence(completeFirstRunUsabilityEvidence());

  assert.equal(partial.releaseAllowed, false);
  assert.equal(partial.releaseStage, "0.9.0-first-run-usability");
  assert.ok(partial.missing.includes("firstRunLaunchProof"));
  assert.ok(partial.missing.includes("maintenanceNextActionProof"));
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.missing.length, 0);
});

test("Block S5 release evidence generator emits First-Run Usability milestone evidence", () => {
  const generated = generateReleaseEvidence({
    stage: "first-run-usability",
    ...completeGeneratorOptions(),
    sdkConsumerSmoke: sdkConsumerSmokeEvidence(),
    liveSdkSampleSmoke: liveSdkSampleSmokeEvidence(),
    integrationPrivacyAudit: integrationPrivacyAuditEvidence(),
    integrationRecipeProof: consumerIntegrationEvidence().integrationRecipeProof,
    operatorWorkflowSmoke: operatorWorkflowSmokeEvidence(),
    firstRunUsabilitySmoke: firstRunUsabilitySmokeEvidence()
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evaluation.releaseStage, "0.9.0-first-run-usability");
  assert.equal(generated.evidence.firstRunLaunchProof.status, "pass");
  assert.equal(generated.evidence.guidedSetupProof.status, "pass");
  assert.equal(generated.evidence.buildRecoveryProof.status, "pass");
  assert.equal(generated.evidence.firstQuestionProof.status, "pass");
  assert.equal(generated.evidence.maintenanceNextActionProof.status, "pass");
  assert.equal(generated.evidence.firstRunBrowserWorkflow.status, "pass");
  assert.equal(generated.evidence.firstRunPackageAssetReview.status, "pass");
  assert.equal(evaluateFirstRunUsabilityReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block S5 release gate CLI can enforce first-run-usability-stage evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-first-run-release-gate-"));
  const completePath = path.join(tempDir, "complete.json");
  const missingPath = path.join(tempDir, "missing.json");
  try {
    fs.writeFileSync(completePath, `${JSON.stringify(completeFirstRunUsabilityEvidence(), null, 2)}\n`, "utf8");
    fs.writeFileSync(missingPath, `${JSON.stringify(completeOperatorWorkflowEvidence(), null, 2)}\n`, "utf8");

    const blocked = spawnSync(process.execPath, [releaseGateScript, "--stage", "first-run-usability", "--evidence", missingPath], { encoding: "utf8" });
    const allowed = spawnSync(process.execPath, [releaseGateScript, "--first-run-usability", "--evidence", completePath], { encoding: "utf8" });

    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseStage": "0.9.0-first-run-usability"/);
    assert.match(blocked.stdout, /firstRunLaunchProof/);
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /"releaseAllowed": true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Block S5 docs expose first-run usability proof and commands", () => {
  const combined = [
    "README.md",
    "README.en.md",
    "docs/README.md",
    "docs/README.en.md",
    "docs/first-run-usability.zh-CN.md",
    "docs/first-run-usability.en.md",
    "docs/release-candidate.zh-CN.md",
    "docs/release-candidate.en.md",
    "docs/release-operations.zh-CN.md",
    "docs/release-operations.en.md",
    "ROADMAP.md",
    "ROADMAP.en.md",
    "CHANGELOG.md",
    "docs/community-backlog.zh-CN.md",
    "docs/community-backlog.en.md"
  ].map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8")).join("\n\n");

  for (const phrase of [
    "0.9.0 First-Run Usability Proof",
    "firstRunLaunchProof",
    "guidedSetupProof",
    "buildRecoveryProof",
    "firstQuestionProof",
    "maintenanceNextActionProof",
    "firstRunBrowserWorkflow",
    "firstRunPackageAssetReview",
    "smoke:first-run-usability",
    "first-run-usability"
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), "i"), `${phrase} should be documented`);
  }
});

function completeFirstRunUsabilityEvidence() {
  return {
    ...completeOperatorWorkflowEvidence(),
    ...firstRunUsabilityEvidence()
  };
}

function completeOperatorWorkflowEvidence() {
  return {
    ...completeConsumerIntegrationEvidence(),
    ...operatorWorkflowEvidence()
  };
}

function completeConsumerIntegrationEvidence() {
  return {
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence(),
    ...expertSdkEvidence(),
    ...providerAdaptersEvidence(),
    ...integrationSdkEvidence(),
    ...consumerIntegrationEvidence()
  };
}

function baseReleaseEvidence() {
  return {
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "f".repeat(64) },
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

function integrationSdkEvidence() {
  return {
    endpointManifestReadiness: { status: "pass", endpointManifest: true, openApi: true, scopedDiscovery: true, diagnosticsDiscovery: true },
    sdkClientProof: { status: "pass", packageExports: true, scopedHelpers: true, injectedFetch: true, errorRedaction: true },
    examplesDriftProof: { status: "pass", nodeExample: true, httpExample: true, expectedResponses: true, driftTest: true },
    integrationSafetyProof: { status: "pass", retrySemantics: true, diagnosticsRedaction: true, localhostOnly: true, noInternalReads: true },
    providerAwareNoCloudProof: { status: "pass", providerDiagnostics: true, integrationDiagnostics: true, noExternalCalls: true, publicSample: true },
    integrationPackageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true }
  };
}

function consumerIntegrationEvidence() {
  return {
    installedSdkConsumerProof: { status: "pass", packageExports: true, subpathExport: true, injectedFetch: true, noInternalImports: true, noPrivatePackageFiles: true },
    livePublicSampleSdkProof: { status: "pass", installedPackage: true, realHttp: true, answered: true, refused: true, search: true, feedback: true, providerDiagnostics: true, packagePreview: true, versionManifest: true, resetVerified: true },
    integrationRecipeProof: { status: "pass", serverSideNode: true, electronLocalDesktop: true, browserBackend: true, ciSmoke: true, localhostCors: true, feedbackLinks: true },
    privacyBoundaryAuditProof: { status: "pass", scannedFiles: 21, findings: 0, noSqliteReads: true, noArtifactReads: true, noCredentialLogging: true, noLocalPaths: true, noBroadCors: true },
    providerAwareNoCloudConsumerProof: { status: "pass", publicSample: true, credentialFree: true, externalCallsBlocked: true, localFallback: true },
    consumerPackageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true }
  };
}

function operatorWorkflowEvidence() {
  return {
    sourceIntakeProof: { status: "pass", folderPrecheck: true, scanPreview: true, sourceManifest: true, excludeRestore: true, changedMissingRestored: true, executionPlanPreview: true, k12GateIsolation: true },
    executionRecoveryProof: { status: "pass", jobCreation: true, checkpointPersistence: true, progressPolling: true, pauseResumeStop: true, restartRecovery: true, taskSummary: true, diagnosticRedaction: true },
    maintenanceTargetedRerunProof: { status: "pass", evidenceSearch: true, queryFeedbackReview: true, qualityIssueReview: true, safeRerunScope: true, targetedRerunJob: true, reviewResolution: true },
    versionRollbackProof: { status: "pass", versionManifest: true, packagePreview: true, versionList: true, diff: true, rollbackPreview: true, rollbackConfirmation: true, crossKbIsolation: true },
    operatorBrowserWorkflow: { status: "pass", desktop: true, narrow: true, sourceIntake: true, execution: true, maintenance: true, versions: true, feedback: true, diagnostics: true },
    operatorPrivacyAuditProof: { status: "pass", diagnosticRedaction: true, noCredentialLeak: true, noPrivateContentLeak: true, localhostOnly: true, noExternalCallsBeforeExecution: true, noInternalReads: true },
    operatorPackageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true }
  };
}

function firstRunUsabilityEvidence() {
  return {
    firstRunLaunchProof: { status: "pass", emptyWorkspace: true, createAction: true, sampleAction: true, runtimeDiagnostics: true, providerReadiness: true, localhostOnly: true },
    guidedSetupProof: { status: "pass", setupDraftPersistence: true, folderPrecheck: true, missingFolderBlocked: true, scanPreview: true, executionPlanPreview: true, generalDocsNoK12Leak: true },
    buildRecoveryProof: { status: "pass", jobCreation: true, visibleProgress: true, pauseResume: true, restartRecovery: true, completion: true, diagnosticRedaction: true },
    firstQuestionProof: { status: "pass", queryRuntime: true, citationOrExplicitNoAnswer: true, evidenceSearch: true, noWeakSuccess: true },
    maintenanceNextActionProof: { status: "pass", feedbackStored: true, reviewItemCreated: true, safeRerunScope: true, scopedApi: true },
    firstRunBrowserWorkflow: { status: "pass", desktop: true, narrow: true, emptyState: true, createSelect: true, readiness: true, diagnostics: true },
    firstRunPackageAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true }
  };
}

function completeGeneratorOptions() {
  return {
    localGates: {
      npmTest: { ok: true },
      releaseSmoke: { ok: true },
      artifactSmoke: { ok: true, package: { sha256: "f".repeat(64) } },
      packageBoundary: { ok: true },
      diffCheck: { ok: true }
    },
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
    assetPaths: ["README.md", "docs/first-run-usability.en.md", "src/sdk/knowmesh-client.mjs", "examples/integrations/README.md"],
    sourceAuditPaths: ["exports/first-run-usability-evidence.json"],
    endpointManifestReadiness: { endpointManifest: true, openApi: true, scopedDiscovery: true, diagnosticsDiscovery: true },
    sdkClientProof: { packageExports: true, scopedHelpers: true, injectedFetch: true, errorRedaction: true },
    examplesDriftProof: { nodeExample: true, httpExample: true, expectedResponses: true, driftTest: true },
    integrationSafetyProof: { retrySemantics: true, diagnosticsRedaction: true, localhostOnly: true, noInternalReads: true }
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
      integrationDiagnostics: { status: "pass", scopedApi: true, desktop: true, narrow: true, localhostOnly: true, noExternalCallsBeforeExecution: true },
      externalCalls: { total: 0, calls: [] }
    },
    checks: [
      { key: "providerDiagnostics", status: "pass" },
      { key: "integrationDiagnostics", status: "pass" }
    ]
  };
}

function sdkConsumerSmokeEvidence() {
  return {
    ok: true,
    checks: [
      { key: "packageExportsRoot", status: "pass" },
      { key: "packageExportsSubpath", status: "pass" },
      { key: "consumerInjectedFetch", status: "pass" },
      { key: "noSdkInternalImports", status: "pass" },
      { key: "noPrivatePackageFiles", status: "pass" }
    ]
  };
}

function liveSdkSampleSmokeEvidence() {
  return {
    ok: true,
    evidence: {
      livePublicSampleSdkFlow: consumerIntegrationEvidence().livePublicSampleSdkProof,
      providerAwareNoCloudConsumer: consumerIntegrationEvidence().providerAwareNoCloudConsumerProof
    }
  };
}

function integrationPrivacyAuditEvidence() {
  return {
    ok: true,
    summary: { files: 21, findings: 0 },
    checks: [
      { key: "sqliteDirectRead", status: "pass" },
      { key: "sqliteAuthorityMention", status: "pass" },
      { key: "internalAssetRead", status: "pass" },
      { key: "credentialLogging", status: "pass" },
      { key: "privateContent", status: "pass" },
      { key: "localAbsolutePath", status: "pass" },
      { key: "broadCors", status: "pass" }
    ]
  };
}

function operatorWorkflowSmokeEvidence() {
  return {
    ok: true,
    evidence: {
      ...operatorWorkflowEvidence(),
      externalCalls: { total: 0, calls: [] }
    }
  };
}

function firstRunUsabilitySmokeEvidence() {
  return {
    ok: true,
    evidence: {
      ...firstRunUsabilityEvidence(),
      externalCalls: { total: 0, calls: [] }
    }
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
