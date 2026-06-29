# KnowMesh Good First Issues

[English](good-first-issues.en.md) | [项目地图](project-map.zh-CN.md) | [贡献指南](../CONTRIBUTING.md)

KnowMesh 的 starter task 应该小、清楚、可验证，并且不会要求贡献者接触私有文档、云密钥或真实教材内容。

## 适合第一次贡献的任务类型

| 类型 | 适合做什么 | 验收方式 |
| --- | --- | --- |
| `area:docs` | 澄清 README、Getting Started、Roadmap、Project Map | 链接正确、双语同步、`git diff --check` |
| `area:examples` | 改进 `examples/local-demo/` 的说明、文件命名、预期输出 | `npm run doctor`, `npm run demo:plan` |
| `area:tests` | 为已有 API、迁移、任务恢复或启动器补测试 | 相关 `node --test ...` 或 `npm test` |
| `area:web-console` | 文案、空状态、按钮标签、无密钥 demo 可理解性 | 本地页面可读，API 行为不变 |
| `area:provider` | provider 能力说明、错误提示、无密钥能力矩阵 | 不引入真实密钥，不调用云 |
| `area:expert-k12` | K12 结构说明、评测样例格式、query router 文档 | 不加入教材正文，不扩大 Core 行业逻辑 |

## Starter Issue 模板

一个好的 starter issue 应该包含：

- 背景：为什么这个任务对知识资产可靠性、可追溯性、维护性或集成性有帮助。
- 范围：明确要改哪些文件，不要泛化成大重构。
- 非范围：明确不需要接入云、不需要真实教材、不需要改设计权威。
- 验收：列出命令，例如 `npm run verify:package-boundary` 或指定 `node --test`。
- 安全：提醒不要提交 `.env`、SQLite、workspace、私有文档、日志或本地路径。

## 首批建议任务

这些任务适合被维护者复制成 GitHub issue：

### 1. Improve local demo explanation

Labels: `good first issue`, `area:examples`, `documentation`

Scope:

- Review `examples/local-demo/` and `docs/getting-started.zh-CN.md`.
- Add clearer wording about what `npm run doctor` and `npm run demo:plan` do and do not do.
- Keep the no-upload/no-OCR/no-embedding guarantee explicit.

Acceptance:

- `npm run doctor`
- `npm run demo:plan`
- `git diff --check`

### 2. Add a provider capability matrix doc section

Labels: `good first issue`, `area:provider`, `documentation`

Scope:

- Add a small provider matrix to architecture or a new docs section.
- Explain parser, OCR, embedding, rerank, vector store, object store at a capability level.
- Do not add real credentials or provider-specific secret examples.

Acceptance:

- `git diff --check`
- Links from docs home are valid.

### 3. Document one K12 Expert object

Labels: `good first issue`, `area:expert-k12`, `documentation`

Scope:

- Pick one object type such as TOC entry, lesson, vocabulary, formula, exercise, or experiment.
- Explain what it means, what source anchor it should keep, and how citations should reference it.
- Do not include textbook content.

Acceptance:

- `git diff --check`
- The doc states that K12 is an Expert scenario, not Core.

### 4. Add a focused test for a documented behavior

Labels: `good first issue`, `area:tests`

Scope:

- Pick one existing behavior already described in docs or tests.
- Add a narrow regression test without changing product behavior.
- Prefer local-only paths that do not require cloud credentials.

Acceptance:

- The targeted `node --test ...` command passes.
- `npm test` passes if the change touches shared behavior.

## 不适合第一次贡献的任务

- 重新设计 SQLite schema 或 migration strategy。
- 改 Query Runtime 的成功/失败语义。
- 接入真实云 provider、真实密钥或真实教材。
- 修改 `docs/current-design.md` 的长期方向。
- 保留被替换的 JSON-first 运行时路径。
