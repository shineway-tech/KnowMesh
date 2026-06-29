import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { buildExportPackagePreview, previewImportPackage } from "./package-manifest.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("export package preview builds a redacted manifest with artifact checksums", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-package-export-"));
  try {
    const state = { userDataRoot };
    const knowledgeBase = createKnowledgeBase(state, {
      id: "kb-package",
      name: "Package KB",
      template: "general-docs"
    });
    const db = new Database(catalogDatabasePath(state, knowledgeBase.id));
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, summary_json, created_at, updated_at)
        VALUES ('build-package', 'completed', 1, '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
        VALUES ('release-package', 'build-package', 'active', 'manifests/active-manifest.json', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO artifact_registry (
          artifact_id, owner_type, owner_id, artifact_type, relative_path,
          content_hash, size_bytes, media_type, metadata_json, created_at, updated_at
        ) VALUES ('artifact-package', 'job', 'job-package', 'activeManifest', 'manifests/active-manifest.json',
          'sha256-package', 123, 'application/json', '{}', ?, ?)
      `).run(now, now);
    } finally {
      db.close();
    }

    const preview = buildExportPackagePreview(state);
    const serialized = JSON.stringify(preview);

    assert.equal(preview.kind, "knowmesh.packageExportPreview");
    assert.equal(preview.ok, true);
    assert.equal(preview.packageManifest.kind, "knowmesh.packageManifest");
    assert.equal(preview.packageManifest.formatVersion, "1.0.0");
    assert.equal(preview.packageManifest.knowledgeBase.id, "kb-package");
    assert.equal(preview.packageManifest.artifacts.summary.total, 1);
    assert.equal(preview.packageManifest.artifacts.items[0].contentHash, "sha256-package");
    assert.equal(preview.packageManifest.integrity.algorithm, "sha256");
    assert.match(preview.packageManifest.integrity.manifestHash, /^[a-f0-9]{64}$/);
    assert.equal(preview.exportPlan.executionEnabled, false);
    assert.doesNotMatch(serialized, /documentText|rawText|sourceContent value|apiKey|secret/i);
  } finally {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("import package preview validates format and reports knowledge-base conflicts without writing", () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-package-import-"));
  try {
    const state = { userDataRoot };
    createKnowledgeBase(state, {
      id: "kb-existing",
      name: "Existing KB",
      template: "general-docs"
    });

    const preview = previewImportPackage(state, {
      manifest: {
        kind: "knowmesh.packageManifest",
        formatVersion: "1.0.0",
        knowledgeBase: {
          id: "kb-existing",
          name: "Existing KB",
          template: "general-docs"
        },
        privacy: {
          redacted: true,
          excludes: ["providerTokens", "sourceContent", "documentText"]
        },
        artifacts: {
          summary: { total: 0, sizeBytes: 0, byType: {} },
          items: []
        },
        integrity: {
          algorithm: "sha256",
          manifestHash: "0".repeat(64)
        }
      }
    });

    assert.equal(preview.kind, "knowmesh.packageImportPreview");
    assert.equal(preview.ok, true);
    assert.equal(preview.summary.status, "attention");
    assert.ok(preview.checks.some((item) => item.key === "knowledgeBaseConflict" && item.status === "warn"));
    assert.equal(preview.importPlan.executionEnabled, false);
    assert.equal(preview.importPlan.writes.length, 0);
  } finally {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});
