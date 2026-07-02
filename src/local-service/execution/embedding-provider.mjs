import crypto from "node:crypto";

export function buildEmbeddingAdapterBatch(items = [], options = {}) {
  const adapterId = String(options.adapterId || "dashscope-embedding");
  const provider = String(options.provider || adapterId);
  const model = String(options.model || "");
  const expectedDimensions = optionalNumber(options.expectedDimensions ?? options.dimensions);
  const batchId = String(options.batchId || `embedding-${sha256(items.map((item) => item.chunk_id || item.chunkId || "").join("|")).slice(0, 12)}`);
  const configured = options.configured !== false;
  const normalizedItems = (Array.isArray(items) ? items : []).map((item, index) => embeddingItem(item, {
    batchId,
    index,
    provider,
    model,
    expectedDimensions
  })).filter(Boolean);

  return {
    kind: "knowmesh.embeddingAdapterBatch",
    adapterId,
    provider,
    model,
    status: configured ? "dryRunRequired" : "blocked",
    batchId,
    expectedDimensions,
    items: normalizedItems,
    checkpoint: {
      key: `embedding:${batchId}`,
      itemKeys: normalizedItems.map((item) => item.checkpointKey),
      retryable: true
    },
    dryRun: {
      required: true,
      plannedExternalCall: configured,
      sendsSourceContent: true,
      writesRemoteState: false
    },
    externalCallsBeforeExecution: 0,
    retryPolicy: {
      transientOnly: true,
      checkpointed: true,
      splitOnBatchSizeError: true
    }
  };
}

export function normalizeEmbeddingAdapterResults(results = [], request = {}) {
  const requestItems = new Map((request.items || []).map((item) => [item.chunkId, item]));
  return (Array.isArray(results) ? results : []).map((result) => {
    const chunkId = String(result.chunk_id || result.chunkId || "");
    const input = requestItems.get(chunkId) || {};
    const embedding = Array.isArray(result.embedding) ? result.embedding : [];
    const dimensions = embedding.length || optionalNumber(result.dimensions) || 0;
    const expectedDimensions = optionalNumber(result.expectedDimensions ?? input.expectedDimensions ?? request.expectedDimensions);
    const dimensionMismatch = Boolean(expectedDimensions && dimensions && expectedDimensions !== dimensions);
    return {
      chunk_id: chunkId,
      document_id: String(result.document_id || result.documentId || input.documentId || ""),
      status: result.status === "failed" || !embedding.length || dimensionMismatch ? "failed" : "embedded",
      embedding,
      dimensions,
      expectedDimensions,
      embeddingChecksum: embedding.length ? sha256(JSON.stringify(embedding)) : "",
      chunkTextHash: input.textHash || "",
      provider: request.provider || input.provider || "",
      embeddingModel: request.model || input.model || "",
      batchId: request.batchId || input.batchId || "",
      providerMessage: dimensionMismatch ? "embedding_dimension_mismatch" : String(result.providerMessage || ""),
      metadata: {
        adapter: {
          id: request.adapterId || "",
          kind: "embedding",
          batchId: request.batchId || input.batchId || "",
          checkpointKey: input.checkpointKey || "",
          dimensions,
          expectedDimensions,
          checksum: embedding.length ? sha256(JSON.stringify(embedding)) : "",
          checksumStatus: embedding.length ? "match" : "missing"
        }
      }
    };
  });
}

export function buildRerankAdapterPlan(evidence = [], options = {}) {
  const configured = options.configured === true;
  const adapterId = configured ? String(options.adapterId || "dashscope-rerank") : "no-rerank-fallback";
  return {
    kind: "knowmesh.rerankAdapterPlan",
    adapterId,
    status: configured ? "dryRunRequired" : "skipped",
    externalCallsBeforeExecution: 0,
    dryRun: {
      required: configured,
      plannedExternalCall: configured,
      sendsSourceContent: configured,
      writesRemoteState: false
    },
    items: (Array.isArray(evidence) ? evidence : []).map((item, index) => ({
      chunkId: String(item.chunkId || item.chunk_id || ""),
      originalRank: Number(item.rank ?? index + 1),
      rerankScore: configured ? null : Number(item.score ?? 0),
      rankingMetadata: {
        citationSafe: true,
        fallback: configured ? "" : "original-rank",
        usesSourceText: configured
      }
    }))
  };
}

export async function runEmbeddingStage(context, job, log, implementation) {
  assertStageImplementation(implementation, "embedding provider");
  return implementation(context, job, log);
}

function assertStageImplementation(implementation, label) {
  if (typeof implementation !== "function") {
    throw new TypeError(`Missing ${label} execution implementation.`);
  }
}

function embeddingItem(item = {}, context = {}) {
  const chunkId = String(item.chunk_id || item.chunkId || "").trim();
  if (!chunkId) return null;
  const text = String(item.text || "");
  return {
    chunkId,
    documentId: String(item.document_id || item.documentId || ""),
    text,
    textHash: String(item.textHash || sha256(text)),
    provider: context.provider,
    model: context.model,
    expectedDimensions: context.expectedDimensions,
    batchId: context.batchId,
    checkpointKey: `embedding:${context.batchId}:${chunkId}`,
    index: context.index
  };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}
