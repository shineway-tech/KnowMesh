# KnowMesh Roadmap

[English](ROADMAP.en.md) | [README](README.md) | [当前设计](docs/current-design.md) | [K12 Expert](docs/experts/k12.zh-CN.md)

KnowMesh 的路线图围绕一个目标推进：把源资料编译成可信、可检查、可维护、可集成的知识资产。本文是公开路线入口，不是新的设计权威；详细产品、架构和数据约束以 [docs/current-design.md](docs/current-design.md) 为准。

## 当前阶段

KnowMesh 当前处于 `0.1.0-alpha`。架构底座已经从 JSON-first 切换到 SQLite-first：

- `workspace.sqlite` 管理全局工作区、知识库注册、当前选择、setup/task 摘要。
- 每个知识库拥有独立 `catalog.sqlite`，保存文档、页面、结构、chunk、任务、质量、反馈、版本和发布状态。
- Web Console、Query Runtime、任务恢复、文档维护和版本记录已经围绕 per-KB catalog 收敛。
- K12 是第一个主要 Expert 场景，用来验证“领域结构优先于普通 PDF 问答”的方向。

## 近期路线

| 阶段 | 目标 | 主要工作 |
| --- | --- | --- |
| `0.1.x` Alpha Foundation | 让公开仓库可信、可运行、可贡献 | 文档入口、release draft、CI/CodeQL/Scorecard、安全设置、Good First Issues、贡献流程 |
| `0.1.x` Adoption Loop / 采用闭环 | 让新用户无密钥试用并让新贡献者快速入场 | 公开样例向导、sample reset、community backlog、issue templates、release operations |
| `0.1.x` Public Beta Hardening | 让公开样例和贡献入口可重复验收 | browserSampleFlow、Integration Examples contract、Expert/Provider lifecycle、releaseAssetReview、betaReleaseNotes |
| `0.1.x` Beta Operations Automation | 让 beta feedback 和 release evidence 可运营 | smoke:browser-sample、generate:release-evidence、known-gap、triage、release-note carryover |
| `0.2.0` Searchable | 让知识资产可稳定检索 | 稳定 catalog ranking、证据搜索 UI、incremental source delta、targeted rerun、vector sidecar fallback、Searchable release evidence |
| `0.3.0` Query Runtime | 让真实问题返回有证据的答案 | route contract、evidence pack、cited answer gates、拒答/no-answer、feedback-maintenance、OpenAPI/examples drift、Query Runtime release evidence |
| `0.4.0` Expert SDK / Extension Foundation | 让行业场景可扩展 | Expert manifest、runtime hooks、operations-handbook 非 K12 示例、评测集格式、维护映射、作者指南、Expert SDK release evidence |
| `0.5.0` Provider Adapters | 让解析/OCR/embedding 可替换 | provider manifests、parser/OCR boundary、embedding/vector validation、provider diagnostics browser proof、no-cloud public path、Provider Adapters release evidence |
| `0.6.0` Integration SDK | 让应用开发者稳定接入 | endpoint manifest、ESM SDK、plain HTTP examples、integration diagnostics、retry/redaction、Integration SDK release evidence |
| `0.7.0` Consumer Integration Proof | 证明下游应用能从安装包和真实本地服务接入 | installed SDK consumer smoke、live public-sample SDK smoke、双语集成指南、隐私边界 audit、Consumer Integration release evidence |
| `0.8.0` Operator Workflow Proof | 证明维护者能通过受支持界面完成知识资产生命周期 | source intake、execution recovery、maintenance review、targeted rerun、version rollback、operator browser proof、Operator Workflow release evidence |
| `0.9.0` First-Run Usability Proof | 证明普通用户能从空本地状态可靠走到首个可维护知识库 | empty launch、create/select、guided setup、build recovery、first question、maintenance next action、First-Run Usability release evidence |
| `1.0.0` Usable Product Proof | 让非维护者能可靠构建、使用、维护、打包和恢复知识库 | usable-product smoke、launch reliability、document intake、Web Console workflow、durable data/package、browser/privacy/package evidence |

## 重点方向

### Query Runtime 可用性

- 同一个 Query Runtime 服务控制台问答和外部集成。
- 回答必须带来源、页码或结构锚点。
- 越界问题、证据不足和低置信回答要可拒答、可解释、可反馈。
- `0.3.0 Query Runtime` 要求 release evidence 证明 route contract、citation-grounded answers、拒答/no-answer、feedback-maintenance、集成契约和浏览器 ask workflow 都通过。

### Knowledge Asset Layer

- 文档、页面、块、结构、chunk、引用、评测、反馈和版本以 catalog 为事实源。
- JSON/JSONL 保留为导出、审计和 sidecar，不再作为主要运行时状态。
- 版本发布需要可 diff、可 rollback、可诊断。
- `0.2.0 Searchable` 要求 release evidence 证明 catalog search、Query Runtime evidence、浏览器维护搜索、增量更新、vector fallback 和 stale JSON authority audit 都通过。

### Expert 场景

- Core 保持行业中立。
- [K12](docs/experts/k12.zh-CN.md) 继续作为第一个强化场景，覆盖目录、单元、课文、词表、公式、练习、实验和页码引用。
- 后续 Expert 必须声明领域对象、质量门禁、评测集和 query-router 规则，并通过公开 Expert runtime hook 接入 Core。
- `operations-handbook` 是第一个非 K12 公开 Expert SDK 样例，用公开 fixture 证明制度、流程、复核节奏、回滚规则和证据要求可以进入同一 Query Runtime。
- `0.4.0 Expert SDK` 要求 release evidence 证明 manifest readiness、runtime boundary、非 K12 示例、Expert evaluation gates、贡献者 workflow 和包资产审查都通过。
- Expert 与 Provider lifecycle 统一使用 `official` -> `certified` -> `community` -> `experimental`，公开路线图只承诺已通过相应验收的阶段。

### Provider Adapters

- Parser、OCR、embedding、rerank、vector、object-store 和 export provider 必须先声明 manifest、权限、隐私、成本、dry-run、batch、retry 和 checkpoint 策略。
- Provider diagnostics 必须通过 Web Console 的 scoped API 渲染，状态权威来自 `workspace.sqlite` 和每个知识库的 `catalog.sqlite`，浏览器存储只保留视觉偏好。
- Public sample 路径必须保持 no-cloud、credential-free；未显式配置和确认前，执行前外部调用数必须为 `0`。
- `0.5.0 Provider Adapters` 要求 release evidence 证明 `providerManifestReadiness`、`parserOcrBoundaryProof`、`embeddingVectorBoundaryProof`、`providerDiagnosticsBrowserProof`、`noCloudPublicPathProof` 和 `providerPackageAssetReview` 都通过。

### Integration SDK

- 集成方通过 `/api/integration/manifest` 和 `/api/integration/diagnostics` 发现端点、重试语义、localhost/CORS 边界和当前知识库就绪度。
- `src/sdk/knowmesh-client.mjs` 提供无构建、轻量 ESM SDK，支持 scoped route helpers、injected fetch、timeout、request id、错误脱敏和 provider-aware diagnostics。
- Node.js 示例、plain HTTP 示例和 expected response fixtures 必须和 OpenAPI、endpoint manifest、SDK endpoint map 保持漂移测试一致。
- `0.6.0 Integration SDK` 要求 release evidence 证明 `endpointManifestReadiness`、`sdkClientProof`、`examplesDriftProof`、`integrationSafetyProof`、`providerAwareNoCloudProof` 和 `integrationPackageAssetReview` 都通过。
- `0.7.0 Consumer Integration Proof` 要求 release evidence 证明已安装 SDK consumer、真实公开样例 SDK HTTP 流、集成指南、隐私边界 audit、consumer no-cloud 和包资产审查都通过。

### Operator Workflow

- 操作者必须通过 Web Console 和 scoped API 完成 source intake、execution recovery、maintenance review、targeted rerun、version diff 和 rollback。
- `workspace.sqlite` 和每个知识库的 `catalog.sqlite` 继续作为状态权威；浏览器存储和 JSON/JSONL 不能保存 selected KB、setup draft、job summary 或 release decision。
- 诊断导出必须脱敏，不暴露 credentials、私有文档、本机路径、raw provider payload 或内部 artifact 路径。
- `0.8.0 Operator Workflow Proof` 要求 release evidence 证明 `sourceIntakeProof`、`executionRecoveryProof`、`maintenanceTargetedRerunProof`、`versionRollbackProof`、`operatorBrowserWorkflow`、`operatorPrivacyAuditProof` 和 `operatorPackageAssetReview` 都通过。

### First-Run Usability

- 首次使用路径必须从空本地状态开始，不创建隐式知识库，并让用户通过 Web Console 创建/选择知识库。
- guided setup 必须保存到 SQLite，服务重启后能恢复；general-docs 路径不能继承 K12 必填字段。
- 首次构建必须有可见进度、暂停/恢复、重启恢复、完成状态和脱敏诊断。
- 第一个问题必须走 Query Runtime，返回引用回答或明确 no-answer/refusal，不能把弱答案伪装成成功。
- `0.9.0 First-Run Usability Proof` 要求 release evidence 证明 `firstRunLaunchProof`、`guidedSetupProof`、`buildRecoveryProof`、`firstQuestionProof`、`maintenanceNextActionProof`、`firstRunBrowserWorkflow` 和 `firstRunPackageAssetReview` 都通过。

### Usable Product Proof

- `1.0.0 Usable Product Proof` 在 First-Run 之上证明真实本地服务的启动可靠性、文档摄入质量、Web Console 工作流、持久数据/包操作、浏览器可用性、隐私边界和包资产边界同时通过。
- `smoke:usable-product` 必须证明 `usableLaunchReliabilityProof`、`usableDocumentIntakeProof`、`usableWebConsoleWorkflowProof` 和 `usableDurableDataPackageProof`，并保持执行前外部调用为 `0`。
- `1.0.0-usable-product` release evidence 还需要 `usableBrowserWorkflow`、`usablePrivacyProof` 和 `usableProductPackageAssetReview`，防止本机路径、凭据、私有内容、SQLite/WAL 文件、生成工件或旧 JSON 权威路径进入发布材料。

### Contributor Experience

- 让第一次贡献可以从文档、测试、示例、provider adapter 或 K12 Expert 小任务开始。
- 每个 starter task 都应有清楚边界、验收命令和安全注意事项。
- 保持 README、docs、issue 模板、release note 和 roadmap 同步。

## 非目标

- 不把 KnowMesh 做成普通向量库 UI。
- 不把 CLI 作为普通用户主入口。
- 不捆绑教材或私有文档内容。
- 不为了兼容旧本地草稿而保留已替换的 JSON-first 流程。
- 不把弱答案伪装成成功。

## 如何参与

- 新贡献者先看 [Good First Issues](docs/good-first-issues.zh-CN.md)。
- 想理解代码入口先看 [项目地图](docs/project-map.zh-CN.md)。
- 准备提交 PR 前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 大方向讨论请先对照 [当前设计](docs/current-design.md)，避免生成第二套产品蓝图。
