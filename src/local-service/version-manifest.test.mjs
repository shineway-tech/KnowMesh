import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { readVersionManifestFromCatalog } from "./version-manifest.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("version manifest summarizes active releases and rollback candidates without leaking build summary text", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-manifest-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, ".knowmesh") };
  const kb = createKnowledgeBase(state, { name: "Version Manifest", template: "general-docs" });
  writeVersionFixtures(state, kb.id);

  const manifest = readVersionManifestFromCatalog(state);

  assert.equal(manifest.ok, true);
  assert.equal(manifest.kind, "knowmesh.versionManifest");
  assert.equal(manifest.knowledgeBase.id, kb.id);
  assert.equal(manifest.summary.status, "ready");
  assert.equal(manifest.summary.builds, 3);
  assert.equal(manifest.summary.releases, 2);
  assert.equal(manifest.summary.activeBuildId, "build-active");
  assert.equal(manifest.summary.rollbackCandidates, 1);
  assert.deepEqual(manifest.summary.byStatus, { active: 1, draft: 1, failed: 1 });
  assert.deepEqual(manifest.versions.map((version) => version.buildId), ["build-active", "build-draft", "build-failed"]);
  assert.equal(manifest.versions[0].release.status, "active");
  assert.equal(manifest.versions[1].release, null);
  assert.doesNotMatch(JSON.stringify(manifest), /private source excerpt/);
  assert.doesNotMatch(JSON.stringify(manifest), /sk-test/);
});

function writeVersionFixtures(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const insertBuild = db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRelease = db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertBuild.run("build-active", "active", 1, "build-failed", JSON.stringify({
      privateText: "private source excerpt",
      credential: "sk-test",
      quality: { passed: true },
      target: { index: "active-index" }
    }), now, now);
    insertRelease.run("release-active", "build-active", "active", "published/active-manifest.json", JSON.stringify({
      privateText: "private source excerpt"
    }), now, now);
    insertBuild.run("build-draft", "draft", 0, "build-active", JSON.stringify({
      privateText: "private source excerpt"
    }), now, now);
    insertBuild.run("build-failed", "failed", 0, "", JSON.stringify({
      privateText: "private source excerpt"
    }), now, now);
    insertRelease.run("release-failed", "build-failed", "failed", "published/failed-manifest.json", "{}", now, now);
  } finally {
    db.close();
  }
}
