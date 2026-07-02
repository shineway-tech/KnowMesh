import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { previewScan } from "../src/local-service/scan-preview.mjs";
import { createKnowledgeBase } from "../src/local-service/knowledge-bases.mjs";
import { buildDocumentListPayload } from "../src/local-service/document-inventory.mjs";
import { platformRuntimeInventory } from "../src/local-service/platform-runtime.mjs";
import { readSourceManifestFromCatalog } from "../src/local-service/source-catalog.mjs";
import { previewTargetedRerun } from "../src/local-service/targeted-rerun.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package exposes the usable product smoke gate", () => {
  const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

  assert.equal(packageInfo.scripts["smoke:usable-product"], "node ./scripts/usable-product-smoke.mjs");
  assert.equal(fs.existsSync(path.join(projectRoot, "scripts", "usable-product-smoke.mjs")), true);
});

test("usable product smoke proves T1 launch reliability", async () => {
  const { runUsableProductSmoke } = await import("./usable-product-smoke.mjs");
  const result = await runUsableProductSmoke({ projectRoot, scope: "launch" });
  const failed = result.checks?.filter((item) => item.status !== "pass") || [];

  assert.equal(result.kind, "knowmesh.usableProductSmoke");
  assert.equal(result.ok, true, failed.map((item) => `${item.key}: ${item.message}`).join("\n"));
  assert.equal(result.evidence.launchReliabilityProof.status, "pass");
  assert.equal(result.evidence.launchReliabilityProof.portFallback, true);
  assert.equal(result.evidence.launchReliabilityProof.restartSelectionPersistence, true);
  assert.equal(result.evidence.launchReliabilityProof.noImplicitKnowledgeBase, true);
  assert.equal(result.evidence.launchReliabilityProof.localhostOnly, true);
  assert.equal(result.evidence.launchReliabilityProof.pathMutationGuard, true);
  assert.equal(result.evidence.launchReliabilityProof.diagnosticRedaction, true);
  assert.equal(result.evidence.launchReliabilityProof.noLegacyJsonState, true);
  assert.equal(result.evidence.externalCalls.total, 0);
  assert.equal(result.evidence.cleanup.userDataRootRemoved, true);
  assert.doesNotMatch(JSON.stringify(result), /[A-Za-z]:[\\/]|(^|[^\\])\\Users\\/i);
});

test("usable product smoke proves T2 local document intake quality", async () => {
  const { runUsableProductSmoke } = await import("./usable-product-smoke.mjs");
  const result = await runUsableProductSmoke({ projectRoot, scope: "intake" });
  const failed = result.checks?.filter((item) => item.status !== "pass") || [];
  const proof = result.evidence.documentIntakeProof;

  assert.equal(result.ok, true, failed.map((item) => `${item.key}: ${item.message}`).join("\n"));
  assert.equal(proof.status, "pass");
  assert.equal(proof.parserBoundary, true);
  assert.equal(proof.ocrBoundary, true);
  assert.equal(proof.rejectedRiskyInputs, true);
  assert.equal(proof.catalogConsistency, true);
  assert.equal(proof.targetedRerunSourceSet, true);
  assert.equal(proof.externalCallsBeforeExecutionZero, true);
  assert.equal(result.evidence.externalCalls.total, 0);
  assert.equal(result.evidence.cleanup.userDataRootRemoved, true);
  assert.doesNotMatch(JSON.stringify(result), /[A-Za-z]:[\\/]|(^|[^\\])\\Users\\/i);
});

test("usable product smoke proves T3 Web Console workflow surfaces", async () => {
  const { runUsableProductSmoke } = await import("./usable-product-smoke.mjs");
  const result = await runUsableProductSmoke({ projectRoot, scope: "web-console" });
  const failed = result.checks?.filter((item) => item.status !== "pass") || [];
  const proof = result.evidence.webConsoleWorkflowProof;

  assert.equal(result.ok, true, failed.map((item) => `${item.key}: ${item.message}`).join("\n"));
  assert.equal(proof.status, "pass");
  assert.equal(proof.createSelectSetup, true);
  assert.equal(proof.buildExecutionLoop, true);
  assert.equal(proof.askFeedbackReview, true);
  assert.equal(proof.documentsVersionsDiagnostics, true);
  assert.equal(proof.packagePreview, true);
  assert.equal(proof.noDuplicatePrimaryControls, true);
  assert.equal(proof.noDirectInternalStateReads, true);
  assert.equal(result.evidence.externalCalls.total, 0);
  assert.equal(result.evidence.cleanup.userDataRootRemoved, true);
  assert.doesNotMatch(JSON.stringify(result), /[A-Za-z]:[\\/]|(^|[^\\])\\Users\\/i);
});

test("usable product smoke proves T4 durable data, package, and rollback boundaries", async () => {
  const { runUsableProductSmoke } = await import("./usable-product-smoke.mjs");
  const result = await runUsableProductSmoke({ projectRoot, scope: "data-package" });
  const failed = result.checks?.filter((item) => item.status !== "pass") || [];
  const proof = result.evidence.durableDataPackageProof;

  assert.equal(result.ok, true, failed.map((item) => `${item.key}: ${item.message}`).join("\n"));
  assert.equal(proof.status, "pass");
  assert.equal(proof.workspaceCatalogBackup, true);
  assert.equal(proof.walFilesExcluded, true);
  assert.equal(proof.staleJsonCleanup, true);
  assert.equal(proof.packageExportPreview, true);
  assert.equal(proof.importPreviewNoWrites, true);
  assert.equal(proof.versionManifest, true);
  assert.equal(proof.rollbackPreview, true);
  assert.equal(proof.rollbackConfirmation, true);
  assert.equal(proof.packageBoundaryPrivacy, true);
  assert.equal(proof.externalCallsBeforeExecutionZero, true);
  assert.equal(result.evidence.externalCalls.total, 0);
  assert.equal(result.evidence.cleanup.userDataRootRemoved, true);
  assert.doesNotMatch(JSON.stringify(result), /[A-Za-z]:[\\/]|(^|[^\\])\\Users\\/i);
});

test("usable product release evidence promotes T1-T4 proofs into the 1.0.0 gate", async () => {
  const { evaluateUsableProductReleaseEvidence, usableProductReleaseEvidenceChecklist } = await import("./release-gate.mjs");
  const { generateReleaseEvidence } = await import("./generate-release-evidence.mjs");
  const usableProductSmoke = usableProductSmokeEvidence();
  const generated = generateReleaseEvidence({
    ...completeUsableProductGeneratorOptions(),
    stage: "usable-product",
    usableProductSmoke
  });
  const evaluation = evaluateUsableProductReleaseEvidence(generated.evidence);

  assert.deepEqual(usableProductReleaseEvidenceChecklist.map((item) => item.key), [
    "usableLaunchReliabilityProof",
    "usableDocumentIntakeProof",
    "usableWebConsoleWorkflowProof",
    "usableDurableDataPackageProof",
    "usableBrowserWorkflow",
    "usablePrivacyProof",
    "usableProductPackageAssetReview"
  ]);
  assert.equal(generated.releaseStage, "1.0.0-usable-product");
  assert.equal(generated.ok, true, generated.evaluation.missing.join(", "));
  assert.equal(evaluation.releaseAllowed, true, evaluation.missing.join(", "));
  assert.equal(generated.evidence.usableLaunchReliabilityProof.portFallback, true);
  assert.equal(generated.evidence.usableDocumentIntakeProof.parserBoundary, true);
  assert.equal(generated.evidence.usableWebConsoleWorkflowProof.noDirectInternalStateReads, true);
  assert.equal(generated.evidence.usableDurableDataPackageProof.rollbackConfirmation, true);
  assert.equal(generated.evidence.usableBrowserWorkflow.desktop, true);
  assert.equal(generated.evidence.usablePrivacyProof.integrationPrivacyAudit, true);
  assert.equal(generated.evidence.usableProductPackageAssetReview.noWalFiles, true);
});

test("platform runtime inventory freezes the cross-platform launcher contract", () => {
  for (const platform of ["win32", "darwin", "linux"]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), `knowmesh-launch-contract-${platform}-`));
    const runtimeRoot = path.join(temp, "runtime");
    const nodePath = platform === "win32"
      ? path.join(runtimeRoot, "node", "v24.18.0-win-x64", "node.exe")
      : path.join(runtimeRoot, "node", `v24.18.0-${platform}-x64`, "bin", "node");
    const inventory = platformRuntimeInventory({ projectRoot }, {
      platform,
      arch: "x64",
      release: "test",
      nodePath,
      nodeVersion: "v24.18.0",
      env: platform === "win32"
        ? { LOCALAPPDATA: temp, KNOWMESH_RUNTIME_DIR: runtimeRoot, PATH: "" }
        : { HOME: temp, KNOWMESH_RUNTIME_DIR: runtimeRoot, PATH: "" }
    });

    assert.equal(inventory.launchReliability.status, "pass", platform);
    assert.equal(inventory.launchReliability.minimumNodeMajor, 24);
    assert.equal(inventory.launchReliability.browserTarget.localhostOnly, true);
    assert.equal(inventory.launchReliability.pathMutationGuard.mutatesPath, false);
    assert.equal(inventory.launchReliability.privateRuntime.canPrepare, true);
    assert.ok(inventory.launchReliability.supportedLaunchers.length >= 1, platform);
    assert.ok(inventory.launchReliability.supportedLaunchers.every((item) => item.exists && item.mutatesPath === false), platform);
    assert.equal(Object.hasOwn(inventory.launchReliability.supportedLaunchers[0], "absolutePath"), false);
  }
});

test("scan preview exposes real local document intake diagnostics through parser and OCR boundaries", async () => {
  const { state, sourceRoot, draft } = tempIntakeState("knowmesh-t2-intake-diagnostics-");
  createKnowledgeBase(state, { name: "T2 Intake Diagnostics", template: "general-docs" });
  writeFixtureSources(sourceRoot, {
    "lesson.pdf": "%PDF local placeholder",
    "worksheet.docx": "modern office placeholder",
    "macro.docm": "macro office placeholder",
    "legacy.doc": "legacy office placeholder",
    "wps-book.wps": "wps placeholder",
    "scan.png": "image placeholder",
    "notes.md": "# Notes\nLocal text.",
    "unsafe.exe": "binary placeholder",
    "archive.bin": "binary placeholder"
  });

  const result = await previewScan(state, {
    mode: "local",
    template: "general-docs",
    draft,
    hashFiles: true
  });
  const preparation = result.preview.sourcePreparation;
  const diagnostics = result.preview.intakeDiagnostics;

  assert.equal(result.ok, true);
  assert.equal(preparation.kind, "knowmesh.sourcePreparationPlan");
  assert.equal(preparation.summary.total, 9);
  assert.equal(preparation.summary.directText, 1);
  assert.equal(preparation.summary.office, 2);
  assert.equal(preparation.summary.autoConvert, 2);
  assert.equal(preparation.summary.ocr, 2);
  assert.equal(preparation.summary.unsupported, 2);
  assert.equal(preparation.summary.externalCallsBeforeExecution, 0);
  assert.equal(diagnostics.externalCallsBeforeExecution, 0);
  assert.deepEqual(diagnostics.rejectedFiles.map((item) => item.relativePath).sort(), ["archive.bin", "unsafe.exe"]);
  assert.ok(diagnostics.reviewQueue.some((item) => item.relativePath === "legacy.doc" && item.userFixableErrors.some((fix) => fix.key === "legacyConverterMissing")));
  assert.ok(diagnostics.reviewQueue.some((item) => item.relativePath === "scan.png" && item.userFixableErrors.some((fix) => fix.key === "localOcrMissing")));
  assert.ok(diagnostics.unsafeSourceClasses.some((item) => item.relativePath === "macro.docm" && item.macroPolicy.neverExecute === true));
  assert.ok(result.preview.warnings.some((warning) => warning.code === "unsupported_files_skipped"));
  assert.ok(result.preview.warnings.some((warning) => warning.code === "macro_office_disabled"));
});

test("catalog-backed source manifest, document inventory, and targeted rerun share the same intake source set", async () => {
  const { state, sourceRoot, draft } = tempIntakeState("knowmesh-t2-catalog-intake-");
  createKnowledgeBase(state, { name: "T2 Catalog Intake", template: "general-docs" });
  writeFixtureSources(sourceRoot, {
    "lesson.pdf": "%PDF local placeholder",
    "worksheet.docx": "modern office placeholder",
    "legacy.doc": "legacy office placeholder",
    "scan.png": "image placeholder",
    "notes.md": "# Notes\nLocal text.",
    "archive.bin": "binary placeholder"
  });

  const result = await previewScan(state, {
    mode: "local",
    template: "general-docs",
    draft,
    hashFiles: true
  });
  const sourceManifest = readSourceManifestFromCatalog(state);
  const documentList = buildDocumentListPayload(state);
  const rerunPreview = previewTargetedRerun(state, { type: "document", relativePath: "lesson.pdf" });
  const previewPaths = result.preview.documents.map((item) => item.relativePath).sort();
  const manifestPaths = sourceManifest.documents.map((item) => item.relativePath).sort();
  const inventoryPaths = documentList.documents.map((item) => item.relativePath).sort();

  assert.deepEqual(previewPaths, ["legacy.doc", "lesson.pdf", "notes.md", "scan.png", "worksheet.docx"]);
  assert.deepEqual(manifestPaths, previewPaths);
  assert.deepEqual(inventoryPaths, previewPaths);
  assert.equal(sourceManifest.summary.logicalDocuments, result.preview.summary.logicalDocuments);
  assert.equal(documentList.summary.totalDocuments, sourceManifest.documents.length);
  assert.equal(rerunPreview.ok, true);
  assert.equal(rerunPreview.documents[0].relativePath, "lesson.pdf");
  assert.equal(rerunPreview.rerunScope.relativePaths.includes("lesson.pdf"), true);
  assert.equal(manifestPaths.includes("archive.bin"), false);
});

function tempIntakeState(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sourceRoot = path.join(root, "source");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const draft = {
    "setup.mode": "local",
    "project.template": "general-docs",
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot,
    "retrieval.profile": "balanced"
  };
  return {
    root,
    sourceRoot,
    workspaceRoot,
    draft,
    state: {
      projectRoot: root,
      userDataRoot: path.join(root, "user-data"),
      enableSystemConverters: false,
      defaultSetupDraft: draft
    }
  };
}

function writeFixtureSources(sourceRoot, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(sourceRoot, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}

function completeUsableProductGeneratorOptions() {
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
    endpointManifestReadiness: { endpointManifest: true, openApi: true, scopedDiscovery: true, diagnosticsDiscovery: true },
    sdkClientProof: { packageExports: true, scopedHelpers: true, injectedFetch: true, errorRedaction: true },
    examplesDriftProof: { nodeExample: true, httpExample: true, expectedResponses: true, driftTest: true },
    integrationSafetyProof: { retrySemantics: true, diagnosticsRedaction: true, localhostOnly: true, noInternalReads: true },
    sdkConsumerSmoke: sdkConsumerSmokeEvidence(),
    liveSdkSampleSmoke: liveSdkSampleSmokeEvidence(),
    integrationPrivacyAudit: integrationPrivacyAuditEvidence(),
    integrationRecipeProof: { serverSideNode: true, electronLocalDesktop: true, browserBackend: true, ciSmoke: true, localhostCors: true, feedbackLinks: true },
    sourceIntakeProof: { folderPrecheck: true, scanPreview: true, sourceManifest: true, excludeRestore: true, changedMissingRestored: true, executionPlanPreview: true, k12GateIsolation: true },
    executionRecoveryProof: { jobCreation: true, checkpointPersistence: true, progressPolling: true, pauseResumeStop: true, restartRecovery: true, taskSummary: true, diagnosticRedaction: true },
    maintenanceTargetedRerunProof: { evidenceSearch: true, queryFeedbackReview: true, qualityIssueReview: true, safeRerunScope: true, targetedRerunJob: true, reviewResolution: true },
    versionRollbackProof: { versionManifest: true, packagePreview: true, versionList: true, diff: true, rollbackPreview: true, rollbackConfirmation: true, crossKbIsolation: true },
    operatorBrowserWorkflow: { status: "pass", desktop: true, narrow: true, sourceIntake: true, execution: true, maintenance: true, versions: true, feedback: true, diagnostics: true },
    operatorPrivacyAuditProof: { diagnosticRedaction: true, noCredentialLeak: true, noPrivateContentLeak: true, localhostOnly: true, noExternalCallsBeforeExecution: true, noInternalReads: true },
    operatorPackageAssetReview: { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true },
    firstRunLaunchProof: { emptyWorkspace: true, createAction: true, sampleAction: true, runtimeDiagnostics: true, providerReadiness: true, localhostOnly: true },
    guidedSetupProof: { setupDraftPersistence: true, folderPrecheck: true, missingFolderBlocked: true, scanPreview: true, executionPlanPreview: true, generalDocsNoK12Leak: true },
    buildRecoveryProof: { jobCreation: true, visibleProgress: true, pauseResume: true, restartRecovery: true, completion: true, diagnosticRedaction: true },
    firstQuestionProof: { queryRuntime: true, citationOrExplicitNoAnswer: true, evidenceSearch: true, noWeakSuccess: true },
    maintenanceNextActionProof: { feedbackStored: true, reviewItemCreated: true, safeRerunScope: true, scopedApi: true },
    firstRunBrowserWorkflow: { status: "pass", desktop: true, narrow: true, emptyState: true, createSelect: true, readiness: true, diagnostics: true },
    firstRunPackageAssetReview: { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true },
    assetPaths: ["README.md", "docs/first-run-usability.en.md", "docs/release-operations.zh-CN.md", "src/sdk/knowmesh-client.mjs", "examples/integrations/README.md"],
    sourceAuditPaths: ["exports/usable-product-evidence.json"],
    providerAuditPaths: ["docs/providers.zh-CN.md", "examples/public-samples/general-docs/source/operations-handbook.md"]
  };
}

function usableProductSmokeEvidence() {
  return {
    ok: true,
    evidence: {
      launchReliabilityProof: {
        status: "pass",
        portFallback: true,
        noImplicitKnowledgeBase: true,
        localhostOnly: true,
        pathMutationGuard: true,
        privateRuntimeLauncher: true,
        restartSelectionPersistence: true,
        workspaceSqliteAuthority: true,
        noLegacyJsonState: true,
        diagnosticRedaction: true
      },
      documentIntakeProof: {
        status: "pass",
        parserBoundary: true,
        ocrBoundary: true,
        rejectedRiskyInputs: true,
        catalogConsistency: true,
        targetedRerunSourceSet: true,
        externalCallsBeforeExecutionZero: true
      },
      webConsoleWorkflowProof: {
        status: "pass",
        createSelectSetup: true,
        buildExecutionLoop: true,
        askFeedbackReview: true,
        documentsVersionsDiagnostics: true,
        packagePreview: true,
        noDuplicatePrimaryControls: true,
        noDirectInternalStateReads: true
      },
      durableDataPackageProof: {
        status: "pass",
        workspaceCatalogBackup: true,
        walFilesExcluded: true,
        staleJsonCleanup: true,
        packageExportPreview: true,
        importPreviewNoWrites: true,
        versionManifest: true,
        rollbackPreview: true,
        rollbackConfirmation: true,
        packageBoundaryPrivacy: true,
        externalCallsBeforeExecutionZero: true
      },
      externalCalls: { total: 0, calls: [] }
    }
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
      livePublicSampleSdkFlow: { status: "pass", installedPackage: true, realHttp: true, answered: true, refused: true, search: true, feedback: true, providerDiagnostics: true, packagePreview: true, versionManifest: true, resetVerified: true },
      providerAwareNoCloudConsumer: { status: "pass", publicSample: true, credentialFree: true, externalCallsBlocked: true, localFallback: true }
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
