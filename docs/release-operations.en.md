# Release Operations Checklist

[中文](release-operations.zh-CN.md) | [Release Candidate Evidence](release-candidate.en.md) | [Publication Decision Checklist](publication-decision-checklist.en.md) | [Beta Feedback Operations](beta-feedback-operations.en.md) | [Current Design](current-design.md)

Release operations record evidence; they do not imply KnowMesh is stable. During `0.1.0-alpha`, local and GitHub gates must pass before a GitHub release is considered. npm publication always remains a separate decision.

## Local Evidence

Record:

```bash
npm test
npm run smoke:release
npm run smoke:browser-sample
npm run smoke:usable-product
npm run smoke:release-candidate
npm run smoke:public-launch
npm run smoke:stabilization
npm run smoke:api-reliability
npm run smoke:community-release
npm run smoke:final-publication
npm run smoke:first-run-usability
npm run smoke:operator-workflow
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
git diff --check
```

Write the `smoke:artifact` tarball sha256 into release notes. `verify:package-boundary` must report no rejected files. `verify:integration-privacy` must report `0` findings.
`smoke:operator-workflow` must prove source intake, execution recovery, maintenance targeted rerun, version rollback, desktop/narrow browser workflow, and privacy audit for a non-sample operator KB.
`smoke:first-run-usability` must prove empty local state, create/select KB, guided setup, build recovery, first question, maintenance next action, desktop/narrow browser workflow, and privacy cleanup.
`smoke:usable-product` must prove launch reliability, local document intake, Web Console workflow, durable data/package operations, stale JSON cleanup, and zero external calls before execution.
`smoke:release-candidate` must generate `release-candidate-evidence` and prove fresh-clone install rehearsal, browser acceptance, community readiness, and the go/no-go packet.
`smoke:public-launch` must prove public launch readiness remains `human-review-required` and does not change visibility, tag, or publish npm.
`smoke:stabilization` must prove feedback triage, public API stability, docs/samples hardening, reliability/privacy regression, and the 1.0 stabilization decision.
`smoke:api-reliability` must prove public API compatibility, the Query Runtime status matrix, package/install reliability, privacy/security regression, and release candidate reconciliation.
`smoke:community-release` must prove contributor onboarding, issue triage, discovery docs quality, release notes/adoption loop, and the community release decision.
`smoke:final-publication` must prove final evidence rollup, GitHub/repository review, npm/package review, announcement/support readiness, and the human publication decision packet, while still performing no publication.

## GitHub Evidence

Record:

- `githubCi`
- `githubCodeql`
- `githubScorecard`

These fields go into the release-gate evidence JSON.

## Public Beta Evidence

Public Beta also records:

- `browserSampleFlow`: desktop and narrow viewports complete public sample creation, Query Runtime, feedback, maintenance, package preview, version manifest, and reset, with reset limited to the public sample.
- `betaReleaseNotes`: release notes name supported paths, limitations, known gaps, and keep `npmPublication` as `separate-decision`.
- `releaseAssetReview`: release assets contain no workspace state, SQLite databases, credentials, logs, local machine paths, or private materials.

These fields are evaluated by `evaluatePublicBetaReleaseEvidence`. Public Beta may honestly list known gaps, but it must not skip browserSampleFlow, betaReleaseNotes, or releaseAssetReview.

## `0.2.0 Searchable` Evidence

`0.2.0 Searchable` adds these required fields on top of Public Beta evidence:

- `searchableReadiness`: SQLite catalog search, scoped `/api/search`, Query Runtime evidence lookup, and citation-ready results passed.
- `incrementalUpdateProof`: source delta, targeted rerun scope, and rollback-ready version evidence are present.
- `vectorFallbackProof`: the local vector sidecar contract is verifiable, invalid vectors cannot override catalog truth, and Query Runtime falls back to catalog search.
- `browserSearchWorkflow`: real desktop and narrow browser checks show maintenance evidence search with citation-ready evidence and an evidence link.
- `staleJsonAuthorityAudit`: no JSON/JSONL path still acts as mutable workspace or catalog authority.
- `packageAssetReview`: release/package assets contain no private state, SQLite databases, credentials, generated browser artifacts, or stale JSON authority files.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage searchable --evidence ./release-evidence.json
```

JSON/JSONL may only remain at export, audit, sidecar, checkpoint, credential, schema, or template boundaries. Any `workspace.json`, `setup.json`, `local-chunks.jsonl`, `query-feedback.jsonl`, or similar primary-state shape must be migrated or removed.

## `0.3.0 Query Runtime` Evidence

`0.3.0 Query Runtime` adds these required fields on top of `0.2.0 Searchable` evidence:

- `routeContractReadiness`: Query Route contract, refusal taxonomy, and `citation_ready_evidence_only` policy are verified.
- `citationGroundedAnswerProof`: answered responses are backed by evidence packs, scoped citations, and query quality gates.
- `refusalNoAnswerProof`: out-of-scope and insufficient-evidence questions return explicit refusal or no-answer states instead of weak successful answers.
- `feedbackMaintenanceProof`: negative feedback enters maintenance review with evidence target and targeted rerun scope; positive feedback remains a bounded ranking signal.
- `integrationContractProof`: OpenAPI, Node.js example, plain HTTP example, and drift tests describe the same runtime contract.
- `browserAskWorkflow`: real desktop and narrow browser checks prove answered, refused/no-answer, and feedback-maintenance paths.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage query-runtime --evidence ./release-evidence.json
```

When generating evidence, use `--query-runtime` or `--stage query-runtime`, and provide passing evidence for route contract, citation-grounded answer, refusal/no-answer, feedback-maintenance, integration contract, and browser ask workflow.

## `0.4.0 Expert SDK` Evidence

`0.4.0 Expert SDK` adds these required fields on top of `0.3.0 Query Runtime` evidence:

- `expertManifestReadiness`: Expert manifest contract, authoring validation, and lifecycle certification are verified.
- `expertRuntimeBoundaryProof`: public runtime hooks, direct-storage blocking, and Query Runtime route-hook consumption are verified.
- `nonK12ExampleProof`: the `operations-handbook` non-K12 Expert, public fixture, and citation-ready Query Runtime evidence are verified.
- `expertEvaluationGateProof`: portable evaluation cases, dashboard aggregation, and maintenance mapping are verified.
- `expertDocsContributorWorkflowProof`: authoring docs, example docs, required tests, and community proposal path are documented.
- `expertPackageAssetReview`: Expert SDK release assets exclude private state, SQLite files, credentials, and private fixtures.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage expert-sdk --evidence ./release-evidence.json
```

When generating evidence, use `--expert-sdk` or `--stage expert-sdk`, and provide passing evidence for Expert manifest, runtime boundary, non-K12 example, evaluation gate, docs workflow, and Expert package asset review.

## `0.5.0 Provider Adapters` Evidence

`0.5.0 Provider Adapters` adds these required fields on top of `0.4.0 Expert SDK` evidence:

- `providerManifestReadiness`: Provider adapter manifest contract, validation, and capability inventory are verified.
- `parserOcrBoundaryProof`: parser preflight, OCR preflight, and unsafe input review are verified.
- `embeddingVectorBoundaryProof`: embedding batch contract, vector output validation, and catalog fallback are verified.
- `providerDiagnosticsBrowserProof`: real desktop and narrow browser checks render provider diagnostics through scoped APIs and prove `workspace.sqlite` / `catalog.sqlite` state authority.
- `noCloudPublicPathProof`: the public sample path is no-cloud, credential-free, and has no external calls before execution.
- `providerPackageAssetReview`: Provider Adapter release assets exclude private state, SQLite files, credentials, generated artifacts, and direct-provider bypasses.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage provider-adapters --evidence ./release-evidence.json
```

When generating evidence, use `--provider-adapters` or `--stage provider-adapters`, and provide passing evidence for provider manifest, parser/OCR boundary, embedding/vector boundary, provider diagnostics browser, no-cloud public path, and provider package asset review.

## `0.6.0 Integration SDK` Evidence

`0.6.0 Integration SDK` adds these required fields on top of `0.5.0 Provider Adapters` evidence:

- `endpointManifestReadiness`: endpoint manifest, OpenAPI, scoped discovery, and integration diagnostics discovery are verified.
- `sdkClientProof`: package exports, scoped helpers, injected fetch, timeout/request id handling, and redacted SDK errors are verified.
- `examplesDriftProof`: Node example, plain HTTP example, expected responses, and drift tests cover the same contract.
- `integrationSafetyProof`: retry semantics, diagnostics redaction, localhost-only defaults, and no internal state reads are verified.
- `providerAwareNoCloudProof`: provider diagnostics and integration diagnostics prove the public sample performs no external calls before explicit provider execution.
- `integrationPackageAssetReview`: Integration SDK release assets exclude private state, SQLite files, credentials, generated artifacts, and direct internal-state read paths.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage integration-sdk --evidence ./release-evidence.json
```

When generating evidence, use `--integration-sdk` or `--stage integration-sdk`, and provide passing evidence for endpoint manifest readiness, SDK client proof, examples drift proof, integration safety proof, provider-aware no-cloud proof, and integration package asset review.

## `0.7.0 Consumer Integration Proof` Evidence

`0.7.0 Consumer Integration Proof` adds these required fields on top of `0.6.0 Integration SDK` evidence:

- `installedSdkConsumerProof`: an external app imports the installed package through `knowmesh` / `knowmesh/sdk` and verifies exports, injected fetch, no internal dependencies, and no private package files.
- `livePublicSampleSdkProof`: the installed SDK calls a live public sample over real HTTP, covering answered/refused/search/feedback/provider diagnostics/package preview/version manifest/reset.
- `integrationRecipeProof`: bilingual integration guides cover server-side Node, Electron/local desktop, browser-through-backend, CI smoke, localhost/CORS, retry, request id, and feedback maintenance links.
- `privacyBoundaryAuditProof`: integration docs, examples, expected responses, and the SDK entry point pass the privacy boundary audit with `0` findings.
- `providerAwareNoCloudConsumerProof`: the consumer-facing public sample path remains no-cloud and credential-free, with no external calls before explicit provider execution.
- `consumerPackageAssetReview`: Consumer Integration release assets exclude private state, SQLite files, credentials, generated artifacts, direct internal-state reads, and private package files.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage consumer-integration --evidence ./release-evidence.json
```

When generating evidence, use `--consumer-integration` or `--stage consumer-integration`, and provide passing evidence for installed SDK consumer, live public-sample SDK, integration recipes, privacy audit, provider-aware no-cloud consumer, and consumer package asset review.

## `0.8.0 Operator Workflow Proof` Evidence

`0.8.0 Operator Workflow Proof` adds these required fields on top of `0.7.0 Consumer Integration Proof` evidence:

- `sourceIntakeProof`: folder precheck, scan preview, source manifest, exclude/restore, changed/missing/restored source deltas, execution plan preview, and K12 gate isolation are verified.
- `executionRecoveryProof`: job creation, checkpoint persistence, progress polling, pause/resume/stop, restart recovery, task summary, and diagnostic redaction are verified.
- `maintenanceTargetedRerunProof`: evidence search, query feedback review, quality issue review, safe rerun scope, targeted rerun job, and review resolution are verified.
- `versionRollbackProof`: version manifest, package preview, version list, diff, rollback preview, rollback confirmation, and cross-KB isolation are verified.
- `operatorBrowserWorkflow`: real desktop and narrow browser checks expose source intake, execution, maintenance, versions, feedback, and diagnostics operator surfaces.
- `operatorPrivacyAuditProof`: diagnostics and operator surfaces do not leak credentials, private content, local paths, raw provider payloads, or external calls before explicit execution.
- `operatorPackageAssetReview`: Operator Workflow release assets exclude private state, SQLite files, credentials, generated artifacts, direct internal-state reads, and private package files.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage operator-workflow --evidence ./release-evidence.json
```

When generating evidence, use `--operator-workflow` or `--stage operator-workflow`, and provide passing evidence for source intake, execution recovery, maintenance targeted rerun, version rollback, operator browser workflow, operator privacy audit, and operator package asset review.

## `0.9.0 First-Run Usability Proof` Evidence

`0.9.0 First-Run Usability Proof` adds these requirements on top of `0.8.0 Operator Workflow Proof` evidence:

- `firstRunLaunchProof`: empty workspace, create/sample actions, runtime diagnostics, provider readiness, and localhost-only diagnostics must pass.
- `guidedSetupProof`: setup draft persistence, folder precheck, missing folder blocking, scan preview, execution plan preview, and general-docs no-K12 leakage must pass.
- `buildRecoveryProof`: job creation, visible progress, pause/resume, restart recovery, completion, and diagnostic redaction must pass.
- `firstQuestionProof`: Query Runtime, citation-or-explicit-no-answer, evidence search, and no weak success must pass.
- `maintenanceNextActionProof`: feedback stored, review item created, safe rerun scope, and scoped API must pass.
- `firstRunBrowserWorkflow`: real browser desktop and narrow views must expose empty state, create/select, readiness, and diagnostics.
- `firstRunPackageAssetReview`: First-Run Usability release assets must exclude private state, SQLite, credentials, generated artifacts, direct internal-state reads, and private package files.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage first-run-usability --evidence ./release-evidence.json
```

When generating evidence, use `--first-run-usability` or `--stage first-run-usability`, and provide passing evidence for first-run launch, guided setup, build recovery, first question, maintenance next action, first-run browser workflow, and first-run package asset review.

## `1.0.0 Usable Product Proof` Evidence

`1.0.0 Usable Product Proof` adds these requirements on top of `0.9.0 First-Run Usability Proof` evidence:

- `usableLaunchReliabilityProof`: port fallback, no implicit KB, localhost-only access, PATH mutation guard, restart selection persistence, workspace SQLite authority, no legacy JSON state, and diagnostic redaction all pass.
- `usableDocumentIntakeProof`: parser/OCR boundaries, rejected risky inputs, catalog consistency, targeted rerun source sets, and zero external calls before execution all pass.
- `usableWebConsoleWorkflowProof`: create/select/setup/build/execution/ask/feedback/documents/versions/diagnostics/package preview user paths are visible, with no duplicate primary controls or direct internal-state reads.
- `usableDurableDataPackageProof`: workspace/catalog backup, WAL/SHM exclusion, stale JSON cleanup, package export/import preview, version manifest, rollback preview, rollback confirmation, and package boundary privacy all pass.
- `usableBrowserWorkflow`: real desktop and narrow browser evidence covers public sample, Query Runtime, feedback, maintenance, diagnostics, and no horizontal overflow.
- `usablePrivacyProof`: diagnostic redaction, no credential leaks, no private content, no local paths, no external calls before execution, and integration privacy audit all pass.
- `usableProductPackageAssetReview`: Usable Product release assets exclude private state, SQLite/WAL files, credential material, generated artifacts, direct internal-state reads, private package files, and stale JSON authority.

Acceptance command:

```bash
node ./scripts/release-gate.mjs --stage usable-product --evidence ./release-evidence.json
```

When generating evidence, use `--usable-product` or `--stage usable-product`, and pass `--usable-product-smoke <json>` to reuse `npm run smoke:usable-product` output.

## `1.0.0 Public Release Candidate Freeze` Evidence

Release Candidate Freeze does not add runtime features. It freezes usable-product evidence into a public pre-release review packet:

```bash
npm run smoke:release-candidate
npm run generate:release-candidate
npm run smoke:stabilization
npm run generate:stabilization
npm run smoke:api-reliability
npm run generate:api-reliability
npm run smoke:community-release
npm run generate:community-release
npm run smoke:final-publication
npm run generate:final-publication
node ./scripts/release-gate.mjs --usable-product --evidence ./exports/release-candidate-evidence.json
```

`release-candidate-evidence` must include real local smoke summaries, fresh-clone install rehearsal, desktop/narrow browser acceptance, community readiness, go/no-go packet, and the current artifact sha256. It must not automatically switch the repository public, create tags, create releases, or publish npm.

## Generated Evidence

Maintainers can run `npm run generate:release-evidence` for milestone evidence JSON, `npm run generate:release-candidate` to write `exports/release-candidate-evidence.json`, `npm run generate:stabilization` to write `exports/stabilization-evidence.json`, `npm run generate:api-reliability` to write `exports/api-reliability-evidence.json`, `npm run generate:community-release` to write `exports/community-release-readiness-evidence.json`, or `npm run generate:final-publication` to write `exports/final-publication-review-evidence.json`. The generated result must keep `npmPublication: "separate-decision"` / `human-review-required` and carry beta feedback `known-gap` items into release-note carryover.

## release-gate

Without evidence it must block:

```bash
npm run verify:release-gate
```

Only complete evidence can pass:

```bash
node ./scripts/release-gate.mjs --evidence ./release-evidence.json
```

`npmPublication` must stay `separate-decision`. npm publication is a separate decision and must not be bundled with GitHub release approval.

## Manual Checks Before Release

- Use the [Publication Decision Checklist](publication-decision-checklist.en.md) to confirm visibility, tag, GitHub Release, npm publish, announcement, rollback owner, and the Block AA entry point.
- README, README.en, docs index, Roadmap, and release notes are aligned.
- Public samples, integration examples, Expert docs, and provider docs contain no private material.
- Draft release assets do not contain workspace state, SQLite databases, logs, `.env`, or local machine paths.
- Known gaps must be written into beta release notes instead of being hidden behind the word "Alpha."
- Issues labeled `triage:release-note` in beta feedback must enter release-note carryover.
