import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function readChunkManifestFromCatalog(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyChunkManifest();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeVersion = readActiveVersion(db);
    const citationRows = db.prepare(`
      SELECT citation_id, chunk_id, document_id, page_id, block_id, structure_node_id, source_label, page_number, anchor, metadata_json
      FROM citations
      ORDER BY chunk_id ASC, page_number ASC, citation_id ASC
    `).all().map(citationRow);
    const citationsByChunk = groupBy(citationRows, (citation) => citation.chunkId);
    const rows = db.prepare(`
      SELECT
        c.chunk_id,
        c.document_id,
        c.object_id,
        c.block_id,
        c.structure_node_id,
        c.text_path,
        c.text_hash,
        c.token_count,
        c.quality_state,
        c.metadata_json,
        c.updated_at,
        sd.title AS document_title,
        sd.normalized_relative_path,
        sd.source_type
      FROM chunks c
      LEFT JOIN source_documents sd ON sd.document_id = c.document_id
      ORDER BY c.document_id ASC, c.updated_at DESC, c.chunk_id ASC
    `).all();
    const items = rows.map((row) => chunkRow(row, citationsByChunk.get(row.chunk_id) || []));
    return {
      ok: true,
      kind: "knowmesh.chunkManifest",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeChunks(items, activeVersion),
      activeVersion,
      items
    };
  } finally {
    db.close();
  }
}

export function readIndexManifestFromCatalog(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyIndexManifest();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeVersion = readActiveVersion(db);
    const records = db.prepare(`
      SELECT
        record_id,
        chunk_id,
        provider,
        index_name,
        status,
        vector_id,
        keyword_key,
        structure_key,
        metadata_json,
        updated_at
      FROM index_records
      ORDER BY updated_at DESC, record_id ASC
    `).all().map(indexRecordRow);
    return {
      ok: true,
      kind: "knowmesh.indexManifest",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeIndexRecords(records, activeVersion),
      activeVersion,
      records
    };
  } finally {
    db.close();
  }
}

function chunkRow(row = {}, citations = []) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    chunkId: String(row.chunk_id || ""),
    documentId: String(row.document_id || ""),
    documentTitle: String(row.document_title || ""),
    relativePath: normalizeRelativePath(metadata.relativePath || row.normalized_relative_path || ""),
    sourceType: String(metadata.sourceType || row.source_type || ""),
    objectId: String(row.object_id || ""),
    blockId: String(row.block_id || ""),
    structureNodeId: String(row.structure_node_id || ""),
    textPath: normalizeRelativePath(row.text_path || ""),
    textHash: String(row.text_hash || ""),
    tokenCount: Number(row.token_count || 0),
    qualityState: String(row.quality_state || ""),
    pageStart: metadata.page_start ?? null,
    pageEnd: metadata.page_end ?? null,
    source: String(metadata.source || ""),
    citations,
    updatedAt: String(row.updated_at || "")
  };
}

function citationRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    citationId: String(row.citation_id || ""),
    chunkId: String(row.chunk_id || ""),
    documentId: String(row.document_id || ""),
    pageId: String(row.page_id || ""),
    blockId: String(row.block_id || ""),
    structureNodeId: String(row.structure_node_id || ""),
    sourceLabel: String(row.source_label || ""),
    pageNumber: row.page_number === null || row.page_number === undefined ? null : Number(row.page_number),
    anchor: String(row.anchor || ""),
    relativePath: normalizeRelativePath(metadata.relativePath || ""),
    sourceType: String(metadata.sourceType || "")
  };
}

function indexRecordRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    recordId: String(row.record_id || ""),
    chunkId: String(row.chunk_id || ""),
    provider: String(row.provider || ""),
    indexName: String(row.index_name || ""),
    status: String(row.status || ""),
    vectorId: String(row.vector_id || ""),
    keywordKey: String(row.keyword_key || ""),
    structureKey: String(row.structure_key || ""),
    datasetVersionId: String(metadata.datasetVersionId || ""),
    retryable: metadata.retry?.retryable === true,
    errorCode: String(metadata.error?.code || metadata.errorCode || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function summarizeChunks(items, activeVersion) {
  const chunks = items.length;
  const missingCitations = items.filter((item) => item.citations.length === 0).length;
  return {
    status: chunks ? missingCitations ? "partial" : "ready" : "empty",
    chunks,
    citations: items.reduce((total, item) => total + item.citations.length, 0),
    reviewChunks: items.filter((item) => item.qualityState === "review").length,
    missingCitations,
    objectLinkedChunks: items.filter((item) => item.objectId).length,
    structureLinkedChunks: items.filter((item) => item.structureNodeId).length,
    sourceLinkedChunks: items.filter((item) => item.documentId).length,
    activeBuildId: activeVersion?.buildId || ""
  };
}

function summarizeIndexRecords(records, activeVersion) {
  const providers = countBy(records, (record) => record.provider || "unknown");
  const indexes = countBy(records, (record) => record.indexName || "unknown");
  const failed = records.filter((record) => record.status === "failed").length;
  const pending = records.filter((record) => record.status === "pending").length;
  const written = records.filter((record) => record.status === "written").length;
  return {
    status: records.length ? failed || pending ? "partial" : "ready" : "empty",
    records: records.length,
    written,
    failed,
    pending,
    retryable: records.filter((record) => record.retryable).length,
    providers,
    indexes,
    activeBuildId: activeVersion?.buildId || ""
  };
}

function readActiveVersion(db) {
  const row = db.prepare(`
    SELECT build_id, status, active, summary_json, updated_at
    FROM build_versions
    WHERE active = 1
    ORDER BY updated_at DESC, build_id DESC
    LIMIT 1
  `).get();
  if (!row) return null;
  const release = db.prepare(`
    SELECT release_id, status, manifest_path, summary_json, updated_at
    FROM release_manifests
    WHERE build_id = ?
    ORDER BY updated_at DESC, release_id DESC
    LIMIT 1
  `).get(row.build_id);
  return {
    buildId: String(row.build_id || ""),
    status: String(row.status || ""),
    active: Number(row.active || 0) === 1,
    release: release ? {
      releaseId: String(release.release_id || ""),
      status: String(release.status || ""),
      manifestPath: normalizeRelativePath(release.manifest_path || "")
    } : null
  };
}

function groupBy(items, resolveKey) {
  const groups = new Map();
  for (const item of items) {
    const key = resolveKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function countBy(items, resolveKey) {
  const counts = {};
  for (const item of items) {
    const key = resolveKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function emptyChunkManifest() {
  return {
    ok: false,
    kind: "knowmesh.chunkManifest",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "" },
    summary: {
      status: "empty",
      chunks: 0,
      citations: 0,
      reviewChunks: 0,
      missingCitations: 0,
      objectLinkedChunks: 0,
      structureLinkedChunks: 0,
      sourceLinkedChunks: 0,
      activeBuildId: ""
    },
    activeVersion: null,
    items: []
  };
}

function emptyIndexManifest() {
  return {
    ok: false,
    kind: "knowmesh.indexManifest",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "" },
    summary: {
      status: "empty",
      records: 0,
      written: 0,
      failed: 0,
      pending: 0,
      retryable: 0,
      providers: {},
      indexes: {},
      activeBuildId: ""
    },
    activeVersion: null,
    records: []
  };
}
