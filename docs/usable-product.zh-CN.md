# Usable Product Proof

[English](usable-product.en.md) | [文档中心](README.md) | [Release Candidate Evidence](release-candidate.zh-CN.md) | [当前设计](current-design.md)

`1.0.0 Usable Product Proof` 用来证明 KnowMesh 已经不只是“能启动”或“能跑样例”，而是可以把真实本地资料编译成可维护、可追溯、可恢复、可集成的知识资产。

这仍然不等于商业稳定版。它是一个可复核的 release evidence 阶段，要求普通用户路径、操作者路径、浏览器证据、隐私边界和包资产边界同时成立。

## 证据来源

核心证据来自：

```bash
npm run smoke:usable-product
npm run smoke:browser-sample
npm run smoke:first-run-usability
npm run smoke:operator-workflow
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
```

`smoke:usable-product` 会输出四组主要 proof：

- `launchReliabilityProof`：端口冲突回退、无隐式知识库、localhost-only、PATH 不变更、重启后当前知识库保持、SQLite 权威、旧 JSON 状态不复活、诊断脱敏。
- `documentIntakeProof`：parser/OCR 边界、风险输入拒绝、catalog/source manifest/document inventory/targeted rerun 源集合一致、执行前零外部调用。
- `webConsoleWorkflowProof`：创建/选择、setup、build/execution、ask、feedback、documents、versions、diagnostics、package preview 的用户路径可见，且无重复主按钮或内部状态直读文案。
- `durableDataPackageProof`：workspace/catalog 备份 hash、WAL/SHM 排除、旧 JSON/JSONL 清理、package export/import preview、version manifest、rollback preview 和确认回滚。

## release-gate 字段

`1.0.0-usable-product` evidence 在 `0.9.0-first-run-usability` 之上继续要求：

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

验证：

```bash
node ./scripts/release-gate.mjs --stage usable-product --evidence ./release-evidence.json
```

生成 evidence 时可以传入 `--usable-product` 和 `--usable-product-smoke <json>`。

## 不通过的典型情况

- 启动后自动创建默认知识库。
- 选中知识库、setup draft、job summary 或 release 决策依赖浏览器存储或 JSON 文件。
- package 或 release asset 包含 `workspace.sqlite`、`catalog.sqlite`、`*.sqlite-wal`、`*.sqlite-shm`、`.env`、日志、私有资料或生成测试工件。
- 问答路径绕过 Query Runtime，或 UI 直接暴露内部 SQL/table/旧 JSON 状态。
- 诊断、示例、SDK 或文档泄露本机绝对路径、凭据、私有源正文或 raw provider payload。
