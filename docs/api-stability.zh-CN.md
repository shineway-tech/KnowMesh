# Public API Stability / 公共 API 稳定

[English](api-stability.en.md) | [1.0 Stabilization](stabilization.zh-CN.md) | [Query Runtime API](api/query-runtime.zh-CN.md)

1.0 稳定化期间，外部使用者能依赖的是 public API，而不是内部 SQLite、artifacts、sidecars 或浏览器状态。

## 稳定契约

- Query Runtime：`POST /kb/:knowledgeBaseId/api/query` 的 request、status、answer、citations、checks、feedback actions。
- OpenAPI：`docs/api/openapi.json` 是机器可读契约。
- SDK：`createKnowMeshClient`、timeout、request id、错误类型和业务状态处理。
- Integration endpoints：manifest、diagnostics、search、feedback、package preview、version manifest。
- Examples：Node、HTTP 和 expected responses 必须和 OpenAPI 同步。

## Public API Compatibility / 公共 API 兼容

1.0 前的 public API compatibility 由 `npm run smoke:api-reliability` 检查。它会对齐 SDK exports、Integration Manifest、endpoint manifest、OpenAPI paths、Query Runtime response shape 和 expected-response shapes。

兼容性测试会阻止：

- 删除已接受的 public fields。
- 改变 endpoint path、method、contract version 或 response kind。
- 让 OpenAPI 漏掉 endpoint manifest 中的 public path。
- 通过集成接口暴露内部 SQLite、artifacts、sidecars 或 browser storage。

## Status Matrix / 状态矩阵

Query Runtime 的 status matrix 固定为 answered、out_of_scope、insufficient_evidence、no_index、provider_unavailable、blocked_by_quality，并在 API reliability gate 中额外覆盖 feedback-maintenance 路径。

只有 `answered` 可以携带可展示答案和引用；其他 no-answer/refusal 状态必须显式、citation-free，并保留用户可理解的 message、checks、feedback 和 maintenance 信息。

## 不稳定内部

- `workspace.sqlite` 和 `catalog.sqlite` 是内部状态权威，不是外部 API。
- JSON/JSONL 只作为 export、audit、sidecar、report 或 evidence，不作为 runtime truth。
- artifacts、logs、browser storage 和 provider 原始 payload 不能被集成方读取。

## Breaking Change Policy / 破坏性变更

任何 breaking change 必须先满足：

1. 写清影响的 public API 字段或 endpoint。
2. 提供 migration plan / 迁移计划。
3. 更新 OpenAPI、SDK、examples、expected responses 和 docs。
4. 加兼容性测试或明确版本边界。
5. 在 release note 中说明，不通过稳定化脚本自动执行。

缺少迁移计划的破坏性变更进入 blocked decision。
