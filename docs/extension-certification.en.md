# Extension Certification Registry

[中文](extension-certification.zh-CN.md) | [Expert Authoring Kit](experts/authoring.en.md) | [Provider Adapters](providers.en.md) | [Current Design](current-design.md)

The Extension Certification Registry records Expert and Provider stability, owner, tests, docs, security boundaries, and known limitations for Public Beta. It is not a marketing badge; it is evidence maintainers and contributors can use to decide whether an extension is dependable.

## Lifecycle Graduation

The stage order remains `official` -> `certified` -> `community` -> `experimental`.

- `experimental`: useful for exploration, but limitations must be explicit.
- `community`: has an owner, docs, tests, and safety boundaries.
- `certified`: reviewed by maintainers with permissions, diagnostics, dry-run behavior, known limitations, and release evidence.
- `official`: maintained with KnowMesh Core and covered by release gates.

## Current Records

- Expert `k12`: `official`, maintained by KnowMesh Core and does not bundle real textbook content.
- Expert `operations-handbook`: `experimental`, kept as a non-K12 authoring example.
- Provider `local-catalog`: `official`, local catalog/search truth source.
- Provider `local-parser`: `certified`, the first provider adapter pilot; it stays local, never executes macros, and writes results through public writer APIs.

## Graduation Rules

- Declare owner, supported contract version, docs, required tests, security notes, and known limitations.
- Do not request unsafe permissions such as `*`, `admin`, `root`, `filesystem:all`, or `sqlite:write`.
- Do not read or mutate internal SQLite file paths directly; use public Core / Provider / Expert interfaces.
- Before graduation to `certified` or `official`, package-boundary, release evidence, and focused tests must pass.
