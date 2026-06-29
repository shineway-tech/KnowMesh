# KnowMesh Architecture Overview

[中文](architecture.zh-CN.md) | [Documentation](README.en.md) | [Project Home](../README.en.md)

> This is an architecture entry point, not a second design authority. The complete product, data, quality, UX, and development contract lives in `docs/current-design.md`.

KnowMesh is a local-first Knowledge Asset Compiler: it turns source materials into trusted, inspectable, maintainable, and integrable knowledge assets. It is not an OCR tool, vector database UI, or local chatbot demo.

![KnowMesh architecture](../assets/readme/architecture.svg)

## Five Layers

| Layer | Responsibility |
| --- | --- |
| KnowMesh Core | Universal lifecycle: scan, extract, OCR orchestration, clean, structure, chunk, embed, write, version, evaluate, recover. |
| KnowMesh Expert | Domain plugins that define semantics, processors, quality gates, evaluation sets, and query-router rules. K12 is the first major Expert scenario. |
| Knowledge Asset Layer | The truth layer for documents, pages, blocks, structures, chunks, citations, evaluations, feedback, versions, and release manifests. |
| Provider Layer | Replaceable OCR, parser, model, embedding, rerank, vector store, object store, and export providers. |
| Platform Layer | Windows, macOS, and Linux paths, launchers, file picking, folder opening, process management, and private runtime setup. |

## SQLite-first State

KnowMesh does not treat scattered JSON files as the runtime source of truth.

- `workspace.sqlite`: knowledge-base registry, current selection, display metadata, setup/task summaries, paths, preferences, and migration history.
- `catalog.sqlite`: one per knowledge base, storing setup, tasks, documents, pages, structures, chunks, indexes, versions, feedback, evaluations, and quality queues.
- File system: original files, page images, OCR responses, normalized outputs, reports, and other large artifacts.
- JSON / JSONL: exports, audit artifacts, cloud sidecars, and human-readable reports, not primary runtime state.

## Knowledge Compilation Pipeline

```text
1. Create or select knowledge base
2. Configure mode, providers, template, source scope, retrieval policy
3. Scan source folder and classify files
4. Resolve logical documents and split-file groups
5. Extract text, pages, tables, figures, formulas, layout
6. Classify pages and blocks
7. Generate domain structures through Expert plugins
8. Clean, normalize, and quality-score content
9. Create chunks by knowledge object
10. Build structure, keyword, vector indexes and sidecars
11. Run evaluations and quality gates
12. Publish a version only when gates pass
13. Serve query, citations, feedback, maintenance, and integration APIs
```

## Query Runtime

Console question testing and external integrations must use the same Query Runtime. A usable answer must:

- match the knowledge-base scope;
- find sufficient evidence;
- cite source document, page, or structure anchor;
- ensure evidence supports the answer;
- refuse out-of-scope questions before retrieval;
- avoid counting weak answers as success;
- avoid raw exceptions, provider internals, and `[object Object]`.

## K12 Expert

K12 is the first major enhanced scenario. It requires structured understanding of:

- stage, grade, subject, volume, edition, unit, lesson, and page;
- Chinese vocabulary tables, lessons, annotations, exercises, oral communication, and writing tasks;
- math concepts, formulas, examples, exercises, and answer explanations;
- English units, lessons, words, sentences, and dialogues;
- science experiment purpose, materials, steps, observations, and conclusions;
- strict refusal for out-of-scope questions before retrieval.

## Quality Gates

KnowMesh does not call a knowledge base complete just because vector records exist. Quality gates cover:

- source scope;
- extraction / OCR state;
- chunk source, page, structure path, and quality state;
- sidecar and vector record consistency;
- evaluation sets;
- query evidence and citation support.

## Further Reading

- [Current Design](current-design.md)
- [Operations Runbook](phase1-6-operations-runbook.md)
- [Getting Started](getting-started.en.md)
