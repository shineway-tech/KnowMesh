import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { normalizeIndexStatus } from "./index-records.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const inactiveQualityStates = ["review", "archive", "archived", "excluded", "excluded_by_user"];

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
    const catalogStats = readRetrievalCatalogStats(db);
    const records = db.prepare(`
      SELECT
        ir.record_id,
        ir.chunk_id,
        ir.provider,
        ir.index_name,
        ir.status,
        ir.vector_id,
        ir.keyword_key,
        ir.structure_key,
        ir.metadata_json,
        ir.updated_at,
        c.chunk_id AS catalog_chunk_id
      FROM index_records ir
      LEFT JOIN chunks c ON c.chunk_id = ir.chunk_id
      ORDER BY ir.updated_at DESC, ir.record_id ASC
    `).all().map(indexRecordRow);
    return {
      ok: true,
      kind: "knowmesh.indexManifest",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeIndexRecords(records, activeVersion, catalogStats),
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
  const vectorId = String(row.vector_id || "");
  const status = String(row.status || "");
  const sidecarUri = normalizeRelativePath(metadata.sidecarUri || metadata.sidecar?.uri || metadata.target?.sidecarUri || "");
  const provider = String(row.provider || "");
  const sidecarContract = localVectorSidecarContractFromMetadata(metadata, {
    provider,
    chunkId: row.chunk_id,
    sidecarUri
  });
  return {
    recordId: String(row.record_id || ""),
    chunkId: String(row.chunk_id || ""),
    provider,
    indexName: String(row.index_name || ""),
    status,
    normalizedStatus: normalizeIndexStatus(status),
    vectorId,
    keywordKey: String(row.keyword_key || ""),
    structureKey: String(row.structure_key || ""),
    sidecarUri,
    sidecarContract,
    hasVector: Boolean(vectorId),
    chunkExists: Boolean(row.catalog_chunk_id),
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

function summarizeIndexRecords(records, activeVersion, catalogStats = emptyRetrievalCatalogStats()) {
  const providers = countBy(records, (record) => record.provider || "unknown");
  const indexes = countBy(records, (record) => record.indexName || "unknown");
  const embedded = records.filter((record) => record.normalizedStatus === "embedded").length;
  const failed = records.filter((record) => record.normalizedStatus === "failed").length;
  const pending = records.filter((record) => record.normalizedStatus === "pending").length;
  const written = records.filter((record) => record.normalizedStatus === "written").length;
  const disabled = records.filter((record) => record.normalizedStatus === "disabled").length;
  const stale = records.filter((record) => record.normalizedStatus === "stale").length;
  return {
    status: records.length ? failed || pending || disabled || stale ? "partial" : "ready" : "empty",
    records: records.length,
    written,
    embedded,
    failed,
    pending,
    disabled,
    stale,
    retryable: records.filter((record) => record.retryable).length,
    providers,
    indexes,
    readiness: summarizeRetrievalReadiness(records, catalogStats),
    activeBuildId: activeVersion?.buildId || ""
  };
}

function readRetrievalCatalogStats(db) {
  const inactiveList = inactiveQualityStates.map((value) => `'${value}'`).join(", ");
  const row = db.prepare(`
    SELECT
      count(*) AS chunks,
      SUM(CASE WHEN c.quality_state NOT IN (${inactiveList}) THEN 1 ELSE 0 END) AS queryable_chunks,
      SUM(CASE WHEN c.quality_state NOT IN (${inactiveList}) AND COALESCE(c.structure_node_id, '') <> '' THEN 1 ELSE 0 END) AS structure_linked_chunks,
      SUM(CASE WHEN c.quality_state NOT IN (${inactiveList}) AND EXISTS (
        SELECT 1 FROM citations ci WHERE ci.chunk_id = c.chunk_id
      ) THEN 1 ELSE 0 END) AS citation_linked_chunks,
      (SELECT count(*) FROM citations) AS citations
    FROM chunks c
  `).get() || {};
  return {
    chunks: Number(row.chunks || 0),
    queryableChunks: Number(row.queryable_chunks || 0),
    structureLinkedChunks: Number(row.structure_linked_chunks || 0),
    citationLinkedChunks: Number(row.citation_linked_chunks || 0),
    citations: Number(row.citations || 0)
  };
}

function summarizeRetrievalReadiness(records, catalogStats) {
  const sidecar = summarizeSidecarReadiness(records);
  const localVector = summarizeLocalVectorReadiness(records);
  const consistency = summarizeConsistencyReadiness(records, sidecar, localVector);
  return {
    keyword: summarizeKeywordReadiness(catalogStats),
    structure: summarizeStructureReadiness(catalogStats),
    citation: summarizeCitationReadiness(catalogStats),
    vector: summarizeVectorReadiness(records),
    localVector,
    sidecar,
    consistency
  };
}

function summarizeKeywordReadiness(catalogStats) {
  return {
    status: catalogStats.queryableChunks > 0 ? "ready" : "empty",
    queryableChunks: catalogStats.queryableChunks,
    chunks: catalogStats.chunks
  };
}

function summarizeStructureReadiness(catalogStats) {
  const missing = Math.max(0, catalogStats.queryableChunks - catalogStats.structureLinkedChunks);
  return {
    status: catalogStats.queryableChunks === 0
      ? "empty"
      : missing === 0
        ? "ready"
        : catalogStats.structureLinkedChunks > 0
          ? "partial"
          : "missing",
    linkedChunks: catalogStats.structureLinkedChunks,
    missingChunks: missing,
    queryableChunks: catalogStats.queryableChunks
  };
}

function summarizeCitationReadiness(catalogStats) {
  const missing = Math.max(0, catalogStats.queryableChunks - catalogStats.citationLinkedChunks);
  return {
    status: catalogStats.queryableChunks === 0
      ? "empty"
      : missing === 0
        ? "ready"
        : catalogStats.citationLinkedChunks > 0
          ? "partial"
          : "missing",
    citations: catalogStats.citations,
    citedChunks: catalogStats.citationLinkedChunks,
    missingCitations: missing,
    queryableChunks: catalogStats.queryableChunks
  };
}

function summarizeVectorReadiness(records) {
  const counts = {
    ready: records.filter((record) => isVectorReady(record)).length,
    written: records.filter((record) => record.normalizedStatus === "written").length,
    embedded: records.filter((record) => record.normalizedStatus === "embedded").length,
    failed: records.filter((record) => record.normalizedStatus === "failed").length,
    pending: records.filter((record) => record.normalizedStatus === "pending").length,
    disabled: records.filter((record) => record.normalizedStatus === "disabled").length,
    stale: records.filter((record) => record.normalizedStatus === "stale").length
  };
  return {
    status: records.length === 0
      ? "empty"
      : counts.ready > 0 && !counts.failed && !counts.pending && !counts.disabled && !counts.stale
        ? "ready"
        : counts.disabled === records.length
          ? "disabled"
          : "partial",
    ...counts,
    records: records.length
  };
}

function summarizeSidecarReadiness(records) {
  const required = records.filter((record) => isSidecarRequired(record));
  const ready = required.filter((record) => record.sidecarUri).length;
  const missing = Math.max(0, required.length - ready);
  return {
    status: required.length === 0 ? "not_required" : missing === 0 ? "ready" : ready > 0 ? "partial" : "missing",
    required: required.length,
    ready,
    missing
  };
}

function summarizeConsistencyReadiness(records, sidecar, localVector = { invalidRecords: 0 }) {
  const missingChunkRecords = records.filter((record) => !record.chunkExists).length;
  const staleRecords = records.filter((record) => record.normalizedStatus === "stale").length;
  const localVectorInvalidRecords = Number(localVector.invalidRecords || 0);
  return {
    status: missingChunkRecords || staleRecords || sidecar.missing || localVectorInvalidRecords ? "partial" : "ready",
    missingChunkRecords,
    staleRecords,
    missingSidecars: sidecar.missing,
    localVectorInvalidRecords
  };
}

function summarizeLocalVectorReadiness(records) {
  const localRecords = records.filter(isLocalVectorRecord);
  const missingSidecars = localRecords.filter((record) => !record.sidecarContract?.uri).length;
  const dimensionMismatches = localRecords.filter((record) => localVectorDimensionMismatch(record.sidecarContract)).length;
  const staleChecksums = localRecords.filter((record) => localVectorChecksumStale(record.sidecarContract)).length;
  const disabled = localRecords.filter((record) => record.normalizedStatus === "disabled").length;
  const ready = localRecords.filter((record) => localVectorSidecarReady(record.sidecarContract)).length;
  const invalidRecords = missingSidecars + dimensionMismatches + staleChecksums + disabled;
  return {
    status: localRecords.length === 0
      ? "not_configured"
      : invalidRecords === 0 && ready === localRecords.length
        ? "ready"
        : ready > 0
          ? "partial"
          : "blocked",
    records: localRecords.length,
    ready,
    missingSidecars,
    dimensionMismatches,
    staleChecksums,
    disabled,
    invalidRecords,
    fallback: "catalog-search"
  };
}

function isVectorReady(record) {
  return record.normalizedStatus === "written" || record.normalizedStatus === "embedded";
}

function isSidecarRequired(record) {
  if (!isVectorReady(record)) return false;
  const provider = String(record.provider || "").toLowerCase();
  const indexName = String(record.indexName || "").toLowerCase();
  if (!provider || provider === "local" || provider === "local-catalog") return false;
  return record.hasVector || provider.includes("vector") || indexName.includes("vector");
}

function isLocalVectorRecord(record) {
  const provider = String(record.provider || "").toLowerCase();
  const indexName = String(record.indexName || "").toLowerCase();
  return provider === "local-vector" || indexName === "local-vector";
}

function localVectorSidecarContractFromMetadata(metadata = {}, context = {}) {
  const sidecar = metadata.sidecar && typeof metadata.sidecar === "object" ? metadata.sidecar : {};
  if (String(context.provider || sidecar.provider || "").toLowerCase() !== "local-vector") return null;
  const dimensions = optionalNumber(sidecar.dimensions ?? metadata.dimensions);
  const expectedDimensions = optionalNumber(sidecar.expectedDimensions ?? metadata.expectedDimensions);
  const checksumStatus = String(sidecar.checksumStatus || metadata.checksumStatus || (sidecar.stale === true ? "stale" : sidecar.checksum ? "match" : "missing"));
  return {
    authority: "catalog",
    provider: "local-vector",
    status: String(sidecar.status || metadata.status || (context.sidecarUri ? "ready" : "missing")),
    uri: normalizeRelativePath(sidecar.uri || context.sidecarUri || metadata.sidecarUri || ""),
    dimensions,
    expectedDimensions,
    chunkId: String(sidecar.chunkId || metadata.chunkId || context.chunkId || ""),
    chunkTextHash: String(sidecar.chunkTextHash || metadata.chunkTextHash || ""),
    checksum: String(sidecar.checksum || metadata.checksum || ""),
    checksumStatus
  };
}

function localVectorSidecarReady(sidecar) {
  if (!sidecar) return false;
  return sidecar.status === "ready"
    && Boolean(sidecar.uri)
    && !localVectorDimensionMismatch(sidecar)
    && !localVectorChecksumStale(sidecar);
}

function localVectorDimensionMismatch(sidecar) {
  if (!sidecar) return false;
  if (!Number.isFinite(sidecar.dimensions) || !Number.isFinite(sidecar.expectedDimensions)) return false;
  return sidecar.dimensions !== sidecar.expectedDimensions;
}

function localVectorChecksumStale(sidecar) {
  if (!sidecar) return false;
  return ["stale", "mismatch"].includes(String(sidecar.checksumStatus || ""));
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function emptyRetrievalCatalogStats() {
  return {
    chunks: 0,
    queryableChunks: 0,
    structureLinkedChunks: 0,
    citationLinkedChunks: 0,
    citations: 0
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
      embedded: 0,
      failed: 0,
      pending: 0,
      disabled: 0,
      stale: 0,
      retryable: 0,
      providers: {},
      indexes: {},
      readiness: summarizeRetrievalReadiness([], emptyRetrievalCatalogStats()),
      activeBuildId: ""
    },
    activeVersion: null,
    records: []
  };
}
