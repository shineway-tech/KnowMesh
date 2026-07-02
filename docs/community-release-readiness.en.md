# Community Release Readiness

[中文](community-release-readiness.zh-CN.md) | [Community Backlog](community-backlog.en.md) | [Release Operations](release-operations.en.md)

Block Y turns the passing API reliability gate into community-facing release readiness. It focuses on whether people can understand, reproduce, report, contribute, and keep following the project without reopening product or public API design.

All publication side effects remain `human-review-required`: no automatic public visibility switch, tag creation, npm publication, or announcement.

## Contributor Onboarding

Contributor paths are split into:

- docs-only: README, docs, examples, public sample guidance, typo fixes, and link fixes. Minimum verification is `git diff --check` plus matching docs tests.
- code-path: use public APIs, SDK, Query Runtime, public samples, and focused tests only. Do not read internal SQLite or restore JSON-first runtime state.

Contributors must see:

- `docs/current-design.md` is the single current design authority.
- Old JSON-first shims should not be kept.
- Package boundaries are protected by `npm run verify:package-boundary`.
- Privacy rules block credentials, private documents, local paths, SQLite files, and generated artifacts.

## Issue Triage

Public issues must use public-safe reproduction. Prefer public samples, synthetic fixtures, command output, and screenshots. Do not paste private documents, textbook text, credentials, local absolute paths, or raw provider payloads.

Support lanes:

- `api-compatibility`
- `query-runtime-reliability`
- `package-install`
- `privacy-security`
- `docs-discovery`
- `k12-expert-feedback`
- `provider-adapter`
- `public-sample`

Each lane needs owner expectations, labels, verification commands, and known-gap / release-note carryover rules.

## Discovery Docs Quality

README and the docs home should help a first-time visitor understand:

- KnowMesh is a local-first Knowledge Asset Compiler.
- K12 is the first strengthened scenario, not the whole boundary.
- Public API, SQLite catalog, citations, quality gates, package preview, and public samples are the current verifiable value.
- The project is still alpha / public launch candidate, without overstating production maturity.

Chinese remains the default, with complete English coverage. Both languages must expose getting started, API reliability, integration examples, public samples, roadmap, and release operations.

## Release Notes And Adoption Loop

The release note draft must include:

- supported paths
- limitations
- known gaps
- verification evidence
- package hash / artifact hash
- rollback plan
- deferred work
- go/no-go packet

Adoption loop entry points:

- feedback intake
- sample requests
- integration reports
- provider requests
- K12 quality reports

All feedback enters the community backlog; it does not automatically become a release promise.

## Decision Packet

`npm run smoke:community-release` generates a human-review-only packet. It only answers whether community release readiness is sufficient for maintainer review; it does not perform any publication action.

The next default block is `1.0-final-publication-review`, focused on final human release checks, draft release, tag/npm/visibility decisions, and announcement materials.
