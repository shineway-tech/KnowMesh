import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { architectureFoundationStatus } from "./architecture-foundation.mjs";
import { createKnowledgeBase, listKnowledgeBases, touchKnowledgeBaseById } from "./knowledge-bases.mjs";
import { catalogDatabasePath, workspaceDatabasePath } from "./storage.mjs";

const k12KnowledgeBaseId = "kb-k12-all-subjects";
const expectedManifestKeys = ["source", "extraction", "structure", "chunk", "index", "version"];

test("architecture foundation status keeps fresh installs SQLite-first without implicit default KB", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-foundation-fresh-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };

  const status = architectureFoundationStatus(state);
  const registry = listKnowledgeBases(state);

  assert.equal(status.ok, true);
  assert.equal(status.kind, "knowmesh.architectureFoundation");
  assert.equal(status.phase, "phase1-architecture-foundation");
  assert.equal(status.summary.knowledgeBases, 0);
  assert.equal(status.summary.currentKnowledgeBase, "");
  assert.equal(status.stateStores.jsonStateRuntime, false);
  assert.deepEqual(status.stateStores.primary, ["workspace.sqlite", "catalog.sqlite"]);
  assert.equal(registry.current, null);
  assert.deepEqual(registry.items, []);
  assert.equal(fs.existsSync(workspaceDatabasePath(state)), true);
  assert.equal(fs.existsSync(path.join(state.userDataRoot, "knowledge-bases", "default")), false);
  assert.equal(findCheck(status, "noImplicitDefault").status, "pass");
  assert.equal(findCheck(status, "currentKnowledgeBase").status, "warn");
  assert.equal(findCheck(status, "workspaceSqlite").status, "pass");
  assert.equal(findCheck(status, "jsonStateRuntime").status, "pass");
  assert.deepEqual(status.phase2.manifests.map((item) => item.key), expectedManifestKeys);
  assert.equal(status.phase2.summary.readyManifests, 0);
});

test("architecture foundation status proves K12 migration preservation and Phase 2 manifest readiness from catalog.sqlite", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-foundation-k12-"));
  const userDataRoot = path.join(temp, "user-data");
  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const sourceRoot = path.join(temp, "ChinaTextbook");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const kb = createKnowledgeBase(state, { id: k12KnowledgeBaseId, name: "K12全科知识库", template: "textbook-cn-k12" });
  touchKnowledgeBaseById(state, kb.id, {
    status: "active",
    mode: "local",
    sourceRoot,
    workspaceRoot,
    latestJobId: "job-k12-foundation",
    latestJobStatus: "completed",
    setupSummary: { finished: true, completedSteps: ["source", "workspace", "retrieval-policy"] },
    taskSummary: { total: 7, completed: 7 }
  });
  writeReadyCatalogFixture(userDataRoot, kb.id);

  const legacyPaths = [
    path.join(userDataRoot, "knowledge-bases.json"),
    path.join(userDataRoot, "setup-state.json"),
    path.join(userDataRoot, "jobs-state.json"),
    path.join(userDataRoot, "knowledge-bases", "default"),
    path.join(userDataRoot, "knowledge-bases", kb.id, "setup-state.json"),
    path.join(userDataRoot, "knowledge-bases", kb.id, "jobs-state.json")
  ];
  for (const legacyPath of legacyPaths) assert.equal(fs.existsSync(legacyPath), false, legacyPath);

  const status = architectureFoundationStatus(state);

  assert.equal(status.ok, true);
  assert.equal(status.summary.currentKnowledgeBase, k12KnowledgeBaseId);
  assert.equal(status.knowledgeBase.id, k12KnowledgeBaseId);
  assert.equal(status.knowledgeBase.catalog, catalogDatabasePath(state, k12KnowledgeBaseId));
  assert.equal(status.k12Migration.preserved, true);
  assert.equal(status.k12Migration.legacyJsonClean, true);
  assert.equal(status.k12Migration.sourceRoot, sourceRoot);
  assert.equal(status.k12Migration.workspaceRoot, workspaceRoot);
  assert.equal(findCheck(status, "catalogSqlite").status, "pass");
  assert.equal(findCheck(status, "sqliteState").status, "pass");
  assert.equal(findCheck(status, "legacyJsonState").status, "pass");
  assert.equal(findCheck(status, "artifactBoundary").status, "pass");
  assert.equal(status.phase2.summary.readyManifests, expectedManifestKeys.length);
  assert.deepEqual(status.phase2.manifests.map((item) => item.key), expectedManifestKeys);
  assert.ok(status.phase2.manifests.every((item) => item.status === "ready"));
  assert.deepEqual(status.stateStores.jsonAllowedFor, ["exports", "audit", "sidecars", "credentials", "checkpoints"]);
});

function writeReadyCatalogFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO setup_state (id, draft_json, updated_at)
        VALUES (1, ?, ?)
      `).run(JSON.stringify({ "setup.finished": true, "project.template": "textbook-cn-k12" }), now);
      db.prepare(`
        INSERT INTO jobs (job_id, status, mode, template, summary_json, progress_json, job_json, created_at, updated_at)
        VALUES (?, 'completed', 'local', 'textbook-cn-k12', ?, '{}', ?, ?, ?)
      `).run(
        "job-k12-foundation",
        JSON.stringify({ sourceRoot: "fixture-source", workspaceRoot: "fixture-workspace" }),
        JSON.stringify({ id: "job-k12-foundation", status: "completed" }),
        now,
        now
      );
      db.prepare(`
        INSERT INTO task_steps (job_id, step_key, sort_order, status, label_json, message_json, updated_at)
        VALUES ('job-k12-foundation', 'publish', 1, 'completed', '{}', '{}', ?)
      `).run(now);
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12', 'K12 fixture', 'pdf', 'source.pdf', 'source.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO document_versions (
          version_id, document_id, display_version, content_hash, artifact_path, status, metadata_json, created_at, updated_at
        ) VALUES ('ver-k12', 'doc-k12', 'v1.0.0', 'sha-ver', 'artifacts/sources/source.pdf', 'active', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-k12', 'doc-k12', 'ver-k12', 1, 'artifacts/pages/page-1.json', 'sha-page', 'completed', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('block-k12', 'page-k12', 'doc-k12', 'paragraph', 1, 'artifacts/markdown/block-k12.md', 'sha-block', 'Unit 1/Lesson 1', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO structure_nodes (node_id, document_id, node_type, title, sort_order, path, metadata_json, created_at, updated_at)
        VALUES ('node-k12', 'doc-k12', 'lesson', 'Lesson 1', 1, 'Unit 1/Lesson 1', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO knowledge_objects (object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at)
        VALUES ('object-k12', 'doc-k12', 'node-k12', 'lesson', 'Lesson 1', 1, 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO chunks (
          chunk_id, document_id, object_id, block_id, structure_node_id, text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('chunk-k12', 'doc-k12', 'object-k12', 'block-k12', 'node-k12', 'artifacts/markdown/chunk-k12.md', 'sha-chunk', 64, 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO citations (
          citation_id, chunk_id, document_id, page_id, block_id, structure_node_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
        ) VALUES ('citation-k12', 'chunk-k12', 'doc-k12', 'page-k12', 'block-k12', 'node-k12', 'K12 fixture', 1, 'p1', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO index_records (
          record_id, chunk_id, provider, index_name, status, vector_id, keyword_key, structure_key, metadata_json, created_at, updated_at
        ) VALUES ('index-k12', 'chunk-k12', 'local', 'catalog-local', 'written', 'vector-k12', 'keyword-k12', 'structure-k12', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-k12', 'active', 1, '', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
        VALUES ('release-k12', 'build-k12', 'active', 'published/oss-sidecar/manifest.json', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO artifact_registry (
          artifact_id, owner_type, owner_id, artifact_type, relative_path, content_hash, size_bytes, media_type, metadata_json, created_at, updated_at
        ) VALUES ('artifact-k12', 'document', 'doc-k12', 'source', 'artifacts/sources/source.pdf', 'sha-artifact', 42, 'application/pdf', '{}', ?, ?)
      `).run(now, now);
    });
    write();
  } finally {
    db.close();
  }
}

function findCheck(status, key) {
  const found = status.checks.find((item) => item.key === key);
  assert.ok(found, `Missing check ${key}`);
  return found;
}
