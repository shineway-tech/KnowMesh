import crypto from "node:crypto";

import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function syncPendingIndexRecordsToCatalog(state, records = [], context = {}) {
  return syncIndexRecordsToCatalog(state, records, {
    ...context,
    defaultStatus: "embedded",
    stage: context.stage || "embedding"
  });
}

export function syncIndexWriteResultsToCatalog(state, records = [], context = {}) {
  return syncIndexRecordsToCatalog(state, records, {
    ...context,
    defaultStatus: "written",
    stage: context.stage || "index"
  });
}

export function readCatalogIndexChunks(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return [];
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    return db.prepare(`
      SELECT record_id, chunk_id, provider, index_name, status, vector_id, metadata_json, updated_at
      FROM index_records
      WHERE status IN ('embedded', 'written')
      ORDER BY updated_at DESC, record_id ASC
    `).all().map(catalogIndexRowToChunk).filter(Boolean);
  } finally {
    db.close();
  }
}

function syncIndexRecordsToCatalog(state, records = [], context = {}) {
  const knowledgeBaseId = String(context.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  const normalized = (Array.isArray(records) ? records : []).map((record) => normalizeIndexRecord(record, context)).filter(Boolean);
  if (!knowledgeBaseId || !normalized.length) return { ok: false, records: 0 };

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const selectExisting = db.prepare("SELECT metadata_json FROM index_records WHERE record_id = ?");
    const ensureSourceDocument = db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO NOTHING
    `);
    const upsertChunk = db.prepare(`
      INSERT INTO chunks (
        chunk_id, document_id, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        document_id = excluded.document_id,
        text_hash = excluded.text_hash,
        token_count = excluded.token_count,
        quality_state = excluded.quality_state,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const upsertRecord = db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        chunk_id = excluded.chunk_id,
        provider = excluded.provider,
        index_name = excluded.index_name,
        status = excluded.status,
        vector_id = excluded.vector_id,
        keyword_key = excluded.keyword_key,
        structure_key = excluded.structure_key,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const write = db.transaction(() => {
      const now = nowIso();
      for (const record of normalized) {
        ensureSourceDocument.run(
          record.documentId,
          record.title,
          record.sourceType,
          record.sourceUri,
          record.relativePath,
          "",
          process.platform,
          "included",
          "primary",
          stableJson({ sourceUri: record.sourceUri }),
          now,
          now
        );
        upsertChunk.run(
          record.chunkId,
          record.documentId,
          record.textHash,
          record.tokenCount,
          record.qualityState,
          stableJson(record.chunkMetadata),
          now,
          now
        );
        const previousMetadata = parseJson(selectExisting.get(record.recordId)?.metadata_json, {});
        upsertRecord.run(
          record.recordId,
          record.chunkId,
          record.provider,
          record.indexName,
          record.status,
          record.vectorId,
          record.keywordKey,
          record.structureKey,
          stableJson(mergeIndexMetadata(previousMetadata, record.metadata)),
          now,
          now
        );
      }
    });
    write();
    return { ok: true, records: normalized.length };
  } finally {
    db.close();
  }
}

function normalizeIndexRecord(record = {}, context = {}) {
  const chunkId = String(record.chunk_id || record.chunkId || "").trim();
  const documentId = String(record.document_id || record.documentId || "").trim();
  if (!chunkId || !documentId) return null;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  const target = record.target || context.target || {};
  const sourceUri = String(record.sourceUri || metadata.sourceUri || "");
  const text = String(record.text || "").trim();
  const provider = String(context.provider || target.provider || record.provider || "");
  const indexName = String(context.indexName || target.index || target.indexName || record.index_name || record.indexName || "");
  const status = normalizeStatus(record.status || context.defaultStatus);
  const quality = record.quality || null;
  return {
    recordId: String(record.record_id || record.recordId || chunkId),
    chunkId,
    documentId,
    title: String(metadata.title || record.title || sourceUri || documentId),
    sourceType: String(metadata.content_type || metadata.source || record.sourceType || ""),
    sourceUri,
    relativePath: sourceUri.replace(/^oss:\/\/[^/]+\//, ""),
    textHash: sha256(text),
    tokenCount: estimateTokenCount(text),
    qualityState: quality?.tier || (quality?.writeEnabled === false ? "review" : "primary"),
    provider,
    indexName,
    status,
    vectorId: String(record.remoteId || record.vector_id || record.vectorId || ""),
    keywordKey: String(record.keywordKey || ""),
    structureKey: String(record.structureKey || ""),
    chunkMetadata: {
      text,
      sourceUri,
      sourceParts: Array.isArray(record.sourceParts) ? record.sourceParts : [],
      page_start: record.page_start ?? record.pageStart ?? null,
      page_end: record.page_end ?? record.pageEnd ?? null,
      metadata,
      document_id: documentId,
      version_id: record.version_id || record.versionId || "",
      quality,
      datasetVersionId: record.datasetVersionId || context.job?.datasetVersionId || "",
      ...(record.active === true ? { active: true } : {})
    },
    metadata: {
      text,
      sourceUri,
      sourceParts: Array.isArray(record.sourceParts) ? record.sourceParts : [],
      page_start: record.page_start ?? record.pageStart ?? null,
      page_end: record.page_end ?? record.pageEnd ?? null,
      metadata,
      document_id: documentId,
      version_id: record.version_id || record.versionId || "",
      quality,
      datasetVersionId: record.datasetVersionId || context.job?.datasetVersionId || "",
      active: record.active === true,
      embeddingModel: record.embedding_model || record.embeddingModel || context.model || "",
      usage: record.usage || null,
      providerMessage: record.providerMessage || "",
      target,
      remoteId: record.remoteId || "",
      sidecarUri: record.sidecarUri || "",
      retry: retryMetadata(context)
    }
  };
}

function mergeIndexMetadata(previous = {}, next = {}) {
  return {
    ...previous,
    ...next,
    text: next.text || previous.text || "",
    sourceUri: next.sourceUri || previous.sourceUri || "",
    sourceParts: next.sourceParts?.length ? next.sourceParts : previous.sourceParts || [],
    metadata: { ...(previous.metadata || {}), ...(next.metadata || {}) },
    quality: next.quality || previous.quality || null,
    datasetVersionId: next.datasetVersionId || previous.datasetVersionId || "",
    active: next.active === true || previous.active === true,
    retry: { ...(previous.retry || {}), ...(next.retry || {}) }
  };
}

function catalogIndexRowToChunk(row) {
  const metadata = parseJson(row.metadata_json, {});
  const text = String(metadata.text || "").trim();
  if (!text || metadata.active === false || metadata.quality?.writeEnabled === false) return null;
  const pageStart = metadata.page_start ?? null;
  return {
    chunk_id: row.chunk_id,
    document_id: metadata.document_id || metadata.documentId || "",
    version_id: metadata.version_id || metadata.versionId || metadata.datasetVersionId || "",
    active: metadata.active === true,
    text,
    sourceUri: metadata.sourceUri || metadata.metadata?.sourceUri || "",
    sourceParts: Array.isArray(metadata.sourceParts) ? metadata.sourceParts : [],
    page_start: pageStart,
    page_end: metadata.page_end ?? null,
    metadata: {
      ...(metadata.metadata || {}),
      sourceUri: metadata.sourceUri || metadata.metadata?.sourceUri || "",
      pageNumber: metadata.metadata?.pageNumber ?? pageStart
    },
    quality: metadata.quality || null,
    status: row.status
  };
}

function retryMetadata(context = {}) {
  return {
    stage: context.stage || "",
    policy: context.retry || null,
    batch: context.batch ?? null,
    totalBatches: context.totalBatches ?? null,
    batchSize: context.batchSize ?? null
  };
}

function normalizeStatus(status) {
  const value = String(status || "").trim();
  if (value === "written" || value === "failed" || value === "embedded" || value === "review") return value;
  return value || "pending";
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function estimateTokenCount(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}
