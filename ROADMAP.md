# KnowMesh Roadmap

[English](ROADMAP.en.md) | [README](README.md) | [当前设计](docs/current-design.md)

KnowMesh 的路线图围绕一个目标推进：把源资料编译成可信、可检查、可维护、可集成的知识资产。本文是公开路线入口，不是新的设计权威；详细产品、架构和数据约束以 [docs/current-design.md](docs/current-design.md) 为准。

## 当前阶段

KnowMesh 当前处于 `0.1.0-alpha`。架构底座已经从 JSON-first 切换到 SQLite-first：

- `workspace.sqlite` 管理全局工作区、知识库注册、当前选择、setup/task 摘要。
- 每个知识库拥有独立 `catalog.sqlite`，保存文档、页面、结构、chunk、任务、质量、反馈、版本和发布状态。
- Web Console、Query Runtime、任务恢复、文档维护和版本记录已经围绕 per-KB catalog 收敛。
- K12 是第一个主要 Expert 场景，用来验证“领域结构优先于普通 PDF 问答”的方向。

## 近期路线

| 阶段 | 目标 | 主要工作 |
| --- | --- | --- |
| `0.1.x` Alpha Foundation | 让公开仓库可信、可运行、可贡献 | 文档入口、release draft、CI/CodeQL/Scorecard、安全设置、Good First Issues、贡献流程 |
| `0.2.0` Searchable | 让知识资产可稳定检索 | 本地全文检索、结构检索、vector sidecar 合同、source scope、索引状态诊断 |
| `0.3.0` Query Runtime | 让真实问题返回有证据的答案 | cited answer contract、拒答、反馈入口、集成 API、评测样例 |
| `0.4.0` Expert SDK | 让行业场景可扩展 | Expert 插件边界、K12 处理器文档、评测集格式、作者指南 |
| `0.5.0` Provider Adapters | 让解析/OCR/embedding 可替换 | local parser/OCR adapters、Aliyun mode 强化、provider capability matrix |
| `1.0.0` Usable | 让非维护者能可靠构建和使用知识库 | 稳定 Web Console、迁移纪律、错误恢复、版本发布、query API 文档 |

## 重点方向

### Query Runtime 可用性

- 同一个 Query Runtime 服务控制台问答和外部集成。
- 回答必须带来源、页码或结构锚点。
- 越界问题、证据不足和低置信回答要可拒答、可解释、可反馈。

### Knowledge Asset Layer

- 文档、页面、块、结构、chunk、引用、评测、反馈和版本以 catalog 为事实源。
- JSON/JSONL 保留为导出、审计和 sidecar，不再作为主要运行时状态。
- 版本发布需要可 diff、可 rollback、可诊断。

### Expert 场景

- Core 保持行业中立。
- K12 继续作为第一个强化场景，覆盖目录、单元、课文、词表、公式、练习、实验和页码引用。
- 后续 Expert 必须声明领域对象、质量门禁、评测集和 query-router 规则。

### Contributor Experience

- 让第一次贡献可以从文档、测试、示例、provider adapter 或 K12 Expert 小任务开始。
- 每个 starter task 都应有清楚边界、验收命令和安全注意事项。
- 保持 README、docs、issue 模板、release note 和 roadmap 同步。

## 非目标

- 不把 KnowMesh 做成普通向量库 UI。
- 不把 CLI 作为普通用户主入口。
- 不捆绑教材或私有文档内容。
- 不为了兼容旧本地草稿而保留已替换的 JSON-first 流程。
- 不把弱答案伪装成成功。

## 如何参与

- 新贡献者先看 [Good First Issues](docs/good-first-issues.zh-CN.md)。
- 想理解代码入口先看 [项目地图](docs/project-map.zh-CN.md)。
- 准备提交 PR 前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 大方向讨论请先对照 [当前设计](docs/current-design.md)，避免生成第二套产品蓝图。
