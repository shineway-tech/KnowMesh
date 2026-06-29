# KnowMesh / 知络

> 把真实文档文件夹变成可审计、可追溯、可维护的知识库。

[English](README.en.md) | [文档中心](docs/README.md) | [当前设计](docs/current-design.md) | [入门指南](docs/getting-started.zh-CN.md) | [架构概览](docs/architecture.zh-CN.md)

![KnowMesh hero](assets/readme/hero.png)

[![CI](https://github.com/shineway-tech/KnowMesh/actions/workflows/ci.yml/badge.svg)](https://github.com/shineway-tech/KnowMesh/actions/workflows/ci.yml)
[![CodeQL](https://github.com/shineway-tech/KnowMesh/actions/workflows/codeql.yml/badge.svg)](https://github.com/shineway-tech/KnowMesh/actions/workflows/codeql.yml)
[![Scorecard](https://github.com/shineway-tech/KnowMesh/actions/workflows/scorecard.yml/badge.svg)](https://github.com/shineway-tech/KnowMesh/actions/workflows/scorecard.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-0f766e.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24-1f6feb.svg)](package.json)
[![SQLite first](https://img.shields.io/badge/state-SQLite--first-334155.svg)](docs/current-design.md)
[![Local first](https://img.shields.io/badge/privacy-local--first-0f766e.svg)](docs/current-design.md)
[![Alpha](https://img.shields.io/badge/status-alpha-f59e0b.svg)](CHANGELOG.md)

KnowMesh 是一个本地优先的开源知识库构建系统。它不是把文件直接塞进向量库的演示工具，而是围绕真实文档资产建立一条可检查、可恢复、可维护、可集成的知识编译流水线。

它适合长期关注，如果你关心这些问题：

- RAG 答案必须能追溯到源文件、页码、章节或原始片段。
- 文档更新后需要版本、差异、回滚和质量检查，而不是覆盖旧结果。
- 多个知识库要隔离 setup、任务、日志、反馈、版本和生成资产。
- 本地状态要可靠保存，刷新页面、换端口、重启服务都不能丢。
- 行业知识库需要领域结构。K12 教材是 KnowMesh 的第一个主要强化场景。

## 为什么不是普通 RAG Demo

很多知识库工具的第一步是“上传文件”，最后一步是“问模型”。KnowMesh 选择另一条路：先把文件夹编译成可治理的知识资产，再让 Query Runtime 基于证据回答。

```text
Source Folder
  -> Scan and classify files
  -> Extract pages, blocks, tables, figures, formulas
  -> Build domain structures and chunks
  -> Write indexes and sidecars
  -> Run quality gates and evaluations
  -> Publish versioned, cited, maintainable knowledge assets
```

这意味着 KnowMesh 关注的不只是“能不能搜到”，还包括：

- 这条答案来自哪里？
- 哪些内容低置信度，需要复核？
- 哪些文件变了，是否需要局部重跑？
- 这个知识库是否可回滚？
- 外部应用能否用同一个 Query Runtime 接入？

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 本地优先 Web Console | 普通用户入口是本地 Web Console，默认运行在 `127.0.0.1:7457`。 |
| SQLite 状态底座 | `workspace.sqlite` 管全局工作区；每个知识库独立 `catalog.sqlite`。 |
| 多知识库隔离 | 每个知识库隔离 setup、任务、资产、日志、反馈、版本和维护状态。 |
| 长任务恢复 | 扫描、OCR、embedding、写入等长任务有 checkpoint、日志、暂停、重试和恢复。 |
| 引用追溯 | Query Runtime 要求答案带来源、页码或结构锚点，不把弱答案伪装成成功。 |
| 质量门禁 | 低置信度内容进入 review，不静默丢弃；发布前后都有质量检查。 |
| K12 强化场景 | 首个主要场景是中国 K12 教材知识库：目录、单元、课文、词表、公式、练习、页码引用。 |
| Aliyun 模式 | 当前完整生产形态优先支持 Aliyun OSS、OSS Vector、Model Studio / DashScope。 |

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

KnowMesh 默认启动一个本地服务：`http://127.0.0.1:7457`。

## 工作流一眼看懂

![KnowMesh architecture](assets/readme/architecture.svg)

1. 创建或选择知识库。
2. 配置模式、provider、模板、来源范围和检索策略。
3. 扫描源文件夹，识别格式、分卷、缺失项和风险。
4. 抽取页面、段落、表格、图片、公式和版面信息。
5. 通过 Expert 生成领域结构，例如 K12 的单元、课文、词表、公式和练习。
6. 清洗、分块、打分，写入索引和 sidecar。
7. 运行质量门禁和评测，发布可回滚版本。
8. 通过同一个 Query Runtime 服务控制台测试和外部集成。

## 第一个主要场景：K12 教材知识库

K12 不是一个标签，而是一个结构化知识领域。KnowMesh Expert - K12 的目标是让教材知识库理解：

![KnowMesh K12 Expert](assets/readme/k12-expert.png)

- 学段、年级、学科、册次、版本、单元、课文、页码；
- 语文课文、作者、注释、词表、课后题、口语交际、习作；
- 数学概念、例题、公式、图形、条件、步骤、练习和答案解析；
- 英语 Unit、Lesson、Words、Sentences、Dialogue、Phonics；
- 科学实验目的、材料、步骤、观察和结论；
- 严格拒绝越界学科、越界教材和无证据问题。

项目不会捆绑教材内容。模板只提供处理策略，用户必须使用自有或已授权资料。

## 当前状态

KnowMesh 仍处于 `0.1.0-alpha` 阶段，方向和底座已经成形，但还不是稳定商业版本。

已经完成的基础：

- SQLite-first workspace 和 per-KB catalog。
- K12 一次性迁移保留。
- 多知识库隔离和 scoped routes。
- release smoke、artifact install smoke、package boundary gate。
- Windows / Ubuntu CI on Node.js 24。
- CodeQL、OpenSSF Scorecard、secret scanning、push protection 和私密漏洞报告。
- `main` 分支保护要求 Ubuntu / Windows CI、PR review 和会话解决。

接下来优先推进：

- 更完整的 Query Runtime 可用性。
- Expert 插件边界和作者文档。
- 更强的本地解析 / OCR provider 适配。
- OpenAPI-ready 集成契约。

## 适合谁

- 想把文档知识库做成长期资产的团队。
- 需要可追溯引用、版本、评测和维护流程的 RAG 应用开发者。
- 教育和知识工程场景，尤其是教材、课程资料、训练材料、政策制度、产品文档。
- 关注 local-first、SQLite、文档智能、可审计 AI 基础设施的开源贡献者。

## 开发与验证

```bash
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
npm run doctor
npm run demo:plan
```

这些本地检查不会上传文件、调用 OCR、调用 embedding，也不会写入向量索引。

## 仓库结构

```text
assets/brand/             Logo and brand assets
assets/readme/            README visual assets
assets/social/            Repository social preview PNG
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
- [Architecture Overview](docs/architecture.en.md)
- [架构概览](docs/architecture.zh-CN.md)
- [Current Design](docs/current-design.md)
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
