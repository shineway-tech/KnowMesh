# KnowMesh 集成指南

[English](integrations.en.md) | [文档中心](README.md) | [Integration Examples](../examples/integrations/README.md) | [OpenAPI](api/openapi.json)

KnowMesh 的应用集成边界是本地 HTTP API 和 package SDK。下游应用不读取 `workspace.sqlite`、每个知识库的 `catalog.sqlite`、artifacts、sidecar 文件或浏览器存储；这些属于 KnowMesh 内部状态和维护诊断面。

## 先跑通公开样例

本地服务默认绑定 `127.0.0.1:7457`。如果用户选择了其他端口，应用应让用户填写 `baseUrl`，或从自己的启动流程中传入。

```bash
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:browser-sample
```

无密钥试用时，先创建公开样例：

```http
POST http://127.0.0.1:7457/api/public-samples/create
content-type: application/json

{ "sampleId": "general-docs" }
```

样例知识库 id 是 `sample-general-docs`。它不会上传文件、调用 OCR、调用 embedding、写向量索引或创建云资源。

## 集成边界

- SDK 入口：`import { createKnowMeshClient } from "knowmesh"` 或 `knowmesh/sdk`。
- 运行时发现：`GET /api/integration/manifest` 和 `GET /api/integration/diagnostics`。
- Scoped 调用：使用 `/kb/:knowledgeBaseId/...`，不要依赖“当前选中知识库”的 UI 状态。
- 机器契约：[OpenAPI](api/openapi.json) 和 [Endpoint Manifest](api/endpoint-manifest.json)。
- 示例响应：[examples/integrations/expected-responses](../examples/integrations/expected-responses)。

## Server-side Node

适合 RAG 应用、API 服务、CLI、队列任务和内部工具。服务端保存用户选择的 `baseUrl` 与 `knowledgeBaseId`，再用 SDK 调用 KnowMesh。

```js
import { createKnowMeshClient } from "knowmesh";

const client = createKnowMeshClient({
  baseUrl: process.env.KNOWMESH_BASE_URL || "http://127.0.0.1:7457",
  knowledgeBaseId: "sample-general-docs",
  requestId: true
});

const result = await client.query("What review cadence is required?");

if (result.status === "answered") {
  await client.feedback({
    action: "useful",
    question: "What review cadence is required?",
    answerStatus: result.status,
    resultKey: result.resultKey,
    citationRefs: result.citations.slice(0, 1)
  });
}

if (result.status === "out_of_scope" || result.status === "insufficient_evidence") {
  // 把业务状态展示给用户；不要盲目重试。
}
```

## Electron / 本地桌面应用

桌面应用建议由 main process 调 KnowMesh，本地 renderer 通过 IPC 请求 main process。这样可以把 `baseUrl`、request id、反馈和错误处理集中在可信进程中。

- 默认只连接 `127.0.0.1`。
- 不把 KnowMesh local service 直接暴露到局域网。
- Renderer 不读取本机文件状态，不拼接 artifacts 或 sidecar 路径。
- 如果用户改了端口，main process 先调用 integration diagnostics 检查 readiness 和 CORS 说明。

## 浏览器应用通过后端访问

公共浏览器前端不要直接访问用户机器上的 KnowMesh local service。推荐路径是：

```text
Browser UI -> your backend/API -> KnowMesh local service
```

你的后端负责登录、授权、TLS、网络策略和审计。KnowMesh 默认不提供广域访问认证层，也不默认开放 broad CORS。需要远程访问时，必须由调用方管理认证、TLS、反向代理和网络边界。

## CI / 集成验收

下游项目可以把 KnowMesh 当作本地集成依赖验证：

```bash
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run verify:package-boundary
```

`smoke:sdk-consumer` 证明安装包的 SDK exports 可用；`smoke:live-sdk` 会启动临时服务、创建公开样例、通过已安装 SDK 调真实 HTTP API、提交反馈并重置样例；`verify:package-boundary` 防止发布包混入私有运行时状态。

## 重试和错误处理

SDK 的 `KnowMeshApiError` 用于 transport/API 错误，例如 timeout、network error、HTTP 408/429/5xx、`provider_unavailable`。这些情况可以按 `error.retryable` 做有限重试。

Query Runtime 的 `answered`、`out_of_scope`、`insufficient_evidence`、`blocked_by_quality` 是产品状态。HTTP 200 的拒答或证据不足会作为结果返回，不应当被当作异常或无限重试。

## 反馈和维护入口

集成方应该把用户反馈写回 KnowMesh，而不是在自己的应用里复制一份“隐藏维护系统”。

- `wrong_citation`：引用错误，进入维护 review。
- `missed_point`：答案遗漏，进入维护 review。
- `useful`：正向信号。
- 反馈汇总：`GET /kb/:knowledgeBaseId/api/query/feedback/summary`。
- 用户维护页：`/kb/:knowledgeBaseId/use/feedback` 和 `/kb/:knowledgeBaseId/maintain/diagnostics`。

## 隐私和本地边界

- 默认本地：`127.0.0.1`。
- 默认不上传、不同步、不创建云资源。
- 不记录密钥、源文档正文、原始 provider 响应或本机绝对路径到公开日志。
- 不把 SQLite、artifacts、sidecar、browser storage 当成集成 API。
- 如果启用云 provider，先让用户在 KnowMesh 中完成显式配置和确认，再执行对应任务。

## 参考

- [Integration Examples](../examples/integrations/README.md)
- [Query Runtime API](api/query-runtime.zh-CN.md)
- [OpenAPI](api/openapi.json)
- [Endpoint Manifest](api/endpoint-manifest.json)
- [Provider 适配器](providers.zh-CN.md)
