import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Block U exposes release-candidate smoke and evidence commands", () => {
  const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

  assert.equal(packageInfo.scripts["smoke:release-candidate"], "node ./scripts/release-candidate-evidence.mjs");
  assert.equal(packageInfo.scripts["generate:release-candidate"], "node ./scripts/release-candidate-evidence.mjs --out");
  assert.equal(fs.existsSync(path.join(projectRoot, "scripts", "release-candidate-evidence.mjs")), true);
  assert.equal(fs.existsSync(path.join(projectRoot, "docs", "release-candidate-freeze.zh-CN.md")), true);
  assert.equal(fs.existsSync(path.join(projectRoot, "docs", "release-candidate-freeze.en.md")), true);
});

test("Block U release-candidate evaluator requires all freeze gates", async () => {
  const { evaluateReleaseCandidateEvidence, releaseCandidateChecklist } = await import("./release-candidate-evidence.mjs");

  assert.deepEqual(releaseCandidateChecklist.map((item) => item.key), [
    "releaseEvidencePacket",
    "freshCloneInstallRehearsal",
    "browserAcceptance",
    "communityReadiness",
    "goNoGoPacket"
  ]);

  const blocked = evaluateReleaseCandidateEvidence({});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing, releaseCandidateChecklist.map((item) => item.key));

  const allowed = evaluateReleaseCandidateEvidence(completeReleaseCandidateProofs());
  assert.equal(allowed.ok, true);
  assert.equal(allowed.releaseAllowed, true);
  assert.deepEqual(allowed.missing, []);
});

test("Block U builds a public-safe release candidate packet from smoke evidence", async () => {
  const { buildReleaseCandidateEvidence } = await import("./release-candidate-evidence.mjs");

  const packet = buildReleaseCandidateEvidence(completeReleaseCandidateInputs());
  assert.equal(packet.ok, true);
  assert.equal(packet.kind, "knowmesh.releaseCandidateEvidence");
  assert.equal(packet.releaseStage, "1.0.0-public-release-candidate");
  assert.equal(packet.releaseEvidence.releaseStage, "1.0.0-usable-product");
  assert.equal(packet.releaseGate.releaseAllowed, true);
  assert.equal(packet.releaseCandidateEvaluation.releaseAllowed, true);
  assert.equal(packet.artifact.sha256, "a".repeat(64));

  assert.deepEqual(packet.commandEvidence.map((item) => [item.key, item.status]), [
    ["releaseSmoke", "pass"],
    ["artifactSmoke", "pass"],
    ["packageBoundary", "pass"],
    ["integrationPrivacyAudit", "pass"],
    ["browserSampleSmoke", "pass"],
    ["sdkConsumerSmoke", "pass"],
    ["liveSdkSampleSmoke", "pass"],
    ["operatorWorkflowSmoke", "pass"],
    ["firstRunUsabilitySmoke", "pass"],
    ["usableProductSmoke", "pass"],
    ["freshCloneInstallRehearsal", "pass"]
  ]);

  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, /[A-Z]:\\|\/Users\/|\\Users\\|user-data|tempRoot|workspace\.sqlite":|catalog\.sqlite":|rawProviderResponses|sourceContent|documentText/i);
});

test("Block U release-candidate CLI can write and gate an evidence packet", async () => {
  const { buildReleaseCandidateEvidence } = await import("./release-candidate-evidence.mjs");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-u-"));
  try {
    const packetPath = path.join(temp, "release-candidate-evidence.json");
    fs.writeFileSync(packetPath, JSON.stringify(buildReleaseCandidateEvidence(completeReleaseCandidateInputs()), null, 2), "utf8");
    const gateScript = path.join(projectRoot, "scripts", "release-gate.mjs");
    const allowed = spawnSync(process.execPath, [gateScript, "--usable-product", "--evidence", packetPath], {
      encoding: "utf8"
    });
    assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);

    const cliScript = path.join(projectRoot, "scripts", "release-candidate-evidence.mjs");
    const cliResult = spawnSync(process.execPath, [cliScript, "--fixtures", "--out", packetPath], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
    const written = JSON.parse(fs.readFileSync(packetPath, "utf8"));
    assert.equal(written.ok, true);
    assert.equal(written.releaseGate.releaseAllowed, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Block U docs and plan list every public release candidate round", async () => {
  const { reviewReleaseCandidateReadiness } = await import(pathToFileURL(path.join(projectRoot, "scripts", "release-candidate-evidence.mjs")).href);
  const review = reviewReleaseCandidateReadiness({ projectRoot });
  const plan = fs.readFileSync(path.join(projectRoot, "docs", "superpowers", "plans", "2026-06-30-product-engineering-mainline.md"), "utf8");

  assert.equal(review.ok, true);
  for (const key of ["README.md", "README.en.md", "docs/release-candidate-freeze.zh-CN.md", "docs/release-candidate-freeze.en.md"]) {
    assert.equal(review.docs[key], "pass", `${key} should pass release-candidate readiness review`);
  }
  for (const round of ["Round U1", "Round U2", "Round U3", "Round U4", "Round U5", "Block V"]) {
    assert.match(plan, new RegExp(round.replace(" ", "\\s+")));
  }
});

function completeReleaseCandidateInputs() {
  return {
    localGates: {
      npmTest: { ok: true },
      releaseSmoke: { ok: true },
      artifactSmoke: { ok: true, package: { sha256: "a".repeat(64) } },
      packageBoundary: { ok: true },
      diffCheck: { ok: true }
    },
    github: { githubCi: "pass", githubCodeql: "pass", githubScorecard: "pass" },
    releaseSmoke: { ok: true, summary: { passed: 8, failed: 0 } },
    artifactSmoke: { ok: true, package: { filename: "knowmesh-0.1.0.tgz", files: 233, sha256: "a".repeat(64) } },
    packageBoundary: { ok: true, rejected: [] },
    integrationPrivacyAudit: integrationPrivacyAuditEvidence(),
    browserSampleSmoke: browserSampleSmokeEvidence(),
    sdkConsumerSmoke: sdkConsumerSmokeEvidence(),
    liveSdkSampleSmoke: liveSdkSampleSmokeEvidence(),
    operatorWorkflowSmoke: operatorWorkflowSmokeEvidence(),
    firstRunUsabilitySmoke: firstRunUsabilitySmokeEvidence(),
    usableProductSmoke: usableProductSmokeEvidence(),
    freshCloneRehearsal: freshCloneRehearsalEvidence(),
    browserAcceptance: browserAcceptanceEvidence(),
    communityReadiness: completeReleaseCandidateProofs().communityReadiness,
    goNoGoPacket: completeReleaseCandidateProofs().goNoGoPacket,
    assetPaths: ["README.md", "README.en.md", "docs/release-candidate-freeze.zh-CN.md", "docs/release-candidate-freeze.en.md"],
    sourceAuditPaths: ["exports/release-candidate-evidence.json"],
    providerAuditPaths: ["docs/providers.zh-CN.md", "examples/public-samples/general-docs/source/operations-handbook.md"]
  };
}

function completeReleaseCandidateProofs() {
  return {
    releaseEvidencePacket: {
      status: "pass",
      actualCommandSources: true,
      includesAllRequiredSmokes: true,
      usableProductGatePassed: true,
      publicSafe: true,
      artifactSha256: true
    },
    freshCloneInstallRehearsal: {
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
    },
    browserAcceptance: {
      status: "pass",
      desktop: true,
      narrow: true,
      firstRun: true,
      publicSample: true,
      queryRuntime: true,
      feedback: true,
      maintenance: true,
      diagnostics: true,
      versions: true,
      packagePreview: true,
      noHorizontalOverflow: true,
      noPlaceholderText: true,
      noInternalStateWording: true
    },
    communityReadiness: {
      status: "pass",
      readme: true,
      docsIndex: true,
      releaseOperations: true,
      securityContributing: true,
      issueTemplates: true,
      goodFirstIssues: true,
      knownGapsMapped: true,
      publicationStepsSeparated: true
    },
    goNoGoPacket: {
      status: "pass",
      supportedPaths: true,
      limitations: true,
      knownGaps: true,
      artifactHash: true,
      verificationCommands: true,
      noPublicationSideEffects: true
    }
  };
}

function freshCloneRehearsalEvidence() {
  return completeReleaseCandidateProofs().freshCloneInstallRehearsal;
}

function browserAcceptanceEvidence() {
  return completeReleaseCandidateProofs().browserAcceptance;
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

function browserSampleSmokeEvidence() {
  return {
    ok: true,
    viewports: [{ name: "desktop", status: "pass" }, { name: "narrow", status: "pass" }],
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
      providerAwareNoCloudConsumer: { status: "pass", publicSample: true, credentialFree: true, externalCallsBlocked: true, localFallback: true },
      externalCalls: { total: 0, calls: [] }
    }
  };
}

function operatorWorkflowSmokeEvidence() {
  return {
    ok: true,
    evidence: {
      sourceIntakeProof: { status: "pass", folderPrecheck: true, scanPreview: true, sourceManifest: true, excludeRestore: true, changedMissingRestored: true, executionPlanPreview: true, k12GateIsolation: true },
      executionRecoveryProof: { status: "pass", jobCreation: true, checkpointPersistence: true, progressPolling: true, pauseResumeStop: true, restartRecovery: true, taskSummary: true, diagnosticRedaction: true },
      maintenanceTargetedRerunProof: { status: "pass", evidenceSearch: true, queryFeedbackReview: true, qualityIssueReview: true, safeRerunScope: true, targetedRerunJob: true, reviewResolution: true },
      versionRollbackProof: { status: "pass", versionManifest: true, packagePreview: true, versionList: true, diff: true, rollbackPreview: true, rollbackConfirmation: true, crossKbIsolation: true },
      operatorBrowserWorkflow: { status: "pass", desktop: true, narrow: true, sourceIntake: true, execution: true, maintenance: true, versions: true, feedback: true, diagnostics: true },
      operatorPrivacyAuditProof: { status: "pass", diagnosticRedaction: true, noCredentialLeak: true, noPrivateContentLeak: true, localhostOnly: true, noExternalCallsBeforeExecution: true, noInternalReads: true },
      externalCalls: { total: 0, calls: [] }
    }
  };
}

function firstRunUsabilitySmokeEvidence() {
  return {
    ok: true,
    evidence: {
      firstRunLaunchProof: { status: "pass", emptyWorkspace: true, createAction: true, sampleAction: true, runtimeDiagnostics: true, providerReadiness: true, localhostOnly: true },
      guidedSetupProof: { status: "pass", setupDraftPersistence: true, folderPrecheck: true, missingFolderBlocked: true, scanPreview: true, executionPlanPreview: true, generalDocsNoK12Leak: true },
      buildRecoveryProof: { status: "pass", jobCreation: true, visibleProgress: true, pauseResume: true, restartRecovery: true, completion: true, diagnosticRedaction: true },
      firstQuestionProof: { status: "pass", queryRuntime: true, citationOrExplicitNoAnswer: true, evidenceSearch: true, noWeakSuccess: true },
      maintenanceNextActionProof: { status: "pass", feedbackStored: true, reviewItemCreated: true, safeRerunScope: true, scopedApi: true },
      firstRunBrowserWorkflow: { status: "pass", desktop: true, narrow: true, emptyState: true, createSelect: true, readiness: true, diagnostics: true },
      externalCalls: { total: 0, calls: [] }
    }
  };
}

function usableProductSmokeEvidence() {
  return {
    ok: true,
    evidence: {
      launchReliabilityProof: { status: "pass", portFallback: true, noImplicitKnowledgeBase: true, localhostOnly: true, pathMutationGuard: true, privateRuntimeLauncher: true, restartSelectionPersistence: true, workspaceSqliteAuthority: true, noLegacyJsonState: true, diagnosticRedaction: true },
      documentIntakeProof: { status: "pass", parserBoundary: true, ocrBoundary: true, rejectedRiskyInputs: true, catalogConsistency: true, targetedRerunSourceSet: true, externalCallsBeforeExecutionZero: true },
      webConsoleWorkflowProof: { status: "pass", createSelectSetup: true, buildExecutionLoop: true, askFeedbackReview: true, documentsVersionsDiagnostics: true, packagePreview: true, noDuplicatePrimaryControls: true, noDirectInternalStateReads: true },
      durableDataPackageProof: { status: "pass", workspaceCatalogBackup: true, walFilesExcluded: true, staleJsonCleanup: true, packageExportPreview: true, importPreviewNoWrites: true, versionManifest: true, rollbackPreview: true, rollbackConfirmation: true, packageBoundaryPrivacy: true, externalCallsBeforeExecutionZero: true },
      externalCalls: { total: 0, calls: [] }
    }
  };
}
