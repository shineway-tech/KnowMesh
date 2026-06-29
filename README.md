<div align="center">

# KnowMesh / 知络

**把真实文档文件夹编译成可审计、可追溯、可维护、可集成的知识资产。**

Local-first knowledge asset compiler for auditable RAG, traceable citations, and maintainable document intelligence.

[English](README.en.md) · [文档中心](docs/README.md) · [当前设计](docs/current-design.md) · [快速入门](docs/getting-started.zh-CN.md) · [架构概览](docs/architecture.zh-CN.md)

[![CI](https://github.com/shineway-tech/KnowMesh/actions/workflows/ci.yml/badge.svg)](https://github.com/shineway-tech/KnowMesh/actions/workflows/ci.yml)
[![CodeQL](https://github.com/shineway-tech/KnowMesh/actions/workflows/codeql.yml/badge.svg)](https://github.com/shineway-tech/KnowMesh/actions/workflows/codeql.yml)
[![Scorecard](https://github.com/shineway-tech/KnowMesh/actions/workflows/scorecard.yml/badge.svg)](https://github.com/shineway-tech/KnowMesh/actions/workflows/scorecard.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-0f766e.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-1f6feb.svg)](package.json)
[![SQLite first](https://img.shields.io/badge/state-SQLite--first-334155.svg)](docs/current-design.md)
[![Local first](https://img.shields.io/badge/privacy-local--first-0f766e.svg)](docs/current-design.md)
[![Alpha](https://img.shields.io/badge/status-alpha-f59e0b.svg)](CHANGELOG.md)

![KnowMesh hero](assets/readme/hero.svg)

</div>

KnowMesh 不是“上传文件然后问模型”的 RAG demo，也不是另一个向量库 UI。它把源文件夹当作长期知识资产来编译：抽取页面、块、结构、chunk、引用、质量状态、版本和 Query Runtime 契约，让知识库能被检查、维护、回滚和集成。

它适合你，如果你关心：

- RAG 答案必须追溯到源文件、页码、章节或结构锚点。
- 文档持续更新后，需要差异、局部重跑、版本和回滚，而不是全量重建。
- 多个知识库要隔离 setup、任务、日志、反馈、版本和生成资产。
- 本地状态必须可靠，刷新页面、换端口、重启服务都不能丢。
- 行业知识库需要领域结构。K12 教材是 KnowMesh 的第一个 Expert 场景。

## 为什么需要 KnowMesh

普通 RAG 原型能很快回答“看起来像对”的问题，但真正上线时会遇到更硬的需求：答案证据在哪里，低置信内容怎么复核，源文件变更后怎么局部更新，版本能不能回滚，外部应用能不能走同一套查询契约。

| Ordinary RAG demo | KnowMesh |
| --- | --- |
| 上传文件 | 编译源文件夹 |
| 切块并向量化 | 抽取页面、块、结构、chunk 和引用 |
| 向量库像事实源 | SQLite catalog 是事实源，向量索引用于加速检索 |
| 弱答案也可能看起来成功 | Query gates 要求证据、引用和可拒答状态 |
| 出错后重新跑一遍 | checkpoint、retry、targeted rerun、version、rollback |
| UI 里能问就算完成 | Console 和集成 API 使用同一个 Query Runtime |

## 它如何工作

![KnowMesh workflow](assets/readme/architecture.svg)

1. 选择或创建一个知识库。
2. 扫描源文件夹，识别 PDF、Office、WPS、图片、扫描件和风险文件。
3. 把源材料写入 `workspace.sqlite` 和每个知识库独立的 `catalog.sqlite`，大文件保留在 artifacts。
4. 运行质量门禁：review 队列、评测、引用校验、低置信内容处理。
5. 发布可回滚的知识版本，并生成 sidecar / index 供检索和集成。
6. Query Runtime 基于证据回答，返回引用、检查项和反馈入口。

## 核心能力

| 能力 | 你得到什么 |
| --- | --- |
| Local-first Web Console | 普通用户从本地 Web Console 开始，默认运行在 `127.0.0.1:7457`。 |
| SQLite-first 状态底座 | `workspace.sqlite` 管全局工作区；每个知识库独立 `catalog.sqlite`。 |
| 多知识库隔离 | 每个知识库隔离 setup、任务、资产、日志、反馈、版本和维护状态。 |
| 可恢复长任务 | 扫描、OCR、embedding、写入等长任务有 checkpoint、日志、暂停、重试和恢复。 |
| 可追溯引用 | Query Runtime 要求答案带来源、页码或结构锚点，不把弱答案伪装成成功。 |
| 质量维护闭环 | 低置信内容进入 review；用户反馈能进入维护队列；版本可以 diff 和 rollback。 |
| Expert 场景扩展 | Core 不绑定行业逻辑；K12 是第一个强化 Expert，后续可扩展到更多领域。 |
| Provider 边界 | OCR、parser、embedding、rerank、vector store、object store 都按 provider 边界替换。 |

## 30 秒启动

当前仓库处于 Alpha。普通用户从本地 Web Console 开始，维护者可以先用无密钥 demo 检查本地环境。

### 普通用户启动

```bash
# Windows
.\knowmesh.cmd start
launcher\knowmesh.cmd start

# macOS / Linux
./knowmesh start
launcher/knowmesh start
```

启动器会优先寻找 Node.js 24+。如果缺失，会准备私有 Node 运行时，不会修改系统 PATH。

### 项目维护入口

```bash
npm install
node ./src/cli/knowmesh.mjs start
npm run doctor
npm run demo:plan
```

KnowMesh 默认启动一个本地服务：`http://127.0.0.1:7457`。本地 smoke 和 demo 检查不会上传文件、调用 OCR、调用 embedding，也不会写入向量索引。

## 第一个 Expert 场景：K12 教材知识库

K12 不是 KnowMesh 的全部定位，而是第一个能证明 Expert 机制价值的强化场景。教材不是普通 PDF：它有目录、单元、课文、词表、公式、练习、页码和跨册范围，查询也必须严格拒绝越界学科、越界教材和无证据问题。

![KnowMesh K12 Expert](assets/readme/k12-expert.svg)

KnowMesh Expert - K12 目标是把教材资料编译成结构化知识资产：

- 语文：课文、作者、注释、词表、课后题、口语交际、习作。
- 数学：概念、例题、公式、图形、条件、步骤、练习和答案解析。
- 英语：Unit、Lesson、Words、Sentences、Dialogue、Phonics。
- 科学：实验目的、材料、步骤、观察和结论。
- 引用：可定位到教材、页码、章节或结构锚点。

项目不会捆绑教材内容。模板只提供处理策略，用户必须使用自有或已授权资料。

## 当前状态

KnowMesh 仍处于 `0.1.0-alpha` 阶段，方向和底座已经成形，但还不是稳定商业版本。

已经完成的基础：

- SQLite-first workspace 和 per-KB catalog。
- K12 一次性迁移保留。
- 多知识库隔离和 scoped routes。
- 任务 checkpoint、日志、暂停、重试、恢复。
- Query Runtime 统一控制台测试和集成 API。
- 文档维护、反馈 review、版本记录、诊断导出。
- release smoke、artifact install smoke、package boundary gate。
- Windows / Ubuntu CI on Node.js 24。
- CodeQL、OpenSSF Scorecard、secret scanning、push protection 和私密漏洞报告。
- `main` 分支保护要求 Ubuntu / Windows CI、PR review 和会话解决。

接下来优先推进：

- 更完整的 Query Runtime 可用性。
- Expert 插件边界和作者文档。
- 更强的本地解析 / OCR provider 适配。
- OpenAPI-ready 集成契约。

完整路线见 [ROADMAP.md](ROADMAP.md)。

## 谁会喜欢 KnowMesh

| 人群 | 他们为什么会关心 |
| --- | --- |
| RAG / AI 应用开发者 | 想要有引用、有质量门禁、有反馈闭环、可集成的知识底座。 |
| 知识工程团队 | 需要把持续变化的文档做成可维护、可评测、可回滚的长期资产。 |
| 教育和 K12 场景 | 教材需要目录、单元、课文、词表、公式、练习和页码结构，而不是普通 PDF 问答。 |
| 开源基础设施贡献者 | 关注 local-first、SQLite、document AI、provider adapters 和 Expert plugin 生态。 |

## 开发与验证

```bash
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
npm run doctor
npm run demo:plan
```

## 仓库结构

```text
assets/brand/             Logo and brand assets
assets/readme/            README visual assets
assets/social/            Repository social preview assets
configs/                  Reusable configuration templates
docs/                     Documentation and current design authority
examples/local-demo/      Credential-free local example
examples/textbook-cn-k12/ K12 Aliyun example config
launcher/                 Node-independent user launchers
schemas/                  JSON schemas
scripts/                  Release and package verification scripts
src/cli/                  Local command entry
src/core/                 Core planning and template logic
src/local-service/        Local HTTP service and APIs
src/web-console/          Local Web Console
```

## 文档

- [文档中心](docs/README.md)
- [快速入门](docs/getting-started.zh-CN.md)
- [架构概览](docs/architecture.zh-CN.md)
- [Architecture Overview](docs/architecture.en.md)
- [Roadmap](ROADMAP.md)
- [项目地图](docs/project-map.zh-CN.md)
- [Good First Issues](docs/good-first-issues.zh-CN.md)
- [当前设计](docs/current-design.md)
- [Operations Runbook](docs/phase1-6-operations-runbook.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

`docs/current-design.md` 是唯一现行设计权威。README 和其他文档只做入口、说明和操作指导。

## 贡献

欢迎关注、试用、提 issue、补文档、讨论 Expert 场景或 provider 适配。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 issue 中包含漏洞细节、密钥、文档正文、日志或本地路径。

## License

MIT. See [LICENSE](LICENSE).
