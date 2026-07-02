import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSdkConsumerChecks,
  findForbiddenInstalledConsumerPaths,
  sdkConsumerTemplate
} from "./sdk-consumer-smoke.mjs";
import {
  buildLiveSdkSmokeResult,
  liveSdkConsumerTemplate
} from "./live-sdk-sample-smoke.mjs";
import {
  evaluateIntegrationPrivacy,
  integrationPrivacyAuditRoots
} from "./verify-integration-privacy.mjs";
import {
  consumerIntegrationReleaseEvidenceChecklist,
  evaluateConsumerIntegrationReleaseEvidence
} from "./release-gate.mjs";
import { generateReleaseEvidence } from "./generate-release-evidence.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseGateScript = path.join(projectRoot, "scripts", "release-gate.mjs");

test("Block Q1 SDK consumer package scan rejects private runtime state", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-sdk-consumer-scan-"));
  fs.mkdirSync(path.join(temp, "src", "sdk"), { recursive: true });
  fs.mkdirSync(path.join(temp, "knowledge-bases", "sample"), { recursive: true });
  fs.mkdirSync(path.join(temp, "fixtures", "private"), { recursive: true });
  fs.writeFileSync(path.join(temp, "src", "sdk", "knowmesh-client.mjs"), "", "utf8");
  fs.writeFileSync(path.join(temp, "src", "sdk", "knowmesh-client.test.mjs"), "", "utf8");
  fs.writeFileSync(path.join(temp, "workspace.sqlite"), "", "utf8");
  fs.writeFileSync(path.join(temp, "fixtures", "private", "secret.txt"), "", "utf8");

  assert.deepEqual(findForbiddenInstalledConsumerPaths(temp), [
    "fixtures/private",
    "knowledge-bases",
    "src/sdk/knowmesh-client.test.mjs",
    "workspace.sqlite"
  ]);
});

test("Block Q1 SDK consumer checks enforce exports, public imports, and SDK boundaries", () => {
  const checks = buildSdkConsumerChecks({
    packageInfo: {
      name: "knowmesh",
      exports: {
        ".": "./src/sdk/knowmesh-client.mjs",
        "./sdk": "./src/sdk/knowmesh-client.mjs"
      }
    },
    forbiddenPaths: [],
    consumerRun: {
      status: 0,
      stdout: JSON.stringify({ ok: true }),
      stderr: ""
    },
    consumerResult: {
      ok: true,
      rootAndSubpathResolveSameFile: true,
      endpointCount: 13,
      coveredMethods: ["GET", "POST"]
    },
    sdkSource: "export function createKnowMeshClient() {}"
  });

  assert.equal(checks.every((item) => item.status === "pass"), true);

  const failing = buildSdkConsumerChecks({
    packageInfo: {
      name: "knowmesh",
      exports: {
        ".": "./src/sdk/knowmesh-client.mjs",
        "./sdk": "./src/sdk/knowmesh-client.mjs"
      }
    },
    forbiddenPaths: ["workspace/workspace.sqlite"],
    consumerRun: {
      status: 0,
      stdout: "",
      stderr: ""
    },
    consumerResult: {
      ok: true,
      rootAndSubpathResolveSameFile: true,
      endpointCount: 13,
      coveredMethods: ["GET", "POST"]
    },
    sdkSource: "import db from \"../local-service/server.mjs\";"
  });

  assert.deepEqual(
    failing.filter((item) => item.status === "fail").map((item) => item.key),
    ["noSdkInternalImports", "noPrivatePackageFiles"]
  );
});

test("Block Q1 consumer smoke is wired as a package-level command and uses public exports", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["smoke:sdk-consumer"], "node ./scripts/sdk-consumer-smoke.mjs");
  assert.match(sdkConsumerTemplate, /from "knowmesh"/);
  assert.match(sdkConsumerTemplate, /from "knowmesh\/sdk"/);
  assert.doesNotMatch(sdkConsumerTemplate, /from\s+["'](?:\.\.?\/|\/).*src/);
  assert.match(sdkConsumerTemplate, /serviceIntegrationManifest/);
  assert.match(sdkConsumerTemplate, /providerDiagnostics/);
  assert.match(sdkConsumerTemplate, /packageImportPreview/);
});

test("Block Q2 live SDK smoke is wired and uses the packaged SDK against HTTP", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["smoke:live-sdk"], "node ./scripts/live-sdk-sample-smoke.mjs");
  assert.match(liveSdkConsumerTemplate, /from "knowmesh"/);
  assert.match(liveSdkConsumerTemplate, /from "knowmesh\/sdk"/);
  assert.doesNotMatch(liveSdkConsumerTemplate, /from\s+["'](?:\.\.?\/|\/).*src/);
  for (const call of [
    "serviceIntegrationManifest",
    "integrationManifest",
    "serviceIntegrationDiagnostics",
    "integrationDiagnostics",
    "query",
    "search",
    "feedback",
    "feedbackSummary",
    "providerDiagnostics",
    "packageExportPreview",
    "packageImportPreview",
    "maintenanceStatus",
    "versionManifest"
  ]) {
    assert.match(liveSdkConsumerTemplate, new RegExp(`\\.${call}\\(`));
  }
});

test("Block Q2 live SDK evidence requires installed package HTTP flow no-cloud and cleanup", () => {
  const result = buildLiveSdkSmokeResult({
    checks: [
      { key: "serviceStarted", status: "pass", message: "ok" },
      { key: "consumerInstall", status: "pass", message: "ok" },
      { key: "createSample", status: "pass", message: "ok" },
      { key: "liveSdkFlow", status: "pass", message: "ok" },
      { key: "providerAwareNoCloud", status: "pass", message: "ok" },
      { key: "resetCleanup", status: "pass", message: "ok" },
      { key: "tempCleanup", status: "pass", message: "ok" }
    ],
    pack: {
      filename: "knowmesh-0.1.0.tgz",
      size: 1,
      unpackedSize: 1,
      files: 1,
      sha256: "sha"
    },
    consumerResult: {
      ok: true,
      flow: {
        answeredStatus: "answered",
        refusedStatus: "out_of_scope",
        searchTotal: 1,
        feedbackTotal: 2,
        providerExternalCallsBeforeExecution: 0,
        packagePreview: "knowmesh.packageExportPreview",
        versionManifest: "knowmesh.versionManifest"
      }
    },
    externalCalls: [],
    tempRoot: "temp",
    tempRootRemoved: true,
    sampleStillRegistered: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.evidence.livePublicSampleSdkFlow.status, "pass");
  assert.equal(result.evidence.providerAwareNoCloudConsumer.status, "pass");
  assert.equal(result.evidence.externalCalls.total, 0);

  const failed = buildLiveSdkSmokeResult({
    checks: result.checks,
    pack: result.package,
    consumerResult: result.consumer,
    externalCalls: [{ url: "https://example.com", method: "POST" }],
    tempRoot: "temp",
    tempRootRemoved: true,
    sampleStillRegistered: false
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.evidence.providerAwareNoCloudConsumer.status, "fail");
});

test("Block Q3 integration recipes document framework boundaries and discovery links", () => {
  const zh = fs.readFileSync(path.join(projectRoot, "docs", "integrations.zh-CN.md"), "utf8");
  const en = fs.readFileSync(path.join(projectRoot, "docs", "integrations.en.md"), "utf8");
  const docsIndex = fs.readFileSync(path.join(projectRoot, "docs", "README.md"), "utf8");
  const docsIndexEn = fs.readFileSync(path.join(projectRoot, "docs", "README.en.md"), "utf8");
  const readmeZh = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
  const readmeEn = fs.readFileSync(path.join(projectRoot, "README.en.md"), "utf8");
  const examplesReadme = fs.readFileSync(path.join(projectRoot, "examples", "integrations", "README.md"), "utf8");

  for (const content of [zh, en]) {
    assert.match(content, /Server-side Node|Server-side|服务端|Server-side Node/i);
    assert.match(content, /Electron|desktop|桌面/i);
    assert.match(content, /Browser UI -> your backend\/API -> KnowMesh local service|Browser UI -> your backend|浏览器.*后端|Browser Apps Through a Backend/i);
    assert.match(content, /CI|smoke:sdk-consumer|smoke:live-sdk/);
    assert.match(content, /127\.0\.0\.1/);
    assert.match(content, /CORS|broad CORS|广域访问|远程访问/i);
    assert.match(content, /requestId|request id/i);
    assert.match(content, /KnowMeshApiError|retryable|重试/i);
    assert.match(content, /feedback\/summary|wrong_citation|missed_point|useful/);
    assert.match(content, /api\/openapi\.json/);
    assert.match(content, /api\/endpoint-manifest\.json/);
    assert.match(content, /do not|不要|不读取|not read/i);
  }

  assert.match(docsIndex, /integrations\.zh-CN\.md|应用集成指南/);
  assert.match(docsIndexEn, /integrations\.en\.md|Integration Guide/);
  assert.match(readmeZh, /docs\/integrations\.zh-CN\.md/);
  assert.match(readmeEn, /docs\/integrations\.en\.md/);
  assert.match(examplesReadme, /docs\/integrations\.en\.md/);
  assert.match(examplesReadme, /docs\/integrations\.zh-CN\.md/);
});

test("Block Q4 integration privacy audit passes current docs examples and SDK entry point", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const result = evaluateIntegrationPrivacy({ projectRoot });
  assert.equal(packageJson.scripts["verify:integration-privacy"], "node ./scripts/verify-integration-privacy.mjs");
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 0);
  for (const required of [
    "docs/integrations.zh-CN.md",
    "docs/integrations.en.md",
    "examples/integrations/README.md",
    "examples/integrations/node/query-runtime-client.mjs",
    "examples/integrations/http/query-runtime.http",
    "src/sdk/knowmesh-client.mjs"
  ]) {
    assert.ok(result.scanned.includes(required), `${required} should be audited`);
  }
  assert.deepEqual(integrationPrivacyAuditRoots, [
    "docs/integrations.zh-CN.md",
    "docs/integrations.en.md",
    "examples/integrations",
    "src/sdk/knowmesh-client.mjs"
  ]);
});

test("Block Q4 integration privacy audit rejects internal reads paths credentials raw provider logs and broad CORS", () => {
  const result = evaluateIntegrationPrivacy({
    files: [
      {
        path: "bad-recipe.md",
        content: [
          "const db = new Database('catalog.sqlite');",
          "const data = fs.readFileSync(path.join(root, 'artifacts', 'chunks.jsonl'));",
          "console.log('apiKey', apiKey, rawProviderResponse);",
          "Access-Control-Allow-Origin: *",
          "C:\\Users\\demo\\secret.txt",
          "sourceContent: private document text"
        ].join("\n")
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.findings.map((finding) => finding.rule).sort(),
    [
      "broadCors",
      "credentialLogging",
      "credentialLogging",
      "internalAssetRead",
      "localAbsolutePath",
      "privateContent",
      "sqliteAuthorityMention",
      "sqliteDirectRead"
    ].sort()
  );
});

test("Block Q5 Consumer Integration release evidence requires downstream adoption proofs", () => {
  assert.deepEqual(consumerIntegrationReleaseEvidenceChecklist.map((item) => item.key), [
    "installedSdkConsumerProof",
    "livePublicSampleSdkProof",
    "integrationRecipeProof",
    "privacyBoundaryAuditProof",
    "providerAwareNoCloudConsumerProof",
    "consumerPackageAssetReview"
  ]);

  const partial = evaluateConsumerIntegrationReleaseEvidence(completeIntegrationSdkEvidence());
  const complete = evaluateConsumerIntegrationReleaseEvidence(completeConsumerIntegrationEvidence());

  assert.equal(partial.releaseAllowed, false);
  assert.equal(partial.releaseStage, "0.7.0-consumer-integration");
  assert.ok(partial.missing.includes("installedSdkConsumerProof"));
  assert.ok(partial.missing.includes("livePublicSampleSdkProof"));
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.missing.length, 0);
});

test("Block Q5 release evidence generator emits Consumer Integration milestone evidence", () => {
  const generated = generateReleaseEvidence({
    stage: "consumer-integration",
    ...completeGeneratorOptions(),
    sdkConsumerSmoke: sdkConsumerSmokeEvidence(),
    liveSdkSampleSmoke: liveSdkSampleSmokeEvidence(),
    integrationPrivacyAudit: integrationPrivacyAuditEvidence(),
    integrationRecipeProof: {
      serverSideNode: true,
      electronLocalDesktop: true,
      browserBackend: true,
      ciSmoke: true,
      localhostCors: true,
      feedbackLinks: true
    }
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evaluation.releaseStage, "0.7.0-consumer-integration");
  assert.equal(generated.evidence.installedSdkConsumerProof.status, "pass");
  assert.equal(generated.evidence.livePublicSampleSdkProof.status, "pass");
  assert.equal(generated.evidence.integrationRecipeProof.status, "pass");
  assert.equal(generated.evidence.privacyBoundaryAuditProof.status, "pass");
  assert.equal(generated.evidence.providerAwareNoCloudConsumerProof.status, "pass");
  assert.equal(generated.evidence.consumerPackageAssetReview.status, "pass");
  assert.equal(evaluateConsumerIntegrationReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block Q5 release gate CLI can enforce consumer-integration-stage evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-consumer-integration-release-gate-"));
  const completePath = path.join(tempDir, "complete.json");
  const missingPath = path.join(tempDir, "missing.json");
  try {
    fs.writeFileSync(completePath, `${JSON.stringify(completeConsumerIntegrationEvidence(), null, 2)}\n`, "utf8");
    fs.writeFileSync(missingPath, `${JSON.stringify(completeIntegrationSdkEvidence(), null, 2)}\n`, "utf8");

    const blocked = spawnSync(process.execPath, [releaseGateScript, "--stage", "consumer-integration", "--evidence", missingPath], { encoding: "utf8" });
    const allowed = spawnSync(process.execPath, [releaseGateScript, "--consumer-integration", "--evidence", completePath], { encoding: "utf8" });

    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseStage": "0.7.0-consumer-integration"/);
    assert.match(blocked.stdout, /installedSdkConsumerProof/);
    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /"releaseAllowed": true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Block Q5 docs expose Consumer Integration release workflow and commands", () => {
  const combined = [
    "README.md",
    "README.en.md",
    "docs/release-candidate.zh-CN.md",
    "docs/release-candidate.en.md",
    "docs/release-operations.zh-CN.md",
    "docs/release-operations.en.md",
    "ROADMAP.md",
    "ROADMAP.en.md",
    "CHANGELOG.md"
  ].map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8")).join("\n\n");

  for (const phrase of [
    "0.7.0 Consumer Integration Proof",
    "installedSdkConsumerProof",
    "livePublicSampleSdkProof",
    "integrationRecipeProof",
    "privacyBoundaryAuditProof",
    "providerAwareNoCloudConsumerProof",
    "consumerPackageAssetReview",
    "smoke:sdk-consumer",
    "smoke:live-sdk",
    "verify:integration-privacy",
    "consumer-integration"
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), "i"), `${phrase} should be documented`);
  }
});

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

function completeIntegrationSdkEvidence() {
  return {
    ...baseReleaseEvidence(),
    ...publicBetaEvidence(),
    ...searchableEvidence(),
    ...queryRuntimeEvidence(),
    ...expertSdkEvidence(),
    ...providerAdaptersEvidence(),
    ...integrationSdkEvidence()
  };
}

function completeConsumerIntegrationEvidence() {
  return {
    ...completeIntegrationSdkEvidence(),
    ...consumerIntegrationEvidence()
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
    assetPaths: ["README.md", "docs/integrations.en.md", "src/sdk/knowmesh-client.mjs", "examples/integrations/README.md"],
    sourceAuditPaths: ["exports/consumer-integration-evidence.json"],
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
      livePublicSampleSdkFlow: {
        status: "pass",
        installedPackage: true,
        realHttp: true,
        answered: true,
        refused: true,
        search: true,
        feedback: true,
        providerDiagnostics: true,
        packagePreview: true,
        versionManifest: true,
        resetVerified: true
      },
      providerAwareNoCloudConsumer: {
        status: "pass",
        publicSample: true,
        credentialFree: true,
        externalCallsBlocked: true,
        localFallback: true
      }
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
      { key: "localAbsolutePath", status: "pass" },
      { key: "broadCors", status: "pass" },
      { key: "privateContent", status: "pass" }
    ]
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
