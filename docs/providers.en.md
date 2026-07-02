# Provider Adapters

[中文](providers.zh-CN.md) | [Documentation](README.en.md) | [Current Design](current-design.md)

The KnowMesh Provider Layer keeps parsers, OCR, models, embeddings, rerankers, vector stores, object stores, and export targets outside Core. Core orchestrates the knowledge-asset lifecycle. Providers declare capabilities, cost, privacy boundaries, dependencies, and user-fixable errors.

## Current Providers

| Provider | Status | Role | Boundary |
| --- | --- | --- | --- |
| Local Catalog and SQLite | Enabled by default | State, retrieval, and maintenance truth in `workspace.sqlite` and each `catalog.sqlite` | Local only |
| Local Parser | Enabled by default | Local text, Markdown, CSV/TSV, RTF, and modern Office parsing; legacy Office/WPS through converters | Local only |
| Local OCR / Layout | Optional | PaddleOCR / PP-Structure or a compatible OCR command | Called only after explicit configuration |
| Local Vector Search | Disabled by default | Future local vector acceleration layer | Falls back to catalog/FTS when disabled |
| Aliyun OSS Source Storage | Optional cloud provider | Original-source archive and sidecar publication | Source files leave the device and are written to OSS |
| Aliyun Model Studio | Optional cloud provider | OCR, organization, embedding, rerank, and answer generation | Text/image inputs are sent to the model service |
| Aliyun OSS Vector | Optional cloud provider | Vector index preparation, vector writes, and vector queries | Vectors and compact metadata are written to OSS Vector |

## Visible Capabilities

`/api/providers/capabilities` returns:

- provider type, status, and setup requirements;
- capability list;
- cost units;
- privacy boundary;
- batch support and fallback;
- retry policy;
- least-privilege actions;
- user-fixable errors;
- `providerAdapterManifests`: each provider adapter's id, kind, lifecycle, capabilities, execution, permissions, secretRequirements, privacyBoundary, costHints, batchLimits, retryPolicy, checkpointPolicy, storageBoundary, docs, fixtures, and requiredTests;
- `providerAdapterManifestSummary`: manifest count, local-first count, external-provider count, kind distribution, and validation result;
- `adapterContracts`: stable interface versions, required methods, and boundaries for parser, OCR, chat, embedding, rerank, vector, and object-store adapters;
- `dryRun`: configured providers, missing providers, external calls before execution, and whether remote state will be written;
- no raw credentials, document text, query text, or answer text.

The maintenance page shows both Provider Capabilities and Platform Runtime so users can review cost, privacy, permissions, and local dependencies before execution.

## Provider Adapter Manifest

Starting with Block O, provider work begins from `providerAdapterManifests` instead of scattered provider branches. Built-in manifests first cover:

- `local-catalog`
- `local-parser`
- `local-ocr`
- `local-vector-sidecar`
- `aliyun-oss`
- `dashscope-ocr`
- `aliyun-oss-vector`
- `dashscope-embedding`
- `dashscope-rerank`
- `no-rerank-fallback`
- `no-provider-fallback`

`validateProviderAdapterManifest` rejects wildcard permissions, direct internal SQLite writes, implicit external calls, external providers without dry-run support, missing docs/tests, private fixtures, and adapters marked certified/official without graduation criteria. Cloud providers must dry-run what data will be sent, whether remote state will be written, which least-privilege permissions are required, and which secrets are needed. local-only paths must prove they do not silently call the network.

## `0.5.0 Provider Adapters` Release Evidence

`0.5.0 Provider Adapters` turns provider boundaries from scattered setup branches into an auditable, replaceable, release-gated foundation. It adds these fields on top of `0.4.0 Expert SDK` evidence:

- `providerManifestReadiness`: manifest contract, validation, and capability inventory passed.
- `parserOcrBoundaryProof`: parser preflight, OCR preflight, and unsafe input review passed, with macro files and unsupported formats entering review instead of bypassing catalog/artifact truth.
- `embeddingVectorBoundaryProof`: embedding batch contract, vector output validation, and catalog fallback passed, with vectors kept as accelerators only.
- `providerDiagnosticsBrowserProof`: the Web Console renders provider diagnostics through scoped APIs on desktop and narrow viewports; state authority remains `workspace.sqlite` and `catalog.sqlite`, while browser storage is limited to visual preferences.
- `noCloudPublicPathProof`: the public sample and local-first path are no-cloud and credential-free, with `externalCallsBeforeExecution` equal to `0`.
- `providerPackageAssetReview`: release assets contain no private state, SQLite files, secrets, generated artifacts, or direct-provider bypass paths.

Validation command:

```bash
node ./scripts/release-gate.mjs --stage provider-adapters --evidence ./release-evidence.json
```

When generating evidence, use `--provider-adapters` or `--stage provider-adapters`. The direct-provider bypass audit blocks legacy provider state, provider bypasses, direct cloud calls, and provider execution JSON/JSONL that would act as mutable primary state.

## Lifecycle

Provider adapters must declare a lifecycle stage: `official` -> `certified` -> `community` -> `experimental`.

- `official` adapters are accepted with the Core release gate.
- `certified` adapters must declare permissions, dry-run behavior, recovery errors, and privacy boundaries, then pass maintainer review.
- `community` adapters must state owner, limitations, dependencies, and safety notes.
- `experimental` adapters are exploratory and must not be documented as stable runtime paths.

Providers may not use `*` wildcard permissions or depend directly on internal SQLite file paths. They must expose auditable information through provider contracts, the capability matrix, diagnostics, and package preview.

## Local Parser Pilot

`local-parser` is the first certified provider adapter pilot:

- lifecycle stage: `certified`;
- externalCallsBeforeExecution: `0`;
- permissions: `[]`;
- catalogWriteBoundary: `catalog-writer-api`;
- requiredMethods: `scanSources`, `readTextLikeSource`, `readModernOfficeSource`, `checkpointExtractionResult`;
- user-fixable errors: `legacyConverterMissing`, `fileUnreadable`.

It parses text, Markdown, CSV/TSV, RTF, and modern Office files locally; legacy Office/WPS requires LibreOffice or a WPS converter. It never executes macros, never touches internal SQLite file paths directly, and must write extraction results through public writer APIs.

## Execution Rules

- OCR, embedding, rerank, vector writes, and evaluation prefer provider batch APIs.
- External calls use bounded concurrency.
- Only network errors, timeouts, 429, 5xx, and provider-declared transient errors are retried.
- Batch-size errors are split automatically.
- Authentication, permission, model-not-found, and invalid-index failures fail immediately with user-fixable guidance.
- Secrets must not enter SQLite, logs, exports, reports, or sidecars.

## Local Vector Fallback

Local Vector Search is currently a provider contract that can stay disabled. When disabled:

- the `local-vector` provider status is `disabled`;
- the `localVectorSearch` capability status is `disabled`;
- Query Runtime continues to answer with citations through catalog/FTS and structure indexes;
- local mode does not silently call embedding or OSS Vector.

This keeps SQLite/catalog as the business truth while leaving a clear integration point for future local embedding and vector engines.

## local-only, Aliyun, and future adapter rules

In local-only mode, parser and SQLite catalog are available by default. OCR, embedding, rerank, vector, and object-store adapters do not silently call the network when they are not explicitly configured, and `dryRun.summary.externalCallsBeforeExecution` must stay `0`.

In Aliyun mode, Model Studio, OSS, and OSS Vector enter `dryRun.externalCalls` only after the user has configured and confirmed them. dryRun describes provider, adapter, operation, whether source content is sent, and whether remote state is written; it does not include plaintext credentials or source text.

A future adapter should add the matching `adapterContracts` interface and tests before joining the execution flow. Contributors should expose capabilities through `/api/providers/capabilities` and prove diagnostics export, package preview, logs, public samples, and sidecars do not contain sensitive values.
