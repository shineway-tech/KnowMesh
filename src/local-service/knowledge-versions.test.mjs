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
  assert.equal(diff.comparison.write.records.delta, -20);
  assert.equal(diff.comparison.evaluation.failed.delta, 1);
  assert.deepEqual(diff.changes.map((item) => item.key), ["documents", "write", "evaluation", "target", "sidecar"]);
  assert.doesNotMatch(JSON.stringify(diff), /敏感正文|SECRET|rawText/);
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
      documents: { included: 10, excluded: 1, attention: 0 },
      write: { records: 120, failed: 0 },
      evaluation: { passed: 14, failed: 0 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "active-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://active/manifest.json", chunks: 120 },
      rawText: "敏感正文 SECRET"
    }), "2026-06-29T08:00:00.000Z", "2026-06-29T09:00:00.000Z");
    insertRelease.run("release-active", "build-active", "active", "/workspace/build-active/manifests/active.json", JSON.stringify({
      documents: { included: 10, excluded: 1, attention: 0 },
      write: { records: 120, failed: 0 },
      evaluation: { passed: 14, failed: 0 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "active-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://active/manifest.json", chunks: 120 },
      notes: "敏感正文 SECRET"
    }), "2026-06-29T08:10:00.000Z", "2026-06-29T09:10:00.000Z");
    insertBuild.run("build-previous", "published", 0, JSON.stringify({
      datasetVersionId: "build-previous",
      documents: { included: 8, excluded: 2, attention: 1 },
      write: { records: 100, failed: 1 },
      evaluation: { passed: 12, failed: 1 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "previous-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://previous/manifest.json", chunks: 100 },
      rawText: "敏感正文 SECRET"
    }), "2026-06-28T08:00:00.000Z", "2026-06-28T09:00:00.000Z");
    insertRelease.run("release-previous", "build-previous", "published", "/workspace/build-previous/manifests/active.json", JSON.stringify({
      documents: { included: 8, excluded: 2, attention: 1 },
      write: { records: 100, failed: 1 },
      evaluation: { passed: 12, failed: 1 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "previous-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://previous/manifest.json", chunks: 100 },
      notes: "敏感正文 SECRET"
    }), "2026-06-28T08:10:00.000Z", "2026-06-28T09:10:00.000Z");
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
