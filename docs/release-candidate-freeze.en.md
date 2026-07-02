# 1.0.0 Public Release Candidate Freeze

[中文](release-candidate-freeze.zh-CN.md) | [Documentation](README.en.md) | [Release Operations](release-operations.en.md) | [Current Design](current-design.md)

This page defines the freeze evidence required before KnowMesh moves toward a public release candidate. It is not a new feature phase; it turns the `1.0.0 Usable Product Proof` into a reviewable, repeatable, rejectable release-candidate packet.

## Goal

- Generate one `release-candidate-evidence` JSON from real local smokes and audits.
- Prove a non-maintainer can install from the packed tarball and launch the Web Console through the user entrypoint.
- Cover public sample, Query Runtime, refusal, feedback, maintenance, diagnostics, versions, package preview, and reset.
- Keep npm publication, GitHub Public, tags, and releases as explicit human decisions with no smoke side effects.

## Commands

```bash
npm run smoke:release-candidate
npm run generate:release-candidate
node ./scripts/release-gate.mjs --usable-product --evidence exports/release-candidate-evidence.json
```

`npm run smoke:release-candidate` aggregates release smoke, artifact smoke, package boundary, integration privacy, browser sample, SDK consumer, live SDK, operator workflow, first-run usability, usable product smoke, and fresh-clone install rehearsal.

## go/no-go

The go/no-go packet must include:

- supported paths: the currently supported launch, sample, query, feedback, maintenance, package-preview, and integration paths;
- limitations: alpha / RC limitations that still apply;
- known gaps: confirmed gaps that need release-note carryover;
- artifact hash: current tarball sha256;
- verification commands: local, browser, SDK, privacy, and package-boundary commands;
- no publication side effects: no automatic Public switch, tag, release, or npm publish.

## Blockers

- The evidence packet cannot pass the `1.0.0-usable-product` release gate.
- Fresh-clone rehearsal cannot launch through the installed launcher-first path.
- Browser evidence shows horizontal overflow, placeholder text, duplicate primary controls, or internal-state wording.
- Package/release assets include private state, SQLite/WAL files, credential material, local paths, generated browser artifacts, or private content.
- README, docs index, release operations, security, contributing, issue templates, and good-first docs disagree with the actually supported paths.
