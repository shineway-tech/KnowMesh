import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEmbeddingAdapterBatch,
  buildRerankAdapterPlan,
  normalizeEmbeddingAdapterResults
} from "./embedding-provider.mjs";

test("embedding adapter batch normalizes chunk ids model dimensions and checkpoints", () => {
  const batch = buildEmbeddingAdapterBatch([
    { chunk_id: "chunk-1", document_id: "doc-1", text: "Alpha body" },
    { chunkId: "chunk-2", documentId: "doc-2", text: "Beta body" }
  ], {
    adapterId: "dashscope-embedding",
    provider: "dashscope",
    model: "text-embedding-v4",
    expectedDimensions: 3,
    batchId: "emb-batch-1",
    configured: true
  });

  assert.equal(batch.kind, "knowmesh.embeddingAdapterBatch");
  assert.equal(batch.status, "dryRunRequired");
  assert.equal(batch.externalCallsBeforeExecution, 0);
  assert.equal(batch.dryRun.sendsSourceContent, true);
  assert.equal(batch.checkpoint.key, "embedding:emb-batch-1");
  assert.deepEqual(batch.items.map((item) => item.checkpointKey), [
    "embedding:emb-batch-1:chunk-1",
    "embedding:emb-batch-1:chunk-2"
  ]);
  assert.ok(batch.items.every((item) => item.model === "text-embedding-v4" && item.expectedDimensions === 3 && item.textHash));
});

test("embedding adapter results carry checksum dimensions and failure state", () => {
  const batch = buildEmbeddingAdapterBatch([
    { chunk_id: "chunk-1", document_id: "doc-1", text: "Alpha body" },
    { chunk_id: "chunk-2", document_id: "doc-2", text: "Beta body" }
  ], {
    adapterId: "dashscope-embedding",
    provider: "dashscope",
    model: "text-embedding-v4",
    expectedDimensions: 3,
    batchId: "emb-batch-1"
  });

  const records = normalizeEmbeddingAdapterResults([
    { chunkId: "chunk-1", embedding: [0.1, 0.2, 0.3] },
    { chunkId: "chunk-2", embedding: [0.1, 0.2] }
  ], batch);

  assert.equal(records[0].status, "embedded");
  assert.equal(records[0].dimensions, 3);
  assert.equal(records[0].expectedDimensions, 3);
  assert.ok(records[0].embeddingChecksum);
  assert.equal(records[0].metadata.adapter.kind, "embedding");
  assert.equal(records[1].status, "failed");
  assert.equal(records[1].providerMessage, "embedding_dimension_mismatch");
});

test("rerank adapter defaults to citation-safe no-rerank fallback", () => {
  const plan = buildRerankAdapterPlan([
    { chunkId: "chunk-a", rank: 1, score: 0.72 },
    { chunkId: "chunk-b", rank: 2, score: 0.61 }
  ]);

  assert.equal(plan.kind, "knowmesh.rerankAdapterPlan");
  assert.equal(plan.adapterId, "no-rerank-fallback");
  assert.equal(plan.status, "skipped");
  assert.equal(plan.externalCallsBeforeExecution, 0);
  assert.equal(plan.dryRun.plannedExternalCall, false);
  assert.ok(plan.items.every((item) => item.rankingMetadata.citationSafe === true));
  assert.deepEqual(plan.items.map((item) => item.originalRank), [1, 2]);
});
