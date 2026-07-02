# First-Run Usability Proof

[English](first-run-usability.en.md) | [文档中心](README.md) | [Operator Workflow Proof](operator-workflow.zh-CN.md) | [当前设计](current-design.md)

`0.9.0 First-Run Usability Proof` 把已经证明过的操作者能力压缩成普通用户第一次打开 KnowMesh 时能完成的路径：从空本地状态启动，创建知识库，选择源文件夹，确认构建，恢复任务，问出第一个问题，并把反馈变成可理解的维护下一步。

这不是新的产品蓝图。所有状态权威仍然来自 `workspace.sqlite` 和每个知识库独立的 `catalog.sqlite`；浏览器存储只允许保存视觉偏好，JSON/JSONL 只允许作为 export、audit、sidecar、checkpoint、credential、schema 或 template 边界。

## 首次使用路径

1. 从空 user data root 启动本地服务，首页和知识库管理页都不创建隐式知识库。
2. 用户能看到创建知识库和公开样例入口，并能在无凭证状态下查看 runtime、provider 和 integration readiness。
3. 创建两个 `general-docs` 知识库，切换当前选择，确认 scoped overview、setup 和 diagnostics 都跟随 selected KB。
4. 选择本地 source folder 和 workspace folder，保存 setup draft 和 retrieval strategy，并在服务重启后恢复。
5. 用 precheck 阻断不存在的源文件夹，用 scan preview 和 plan preview 解释下一步。
6. 确认本地构建，看到进度、暂停/恢复、重启恢复和 completion。
7. 进入 Query Runtime，得到带引用的回答，或得到明确的 no-answer/refusal，不能把弱答案算作成功。
8. 用户反馈进入 maintenance review，并给出 safe rerun scope，而不是暴露内部表或文件路径。

## 必须证明的证据

`firstRunLaunchProof` 覆盖：

- `emptyWorkspace`
- `createAction`
- `sampleAction`
- `runtimeDiagnostics`
- `providerReadiness`
- `localhostOnly`

`guidedSetupProof` 覆盖：

- `setupDraftPersistence`
- `folderPrecheck`
- `missingFolderBlocked`
- `scanPreview`
- `executionPlanPreview`
- `generalDocsNoK12Leak`

`buildRecoveryProof` 覆盖：

- `jobCreation`
- `visibleProgress`
- `pauseResume`
- `restartRecovery`
- `completion`
- `diagnosticRedaction`

`firstQuestionProof` 覆盖：

- `queryRuntime`
- `citationOrExplicitNoAnswer`
- `evidenceSearch`
- `noWeakSuccess`

`maintenanceNextActionProof` 覆盖：

- `feedbackStored`
- `reviewItemCreated`
- `safeRerunScope`
- `scopedApi`

`firstRunBrowserWorkflow` 覆盖桌面和窄屏：

- `emptyState`
- `createSelect`
- `readiness`
- `diagnostics`

`firstRunPackageAssetReview` 覆盖：

- `noPrivateState`
- `noSqlite`
- `noSecrets`
- `noGeneratedArtifacts`
- `noDirectInternalReads`
- `noPrivatePackageFiles`

## 验收命令

```bash
npm run smoke:first-run-usability
node ./scripts/release-gate.mjs --stage first-run-usability --evidence ./release-evidence.json
```

`smoke:first-run-usability` 会启动临时本地服务，使用空本地状态创建非 sample `general-docs` 知识库，走完 launch、create/select、guided setup、build recovery、first question、maintenance next action、desktop/narrow DOM contract 和隐私清理，并删除临时状态。

release evidence 可以由 `scripts/generate-release-evidence.mjs` 生成，也可以显式传入：

```bash
node ./scripts/generate-release-evidence.mjs \
  --first-run-usability \
  --first-run-launch-proof pass \
  --guided-setup-proof pass \
  --build-recovery-proof pass \
  --first-question-proof pass \
  --maintenance-next-action-proof pass \
  --first-run-browser-workflow pass \
  --first-run-package-asset-review pass
```

## 不允许的捷径

- 不允许启动时创建隐藏默认知识库。
- 不允许用浏览器存储保存 selected KB、setup draft、job summary 或首次使用进度。
- 不允许 general-docs 首次路径继承 K12 必填字段。
- 不允许证据不足时把弱答案显示成成功回答。
- 不允许诊断导出泄露 credentials、私有内容、本机路径、raw provider payload 或内部 artifacts。

## 贡献入口

适合贡献者领取的 first-run 任务包括：

- 改进空状态、folder precheck 和 scan preview 的文案。
- 为常见构建失败增加可复核 fixture 和下一步提示。
- 改进 no-answer/refusal 的用户解释和 feedback 入口。
- 扩展 `firstRunBrowserWorkflow` 的桌面/窄屏 DOM contract。
- 强化 `firstRunPackageAssetReview`，让发布资产审查覆盖更多真实发布风险。
