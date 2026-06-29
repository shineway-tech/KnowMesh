# Phase 1-6 Operations Runbook

This runbook is operational guidance only. `docs/current-design.md` remains the
single current design authority.

## Startup

Use the packaged launcher first:

```bash
knowmesh start
```

On Windows from the repository root:

```bat
.\knowmesh.cmd start
launcher\knowmesh.cmd start
```

On macOS or Linux from the repository root:

```bash
./knowmesh start
launcher/knowmesh start
```

Launchers first look for Node.js 24 or newer. If it is missing, they prepare a
private Node runtime under the user runtime directory and do not modify the
system PATH.

Maintainers may run the service directly:

```bash
npm install
node ./src/cli/knowmesh.mjs start
```

## SQLite State

Runtime state is SQLite-backed:

- `workspace.sqlite` stores the knowledge-base registry, current selection,
  display metadata, setup summaries, task summaries, paths, preferences, and
  migration history.
- Each knowledge base has its own `catalog.sqlite` for setup state, jobs, task
  steps, documents, pages, structures, chunks, indexes, versions, feedback,
  evaluations, and quality queues.
- Large artifacts remain on disk. SQLite rows store paths, hashes, state, and
  queryable metadata.

Default local user-data roots:

- Windows: `%LOCALAPPDATA%\KnowMesh`
- macOS: `~/Library/Application Support/KnowMesh`
- Linux: `~/.local/share/knowmesh`

The current Windows default layout is:

```text
%LOCALAPPDATA%\KnowMesh\
  workspace.sqlite
  knowledge-bases\
    <knowledgeBaseId>\
      catalog.sqlite
      artifacts\
      feedback\
      logs\
  secrets\
```

## K12 One-Time Migration

The development K12 all-subject knowledge base is preserved through a one-time
migration to `kb-k12-all-subjects`.

Allowed legacy inputs for this one-time migration:

- root `setup-state.json`
- root `jobs-state.json`
- `knowledge-bases/default/setup-state.json`
- `knowledge-bases/default/jobs-state.json`
- `knowledge-bases/kb-k12-all-subjects/setup-state.json`
- `knowledge-bases/kb-k12-all-subjects/jobs-state.json`
- a legacy registry item whose normalized id is `kb-k12-all-subjects`

Non-K12 legacy registry entries and per-knowledge-base JSON state are not
adopted. They are cleaned once SQLite is active.

## JSON Boundary

JSON and JSONL are allowed for exports, audit artifacts, sidecars, credentials,
human-readable reports, and task checkpoints. They are not the runtime source of
truth for knowledge-base registry, current selection, setup state, task state,
feedback queues, or document overrides.

Old state paths that should be absent after migration:

```text
knowledge-bases.json
setup-state.json
jobs-state.json
knowledge-bases/default/
knowledge-bases/<knowledgeBaseId>/setup-state.json
knowledge-bases/<knowledgeBaseId>/jobs-state.json
knowledge-bases/<knowledgeBaseId>/document-overrides.json
knowledge-bases/<knowledgeBaseId>/feedback/qa-feedback.jsonl
knowledge-bases/<knowledgeBaseId>/feedback/query-feedback.jsonl
knowledge-bases/<knowledgeBaseId>/feedback/query-feedback-resolutions.jsonl
```

## Diagnostics

Useful API checks after startup:

```text
GET /api/health
GET /api/knowledge-bases
GET /api/maintenance/foundation
GET /api/platform/runtime
GET /api/providers/capabilities
GET /api/package/export/preview
GET /kb/<knowledgeBaseId>/api/maintenance/status
GET /kb/<knowledgeBaseId>/api/package/export/preview
```

Maintenance diagnostic exports are redacted. They include status, summaries,
paths, counts, provider capability state, and checks. They exclude credentials,
API keys, document text, source content, query text, answer text, evaluation
questions, and expected answers.

## Packaging Boundary

The npm package is controlled by `.npmignore`. The package should include:

- user launchers: `knowmesh`, `knowmesh.cmd`, and `launcher/`;
- runtime source under `src/`, excluding `*.test.mjs`;
- `scripts/release-smoke.mjs`;
- schemas, configs, documentation, brand assets, and credential-free examples.

The package must not include:

- `.env` or generated secret files;
- `node_modules/`;
- local `workspace/`, `knowledge-bases/`, `.tmp/`, `.runtime/`, `artifacts/`,
  logs, or generated SQLite files;
- test files or private fixtures.

Preview the package boundary without writing a tarball:

```bash
npm pack --dry-run --json
```

Verify the actual tarball as a consumer would install it:

```bash
npm run smoke:artifact
```

This command packs KnowMesh, installs the tarball in a clean temporary npm
project, checks the installed CLI help path, and rejects private runtime state
inside the installed package.

Create a release tarball in a temporary directory and record its checksum:

```bash
tmpdir="$(mktemp -d)"
npm pack --pack-destination "$tmpdir"
sha256sum "$tmpdir"/knowmesh-*.tgz
```

## Cross-Platform Checklist

Windows:

- `.\knowmesh.cmd start` delegates to `launcher\knowmesh.cmd`.
- `launcher\knowmesh.cmd` runs `launcher\knowmesh.ps1`.
- PowerShell launcher installs a private Node runtime under
  `%LOCALAPPDATA%\KnowMesh\runtime` when system Node.js 24+ is missing.
- File-open actions use Windows shell commands through guarded path helpers.

macOS and Linux:

- `./knowmesh start` delegates to `launcher/knowmesh`.
- The POSIX launcher installs a private Node runtime under
  `~/.knowmesh/runtime` when system Node.js 24+ is missing.
- The launcher needs `curl` or `wget` only when it has to download Node.
- File-open actions use platform file-manager commands through guarded path
  helpers.

Optional dependencies:

- Ghostscript enables scanned-PDF page rendering.
- LibreOffice or a compatible `soffice` binary enables legacy Office/WPS
  conversion.
- Missing optional dependencies should appear as guided actions in
  `GET /api/platform/runtime`; they should not corrupt SQLite state.

## GitHub Repository Gates

Current configured gates:

- CI runs on `ubuntu-latest` and `windows-latest` with Node.js 24.
- Dependabot is enabled for npm packages and GitHub Actions.
- Issues and Discussions are enabled for public support; Wiki is disabled.
- Squash merge is enabled, merge commits are disabled, and branches are deleted
  after merge.

Gates that must be enabled once GitHub allows them for the repository:

- Protect `main` with required CI checks before merge.
- Enable secret scanning and push protection.
- Enable private vulnerability reporting, then update `SECURITY.md` and issue
  template contact links to point directly to that private channel.

On a free private repository, GitHub can reject these repository-protection and
security APIs. Treat that as a hosting limitation, not as an accepted release
posture after the project becomes public.

## Local Verification

Run the complete test suite:

```bash
npm test
```

Run release smoke against a temporary local service and temporary user-data
root:

```bash
npm run smoke:release
```

Run release-artifact smoke against a clean temporary consumer project:

```bash
npm run smoke:artifact
```

Run targeted checks for the architecture and packaging foundation:

```bash
npm test -- src/local-service/knowledge-bases.test.mjs src/local-service/package-manifest.test.mjs src/local-service/provider-capabilities.test.mjs src/local-service/platform-runtime.test.mjs
```

Inspect architecture readiness from the repository root:

```bash
node --input-type=module -e "import { architectureFoundationStatus } from './src/local-service/architecture-foundation.mjs'; const status = architectureFoundationStatus({ projectRoot: process.cwd() }); console.log(JSON.stringify({ ok: status.ok, summary: status.summary, k12Migration: status.k12Migration }, null, 2));"
```

On a healthy migrated K12 workspace:

- `ok` is `true`.
- `summary.currentKnowledgeBase` is `kb-k12-all-subjects`.
- `k12Migration.preserved` is `true`.
- `k12Migration.current` is `true`.
- `k12Migration.legacyJsonClean` is `true`.
