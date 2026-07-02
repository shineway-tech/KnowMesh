# Provider 适配器

[English](providers.en.md) | [文档中心](README.md) | [当前设计](current-design.md)

KnowMesh 的 Provider Layer 负责把解析、OCR、模型、embedding、rerank、vector store、object store 等外部或可替换能力隔离在 Core 之外。Core 编排知识资产生命周期，Provider 只声明能力、成本、隐私边界、依赖和可修复错误。

## 当前 Provider

| Provider | 状态 | 作用 | 边界 |
| --- | --- | --- | --- |
| Local Catalog and SQLite | 默认启用 | `workspace.sqlite` 与每个知识库 `catalog.sqlite` 的状态、检索和维护真相 | 仅本机 |
| Local Parser | 默认启用 | 文本、Markdown、CSV/TSV、RTF、新版 Office 的本地解析；旧 Office/WPS 通过转换器 | 仅本机 |
| Local OCR / Layout | 可选 | PaddleOCR / PP-Structure 或兼容 OCR 命令 | 仅显式配置后调用 |
| Local Vector Search | 当前默认关闭 | 未来本地向量加速层 | 关闭时 Query Runtime 回退到 catalog/FTS |
| Aliyun OSS Source Storage | 可选云 provider | 原始资料归档与 sidecar 发布 | 资料会离开本机并写入 OSS |
| Aliyun Model Studio | 可选云 provider | OCR、内容整理、embedding、rerank、回答生成 | 文本/图片输入会发送给模型服务 |
| Aliyun OSS Vector | 可选云 provider | 向量索引准备、向量写入和向量查询 | 向量与 compact metadata 写入 OSS Vector |

## 可见能力

`/api/providers/capabilities` 会返回：

- provider 类型、状态、setup 要求；
- capability 列表；
- cost units；
- privacy boundary；
- batch 支持和 fallback；
- retry 策略；
- 最小权限动作；
- user-fixable errors；
- `providerAdapterManifests`：每个 provider adapter 的 id、kind、lifecycle、capabilities、execution、permissions、secretRequirements、privacyBoundary、costHints、batchLimits、retryPolicy、checkpointPolicy、storageBoundary、docs、fixtures 和 requiredTests；
- `providerAdapterManifestSummary`：manifest 总数、本地优先数量、外部 provider 数量、kind 分布和验证结果；
- `adapterContracts`：parser、OCR、chat、embedding、rerank、vector、object-store 的稳定接口版本、必需方法和边界；
- `dryRun`：执行前展示已配置 provider、缺失 provider、将发生的外部调用和是否写远端状态；
- 不含明文密钥、文档正文、query text、answer text。

维护页会同时展示 Provider Capabilities 和 Platform Runtime，用户可以在执行前看到成本、隐私、权限和本机依赖状态。

## Provider Adapter Manifest

Block O 开始后，Provider 接入以 `providerAdapterManifests` 为主合同，而不是先写散落的 provider 分支。内建 manifest 先覆盖：

- `local-catalog`
- `local-parser`
- `local-ocr`
- `local-vector-sidecar`
- `aliyun-oss`
- `dashscope-ocr`
- `aliyun-oss-vector`
- `dashscope-embedding`
- `dashscope-rerank`
- `no-rerank-fallback`
- `no-provider-fallback`

`validateProviderAdapterManifest` 会拒绝通配权限、直接写内部 SQLite、隐式外部调用、外部 provider 缺少 dry-run、缺少 docs/tests、private fixtures，以及没有毕业条件却标成 certified/official 的 adapter。云 provider 必须先通过 dry-run 告诉用户会发送什么数据、是否写远端状态、需要哪些最小权限和密钥；local-only 路径必须证明不会静默联网。

## `0.5.0 Provider Adapters` release evidence

`0.5.0 Provider Adapters` 的目标是把 provider 边界从“若干配置和分支”提升为可审计、可替换、可发布验收的基础能力。它在 `0.4.0 Expert SDK` evidence 之上继续要求：

- `providerManifestReadiness`：manifest contract、validation 和 capability inventory 都通过。
- `parserOcrBoundaryProof`：parser preflight、OCR preflight 和 unsafe input review 都通过，宏文件和不支持格式进入 review，不绕过 catalog/artifact truth。
- `embeddingVectorBoundaryProof`：embedding batch contract、vector output validation 和 catalog fallback 都通过，向量只作为加速层。
- `providerDiagnosticsBrowserProof`：Web Console 在桌面和窄屏都通过 scoped API 渲染 provider diagnostics，状态权威来自 `workspace.sqlite` 和 `catalog.sqlite`，浏览器存储只保留视觉偏好。
- `noCloudPublicPathProof`：公开样例和 local-first 路径 no-cloud、credential-free，执行前 `externalCallsBeforeExecution` 为 `0`。
- `providerPackageAssetReview`：包资产不含私有状态、SQLite、密钥、生成工件，也没有 direct-provider bypass 路径。

验收命令：

```bash
node ./scripts/release-gate.mjs --stage provider-adapters --evidence ./release-evidence.json
```

生成 evidence 时可使用 `--provider-adapters` 或 `--stage provider-adapters`。直接 provider 绕路审计会阻断 legacy provider state、provider bypass、direct cloud call 或把 provider 执行 JSON/JSONL 当作可变主状态的路径。

## Lifecycle

Provider adapter 必须声明 lifecycle stage：`official` -> `certified` -> `community` -> `experimental`。

- `official` adapter 随 Core release gate 一起验收。
- `certified` adapter 需要声明权限、dry-run 行为、错误恢复和隐私边界，并通过维护者审查。
- `community` adapter 需要清楚标注维护者、限制、依赖和安全注意事项。
- `experimental` adapter 只用于探索，不应被文档描述成稳定运行路径。

Provider 不允许使用 `*` 通配权限，也不允许直接依赖内部 SQLite 文件路径。必须通过 provider contract、capability matrix、diagnostics 和 package preview 暴露可审计信息。

## Local Parser Pilot

`local-parser` 是第一个 certified provider adapter pilot：

- lifecycle stage: `certified`；
- externalCallsBeforeExecution: `0`；
- permissions: `[]`；
- catalogWriteBoundary: `catalog-writer-api`；
- requiredMethods: `scanSources`、`readTextLikeSource`、`readModernOfficeSource`、`checkpointExtractionResult`；
- user-fixable errors: `legacyConverterMissing`、`fileUnreadable`。

它只在本机解析文本、Markdown、CSV/TSV、RTF 和新版 Office；旧 Office/WPS 需要 LibreOffice 或 WPS converter。它不执行宏，不直接操作内部 SQLite 文件路径，解析结果必须通过公开 writer API 进入 catalog。

## 执行规则

- OCR、embedding、rerank、vector 写入和评测优先使用 provider batch 能力。
- 外部调用使用有界并发。
- 只重试网络错误、timeout、429、5xx 和 provider 声明的 transient 错误。
- batch-size 错误会自动拆分批次。
- authentication、permission、model-not-found、invalid-index 立即失败，并给出用户可修复建议。
- 密钥不得进入 SQLite、日志、导出、报告或 sidecar。

## 本地向量回退

Local Vector Search 现在是可关闭的 provider contract。关闭时：

- `local-vector` provider 状态是 `disabled`；
- `localVectorSearch` capability 状态是 `disabled`；
- Query Runtime 继续使用 catalog/FTS 和结构索引返回有引用的答案；
- 不会为了本地模式静默调用 embedding 或 OSS Vector。

这让 KnowMesh 可以先保持 SQLite/catalog 为业务真相，同时为后续本地 embedding/vector 引擎留下清晰接入点。

## local-only、Aliyun 和未来适配器

local-only 模式下，parser 和 SQLite catalog 默认可用；OCR、embedding、rerank、vector、object-store 没有显式配置时不会静默联网，`dryRun.summary.externalCallsBeforeExecution` 必须为 `0`。

Aliyun 模式下，Model Studio、OSS、OSS Vector 只有在用户完成配置并确认后才进入 `dryRun.externalCalls`。dryRun 只描述 provider、adapter、operation、是否发送 source content、是否写远端状态，不包含明文密钥或 source text。

未来适配器必须先补 `adapterContracts` 对应接口和测试，再接入执行流。贡献者应把能力暴露到 `/api/providers/capabilities`，并证明诊断导出、package preview、日志、public samples 和 sidecars 都不会包含敏感值。
