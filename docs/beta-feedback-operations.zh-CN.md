# Beta Feedback Operations

[English](beta-feedback-operations.en.md) | [Community Backlog](community-backlog.zh-CN.md) | [Release Operations](release-operations.zh-CN.md) | [当前设计](current-design.md)

Public Beta 反馈不是零散评论，而是一条可追踪的维护流程。它把 Query Runtime、public samples、Integration Examples、Provider adapters 和 Expert 扩展反馈转成 backlog、known-gap 和 release-note carryover。

## 入口

- Query Runtime feedback：有帮助只记正向信号；引用不对、遗漏知识点、无答案误判进入维护复核。
- public samples：样例创建、引用回答、反馈、package preview、version manifest、reset 失败都进入 `area:samples`。
- Integration Examples：OpenAPI、Node SDK、HTTP 示例、错误响应、timeout 和 retryable 行为进入 `area:integration`。
- Provider：dry-run、权限、外部调用、诊断、local parser pilot、OCR/vector/object-store 适配进入 `area:provider`。
- Expert：manifest、schema、objects、relations、queryRoutes、evaluation 和 lifecycle graduation 进入 `area:expert`。

## Triage 状态

| Label | 含义 | 关闭条件 |
| --- | --- | --- |
| `triage:intake` | 新反馈，尚未确认复现范围。 | 复现、归类或关闭为无效。 |
| `triage:confirmed` | 已确认且有最小复现或证据。 | 进入排期、修复或转 known-gap。 |
| `triage:queued` | 已进入一个可执行 backlog 项。 | 对应 PR 合并或明确延期。 |
| `triage:release-note` | 需要 release-note carryover。 | release notes 写明 supported path、limitations、known-gap。 |
| `triage:closed` | 已修复、已记录限制或不再适用。 | issue 中有验收命令和结果。 |

## Known-gap Mapping

`known-gap` 必须说明：

- 影响路径：Query Runtime、public samples、Integration Examples、Provider、Expert 或 Release Operations。
- 用户影响：会阻断构建、影响答案可信度、只影响文档，还是只影响某个 adapter。
- 当前规避方式：例如改用 local-only、跳过某类 source、手动转换 legacy Office。
- release-note carryover：如果 Public Beta 仍带着这个 known-gap，它必须写入 release notes。

## 验收命令

每个 beta feedback item 至少写一个可重复命令：

```bash
npm test -- <changed-test-files>
npm run smoke:browser-sample
npm run generate:release-evidence -- --browser-sample-flow pass --beta-release-notes pass
npm run verify:package-boundary
git diff --check
```

## 安全边界

- no private source material, no private logs, no local machine paths, no credentials.
- 不贴 `.env`、SQLite 数据库、workspace、OCR 原文、模型输出或真实教材内容。
- 复现材料必须使用 public samples、synthetic fixtures 或明确可公开授权资料。
