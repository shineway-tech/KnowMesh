# Community Backlog

[中文](community-backlog.zh-CN.md) | [Good First Issues](good-first-issues.en.md) | [Beta Feedback Operations](beta-feedback-operations.en.md) | [Contributing](../CONTRIBUTING.md)

This backlog helps maintainers cut public repository work into claimable, verifiable tasks that require no private data. Every task must follow [Current Design](current-design.md) and must not preserve replaced JSON-first runtime paths.

## Recommended Labels

| Label | Use |
| --- | --- |
| `good first issue` | Small scope, clear acceptance, friendly to first contributors. |
| `help wanted` | Maintainers welcome external implementation or docs help. |
| `area:expert` | Expert manifests, schemas, objects, relations, evaluation, and authoring docs. |
| `area:provider` | parser, OCR, chat, embedding, rerank, vector, and object-store adapters. |
| `area:integration` | HTTP API, OpenAPI, Query Runtime examples, and SDKs. |
| `area:operator` | Source intake, execution recovery, maintenance review, targeted rerun, version diff/rollback, and operator diagnostics. |
| `area:first-run` | Empty states, create/select KB, guided setup, build recovery, first question, and maintenance next action. |
| `area:usable-product` | Launch reliability, document intake, Web Console workflow, durable data/package, browser/privacy/package proof. |
| `area:launch` | Public launch decision packet, discovery polish, feedback intake, first contributor path, and post-launch stability. |
| `area:stabilization` | 1.0 stabilization, public API stability, docs/samples hardening, reliability, and privacy regression. |
| `area:community-release` | Community Release Readiness, contributor onboarding, issue triage, release notes, and adoption loop. |
| `api-compatibility` | Public API compatibility, OpenAPI, SDK, endpoint manifest, and response shape drift. |
| `query-runtime-reliability` | Query Runtime answered/refusal/no-answer/provider unavailable/quality blocked/feedback-maintenance status matrix. |
| `package-install` | Packed install, launcher-first start, package boundary, artifact hash, and public sample reset. |
| `privacy-security` | Local paths, credentials, private content, raw provider payloads, browser storage truth, and direct SQLite reads. |
| `docs-discovery` | README first viewport, docs index, bilingual sync, search keywords, and maturity language. |
| `k12-expert-feedback` | K12 Expert schema, quality gates, evaluation, textbook structure, and citation issues. |
| `provider-adapter` | Provider manifest, diagnostics, dry-run, cost/privacy, retry, and permission boundaries. |
| `public-sample` | Public sample requests, synthetic fixtures, sample ownership, and reset safety. |
| `area:docs` | README, getting started, architecture, roadmap, and release docs. |
| `area:samples` | Public samples, synthetic fixtures, and sample request issues. |
| `sample request` | Request a new public sample or explain why a scenario needs a synthetic fixture. |
| `known-gap` | Public Beta limitation that needs release-note carryover. |
| `triage:intake` | New beta feedback, not yet scoped. |
| `triage:launch` | New public launch feedback, not yet mapped to known-gap, backlog, or release-note carryover. |
| `triage:stabilization` | Feedback passed the safe reproduction bar and is waiting for the 1.0 stabilization queue. |
| `triage:confirmed` | Confirmed with minimal reproduction or evidence. |
| `triage:queued` | Converted into an executable backlog item. |
| `triage:release-note` | Needs release-note carryover for a beta limitation or risk. |
| `triage:closed` | Fixed, documented as limitation, or no longer applicable. |

## Backlog Lanes

- Expert adapter: add domain objects and queryRoutes, with manifest tests first.
- Provider adapter: add adapter contract and dryRun output before joining execution.
- Integration SDK: build on the HTTP API; Do not read internal SQLite.
- Operator workflow: improve source deltas, job recovery, maintenance review, version rollback, and operatorBrowserWorkflow evidence.
- First-run usability: improve empty states, folder precheck, first-build recovery, no-answer explanations, and firstRunBrowserWorkflow evidence.
- Usable product proof: improve usable-product smoke, browser overflow checks, privacy audits, package asset review, and release evidence automation.
- Public launch: handle public launch readiness, feedback intake, first contributor path, and post-launch stability without changing repository visibility or publishing npm from automation.
- 1.0 stabilization: route public launch feedback to docs fix, sample request, integration issue, provider request, K12 quality, known gap, or blocked decision.
- Community release: `api-compatibility`, `query-runtime-reliability`, `package-install`, `privacy-security`, `docs-discovery`, `k12-expert-feedback`, `provider-adapter`, and `public-sample` issues must include owner expectations, labels, verification commands, and release-note carryover.
- Public sample: use public, synthetic, or explicitly authorized material; no private documents.
- Release operations: keep release-gate evidence, CI/CodeQL/Scorecard, and draft release notes aligned.
- Beta feedback: Query Runtime, public samples, Integration Examples, Provider, and Expert feedback must map to known-gap, backlog, or release-note carryover.

## Safety Boundary

- Do not commit `.env`, SQLite databases, workspace state, local logs, private source files, or plaintext cloud credentials.
- Do not commit copyrighted textbook content, customer material, student privacy data, or internal institution records.
- Every issue should list acceptance commands such as `npm test -- <file>`, `npm run verify:package-boundary`, and `git diff --check`.
- Community release readiness issues should also include `npm run smoke:community-release`; use `npm run generate:community-release` when a human-review-required evidence packet is needed.
