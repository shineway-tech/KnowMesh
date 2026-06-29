# KnowMesh 项目地图

[English](project-map.en.md) | [文档中心](README.md) | [当前设计](current-design.md)

本文帮助贡献者快速找到代码入口。它是导航文档，不是架构权威；权威设计以 `docs/current-design.md` 为准。

## 先理解五层

| 层 | 看哪里 | 贡献入口 |
| --- | --- | --- |
| Platform Layer | `launcher/`, `src/cli/` | 启动器、Node 版本门禁、跨平台路径、普通用户启动体验 |
| Web Console | `src/web-console/`, `src/local-service/` | 本地控制台、API routes、用户流程、文案和可访问性 |
| KnowMesh Core | `src/core/`, `src/local-service/` | scan、setup、tasks、source scope、version、maintenance |
| Knowledge Asset Layer | `src/local-service/`, SQLite migrations/tests | `workspace.sqlite`、`catalog.sqlite`、文档/页面/结构/chunk/反馈/版本 |
| KnowMesh Expert | `src/core/`, K12 tests and examples | K12 结构、领域对象、评测、query routing |
| Provider Layer | provider-related modules and examples | parser、OCR、embedding、rerank、vector store、object store 边界 |

## 常见任务怎么找

| 想做什么 | 从哪里开始 |
| --- | --- |
| 跑通本地无密钥 demo | `docs/getting-started.zh-CN.md`, `examples/local-demo/` |
| 理解当前架构 | `docs/architecture.zh-CN.md`, `docs/current-design.md` |
| 修改 Web Console 页面 | `src/web-console/`，再找对应 `src/local-service/` API |
| 修改本地服务 API | `src/local-service/`，并补对应 node test |
| 修改知识库状态或任务恢复 | 先读 `docs/current-design.md` 的 Storage / Pipeline，再找 catalog/workspace 相关测试 |
| 修改 K12 Expert | 先读 `examples/textbook-cn-k12/`，再找 K12 page classifier / query router / evaluation tests |
| 修改发布包边界 | `scripts/verify-package-boundary.mjs`, `scripts/verify-release-artifact.mjs` |
| 修改启动器 | `launcher/`, root `knowmesh.cmd`, root `knowmesh`, `src/launcher/launcher.test.mjs` |
| 修改公开文档 | README、`docs/README.md`、`ROADMAP.md`、`CONTRIBUTING.md`，并保持英文镜像 |

## 开发路线

1. 先确认问题属于哪个层。
2. 读相关测试，优先跟随现有模式。
3. 如果变更会影响产品方向、数据模型或长期 UX，先对照 `docs/current-design.md`。
4. 如果旧 JSON/JSONL 路径已经被 SQLite/catalog 替代，不新增兼容垫片。
5. 提交前至少跑与变更相关的测试；发布包、README、启动器或公开文档变更还要跑 package boundary。

## 推荐第一次贡献

- 文档澄清：改 README、Getting Started、Project Map 或 Roadmap。
- 测试补强：为一个已有 API 或迁移路径补缺口测试。
- 示例补强：让 `examples/local-demo/` 更容易被新用户理解。
- Provider 研究：补一个 provider capability matrix 条目，不接入真实密钥。
- K12 Expert 文档：解释一个结构对象或 query routing 行为，不加入教材内容。

更多 starter 任务见 [Good First Issues](good-first-issues.zh-CN.md)。
