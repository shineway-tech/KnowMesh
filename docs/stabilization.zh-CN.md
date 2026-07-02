# 1.0 Stabilization / 1.0 稳定化

[English](stabilization.en.md) | [文档中心](README.md) | [Public Launch](public-launch.zh-CN.md) | [API Stability](api-stability.zh-CN.md)

Block W 把 public launch feedback 转成 `1.0 Stabilization` 证据。它不发布 npm、不打 tag、不切换仓库可见性；`stabilizationDecision` 继续保持 `human-review-required`。

## W1 Feedback Triage / 反馈分流

公开反馈必须先进入稳定化队列，而不是直接变成新功能。

分类：

- docs fix：README、Getting Started、public samples、integration examples、provider diagnostics、K12 Expert 说明。
- sample request：需要新的公开样例或合成 fixture。
- integration issue：Query Runtime、OpenAPI、SDK、HTTP 示例或 expected responses 漂移。
- provider request：provider diagnostics、capability matrix、credential-free 路径或显式执行边界。
- K12 quality：结构、对象、范围、拒答或评测质量问题。
- known gap：可接受但需要 release-note carryover 的限制。
- blocked decision：缺少公开复现、涉及私有数据、需要破坏性变更或需要人工发布决策。

Promote 到工程队列前必须有 safe reproduction：公开样例复现、命令输出、无私有路径、无凭证、无 SQLite 数据库、无私有正文。

## W2 Public API Stability / 公共 API 稳定

稳定化默认保护这些公开契约：

- Query Runtime response shape、status、citations、checks、feedback action。
- Integration manifest、diagnostics、package preview、version manifest。
- SDK export：`createKnowMeshClient`、错误类型、timeout/request id 行为。
- OpenAPI 和 examples expected responses。

任何 breaking change / 破坏性变更都必须先有 migration plan / 迁移计划，且默认进入 blocked decision。

## W3 Docs And Samples Hardening

优先修最高摩擦路径：

- README 第一屏和 30 秒启动。
- Getting Started 的无密钥路径。
- Public Samples 的 credential-free、no upload、package preview 和 Query Runtime 说明。
- Integration Examples 的 public API 边界。
- Provider diagnostics 的成本、隐私、凭证和无云默认。
- K12 Expert 的范围、拒答和结构说明。

## W4 Reliability And Privacy

稳定化证据至少复核：

```powershell
npm run smoke:release-candidate
npm run smoke:public-launch
npm run smoke:stabilization
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

这些证据必须 public-safe：不包含本地绝对路径、私有源文件、SQLite/WAL、凭证、原始 provider payload 或浏览器临时状态。

## W5 Decision

默认 next block：`1.0-api-reliability-hardening`。只有稳定化证据显示更紧急的问题时，才改成 docs/community、K12 quality、provider adoption 或 integration adoption。

发布、tag、npm 和公开公告仍然是人工审核，不由脚本执行。
