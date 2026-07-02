# Publication Decision Checklist

[中文](publication-decision-checklist.zh-CN.md) | [Final Publication Review](final-publication-review.en.md) | [Release Operations](release-operations.en.md) | [Public Launch](public-launch.en.md)

This checklist is the maintainer worksheet between Block Z and Block AA. It puts final evidence, human decisions, executable commands, rollback boundaries, and post-publication monitoring entry points in one place.

It does not replace [current-design.md](current-design.md). The current design remains the single active design authority. It also performs no publication action: repository visibility, tags, GitHub Releases, npm publication, and announcements all require explicit maintainer approval.

The default result stays:

```text
releaseAllowed=false
publicationDecision=human-review-required
npmPublication=separate-decision
```

## Operating Order

1. Refresh local evidence and generate `exports/final-publication-review-evidence.json`.
2. Run read-only remote checks for the current GitHub and npm state.
3. Hold a go/no-go review covering visibility, tag, GitHub Release, npm, announcement, and rollback owner.
4. Execute only the actions maintainers approve. Unapproved items stay blocked.
5. Record the result in release notes or maintainer records.
6. Start Block AA Round AA1 only after real publication has happened.

## Roles

| Role | Responsibility |
| --- | --- |
| Release owner | Runs go/no-go and confirms the target commit, tag, release notes, and evidence packet. |
| Rollback owner | Owns failure response for visibility, release, tag, npm dist-tag, and announcements. |
| Security contact | Confirms SECURITY, private reporting, secret scanning, push protection, and security links in announcements. |
| Docs / announcement owner | Confirms README, README.en, docs indexes, Roadmap, known gaps, and bilingual announcements. |
| npm owner | Separately decides whether npm is published and whether the `alpha` dist-tag is used. |

## 0. Refresh Local Evidence

Minimum refresh:

```powershell
npm test
npm run smoke:final-publication
npm run generate:final-publication
npm run verify:package-boundary
npm run verify:integration-privacy
npm run smoke:artifact
git diff --check
```

If code or documentation changed since the last full freeze, rerun the full launch-candidate evidence set:

```powershell
npm run smoke:release-candidate
npm run generate:release-candidate
npm run smoke:public-launch
npm run generate:public-launch
npm run smoke:stabilization
npm run generate:stabilization
npm run smoke:api-reliability
npm run generate:api-reliability
npm run smoke:community-release
npm run generate:community-release
npm run smoke:final-publication
npm run generate:final-publication
npm run verify:package-boundary
npm run verify:integration-privacy
npm run smoke:artifact
git diff --check
```

Minimum evidence requirements:

- `npm test` has no failures.
- `smoke:final-publication` prints `ok: true` while keeping `releaseAllowed: false` and `publicationDecision: human-review-required`.
- `exports/final-publication-review-evidence.json` contains no local paths, credentials, raw provider payloads, or private source document text.
- `verify:package-boundary` has no rejected files.
- `verify:integration-privacy` reports `0` findings.
- `smoke:artifact` prints the tarball `sha256`, ready to be copied into release notes.

## 1. Read-Only Remote Checks

These commands are read-only:

```powershell
gh repo view shineway-tech/KnowMesh --json nameWithOwner,visibility,isPrivate,description,homepageUrl,repositoryTopics,hasIssuesEnabled,isSecurityPolicyEnabled,usesCustomOpenGraphImage,latestRelease
gh run list --repo shineway-tech/KnowMesh --limit 10 --json workflowName,status,conclusion,headSha,createdAt,url
gh release view v0.1.0 --repo shineway-tech/KnowMesh --json tagName,name,isDraft,isPrerelease,publishedAt,url
npm view knowmesh name version dist-tags repository license --json
```

If `gh release view v0.1.0` or `npm view knowmesh` reports that nothing exists, that is not a failure by itself. It means the corresponding publication action has not happened.

## 2. Decision Table

| Decision | Default | Required input | Approved action | Rollback boundary |
| --- | --- | --- | --- | --- |
| Repository visibility | Keep Private | Final evidence, CI/CodeQL/Scorecard, README, SECURITY, issue templates, social preview | GitHub UI or `gh repo edit shineway-tech/KnowMesh --visibility public --accept-visibility-change-consequences` | Visibility can be changed back, but exposed commits, Actions logs, release assets, screenshots, and fork effects cannot be treated as if they never happened. |
| About / Topics / Social preview | Review only | README positioning, topics, description, preview image | Update About, topics, and social preview in GitHub UI, or use `gh repo edit` for description/homepage/topics | Search indexing and social caches can lag after edits. |
| Git tag | Do not tag automatically | Target commit, CHANGELOG, release notes, artifact sha256 | `git tag -a v0.1.0 -m "KnowMesh v0.1.0"` then `git push origin v0.1.0` | If a pushed tag must be deleted, record the reason. If a release or npm package exists, deleting the tag is not a release rollback. |
| GitHub Release | Do not create automatically | Tag, release notes, artifact sha256, known gaps, rollback owner | `gh release create v0.1.0 --repo shineway-tech/KnowMesh --verify-tag --draft --prerelease --title "KnowMesh v0.1.0" --notes-file <release-notes-file>` | Drafts can be edited or deleted. After publication, use amendment notes for fixes instead of silently replacing evidence. |
| npm publish | separate-decision | Package boundary, artifact smoke, npm owner, 2FA or automation permissions | First run `npm publish --dry-run`; after approval run `npm publish --tag alpha` | Published versions generally cannot be treated as unpublished. Prefer dist-tag correction, deprecation, or a patch release. |
| Announcement | Do not send automatically | Public URL, release URL, known gaps, support lanes, security path, first 72-hour owner | Publish Chinese and English announcements linking README, docs, public samples, known gaps, and feedback issues | Announcements can be corrected, but external redistribution cannot be fully recalled. |
| Block AA start | Blocked before publication | Real execution records for visibility/tag/release/npm/announcement | Start Round AA1 first 24-hour health review | Do not use simulated publication as monitoring success. |

## 3. Recommended Release Notes Content

Release notes must be honest about Alpha / Public Launch Candidate maturity and must not imply commercial stability.

They must include:

- KnowMesh is a local-first Knowledge Asset Compiler, not a generic RAG demo.
- Current capabilities: SQLite-first workspace/catalog, Query Runtime, public samples, Expert / Provider boundaries, package boundary, and release evidence.
- K12 is the first major Expert scenario, not the whole product positioning.
- Known gaps: local parser/OCR providers are still being strengthened, real textbooks require user authorization, and the project bundles no private or copyrighted source material.
- Verification command summary and `smoke:artifact` sha256.
- Support entry points: Issues, Security, public samples, integration docs, and community backlog.
- `npmPublication` status: unpublished, separate-decision, or published with the `alpha` dist-tag.

## 4. Stop Conditions Before Publication

Stop if any item is true:

- `npm test`, `smoke:final-publication`, package boundary, privacy audit, or artifact smoke fails.
- Evidence JSON contains local paths, credentials, private source text, SQLite databases, or raw provider payloads.
- README / README.en / docs indexes are out of sync.
- SECURITY, issue templates, CI, CodeQL, Scorecard, or target-commit results are missing.
- Release notes have no known gaps, rollback owner, or artifact sha256.
- The npm owner has not explicitly approved npm publication.
- Maintainers have not accepted visibility-change consequences.

## 5. Record After Execution

If maintainers execute any publication action, record:

```text
action:
owner:
timestamp:
targetCommit:
tag:
githubReleaseUrl:
npmVersion:
npmDistTag:
artifactSha256:
knownGapsLinked:
rollbackOwner:
nextBlock: Block AA Round AA1
```

## 6. Block AA Entry

Block AA can start only after real publication. The first round is Round AA1: First 24-Hour Health Review.

Round AA1 checks:

- CI, CodeQL, and Scorecard still pass for the public target commit.
- Release assets, README links, docs links, and social preview work.
- npm install behavior, or the unpublished statement, matches release notes.
- Issues, Security, feedback templates, and support lanes work.
- No private data, credentials, source text, or local paths leaked.

During the first 72 hours, keep a feedback loop: classify launch feedback, mark known gaps, fix misleading docs, record adoption friction, and move implementation work into the next roadmap cycle instead of breaking the release freeze immediately.
