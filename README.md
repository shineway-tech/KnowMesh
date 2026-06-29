# KnowMesh / 知络

KnowMesh is a local-first, open-source knowledge-base building system. It turns source files into verifiable, traceable, and maintainable knowledge assets instead of simply pushing files into a vector database.

Current version: `0.1.0`  
License: `MIT`  
Default local URL: `http://127.0.0.1:7457`

## What It Does

KnowMesh helps users build and maintain knowledge bases from real document folders:

- Source intake: PDF, Word, Excel, PowerPoint, WPS/ET/DPS, Markdown, TXT, CSV/TSV, images, and scanned files.
- KnowMesh Core: scanning, extraction, OCR task preparation, cleaning, chunking, embedding, writing, checkpoints, versions, and rollback records.
- KnowMesh Expert: template-driven domain strategies such as `KnowMesh Expert · K12`.
- Quality Gates: confidence scoring, citation requirements, review queues, and blocked unsafe writes.
- Traceable Knowledge: every answer should point back to source file, page, section, or original snippet.
- Versioned Knowledge: document updates create new versions instead of silently overwriting previous results.

The first complete production-shaped path targets Aliyun mode:

- Object storage: Aliyun OSS Bucket
- Vector storage: Aliyun OSS Vector Bucket
- Model service: Alibaba Cloud Model Studio / DashScope-compatible APIs
- OCR default: `qwen-vl-ocr-2025-11-20`
- Embedding default: `text-embedding-v4`
- First enhanced template: China K12 textbooks

## Start

### 普通用户启动

```bash
knowmesh start
```

Windows 本地启动器:

```bat
.\knowmesh.cmd start
launcher\knowmesh.cmd start
```

macOS / Linux 本地启动器:

```bash
./knowmesh start
launcher/knowmesh start
```

Launcher 会在缺少 Node.js 时准备私有 Node 运行时，不会修改系统 PATH。

### 项目维护入口

Maintainers need Node.js 24 or newer.

```bash
npm install
node ./src/cli/knowmesh.mjs start
```

KnowMesh starts one local service on `127.0.0.1:7457`.

## User Flow

1. Open the local home page.
2. Create or switch to a knowledge base.
3. Complete the guided setup for that knowledge base.
4. Generate the knowledge base from the selected source folder.
5. Test questions through the same Query Runtime used by external integrations.
6. Integrate via API examples.
7. Maintain documents, versions, feedback, and diagnostics.

Every knowledge base has isolated setup, tasks, generated assets, versions, logs, feedback, and maintenance state. Creating a new knowledge base does not clear existing ones.

## Console Structure

The console is organized by user goals:

- Overview: current knowledge-base state and the next useful action.
- Build Knowledge Base: scan, execution plan, task execution, and generated outputs.
- Use Knowledge Base: question testing, integration guide, API docs, and feedback records.
- Maintain Knowledge Base: document list, version records, answer feedback, and diagnostics.
- Setup: run mode, cloud services, template strategy, source folders, and model/retrieval settings.

All console URLs are scoped by knowledge base:

```text
/kb/<knowledgeBaseId>/overview
/kb/<knowledgeBaseId>/build
/kb/<knowledgeBaseId>/build/execution
/kb/<knowledgeBaseId>/use/ask
/kb/<knowledgeBaseId>/use/integration
/kb/<knowledgeBaseId>/use/api-docs
/kb/<knowledgeBaseId>/use/feedback
/kb/<knowledgeBaseId>/maintain/documents
/kb/<knowledgeBaseId>/maintain/versions
/kb/<knowledgeBaseId>/maintain/feedback
/kb/<knowledgeBaseId>/maintain/diagnostics
```

## Templates

Built-in templates:

- `general-docs`: general fallback template for manuals, policies, training materials, product docs, and mixed business folders.
- `textbook-cn-k12`: enhanced China K12 textbook template for textbook folders with stage, subject, grade, volume, unit, lesson, page, and source citation requirements.

Templates are processing strategies, not marketing descriptions. A template defines metadata, source scope, filtering, chunking, citation, quality gates, update behavior, and optional KnowMesh Expert processors.

## Query Runtime

The console question page and third-party integrations use the same runtime:

- `POST /api/query`
- `GET /api/query/contract`
- `POST /api/query/feedback`

In Aliyun mode, a completed knowledge base should query OSS Vector, then resolve full citation records through OSS Sidecar metadata. Local files are not used to pretend that a cloud vector index works.

## Safety

KnowMesh is local-first and confirmation-gated:

- Secrets are not echoed back to the UI.
- Browser storage is only for visual preferences such as language, theme, and sidebar state.
- Knowledge-base setup, tasks, logs, versions, and generated assets are stored locally per knowledge base.
- Upload, OCR, embedding, vector writes, updates, and destructive actions require explicit user confirmation.
- Failed or low-confidence content is recorded for review instead of silently disappearing.

## Developer Checks

```bash
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
npm run doctor
npm run demo:plan
```

These checks are local and do not upload files, call OCR, call embedding, or write vector indexes.

## Repository Layout

```text
assets/brand/             Logo and brand assets
configs/                  Reusable configuration templates
docs/                     Single current design authority
examples/local-demo/      Credential-free local example
examples/textbook-cn-k12/ K12 Aliyun example config
launcher/                 Node-independent user launchers
schemas/                  JSON schemas
src/cli/                  Local command entry
src/core/                 Core planning and template logic
src/local-service/        Local HTTP service and APIs
src/web-console/          Local Web Console
```

## Documentation

- [Current Design](docs/current-design.md)
- [Phase 1-6 Operations Runbook](docs/phase1-6-operations-runbook.md)
- [Changelog](CHANGELOG.md)
- [Support](SUPPORT.md)
- [Security Policy](SECURITY.md)
