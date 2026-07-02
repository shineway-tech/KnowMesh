import crypto from "node:crypto";

export function buildVectorAdapterWriteBatch(records = [], options = {}) {
  const adapterId = String(options.adapterId || "local-vector-sidecar");
  const provider = String(options.provider || "local-vector");
  const indexName = String(options.indexName || provider);
  const namespace = String(options.namespace || "");
  const expectedDimensions = optionalNumber(options.expectedDimensions ?? options.dimensions);
  const batchId = String(options.batchId || `vector-${sha256(records.map((item) => item.chunk_id || item.chunkId || "").join("|")).slice(0, 12)}`);
  const catalogChunkIds = new Set(Array.from(options.catalogChunkIds || []).map(String));
  const items = (Array.isArray(records) ? records : []).map((record, index) => vectorItem(record, {
    batchId,
    index,
    provider,
    indexName,
    namespace,
    expectedDimensions,
    catalogChunkIds
  })).filter(Boolean);
  return {
    kind: "knowmesh.vectorAdapterWriteBatch",
    adapterId,
    provider,
    indexName,
    namespace,
    expectedDimensions,
    batchId,
    items,
    checkpoint: {
      key: `vector:${batchId}`,
      itemKeys: items.map((item) => item.checkpointKey),
      retryable: true
    },
    catalogFallback: "catalog-search",
    externalCallsBeforeExecution: 0,
    retryPolicy: {
      transientOnly: provider !== "local-vector",
      checkpointed: true,
      splitOnBatchSizeError: true
    }
  };
}

export function normalizeVectorAdapterWriteResults(results = [], request = {}) {
  const requestItems = new Map((request.items || []).map((item) => [item.chunkId, item]));
  return (Array.isArray(results) ? results : []).map((result) => {
    const chunkId = String(result.chunk_id || result.chunkId || "");
    const input = requestItems.get(chunkId) || {};
    const dimensions = optionalNumber(result.dimensions ?? input.dimensions);
    const expectedDimensions = optionalNumber(result.expectedDimensions ?? input.expectedDimensions ?? request.expectedDimensions);
    const chunkExists = input.chunkExists !== false;
    const dimensionMismatch = Boolean(dimensions && expectedDimensions && dimensions !== expectedDimensions);
    const checksum = String(result.checksum || input.vectorChecksum || "");
    const checksumStatus = String(result.checksumStatus || input.checksumStatus || (checksum ? "match" : "missing"));
    const sidecarStatus = !chunkExists
      ? "missing_chunk"
      : dimensionMismatch
        ? "dimension_mismatch"
        : ["stale", "mismatch"].includes(checksumStatus)
          ? "stale"
          : result.status === "failed"
            ? "failed"
            : "ready";
    return {
      chunk_id: chunkId,
      document_id: String(result.document_id || result.documentId || input.documentId || ""),
      status: sidecarStatus === "ready" ? "written" : "failed",
      remoteId: String(result.remoteId || input.vectorId || ""),
      providerMessage: sidecarStatus === "ready" ? "" : sidecarStatus,
      metadata: {
        adapter: {
          id: request.adapterId || "",
          kind: "vector-store",
          batchId: request.batchId || "",
          checkpointKey: input.checkpointKey || "",
          catalogFallback: request.catalogFallback || "catalog-search"
        },
        sidecar: {
          provider: request.provider || input.provider || "",
          uri: normalizeRelativePath(result.sidecarUri || input.sidecarUri || ""),
          status: sidecarStatus,
          dimensions,
          expectedDimensions,
          chunkId,
          chunkTextHash: input.chunkTextHash || "",
          checksum,
          checksumStatus
        }
      }
    };
  });
}

export async function runVectorWriteStage(context, job, log, implementation) {
  assertStageImplementation(implementation, "vector writer");
  return implementation(context, job, log);
}

function assertStageImplementation(implementation, label) {
  if (typeof implementation !== "function") {
    throw new TypeError(`Missing ${label} execution implementation.`);
  }
}

function vectorItem(record = {}, context = {}) {
  const chunkId = String(record.chunk_id || record.chunkId || "").trim();
  if (!chunkId) return null;
  const embedding = Array.isArray(record.embedding) ? record.embedding : [];
  const dimensions = embedding.length || optionalNumber(record.dimensions);
  const expectedDimensions = optionalNumber(record.expectedDimensions ?? context.expectedDimensions);
  return {
    chunkId,
    documentId: String(record.document_id || record.documentId || ""),
    embedding,
    dimensions,
    expectedDimensions,
    provider: context.provider,
    indexName: context.indexName,
    namespace: context.namespace,
    batchId: context.batchId,
    checkpointKey: `vector:${context.batchId}:${chunkId}`,
    chunkTextHash: String(record.chunkTextHash || record.textHash || ""),
    vectorChecksum: embedding.length ? sha256(JSON.stringify(embedding)) : String(record.embeddingChecksum || ""),
    checksumStatus: "match",
    sidecarUri: normalizeRelativePath(record.sidecarUri || `${context.namespace ? `${context.namespace}/` : ""}${chunkId}.json`),
    chunkExists: context.catalogChunkIds.size === 0 ? true : context.catalogChunkIds.has(chunkId),
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

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}
