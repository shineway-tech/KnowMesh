# Public Launch

[中文](public-launch.zh-CN.md) | [Documentation](README.en.md) | [Release Candidate Freeze](release-candidate-freeze.en.md)

Block V turns the `1.0.0 Public Release Candidate Freeze` into a reviewable public-launch packet. It does not switch the repository to Public, create a release tag, or publish to npm automatically. Every publication action remains `human-review-required`.

## V1 Public Switch Decision Packet

- Decisions: repository visibility, release tag, npm publication, and announcement timing.
- Required evidence: RC evidence path, artifact sha256, GitHub gate status, known gaps, and rollback plan.
- Automation may generate evidence only; it must not publish, tag, or change visibility.

## V2 Launch Discovery Polish

- The README first viewport must explain Knowledge Asset Compiler, local-first, SQLite-first, auditable, traceable, maintainable, and K12 as the first Expert scenario.
- GitHub Topics/About, social preview, README visual assets, Chinese default, and complete English docs must be reviewable.
- Copy must stay honest about Alpha / Launch Candidate maturity.

## V3 External Feedback Intake

- New feedback should use public samples and reproduction commands whenever possible.
- Issues must not include private documents, `.env`, SQLite databases, local paths, student/customer material, cloud credentials, or raw provider payloads.
- Feedback maps to `triage:launch`, `triage:intake`, `known-gap`, `triage:release-note`, or executable backlog work.

## V4 First Contributor Path

- docs-only path: improve README/docs/examples, then verify with `git diff --check` and the matching docs tests.
- code-path path: add small tests through public APIs or public samples, without reading internal SQLite or widening JSON-first runtime state.
- PRs must explain current-design alignment, public API boundaries, bilingual docs sync, and package-boundary impact.

## V5 Post-Launch Stability

- After launch, review evidence first: CI, CodeQL, Scorecard, package boundary, integration privacy, RC evidence, and feedback trends.
- Do not convert feedback into immediate feature sprawl; classify it as known gap, docs, provider, K12 quality, integration adoption, or hardening.
- The next Block is chosen from stability evidence, not from temporary attention.

## Commands

```powershell
npm run smoke:public-launch
npm run generate:public-launch
npm run smoke:release-candidate
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

`smoke:public-launch` emits launch-readiness evidence. Even when it passes, `publicationDecision` remains `human-review-required`.
