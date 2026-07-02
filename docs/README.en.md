# KnowMesh Documentation

[中文](README.md) | [Project Home](../README.en.md) | [Current Design](current-design.md)

KnowMesh is positioned as a local-first Knowledge Asset Compiler: it compiles real document folders into auditable, traceable, maintainable, and integrable knowledge assets. K12 is the first major Expert scenario, not the full boundary of the project.

KnowMesh documentation has three purposes:

- Entry-point docs for users and contributors: getting started, architecture, examples, and operations.
- Public Launch Candidate docs: public samples, release evidence, governance, and security gates.
- The current design authority: `docs/current-design.md`. Product direction, architecture, data model, quality gates, UX contract, and development discipline are defined there.

Before Public Beta, every Expert and Provider extension must declare a lifecycle stage: `official` -> `certified` -> `community` -> `experimental`. Public docs, the PR template, and release operations use this order to explain stability and acceptance responsibility.

## Recommended Reading Order

1. [README](../README.en.md): positioning, capabilities, and current status.
2. [Getting Started](getting-started.en.md): credential-free local demo and startup.
3. [Architecture Overview](architecture.en.md): the short version of KnowMesh layers and data flow.
4. [K12 Expert](experts/k12.en.md): the first Expert scenario, schema, quality gates, and evaluation coverage.
5. [Expert Authoring Kit](experts/authoring.en.md): how to write, validate, and contribute a new Expert.
6. [Query Runtime API](api/query-runtime.en.md): the shared answer, citation, quality-gate, and feedback contract for console and integrations.
7. [Operator Workflow Proof](operator-workflow.en.md): maintainer/operator source intake, execution recovery, maintenance, targeted rerun, version rollback, and release evidence path.
8. [First-Run Usability Proof](first-run-usability.en.md): the acceptance path from empty local state to first question, feedback, and maintenance next action.
9. [Usable Product Proof](usable-product.en.md): `1.0.0-usable-product` release evidence, usable product smoke, privacy, and package asset boundaries.
10. [Release Candidate Freeze](release-candidate-freeze.en.md): `1.0.0 Public Release Candidate Freeze` evidence packet, fresh-clone rehearsal, browser acceptance, and go/no-go.
11. [Public Launch](public-launch.en.md): public-switch decision packet, feedback intake, first contributor path, post-launch stability, and the `human-review-required` boundary.
12. [1.0 Stabilization](stabilization.en.md): feedback triage, public API stability, docs/samples hardening, reliability, and privacy regression for 1.0 stabilization.
13. [Public API Stability](api-stability.en.md): Query Runtime, OpenAPI, SDK, breaking change, and migration plan boundaries.
14. [1.0 API Reliability](api-reliability.en.md): compatibility harness, Query Runtime status matrix, package reliability, privacy regression, and `human-review-required` evidence for 1.0 API reliability.
15. [Community Release Readiness](community-release-readiness.en.md): contributor onboarding, issue triage, adoption loop, and `human-review-required` decision packet for community release readiness.
16. [Final Publication Review](final-publication-review.en.md): final GitHub/repository, npm, announcement, rollback owner, and human go/no-go review.
17. [Publication Decision Checklist](publication-decision-checklist.en.md): pre-publication maintainer decisions, read-only remote checks, executable commands, rollback boundaries, and Block AA entry.
18. [Integration Guide](integrations.en.md): recommended app patterns for server-side Node, Electron, local desktop, browser-through-backend, and CI smoke usage.
19. [OpenAPI Spec](api/openapi.json): machine-readable contract for query, feedback, search, maintenance, package preview, and version endpoints.
20. [Integration Examples](../examples/integrations/README.md): Node.js and HTTP examples that do not read internal SQLite directly.
21. [Provider Adapters](providers.en.md): capabilities, cost, and privacy boundaries for parser, OCR, model, vector, and object-store providers.
22. [Extension Certification Registry](extension-certification.en.md): Expert / Provider lifecycle graduation, certification records, and safety boundaries.
23. [Community Backlog](community-backlog.en.md): community tasks, labels, extension directions, and sample-request entry points.
24. [Beta Feedback Operations](beta-feedback-operations.en.md): Public Beta feedback, known-gap, triage, and release-note carryover workflow.
25. [Release Operations](release-operations.en.md): maintainer checklist for local evidence, GitHub gates, release assets, and npm decisions.
26. [Roadmap](../ROADMAP.en.md): public roadmap and near-term priorities.
27. [Project Map](project-map.en.md): contributor code entry points and common task locations.
28. [Good First Issues](good-first-issues.en.md): starter task types and acceptance checks.
29. [Public Samples](../examples/public-samples/README.md): credential-free general-docs, operations-handbook Expert, and synthetic K12 samples for Query Runtime, citations, feedback, package preview, and version acceptance.
30. [Release Candidate Evidence](release-candidate.en.md): local gates, GitHub gates, artifact checksum, and release-gate evidence file format for the Public Launch Candidate.
31. [Phase 1-6 Operations Runbook](phase1-6-operations-runbook.md): local runtime, SQLite state, package boundary, and GitHub gates.
32. [Current Design](current-design.md): the single current design authority.

## 中文文档

- [文档中心](README.md)
- [快速入门](getting-started.zh-CN.md)
- [架构概览](architecture.zh-CN.md)
- [K12 Expert](experts/k12.zh-CN.md)
- [Expert Authoring Kit](experts/authoring.zh-CN.md)
- [Query Runtime API](api/query-runtime.zh-CN.md)
- [Operator Workflow Proof](operator-workflow.zh-CN.md)
- [First-Run Usability Proof](first-run-usability.zh-CN.md)
- [Usable Product Proof](usable-product.zh-CN.md)
- [Release Candidate Freeze](release-candidate-freeze.zh-CN.md)
- [Public Launch](public-launch.zh-CN.md)
- [1.0 Stabilization](stabilization.zh-CN.md)
- [Public API Stability](api-stability.zh-CN.md)
- [1.0 API Reliability](api-reliability.zh-CN.md)
- [Community Release Readiness](community-release-readiness.zh-CN.md)
- [Final Publication Review](final-publication-review.zh-CN.md)
- [Publication Decision Checklist](publication-decision-checklist.zh-CN.md)
- [应用集成指南](integrations.zh-CN.md)
- [OpenAPI 规范](api/openapi.json)
- [Integration Examples](../examples/integrations/README.md)
- [Provider 适配器](providers.zh-CN.md)
- [Extension Certification Registry](extension-certification.zh-CN.md)
- [Community Backlog](community-backlog.zh-CN.md)
- [Beta Feedback Operations](beta-feedback-operations.zh-CN.md)
- [Release Operations](release-operations.zh-CN.md)
- [Roadmap](../ROADMAP.md)
- [项目地图](project-map.zh-CN.md)
- [Good First Issues](good-first-issues.zh-CN.md)
- [公开样例](../examples/public-samples/README.md)
- [Release Candidate Evidence](release-candidate.zh-CN.md)

## Maintenance Rules

- Do not create a second product blueprint.
- Do not create a second data standard.
- Durable design changes must be merged into `current-design.md`, and replaced content must be removed.
- README and docs entry points should explain, navigate, and guide operations, not duplicate the full design.
