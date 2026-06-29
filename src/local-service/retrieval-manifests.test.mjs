import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { readChunkManifestFromCatalog, readIndexManifestFromCatalog } from "./retrieval-manifests.mjs";
import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("chunk and index manifests summarize catalog retrieval state without leaking text", () => {
  const { state, workspaceRoot } = tempState("knowmesh-retrieval-manifest-");
  const kb = createKnowledgeBase(state, { name: "Retrieval Manifests", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha", { documentId: "doc-alpha", versionId: "ver-alpha" })
  ]), { workspaceRoot });
  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      title: "Alpha",
      relativePath: "alpha.txt",
      sourceType: "text",
      text: "Alpha source body that should not leak from manifests."
    }],
    chunks: [{
      chunk_id: "chunk-alpha-1",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      text: "Alpha chunk primary secret text.",
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "text" }
    }, {
      chunk_id: "chunk-alpha-review",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      text: "Alpha chunk review secret text.",
      quality: { tier: "review", writeEnabled: false },
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "text" }
    }]
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "local-text.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "local-chunks.jsonl")
  });
  writeRetrievalFixtures(state, kb.id);

  const chunks = readChunkManifestFromCatalog(state);
  const index = readIndexManifestFromCatalog(state);

  assert.equal(chunks.ok, true);
  assert.equal(chunks.kind, "knowmesh.chunkManifest");
  assert.equal(chunks.summary.status, "ready");
  assert.equal(chunks.summary.chunks, 2);
  assert.equal(chunks.summary.citations, 2);
  assert.equal(chunks.summary.reviewChunks, 1);
  assert.equal(chunks.summary.missingCitations, 0);
  assert.equal(chunks.summary.objectLinkedChunks, 2);
  assert.equal(chunks.summary.structureLinkedChunks, 2);
  assert.equal(chunks.summary.activeBuildId, "build-retrieval");
  assert.ok(chunks.items.every((item) => item.text === undefined));
  assert.doesNotMatch(JSON.stringify(chunks), /secret text/);

  assert.equal(index.ok, true);
  assert.equal(index.kind, "knowmesh.indexManifest");
  assert.equal(index.summary.status, "partial");
  assert.equal(index.summary.records, 3);
  assert.equal(index.summary.written, 1);
  assert.equal(index.summary.failed, 1);
  assert.equal(index.summary.pending, 1);
  assert.equal(index.summary.activeBuildId, "build-retrieval");
  assert.deepEqual(index.summary.providers, { local: 3 });
  assert.deepEqual(index.summary.indexes, { "catalog-local": 3 });
  assert.doesNotMatch(JSON.stringify(index), /embedded secret text/);
});

function tempState(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const sourceRoot = path.join(root, "source");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return {
    root,
    sourceRoot,
    workspaceRoot,
    state: {
      projectRoot: root,
      userDataRoot: path.join(root, ".knowmesh"),
      defaultSetupDraft: {
        "setup.mode": "local",
        "template.id": "general-docs",
        "project.source": sourceRoot,
        "project.workspace": workspaceRoot
      }
    }
  };
}

function sourceManifest(documents) {
  return {
    kind: "knowmesh.sourceScanManifest",
    apiVersion: "v1",
    generatedAt: "2026-06-29T00:00:00.000Z",
    project: { id: "general-docs", name: "General Docs" },
    source: { type: "filesystem", root: "E:/资料", include: ["**/*"] },
    workspace: { root: "E:/workspace", artifactRoot: "E:/workspace/artifacts", manifests: "E:/workspace/manifests" },
    files: { scanned: documents.length, supported: documents.length, included: documents.length },
    splitPdfGroups: [],
    logicalDocuments: documents,
    scopeFilter: { enabled: false, excluded: [] },
    warnings: []
  };
}

function sourceDocument(relativePath, hash, options = {}) {
  return {
    document_id: options.documentId,
    version_id: options.versionId,
    title: path.basename(relativePath).replace(/\.[^.]+$/i, ""),
    sourceType: options.sourceType || "text",
    sourcePath: `E:/资料/${relativePath}`,
    sourceUri: `file:///E:/%E8%B5%84%E6%96%99/${encodeURIComponent(relativePath)}`,
    relativePath,
    source_fingerprint: hash,
    sourceParts: [{
      path: `E:/资料/${relativePath}`,
      uri: `file:///E:/%E8%B5%84%E6%96%99/${encodeURIComponent(relativePath)}`,
      relativePath,
      size: 32,
      sha256: hash
    }],
    merge: { required: false, outputPath: `E:/资料/${relativePath}`, status: "not_required" }
  };
}

function writeRetrievalFixtures(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'local', 'catalog-local', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "idx-alpha-written",
      "chunk-alpha-1",
      "written",
      "vector-alpha-1",
      "keyword-alpha-1",
      "structure-alpha-1",
      JSON.stringify({ text: "embedded secret text", datasetVersionId: "build-retrieval", retry: { stage: "index" } }),
      now,
      now
    );
    db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'local', 'catalog-local', ?, '', '', '', ?, ?, ?)
    `).run(
      "idx-alpha-review-failed",
      "chunk-alpha-review",
      "failed",
      JSON.stringify({ text: "embedded secret text", error: { code: "provider_timeout" }, retry: { retryable: true } }),
      now,
      now
    );
    db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'local', 'catalog-local', 'pending', '', '', '', ?, ?, ?)
    `).run(
      "idx-alpha-pending",
      "chunk-alpha-1",
      JSON.stringify({ text: "embedded secret text", retry: { retryable: false } }),
      now,
      now
    );
    db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES ('build-retrieval', 'active', 1, '', '{}', ?, ?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES ('release-retrieval', 'build-retrieval', 'active', 'published/oss-sidecar/manifest.json', '{}', ?, ?)
    `).run(now, now);
  } finally {
    db.close();
  }
}
