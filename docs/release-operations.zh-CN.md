# Release Operations Checklist

[English](release-operations.en.md) | [Release Candidate Evidence](release-candidate.zh-CN.md) | [Publication Decision Checklist](publication-decision-checklist.zh-CN.md) | [Beta Feedback Operations](beta-feedback-operations.zh-CN.md) | [当前设计](current-design.md)

发布操作只记录证据，不暗示 KnowMesh 已经稳定。`0.1.0-alpha` 阶段必须先通过本地和 GitHub gate，再决定是否发布 GitHub release；npm 发布始终是单独决策。

## 本地 Evidence

必须记录：

```bash
npm test
npm run smoke:release
npm run smoke:browser-sample
npm run smoke:usable-product
npm run smoke:release-candidate
npm run smoke:public-launch
npm run smoke:stabilization
npm run smoke:api-reliability
npm run smoke:community-release
npm run smoke:final-publication
npm run smoke:first-run-usability
npm run smoke:operator-workflow
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

`smoke:artifact` 的 tarball sha256 写入 release note。`verify:package-boundary` 必须没有 rejected 文件。`verify:integration-privacy` 必须显示 findings 为 `0`。
`smoke:operator-workflow` 必须证明非 sample operator KB 的 source intake、execution recovery、maintenance targeted rerun、version rollback、desktop/narrow browser workflow 和 privacy audit 都通过。
`smoke:first-run-usability` 必须证明空本地状态、创建/选择知识库、guided setup、build recovery、first question、maintenance next action、desktop/narrow browser workflow 和隐私清理都通过。
`smoke:usable-product` 必须证明 launch reliability、local document intake、Web Console workflow、durable data/package operations、旧 JSON 清理和执行前零外部调用都通过。
`smoke:release-candidate` 必须生成 `release-candidate-evidence`，并证明 fresh-clone install rehearsal、browser acceptance、community readiness 和 go/no-go packet 都通过。
`smoke:public-launch` 必须证明公开发布准备仍是 `human-review-required`，不会自动切换可见性、打 tag 或发布 npm。
`smoke:stabilization` 必须证明 feedback triage、public API stability、docs/samples hardening、reliability/privacy regression 和 1.0 stabilization decision 都通过。
`smoke:api-reliability` 必须证明 public API compatibility、Query Runtime status matrix、package/install reliability、privacy/security regression 和 release candidate reconciliation 都通过。
`smoke:community-release` 必须证明 contributor onboarding、issue triage、discovery docs quality、release notes/adoption loop 和 community release decision 都通过。
`smoke:final-publication` 必须证明 final evidence rollup、GitHub/repository review、npm/package review、announcement/support readiness 和 human publication decision packet 都通过，但仍不执行发布。

## GitHub Evidence

必须记录：

- `githubCi`
- `githubCodeql`
- `githubScorecard`

这些字段进入 release-gate evidence JSON。

## Public Beta Evidence

公开 beta 还必须记录：

- `browserSampleFlow`：桌面和窄屏都完成公开样例创建、Query Runtime、反馈、maintenance、package preview、version manifest 和 reset，且 reset 只清理公开样例。
- `betaReleaseNotes`：release notes 明确 supported paths、limitations、已知缺口，并保持 `npmPublication` 为 `separate-decision`。
- `releaseAssetReview`：确认 release assets 不含 workspace 状态、SQLite 数据库、credentials、日志、本机路径或私有资料。

这些字段由 `evaluatePublicBetaReleaseEvidence` 验收。Public Beta 可以诚实列出已知缺口，但不能跳过 browserSampleFlow、betaReleaseNotes 或 releaseAssetReview。

## `0.2.0 Searchable` Evidence

`0.2.0 Searchable` 在 Public Beta evidence 之上继续要求：

- `searchableReadiness`：SQLite catalog search、scoped `/api/search`、Query Runtime evidence lookup 和 citation-ready 结果都通过。
- `incrementalUpdateProof`：source delta、targeted rerun scope 和 rollback-ready version 证据齐全。
- `vectorFallbackProof`：local vector sidecar contract 可验证，invalid vector 不能覆盖 catalog truth，并能回退到 catalog search。
- `browserSearchWorkflow`：真实浏览器在桌面和窄屏都能通过维护页证据搜索看到 citation-ready evidence 和 evidence link。
- `staleJsonAuthorityAudit`：没有 JSON/JSONL 路径继续充当 workspace 或 catalog 的可变主状态。
- `packageAssetReview`：发布包不含私有状态、SQLite、敏感凭据、生成的浏览器工件或 stale JSON authority 文件。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage searchable --evidence ./release-evidence.json
```

JSON/JSONL 只允许作为 export、audit、sidecar、checkpoint、credential、schema 或 template 边界；任何 `workspace.json`、`setup.json`、`local-chunks.jsonl`、`query-feedback.jsonl` 等主状态形态都必须迁走或删除。

## `0.3.0 Query Runtime` Evidence

`0.3.0 Query Runtime` 在 `0.2.0 Searchable` evidence 之上继续要求：

- `routeContractReadiness`：Query Route contract、refusal taxonomy 和 `citation_ready_evidence_only` 策略已验证。
- `citationGroundedAnswerProof`：回答必须由 evidence pack、scoped citation 和 query quality gates 支撑。
- `refusalNoAnswerProof`：越界和证据不足问题返回明确拒答或 no-answer，不把弱答案算成功。
- `feedbackMaintenanceProof`：负反馈进入维护 review，并带 evidence target 与 targeted rerun scope；正反馈只作为有限排序信号。
- `integrationContractProof`：OpenAPI、Node 示例、HTTP 示例和 drift test 描述同一套运行时契约。
- `browserAskWorkflow`：真实浏览器在桌面和窄屏都证明 answered、refused/no-answer、feedback-maintenance 三条路径。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage query-runtime --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--query-runtime` 或 `--stage query-runtime`，并显式传入 route contract、citation-grounded answer、refusal/no-answer、feedback-maintenance、integration contract 和 browser ask workflow 这六组通过证据。

## `0.4.0 Expert SDK` Evidence

`0.4.0 Expert SDK` 在 `0.3.0 Query Runtime` evidence 之上继续要求：

- `expertManifestReadiness`：Expert manifest contract、authoring validation 和 lifecycle certification 都通过。
- `expertRuntimeBoundaryProof`：公开 runtime hooks、direct storage blocking 和 Query Runtime route hook 消费都通过。
- `nonK12ExampleProof`：`operations-handbook` 非 K12 Expert、公开 fixture 和 citation-ready Query Runtime evidence 都通过。
- `expertEvaluationGateProof`：portable evaluation cases、dashboard aggregation 和 maintenance mapping 都通过。
- `expertDocsContributorWorkflowProof`：authoring docs、example docs、required tests 和 community proposal path 都明确。
- `expertPackageAssetReview`：Expert SDK 相关 release assets 不含私有状态、SQLite、敏感凭据或私有 fixtures。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage expert-sdk --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--expert-sdk` 或 `--stage expert-sdk`，并显式传入 Expert manifest、runtime boundary、non-K12 example、evaluation gate、docs workflow 和 Expert package asset review 这六组通过证据。

## `0.5.0 Provider Adapters` Evidence

`0.5.0 Provider Adapters` 在 `0.4.0 Expert SDK` evidence 之上继续要求：

- `providerManifestReadiness`：Provider adapter manifest contract、validation 和 capability inventory 都通过。
- `parserOcrBoundaryProof`：parser preflight、OCR preflight 和 unsafe input review 都通过。
- `embeddingVectorBoundaryProof`：embedding batch contract、vector output validation 和 catalog fallback 都通过。
- `providerDiagnosticsBrowserProof`：真实浏览器在桌面和窄屏都能通过 scoped API 渲染 provider diagnostics，且证明 `workspace.sqlite` / `catalog.sqlite` 是状态权威。
- `noCloudPublicPathProof`：公开样例 no-cloud、credential-free，执行前无外部调用。
- `providerPackageAssetReview`：Provider Adapter 相关 release assets 不含私有状态、SQLite、敏感凭据、生成工件或 direct-provider bypass。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage provider-adapters --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--provider-adapters` 或 `--stage provider-adapters`，并显式传入 provider manifest、parser/OCR boundary、embedding/vector boundary、provider diagnostics browser、no-cloud public path 和 provider package asset review 这六组通过证据。

## `0.6.0 Integration SDK` Evidence

`0.6.0 Integration SDK` 在 `0.5.0 Provider Adapters` evidence 之上继续要求：

- `endpointManifestReadiness`：endpoint manifest、OpenAPI、scoped discovery 和 integration diagnostics discovery 都通过。
- `sdkClientProof`：package exports、scoped helpers、injected fetch、timeout/request id handling 和 SDK 错误脱敏都通过。
- `examplesDriftProof`：Node 示例、plain HTTP 示例、expected responses 和 drift tests 覆盖同一集成契约。
- `integrationSafetyProof`：retry semantics、diagnostics redaction、localhost-only defaults 和 no internal state reads 都通过。
- `providerAwareNoCloudProof`：provider diagnostics 与 integration diagnostics 证明公开样例在显式 provider 执行前无外部调用。
- `integrationPackageAssetReview`：Integration SDK release assets 不含私有状态、SQLite、敏感凭据、生成工件或 direct internal-state read paths。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage integration-sdk --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--integration-sdk` 或 `--stage integration-sdk`，并显式传入 endpoint manifest readiness、SDK client proof、examples drift proof、integration safety proof、provider-aware no-cloud proof 和 integration package asset review 这六组通过证据。

## `0.7.0 Consumer Integration Proof` Evidence

`0.7.0 Consumer Integration Proof` 在 `0.6.0 Integration SDK` evidence 之上继续要求：

- `installedSdkConsumerProof`：外部应用从已安装 package 通过 `knowmesh` / `knowmesh/sdk` 导入 SDK，并验证 exports、injected fetch、无内部依赖和无私有 package 文件。
- `livePublicSampleSdkProof`：已安装 SDK 通过真实 HTTP 调用公开样例，覆盖 answered/refused/search/feedback/provider diagnostics/package preview/version manifest/reset。
- `integrationRecipeProof`：双语集成指南覆盖 Server-side Node、Electron/local desktop、browser-through-backend、CI smoke、localhost/CORS、retry、request id 和 feedback maintenance links。
- `privacyBoundaryAuditProof`：integration docs、examples、expected responses 和 SDK entry point 通过隐私边界 audit，finding 为 `0`。
- `providerAwareNoCloudConsumerProof`：consumer-facing 公开样例 no-cloud、credential-free，显式 provider 执行前无外部调用。
- `consumerPackageAssetReview`：Consumer Integration release assets 不含私有状态、SQLite、敏感凭据、生成工件、direct internal-state reads 或私有 package 文件。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage consumer-integration --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--consumer-integration` 或 `--stage consumer-integration`，并显式传入 installed SDK consumer、live public-sample SDK、integration recipes、privacy audit、provider-aware no-cloud consumer 和 consumer package asset review 这六组通过证据。

## `0.8.0 Operator Workflow Proof` Evidence

`0.8.0 Operator Workflow Proof` 在 `0.7.0 Consumer Integration Proof` evidence 之上继续要求：

- `sourceIntakeProof`：folder precheck、scan preview、source manifest、exclude/restore、changed/missing/restored source delta、execution plan preview 和 K12 gate isolation 都通过。
- `executionRecoveryProof`：job creation、checkpoint persistence、progress polling、pause/resume/stop、restart recovery、task summary 和 diagnostic redaction 都通过。
- `maintenanceTargetedRerunProof`：evidence search、query feedback review、quality issue review、safe rerun scope、targeted rerun job 和 review resolution 都通过。
- `versionRollbackProof`：version manifest、package preview、version list、diff、rollback preview、rollback confirmation 和 cross-KB isolation 都通过。
- `operatorBrowserWorkflow`：真实浏览器在桌面和窄屏都能看到 source intake、execution、maintenance、versions、feedback 和 diagnostics operator surfaces。
- `operatorPrivacyAuditProof`：诊断和 operator surfaces 不泄露 credentials、私有内容、本机路径、raw provider payload，且显式执行前无外部调用。
- `operatorPackageAssetReview`：Operator Workflow release assets 不含私有状态、SQLite、敏感凭据、生成工件、direct internal-state reads 或私有 package 文件。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage operator-workflow --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--operator-workflow` 或 `--stage operator-workflow`，并显式传入 source intake、execution recovery、maintenance targeted rerun、version rollback、operator browser workflow、operator privacy audit 和 operator package asset review 这七组通过证据。

## `0.9.0 First-Run Usability Proof` Evidence

`0.9.0 First-Run Usability Proof` 在 `0.8.0 Operator Workflow Proof` evidence 之上继续要求：

- `firstRunLaunchProof`：empty workspace、create/sample actions、runtime diagnostics、provider readiness 和 localhost-only diagnostics 都通过。
- `guidedSetupProof`：setup draft persistence、folder precheck、missing folder blocking、scan preview、execution plan preview 和 general-docs no-K12 leakage 都通过。
- `buildRecoveryProof`：job creation、visible progress、pause/resume、restart recovery、completion 和 diagnostic redaction 都通过。
- `firstQuestionProof`：Query Runtime、citation-or-explicit-no-answer、evidence search 和 no weak success 都通过。
- `maintenanceNextActionProof`：feedback stored、review item created、safe rerun scope 和 scoped API 都通过。
- `firstRunBrowserWorkflow`：真实浏览器在桌面和窄屏都能看到 empty state、create/select、readiness 和 diagnostics。
- `firstRunPackageAssetReview`：First-Run Usability release assets 不含私有状态、SQLite、敏感凭据、生成工件、direct internal-state reads 或私有 package 文件。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage first-run-usability --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--first-run-usability` 或 `--stage first-run-usability`，并显式传入 first-run launch、guided setup、build recovery、first question、maintenance next action、first-run browser workflow 和 first-run package asset review 这七组通过证据。

## `1.0.0 Usable Product Proof` Evidence

`1.0.0 Usable Product Proof` 在 `0.9.0 First-Run Usability Proof` evidence 之上继续要求：

- `usableLaunchReliabilityProof`：port fallback、无隐式知识库、localhost-only、PATH mutation guard、restart selection persistence、workspace SQLite authority、no legacy JSON state 和 diagnostic redaction 都通过。
- `usableDocumentIntakeProof`：parser/OCR boundary、rejected risky inputs、catalog consistency、targeted rerun source set 和执行前零外部调用都通过。
- `usableWebConsoleWorkflowProof`：create/select/setup/build/execution/ask/feedback/documents/versions/diagnostics/package preview 用户路径可见，且无重复主按钮和 direct internal-state reads。
- `usableDurableDataPackageProof`：workspace/catalog backup、WAL/SHM exclusion、stale JSON cleanup、package export/import preview、version manifest、rollback preview、rollback confirmation 和 package boundary privacy 都通过。
- `usableBrowserWorkflow`：真实浏览器在桌面和窄屏证明 public sample、Query Runtime、feedback、maintenance、diagnostics 和无横向溢出。
- `usablePrivacyProof`：diagnostic redaction、no credential leak、no private content、no local paths、no external calls before execution 和 integration privacy audit 都通过。
- `usableProductPackageAssetReview`：Usable Product release assets 不含私有状态、SQLite/WAL、凭证材料、生成工件、direct internal-state reads、私有 package 文件或 stale JSON authority。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage usable-product --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--usable-product` 或 `--stage usable-product`，并传入 `--usable-product-smoke <json>` 来复用 `npm run smoke:usable-product` 的输出。

## `1.0.0 Public Release Candidate Freeze` Evidence

Release Candidate Freeze 不新增运行时功能，只把可用产品证据冻结成一个公开前审查包：

```bash
npm run smoke:release-candidate
npm run generate:release-candidate
npm run smoke:stabilization
npm run generate:stabilization
npm run smoke:api-reliability
npm run generate:api-reliability
npm run smoke:community-release
npm run generate:community-release
npm run smoke:final-publication
npm run generate:final-publication
node ./scripts/release-gate.mjs --usable-product --evidence ./exports/release-candidate-evidence.json
```

`release-candidate-evidence` 必须包含真实本地 smoke 摘要、fresh-clone install rehearsal、desktop/narrow browser acceptance、community readiness、go/no-go packet 和当前 artifact sha256。它不得自动切 Public、打 tag、创建 release 或发布 npm。

## Generated Evidence

维护者可以用 `npm run generate:release-evidence` 生成 milestone evidence JSON，也可以用 `npm run generate:release-candidate` 写出 `exports/release-candidate-evidence.json`，用 `npm run generate:stabilization` 写出 `exports/stabilization-evidence.json`，用 `npm run generate:api-reliability` 写出 `exports/api-reliability-evidence.json`，用 `npm run generate:community-release` 写出 `exports/community-release-readiness-evidence.json`，或用 `npm run generate:final-publication` 写出 `exports/final-publication-review-evidence.json`。生成结果必须保留 `npmPublication: "separate-decision"` / `human-review-required`，并把 beta feedback 的 `known-gap` 与 release-note carryover 写清楚。

## release-gate

默认没有 evidence 时必须阻断：

```bash
npm run verify:release-gate
```

完整 evidence 才允许：

```bash
node ./scripts/release-gate.mjs --evidence ./release-evidence.json
```

`npmPublication` 必须保持 `separate-decision`。npm 发布是单独决策，不能跟 GitHub release 混在一起。

## 发布前人工检查

- 用 [Publication Decision Checklist / 发布决策清单](publication-decision-checklist.zh-CN.md) 逐项确认 visibility、tag、GitHub Release、npm publish、announcement、rollback owner 和 Block AA 入口。
- README、README.en、docs index、Roadmap、release notes 同步。
- Public samples、integration examples、Expert docs、provider docs 都不包含私有资料。
- draft release assets 不包含 workspace、SQLite、日志、`.env` 或本机路径。
- 已知缺口必须写入 beta release notes，不能用“Alpha”字样替代具体风险说明。
- beta feedback 中带 `triage:release-note` 的 issue 必须进入 release-note carryover。
