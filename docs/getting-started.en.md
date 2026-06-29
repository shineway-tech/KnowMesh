# KnowMesh Getting Started

[中文](getting-started.zh-CN.md) | [Documentation](README.en.md) | [Project Home](../README.en.md)

This guide helps you run the local KnowMesh path without cloud credentials, uploads, model calls, or vector writes.

## Requirements

- Node.js 24 or newer.
- Windows, macOS, or Linux.
- Optional: Ghostscript for scanned-PDF page rendering; LibreOffice for legacy Office/WPS conversion.

Repository launchers are available for ordinary users. If system Node.js 24+ is missing, launchers prepare a private runtime without modifying the system PATH.

## Install Dependencies

```bash
npm install
```

## Run Credential-Free Local Checks

```bash
npm run doctor
```

This reads `examples/local-demo/kb.yaml` and checks local demo documents, workspace paths, and basic configuration. It does not upload, delete, call OCR, call embedding, or write vector indexes.

## Generate a Local Demo Plan

```bash
npm run demo:plan
```

This scans `examples/local-demo/documents/`, recognizes normal files and split-PDF examples, and writes local plan artifacts under `workspace/local-demo/`.

## Start the Web Console

```bash
npm start
```

Default URL:

```text
http://127.0.0.1:7457
```

You can also use launchers:

```bash
# Windows
.\knowmesh.cmd start

# macOS / Linux
./knowmesh start
```

## Local Verification Commands

```bash
npm test
npm run smoke:release
npm run smoke:artifact
npm run verify:package-boundary
```

- `npm test`: full test suite.
- `npm run smoke:release`: starts a temporary local service and checks critical APIs.
- `npm run smoke:artifact`: packs a tarball, installs it in a clean temporary npm project, then verifies CLI help and the absence of private state in the installed package.
- `npm run verify:package-boundary`: checks that release packages do not include `.env`, SQLite files, workspace state, knowledge bases, test files, or private artifacts.

## K12 Example

`examples/textbook-cn-k12/` is an Aliyun configuration example for the K12 enhanced template. It does not include textbook content and is not the credential-free local demo. Users must use owned or authorized source materials.

```bash
KNOWMESH_K12_SOURCE_ROOT=/path/to/authorized-k12-sources
npm run doctor:textbook
```

## Next Steps

- Understand the architecture: [Architecture Overview](architecture.en.md)
- Read the full design: [Current Design](current-design.md)
- Check operations and release gates: [Operations Runbook](phase1-6-operations-runbook.md)
