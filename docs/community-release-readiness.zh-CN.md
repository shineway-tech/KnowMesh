# Community Release Readiness / 社区发布准备

[English](community-release-readiness.en.md) | [Community Backlog](community-backlog.zh-CN.md) | [Release Operations](release-operations.zh-CN.md)

Block Y 把已经通过的 API reliability gate 转成面向社区的 release readiness。它关注贡献者能不能看懂、复现、反馈、贡献和长期关注，而不是重新打开产品或 public API 设计。

所有发布副作用仍然保持 `human-review-required`：不自动切 Public、不打 tag、不发布 npm、不创建公告。

## Contributor Onboarding / 贡献者路径

贡献路径分两类：

- docs-only：README、docs、examples、公开样例说明、错别字和链接修复。最低验收是 `git diff --check` 和相关文档测试。
- code-path：只通过 public API、SDK、Query Runtime、公开样例和 focused tests 验证，不读取内部 SQLite，不恢复 JSON-first runtime state。

贡献者必须看到：

- `docs/current-design.md` 是唯一现行设计权威。
- 不保留旧 JSON-first shim。
- 包边界由 `npm run verify:package-boundary` 保护。
- 隐私规则禁止提交 credentials、private documents、local paths、SQLite、generated artifacts。

## Issue Triage / Issue 分流

公开 issue 必须使用 public-safe reproduction。优先使用公开样例、synthetic fixture、命令输出和截图；不要贴私有文档、教材原文、凭据、本机绝对路径或 raw provider payload。

支持 lanes：

- `api-compatibility`
- `query-runtime-reliability`
- `package-install`
- `privacy-security`
- `docs-discovery`
- `k12-expert-feedback`
- `provider-adapter`
- `public-sample`

每条 lane 都要有 owner / 维护者预期、labels、验收命令和 known-gap / release-note carryover 规则。

## Discovery Docs Quality

README 和文档中心需要让第一次看到项目的人快速知道：

- KnowMesh 是 local-first Knowledge Asset Compiler。
- K12 是第一个强化场景，不是全部边界。
- public API、SQLite catalog、citations、quality gates、package preview 和 public samples 是当前可验证价值。
- 当前成熟度仍是 alpha / public launch candidate，不夸大生产稳定性。

中文默认，英文完整；两边都要能找到 getting started、API reliability、integration examples、public samples、roadmap 和 release operations。

## Release Notes And Adoption Loop / Release Notes 与采用循环

release notes 草案必须包含：

- supported paths / 支持路径
- limitations / 限制
- known gaps / 已知缺口
- verification evidence
- package hash / artifact hash
- rollback plan / 回滚计划
- deferred work
- go/no-go packet

adoption loop 入口：

- feedback intake
- sample requests
- integration reports
- provider requests
- K12 quality reports

所有反馈都进入 community backlog，不直接变成发布承诺。

## Decision Packet

`npm run smoke:community-release` 生成 human-review-only packet。它只回答“社区发布准备是否足够让维护者审阅”，不执行任何公开发布动作。

下一块默认进入 `1.0-final-publication-review`，集中处理最终人工发布检查、draft release、tag/npm/visibility 决策和公告材料。
