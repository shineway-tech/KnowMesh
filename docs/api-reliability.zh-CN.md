# 1.0 API Reliability / 1.0 API 可靠性

[English](api-reliability.en.md) | [Public API Stability](api-stability.zh-CN.md) | [Release Operations](release-operations.zh-CN.md)

Block X 把稳定化结论收束成 1.0 前的 API 可靠性门禁。目标不是增加新功能，而是把外部使用者依赖的 public API、Query Runtime 状态、安装包路径和隐私安全证据固定下来。

发布、打 tag、npm publish、仓库可见性和公告仍然是 `human-review-required`，不会由脚本自动执行。

## 兼容性 Harness

`scripts/api-reliability-evidence.mjs` 会检查 public API compatibility：

- Query Runtime response shape：`ok`、`status`、`answer`、`citations`、`checks`、`feedback`、`maintenance`。
- Integration Manifest：manifest、diagnostics、search、feedback、package preview、version manifest。
- Provider Diagnostics：只暴露 redacted readiness、capability、retry 和 cost/privacy 摘要。
- Package Preview：只暴露 manifest 摘要、hash、reset safety 和 privacy excludes。
- Version Manifest：只暴露版本摘要、active build、rollback candidates 和 manifest path。
- OpenAPI：`docs/api/openapi.json` 必须覆盖 endpoint manifest 中的 public paths。
- SDK：`createKnowMeshClient`、endpoint helpers、timeout、request id、retryable error 和业务状态必须与 manifest 对齐。

任何字段删除、状态漂移、endpoint path 漂移、OpenAPI 漏项或直接暴露内部状态，都会让 API reliability gate 失败。

## Query Runtime 状态矩阵

状态矩阵覆盖：

- `answered`：必须有引用，且只有这个状态能展示 `answer.text`。
- `out_of_scope`：必须显式拒答，引用为空。
- `insufficient_evidence`：必须明确证据不足，引用为空。
- `provider_unavailable`：必须保留可重试语义，引用为空。
- `blocked_by_quality`：质量门拦截时不能伪装成答案。
- `feedback_maintenance`：反馈进入维护路径，但仍不能绕过 Query Runtime contract。

status matrix 同时检查 citation support、display serialization guard、no-answer/refusal 状态和 citation-free fallback。

## 包与安装可靠性

API reliability gate 复用 release candidate 的 fresh-clone rehearsal：

- packed install
- launcher-first start
- public sample creation
- query / refusal / feedback
- package preview / reset
- external temp cleanup
- package assets included
- private state excluded
- Windows / macOS / Linux launcher contracts documented

包边界仍由 `verify:package-boundary` 和 release artifact smoke 保护，SQLite/WAL、私有状态、生成 artifacts、测试、local paths 和 credentials 不能进入公开包。

## 隐私与安全回归

privacy regression 覆盖 docs、examples、SDK、diagnostics、release evidence、public samples、package preview 和 provider outputs。

回归项包括：

- local absolute paths redacted
- credentials redacted
- private content excluded
- raw provider payloads excluded
- browser storage is visual-preferences-only
- no direct SQLite reads through public integrations

## Reconciliation

1.0 API reliability packet 只生成 go/no-go 证据，不做发布副作用。packet 必须包含：

- accepted gaps
- known limitations
- migration notes
- deferred work
- fresh local gates
- human-review-required decision

下一块默认进入 `1.0-community-release-readiness`，继续处理社区发布前的 contributor path、issue triage、release note 和长期 adoption loop。
