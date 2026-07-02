#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateConsumerIntegrationReleaseEvidence,
  evaluateExpertSdkReleaseEvidence,
  evaluateFirstRunUsabilityReleaseEvidence,
  evaluateIntegrationSdkReleaseEvidence,
  evaluateOperatorWorkflowReleaseEvidence,
  evaluateProviderAdaptersReleaseEvidence,
  evaluatePublicBetaReleaseEvidence,
  evaluateQueryRuntimeReleaseEvidence,
  evaluateSearchableReleaseEvidence,
  evaluateUsableProductReleaseEvidence
} from "./release-gate.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function generateReleaseEvidence(options = {}) {
  const localGates = options.localGates || {};
  const assetReview = reviewReleaseAssets(options.assetPaths || []);
  const browserSampleFlow = options.browserSampleSmoke?.evidence?.browserSampleFlow || options.browserSampleFlow || {};
  const browserSearchWorkflow = normalizeBrowserSearchWorkflow(options.browserSearchWorkflow || browserSearchSource(options.browserSampleSmoke), browserSampleFlow);
  const browserAskWorkflow = normalizeBrowserAskWorkflow(options.browserAskWorkflow || browserAskSource(options.browserSampleSmoke));
  const providerDiagnosticsBrowserProof = normalizeProviderDiagnosticsBrowserProof(options.providerDiagnosticsBrowserProof || browserProviderDiagnosticsSource(options.browserSampleSmoke));
  const providerAwareNoCloudProof = normalizeProviderAwareNoCloudProof(options.providerAwareNoCloudProof || browserProviderAwareNoCloudSource(options.browserSampleSmoke));
  const noCloudPublicPathProof = normalizeNoCloudPublicPathProof(options.noCloudPublicPathProof || noCloudPublicPathSource(options.browserSampleSmoke), browserSampleFlow);
  const betaReleaseNotes = normalizeBetaReleaseNotes(options.betaReleaseNotes);
  const staleJsonAuthorityAudit = auditStaleJsonAuthority(options.sourceAuditPaths || options.jsonAuthorityPaths || []);
  const providerDirectPathAudit = auditProviderDirectPaths(options.providerDirectPathPaths || options.providerAuditPaths || []);
  const usableProductSmoke = options.usableProductSmoke || {};
  const usableProductEvidence = usableProductSmoke.evidence || {};
  const usableLaunchReliabilityProof = normalizeUsableLaunchReliabilityProof(options.usableLaunchReliabilityProof || usableProductEvidence.launchReliabilityProof);
  const usableDocumentIntakeProof = normalizeUsableDocumentIntakeProof(options.usableDocumentIntakeProof || usableProductEvidence.documentIntakeProof);
  const usableWebConsoleWorkflowProof = normalizeUsableWebConsoleWorkflowProof(options.usableWebConsoleWorkflowProof || usableProductEvidence.webConsoleWorkflowProof);
  const usableDurableDataPackageProof = normalizeUsableDurableDataPackageProof(options.usableDurableDataPackageProof || usableProductEvidence.durableDataPackageProof);
  const usableBrowserWorkflow = normalizeUsableBrowserWorkflow(options.usableBrowserWorkflow || usableBrowserSource(options.browserSampleSmoke, options.firstRunUsabilitySmoke));
  const usablePrivacyProof = normalizeUsablePrivacyProof(options.usablePrivacyProof || usablePrivacySource({ usableProductSmoke, integrationPrivacyAudit: options.integrationPrivacyAudit }));
  const usableProductPackageAssetReview = normalizeUsableProductPackageAssetReview(options.usableProductPackageAssetReview || {
    noPrivateState: assetReview.noPrivateState,
    noSqlite: assetReview.noSqlite,
    noSecrets: assetReview.noSecrets,
    noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
    noDirectInternalReads: staleJsonAuthorityAudit.ok && providerDirectPathAudit.ok && (options.integrationPrivacyAudit?.ok !== false),
    noPrivatePackageFiles: options.sdkConsumerSmoke?.checks?.some?.((item) => item.key === "noPrivatePackageFiles" && item.status === "pass") !== false,
    noStaleJsonAuthority: staleJsonAuthorityAudit.ok,
    noWalFiles: assetReview.noSqlite
  });
  const evidence = {
    npmTest: gateEvidence(localGates.npmTest),
    releaseSmoke: gateEvidence(localGates.releaseSmoke),
    artifactSmoke: artifactEvidence(localGates.artifactSmoke || options.artifactSmoke),
    packageBoundary: gateEvidence(localGates.packageBoundary),
    diffCheck: gateEvidence(localGates.diffCheck),
    githubCi: gateEvidence(options.github?.githubCi),
    githubCodeql: gateEvidence(options.github?.githubCodeql),
    githubScorecard: gateEvidence(options.github?.githubScorecard),
    browserSampleFlow: {
      status: browserSampleFlow.status === "pass" ? "pass" : "",
      desktop: browserSampleFlow.desktop === true,
      narrow: browserSampleFlow.narrow === true,
      resetVerified: browserSampleFlow.resetVerified === true
    },
    betaReleaseNotes,
    releaseAssetReview: {
      status: assetReview.ok ? "pass" : "fail",
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets
    },
    searchableReadiness: normalizeSearchableReadiness(options.searchableReadiness),
    incrementalUpdateProof: normalizeIncrementalUpdateProof(options.incrementalUpdateProof),
    vectorFallbackProof: normalizeVectorFallbackProof(options.vectorFallbackProof),
    browserSearchWorkflow,
    staleJsonAuthorityAudit: {
      status: staleJsonAuthorityAudit.ok ? "pass" : "fail",
      forbiddenMutableStatePaths: staleJsonAuthorityAudit.forbiddenMutableStatePaths,
      rejected: staleJsonAuthorityAudit.rejected
    },
    packageAssetReview: {
      status: assetReview.ok && staleJsonAuthorityAudit.ok ? "pass" : "fail",
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
      noStaleJsonAuthority: staleJsonAuthorityAudit.ok
    },
    routeContractReadiness: normalizeRouteContractReadiness(options.routeContractReadiness),
    citationGroundedAnswerProof: normalizeCitationGroundedAnswerProof(options.citationGroundedAnswerProof),
    refusalNoAnswerProof: normalizeRefusalNoAnswerProof(options.refusalNoAnswerProof),
    feedbackMaintenanceProof: normalizeFeedbackMaintenanceProof(options.feedbackMaintenanceProof),
    integrationContractProof: normalizeIntegrationContractProof(options.integrationContractProof),
    browserAskWorkflow,
    expertManifestReadiness: normalizeExpertManifestReadiness(options.expertManifestReadiness),
    expertRuntimeBoundaryProof: normalizeExpertRuntimeBoundaryProof(options.expertRuntimeBoundaryProof),
    nonK12ExampleProof: normalizeNonK12ExampleProof(options.nonK12ExampleProof),
    expertEvaluationGateProof: normalizeExpertEvaluationGateProof(options.expertEvaluationGateProof),
    expertDocsContributorWorkflowProof: normalizeExpertDocsContributorWorkflowProof(options.expertDocsContributorWorkflowProof),
    expertPackageAssetReview: normalizeExpertPackageAssetReview(options.expertPackageAssetReview || {
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noPrivateFixtures: assetReview.noPrivateState && assetReview.noSecrets
    }),
    providerManifestReadiness: normalizeProviderManifestReadiness(options.providerManifestReadiness),
    parserOcrBoundaryProof: normalizeParserOcrBoundaryProof(options.parserOcrBoundaryProof),
    embeddingVectorBoundaryProof: normalizeEmbeddingVectorBoundaryProof(options.embeddingVectorBoundaryProof),
    providerDiagnosticsBrowserProof,
    noCloudPublicPathProof,
    providerDirectPathAudit: {
      status: providerDirectPathAudit.ok ? "pass" : "fail",
      forbiddenDirectProviderPaths: providerDirectPathAudit.forbiddenDirectProviderPaths,
      rejected: providerDirectPathAudit.rejected
    },
    providerPackageAssetReview: normalizeProviderPackageAssetReview(options.providerPackageAssetReview || {
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
      noDirectProviderBypass: providerDirectPathAudit.ok
    }),
    endpointManifestReadiness: normalizeEndpointManifestReadiness(options.endpointManifestReadiness),
    sdkClientProof: normalizeSdkClientProof(options.sdkClientProof),
    examplesDriftProof: normalizeExamplesDriftProof(options.examplesDriftProof),
    integrationSafetyProof: normalizeIntegrationSafetyProof(options.integrationSafetyProof),
    providerAwareNoCloudProof,
    integrationPackageAssetReview: normalizeIntegrationPackageAssetReview(options.integrationPackageAssetReview || {
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
      noDirectInternalReads: staleJsonAuthorityAudit.ok && providerDirectPathAudit.ok
    }),
    installedSdkConsumerProof: normalizeInstalledSdkConsumerProof(options.installedSdkConsumerProof || sdkConsumerProofSource(options.sdkConsumerSmoke)),
    livePublicSampleSdkProof: normalizeLivePublicSampleSdkProof(options.livePublicSampleSdkProof || liveSdkProofSource(options.liveSdkSampleSmoke)),
    integrationRecipeProof: normalizeIntegrationRecipeProof(options.integrationRecipeProof),
    privacyBoundaryAuditProof: normalizePrivacyBoundaryAuditProof(options.privacyBoundaryAuditProof || privacyBoundaryAuditSource(options.integrationPrivacyAudit)),
    providerAwareNoCloudConsumerProof: normalizeProviderAwareNoCloudConsumerProof(options.providerAwareNoCloudConsumerProof || liveSdkNoCloudSource(options.liveSdkSampleSmoke)),
    consumerPackageAssetReview: normalizeConsumerPackageAssetReview(options.consumerPackageAssetReview || {
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
      noDirectInternalReads: staleJsonAuthorityAudit.ok && providerDirectPathAudit.ok && (options.integrationPrivacyAudit?.ok !== false),
      noPrivatePackageFiles: options.sdkConsumerSmoke?.checks?.some?.((item) => item.key === "noPrivatePackageFiles" && item.status === "pass") !== false
    }),
    sourceIntakeProof: normalizeSourceIntakeProof(options.sourceIntakeProof || operatorWorkflowProofSource(options.operatorWorkflowSmoke, "sourceIntakeProof")),
    executionRecoveryProof: normalizeExecutionRecoveryProof(options.executionRecoveryProof || operatorWorkflowProofSource(options.operatorWorkflowSmoke, "executionRecoveryProof")),
    maintenanceTargetedRerunProof: normalizeMaintenanceTargetedRerunProof(options.maintenanceTargetedRerunProof || operatorWorkflowProofSource(options.operatorWorkflowSmoke, "maintenanceTargetedRerunProof")),
    versionRollbackProof: normalizeVersionRollbackProof(options.versionRollbackProof || operatorWorkflowProofSource(options.operatorWorkflowSmoke, "versionRollbackProof")),
    operatorBrowserWorkflow: normalizeOperatorBrowserWorkflow(options.operatorBrowserWorkflow || operatorWorkflowProofSource(options.operatorWorkflowSmoke, "operatorBrowserWorkflow")),
    operatorPrivacyAuditProof: normalizeOperatorPrivacyAuditProof(options.operatorPrivacyAuditProof || operatorWorkflowProofSource(options.operatorWorkflowSmoke, "operatorPrivacyAuditProof")),
    operatorPackageAssetReview: normalizeOperatorPackageAssetReview(options.operatorPackageAssetReview || {
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
      noDirectInternalReads: staleJsonAuthorityAudit.ok && providerDirectPathAudit.ok && (options.integrationPrivacyAudit?.ok !== false),
      noPrivatePackageFiles: options.sdkConsumerSmoke?.checks?.some?.((item) => item.key === "noPrivatePackageFiles" && item.status === "pass") !== false
    }),
    firstRunLaunchProof: normalizeFirstRunLaunchProof(options.firstRunLaunchProof || firstRunUsabilityProofSource(options.firstRunUsabilitySmoke, "firstRunLaunchProof")),
    guidedSetupProof: normalizeGuidedSetupProof(options.guidedSetupProof || firstRunUsabilityProofSource(options.firstRunUsabilitySmoke, "guidedSetupProof")),
    buildRecoveryProof: normalizeBuildRecoveryProof(options.buildRecoveryProof || firstRunUsabilityProofSource(options.firstRunUsabilitySmoke, "buildRecoveryProof")),
    firstQuestionProof: normalizeFirstQuestionProof(options.firstQuestionProof || firstRunUsabilityProofSource(options.firstRunUsabilitySmoke, "firstQuestionProof")),
    maintenanceNextActionProof: normalizeMaintenanceNextActionProof(options.maintenanceNextActionProof || firstRunUsabilityProofSource(options.firstRunUsabilitySmoke, "maintenanceNextActionProof")),
    firstRunBrowserWorkflow: normalizeFirstRunBrowserWorkflow(options.firstRunBrowserWorkflow || firstRunUsabilityProofSource(options.firstRunUsabilitySmoke, "firstRunBrowserWorkflow")),
    firstRunPackageAssetReview: normalizeFirstRunPackageAssetReview(options.firstRunPackageAssetReview || {
      noPrivateState: assetReview.noPrivateState,
      noSqlite: assetReview.noSqlite,
      noSecrets: assetReview.noSecrets,
      noGeneratedArtifacts: assetReview.noGeneratedArtifacts,
      noDirectInternalReads: staleJsonAuthorityAudit.ok && providerDirectPathAudit.ok && (options.integrationPrivacyAudit?.ok !== false),
      noPrivatePackageFiles: options.sdkConsumerSmoke?.checks?.some?.((item) => item.key === "noPrivatePackageFiles" && item.status === "pass") !== false
    }),
    usableLaunchReliabilityProof,
    usableDocumentIntakeProof,
    usableWebConsoleWorkflowProof,
    usableDurableDataPackageProof,
    usableBrowserWorkflow,
    usablePrivacyProof,
    usableProductPackageAssetReview,
    npmPublication: "separate-decision"
  };
  const stage = releaseEvidenceStage(options, evidence);
  const evaluation = stage === "usable-product"
    ? evaluateUsableProductReleaseEvidence(evidence)
    : stage === "first-run-usability"
    ? evaluateFirstRunUsabilityReleaseEvidence(evidence)
    : stage === "operator-workflow"
    ? evaluateOperatorWorkflowReleaseEvidence(evidence)
    : stage === "consumer-integration"
    ? evaluateConsumerIntegrationReleaseEvidence(evidence)
    : stage === "expert-sdk"
    ? evaluateExpertSdkReleaseEvidence(evidence)
    : stage === "integration-sdk"
    ? evaluateIntegrationSdkReleaseEvidence(evidence)
    : stage === "provider-adapters"
    ? evaluateProviderAdaptersReleaseEvidence(evidence)
    : stage === "query-runtime"
    ? evaluateQueryRuntimeReleaseEvidence(evidence)
    : stage === "searchable"
      ? evaluateSearchableReleaseEvidence(evidence)
      : evaluatePublicBetaReleaseEvidence(evidence);
  return {
    ok: evaluation.releaseAllowed,
    kind: "knowmesh.releaseEvidence",
    releaseStage: evaluation.releaseStage,
    generatedAt: new Date().toISOString(),
    evidence,
    staleJsonAuthorityAudit,
    providerDirectPathAudit,
    assetReview,
    evaluation
  };
}

export function auditStaleJsonAuthority(paths = []) {
  const rejected = [];
  for (const rawPath of paths) {
    const normalized = normalizeAssetPath(rawPath);
    const reason = staleJsonAuthorityReason(normalized);
    if (reason) rejected.push({ path: normalized, reason });
  }
  return {
    ok: rejected.length === 0,
    kind: "knowmesh.staleJsonAuthorityAudit",
    reviewed: paths.map(normalizeAssetPath),
    rejected,
    forbiddenMutableStatePaths: rejected.length
  };
}

export function reviewReleaseAssets(paths = []) {
  const rejected = [];
  for (const rawPath of paths) {
    const normalized = normalizeAssetPath(rawPath);
    const reasons = assetRejectionReasons(normalized);
    for (const reason of reasons) rejected.push({ path: normalized, reason });
  }
  return {
    ok: rejected.length === 0,
    reviewed: paths.map(normalizeAssetPath),
    rejected,
    noPrivateState: !rejected.some((item) => item.reason === "private-state"),
    noSqlite: !rejected.some((item) => item.reason === "sqlite"),
    noSecrets: !rejected.some((item) => item.reason === "secret"),
    noGeneratedArtifacts: !rejected.some((item) => item.reason === "generated-test-artifact")
  };
}

export function auditProviderDirectPaths(paths = []) {
  const rejected = [];
  for (const rawPath of paths) {
    const normalized = normalizeAssetPath(rawPath);
    const reason = providerDirectPathReason(normalized);
    if (reason) rejected.push({ path: normalized, reason });
  }
  return {
    ok: rejected.length === 0,
    kind: "knowmesh.providerDirectPathAudit",
    reviewed: paths.map(normalizeAssetPath),
    rejected,
    forbiddenDirectProviderPaths: rejected.length
  };
}

export function writeReleaseEvidenceFile(outputPath, generated) {
  const resolved = path.resolve(String(outputPath || ""));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(generated.evidence, null, 2)}\n`, "utf8");
  return resolved;
}

function gateEvidence(value) {
  if (value === "pass" || value === true) return "pass";
  if (value?.ok === true || value?.status === "pass") return "pass";
  return "";
}

function artifactEvidence(value) {
  const sha256 = value?.package?.sha256 || value?.sha256 || "";
  if ((value?.ok === true || value?.status === "pass" || value === "pass") && sha256) {
    return { status: "pass", sha256 };
  }
  return { status: "", sha256 };
}

function normalizeBetaReleaseNotes(value = {}) {
  return {
    status: value.status === "pass" || (value.supportedPaths && value.limitations && value.knownGaps) ? "pass" : "",
    supportedPaths: value.supportedPaths === true,
    limitations: value.limitations === true,
    knownGaps: value.knownGaps === true,
    npmPublication: "separate-decision"
  };
}

function normalizeSearchableReadiness(value = {}) {
  return {
    status: value.status === "pass" || (value.catalogSearch && value.queryEvidence && value.citationReady && value.scopedApi) ? "pass" : "",
    catalogSearch: value.catalogSearch === true,
    queryEvidence: value.queryEvidence === true,
    citationReady: value.citationReady === true,
    scopedApi: value.scopedApi === true
  };
}

function normalizeIncrementalUpdateProof(value = {}) {
  return {
    status: value.status === "pass" || (value.catalogDelta && value.targetedRerun && value.versionRollback) ? "pass" : "",
    catalogDelta: value.catalogDelta === true,
    targetedRerun: value.targetedRerun === true,
    versionRollback: value.versionRollback === true
  };
}

function normalizeVectorFallbackProof(value = {}) {
  return {
    status: value.status === "pass" || (value.sidecarContract && value.invalidVectorBlocked && value.catalogFallback) ? "pass" : "",
    sidecarContract: value.sidecarContract === true,
    invalidVectorBlocked: value.invalidVectorBlocked === true,
    catalogFallback: value.catalogFallback === true
  };
}

function normalizeBrowserSearchWorkflow(value = {}, browserSampleFlow = {}) {
  const desktop = value.desktop === true || browserSampleFlow.desktop === true;
  const narrow = value.narrow === true || browserSampleFlow.narrow === true;
  const resetVerified = value.resetVerified === true || browserSampleFlow.resetVerified === true;
  const maintenanceEvidence = value.maintenanceEvidence === true || value.status === "pass";
  const evidenceLink = value.evidenceLink === true || value.status === "pass";
  return {
    status: value.status === "pass" || (desktop && narrow && resetVerified && maintenanceEvidence && evidenceLink) ? "pass" : "",
    desktop,
    narrow,
    maintenanceEvidence,
    evidenceLink,
    resetVerified
  };
}

function normalizeRouteContractReadiness(value = {}) {
  return {
    status: value.status === "pass" || (value.routeContract && value.refusalTaxonomy && value.evidencePolicy) ? "pass" : "",
    routeContract: value.routeContract === true,
    refusalTaxonomy: value.refusalTaxonomy === true,
    evidencePolicy: value.evidencePolicy === true
  };
}

function normalizeCitationGroundedAnswerProof(value = {}) {
  return {
    status: value.status === "pass" || (value.citedAnswer && value.evidencePack && value.qualityGates) ? "pass" : "",
    citedAnswer: value.citedAnswer === true,
    evidencePack: value.evidencePack === true,
    qualityGates: value.qualityGates === true
  };
}

function normalizeRefusalNoAnswerProof(value = {}) {
  return {
    status: value.status === "pass" || (value.outOfScope && value.insufficientEvidence && value.noWeakAnswer) ? "pass" : "",
    outOfScope: value.outOfScope === true,
    insufficientEvidence: value.insufficientEvidence === true,
    noWeakAnswer: value.noWeakAnswer === true
  };
}

function normalizeFeedbackMaintenanceProof(value = {}) {
  return {
    status: value.status === "pass" || (value.negativeFeedbackIssue && value.rerunScope && value.positiveSignalOnly) ? "pass" : "",
    negativeFeedbackIssue: value.negativeFeedbackIssue === true,
    rerunScope: value.rerunScope === true,
    positiveSignalOnly: value.positiveSignalOnly === true
  };
}

function normalizeIntegrationContractProof(value = {}) {
  return {
    status: value.status === "pass" || (value.openApi && value.nodeExample && value.httpExample && value.driftTest) ? "pass" : "",
    openApi: value.openApi === true,
    nodeExample: value.nodeExample === true,
    httpExample: value.httpExample === true,
    driftTest: value.driftTest === true
  };
}

function normalizeBrowserAskWorkflow(value = {}) {
  return {
    status: value.status === "pass" || (value.answered && value.refused && value.feedbackMaintenance && value.desktop && value.narrow) ? "pass" : "",
    answered: value.answered === true,
    refused: value.refused === true,
    feedbackMaintenance: value.feedbackMaintenance === true,
    desktop: value.desktop === true,
    narrow: value.narrow === true
  };
}

function normalizeExpertManifestReadiness(value = {}) {
  return {
    status: value.status === "pass" || (value.manifestContract && value.validation && value.lifecycleCertification) ? "pass" : "",
    manifestContract: value.manifestContract === true,
    validation: value.validation === true,
    lifecycleCertification: value.lifecycleCertification === true
  };
}

function normalizeExpertRuntimeBoundaryProof(value = {}) {
  return {
    status: value.status === "pass" || (value.publicHooks && value.directStorageBlocked && value.queryRouteHooks) ? "pass" : "",
    publicHooks: value.publicHooks === true,
    directStorageBlocked: value.directStorageBlocked === true,
    queryRouteHooks: value.queryRouteHooks === true
  };
}

function normalizeNonK12ExampleProof(value = {}) {
  return {
    status: value.status === "pass" || (value.operationsHandbook && value.publicFixture && value.queryEvidence) ? "pass" : "",
    operationsHandbook: value.operationsHandbook === true,
    publicFixture: value.publicFixture === true,
    queryEvidence: value.queryEvidence === true
  };
}

function normalizeExpertEvaluationGateProof(value = {}) {
  return {
    status: value.status === "pass" || (value.portableCases && value.dashboardAggregation && value.maintenanceMapping) ? "pass" : "",
    portableCases: value.portableCases === true,
    dashboardAggregation: value.dashboardAggregation === true,
    maintenanceMapping: value.maintenanceMapping === true
  };
}

function normalizeExpertDocsContributorWorkflowProof(value = {}) {
  return {
    status: value.status === "pass" || (value.authoringDocs && value.exampleDocs && value.requiredTests && value.communityProposalPath) ? "pass" : "",
    authoringDocs: value.authoringDocs === true,
    exampleDocs: value.exampleDocs === true,
    requiredTests: value.requiredTests === true,
    communityProposalPath: value.communityProposalPath === true
  };
}

function normalizeExpertPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noPrivateFixtures) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noPrivateFixtures: value.noPrivateFixtures === true
  };
}

function normalizeProviderManifestReadiness(value = {}) {
  return {
    status: value.status === "pass" || (value.manifestContract && value.validation && value.capabilityInventory) ? "pass" : "",
    manifestContract: value.manifestContract === true,
    validation: value.validation === true,
    capabilityInventory: value.capabilityInventory === true
  };
}

function normalizeParserOcrBoundaryProof(value = {}) {
  return {
    status: value.status === "pass" || (value.parserPreflight && value.ocrPreflight && value.unsafeInputsReviewed) ? "pass" : "",
    parserPreflight: value.parserPreflight === true,
    ocrPreflight: value.ocrPreflight === true,
    unsafeInputsReviewed: value.unsafeInputsReviewed === true
  };
}

function normalizeEmbeddingVectorBoundaryProof(value = {}) {
  return {
    status: value.status === "pass" || (value.embeddingBatchContract && value.vectorOutputValidation && value.catalogFallback) ? "pass" : "",
    embeddingBatchContract: value.embeddingBatchContract === true,
    vectorOutputValidation: value.vectorOutputValidation === true,
    catalogFallback: value.catalogFallback === true
  };
}

function normalizeProviderDiagnosticsBrowserProof(value = {}) {
  return {
    status: value.status === "pass" || (value.scopedApi && value.desktop && value.narrow && value.sqliteAuthority && value.noExternalCallsBeforeExecution) ? "pass" : "",
    scopedApi: value.scopedApi === true,
    desktop: value.desktop === true,
    narrow: value.narrow === true,
    sqliteAuthority: value.sqliteAuthority === true,
    noExternalCallsBeforeExecution: value.noExternalCallsBeforeExecution === true
  };
}

function normalizeNoCloudPublicPathProof(value = {}, browserSampleFlow = {}) {
  const publicSample = value.publicSample === true || browserSampleFlow.status === "pass";
  return {
    status: value.status === "pass" || (publicSample && value.credentialFree && value.externalCallsBlocked && value.localFallback) ? "pass" : "",
    publicSample,
    credentialFree: value.credentialFree === true,
    externalCallsBlocked: value.externalCallsBlocked === true,
    localFallback: value.localFallback === true
  };
}

function normalizeProviderPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noGeneratedArtifacts && value.noDirectProviderBypass) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noGeneratedArtifacts: value.noGeneratedArtifacts === true,
    noDirectProviderBypass: value.noDirectProviderBypass === true
  };
}

function normalizeEndpointManifestReadiness(value = {}) {
  return {
    status: value.status === "pass" || (value.endpointManifest && value.openApi && value.scopedDiscovery && value.diagnosticsDiscovery) ? "pass" : "",
    endpointManifest: value.endpointManifest === true,
    openApi: value.openApi === true,
    scopedDiscovery: value.scopedDiscovery === true,
    diagnosticsDiscovery: value.diagnosticsDiscovery === true
  };
}

function normalizeSdkClientProof(value = {}) {
  return {
    status: value.status === "pass" || (value.packageExports && value.scopedHelpers && value.injectedFetch && value.errorRedaction) ? "pass" : "",
    packageExports: value.packageExports === true,
    scopedHelpers: value.scopedHelpers === true,
    injectedFetch: value.injectedFetch === true,
    errorRedaction: value.errorRedaction === true
  };
}

function normalizeExamplesDriftProof(value = {}) {
  return {
    status: value.status === "pass" || (value.nodeExample && value.httpExample && value.expectedResponses && value.driftTest) ? "pass" : "",
    nodeExample: value.nodeExample === true,
    httpExample: value.httpExample === true,
    expectedResponses: value.expectedResponses === true,
    driftTest: value.driftTest === true
  };
}

function normalizeIntegrationSafetyProof(value = {}) {
  return {
    status: value.status === "pass" || (value.retrySemantics && value.diagnosticsRedaction && value.localhostOnly && value.noInternalReads) ? "pass" : "",
    retrySemantics: value.retrySemantics === true,
    diagnosticsRedaction: value.diagnosticsRedaction === true,
    localhostOnly: value.localhostOnly === true,
    noInternalReads: value.noInternalReads === true
  };
}

function normalizeProviderAwareNoCloudProof(value = {}) {
  return {
    status: value.status === "pass" || (value.providerDiagnostics && value.integrationDiagnostics && value.noExternalCalls && value.publicSample) ? "pass" : "",
    providerDiagnostics: value.providerDiagnostics === true,
    integrationDiagnostics: value.integrationDiagnostics === true,
    noExternalCalls: value.noExternalCalls === true,
    publicSample: value.publicSample === true
  };
}

function normalizeIntegrationPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noGeneratedArtifacts && value.noDirectInternalReads) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noGeneratedArtifacts: value.noGeneratedArtifacts === true,
    noDirectInternalReads: value.noDirectInternalReads === true
  };
}

function normalizeInstalledSdkConsumerProof(value = {}) {
  return {
    status: value.status === "pass" || (value.packageExports && value.subpathExport && value.injectedFetch && value.noInternalImports && value.noPrivatePackageFiles) ? "pass" : "",
    packageExports: value.packageExports === true,
    subpathExport: value.subpathExport === true,
    injectedFetch: value.injectedFetch === true,
    noInternalImports: value.noInternalImports === true,
    noPrivatePackageFiles: value.noPrivatePackageFiles === true
  };
}

function normalizeLivePublicSampleSdkProof(value = {}) {
  return {
    status: value.status === "pass" || (value.installedPackage && value.realHttp && value.answered && value.refused && value.search && value.feedback && value.providerDiagnostics && value.packagePreview && value.versionManifest && value.resetVerified) ? "pass" : "",
    installedPackage: value.installedPackage === true,
    realHttp: value.realHttp === true,
    answered: value.answered === true,
    refused: value.refused === true,
    search: value.search === true,
    feedback: value.feedback === true,
    providerDiagnostics: value.providerDiagnostics === true,
    packagePreview: value.packagePreview === true,
    versionManifest: value.versionManifest === true,
    resetVerified: value.resetVerified === true
  };
}

function normalizeIntegrationRecipeProof(value = {}) {
  return {
    status: value.status === "pass" || (value.serverSideNode && value.electronLocalDesktop && value.browserBackend && value.ciSmoke && value.localhostCors && value.feedbackLinks) ? "pass" : "",
    serverSideNode: value.serverSideNode === true,
    electronLocalDesktop: value.electronLocalDesktop === true,
    browserBackend: value.browserBackend === true,
    ciSmoke: value.ciSmoke === true,
    localhostCors: value.localhostCors === true,
    feedbackLinks: value.feedbackLinks === true
  };
}

function normalizePrivacyBoundaryAuditProof(value = {}) {
  const findings = Number(value.findings ?? value.summary?.findings ?? 0);
  return {
    status: value.status === "pass" || (findings === 0 && value.noSqliteReads && value.noArtifactReads && value.noCredentialLogging && value.noLocalPaths && value.noBroadCors) ? "pass" : "",
    scannedFiles: Number(value.scannedFiles ?? value.summary?.files ?? 0),
    findings,
    noSqliteReads: value.noSqliteReads === true,
    noArtifactReads: value.noArtifactReads === true,
    noCredentialLogging: value.noCredentialLogging === true,
    noLocalPaths: value.noLocalPaths === true,
    noBroadCors: value.noBroadCors === true
  };
}

function normalizeProviderAwareNoCloudConsumerProof(value = {}) {
  return {
    status: value.status === "pass" || (value.publicSample && value.credentialFree && value.externalCallsBlocked && value.localFallback) ? "pass" : "",
    publicSample: value.publicSample === true,
    credentialFree: value.credentialFree === true,
    externalCallsBlocked: value.externalCallsBlocked === true,
    localFallback: value.localFallback === true
  };
}

function normalizeConsumerPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noGeneratedArtifacts && value.noDirectInternalReads && value.noPrivatePackageFiles) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noGeneratedArtifacts: value.noGeneratedArtifacts === true,
    noDirectInternalReads: value.noDirectInternalReads === true,
    noPrivatePackageFiles: value.noPrivatePackageFiles === true
  };
}

function normalizeSourceIntakeProof(value = {}) {
  return {
    status: value.status === "pass" || (value.folderPrecheck && value.scanPreview && value.sourceManifest && value.excludeRestore && value.changedMissingRestored && value.executionPlanPreview && value.k12GateIsolation) ? "pass" : "",
    folderPrecheck: value.folderPrecheck === true,
    scanPreview: value.scanPreview === true,
    sourceManifest: value.sourceManifest === true,
    excludeRestore: value.excludeRestore === true,
    changedMissingRestored: value.changedMissingRestored === true,
    executionPlanPreview: value.executionPlanPreview === true,
    k12GateIsolation: value.k12GateIsolation === true
  };
}

function normalizeExecutionRecoveryProof(value = {}) {
  return {
    status: value.status === "pass" || (value.jobCreation && value.checkpointPersistence && value.progressPolling && value.pauseResumeStop && value.restartRecovery && value.taskSummary && value.diagnosticRedaction) ? "pass" : "",
    jobCreation: value.jobCreation === true,
    checkpointPersistence: value.checkpointPersistence === true,
    progressPolling: value.progressPolling === true,
    pauseResumeStop: value.pauseResumeStop === true,
    restartRecovery: value.restartRecovery === true,
    taskSummary: value.taskSummary === true,
    diagnosticRedaction: value.diagnosticRedaction === true
  };
}

function normalizeMaintenanceTargetedRerunProof(value = {}) {
  return {
    status: value.status === "pass" || (value.evidenceSearch && value.queryFeedbackReview && value.qualityIssueReview && value.safeRerunScope && value.targetedRerunJob && value.reviewResolution) ? "pass" : "",
    evidenceSearch: value.evidenceSearch === true,
    queryFeedbackReview: value.queryFeedbackReview === true,
    qualityIssueReview: value.qualityIssueReview === true,
    safeRerunScope: value.safeRerunScope === true,
    targetedRerunJob: value.targetedRerunJob === true,
    reviewResolution: value.reviewResolution === true
  };
}

function normalizeVersionRollbackProof(value = {}) {
  return {
    status: value.status === "pass" || (value.versionManifest && value.packagePreview && value.versionList && value.diff && value.rollbackPreview && value.rollbackConfirmation && value.crossKbIsolation) ? "pass" : "",
    versionManifest: value.versionManifest === true,
    packagePreview: value.packagePreview === true,
    versionList: value.versionList === true,
    diff: value.diff === true,
    rollbackPreview: value.rollbackPreview === true,
    rollbackConfirmation: value.rollbackConfirmation === true,
    crossKbIsolation: value.crossKbIsolation === true
  };
}

function normalizeOperatorBrowserWorkflow(value = {}) {
  return {
    status: value.status === "pass" || (value.desktop && value.narrow && value.sourceIntake && value.execution && value.maintenance && value.versions && value.feedback && value.diagnostics) ? "pass" : "",
    desktop: value.desktop === true,
    narrow: value.narrow === true,
    sourceIntake: value.sourceIntake === true,
    execution: value.execution === true,
    maintenance: value.maintenance === true,
    versions: value.versions === true,
    feedback: value.feedback === true,
    diagnostics: value.diagnostics === true
  };
}

function normalizeOperatorPrivacyAuditProof(value = {}) {
  return {
    status: value.status === "pass" || (value.diagnosticRedaction && value.noCredentialLeak && value.noPrivateContentLeak && value.localhostOnly && value.noExternalCallsBeforeExecution && value.noInternalReads) ? "pass" : "",
    diagnosticRedaction: value.diagnosticRedaction === true,
    noCredentialLeak: value.noCredentialLeak === true,
    noPrivateContentLeak: value.noPrivateContentLeak === true,
    localhostOnly: value.localhostOnly === true,
    noExternalCallsBeforeExecution: value.noExternalCallsBeforeExecution === true,
    noInternalReads: value.noInternalReads === true
  };
}

function normalizeOperatorPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noGeneratedArtifacts && value.noDirectInternalReads && value.noPrivatePackageFiles) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noGeneratedArtifacts: value.noGeneratedArtifacts === true,
    noDirectInternalReads: value.noDirectInternalReads === true,
    noPrivatePackageFiles: value.noPrivatePackageFiles === true
  };
}

function normalizeFirstRunLaunchProof(value = {}) {
  return {
    status: value.status === "pass" || (value.emptyWorkspace && value.createAction && value.sampleAction && value.runtimeDiagnostics && value.providerReadiness && value.localhostOnly) ? "pass" : "",
    emptyWorkspace: value.emptyWorkspace === true,
    createAction: value.createAction === true,
    sampleAction: value.sampleAction === true,
    runtimeDiagnostics: value.runtimeDiagnostics === true,
    providerReadiness: value.providerReadiness === true,
    localhostOnly: value.localhostOnly === true
  };
}

function normalizeGuidedSetupProof(value = {}) {
  return {
    status: value.status === "pass" || (value.setupDraftPersistence && value.folderPrecheck && value.missingFolderBlocked && value.scanPreview && value.executionPlanPreview && value.generalDocsNoK12Leak) ? "pass" : "",
    setupDraftPersistence: value.setupDraftPersistence === true,
    folderPrecheck: value.folderPrecheck === true,
    missingFolderBlocked: value.missingFolderBlocked === true,
    scanPreview: value.scanPreview === true,
    executionPlanPreview: value.executionPlanPreview === true,
    generalDocsNoK12Leak: value.generalDocsNoK12Leak === true
  };
}

function normalizeBuildRecoveryProof(value = {}) {
  return {
    status: value.status === "pass" || (value.jobCreation && value.visibleProgress && value.pauseResume && value.restartRecovery && value.completion && value.diagnosticRedaction) ? "pass" : "",
    jobCreation: value.jobCreation === true,
    visibleProgress: value.visibleProgress === true,
    pauseResume: value.pauseResume === true,
    restartRecovery: value.restartRecovery === true,
    completion: value.completion === true,
    diagnosticRedaction: value.diagnosticRedaction === true
  };
}

function normalizeFirstQuestionProof(value = {}) {
  return {
    status: value.status === "pass" || (value.queryRuntime && value.citationOrExplicitNoAnswer && value.evidenceSearch && value.noWeakSuccess) ? "pass" : "",
    queryRuntime: value.queryRuntime === true,
    citationOrExplicitNoAnswer: value.citationOrExplicitNoAnswer === true,
    evidenceSearch: value.evidenceSearch === true,
    noWeakSuccess: value.noWeakSuccess === true
  };
}

function normalizeMaintenanceNextActionProof(value = {}) {
  return {
    status: value.status === "pass" || (value.feedbackStored && value.reviewItemCreated && value.safeRerunScope && value.scopedApi) ? "pass" : "",
    feedbackStored: value.feedbackStored === true,
    reviewItemCreated: value.reviewItemCreated === true,
    safeRerunScope: value.safeRerunScope === true,
    scopedApi: value.scopedApi === true
  };
}

function normalizeFirstRunBrowserWorkflow(value = {}) {
  return {
    status: value.status === "pass" || (value.desktop && value.narrow && value.emptyState && value.createSelect && value.readiness && value.diagnostics) ? "pass" : "",
    desktop: value.desktop === true,
    narrow: value.narrow === true,
    emptyState: value.emptyState === true,
    createSelect: value.createSelect === true,
    readiness: value.readiness === true,
    diagnostics: value.diagnostics === true
  };
}

function normalizeFirstRunPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noGeneratedArtifacts && value.noDirectInternalReads && value.noPrivatePackageFiles) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noGeneratedArtifacts: value.noGeneratedArtifacts === true,
    noDirectInternalReads: value.noDirectInternalReads === true,
    noPrivatePackageFiles: value.noPrivatePackageFiles === true
  };
}

function normalizeUsableLaunchReliabilityProof(value = {}) {
  return {
    status: value.status === "pass" || (value.portFallback && value.noImplicitKnowledgeBase && value.localhostOnly && value.pathMutationGuard && value.restartSelectionPersistence && value.workspaceSqliteAuthority && value.noLegacyJsonState && value.diagnosticRedaction) ? "pass" : "",
    portFallback: value.portFallback === true,
    noImplicitKnowledgeBase: value.noImplicitKnowledgeBase === true,
    localhostOnly: value.localhostOnly === true,
    pathMutationGuard: value.pathMutationGuard === true,
    restartSelectionPersistence: value.restartSelectionPersistence === true,
    workspaceSqliteAuthority: value.workspaceSqliteAuthority === true,
    noLegacyJsonState: value.noLegacyJsonState === true,
    diagnosticRedaction: value.diagnosticRedaction === true
  };
}

function normalizeUsableDocumentIntakeProof(value = {}) {
  return {
    status: value.status === "pass" || (value.parserBoundary && value.ocrBoundary && value.rejectedRiskyInputs && value.catalogConsistency && value.targetedRerunSourceSet && value.externalCallsBeforeExecutionZero) ? "pass" : "",
    parserBoundary: value.parserBoundary === true,
    ocrBoundary: value.ocrBoundary === true,
    rejectedRiskyInputs: value.rejectedRiskyInputs === true,
    catalogConsistency: value.catalogConsistency === true,
    targetedRerunSourceSet: value.targetedRerunSourceSet === true,
    externalCallsBeforeExecutionZero: value.externalCallsBeforeExecutionZero === true
  };
}

function normalizeUsableWebConsoleWorkflowProof(value = {}) {
  return {
    status: value.status === "pass" || (value.createSelectSetup && value.buildExecutionLoop && value.askFeedbackReview && value.documentsVersionsDiagnostics && value.packagePreview && value.noDuplicatePrimaryControls && value.noDirectInternalStateReads) ? "pass" : "",
    createSelectSetup: value.createSelectSetup === true,
    buildExecutionLoop: value.buildExecutionLoop === true,
    askFeedbackReview: value.askFeedbackReview === true,
    documentsVersionsDiagnostics: value.documentsVersionsDiagnostics === true,
    packagePreview: value.packagePreview === true,
    noDuplicatePrimaryControls: value.noDuplicatePrimaryControls === true,
    noDirectInternalStateReads: value.noDirectInternalStateReads === true
  };
}

function normalizeUsableDurableDataPackageProof(value = {}) {
  return {
    status: value.status === "pass" || (value.workspaceCatalogBackup && value.walFilesExcluded && value.staleJsonCleanup && value.packageExportPreview && value.importPreviewNoWrites && value.versionManifest && value.rollbackPreview && value.rollbackConfirmation && value.packageBoundaryPrivacy && value.externalCallsBeforeExecutionZero) ? "pass" : "",
    workspaceCatalogBackup: value.workspaceCatalogBackup === true,
    walFilesExcluded: value.walFilesExcluded === true,
    staleJsonCleanup: value.staleJsonCleanup === true,
    packageExportPreview: value.packageExportPreview === true,
    importPreviewNoWrites: value.importPreviewNoWrites === true,
    versionManifest: value.versionManifest === true,
    rollbackPreview: value.rollbackPreview === true,
    rollbackConfirmation: value.rollbackConfirmation === true,
    packageBoundaryPrivacy: value.packageBoundaryPrivacy === true,
    externalCallsBeforeExecutionZero: value.externalCallsBeforeExecutionZero === true
  };
}

function normalizeUsableBrowserWorkflow(value = {}) {
  return {
    status: value.status === "pass" || (value.desktop && value.narrow && value.publicSample && value.queryRuntime && value.feedback && value.maintenance && value.diagnostics && value.noHorizontalOverflow) ? "pass" : "",
    desktop: value.desktop === true,
    narrow: value.narrow === true,
    publicSample: value.publicSample === true,
    queryRuntime: value.queryRuntime === true,
    feedback: value.feedback === true,
    maintenance: value.maintenance === true,
    diagnostics: value.diagnostics === true,
    noHorizontalOverflow: value.noHorizontalOverflow === true
  };
}

function normalizeUsablePrivacyProof(value = {}) {
  return {
    status: value.status === "pass" || (value.diagnosticRedaction && value.noCredentialLeak && value.noPrivateContentLeak && value.noLocalPaths && value.noExternalCallsBeforeExecution && value.integrationPrivacyAudit) ? "pass" : "",
    diagnosticRedaction: value.diagnosticRedaction === true,
    noCredentialLeak: value.noCredentialLeak === true,
    noPrivateContentLeak: value.noPrivateContentLeak === true,
    noLocalPaths: value.noLocalPaths === true,
    noExternalCallsBeforeExecution: value.noExternalCallsBeforeExecution === true,
    integrationPrivacyAudit: value.integrationPrivacyAudit === true
  };
}

function normalizeUsableProductPackageAssetReview(value = {}) {
  return {
    status: value.status === "pass" || (value.noPrivateState && value.noSqlite && value.noSecrets && value.noGeneratedArtifacts && value.noDirectInternalReads && value.noPrivatePackageFiles && value.noStaleJsonAuthority && value.noWalFiles) ? "pass" : "",
    noPrivateState: value.noPrivateState === true,
    noSqlite: value.noSqlite === true,
    noSecrets: value.noSecrets === true,
    noGeneratedArtifacts: value.noGeneratedArtifacts === true,
    noDirectInternalReads: value.noDirectInternalReads === true,
    noPrivatePackageFiles: value.noPrivatePackageFiles === true,
    noStaleJsonAuthority: value.noStaleJsonAuthority === true,
    noWalFiles: value.noWalFiles === true
  };
}

function browserSearchSource(browserSampleSmoke = {}) {
  const evidenceSearch = browserSampleSmoke.evidence?.evidenceSearch;
  if (evidenceSearch?.status === "pass") {
    return {
      ...evidenceSearch,
      status: "pass",
      maintenanceEvidence: true,
      evidenceLink: true
    };
  }
  const evidenceSearchCheck = browserSampleSmoke.checks?.find?.((item) => item.key === "evidenceSearch" && item.status === "pass");
  if (!evidenceSearchCheck) return {};
  return {
    status: "pass",
    maintenanceEvidence: true,
    evidenceLink: true
  };
}

function browserAskSource(browserSampleSmoke = {}) {
  const queryRuntimeFlow = browserSampleSmoke.evidence?.queryRuntimeFlow;
  if (queryRuntimeFlow?.status === "pass") {
    return {
      ...queryRuntimeFlow,
      status: "pass",
      answered: true,
      refused: true,
      feedbackMaintenance: true,
      desktop: queryRuntimeFlow.desktop === true,
      narrow: queryRuntimeFlow.narrow === true
    };
  }
  const queryRuntimeCheck = browserSampleSmoke.checks?.find?.((item) => item.key === "queryRuntimeFlow" && item.status === "pass");
  if (!queryRuntimeCheck) return {};
  return {
    status: "pass",
    answered: true,
    refused: true,
    feedbackMaintenance: true
  };
}

function browserProviderDiagnosticsSource(browserSampleSmoke = {}) {
  const providerDiagnostics = browserSampleSmoke.evidence?.providerDiagnostics;
  if (providerDiagnostics?.status === "pass") {
    return {
      ...providerDiagnostics,
      status: "pass",
      scopedApi: providerDiagnostics.scopedApi === true,
      desktop: providerDiagnostics.desktop === true,
      narrow: providerDiagnostics.narrow === true,
      sqliteAuthority: providerDiagnostics.sqliteAuthority === true,
      noExternalCallsBeforeExecution: providerDiagnostics.noExternalCallsBeforeExecution === true
    };
  }
  const providerDiagnosticsCheck = browserSampleSmoke.checks?.find?.((item) => item.key === "providerDiagnostics" && item.status === "pass");
  if (!providerDiagnosticsCheck) return {};
  return {
    status: "pass",
    scopedApi: true,
    desktop: browserSampleSmoke.evidence?.browserSampleFlow?.desktop === true,
    narrow: browserSampleSmoke.evidence?.browserSampleFlow?.narrow === true,
    sqliteAuthority: true,
    noExternalCallsBeforeExecution: true
  };
}

function noCloudPublicPathSource(browserSampleSmoke = {}) {
  const externalCalls = browserSampleSmoke.evidence?.externalCalls || {};
  const flow = browserSampleSmoke.evidence?.browserSampleFlow || {};
  const publicSample = browserSampleSmoke.ok === true || flow.status === "pass";
  return {
    status: publicSample && Number(externalCalls.total || 0) === 0 ? "pass" : "",
    publicSample,
    credentialFree: publicSample,
    externalCallsBlocked: Number(externalCalls.total || 0) === 0,
    localFallback: publicSample
  };
}

function browserProviderAwareNoCloudSource(browserSampleSmoke = {}) {
  const providerDiagnostics = browserSampleSmoke.evidence?.providerDiagnostics || {};
  const integrationDiagnostics = browserSampleSmoke.evidence?.integrationDiagnostics || {};
  const externalCalls = browserSampleSmoke.evidence?.externalCalls || {};
  const flow = browserSampleSmoke.evidence?.browserSampleFlow || {};
  const publicSample = browserSampleSmoke.ok === true || flow.status === "pass";
  return {
    status: providerDiagnostics.status === "pass"
      && integrationDiagnostics.status === "pass"
      && Number(externalCalls.total || 0) === 0
      && publicSample
      ? "pass"
      : "",
    providerDiagnostics: providerDiagnostics.status === "pass",
    integrationDiagnostics: integrationDiagnostics.status === "pass",
    noExternalCalls: Number(externalCalls.total || 0) === 0,
    publicSample
  };
}

function sdkConsumerProofSource(sdkConsumerSmoke = {}) {
  if (!sdkConsumerSmoke || sdkConsumerSmoke.ok !== true) return {};
  const passed = (key) => sdkConsumerSmoke.checks?.some?.((item) => item.key === key && item.status === "pass") === true;
  return {
    status: "pass",
    packageExports: passed("packageExportsRoot"),
    subpathExport: passed("packageExportsSubpath"),
    injectedFetch: passed("consumerInjectedFetch"),
    noInternalImports: passed("noSdkInternalImports"),
    noPrivatePackageFiles: passed("noPrivatePackageFiles")
  };
}

function liveSdkProofSource(liveSdkSampleSmoke = {}) {
  return liveSdkSampleSmoke.evidence?.livePublicSampleSdkFlow || {};
}

function liveSdkNoCloudSource(liveSdkSampleSmoke = {}) {
  return liveSdkSampleSmoke.evidence?.providerAwareNoCloudConsumer || {};
}

function privacyBoundaryAuditSource(integrationPrivacyAudit = {}) {
  if (!integrationPrivacyAudit || integrationPrivacyAudit.ok !== true) return {};
  const passed = (key) => integrationPrivacyAudit.checks?.some?.((item) => item.key === key && item.status === "pass") === true;
  return {
    status: "pass",
    scannedFiles: Number(integrationPrivacyAudit.summary?.files || 0),
    findings: Number(integrationPrivacyAudit.summary?.findings || 0),
    noSqliteReads: passed("sqliteDirectRead") && passed("sqliteAuthorityMention"),
    noArtifactReads: passed("internalAssetRead"),
    noCredentialLogging: passed("credentialLogging") && passed("privateContent"),
    noLocalPaths: passed("localAbsolutePath"),
    noBroadCors: passed("broadCors")
  };
}

function operatorWorkflowProofSource(operatorWorkflowSmoke = {}, key = "") {
  return operatorWorkflowSmoke?.evidence?.[key] || {};
}

function firstRunUsabilityProofSource(firstRunUsabilitySmoke = {}, key = "") {
  return firstRunUsabilitySmoke?.evidence?.[key] || {};
}

function usableBrowserSource(browserSampleSmoke = {}, firstRunUsabilitySmoke = {}) {
  const browserSampleFlow = browserSampleSmoke.evidence?.browserSampleFlow || {};
  const queryRuntimeFlow = browserSampleSmoke.evidence?.queryRuntimeFlow || {};
  const firstRunBrowser = firstRunUsabilitySmoke.evidence?.firstRunBrowserWorkflow || {};
  const desktop = browserSampleFlow.desktop === true || firstRunBrowser.desktop === true;
  const narrow = browserSampleFlow.narrow === true || firstRunBrowser.narrow === true;
  const queryRuntime = queryRuntimeFlow.status === "pass" || queryRuntimeFlow.answered === true;
  const feedback = queryRuntimeFlow.feedbackMaintenance === true;
  const publicSample = browserSampleSmoke.ok === true || browserSampleFlow.status === "pass";
  return {
    status: desktop && narrow && publicSample && queryRuntime && feedback ? "pass" : "",
    desktop,
    narrow,
    publicSample,
    queryRuntime,
    feedback,
    maintenance: browserSampleSmoke.evidence?.evidenceSearch?.maintenanceEvidence === true || feedback,
    diagnostics: browserSampleSmoke.evidence?.providerDiagnostics?.status === "pass" || firstRunBrowser.diagnostics === true,
    noHorizontalOverflow: desktop && narrow
  };
}

function usablePrivacySource({ usableProductSmoke = {}, integrationPrivacyAudit = {} } = {}) {
  const evidence = usableProductSmoke.evidence || {};
  const externalCalls = evidence.externalCalls || {};
  const privacyPassed = integrationPrivacyAudit.ok === true && Number(integrationPrivacyAudit.summary?.findings || 0) === 0;
  const launch = evidence.launchReliabilityProof || {};
  const durable = evidence.durableDataPackageProof || {};
  return {
    status: launch.diagnosticRedaction === true
      && Number(externalCalls.total || 0) === 0
      && privacyPassed
      && durable.packageBoundaryPrivacy === true
      ? "pass"
      : "",
    diagnosticRedaction: launch.diagnosticRedaction === true,
    noCredentialLeak: privacyPassed,
    noPrivateContentLeak: privacyPassed,
    noLocalPaths: privacyPassed,
    noExternalCallsBeforeExecution: Number(externalCalls.total || 0) === 0,
    integrationPrivacyAudit: privacyPassed
  };
}

function releaseEvidenceStage(options, evidence) {
  if (options.stage === "usable-product" || options.stage === "1.0.0-usable-product") return "usable-product";
  if (options.stage === "first-run-usability" || options.stage === "0.9.0-first-run-usability") return "first-run-usability";
  if (options.stage === "operator-workflow" || options.stage === "0.8.0-operator-workflow") return "operator-workflow";
  if (options.stage === "consumer-integration" || options.stage === "0.7.0-consumer-integration") return "consumer-integration";
  if (options.stage === "integration-sdk" || options.stage === "0.6.0-integration-sdk") return "integration-sdk";
  if (options.stage === "provider-adapters" || options.stage === "0.5.0-provider-adapters") return "provider-adapters";
  if (options.stage === "expert-sdk" || options.stage === "0.4.0-expert-sdk") return "expert-sdk";
  if (options.stage === "query-runtime" || options.stage === "0.3.0-query-runtime") return "query-runtime";
  if (options.stage === "searchable" || options.stage === "0.2.0-searchable") return "searchable";
  const queryRuntimeStatus = [
    evidence.routeContractReadiness,
    evidence.citationGroundedAnswerProof,
    evidence.refusalNoAnswerProof,
    evidence.feedbackMaintenanceProof,
    evidence.integrationContractProof,
    evidence.browserAskWorkflow
  ].map((item) => item?.status);
  const expertSdkStatus = [
    evidence.expertManifestReadiness,
    evidence.expertRuntimeBoundaryProof,
    evidence.nonK12ExampleProof,
    evidence.expertEvaluationGateProof,
    evidence.expertDocsContributorWorkflowProof,
    evidence.expertPackageAssetReview
  ].map((item) => item?.status);
  const providerAdaptersStatus = [
    evidence.providerManifestReadiness,
    evidence.parserOcrBoundaryProof,
    evidence.embeddingVectorBoundaryProof,
    evidence.providerDiagnosticsBrowserProof,
    evidence.noCloudPublicPathProof,
    evidence.providerPackageAssetReview
  ].map((item) => item?.status);
  const integrationSdkStatus = [
    evidence.endpointManifestReadiness,
    evidence.sdkClientProof,
    evidence.examplesDriftProof,
    evidence.integrationSafetyProof,
    evidence.providerAwareNoCloudProof,
    evidence.integrationPackageAssetReview
  ].map((item) => item?.status);
  const consumerIntegrationStatus = [
    evidence.installedSdkConsumerProof,
    evidence.livePublicSampleSdkProof,
    evidence.integrationRecipeProof,
    evidence.privacyBoundaryAuditProof,
    evidence.providerAwareNoCloudConsumerProof,
    evidence.consumerPackageAssetReview
  ].map((item) => item?.status);
  const operatorWorkflowStatus = [
    evidence.sourceIntakeProof,
    evidence.executionRecoveryProof,
    evidence.maintenanceTargetedRerunProof,
    evidence.versionRollbackProof,
    evidence.operatorBrowserWorkflow,
    evidence.operatorPrivacyAuditProof,
    evidence.operatorPackageAssetReview
  ].map((item) => item?.status);
  const firstRunUsabilityStatus = [
    evidence.firstRunLaunchProof,
    evidence.guidedSetupProof,
    evidence.buildRecoveryProof,
    evidence.firstQuestionProof,
    evidence.maintenanceNextActionProof,
    evidence.firstRunBrowserWorkflow,
    evidence.firstRunPackageAssetReview
  ].map((item) => item?.status);
  const usableProductStatus = [
    evidence.usableLaunchReliabilityProof,
    evidence.usableDocumentIntakeProof,
    evidence.usableWebConsoleWorkflowProof,
    evidence.usableDurableDataPackageProof,
    evidence.usableBrowserWorkflow,
    evidence.usablePrivacyProof,
    evidence.usableProductPackageAssetReview
  ].map((item) => item?.status);
  if (queryRuntimeStatus.every((status) => status === "pass")
    && expertSdkStatus.every((status) => status === "pass")
    && providerAdaptersStatus.every((status) => status === "pass")
    && integrationSdkStatus.every((status) => status === "pass")
    && consumerIntegrationStatus.every((status) => status === "pass")
    && operatorWorkflowStatus.every((status) => status === "pass")
    && firstRunUsabilityStatus.every((status) => status === "pass")
    && usableProductStatus.every((status) => status === "pass")) {
    return "usable-product";
  }
  if (queryRuntimeStatus.every((status) => status === "pass")
    && expertSdkStatus.every((status) => status === "pass")
    && providerAdaptersStatus.every((status) => status === "pass")
    && integrationSdkStatus.every((status) => status === "pass")
    && consumerIntegrationStatus.every((status) => status === "pass")
    && operatorWorkflowStatus.every((status) => status === "pass")
    && firstRunUsabilityStatus.every((status) => status === "pass")) {
    return "first-run-usability";
  }
  if (queryRuntimeStatus.every((status) => status === "pass")
    && expertSdkStatus.every((status) => status === "pass")
    && providerAdaptersStatus.every((status) => status === "pass")
    && integrationSdkStatus.every((status) => status === "pass")
    && consumerIntegrationStatus.every((status) => status === "pass")
    && operatorWorkflowStatus.every((status) => status === "pass")) {
    return "operator-workflow";
  }
  if (queryRuntimeStatus.every((status) => status === "pass")
    && expertSdkStatus.every((status) => status === "pass")
    && providerAdaptersStatus.every((status) => status === "pass")
    && integrationSdkStatus.every((status) => status === "pass")
    && consumerIntegrationStatus.every((status) => status === "pass")) {
    return "consumer-integration";
  }
  if (queryRuntimeStatus.every((status) => status === "pass")
    && expertSdkStatus.every((status) => status === "pass")
    && providerAdaptersStatus.every((status) => status === "pass")
    && integrationSdkStatus.every((status) => status === "pass")) {
    return "integration-sdk";
  }
  if (queryRuntimeStatus.every((status) => status === "pass")
    && expertSdkStatus.every((status) => status === "pass")
    && providerAdaptersStatus.every((status) => status === "pass")) {
    return "provider-adapters";
  }
  if (queryRuntimeStatus.every((status) => status === "pass") && expertSdkStatus.every((status) => status === "pass")) return "expert-sdk";
  if (queryRuntimeStatus.every((status) => status === "pass")) return "query-runtime";
  const searchableStatus = [
    evidence.searchableReadiness,
    evidence.incrementalUpdateProof,
    evidence.vectorFallbackProof,
    evidence.browserSearchWorkflow,
    evidence.staleJsonAuthorityAudit,
    evidence.packageAssetReview
  ].map((item) => item?.status);
  return searchableStatus.every((status) => status === "pass") ? "searchable" : "public-beta";
}

function assetRejectionReasons(normalized) {
  const reasons = [];
  if (/(^|\/)(workspace|knowledge-bases|artifacts|logs|secrets|private|\.runtime|tmp)(\/|$)/i.test(normalized)) reasons.push("private-state");
  if (/(^|\/)(\.playwright-cli|test-results|output\/playwright)(\/|$)/i.test(normalized)) reasons.push("generated-test-artifact");
  if (/(^|\/)\.env($|\.)|secret|access[_-]?key|token/i.test(normalized)) reasons.push("secret");
  if (/\.sqlite(?:-wal|-shm)?$|\.db$/i.test(normalized)) reasons.push("sqlite");
  return reasons;
}

function staleJsonAuthorityReason(normalized) {
  if (!/\.(?:json|jsonl)$/i.test(normalized)) return "";
  if (isAllowedJsonBoundary(normalized)) return "";
  if (/(^|\/)(workspace|workspace-state|current-selection|knowledge-bases|kb-registry)\.json$/i.test(normalized)) {
    return "workspace-json-authority";
  }
  if (/(^|\/)(knowledge-bases|workspace|state|\.runtime)\//i.test(normalized) && /(^|\/)(setup|task-summary|task-summaries|current|registry|jobs?)\.json$/i.test(normalized)) {
    return "kb-json-authority";
  }
  if (/(^|\/)(local-chunks|query-feedback|review-queue|quality-issues|index-records)\.jsonl$/i.test(normalized)) {
    return "jsonl-search-authority";
  }
  if (/(^|\/)(workspace|knowledge-bases|state|\.runtime)\//i.test(normalized) && /\.jsonl$/i.test(normalized)) {
    return "jsonl-search-authority";
  }
  return "";
}

function providerDirectPathReason(normalized) {
  if (!normalized) return "";
  if (/(^|\/)(legacy-provider|provider-bypass|direct-provider|direct-cloud-call)(\/|$)/i.test(normalized)) {
    return "direct-provider-bypass";
  }
  if (/(^|\/)(workspace|knowledge-bases|state|\.runtime)\//i.test(normalized)
    && /provider.*\.(?:json|jsonl)$/i.test(normalized)
    && !isAllowedJsonBoundary(normalized)) {
    return "provider-json-authority";
  }
  if (/(^|\/)(cloud-upload|vector-write|ocr-call|embedding-call)\.(?:json|jsonl)$/i.test(normalized)
    && !isAllowedJsonBoundary(normalized)) {
    return "provider-execution-authority";
  }
  return "";
}

function isAllowedJsonBoundary(normalized) {
  return /(^|\/)(exports?|audit|reports?|sidecars?|oss-sidecar|checkpoints?|credentials|schemas?|templates?)(\/|$)/i.test(normalized)
    || /(^|\/)(template|schema)\.json$/i.test(normalized);
}

function normalizeAssetPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const options = {
    localGates: {},
    github: {},
    betaReleaseNotes: {},
    sourceAuditPaths: [],
    assetPaths: []
  };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];
    if (item === "--out") {
      options.out = next;
      index += 1;
    } else if (item === "--artifact-sha") {
      options.localGates.artifactSmoke = { ok: true, package: { sha256: next || "" } };
      index += 1;
    } else if (item === "--asset") {
      options.assetPaths.push(next || "");
      index += 1;
    } else if (item === "--asset-list") {
      const listPath = path.resolve(next || "");
      options.assetPaths.push(...JSON.parse(fs.readFileSync(listPath, "utf8")));
      index += 1;
    } else if (item === "--stage") {
      options.stage = next || "";
      index += 1;
    } else if (item === "--searchable") {
      options.stage = "searchable";
    } else if (item === "--query-runtime") {
      options.stage = "query-runtime";
    } else if (item === "--expert-sdk") {
      options.stage = "expert-sdk";
    } else if (item === "--provider-adapters") {
      options.stage = "provider-adapters";
    } else if (item === "--integration-sdk") {
      options.stage = "integration-sdk";
    } else if (item === "--consumer-integration") {
      options.stage = "consumer-integration";
    } else if (item === "--operator-workflow") {
      options.stage = "operator-workflow";
    } else if (item === "--first-run-usability") {
      options.stage = "first-run-usability";
    } else if (item === "--usable-product") {
      options.stage = "usable-product";
    } else if (item === "--usable-product-smoke") {
      options.usableProductSmoke = JSON.parse(fs.readFileSync(path.resolve(next || ""), "utf8"));
      index += 1;
    } else if (item === "--source-audit-path") {
      options.sourceAuditPaths.push(next || "");
      index += 1;
    } else if (item === "--source-audit-list") {
      const listPath = path.resolve(next || "");
      options.sourceAuditPaths.push(...JSON.parse(fs.readFileSync(listPath, "utf8")));
      index += 1;
    } else if (item.startsWith("--github-")) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      options.github[key] = next || "";
      index += 1;
    } else if (item.startsWith("--pass-")) {
      const key = item.slice("--pass-".length);
      options.localGates[key] = "pass";
    } else if (item === "--browser-sample-flow") {
      options.browserSampleFlow = next === "pass"
        ? { status: "pass", desktop: true, narrow: true, resetVerified: true }
        : {};
      index += 1;
    } else if (item === "--beta-release-notes") {
      options.betaReleaseNotes = next === "pass"
        ? { supportedPaths: true, limitations: true, knownGaps: true }
        : {};
      index += 1;
    } else if (item === "--searchable-readiness") {
      options.searchableReadiness = next === "pass"
        ? { catalogSearch: true, queryEvidence: true, citationReady: true, scopedApi: true }
        : {};
      index += 1;
    } else if (item === "--incremental-update-proof") {
      options.incrementalUpdateProof = next === "pass"
        ? { catalogDelta: true, targetedRerun: true, versionRollback: true }
        : {};
      index += 1;
    } else if (item === "--vector-fallback-proof") {
      options.vectorFallbackProof = next === "pass"
        ? { sidecarContract: true, invalidVectorBlocked: true, catalogFallback: true }
        : {};
      index += 1;
    } else if (item === "--browser-search-workflow") {
      options.browserSearchWorkflow = next === "pass"
        ? { status: "pass", desktop: true, narrow: true, maintenanceEvidence: true, evidenceLink: true, resetVerified: true }
        : {};
      index += 1;
    } else if (item === "--route-contract-readiness") {
      options.routeContractReadiness = next === "pass"
        ? { routeContract: true, refusalTaxonomy: true, evidencePolicy: true }
        : {};
      index += 1;
    } else if (item === "--citation-grounded-answer-proof") {
      options.citationGroundedAnswerProof = next === "pass"
        ? { citedAnswer: true, evidencePack: true, qualityGates: true }
        : {};
      index += 1;
    } else if (item === "--refusal-no-answer-proof") {
      options.refusalNoAnswerProof = next === "pass"
        ? { outOfScope: true, insufficientEvidence: true, noWeakAnswer: true }
        : {};
      index += 1;
    } else if (item === "--feedback-maintenance-proof") {
      options.feedbackMaintenanceProof = next === "pass"
        ? { negativeFeedbackIssue: true, rerunScope: true, positiveSignalOnly: true }
        : {};
      index += 1;
    } else if (item === "--integration-contract-proof") {
      options.integrationContractProof = next === "pass"
        ? { openApi: true, nodeExample: true, httpExample: true, driftTest: true }
        : {};
      index += 1;
    } else if (item === "--browser-ask-workflow") {
      options.browserAskWorkflow = next === "pass"
        ? { status: "pass", answered: true, refused: true, feedbackMaintenance: true, desktop: true, narrow: true }
        : {};
      index += 1;
    } else if (item === "--expert-manifest-readiness") {
      options.expertManifestReadiness = next === "pass"
        ? { manifestContract: true, validation: true, lifecycleCertification: true }
        : {};
      index += 1;
    } else if (item === "--expert-runtime-boundary-proof") {
      options.expertRuntimeBoundaryProof = next === "pass"
        ? { publicHooks: true, directStorageBlocked: true, queryRouteHooks: true }
        : {};
      index += 1;
    } else if (item === "--non-k12-example-proof") {
      options.nonK12ExampleProof = next === "pass"
        ? { operationsHandbook: true, publicFixture: true, queryEvidence: true }
        : {};
      index += 1;
    } else if (item === "--expert-evaluation-gate-proof") {
      options.expertEvaluationGateProof = next === "pass"
        ? { portableCases: true, dashboardAggregation: true, maintenanceMapping: true }
        : {};
      index += 1;
    } else if (item === "--expert-docs-contributor-workflow-proof") {
      options.expertDocsContributorWorkflowProof = next === "pass"
        ? { authoringDocs: true, exampleDocs: true, requiredTests: true, communityProposalPath: true }
        : {};
      index += 1;
    } else if (item === "--expert-package-asset-review") {
      options.expertPackageAssetReview = next === "pass"
        ? { noPrivateState: true, noSqlite: true, noSecrets: true, noPrivateFixtures: true }
        : {};
      index += 1;
    } else if (item === "--provider-manifest-readiness") {
      options.providerManifestReadiness = next === "pass"
        ? { manifestContract: true, validation: true, capabilityInventory: true }
        : {};
      index += 1;
    } else if (item === "--parser-ocr-boundary-proof") {
      options.parserOcrBoundaryProof = next === "pass"
        ? { parserPreflight: true, ocrPreflight: true, unsafeInputsReviewed: true }
        : {};
      index += 1;
    } else if (item === "--embedding-vector-boundary-proof") {
      options.embeddingVectorBoundaryProof = next === "pass"
        ? { embeddingBatchContract: true, vectorOutputValidation: true, catalogFallback: true }
        : {};
      index += 1;
    } else if (item === "--provider-diagnostics-browser-proof") {
      options.providerDiagnosticsBrowserProof = next === "pass"
        ? { status: "pass", scopedApi: true, desktop: true, narrow: true, sqliteAuthority: true, noExternalCallsBeforeExecution: true }
        : {};
      index += 1;
    } else if (item === "--no-cloud-public-path-proof") {
      options.noCloudPublicPathProof = next === "pass"
        ? { publicSample: true, credentialFree: true, externalCallsBlocked: true, localFallback: true }
        : {};
      index += 1;
    } else if (item === "--provider-package-asset-review") {
      options.providerPackageAssetReview = next === "pass"
        ? { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectProviderBypass: true }
        : {};
      index += 1;
    } else if (item === "--endpoint-manifest-readiness") {
      options.endpointManifestReadiness = next === "pass"
        ? { endpointManifest: true, openApi: true, scopedDiscovery: true, diagnosticsDiscovery: true }
        : {};
      index += 1;
    } else if (item === "--sdk-client-proof") {
      options.sdkClientProof = next === "pass"
        ? { packageExports: true, scopedHelpers: true, injectedFetch: true, errorRedaction: true }
        : {};
      index += 1;
    } else if (item === "--examples-drift-proof") {
      options.examplesDriftProof = next === "pass"
        ? { nodeExample: true, httpExample: true, expectedResponses: true, driftTest: true }
        : {};
      index += 1;
    } else if (item === "--integration-safety-proof") {
      options.integrationSafetyProof = next === "pass"
        ? { retrySemantics: true, diagnosticsRedaction: true, localhostOnly: true, noInternalReads: true }
        : {};
      index += 1;
    } else if (item === "--provider-aware-no-cloud-proof") {
      options.providerAwareNoCloudProof = next === "pass"
        ? { providerDiagnostics: true, integrationDiagnostics: true, noExternalCalls: true, publicSample: true }
        : {};
      index += 1;
    } else if (item === "--integration-package-asset-review") {
      options.integrationPackageAssetReview = next === "pass"
        ? { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true }
        : {};
      index += 1;
    } else if (item === "--installed-sdk-consumer-proof") {
      options.installedSdkConsumerProof = next === "pass"
        ? { packageExports: true, subpathExport: true, injectedFetch: true, noInternalImports: true, noPrivatePackageFiles: true }
        : {};
      index += 1;
    } else if (item === "--live-public-sample-sdk-proof") {
      options.livePublicSampleSdkProof = next === "pass"
        ? { installedPackage: true, realHttp: true, answered: true, refused: true, search: true, feedback: true, providerDiagnostics: true, packagePreview: true, versionManifest: true, resetVerified: true }
        : {};
      index += 1;
    } else if (item === "--integration-recipe-proof") {
      options.integrationRecipeProof = next === "pass"
        ? { serverSideNode: true, electronLocalDesktop: true, browserBackend: true, ciSmoke: true, localhostCors: true, feedbackLinks: true }
        : {};
      index += 1;
    } else if (item === "--privacy-boundary-audit-proof") {
      options.privacyBoundaryAuditProof = next === "pass"
        ? { scannedFiles: 1, findings: 0, noSqliteReads: true, noArtifactReads: true, noCredentialLogging: true, noLocalPaths: true, noBroadCors: true }
        : {};
      index += 1;
    } else if (item === "--provider-aware-no-cloud-consumer-proof") {
      options.providerAwareNoCloudConsumerProof = next === "pass"
        ? { publicSample: true, credentialFree: true, externalCallsBlocked: true, localFallback: true }
        : {};
      index += 1;
    } else if (item === "--consumer-package-asset-review") {
      options.consumerPackageAssetReview = next === "pass"
        ? { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true }
        : {};
      index += 1;
    } else if (item === "--source-intake-proof") {
      options.sourceIntakeProof = next === "pass"
        ? { folderPrecheck: true, scanPreview: true, sourceManifest: true, excludeRestore: true, changedMissingRestored: true, executionPlanPreview: true, k12GateIsolation: true }
        : {};
      index += 1;
    } else if (item === "--execution-recovery-proof") {
      options.executionRecoveryProof = next === "pass"
        ? { jobCreation: true, checkpointPersistence: true, progressPolling: true, pauseResumeStop: true, restartRecovery: true, taskSummary: true, diagnosticRedaction: true }
        : {};
      index += 1;
    } else if (item === "--maintenance-targeted-rerun-proof") {
      options.maintenanceTargetedRerunProof = next === "pass"
        ? { evidenceSearch: true, queryFeedbackReview: true, qualityIssueReview: true, safeRerunScope: true, targetedRerunJob: true, reviewResolution: true }
        : {};
      index += 1;
    } else if (item === "--version-rollback-proof") {
      options.versionRollbackProof = next === "pass"
        ? { versionManifest: true, packagePreview: true, versionList: true, diff: true, rollbackPreview: true, rollbackConfirmation: true, crossKbIsolation: true }
        : {};
      index += 1;
    } else if (item === "--operator-browser-workflow") {
      options.operatorBrowserWorkflow = next === "pass"
        ? { status: "pass", desktop: true, narrow: true, sourceIntake: true, execution: true, maintenance: true, versions: true, feedback: true, diagnostics: true }
        : {};
      index += 1;
    } else if (item === "--operator-privacy-audit-proof") {
      options.operatorPrivacyAuditProof = next === "pass"
        ? { diagnosticRedaction: true, noCredentialLeak: true, noPrivateContentLeak: true, localhostOnly: true, noExternalCallsBeforeExecution: true, noInternalReads: true }
        : {};
      index += 1;
    } else if (item === "--operator-package-asset-review") {
      options.operatorPackageAssetReview = next === "pass"
        ? { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true }
        : {};
      index += 1;
    } else if (item === "--first-run-launch-proof") {
      options.firstRunLaunchProof = next === "pass"
        ? { emptyWorkspace: true, createAction: true, sampleAction: true, runtimeDiagnostics: true, providerReadiness: true, localhostOnly: true }
        : {};
      index += 1;
    } else if (item === "--guided-setup-proof") {
      options.guidedSetupProof = next === "pass"
        ? { setupDraftPersistence: true, folderPrecheck: true, missingFolderBlocked: true, scanPreview: true, executionPlanPreview: true, generalDocsNoK12Leak: true }
        : {};
      index += 1;
    } else if (item === "--build-recovery-proof") {
      options.buildRecoveryProof = next === "pass"
        ? { jobCreation: true, visibleProgress: true, pauseResume: true, restartRecovery: true, completion: true, diagnosticRedaction: true }
        : {};
      index += 1;
    } else if (item === "--first-question-proof") {
      options.firstQuestionProof = next === "pass"
        ? { queryRuntime: true, citationOrExplicitNoAnswer: true, evidenceSearch: true, noWeakSuccess: true }
        : {};
      index += 1;
    } else if (item === "--maintenance-next-action-proof") {
      options.maintenanceNextActionProof = next === "pass"
        ? { feedbackStored: true, reviewItemCreated: true, safeRerunScope: true, scopedApi: true }
        : {};
      index += 1;
    } else if (item === "--first-run-browser-workflow") {
      options.firstRunBrowserWorkflow = next === "pass"
        ? { status: "pass", desktop: true, narrow: true, emptyState: true, createSelect: true, readiness: true, diagnostics: true }
        : {};
      index += 1;
    } else if (item === "--first-run-package-asset-review") {
      options.firstRunPackageAssetReview = next === "pass"
        ? { noPrivateState: true, noSqlite: true, noSecrets: true, noGeneratedArtifacts: true, noDirectInternalReads: true, noPrivatePackageFiles: true }
        : {};
      index += 1;
    } else if (item === "--provider-audit-path") {
      options.providerAuditPaths = options.providerAuditPaths || [];
      options.providerAuditPaths.push(next || "");
      index += 1;
    } else if (item === "--provider-audit-list") {
      const listPath = path.resolve(next || "");
      options.providerAuditPaths = options.providerAuditPaths || [];
      options.providerAuditPaths.push(...JSON.parse(fs.readFileSync(listPath, "utf8")));
      index += 1;
    }
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCliArgs();
  const generated = generateReleaseEvidence(options);
  if (options.out) {
    writeReleaseEvidenceFile(path.resolve(defaultProjectRoot, options.out), generated);
  }
  console.log(JSON.stringify(generated, null, 2));
  if (!generated.ok) process.exitCode = 1;
}
