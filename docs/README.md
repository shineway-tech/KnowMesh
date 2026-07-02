# KnowMesh 文档中心

[English](README.en.md) | [项目首页](../README.md) | [Current Design](current-design.md)

KnowMesh 的公开定位是本地优先的 Knowledge Asset Compiler：把真实文档文件夹编译成可审计、可追溯、可维护、可集成的知识资产。K12 是第一个主要 Expert 场景，而不是项目的全部边界。

文档分为三类：

- 面向用户和贡献者的入口文档：快速入门、架构概览、示例、运维说明。
- Public Launch Candidate 文档：公开样例、release evidence、治理和安全门禁。
- 当前设计权威：`docs/current-design.md`。产品、架构、数据、质量、UX 和开发纪律以它为准。

Public Beta 之前，Expert 和 Provider 扩展必须声明 lifecycle：`official` -> `certified` -> `community` -> `experimental`。公开文档、PR 模板和 release operations 都以这个顺序说明稳定性和验收责任。

## 推荐阅读顺序

1. [README](../README.md)：项目定位、能力和当前状态。
2. [快速入门](getting-started.zh-CN.md)：无密钥本地 demo 和启动方式。
3. [架构概览](architecture.zh-CN.md)：用一页理解 KnowMesh 的层次和数据流。
4. [K12 Expert](experts/k12.zh-CN.md)：第一个 Expert 场景、schema、质量门槛和评测覆盖。
5. [Expert Authoring Kit](experts/authoring.zh-CN.md)：如何编写、验证和提交新的 Expert。
6. [Query Runtime API](api/query-runtime.zh-CN.md)：控制台和集成方共享的问答、引用、质量门和反馈契约。
7. [Operator Workflow Proof](operator-workflow.zh-CN.md)：操作者 source intake、execution recovery、maintenance、targeted rerun、version rollback 和 release evidence 路径。
8. [First-Run Usability Proof](first-run-usability.zh-CN.md)：普通用户从空本地状态到首个问题、反馈和维护下一步的验收路径。
9. [Usable Product Proof](usable-product.zh-CN.md)：`1.0.0-usable-product` release evidence、可用产品 smoke、隐私和包资产边界。
10. [Release Candidate Freeze](release-candidate-freeze.zh-CN.md)：`1.0.0 Public Release Candidate Freeze` 的证据包、fresh-clone 演练、浏览器验收和 go/no-go。
11. [Public Launch](public-launch.zh-CN.md)：公开发布 decision packet、反馈入口、首次贡献者路径、发布后稳定和 `human-review-required` 边界。
12. [1.0 Stabilization](stabilization.zh-CN.md)：1.0 稳定化、feedback triage、公共 API 稳定、docs/samples hardening、可靠性与隐私回归。
13. [Public API Stability](api-stability.zh-CN.md)：Query Runtime、OpenAPI、SDK、breaking change 和 migration plan 边界。
14. [1.0 API Reliability](api-reliability.zh-CN.md)：1.0 API 可靠性、compatibility harness、Query Runtime 状态矩阵、privacy 回归和 `human-review-required` 证据包。
15. [Community Release Readiness](community-release-readiness.zh-CN.md)：社区发布准备、contributor onboarding、issue triage、adoption loop 和 `human-review-required` 决策包。
16. [Final Publication Review](final-publication-review.zh-CN.md)：最终发布审核、GitHub/repository、npm、announcement、rollback owner 和人工 go/no-go。
17. [Publication Decision Checklist](publication-decision-checklist.zh-CN.md)：发布前人工决策清单、只读远端检查、可执行命令、回滚边界和 Block AA 入口。
18. [应用集成指南](integrations.zh-CN.md)：Server-side Node、Electron、本地桌面、浏览器经后端和 CI smoke 的推荐接入方式。
19. [OpenAPI 规范](api/openapi.json)：Query、反馈、搜索、维护、包预览和版本端点的机器可读契约。
20. [Integration Examples](../examples/integrations/README.md)：Node.js 和 HTTP 集成示例，不直接读取内部 SQLite。
21. [Provider 适配器](providers.zh-CN.md)：解析、OCR、模型、向量和对象存储 provider 的能力、成本与隐私边界。
22. [Extension Certification Registry](extension-certification.zh-CN.md)：Expert / Provider lifecycle graduation、认证记录和安全边界。
23. [Community Backlog](community-backlog.zh-CN.md)：社区任务、标签、扩展方向和样例请求入口。
24. [Beta Feedback Operations](beta-feedback-operations.zh-CN.md)：Public Beta feedback、known-gap、triage 和 release-note carryover 流程。
25. [Release Operations](release-operations.zh-CN.md)：维护者发布清单、本地证据、GitHub gate 和 npm 决策。
26. [Roadmap](../ROADMAP.md)：公开路线图和近期优先级。
27. [项目地图](project-map.zh-CN.md)：贡献者代码入口和常见任务位置。
28. [Good First Issues](good-first-issues.zh-CN.md)：适合第一次贡献的任务类型和验收方式。
29. [公开样例](../examples/public-samples/README.md)：无密钥 general-docs、operations-handbook Expert 和 synthetic K12 样例，用于 Query Runtime、引用、反馈、包预览和版本验收。
30. [Release Candidate Evidence](release-candidate.zh-CN.md)：Public Launch Candidate 的本地 gate、GitHub gate、artifact checksum 和 release-gate evidence 文件格式。
31. [Phase 1-6 Operations Runbook](phase1-6-operations-runbook.md)：本地运行、SQLite 状态、发布包边界和 GitHub 门禁。
32. [Current Design](current-design.md)：唯一现行设计权威。

## English Docs

- [Documentation Home](README.en.md)
- [Getting Started](getting-started.en.md)
- [Architecture Overview](architecture.en.md)
- [K12 Expert](experts/k12.en.md)
- [Expert Authoring Kit](experts/authoring.en.md)
- [Query Runtime API](api/query-runtime.en.md)
- [Operator Workflow Proof](operator-workflow.en.md)
- [First-Run Usability Proof](first-run-usability.en.md)
- [Usable Product Proof](usable-product.en.md)
- [Release Candidate Freeze](release-candidate-freeze.en.md)
- [Public Launch](public-launch.en.md)
- [1.0 Stabilization](stabilization.en.md)
- [Public API Stability](api-stability.en.md)
- [1.0 API Reliability](api-reliability.en.md)
- [Community Release Readiness](community-release-readiness.en.md)
- [Final Publication Review](final-publication-review.en.md)
- [Publication Decision Checklist](publication-decision-checklist.en.md)
- [Integration Guide](integrations.en.md)
- [OpenAPI Spec](api/openapi.json)
- [Integration Examples](../examples/integrations/README.md)
- [Provider Adapters](providers.en.md)
- [Extension Certification Registry](extension-certification.en.md)
- [Community Backlog](community-backlog.en.md)
- [Beta Feedback Operations](beta-feedback-operations.en.md)
- [Release Operations](release-operations.en.md)
- [Roadmap](../ROADMAP.en.md)
- [Project Map](project-map.en.md)
- [Good First Issues](good-first-issues.en.md)
- [Public Samples](../examples/public-samples/README.md)
- [Release Candidate Evidence](release-candidate.en.md)

## 维护规则

- 不新增第二份产品蓝图。
- 不新增第二份数据标准。
- 长期设计变更必须合并进 `current-design.md`，并删除被替代内容。
- README 和 docs 入口只解释、导航和指导操作，不复制完整设计。
