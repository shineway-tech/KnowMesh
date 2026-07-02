import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { buildVectorAdapterWriteBatch, normalizeVectorAdapterWriteResults } from "./execution/vector-writer.mjs";
import { syncIndexWriteResultsToCatalog } from "./index-records.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { readIndexManifestFromCatalog } from "./retrieval-manifests.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";

test("index records persist vector adapter sidecar metadata for catalog validation", () => {
  const { state, workspaceRoot } = tempState("knowmesh-index-adapter-");
  createKnowledgeBase(state, { name: "Index Adapter Boundary", template: "general-docs" });
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
      text: "Alpha source body."
    }],
    chunks: [{
      chunk_id: "chunk-alpha",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      text: "Alpha chunk body.",
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "text" }
    }]
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "alpha.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "alpha-chunks.jsonl")
  });

  const batch = buildVectorAdapterWriteBatch([
    { chunk_id: "chunk-alpha", document_id: "doc-alpha", embedding: [0.1, 0.2, 0.3], chunkTextHash: "hash-alpha-text" }
  ], {
    provider: "local-vector",
    indexName: "local-vector",
    namespace: "published/local-vector",
    expectedDimensions: 3,
    batchId: "vec-batch-alpha",
    catalogChunkIds: new Set(["chunk-alpha"])
  });
  const records = normalizeVectorAdapterWriteResults([
    {
      chunkId: "chunk-alpha",
      remoteId: "vec-alpha",
      checksum: "checksum-alpha",
      dimensions: 3,
      sidecarUri: "published/local-vector/chunk-alpha.json"
    }
  ], batch);

  syncIndexWriteResultsToCatalog(state, records, { provider: "local-vector", indexName: "local-vector" });
  const index = readIndexManifestFromCatalog(state);
  const record = index.records.find((item) => item.chunkId === "chunk-alpha");

  assert.equal(record.normalizedStatus, "written");
  assert.equal(record.sidecarContract.status, "ready");
  assert.equal(record.sidecarContract.uri, "published/local-vector/chunk-alpha.json");
  assert.equal(record.sidecarContract.dimensions, 3);
  assert.equal(record.sidecarContract.expectedDimensions, 3);
  assert.equal(record.sidecarContract.checksum, "checksum-alpha");
  assert.equal(index.summary.readiness.localVector.ready, 1);
  assert.equal(index.summary.readiness.consistency.localVectorInvalidRecords, 0);
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
