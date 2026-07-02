# Expert Authoring Kit

[English](authoring.en.md) | [K12 Expert](k12.zh-CN.md) | [当前设计](../current-design.md)

Expert 是领域扩展，不是 Core 分叉。它声明领域对象、关系、质量门槛和查询路由，但必须通过公开 Core 接口接入，不能直接修改 Core 表、读取内部 SQLite 路径，或依赖某个私有工作区布局。

## Manifest 合同

每个 Expert 至少声明这些字段：

| Field | Meaning |
| --- | --- |
| `id` | Expert 稳定 ID。 |
| `templateId` | 绑定的模板或场景模板 ID。 |
| `manifestVersion` | 当前固定为 `1.0.0`。 |
| `supportedContractVersion` | 当前兼容的 Query Runtime / Expert SDK 合同版本。 |
| `title` | 中英文标题。 |
| `supportedSourceTypes` | 支持的来源类型，例如 `pdf`、`office`、`markdown`。 |
| `setupFields` | 需要或推荐用户配置的字段。 |
| `sourceScope` | Expert 的来源范围策略和规则，例如学段/学科/年级或业务域。 |
| `extraction.objects` | Expert 产生的领域对象类型。 |
| `extraction.relations` | 对象之间的关系类型。 |
| `queryRoutes` | Query Runtime 可选择的领域路由。 |
| `queryRouteRules` | 路由规则、优先级和证据策略声明。 |
| `qualityGates` | 构建、查询或发布前必须通过的质量门槛。 |
| `evaluationCases` | Expert 自带的可公开评测类别或样例集合。 |
| `migrations` | Expert 需要的 catalog/schema 迁移声明。 |
| `capabilities` | Expert 暴露的 schema、processor、router、evaluation 等能力。 |
| `docs` | 中英文文档入口。 |
| `requiredTests` | 生命周期升级前必须通过的测试。 |
| `permissions` | 权限声明；没有权限也要写空数组。 |

## Lifecycle

每个 Expert 必须声明 lifecycle stage：`official` -> `certified` -> `community` -> `experimental`。

- `official`：随 Core 一起维护，进入 release gate。
- `certified`：由维护者按文档、测试、安全和运行边界审查过。
- `community`：社区可用扩展，有明确维护者和限制说明。
- `experimental`：探索入口，不代表稳定 API 或发布承诺。

新增 Expert 默认从 `experimental` 开始。无论哪个阶段，都不能直接读取 `catalog.sqlite`、`workspace.sqlite` 或私有工作区路径；必须通过公开 Core / Expert / Query Runtime 接口接入。

## 工程边界

- 使用公开 Core 接口：source manifest、catalog writer、quality gates、Query Runtime route、evaluation manifest。
- JSON 只能作为 manifest、sidecar、示例或导出格式，不能成为运行期主状态。
- 不要提交受版权保护的教材内容、客户资料、学生隐私、云访问密钥明文或私有 source text。
- Contributor 应先写 manifest schema 测试，再补 processor 或 query route。
- `permissions` 不能使用 `*`、`admin`、`filesystem:all` 或 `sqlite:write`。Expert 不能声明 direct SQLite writer，也不能带本机绝对路径、私有 fixture 或 workspace 布局假设。

## Runtime Hooks

Expert 运行时只能通过这些窄接口接入 Core：

| Hook | Purpose |
| --- | --- |
| `sourceScope.decide` | 基于 source manifest 返回来源范围决策。 |
| `classification.hintPageBlocks` | 为页面和 block 分类提供领域提示。 |
| `catalogWriter.writeStructureNodes` | 通过 catalog writer 写结构节点。 |
| `catalogWriter.writeKnowledgeObjects` | 通过 catalog writer 写领域对象和关系。 |
| `queryRoutes.registerRules` | 向 Query Runtime 注册声明式 route rules。 |
| `evaluation.registerCases` | 注册 Expert 评测用例。 |

这些 hook 只暴露能力和边界摘要。诊断输出必须 redacted，不能包含本机绝对路径、来源正文、凭证或内部存储文件名。Expert route rule 只能声明 `citation_ready_evidence_only`、`refuse_before_retrieval` 或 `no_weak_answer` 这类证据策略，不能绕过 Core 的引用与拒答策略。

## Evaluation Cases

Expert evaluation case 使用可移植字段：

- `caseId`、`expertId`、`template`、`category`
- `expectedStatus`：`answered`、`refused` 或 `noAnswer`
- `requiredCitations`
- `refusalExpected`
- `noAnswerExpected`
- `redaction.excludes`

Expert 可以声明自己的评测类别和质量门槛，但不能覆盖 Core Query Gates：引用可追溯、证据支持答案、越界拒答、弱答案不算成功和展示序列化检查仍由 Core 负责。评测失败会映射为 `expert_evaluation_gap` 维护项，进入同一 maintenance review 队列，用于后续定向重跑或资料复核。

## 本地验证

```bash
npm test -- src/local-service/expert-registry.test.mjs
npm test -- src/local-service/expert-runtime.test.mjs
npm test -- src/local-service/expert-evaluation.test.mjs
npm test -- src/local-service/extension-certification.test.mjs
npm test -- src/local-service/query-route-planner.test.mjs src/local-service/query-evidence.test.mjs src/local-service/provider-capabilities.test.mjs
npm run verify:package-boundary
```

新增 Expert 后，至少补：

- `src/experts/<id>/template.json`
- `src/experts/<id>/schema.json`
- registry manifest
- 针对 `sourceScope`、objects、relations、`queryRouteRules`、`qualityGates`、`evaluationCases`、`migrations` 和 `requiredTests` 的测试
