# Operator Workflow Proof

[English](operator-workflow.en.md) | [文档中心](README.md) | [Release Operations](release-operations.zh-CN.md) | [当前设计](current-design.md)

KnowMesh 的操作者不是直接编辑数据库或搬运 artifacts 的人。操作者应该通过 Web Console 和 scoped HTTP API 完成一条知识资产生命周期：检查源文件夹、确认执行计划、恢复或停止任务、审查质量问题、触发 targeted rerun、发布版本、比较差异、预览回滚风险并确认回滚。

`0.8.0 Operator Workflow Proof` 的目标是证明这条路径可以被真实维护者复核，而不是只靠内部测试知道“代码能跑”。

## 操作者路径

1. 创建一个非 sample 的 `general-docs` 知识库。
2. 选择本地 source folder 和 workspace folder。
3. 运行 folder precheck、scan preview、source manifest 和 execution plan preview。
4. 在文档维护页排除、恢复文档，并重新扫描 changed / missing / restored source delta。
5. 确认本地任务，观察 checkpoint、进度、日志和当前 task summary。
6. 验证暂停、恢复、停止语义，并在服务重启后恢复 latest job。
7. 用 evidence search、query feedback、quality issues 进入 maintenance review。
8. 生成 safe rerun scope，确认 targeted rerun，并记录 review resolution。
9. 发布新的 catalog-backed version，检查 package preview、version list、diff 和 rollback preview。
10. 确认 rollback，验证 active/previous version 状态和跨知识库隔离。

这条路径的状态权威始终是 `workspace.sqlite` 和每个知识库的 `catalog.sqlite`。JSON/JSONL 只能作为 export、audit、sidecar、checkpoint、credential、schema 或 template 边界，不能重新成为可变主状态。

## 必须证明的证据

`sourceIntakeProof` 覆盖：

- `folderPrecheck`
- `scanPreview`
- `sourceManifest`
- `excludeRestore`
- `changedMissingRestored`
- `executionPlanPreview`
- `k12GateIsolation`

`executionRecoveryProof` 覆盖：

- `jobCreation`
- `checkpointPersistence`
- `progressPolling`
- `pauseResumeStop`
- `restartRecovery`
- `taskSummary`
- `diagnosticRedaction`

`maintenanceTargetedRerunProof` 覆盖：

- `evidenceSearch`
- `queryFeedbackReview`
- `qualityIssueReview`
- `safeRerunScope`
- `targetedRerunJob`
- `reviewResolution`

`versionRollbackProof` 覆盖：

- `versionManifest`
- `packagePreview`
- `versionList`
- `diff`
- `rollbackPreview`
- `rollbackConfirmation`
- `crossKbIsolation`

`operatorBrowserWorkflow` 覆盖桌面和窄屏：

- `sourceIntake`
- `execution`
- `maintenance`
- `versions`
- `feedback`
- `diagnostics`

`operatorPrivacyAuditProof` 覆盖：

- `diagnosticRedaction`
- `noCredentialLeak`
- `noPrivateContentLeak`
- `localhostOnly`
- `noExternalCallsBeforeExecution`
- `noInternalReads`

`operatorPackageAssetReview` 覆盖：

- `noPrivateState`
- `noSqlite`
- `noSecrets`
- `noGeneratedArtifacts`
- `noDirectInternalReads`
- `noPrivatePackageFiles`

## 验收命令

```bash
npm run smoke:operator-workflow
node ./scripts/release-gate.mjs --stage operator-workflow --evidence ./release-evidence.json
```

`smoke:operator-workflow` 会启动临时本地服务和临时目录，创建非 sample operator KB，走完 source intake、execution recovery、maintenance targeted rerun、version rollback、desktop/narrow DOM contract 和隐私审计，并在结束后删除临时状态。

release evidence 可以由 `scripts/generate-release-evidence.mjs` 生成，也可以显式传入：

```bash
node ./scripts/generate-release-evidence.mjs \
  --operator-workflow \
  --source-intake-proof pass \
  --execution-recovery-proof pass \
  --maintenance-targeted-rerun-proof pass \
  --version-rollback-proof pass \
  --operator-browser-workflow pass \
  --operator-privacy-audit-proof pass \
  --operator-package-asset-review pass
```

## 不允许的捷径

- 不允许操作者直接读取或修改 `catalog.sqlite` 来完成维护动作。
- 不允许用浏览器存储保存 selected KB、setup draft、job summary 或 release decision。
- 不允许把 local paths、credentials、raw provider payloads、私有文档正文或内部 artifacts 写进诊断导出。
- 不允许为了旧 JSON-first 流程保留可变主状态兼容垫片。
- 不允许把未通过 rollback preview 的版本切成 active。

## 贡献入口

适合贡献者领取的 operator 任务包括：

- 增强 source delta 解释和文档维护页提示。
- 给 targeted rerun scope 增加更多可审计 preview。
- 改进 version diff 的可读性和 rollback risk copy。
- 增加 Web Console operator DOM contract 覆盖，但不要依赖浏览器存储作为事实源。
- 扩展 `operatorPackageAssetReview`，让 release assets 审查更接近真实发布流程。
