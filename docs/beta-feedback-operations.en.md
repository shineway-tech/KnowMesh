# Beta Feedback Operations

[中文](beta-feedback-operations.zh-CN.md) | [Community Backlog](community-backlog.en.md) | [Release Operations](release-operations.en.md) | [Current Design](current-design.md)

Public Beta feedback is not loose commentary. It is a traceable maintainer workflow that turns Query Runtime, public samples, Integration Examples, Provider adapters, and Expert extension feedback into backlog items, known-gap records, and release-note carryover.

## Entry Points

- Query Runtime feedback: useful feedback is positive signal only; wrong citations, missed points, and no-answer mistakes enter maintenance review.
- public samples: sample creation, cited answers, feedback, package preview, version manifest, and reset failures enter `area:samples`.
- Integration Examples: OpenAPI, Node SDK, HTTP examples, error responses, timeout, and retryable behavior enter `area:integration`.
- Provider: dry-run, permissions, external calls, diagnostics, local parser pilot, OCR/vector/object-store adapters enter `area:provider`.
- Expert: manifests, schemas, objects, relations, queryRoutes, evaluation, and lifecycle graduation enter `area:expert`.

## Triage States

| Label | Meaning | Close Criteria |
| --- | --- | --- |
| `triage:intake` | New feedback, not yet scoped. | Reproduced, classified, or closed as invalid. |
| `triage:confirmed` | Confirmed with minimal reproduction or evidence. | Queued, fixed, or mapped to known-gap. |
| `triage:queued` | Converted into an executable backlog item. | Matching PR merged or explicitly deferred. |
| `triage:release-note` | Needs release-note carryover. | Release notes name supported path, limitations, and known-gap. |
| `triage:closed` | Fixed, documented as limitation, or no longer applicable. | Issue contains acceptance command and result. |

## Known-gap Mapping

Every `known-gap` must state:

- Affected path: Query Runtime, public samples, Integration Examples, Provider, Expert, or Release Operations.
- User impact: blocks builds, weakens answer trust, affects docs only, or affects one adapter.
- Current workaround: for example local-only mode, skipping one source class, or manual legacy Office conversion.
- release-note carryover: if Public Beta ships with this known-gap, release notes must include it.

## Acceptance Commands

Every beta feedback item should list at least one repeatable command:

```bash
npm test -- <changed-test-files>
npm run smoke:browser-sample
npm run generate:release-evidence -- --browser-sample-flow pass --beta-release-notes pass
npm run verify:package-boundary
git diff --check
```

## Safety Boundary

- no private source material, no private logs, no local machine paths, no credentials.
- Do not paste `.env`, SQLite databases, workspace state, OCR raw text, model outputs, or real textbook content.
- Reproduction material must use public samples, synthetic fixtures, or explicitly authorized public material.
