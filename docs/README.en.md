# KnowMesh Documentation

[中文](README.md) | [Project Home](../README.en.md) | [Current Design](current-design.md)

KnowMesh documentation has two purposes:

- Entry-point docs for users and contributors: getting started, architecture, examples, and operations.
- The current design authority: `docs/current-design.md`. Product direction, architecture, data model, quality gates, UX contract, and development discipline are defined there.

## Recommended Reading Order

1. [README](../README.en.md): positioning, capabilities, and current status.
2. [Getting Started](getting-started.en.md): credential-free local demo and startup.
3. [Architecture Overview](architecture.en.md): the short version of KnowMesh layers and data flow.
4. [Phase 1-6 Operations Runbook](phase1-6-operations-runbook.md): local runtime, SQLite state, package boundary, and GitHub gates.
5. [Current Design](current-design.md): the single current design authority.

## 中文文档

- [文档中心](README.md)
- [快速入门](getting-started.zh-CN.md)
- [架构概览](architecture.zh-CN.md)

## Maintenance Rules

- Do not create a second product blueprint.
- Do not create a second data standard.
- Durable design changes must be merged into `current-design.md`, and replaced content must be removed.
- README and docs entry points should explain, navigate, and guide operations, not duplicate the full design.
