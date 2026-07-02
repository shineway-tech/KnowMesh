# Release Candidate 证据清单

[English](release-candidate.en.md) | [文档中心](README.md) | [当前设计](current-design.md)

KnowMesh 仍是 `0.1.0-alpha`，但 Public Launch Candidate 必须用证据证明：公开仓库可理解、可运行、可贡献，且不会把私有状态或内容打进发布包。

## 本地证据

发布候选必须记录以下命令和结果：

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

`smoke:artifact` 输出的 tarball `sha256` 必须进入 release note。`verify:package-boundary` 必须显示 `rejected: []`。`verify:integration-privacy` 必须显示 findings 为 `0`。
`smoke:operator-workflow` 必须证明非 sample operator KB 的完整操作者路径通过。
`smoke:first-run-usability` 必须证明普通用户从空本地状态到首次提问和维护下一步的完整路径通过。
`smoke:usable-product` 必须证明可用产品路径的启动、摄入、Web Console、持久数据/包操作、旧 JSON 清理和零外部调用边界通过。

## GitHub 证据

发布候选还需要这些 GitHub gate：

- `githubCi`: 最新 CI 对目标提交通过。
- `githubCodeql`: 最新 CodeQL 对目标提交通过。
- `githubScorecard`: 最新 OpenSSF Scorecard 对目标提交通过。

推荐命令：

```bash
gh run list --workflow CI --limit 1 --json status,conclusion,headSha
gh run list --workflow CodeQL --limit 1 --json status,conclusion,headSha
gh run list --workflow Scorecard --limit 1 --json status,conclusion,headSha
```

## release-gate evidence 文件

`scripts/release-gate.mjs` 默认无证据时必须阻断 release。只有提供完整 evidence JSON 且全部通过时才允许：

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

`npmPublication` 保持 `separate-decision`。npm 发布是单独决策，不能因为 GitHub release 通过就暗示 npm 已发布。

Public Beta evidence 还需要 `browserSampleFlow`、`betaReleaseNotes` 和 `releaseAssetReview`。推荐用 `npm run generate:release-evidence` 生成 evidence JSON，再用 release gate 验证。

`0.2.0 Searchable` evidence 还需要：

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

`staleJsonAuthorityAudit` 必须阻断任何仍像主状态的 JSON/JSONL 路径；JSON 只允许保留在导出、审计、sidecar、checkpoint、credential、schema 或 template 边界。

`0.3.0 Query Runtime` evidence 还需要：

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

`0.4.0 Expert SDK` evidence 还需要：

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

`0.5.0 Provider Adapters` evidence 还需要：

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

`providerPackageAssetReview` 必须阻断 direct-provider bypass、legacy provider state、隐式 cloud call 和把 provider 执行 JSON/JSONL 当作主状态的路径。公开样例 no-cloud 路径必须证明无密钥、无外部调用，并且 provider diagnostics 通过 `workspace.sqlite` / `catalog.sqlite` 状态权威渲染。

`0.6.0 Integration SDK` evidence 还需要：

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

`integrationSafetyProof` 必须证明 integration diagnostics 已脱敏、默认 localhost-only、且保持 API-only；应用集成不能直接读取内部 SQLite 文件、artifacts、sidecars 或浏览器存储。

`0.7.0 Consumer Integration Proof` evidence 还需要：

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

`privacyBoundaryAuditProof` 必须来自 `npm run verify:integration-privacy`；`livePublicSampleSdkProof` 必须来自 `npm run smoke:live-sdk` 或等价的可复核 evidence。

`0.8.0 Operator Workflow Proof` evidence 还需要：

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

`sourceIntakeProof` 到 `operatorPrivacyAuditProof` 必须来自 `npm run smoke:operator-workflow` 或等价可复核 evidence；`operatorPackageAssetReview` 必须证明发布资产不含私有状态、SQLite、凭据、生成工件和 direct internal-state reads。

`0.9.0 First-Run Usability Proof` evidence 还需要：

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

`firstRunLaunchProof` 到 `maintenanceNextActionProof` 必须来自 `npm run smoke:first-run-usability` 或等价可复核 evidence；`firstRunPackageAssetReview` 必须证明发布资产不含私有状态、SQLite、凭据、生成工件和 direct internal-state reads。

`1.0.0 Usable Product Proof` evidence 还需要：

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

`usableLaunchReliabilityProof` 到 `usableDurableDataPackageProof` 必须来自 `npm run smoke:usable-product` 或等价可复核 evidence；`usableProductPackageAssetReview` 必须额外证明发布资产不含 SQLite/WAL、旧 JSON 权威路径和私有 package 文件。

## 当前 Alpha 限制

- KnowMesh 还不是稳定商业版本。
- 本地 parser/OCR provider 仍在加强。
- K12 是第一个强化场景，不代表项目只面向教育。
- 公开仓库不能捆绑真实教材、私有文档、凭证、SQLite 数据库或生成 artifacts。
