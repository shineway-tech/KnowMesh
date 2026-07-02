# Community Backlog

[English](community-backlog.en.md) | [Good First Issues](good-first-issues.zh-CN.md) | [Beta Feedback Operations](beta-feedback-operations.zh-CN.md) | [贡献指南](../CONTRIBUTING.md)

这个 backlog 帮维护者把公开仓库任务切成可领取、可验证、无私有数据依赖的小块。所有任务都必须遵守 [当前设计](current-design.md)，不要保留被替换的 JSON-first 运行时路径。

## 推荐 Labels

| Label | 用途 |
| --- | --- |
| `good first issue` | 范围小、验收清楚、适合第一次贡献。 |
| `help wanted` | 维护者愿意接受外部实现或文档补充。 |
| `area:expert` | Expert manifest、schema、对象、关系、评测和作者文档。 |
| `area:provider` | parser、OCR、chat、embedding、rerank、vector、object-store adapter。 |
| `area:integration` | HTTP API、OpenAPI、Query Runtime 示例和 SDK。 |
| `area:operator` | source intake、execution recovery、maintenance review、targeted rerun、version diff/rollback 和 operator diagnostics。 |
| `area:first-run` | 空状态、创建/选择知识库、guided setup、build recovery、first question 和维护下一步。 |
| `area:usable-product` | launch reliability、document intake、Web Console workflow、durable data/package、browser/privacy/package proof。 |
| `area:launch` | Public launch decision packet、discovery polish、feedback intake、first contributor path、post-launch stability。 |
| `area:stabilization` | 1.0 stabilization、public API stability、docs/samples hardening、可靠性与隐私回归。 |
| `area:community-release` | Community Release Readiness、contributor onboarding、issue triage、release notes、adoption loop。 |
| `api-compatibility` | Public API compatibility、OpenAPI、SDK、endpoint manifest、response shape drift。 |
| `query-runtime-reliability` | Query Runtime answered/refusal/no-answer/provider unavailable/quality blocked/feedback-maintenance 状态矩阵。 |
| `package-install` | packed install、launcher-first start、package boundary、artifact hash、public sample reset。 |
| `privacy-security` | local paths、credentials、private content、raw provider payload、browser storage truth、direct SQLite reads。 |
| `docs-discovery` | README first viewport、docs index、中英文同步、search keywords、maturity language。 |
| `k12-expert-feedback` | K12 Expert schema、质量门、评测、教材结构和 citation 问题。 |
| `provider-adapter` | Provider manifest、diagnostics、dry-run、cost/privacy、retry 和 permission 边界。 |
| `public-sample` | 公开样例请求、synthetic fixture、sample ownership、reset safety。 |
| `area:docs` | README、getting started、architecture、roadmap、release docs。 |
| `area:samples` | 公开样例、合成 fixture、sample request。 |
| `sample request` | 请求一个新的公开样例或说明某个场景需要合成样例。 |
| `known-gap` | Public Beta 已确认但需要 release-note carryover 的限制。 |
| `triage:intake` | 新 beta feedback，尚未确认复现范围。 |
| `triage:launch` | 新 public launch feedback，尚未映射到 known-gap、backlog 或 release-note carryover。 |
| `triage:stabilization` | 已通过安全复现门槛，等待进入 1.0 stabilization 队列。 |
| `triage:confirmed` | 已确认并有最小复现或证据。 |
| `triage:queued` | 已进入可执行 backlog 项。 |
| `triage:release-note` | 需要写入 release notes 的 beta 限制或风险。 |
| `triage:closed` | 已修复、已记录限制或不再适用。 |

## Backlog Lanes

- Expert adapter：新增领域对象和 queryRoutes，先补 manifest 测试。
- Provider adapter：先补 adapter contract 和 dryRun 输出，再接执行。
- Integration SDK：基于 HTTP API，不要读取内部 SQLite。
- Operator workflow：增强 source delta、任务恢复、maintenance review、version rollback 和 operatorBrowserWorkflow 证据。
- First-run usability：改进空状态、folder precheck、首次构建恢复、no-answer 解释和 firstRunBrowserWorkflow 证据。
- Usable product proof：补可用产品 smoke、浏览器无溢出、隐私审计、package asset review 和 release evidence 自动化。
- Public launch：只处理公开发布准备、反馈入口、first contributor path 和 post-launch stability，不在自动化中切换仓库可见性或发布 npm。
- 1.0 stabilization：把 Public launch feedback 分流到 docs fix、sample request、integration issue、provider request、K12 quality、known gap 或 blocked decision。
- Community release：`api-compatibility`、`query-runtime-reliability`、`package-install`、`privacy-security`、`docs-discovery`、`k12-expert-feedback`、`provider-adapter`、`public-sample` 每条都要写清 owner / 维护者预期、labels、验收命令和 release-note carryover。
- Public sample：只能使用公开、合成或可授权资料，不要提交私有文档。
- Release operations：补 release-gate evidence、CI/CodeQL/Scorecard、draft release note。
- Beta feedback：Query Runtime、public samples、Integration Examples、Provider、Expert 的反馈必须映射到 known-gap、backlog 或 release-note carryover。

## 安全边界

- 不提交 `.env`、SQLite 数据库、workspace、本地日志、私有源文件或云访问密钥明文。
- 不提交受版权保护教材内容、客户资料、学生隐私或机构内部资料。
- 每个 issue 都写清验收命令，例如 `npm test -- <file>`、`npm run verify:package-boundary`、`git diff --check`。
- 社区发布准备 issue 还应包含 `npm run smoke:community-release`，必要时补 `npm run generate:community-release` 生成 human-review-required evidence。
