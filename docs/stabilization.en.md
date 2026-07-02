# 1.0 Stabilization

[中文](stabilization.zh-CN.md) | [Documentation](README.en.md) | [Public Launch](public-launch.en.md) | [API Stability](api-stability.en.md)

Block W converts public launch feedback into `1.0 Stabilization` evidence. It does not publish npm, tag a release, or change repository visibility. `stabilizationDecision` remains `human-review-required`.

## W1 Feedback Triage

Public feedback must enter a stabilization queue before it becomes new feature work.

Categories:

- docs fix: README, Getting Started, public samples, integration examples, provider diagnostics, or K12 Expert docs.
- sample request: a new public sample or synthetic fixture is needed.
- integration issue: Query Runtime, OpenAPI, SDK, HTTP example, or expected response drift.
- provider request: provider diagnostics, capability matrix, credential-free path, or explicit execution boundary.
- K12 quality: structure, objects, scope, refusal, or evaluation quality.
- known gap: accepted limitation that needs release-note carryover.
- blocked decision: missing public reproduction, private data, breaking change, or human publication decision required.

Promotion to engineering work requires safe reproduction: public sample reproduction, command output, no private paths, no credentials, no SQLite databases, and no private source text.

## W2 Public API Stability

Stabilization protects these public contracts by default:

- Query Runtime response shape, status, citations, checks, and feedback action.
- Integration manifest, diagnostics, package preview, and version manifest.
- SDK export: `createKnowMeshClient`, error type, timeout, and request id behavior.
- OpenAPI and example expected responses.

Any breaking change must first carry a migration plan and is blocked by default.

## W3 Docs And Samples Hardening

Fix the highest-friction paths first:

- README first viewport and 30-second start.
- Getting Started credential-free path.
- Public Samples credential-free, no upload, package preview, and Query Runtime wording.
- Integration Examples public API boundary.
- Provider diagnostics cost, privacy, credentials, and no-cloud defaults.
- K12 Expert scope, refusal, and structure docs.

## W4 Reliability And Privacy

Stabilization evidence should at least review:

```powershell
npm run smoke:release-candidate
npm run smoke:public-launch
npm run smoke:stabilization
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

Evidence must be public-safe: no local absolute paths, private source files, SQLite/WAL files, credentials, raw provider payloads, or browser temporary state.

## W5 Decision

Default next block: `1.0-api-reliability-hardening`. Change it only if stabilization evidence shows that docs/community, K12 quality, provider adoption, or integration adoption is more urgent.

Publication, tags, npm, and public announcements remain human-review decisions and are never executed by scripts.
