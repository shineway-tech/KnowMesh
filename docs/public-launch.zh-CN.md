# Public Launch / 公开发布准备

[English](public-launch.en.md) | [文档中心](README.md) | [Release Candidate Freeze](release-candidate-freeze.zh-CN.md)

Block V 把 `1.0.0 Public Release Candidate Freeze` 变成可审阅的公开发布准备包。它不会自动切换仓库 Public、不会自动打 tag、不会自动发布 npm 包；所有发布动作都保持 `human-review-required`。

## V1 Public Switch Decision Packet

- 决策项：Repository visibility、release tag、npm publication、announcement timing。
- 必须记录：RC evidence 路径、artifact sha256、GitHub gate 状态、known gaps、rollback plan。
- 任何自动化只能生成证据，不执行公开、打 tag 或发布。

## V2 Launch Discovery Polish

- README 第一屏要讲清：Knowledge Asset Compiler、本地优先、SQLite-first、可审计、可追溯、可维护、K12 是第一个 Expert 场景。
- GitHub Topics/About、social preview、README 视觉资产、中文默认与完整英文都要可复核。
- 文案保持 Alpha/Launch Candidate 诚实状态，不夸大生产成熟度。

## V3 External Feedback Intake / 反馈入口

- 新反馈优先使用公开样例和可复现命令。
- Issue 不应包含私有文档、`.env`、SQLite、本地路径、学生/客户资料、云凭证或原始 provider payload。
- 反馈进入 `triage:launch`、`triage:intake`、`known-gap`、`triage:release-note` 或可执行 backlog。

## V4 First Contributor Path / 首次贡献者

- docs-only 路径：改 README/docs/examples，验收 `git diff --check` 和对应文档测试。
- code-path 路径：基于 public API 或公开样例补小测试，不读取内部 SQLite，不扩大 JSON-first 运行时。
- PR 必须说明 current-design 对齐、公共 API 边界、双语文档同步和包边界影响。

## V5 Post-Launch Stability / 发布后稳定

- 发布后先看证据：CI、CodeQL、Scorecard、package boundary、integration privacy、RC evidence、反馈趋势。
- 不把反馈直接变成立即功能扩张；先归类为 known gap、docs、provider、K12 quality、integration adoption 或 hardening。
- 下一 Block 由稳定性证据决定，而不是由临时热度决定。

## Commands

```powershell
npm run smoke:public-launch
npm run generate:public-launch
npm run smoke:release-candidate
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

`smoke:public-launch` 输出的是公开发布准备证据；即使全部通过，`publicationDecision` 仍然是 `human-review-required`。
