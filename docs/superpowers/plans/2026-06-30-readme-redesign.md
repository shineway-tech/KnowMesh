# README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public README and README visuals around the approved `Knowledge Asset Compiler` narrative.

**Architecture:** The README becomes the public product entry while `docs/current-design.md` remains the single design authority. The implementation replaces dense diagram assets with legible README-first visuals and keeps detailed architecture explanations in docs.

**Tech Stack:** Markdown, SVG, Node.js test runner, npm release smoke scripts, GitHub Actions.

---

## File Structure

- Modify `README.md`: Chinese default public homepage.
- Modify `README.en.md`: complete English public homepage.
- Modify `assets/readme/architecture.svg`: simplified five-stage workflow diagram.
- Create `assets/readme/hero.svg`: first-screen product visual.
- Create `assets/readme/k12-expert.svg`: concise K12 Expert scenario visual.
- Modify `docs/README.md` and `docs/README.en.md`: keep docs navigation aligned with the new README story.
- Modify `docs/architecture.zh-CN.md` and `docs/architecture.en.md`: reference the simplified architecture visual without becoming a second design authority.
- Update or remove unused README image references if the new SVGs replace older PNGs.

## Task 1: README Narrative

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`

- [ ] **Step 1: Rewrite the hero**

Use `Knowledge Asset Compiler` as the spine:

```markdown
# KnowMesh / 知络

> 把真实文档文件夹编译成可审计、可追溯、可维护、可集成的知识资产。
```

The English README mirrors the same promise:

```markdown
# KnowMesh

> Compile real document folders into auditable, traceable, maintainable knowledge assets.
```

- [ ] **Step 2: Add before/after contrast**

Include a compact table comparing ordinary RAG demos with KnowMesh:

```markdown
| Ordinary RAG demo | KnowMesh |
| --- | --- |
| Upload files | Compile source folders |
| Chunk and embed | Extract pages, blocks, structure, chunks, citations |
| Vector store as truth | SQLite catalog as truth; vectors accelerate retrieval |
| Weak answers can look successful | Query gates require evidence and citations |
| Rebuild from scratch | Checkpoint, rerun, version, rollback |
```

- [ ] **Step 3: Preserve launcher-first startup text**

Keep these exact user-facing startup signals so `src/launcher/launcher.test.mjs` still passes:

```text
### 普通用户启动
.\knowmesh.cmd start
launcher\knowmesh.cmd start
./knowmesh start
launcher/knowmesh start
私有 Node 运行时
不会修改系统 PATH
### 项目维护入口
node ./src/cli/knowmesh.mjs start
```

- [ ] **Step 4: Reframe K12**

Position K12 as the first Expert scenario, not the primary product identity. State that KnowMesh does not bundle copyrighted textbook content.

## Task 2: README Visuals

**Files:**
- Create: `assets/readme/hero.svg`
- Modify: `assets/readme/architecture.svg`
- Create: `assets/readme/k12-expert.svg`

- [ ] **Step 1: Create the hero visual**

Create a clean SVG showing:

```text
Source folders -> Catalog -> Quality gates -> Versioned asset -> Query/API
```

Use short labels and generous spacing. Do not include long paragraphs in the image.

- [ ] **Step 2: Replace architecture.svg**

Replace the current dense architecture graphic with the same five-stage flow, optimized for README width. Each card may include one short caption:

```text
Source Folder: PDF / Office / WPS / scans
Catalog: workspace.sqlite + catalog.sqlite
Quality Gates: review + evaluation + citations
Versioned Asset: releases + rollback + sidecars
Query Runtime: cited answers + feedback + APIs
```

- [ ] **Step 3: Create a K12 scenario visual**

Create a concise K12 Expert visual:

```text
Textbook -> TOC / Unit / Lesson -> vocabulary / formula / exercise -> page citation
```

No copyrighted textbook text or fake page excerpts.

## Task 3: Documentation Alignment

**Files:**
- Modify: `docs/README.md`
- Modify: `docs/README.en.md`
- Modify: `docs/architecture.zh-CN.md`
- Modify: `docs/architecture.en.md`

- [ ] **Step 1: Keep docs index aligned**

Ensure the docs index describes README as the public entry and `docs/current-design.md` as the design authority.

- [ ] **Step 2: Keep architecture docs focused**

If architecture docs reference visuals, they must point to the simplified README diagram or explain storage truth in prose without creating a second design spec.

## Task 4: Cleanup and Verification

**Files:**
- Modify: any README asset references affected by cleanup.

- [ ] **Step 1: Remove unused README visual assets if replaced**

Remove the superseded README PNG assets after the SVG replacements are referenced. Keep social preview assets unless they are explicitly replaced.

- [ ] **Step 2: Validate SVG XML**

Run:

```powershell
[xml](Get-Content assets\readme\architecture.svg -Raw) | Out-Null
[xml](Get-Content assets\readme\hero.svg -Raw) | Out-Null
[xml](Get-Content assets\readme\k12-expert.svg -Raw) | Out-Null
```

Expected: no XML parse errors.

- [ ] **Step 3: Run local checks**

Run:

```bash
git diff --check
node --test src/launcher/launcher.test.mjs
npm run verify:package-boundary
npm run smoke:artifact
npm run smoke:release
```

Expected: all pass.

- [ ] **Step 4: Commit and push**

Commit the README redesign and push to `main`. Then watch the latest GitHub CI, CodeQL, and Scorecard runs.
