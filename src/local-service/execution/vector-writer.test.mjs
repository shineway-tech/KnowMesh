import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVectorAdapterWriteBatch,
  normalizeVectorAdapterWriteResults
} from "./vector-writer.mjs";

test("vector adapter write batch normalizes namespace checkpoints and catalog fallback", () => {
  const batch = buildVectorAdapterWriteBatch([
    { chunk_id: "chunk-1", document_id: "doc-1", embedding: [0.1, 0.2, 0.3], chunkTextHash: "hash-1" }
  ], {
    adapterId: "local-vector-sidecar",
    provider: "local-vector",
    indexName: "local-vector",
    namespace: "kb-local",
    expectedDimensions: 3,
    batchId: "vec-batch-1",
    catalogChunkIds: new Set(["chunk-1"])
  });

  assert.equal(batch.kind, "knowmesh.vectorAdapterWriteBatch");
  assert.equal(batch.provider, "local-vector");
  assert.equal(batch.catalogFallback, "catalog-search");
  assert.equal(batch.externalCallsBeforeExecution, 0);
  assert.equal(batch.checkpoint.key, "vector:vec-batch-1");
  assert.equal(batch.items[0].checkpointKey, "vector:vec-batch-1:chunk-1");
  assert.equal(batch.items[0].sidecarUri, "kb-local/chunk-1.json");
  assert.equal(batch.items[0].chunkExists, true);
  assert.equal(batch.items[0].expectedDimensions, 3);
});

test("vector adapter write results validate catalog chunk and dimension before marking ready", () => {
  const batch = buildVectorAdapterWriteBatch([
    { chunk_id: "chunk-ready", document_id: "doc-1", embedding: [0.1, 0.2, 0.3], chunkTextHash: "hash-ready" },
    { chunk_id: "chunk-missing", document_id: "doc-1", embedding: [0.1, 0.2, 0.3], chunkTextHash: "hash-missing" },
    { chunk_id: "chunk-dim", document_id: "doc-1", embedding: [0.1, 0.2], chunkTextHash: "hash-dim" }
  ], {
    provider: "local-vector",
    indexName: "local-vector",
    namespace: "kb-local",
    expectedDimensions: 3,
    batchId: "vec-batch-1",
    catalogChunkIds: new Set(["chunk-ready", "chunk-dim"])
  });

  const records = normalizeVectorAdapterWriteResults([
    { chunkId: "chunk-ready", remoteId: "vec-1", checksum: "checksum-ready", dimensions: 3, sidecarUri: "kb-local/chunk-ready.json" },
    { chunkId: "chunk-missing", remoteId: "vec-2", checksum: "checksum-missing", dimensions: 3, sidecarUri: "kb-local/chunk-missing.json" },
    { chunkId: "chunk-dim", remoteId: "vec-3", checksum: "checksum-dim", dimensions: 2, sidecarUri: "kb-local/chunk-dim.json" }
  ], batch);

  assert.equal(records[0].status, "written");
  assert.equal(records[0].metadata.sidecar.status, "ready");
  assert.equal(records[0].metadata.sidecar.provider, "local-vector");
  assert.equal(records[0].metadata.adapter.catalogFallback, "catalog-search");
  assert.equal(records[1].status, "failed");
  assert.equal(records[1].metadata.sidecar.status, "missing_chunk");
  assert.equal(records[2].status, "failed");
  assert.equal(records[2].metadata.sidecar.status, "dimension_mismatch");
});
