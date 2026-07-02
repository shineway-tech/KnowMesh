# Query Runtime API

[English](query-runtime.en.md) | [OpenAPI 规范](openapi.json) | [文档中心](../README.md) | [当前设计](../current-design.md)

Query Runtime 是 KnowMesh 对控制台和集成方共同承诺的问答契约。它不是 UI 内部快捷路径，也不是直接访问向量库的薄封装；调用方应始终通过当前知识库的 Query Runtime 获取回答、引用、检查项和反馈入口。

机器可读规范见 [OpenAPI 3.1](openapi.json)，覆盖 Query、反馈、搜索、维护、包预览和版本端点。

## 端点

```text
POST /kb/:knowledgeBaseId/api/query
GET  /kb/:knowledgeBaseId/api/query/contract
POST /kb/:knowledgeBaseId/api/query/plan
POST /kb/:knowledgeBaseId/api/query/feedback
GET  /kb/:knowledgeBaseId/api/query/feedback/summary
POST /kb/:knowledgeBaseId/api/query/feedback/resolve
```

未选择知识库时，`/api/query` 不会隐式落到默认知识库。集成方应使用 scoped 路径。

## 请求

```json
{
  "question": "五年级统编版语文第三单元第一课是什么？",
  "scope": {},
  "intent": "",
  "filters": {},
  "debug": false
}
```

字段：

- `question`：必填，自然语言问题。
- `scope`：可选范围提示，例如调用方已知的文档、教材或业务范围。
- `intent`：可选 intent 提示；KnowMesh 仍会执行 query understanding。
- `filters`：可选 catalog 检索过滤，例如 `documentId`、`pageStart`、`pageEnd`、`sourceType`。
- `debug`：可选诊断标记，默认 `false`。

## 响应字段

稳定公共字段：

- `ok`
- `status`
- `answer`
- `citations`
- `checks`
- `feedback`
- `maintenance`

只有 `ok=true` 且 `status=answered` 时，才展示 `answer.text` 为可靠答案。拒答或证据不足时，`answer.text` 为空，调用方应展示 `answer.message`、`checks` 或维护建议。

`query.evidencePack` 是集成方稳定使用的证据交接面。当前 contract version 是 `2026-07-query-runtime.1`，`answerPolicy` 固定为 `citation_ready_evidence_only`。每个 item 可包含 `chunkId`、`citationId`、`documentId`、`documentStatus`、`qualityState`、`structurePath`、`rankingSignals`、`sourceAnchor` 和 scoped links。

## 状态

| 状态 | 含义 |
| --- | --- |
| `answered` | 已生成有证据、有引用、通过质量门的回答。 |
| `out_of_scope` | 问题明确超出当前知识库范围，检索前或检索后拒答。 |
| `insufficient_evidence` | 没有足够可追溯证据，不能生成答案。 |
| `no_index` | 检索索引或 sidecar 契约缺失。 |
| `provider_unavailable` | 需要的 provider 未配置或不可用。 |
| `blocked_by_quality` | 引用、支持关系、弱答案或展示序列化未通过质量门。 |
| `invalid_request` | 请求格式或问题为空。 |
| `runtime_error` | Query Runtime 内部异常。 |

## 引用

每个可用答案必须携带可追溯引用。引用至少应能回到：

- 源文档；
- 页码或结构锚点；
- 摘要片段；
- 文档或诊断链接。

拒答不应返回无关引用。若引用缺页码、结构锚点，或引用内容不足以支持答案，响应不能计为 `answered`。

## 质量门

Query Runtime 至少返回这些检查项：

- `scopeFit`
- `evidenceFound`
- `citationTraceability`
- `citationSupportsAnswer`
- `noOutOfScopeLeakage`
- `noWeakAnswer`
- `displaySerialization`

调用方可以把 `checks` 渲染为诊断说明，但不要把失败检查的响应包装成成功回答。

## 反馈

`feedback.endpoint` 指向当前知识库的反馈接口。推荐支持：

- `useful`：正向信号，不进入 review 队列；
- `wrong_citation`：引用问题，进入问答反馈 review；
- `missed_point`：回答漏点，进入问答反馈 review。

反馈必须包含当前知识库范围，不要把多个知识库的反馈写到同一队列。

## 发现与诊断

- `GET /api/integration/manifest` 返回当前支持的集成端点、响应类型、可重试性和隐私说明。
- `GET /api/integration/diagnostics` 返回 API 就绪度、重试语义、知识库选择要求以及 localhost/CORS 指引。
- 有明确知识库的应用应优先使用 `/kb/:knowledgeBaseId/api/integration/diagnostics`，再发送用户问题。
- KnowMesh 默认绑定 `127.0.0.1`。不要直接把本地服务暴露到远程网络；如需远程访问，应在 KnowMesh 外部显式配置认证、TLS 和网络策略。
- 只重试 timeout、本地服务不可用、HTTP 408/429/5xx、网络错误和 `provider_unavailable`。
- 不要重试 `invalid_request`、`out_of_scope`、`insufficient_evidence` 或 `knowledge_base_required`；应展示产品状态或维护动作。

## 集成规则

- 调用 Query Runtime，不要绕过到向量 bucket。
- 只在 `ok=true && status=answered` 时展示答案正文。
- 把 `query.evidencePack` 当作证据面，不要读取内部 SQLite。
- 总是展示来源、页码或结构锚点。
- 对 `out_of_scope` 和 `insufficient_evidence` 使用拒答/补资料提示。
- 对 `provider_unavailable` 和 `blocked_by_quality` 使用可操作的产品状态，不要当成普通网络错误。
- 不要记录密钥、原文全文或 provider 内部异常到外部日志。

## `0.3.0` 验收证据

Query Runtime 进入 `0.3.0` 时必须通过 release evidence：route contract readiness、citation-grounded answer proof、refusal/no-answer proof、feedback-maintenance proof、integration contract proof 和 browser ask workflow。验收命令见 [Release Operations](../release-operations.zh-CN.md)。
