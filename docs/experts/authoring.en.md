# Expert Authoring Kit

[中文](authoring.zh-CN.md) | [K12 Expert](k12.en.md) | [Current Design](../current-design.md)

An Expert is a domain extension, not a fork of Core. It declares domain objects, relations, quality gates, and query routes, but it must use public Core interfaces. It must not mutate Core tables directly, read internal SQLite paths, or depend on a private workspace layout.

## Manifest Contract

Each Expert declares at least these fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable Expert ID. |
| `templateId` | Bound template or scenario template ID. |
| `manifestVersion` | Fixed at `1.0.0` for this authoring contract. |
| `supportedContractVersion` | Compatible Query Runtime / Expert SDK contract version. |
| `title` | Chinese and English title. |
| `supportedSourceTypes` | Source types such as `pdf`, `office`, or `markdown`. |
| `setupFields` | Required or recommended user setup fields. |
| `sourceScope` | Source-scope policy and rules, such as textbook scope or business domain. |
| `extraction.objects` | Domain object types produced by the Expert. |
| `extraction.relations` | Relation types between objects. |
| `queryRoutes` | Domain routes available to Query Runtime. |
| `queryRouteRules` | Route rules, priority, and evidence policy declarations. |
| `qualityGates` | Quality gates required before build, query, or release. |
| `evaluationCases` | Public evaluation categories or fixture sets bundled by the Expert. |
| `migrations` | Expert catalog/schema migration declarations. |
| `capabilities` | Schema, processor, router, evaluation, and other capability entries. |
| `docs` | Chinese and English documentation entries. |
| `requiredTests` | Tests required before lifecycle graduation. |
| `permissions` | Permission declaration; use an empty array when no permission is required. |

## Lifecycle

Every Expert must declare a lifecycle stage: `official` -> `certified` -> `community` -> `experimental`.

- `official`: maintained with Core and included in release gates.
- `certified`: reviewed by maintainers against docs, tests, security, and runtime boundaries.
- `community`: usable community extension with a clear owner and limitations.
- `experimental`: exploration only; not a stable API or release promise.

New Experts usually start as `experimental`. At every stage, an Expert must not read `catalog.sqlite`, `workspace.sqlite`, or private workspace paths directly; it must use public Core, Expert, and Query Runtime interfaces.

## Engineering Boundary

- Use public Core interfaces: source manifests, catalog writers, quality gates, Query Runtime routes, and evaluation manifests.
- JSON is allowed for manifests, sidecars, examples, and exports, but not as primary runtime state.
- Do not commit copyrighted textbook content, customer material, student privacy data, cloud credential plaintext, or private source text.
- Contributors should add manifest schema tests before adding processors or query routes.
- `permissions` must not use `*`, `admin`, `filesystem:all`, or `sqlite:write`. Experts must not declare direct SQLite writers, local absolute paths, private fixtures, or workspace-layout assumptions.

## Runtime Hooks

Experts can connect to Core only through these narrow runtime hooks:

| Hook | Purpose |
| --- | --- |
| `sourceScope.decide` | Return source-scope decisions from a source manifest. |
| `classification.hintPageBlocks` | Provide domain hints for page and block classification. |
| `catalogWriter.writeStructureNodes` | Write structure nodes through the catalog writer. |
| `catalogWriter.writeKnowledgeObjects` | Write domain objects and relations through the catalog writer. |
| `queryRoutes.registerRules` | Register declarative route rules with Query Runtime. |
| `evaluation.registerCases` | Register Expert evaluation cases. |

These hooks expose capability and boundary summaries only. Diagnostics must be redacted and must not include local absolute paths, source body text, credentials, or internal storage filenames. Expert route rules may declare only evidence policies such as `citation_ready_evidence_only`, `refuse_before_retrieval`, or `no_weak_answer`; they cannot bypass Core citation and refusal policies.

## Evaluation Cases

Expert evaluation cases use portable fields:

- `caseId`, `expertId`, `template`, and `category`
- `expectedStatus`: `answered`, `refused`, or `noAnswer`
- `requiredCitations`
- `refusalExpected`
- `noAnswerExpected`
- `redaction.excludes`

Experts may declare their own evaluation categories and quality gates, but they cannot override Core Query Gates: citation traceability, evidence support, out-of-scope refusal, no weak-answer success, and display serialization checks remain Core responsibilities. Evaluation failures map to `expert_evaluation_gap` maintenance items in the shared maintenance review queue for targeted reruns or source review.

## Local Verification

```bash
npm test -- src/local-service/expert-registry.test.mjs
npm test -- src/local-service/expert-runtime.test.mjs
npm test -- src/local-service/expert-evaluation.test.mjs
npm test -- src/local-service/extension-certification.test.mjs
npm test -- src/local-service/query-route-planner.test.mjs src/local-service/query-evidence.test.mjs src/local-service/provider-capabilities.test.mjs
npm run verify:package-boundary
```

For a new Expert, add at least:

- `src/experts/<id>/template.json`
- `src/experts/<id>/schema.json`
- registry manifest
- tests for `sourceScope`, objects, relations, `queryRouteRules`, `qualityGates`, `evaluationCases`, `migrations`, and `requiredTests`
