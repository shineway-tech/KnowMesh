# Release Candidate Evidence Checklist

[中文](release-candidate.zh-CN.md) | [Documentation](README.en.md) | [Current Design](current-design.md)

KnowMesh is still `0.1.0-alpha`, but a Public Launch Candidate must prove that the public repository is understandable, runnable, contributor-ready, and free of private runtime state in release packages.

## Local Evidence

Record these commands and results for a release candidate:

```bash
npm test
npm run smoke:release
npm run smoke:browser-sample
npm run smoke:usable-product
npm run smoke:first-run-usability
npm run smoke:operator-workflow
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

The `smoke:artifact` tarball `sha256` must be copied into the release notes. `verify:package-boundary` must report `rejected: []`. `verify:integration-privacy` must report `0` findings.
`smoke:operator-workflow` must prove the complete operator path for a non-sample operator KB.
`smoke:first-run-usability` must prove the complete path from empty local state to first question and maintenance next action for a non-maintainer.
`smoke:usable-product` must prove launch, intake, Web Console, durable data/package operations, stale JSON cleanup, and zero-external-call boundaries for the usable product path.

## GitHub Evidence

The release candidate also needs these GitHub gates:

- `githubCi`: latest CI run for the target commit passed.
- `githubCodeql`: latest CodeQL run for the target commit passed.
- `githubScorecard`: latest OpenSSF Scorecard run for the target commit passed.

Recommended commands:

```bash
gh run list --workflow CI --limit 1 --json status,conclusion,headSha
gh run list --workflow CodeQL --limit 1 --json status,conclusion,headSha
gh run list --workflow Scorecard --limit 1 --json status,conclusion,headSha
```

## release-gate Evidence File

`scripts/release-gate.mjs` must block releases by default when no evidence is supplied. It allows release only when complete passing evidence is provided:

```json
{
  "npmTest": "pass",
  "releaseSmoke": "pass",
  "artifactSmoke": { "status": "pass", "sha256": "<tarball-sha256>" },
  "packageBoundary": "pass",
  "diffCheck": "pass",
  "githubCi": "pass",
  "githubCodeql": "pass",
  "githubScorecard": "pass"
}
```

```bash
node ./scripts/release-gate.mjs --evidence ./release-evidence.json
```

`npmPublication` remains `separate-decision`. npm publication is a separate decision and must not be implied by a GitHub release.

Public Beta evidence also needs `browserSampleFlow`, `betaReleaseNotes`, and `releaseAssetReview`. Prefer `npm run generate:release-evidence` to generate the evidence JSON, then verify it with the release gate.

`0.2.0 Searchable` evidence also needs:

```json
{
  "searchableReadiness": { "status": "pass", "catalogSearch": true, "queryEvidence": true, "citationReady": true, "scopedApi": true },
  "incrementalUpdateProof": { "status": "pass", "catalogDelta": true, "targetedRerun": true, "versionRollback": true },
  "vectorFallbackProof": { "status": "pass", "sidecarContract": true, "invalidVectorBlocked": true, "catalogFallback": true },
  "browserSearchWorkflow": { "status": "pass", "desktop": true, "narrow": true, "maintenanceEvidence": true, "evidenceLink": true, "resetVerified": true },
  "staleJsonAuthorityAudit": { "status": "pass", "forbiddenMutableStatePaths": 0, "rejected": [] },
  "packageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage searchable --evidence ./release-evidence.json
```

`staleJsonAuthorityAudit` must block any JSON/JSONL path that still behaves like primary state. JSON may only remain at export, audit, sidecar, checkpoint, credential, schema, or template boundaries.

`0.3.0 Query Runtime` evidence also needs:

```json
{
  "routeContractReadiness": { "status": "pass", "routeContract": true, "refusalTaxonomy": true, "evidencePolicy": true },
  "citationGroundedAnswerProof": { "status": "pass", "citedAnswer": true, "evidencePack": true, "qualityGates": true },
  "refusalNoAnswerProof": { "status": "pass", "outOfScope": true, "insufficientEvidence": true, "noWeakAnswer": true },
  "feedbackMaintenanceProof": { "status": "pass", "negativeFeedbackIssue": true, "rerunScope": true, "positiveSignalOnly": true },
  "integrationContractProof": { "status": "pass", "openApi": true, "nodeExample": true, "httpExample": true, "driftTest": true },
  "browserAskWorkflow": { "status": "pass", "answered": true, "refused": true, "feedbackMaintenance": true, "desktop": true, "narrow": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage query-runtime --evidence ./release-evidence.json
```

`0.4.0 Expert SDK` evidence also needs:

```json
{
  "expertManifestReadiness": { "status": "pass", "manifestContract": true, "validation": true, "lifecycleCertification": true },
  "expertRuntimeBoundaryProof": { "status": "pass", "publicHooks": true, "directStorageBlocked": true, "queryRouteHooks": true },
  "nonK12ExampleProof": { "status": "pass", "operationsHandbook": true, "publicFixture": true, "queryEvidence": true },
  "expertEvaluationGateProof": { "status": "pass", "portableCases": true, "dashboardAggregation": true, "maintenanceMapping": true },
  "expertDocsContributorWorkflowProof": { "status": "pass", "authoringDocs": true, "exampleDocs": true, "requiredTests": true, "communityProposalPath": true },
  "expertPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noPrivateFixtures": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage expert-sdk --evidence ./release-evidence.json
```

`0.5.0 Provider Adapters` evidence also needs:

```json
{
  "providerManifestReadiness": { "status": "pass", "manifestContract": true, "validation": true, "capabilityInventory": true },
  "parserOcrBoundaryProof": { "status": "pass", "parserPreflight": true, "ocrPreflight": true, "unsafeInputsReviewed": true },
  "embeddingVectorBoundaryProof": { "status": "pass", "embeddingBatchContract": true, "vectorOutputValidation": true, "catalogFallback": true },
  "providerDiagnosticsBrowserProof": { "status": "pass", "scopedApi": true, "desktop": true, "narrow": true, "sqliteAuthority": true, "noExternalCallsBeforeExecution": true },
  "noCloudPublicPathProof": { "status": "pass", "publicSample": true, "credentialFree": true, "externalCallsBlocked": true, "localFallback": true },
  "providerPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectProviderBypass": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage provider-adapters --evidence ./release-evidence.json
```

`providerPackageAssetReview` must block direct-provider bypasses, legacy provider state, implicit cloud calls, and provider execution JSON/JSONL that would behave as primary state. The public sample no-cloud path must prove credential-free operation, no external calls, and provider diagnostics rendered from `workspace.sqlite` / `catalog.sqlite` state authority.

`0.6.0 Integration SDK` evidence also needs:

```json
{
  "endpointManifestReadiness": { "status": "pass", "endpointManifest": true, "openApi": true, "scopedDiscovery": true, "diagnosticsDiscovery": true },
  "sdkClientProof": { "status": "pass", "packageExports": true, "scopedHelpers": true, "injectedFetch": true, "errorRedaction": true },
  "examplesDriftProof": { "status": "pass", "nodeExample": true, "httpExample": true, "expectedResponses": true, "driftTest": true },
  "integrationSafetyProof": { "status": "pass", "retrySemantics": true, "diagnosticsRedaction": true, "localhostOnly": true, "noInternalReads": true },
  "providerAwareNoCloudProof": { "status": "pass", "providerDiagnostics": true, "integrationDiagnostics": true, "noExternalCalls": true, "publicSample": true },
  "integrationPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectInternalReads": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage integration-sdk --evidence ./release-evidence.json
```

`integrationSafetyProof` must keep integration diagnostics redacted, localhost-only by default, and API-only; application integrations must not read internal SQLite files, artifacts, sidecars, or browser storage directly.

`0.7.0 Consumer Integration Proof` evidence also needs:

```json
{
  "installedSdkConsumerProof": { "status": "pass", "packageExports": true, "subpathExport": true, "injectedFetch": true, "noInternalImports": true, "noPrivatePackageFiles": true },
  "livePublicSampleSdkProof": { "status": "pass", "installedPackage": true, "realHttp": true, "answered": true, "refused": true, "search": true, "feedback": true, "providerDiagnostics": true, "packagePreview": true, "versionManifest": true, "resetVerified": true },
  "integrationRecipeProof": { "status": "pass", "serverSideNode": true, "electronLocalDesktop": true, "browserBackend": true, "ciSmoke": true, "localhostCors": true, "feedbackLinks": true },
  "privacyBoundaryAuditProof": { "status": "pass", "scannedFiles": 21, "findings": 0, "noSqliteReads": true, "noArtifactReads": true, "noCredentialLogging": true, "noLocalPaths": true, "noBroadCors": true },
  "providerAwareNoCloudConsumerProof": { "status": "pass", "publicSample": true, "credentialFree": true, "externalCallsBlocked": true, "localFallback": true },
  "consumerPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectInternalReads": true, "noPrivatePackageFiles": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage consumer-integration --evidence ./release-evidence.json
```

`privacyBoundaryAuditProof` must come from `npm run verify:integration-privacy`; `livePublicSampleSdkProof` must come from `npm run smoke:live-sdk` or equivalent reviewable evidence.

`0.8.0 Operator Workflow Proof` evidence also needs:

```json
{
  "sourceIntakeProof": { "status": "pass", "folderPrecheck": true, "scanPreview": true, "sourceManifest": true, "excludeRestore": true, "changedMissingRestored": true, "executionPlanPreview": true, "k12GateIsolation": true },
  "executionRecoveryProof": { "status": "pass", "jobCreation": true, "checkpointPersistence": true, "progressPolling": true, "pauseResumeStop": true, "restartRecovery": true, "taskSummary": true, "diagnosticRedaction": true },
  "maintenanceTargetedRerunProof": { "status": "pass", "evidenceSearch": true, "queryFeedbackReview": true, "qualityIssueReview": true, "safeRerunScope": true, "targetedRerunJob": true, "reviewResolution": true },
  "versionRollbackProof": { "status": "pass", "versionManifest": true, "packagePreview": true, "versionList": true, "diff": true, "rollbackPreview": true, "rollbackConfirmation": true, "crossKbIsolation": true },
  "operatorBrowserWorkflow": { "status": "pass", "desktop": true, "narrow": true, "sourceIntake": true, "execution": true, "maintenance": true, "versions": true, "feedback": true, "diagnostics": true },
  "operatorPrivacyAuditProof": { "status": "pass", "diagnosticRedaction": true, "noCredentialLeak": true, "noPrivateContentLeak": true, "localhostOnly": true, "noExternalCallsBeforeExecution": true, "noInternalReads": true },
  "operatorPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectInternalReads": true, "noPrivatePackageFiles": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage operator-workflow --evidence ./release-evidence.json
```

`sourceIntakeProof` through `operatorPrivacyAuditProof` must come from `npm run smoke:operator-workflow` or equivalent reviewable evidence. `operatorPackageAssetReview` must prove release assets exclude private state, SQLite files, credentials, generated artifacts, and direct internal-state reads.

`0.9.0 First-Run Usability Proof` evidence also requires:

```json
{
  "firstRunLaunchProof": { "status": "pass", "emptyWorkspace": true, "createAction": true, "sampleAction": true, "runtimeDiagnostics": true, "providerReadiness": true, "localhostOnly": true },
  "guidedSetupProof": { "status": "pass", "setupDraftPersistence": true, "folderPrecheck": true, "missingFolderBlocked": true, "scanPreview": true, "executionPlanPreview": true, "generalDocsNoK12Leak": true },
  "buildRecoveryProof": { "status": "pass", "jobCreation": true, "visibleProgress": true, "pauseResume": true, "restartRecovery": true, "completion": true, "diagnosticRedaction": true },
  "firstQuestionProof": { "status": "pass", "queryRuntime": true, "citationOrExplicitNoAnswer": true, "evidenceSearch": true, "noWeakSuccess": true },
  "maintenanceNextActionProof": { "status": "pass", "feedbackStored": true, "reviewItemCreated": true, "safeRerunScope": true, "scopedApi": true },
  "firstRunBrowserWorkflow": { "status": "pass", "desktop": true, "narrow": true, "emptyState": true, "createSelect": true, "readiness": true, "diagnostics": true },
  "firstRunPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectInternalReads": true, "noPrivatePackageFiles": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage first-run-usability --evidence ./release-evidence.json
```

`firstRunLaunchProof` through `maintenanceNextActionProof` must come from `npm run smoke:first-run-usability` or equivalent reviewable evidence. `firstRunPackageAssetReview` must prove release assets exclude private state, SQLite files, credentials, generated artifacts, and direct internal-state reads.

`1.0.0 Usable Product Proof` evidence also requires:

```json
{
  "usableLaunchReliabilityProof": { "status": "pass", "portFallback": true, "noImplicitKnowledgeBase": true, "localhostOnly": true, "pathMutationGuard": true, "restartSelectionPersistence": true, "workspaceSqliteAuthority": true, "noLegacyJsonState": true, "diagnosticRedaction": true },
  "usableDocumentIntakeProof": { "status": "pass", "parserBoundary": true, "ocrBoundary": true, "rejectedRiskyInputs": true, "catalogConsistency": true, "targetedRerunSourceSet": true, "externalCallsBeforeExecutionZero": true },
  "usableWebConsoleWorkflowProof": { "status": "pass", "createSelectSetup": true, "buildExecutionLoop": true, "askFeedbackReview": true, "documentsVersionsDiagnostics": true, "packagePreview": true, "noDuplicatePrimaryControls": true, "noDirectInternalStateReads": true },
  "usableDurableDataPackageProof": { "status": "pass", "workspaceCatalogBackup": true, "walFilesExcluded": true, "staleJsonCleanup": true, "packageExportPreview": true, "importPreviewNoWrites": true, "versionManifest": true, "rollbackPreview": true, "rollbackConfirmation": true, "packageBoundaryPrivacy": true, "externalCallsBeforeExecutionZero": true },
  "usableBrowserWorkflow": { "status": "pass", "desktop": true, "narrow": true, "publicSample": true, "queryRuntime": true, "feedback": true, "maintenance": true, "diagnostics": true, "noHorizontalOverflow": true },
  "usablePrivacyProof": { "status": "pass", "diagnosticRedaction": true, "noCredentialLeak": true, "noPrivateContentLeak": true, "noLocalPaths": true, "noExternalCallsBeforeExecution": true, "integrationPrivacyAudit": true },
  "usableProductPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectInternalReads": true, "noPrivatePackageFiles": true, "noStaleJsonAuthority": true, "noWalFiles": true }
}
```

```bash
node ./scripts/release-gate.mjs --stage usable-product --evidence ./release-evidence.json
```

`usableLaunchReliabilityProof` through `usableDurableDataPackageProof` must come from `npm run smoke:usable-product` or equivalent reviewable evidence. `usableProductPackageAssetReview` must additionally prove release assets exclude SQLite/WAL files, stale JSON authority paths, and private package files.

## Current Alpha Limits

- KnowMesh is not a stable commercial release yet.
- Local parser/OCR providers are still being strengthened.
- K12 is the first enhanced scenario; KnowMesh is not education-only.
- The public repository must not bundle real textbooks, private documents, credentials, SQLite databases, or generated artifacts.
