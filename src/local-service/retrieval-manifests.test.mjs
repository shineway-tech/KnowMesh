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

test("index manifest reports local search vector sidecar and consistency readiness separately", () => {
  const { state, workspaceRoot } = tempState("knowmesh-retrieval-readiness-");
  const kb = createKnowledgeBase(state, { name: "Retrieval Readiness", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("ready.txt", "hash-ready", { documentId: "doc-ready", versionId: "ver-ready" })
  ]), { workspaceRoot });
  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-ready",
      version_id: "ver-ready",
      title: "Ready",
      relativePath: "ready.txt",
      sourceType: "text",
      text: "Ready source body that should not leak from readiness manifests."
    }],
    chunks: [{
      chunk_id: "chunk-ready-1",
      document_id: "doc-ready",
      version_id: "ver-ready",
      text: "Ready chunk one private text.",
      metadata: { title: "Ready", relativePath: "ready.txt", sourceType: "text" }
    }, {
      chunk_id: "chunk-ready-2",
      document_id: "doc-ready",
      version_id: "ver-ready",
      text: "Ready chunk two private text.",
      metadata: { title: "Ready", relativePath: "ready.txt", sourceType: "text" }
    }]
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "ready.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "ready-chunks.jsonl")
  });
  writeReadinessIndexFixtures(state, kb.id);

  const index = readIndexManifestFromCatalog(state);

  assert.equal(index.summary.records, 6);
  assert.equal(index.summary.written, 1);
  assert.equal(index.summary.embedded, 1);
  assert.equal(index.summary.failed, 1);
  assert.equal(index.summary.pending, 1);
  assert.equal(index.summary.disabled, 1);
  assert.equal(index.summary.stale, 1);
  assert.deepEqual(index.records.map((record) => record.normalizedStatus).sort(), ["disabled", "embedded", "failed", "pending", "stale", "written"]);
  assert.equal(index.summary.readiness.keyword.status, "ready");
  assert.equal(index.summary.readiness.keyword.queryableChunks, 2);
  assert.equal(index.summary.readiness.structure.status, "ready");
  assert.equal(index.summary.readiness.citation.status, "ready");
  assert.equal(index.summary.readiness.vector.status, "partial");
  assert.equal(index.summary.readiness.vector.ready, 2);
  assert.equal(index.summary.readiness.vector.failed, 1);
  assert.equal(index.summary.readiness.vector.disabled, 1);
  assert.equal(index.summary.readiness.sidecar.status, "partial");
  assert.equal(index.summary.readiness.sidecar.ready, 1);
  assert.equal(index.summary.readiness.sidecar.missing, 1);
  assert.equal(index.summary.readiness.consistency.status, "partial");
  assert.equal(index.summary.readiness.consistency.missingChunkRecords, 1);
  assert.equal(index.summary.readiness.consistency.staleRecords, 1);
  assert.doesNotMatch(JSON.stringify(index), /private text/);
});

test("index manifest validates local vector sidecar contract without overriding catalog authority", () => {
  const { state, workspaceRoot } = tempState("knowmesh-local-vector-sidecar-");
  const kb = createKnowledgeBase(state, { name: "Local Vector Sidecar", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("local-vector.txt", "hash-local-vector", { documentId: "doc-local-vector", versionId: "ver-local-vector" })
  ]), { workspaceRoot });
  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-local-vector",
      version_id: "ver-local-vector",
      title: "Local Vector",
      relativePath: "local-vector.txt",
      sourceType: "text",
      text: "Local vector source body."
    }],
    chunks: [1, 2, 3, 4].map((index) => ({
      chunk_id: `chunk-local-vector-${index}`,
      document_id: "doc-local-vector",
      version_id: "ver-local-vector",
      text: `Local vector chunk ${index} private text.`,
      metadata: { title: "Local Vector", relativePath: "local-vector.txt", sourceType: "text" }
    }))
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "local-vector.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "local-vector-chunks.jsonl")
  });
  writeLocalVectorSidecarFixtures(state, kb.id);

  const index = readIndexManifestFromCatalog(state);

  assert.equal(index.summary.readiness.localVector.status, "partial");
  assert.equal(index.summary.readiness.localVector.records, 4);
  assert.equal(index.summary.readiness.localVector.ready, 1);
  assert.equal(index.summary.readiness.localVector.missingSidecars, 1);
  assert.equal(index.summary.readiness.localVector.dimensionMismatches, 1);
  assert.equal(index.summary.readiness.localVector.staleChecksums, 1);
  const ready = index.records.find((record) => record.recordId === "idx-local-vector-ready");
  assert.deepEqual(ready.sidecarContract, {
    authority: "catalog",
    provider: "local-vector",
    status: "ready",
    uri: "published/local-vector/chunk-1.json",
    dimensions: 384,
    expectedDimensions: 384,
    chunkId: "chunk-local-vector-1",
    chunkTextHash: "hash-ready",
    checksum: "vector-checksum-ready",
    checksumStatus: "match"
  });
  assert.equal(index.summary.readiness.consistency.status, "partial");
  assert.equal(index.summary.readiness.consistency.localVectorInvalidRecords, 3);
  assert.doesNotMatch(JSON.stringify(index), /private text/);
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

function writeLocalVectorSidecarFixtures(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'local-vector', 'local-vector', 'written', ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      insert.run(
        "idx-local-vector-ready",
        "chunk-local-vector-1",
        "local-vector-1",
        "kw-1",
        "structure-1",
        JSON.stringify({
          sidecar: {
            provider: "local-vector",
            uri: "published/local-vector/chunk-1.json",
            status: "ready",
            dimensions: 384,
            expectedDimensions: 384,
            chunkId: "chunk-local-vector-1",
            chunkTextHash: "hash-ready",
            checksum: "vector-checksum-ready",
            checksumStatus: "match"
          }
        }),
        now,
        now
      );
      insert.run(
        "idx-local-vector-missing-sidecar",
        "chunk-local-vector-2",
        "local-vector-2",
        "kw-2",
        "structure-2",
        JSON.stringify({ sidecar: { provider: "local-vector", expectedDimensions: 384 } }),
        now,
        now
      );
      insert.run(
        "idx-local-vector-dimension-mismatch",
        "chunk-local-vector-3",
        "local-vector-3",
        "kw-3",
        "structure-3",
        JSON.stringify({
          sidecar: {
            provider: "local-vector",
            uri: "published/local-vector/chunk-3.json",
            status: "ready",
            dimensions: 768,
            expectedDimensions: 384,
            chunkId: "chunk-local-vector-3",
            chunkTextHash: "hash-dim",
            checksum: "vector-checksum-dim",
            checksumStatus: "match"
          }
        }),
        now,
        now
      );
      insert.run(
        "idx-local-vector-stale-checksum",
        "chunk-local-vector-4",
        "local-vector-4",
        "kw-4",
        "structure-4",
        JSON.stringify({
          sidecar: {
            provider: "local-vector",
            uri: "published/local-vector/chunk-4.json",
            status: "ready",
            dimensions: 384,
            expectedDimensions: 384,
            chunkId: "chunk-local-vector-4",
            chunkTextHash: "hash-stale",
            checksum: "vector-checksum-stale",
            checksumStatus: "stale"
          }
        }),
        now,
        now
      );
    })();
  } finally {
    db.close();
  }
}

function writeReadinessIndexFixtures(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    db.pragma("foreign_keys = OFF");
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      insert.run(
        "idx-ready-written",
        "chunk-ready-1",
        "aliyun-vector",
        "kb-vector",
        "written",
        "vec-ready-1",
        "kw-ready-1",
        "structure-ready-1",
        JSON.stringify({ sidecarUri: "published/oss-sidecar/vector-ready.jsonl", datasetVersionId: "build-readiness" }),
        now,
        now
      );
      insert.run(
        "idx-ready-embedded-missing-sidecar",
        "chunk-ready-2",
        "aliyun-vector",
        "kb-vector",
        "embedded",
        "vec-ready-2",
        "kw-ready-2",
        "structure-ready-2",
        JSON.stringify({ datasetVersionId: "build-readiness" }),
        now,
        now
      );
      insert.run(
        "idx-ready-failed",
        "chunk-ready-2",
        "aliyun-vector",
        "kb-vector",
        "failed",
        "",
        "",
        "",
        JSON.stringify({ error: { code: "provider_timeout" }, retry: { retryable: true } }),
        now,
        now
      );
      insert.run(
        "idx-ready-pending-missing-chunk",
        "chunk-missing",
        "aliyun-vector",
        "kb-vector",
        "pending",
        "",
        "",
        "",
        "{}",
        now,
        now
      );
      insert.run(
        "idx-ready-disabled",
        "chunk-ready-2",
        "aliyun-vector",
        "kb-vector",
        "disabled",
        "",
        "",
        "",
        JSON.stringify({ disabledReason: "provider not configured" }),
        now,
        now
      );
      insert.run(
        "idx-ready-stale",
        "chunk-ready-1",
        "aliyun-vector",
        "kb-vector",
        "stale",
        "vec-ready-stale",
        "",
        "",
        JSON.stringify({ staleReason: "chunk updated" }),
        now,
        now
      );
    })();
    db.pragma("foreign_keys = ON");
  } finally {
    db.close();
  }
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
