import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { publishBuildVersion, publishBuildVersionToCatalog } from "./build-version-publisher.mjs";

test("build version publisher validates quality gates before activating a manifest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-publisher-block-"));
  const draftPath = path.join(root, "manifests", "draft-active-manifest.json");
  const activePath = path.join(root, "manifests", "active-manifest.json");

  assert.throws(() => publishBuildVersion({
    draftManifestPath: draftPath,
    activeManifestPath: activePath,
    manifest: manifestFixture({ reviewRecords: 2 }),
    qualityGates: { allowReviewRecords: false }
  }), /quality gate/i);

  assert.equal(fs.existsSync(activePath), false);
  assert.equal(fs.existsSync(draftPath), true);
  const draft = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  assert.equal(draft.status, "draft");
});

test("build version publisher writes draft release then activates atomically after gates pass", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-publisher-pass-"));
  const draftPath = path.join(root, "manifests", "draft-active-manifest.json");
  const activePath = path.join(root, "manifests", "active-manifest.json");

  const result = publishBuildVersion({
    draftManifestPath: draftPath,
    activeManifestPath: activePath,
    manifest: manifestFixture({ reviewRecords: 0 }),
    qualityGates: { allowReviewRecords: false }
  });

  assert.equal(result.ok, true);
  assert.equal(result.draftManifestPath, draftPath);
  assert.equal(result.activeManifestPath, activePath);
  const active = JSON.parse(fs.readFileSync(activePath, "utf8"));
  assert.equal(active.status, "active");
  assert.ok(active.activatedAt);
  assert.equal(active.quality.reviewRecords, 0);
});

test("catalog publisher keeps previous active release intact when gates fail", () => {
  const db = buildCatalogDb();
  seedActiveRelease(db);

  assert.throws(() => publishBuildVersionToCatalog(db, {
    buildId: "build-new",
    releaseId: "release-new",
    manifestPath: "published/new.json",
    manifest: manifestFixture({ activeRecords: 0, reviewRecords: 0 }),
    buildSummary: { name: "new" },
    releaseSummary: { name: "new" },
    qualityGates: { requireActiveRecords: true }
  }), /quality gate/i);

  assert.equal(db.prepare("SELECT active FROM build_versions WHERE build_id = 'build-active'").get().active, 1);
  assert.equal(db.prepare("SELECT status FROM release_manifests WHERE release_id = 'release-active'").get().status, "active");
  assert.equal(db.prepare("SELECT active FROM build_versions WHERE build_id = 'build-new'").get().active, 0);
  assert.equal(db.prepare("SELECT status FROM release_manifests WHERE release_id = 'release-new'").get().status, "draft");
});

test("catalog publisher accepts legacy active manifests that do not yet carry quality counters", () => {
  const db = buildCatalogDb();
  seedActiveRelease(db);

  const result = publishBuildVersionToCatalog(db, {
    buildId: "build-legacy-active",
    releaseId: "release-legacy-active",
    manifestPath: "published/legacy.json",
    manifest: {
      status: "active",
      target: { provider: "aliyun-vector", bucket: "vector", index: "legacy" }
    },
    buildSummary: { target: { provider: "aliyun-vector" } },
    releaseSummary: { target: { provider: "aliyun-vector" } },
    qualityGates: { requireActiveRecords: true }
  });

  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT active FROM build_versions WHERE build_id = 'build-legacy-active'").get().active, 1);
});

test("catalog publisher activates a passing release in one transaction", () => {
  const db = buildCatalogDb();
  seedActiveRelease(db);

  const result = publishBuildVersionToCatalog(db, {
    buildId: "build-new",
    releaseId: "release-new",
    manifestPath: "published/new.json",
    manifest: manifestFixture({ activeRecords: 2, reviewRecords: 0 }),
    buildSummary: { name: "new" },
    releaseSummary: { name: "new" },
    qualityGates: { requireActiveRecords: true }
  });

  assert.equal(result.ok, true);
  assert.equal(db.prepare("SELECT active FROM build_versions WHERE build_id = 'build-active'").get().active, 0);
  assert.equal(db.prepare("SELECT status FROM release_manifests WHERE release_id = 'release-active'").get().status, "published");
  assert.equal(db.prepare("SELECT active FROM build_versions WHERE build_id = 'build-new'").get().active, 1);
  assert.equal(db.prepare("SELECT status FROM release_manifests WHERE release_id = 'release-new'").get().status, "active");
});

function manifestFixture(quality = {}) {
  return {
    kind: "knowmesh.activeManifest",
    apiVersion: "v1",
    status: "pending",
    datasetVersionId: "build-test",
    quality: {
      totalRecords: 2,
      activeRecords: quality.activeRecords ?? 2,
      reviewRecords: quality.reviewRecords ?? 0,
      archiveRecords: quality.archiveRecords ?? 0
    },
    activeVersions: [{ document_id: "doc-1", lifecycle: "active" }]
  };
}

function buildCatalogDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE build_versions (
      build_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      parent_build_id TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE release_manifests (
      release_id TEXT PRIMARY KEY,
      build_id TEXT NOT NULL,
      status TEXT NOT NULL,
      manifest_path TEXT NOT NULL,
      summary_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (build_id) REFERENCES build_versions(build_id) ON DELETE CASCADE
    );
  `);
  return db;
}

function seedActiveRelease(db) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
    VALUES ('build-active', 'active', 1, '', '{}', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
    VALUES ('release-active', 'build-active', 'active', 'published/active.json', '{}', ?, ?)
  `).run(now, now);
}
