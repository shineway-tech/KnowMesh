import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import {
  knowledgeBaseVersionDiff,
  knowledgeBaseVersions,
  previewKnowledgeBaseRollback,
  rollbackKnowledgeBaseVersion
} from "./knowledge-versions.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("version records aggregate one publish summary per build from catalog sqlite", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-catalog-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const knowledgeBase = createKnowledgeBase(state, { name: "发布一致性测试库", template: "general-docs" });
  const staleManifestPath = path.join(temp, "workspace", "versions", "build-active", "manifests", "active-manifest.json");
  fs.mkdirSync(path.dirname(staleManifestPath), { recursive: true });
  fs.writeFileSync(staleManifestPath, JSON.stringify({
    kind: "knowmesh.activeManifest",
    datasetVersionId: "build-active",
    status: "active",
    target: { indexName: "stale-file-index" },
    sidecar: { manifestUri: "oss://stale-file/sidecar/manifest.json" }
  }, null, 2), "utf8");

  const db = new Database(catalogDatabasePath(state, knowledgeBase.id));
  try {
    const insertBuild = db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?)
    `);
    const insertRelease = db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertBuild.run("build-active", "active", 1, JSON.stringify({
      datasetVersionId: "build-active",
      target: { indexName: "build-summary-index" },
      sidecar: null
    }), "2026-06-29T08:00:00.000Z", "2026-06-29T09:00:00.000Z");
    insertBuild.run("build-draft", "draft", 0, JSON.stringify({
      datasetVersionId: "build-draft",
      target: { indexName: "draft-build-index" },
      sidecar: null
    }), "2026-06-29T07:00:00.000Z", "2026-06-29T07:30:00.000Z");
    insertRelease.run("build-active:draft", "build-active", "draft", staleManifestPath, JSON.stringify({
      datasetVersionId: "build-active",
      target: { indexName: "stale-draft-release-index" },
      sidecar: { manifestUri: "oss://stale-draft/sidecar/manifest.json" }
    }), "2026-06-29T08:10:00.000Z", "2026-06-29T10:00:00.000Z");
    insertRelease.run("build-active:active", "build-active", "active", staleManifestPath, JSON.stringify({
      datasetVersionId: "build-active",
      target: { indexName: "catalog-active-index" },
      sidecar: {
        authoritativeStore: "oss-sidecar",
        manifestUri: "oss://catalog-active/sidecar/manifest.json",
        chunks: 42
      }
    }), "2026-06-29T08:20:00.000Z", "2026-06-29T08:40:00.000Z");
    insertRelease.run("build-draft:draft", "build-draft", "draft", "", JSON.stringify({
      datasetVersionId: "build-draft",
      target: { indexName: "draft-release-index" },
      sidecar: null
    }), "2026-06-29T07:10:00.000Z", "2026-06-29T07:20:00.000Z");
  } finally {
    db.close();
  }

  const records = knowledgeBaseVersions(state, { limit: 10 });

  assert.equal(records.ok, true);
  assert.equal(records.summary.total, 2);
  assert.equal(records.summary.active, "build-active");
  assert.deepEqual(records.versions.map((item) => item.id), ["build-active", "build-draft"]);
  const active = records.versions[0];
  assert.equal(active.buildId, "build-active");
  assert.equal(active.status, "active");
  assert.equal(active.target.indexName, "catalog-active-index");
  assert.equal(active.sidecar.status, "ready");
  assert.equal(active.sidecar.manifestUri, "oss://catalog-active/sidecar/manifest.json");
  assert.equal(active.sidecar.chunks, 42);
});

test("version diff compares catalog release summaries without leaking build text", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-diff-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const knowledgeBase = createKnowledgeBase(state, { name: "版本差异测试库", template: "general-docs" });
  seedVersionRows(state, knowledgeBase.id);

  const diff = knowledgeBaseVersionDiff(state, {
    baseBuildId: "build-active",
    targetBuildId: "build-previous"
  });

  assert.equal(diff.ok, true);
  assert.equal(diff.kind, "knowmesh.versionDiff");
  assert.equal(diff.summary.baseBuildId, "build-active");
  assert.equal(diff.summary.targetBuildId, "build-previous");
  assert.equal(diff.comparison.documents.included.base, 10);
  assert.equal(diff.comparison.documents.included.target, 8);
  assert.equal(diff.comparison.documents.included.delta, -2);
  assert.equal(diff.comparison.extraction.failed.delta, 2);
  assert.equal(diff.comparison.structure.objects.delta, -5);
  assert.equal(diff.comparison.chunks.queryable.delta, -10);
  assert.equal(diff.comparison.index.written.delta, -15);
  assert.equal(diff.comparison.write.records.delta, -20);
  assert.equal(diff.comparison.evaluation.failed.delta, 1);
  assert.equal(diff.comparison.gates.status.changed, true);
  assert.equal(diff.comparison.queryFeedback.open.delta, 3);
  assert.deepEqual(diff.changes.map((item) => item.key), [
    "documents",
    "extraction",
    "structure",
    "chunks",
    "index",
    "write",
    "evaluation",
    "gates",
    "queryFeedback",
    "target",
    "sidecar"
  ]);
  assert.doesNotMatch(JSON.stringify(diff), /敏感正文|SECRET|rawText/);
  assert.doesNotMatch(JSON.stringify(diff), /原始反馈问题|rawQuestion/);
});

test("version rollback preview and confirmation switch active release transactionally", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-rollback-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const knowledgeBase = createKnowledgeBase(state, { name: "版本回滚测试库", template: "general-docs" });
  seedVersionRows(state, knowledgeBase.id);

  const preview = previewKnowledgeBaseRollback(state, { targetBuildId: "build-previous" });
  assert.equal(preview.ok, true);
  assert.equal(preview.requiresConfirmation, true);
  assert.equal(preview.currentBuildId, "build-active");
  assert.equal(preview.targetBuildId, "build-previous");
  assert.equal(preview.diff.summary.targetBuildId, "build-previous");

  const rejected = rollbackKnowledgeBaseVersion(state, { targetBuildId: "build-previous" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "CONFIRMATION_REQUIRED");

  const rollback = rollbackKnowledgeBaseVersion(state, { targetBuildId: "build-previous", confirm: true });
  assert.equal(rollback.ok, true);
  assert.equal(rollback.activatedBuildId, "build-previous");
  assert.equal(rollback.previousActiveBuildId, "build-active");
  assert.equal(readBuildActive(state, knowledgeBase.id, "build-active"), 0);
  assert.equal(readBuildActive(state, knowledgeBase.id, "build-previous"), 1);
  assert.equal(readReleaseStatus(state, knowledgeBase.id, "release-active"), "published");
  assert.equal(readReleaseStatus(state, knowledgeBase.id, "release-previous"), "active");
  assert.match(JSON.stringify(readBuildSummary(state, knowledgeBase.id, "build-previous")), /rollback/);
});

test("version rollback accepts local catalog-backed releases without OSS sidecar", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-local-rollback-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const knowledgeBase = createKnowledgeBase(state, { name: "本地版本回滚测试库", template: "general-docs" });
  seedLocalCatalogVersionRows(state, knowledgeBase.id, { chunks: 3 });

  const records = knowledgeBaseVersions(state, { limit: 10 });
  assert.equal(records.summary.sidecarReady, 2);
  assert.equal(records.versions.find((item) => item.id === "build-local-previous").sidecar.store, "catalog.sqlite");
  assert.equal(records.versions.find((item) => item.id === "build-local-previous").rollbackReady, true);

  const preview = previewKnowledgeBaseRollback(state, { targetBuildId: "build-local-previous" });
  assert.equal(preview.ok, true);
  assert.match(preview.checks[0].message.en, /catalog\.sqlite/);

  const rollback = rollbackKnowledgeBaseVersion(state, { targetBuildId: "build-local-previous", confirm: true });
  assert.equal(rollback.ok, true);
  assert.equal(rollback.activatedBuildId, "build-local-previous");
  assert.equal(readBuildActive(state, knowledgeBase.id, "build-local-active"), 0);
  assert.equal(readBuildActive(state, knowledgeBase.id, "build-local-previous"), 1);
});

test("version rollback refuses local releases without catalog trace records", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-local-rollback-block-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const knowledgeBase = createKnowledgeBase(state, { name: "本地版本回滚拦截测试库", template: "general-docs" });
  seedLocalCatalogVersionRows(state, knowledgeBase.id, { indexRecords: 0 });

  const preview = previewKnowledgeBaseRollback(state, { targetBuildId: "build-local-previous" });
  assert.equal(preview.ok, false);
  assert.equal(preview.error.code, "TARGET_RELEASE_NOT_ACTIVATABLE");
  assert.equal(preview.error.reason, "missing-catalog-records");
});

test("version rollback refuses draft or incomplete releases before confirmation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-rollback-block-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const knowledgeBase = createKnowledgeBase(state, { name: "版本回滚拦截测试库", template: "general-docs" });
  seedVersionRows(state, knowledgeBase.id);
  seedDraftVersionRow(state, knowledgeBase.id);

  const preview = previewKnowledgeBaseRollback(state, { targetBuildId: "build-draft" });
  assert.equal(preview.ok, false);
  assert.equal(preview.kind, "knowmesh.versionRollbackPreview");
  assert.equal(preview.error.code, "TARGET_RELEASE_NOT_ACTIVATABLE");
  assert.match(preview.error.message, /not ready/i);

  const rollback = rollbackKnowledgeBaseVersion(state, { targetBuildId: "build-draft", confirm: true });
  assert.equal(rollback.ok, false);
  assert.equal(rollback.error.code, "TARGET_RELEASE_NOT_ACTIVATABLE");
  assert.equal(readBuildActive(state, knowledgeBase.id, "build-active"), 1);
  assert.equal(readBuildActive(state, knowledgeBase.id, "build-draft"), 0);
});

function seedVersionRows(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const insertBuild = db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?)
    `);
    const insertRelease = db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertBuild.run("build-active", "active", 1, JSON.stringify({
      datasetVersionId: "build-active",
      documents: { included: 10, excluded: 1, attention: 0, pages: 30 },
      extraction: { pages: 30, blocks: 120, failed: 0 },
      structure: { nodes: 24, objects: 42, relations: 18, orphanObjects: 0 },
      chunks: { total: 120, queryable: 112, unlinked: 2 },
      index: { records: 120, written: 115, failed: 0, stale: 0 },
      write: { records: 120, failed: 0 },
      evaluation: { passed: 14, failed: 0, review: 1, coveragePercent: 96, passRate: 100 },
      gates: { status: "pass", coveragePercent: 96, passRate: 100, requiredCases: 14, missingCases: 0 },
      queryFeedback: { open: 1, resolved: 4, negative: 1, positive: 7 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "active-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://active/manifest.json", chunks: 120 },
      rawText: "敏感正文 SECRET"
    }), "2026-06-29T08:00:00.000Z", "2026-06-29T09:00:00.000Z");
    insertRelease.run("release-active", "build-active", "active", "/workspace/build-active/manifests/active.json", JSON.stringify({
      documents: { included: 10, excluded: 1, attention: 0, pages: 30 },
      extraction: { pages: 30, blocks: 120, failed: 0 },
      structure: { nodes: 24, objects: 42, relations: 18, orphanObjects: 0 },
      chunks: { total: 120, queryable: 112, unlinked: 2 },
      index: { records: 120, written: 115, failed: 0, stale: 0 },
      write: { records: 120, failed: 0 },
      evaluation: { passed: 14, failed: 0, review: 1, coveragePercent: 96, passRate: 100 },
      gates: { status: "pass", coveragePercent: 96, passRate: 100, requiredCases: 14, missingCases: 0 },
      queryFeedback: { open: 1, resolved: 4, negative: 1, positive: 7 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "active-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://active/manifest.json", chunks: 120 },
      notes: "敏感正文 SECRET"
    }), "2026-06-29T08:10:00.000Z", "2026-06-29T09:10:00.000Z");
    insertBuild.run("build-previous", "published", 0, JSON.stringify({
      datasetVersionId: "build-previous",
      documents: { included: 8, excluded: 2, attention: 1, pages: 28 },
      extraction: { pages: 28, blocks: 112, failed: 2 },
      structure: { nodes: 21, objects: 37, relations: 15, orphanObjects: 2 },
      chunks: { total: 105, queryable: 102, unlinked: 5 },
      index: { records: 105, written: 100, failed: 1, stale: 2 },
      write: { records: 100, failed: 1 },
      evaluation: { passed: 12, failed: 1, review: 2, coveragePercent: 88, passRate: 92 },
      gates: { status: "fail", coveragePercent: 88, passRate: 92, requiredCases: 14, missingCases: 1 },
      queryFeedback: { open: 4, resolved: 1, negative: 3, positive: 2, rawQuestion: "原始反馈问题 SECRET" },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "previous-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://previous/manifest.json", chunks: 100 },
      rawText: "敏感正文 SECRET"
    }), "2026-06-28T08:00:00.000Z", "2026-06-28T09:00:00.000Z");
    insertRelease.run("release-previous", "build-previous", "published", "/workspace/build-previous/manifests/active.json", JSON.stringify({
      documents: { included: 8, excluded: 2, attention: 1, pages: 28 },
      extraction: { pages: 28, blocks: 112, failed: 2 },
      structure: { nodes: 21, objects: 37, relations: 15, orphanObjects: 2 },
      chunks: { total: 105, queryable: 102, unlinked: 5 },
      index: { records: 105, written: 100, failed: 1, stale: 2 },
      write: { records: 100, failed: 1 },
      evaluation: { passed: 12, failed: 1, review: 2, coveragePercent: 88, passRate: 92 },
      gates: { status: "fail", coveragePercent: 88, passRate: 92, requiredCases: 14, missingCases: 1 },
      queryFeedback: { open: 4, resolved: 1, negative: 3, positive: 2, rawQuestion: "原始反馈问题 SECRET" },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "previous-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://previous/manifest.json", chunks: 100 },
      notes: "敏感正文 SECRET"
    }), "2026-06-28T08:10:00.000Z", "2026-06-28T09:10:00.000Z");
  } finally {
    db.close();
  }
}

function seedDraftVersionRow(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES ('build-draft', 'draft', 0, '', ?, '2026-06-27T08:00:00.000Z', '2026-06-27T09:00:00.000Z')
    `).run(JSON.stringify({
      datasetVersionId: "build-draft",
      documents: { included: 4, excluded: 0, attention: 2 },
      sidecar: null
    }));
    db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES ('release-draft', 'build-draft', 'draft', '', ?, '2026-06-27T08:10:00.000Z', '2026-06-27T08:30:00.000Z')
    `).run(JSON.stringify({
      documents: { included: 4, excluded: 0, attention: 2 },
      sidecar: null
    }));
  } finally {
    db.close();
  }
}

function seedLocalCatalogVersionRows(state, knowledgeBaseId, options = {}) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const insertBuild = db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?)
    `);
    const insertRelease = db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const activeSummary = {
      datasetVersionId: "build-local-active",
      target: { provider: "local" },
      write: { records: 3, failed: 0 },
      index: { written: 3, failed: 0 },
      sidecar: null
    };
    const previousSummary = {
      datasetVersionId: "build-local-previous",
      target: { provider: "local" },
      write: { records: 3, failed: 0 },
      index: { written: 3, failed: 0 },
      sidecar: null
    };
    insertBuild.run("build-local-active", "active", 1, JSON.stringify(activeSummary), "2026-06-29T10:00:00.000Z", "2026-06-29T10:30:00.000Z");
    insertRelease.run("release-local-active", "build-local-active", "active", "/workspace/build-local-active/manifests/active.json", JSON.stringify(activeSummary), "2026-06-29T10:01:00.000Z", "2026-06-29T10:31:00.000Z");
    insertBuild.run("build-local-previous", "published", 0, JSON.stringify(previousSummary), "2026-06-29T09:00:00.000Z", "2026-06-29T09:30:00.000Z");
    insertRelease.run("release-local-previous", "build-local-previous", "published", "/workspace/build-local-previous/manifests/active.json", JSON.stringify(previousSummary), "2026-06-29T09:01:00.000Z", "2026-06-29T09:31:00.000Z");

    if (Number(options.chunks || 0) > 0) {
      const now = "2026-06-29T10:40:00.000Z";
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('local-doc', 'Local document', 'text', '/source/local.txt', 'local.txt', 'sha-local', 'test', 'included', 'primary', '{}', ?, ?)
      `).run(now, now);
    }
    const insertChunk = db.prepare(`
      INSERT INTO chunks (chunk_id, document_id, text_hash, token_count, quality_state, metadata_json, created_at, updated_at)
      VALUES (?, 'local-doc', ?, 4, 'primary', ?, ?, ?)
    `);
    const chunkCount = Number(options.chunks || 0);
    for (let index = 0; index < chunkCount; index += 1) {
      const now = `2026-06-29T10:4${index}:00.000Z`;
      insertChunk.run(`local-chunk-${index}`, `sha-chunk-${index}`, JSON.stringify({ text: `Local chunk ${index}` }), now, now);
    }

    const insertIndex = db.prepare(`
      INSERT INTO index_records (record_id, chunk_id, provider, index_name, status, vector_id, keyword_key, structure_key, metadata_json, created_at, updated_at)
      VALUES (?, NULL, 'local', 'catalog', 'written', ?, ?, ?, '{}', ?, ?)
    `);
    const count = Number(options.indexRecords || 0);
    for (let index = 0; index < count; index += 1) {
      const now = `2026-06-29T10:4${index}:00.000Z`;
      insertIndex.run(`local-index-${index}`, `vec-${index}`, `kw-${index}`, `structure-${index}`, now, now);
    }
  } finally {
    db.close();
  }
}

function readBuildActive(state, knowledgeBaseId, buildId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return db.prepare("SELECT active FROM build_versions WHERE build_id = ?").get(buildId).active;
  } finally {
    db.close();
  }
}

function readBuildSummary(state, knowledgeBaseId, buildId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return JSON.parse(db.prepare("SELECT summary_json FROM build_versions WHERE build_id = ?").get(buildId).summary_json);
  } finally {
    db.close();
  }
}

function readReleaseStatus(state, knowledgeBaseId, releaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return db.prepare("SELECT status FROM release_manifests WHERE release_id = ?").get(releaseId).status;
  } finally {
    db.close();
  }
}
