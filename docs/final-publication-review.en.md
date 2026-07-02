# Final Publication Review

[中文](final-publication-review.zh-CN.md) | [Publication Decision Checklist](publication-decision-checklist.en.md) | [Community Release Readiness](community-release-readiness.en.md) | [Release Operations](release-operations.en.md)

Block Z is the final human review packet before publication. It only rolls up evidence and lists maintainer decisions; it performs no publication side effects.

`publicationDecision` must remain `human-review-required`.

## Final Evidence Rollup

The final rollup includes:

- release-candidate evidence
- public-launch evidence
- stabilization evidence
- api-reliability evidence
- community-release evidence
- artifact hash / package hash
- package file count
- verification commands
- public-safe evidence paths

The packet must not contain private paths, credentials, raw provider payloads, or source document text.

## GitHub / Repository Review

GitHub and repository review covers:

- CI / CodeQL / Scorecard expectations
- issue templates
- SECURITY.md / CONTRIBUTING.md
- topics / about text
- social preview
- repository visibility
- tag / GitHub release draft

Visibility, tag, and GitHub release actions remain manual human-review-required decisions.

## npm Package Review

npm review covers:

- package metadata
- exports
- bin launcher
- Node engine
- package boundary
- packed install rehearsal
- artifact hash
- npm publication as a separate decision
- rollback notes

npm publish is not bundled with the GitHub release. It remains an independent human decision.

## Announcement And Support

Announcement material must support Chinese and English audiences without overstating maturity. The project should still use alpha / Public Launch Candidate language.

Announcement and support material must link:

- known gaps
- public samples
- integration docs
- support lanes
- security support path
- first 72-hour response loop

## Human Decision Packet

Final maintainer decisions:

- visibility
- tag
- GitHub release
- npm publish
- announcement
- rollback owner

The go/no-go decision can only be made by maintainers. Automation only outputs public-safe evidence and `human-review-required`.

See the [Publication Decision Checklist](publication-decision-checklist.en.md) for the detailed operating sheet. It collects local evidence refresh, read-only remote checks, visibility/tag/GitHub Release/npm/announcement decisions, rollback boundaries, and the Block AA entry point.

## After Publication

After maintainers actually publish, the next block can move to `post-publication-monitoring`: watch feedback, handle security reports, maintain known gaps, update release notes, and evaluate the next roadmap cycle.
