# Usable Product Proof

[中文](usable-product.zh-CN.md) | [Documentation](README.en.md) | [Release Candidate Evidence](release-candidate.en.md) | [Current Design](current-design.md)

`1.0.0 Usable Product Proof` proves that KnowMesh is more than a launchable demo or public sample: it can compile real local materials into maintainable, traceable, recoverable, and integration-ready knowledge assets.

It does not claim commercial stability. It is a reviewable release-evidence stage that requires the ordinary user path, operator path, browser proof, privacy boundary, and package asset boundary to pass together.

## Evidence Sources

Core evidence comes from:

```bash
npm run smoke:usable-product
npm run smoke:browser-sample
npm run smoke:first-run-usability
npm run smoke:operator-workflow
npm run smoke:sdk-consumer
npm run smoke:live-sdk
npm run smoke:artifact
npm run verify:package-boundary
npm run verify:integration-privacy
```

`smoke:usable-product` returns four main proofs:

- `launchReliabilityProof`: port fallback, no implicit KB, localhost-only access, PATH-safe launchers, restart selection persistence, SQLite authority, no legacy JSON state, and redacted diagnostics.
- `documentIntakeProof`: parser/OCR boundaries, rejected risky inputs, consistent catalog/source manifest/document inventory/targeted rerun source sets, and zero external calls before execution.
- `webConsoleWorkflowProof`: visible create/select, setup, build/execution, ask, feedback, documents, versions, diagnostics, and package preview paths without duplicate primary controls or direct internal-state wording.
- `durableDataPackageProof`: workspace/catalog backup hashes, WAL/SHM exclusion, stale JSON/JSONL cleanup, package export/import preview, version manifest, rollback preview, and confirmed rollback.

## release-gate Fields

`1.0.0-usable-product` evidence adds these fields on top of `0.9.0-first-run-usability`:

```json
{
  "usableLaunchReliabilityProof": { "status": "pass", "portFallback": true, "noImplicitKnowledgeBase": true, "localhostOnly": true, "pathMutationGuard": true, "restartSelectionPersistence": true, "workspaceSqliteAuthority": true, "noLegacyJsonState": true, "diagnosticRedaction": true },
  "usableDocumentIntakeProof": { "status": "pass", "parserBoundary": true, "ocrBoundary": true, "rejectedRiskyInputs": true, "catalogConsistency": true, "targetedRerunSourceSet": true, "externalCallsBeforeExecutionZero": true },
  "usableWebConsoleWorkflowProof": { "status": "pass", "createSelectSetup": true, "buildExecutionLoop": true, "askFeedbackReview": true, "documentsVersionsDiagnostics": true, "packagePreview": true, "noDuplicatePrimaryControls": true, "noDirectInternalStateReads": true },
  "usableDurableDataPackageProof": { "status": "pass", "workspaceCatalogBackup": true, "walFilesExcluded": true, "staleJsonCleanup": true, "packageExportPreview": true, "importPreviewNoWrites": true, "versionManifest": true, "rollbackPreview": true, "rollbackConfirmation": true, "packageBoundaryPrivacy": true, "externalCallsBeforeExecutionZero": true },
  "usableBrowserWorkflow": { "status": "pass", "desktop": true, "narrow": true, "publicSample": true, "queryRuntime": true, "feedback": true, "maintenance": true, "diagnostics": true, "noHorizontalOverflow": true },
  "usablePrivacyProof": { "status": "pass", "diagnosticRedaction": true, "noCredentialLeak": true, "noPrivateContentLeak": true, "noLocalPaths": true, "noExternalCallsBeforeExecution": true, "integrationPrivacyAudit": true },
  "usableProductPackageAssetReview": { "status": "pass", "noPrivateState": true, "noSqlite": true, "noSecrets": true, "noGeneratedArtifacts": true, "noDirectInternalReads": true, "noPrivatePackageFiles": true, "noStaleJsonAuthority": true, "noWalFiles": true }
}
```

Verify it with:

```bash
node ./scripts/release-gate.mjs --stage usable-product --evidence ./release-evidence.json
```

When generating evidence, use `--usable-product` and `--usable-product-smoke <json>`.

## Common Blockers

- Launch creates an implicit default knowledge base.
- Selected KB, setup draft, job summary, or release decisions depend on browser storage or JSON files.
- Packages or release assets include `workspace.sqlite`, `catalog.sqlite`, `*.sqlite-wal`, `*.sqlite-shm`, `.env`, logs, private sources, or generated test artifacts.
- QA flows bypass Query Runtime, or UI exposes internal SQL/table/legacy JSON state.
- Diagnostics, examples, SDKs, or docs leak local absolute paths, credentials, private source text, or raw provider payloads.
