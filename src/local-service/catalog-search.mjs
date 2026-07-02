import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { openCatalogDatabase, parseJson } from "./storage.mjs";

const inactiveQualityStates = new Set(["review", "archive", "archived", "excluded", "excluded_by_user"]);
const inactiveDocumentStatuses = new Set(["excluded", "excluded_by_user", "archived", "archive", "missing", "out_of_scope"]);

export function searchCatalog(state, input = {}) {
  const knowledgeBaseId = String(input.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptySearchResult(input, "knowledge_base_required");

  const options = normalizeSearchInput(input);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const query = buildSearchQuery(options);
    const total = db.prepare(query.countSql).get(...query.countParams)?.total || 0;
    const rows = db.prepare(query.rowsSql).all(...query.rowsParams, options.limit, options.offset);
    const items = rows.map((row) => rowToSearchItem(row, knowledgeBaseId, options)).filter(Boolean);
    return {
      ok: true,
      kind: "knowmesh.catalogSearch",
      apiVersion: "1.0.0",
      knowledgeBase: { id: knowledgeBaseId },
      query: {
        text: options.query,
        purpose: options.purpose,
        filters: publicFilters(options)
      },
      total,
      limit: options.limit,
      offset: options.offset,
      hasMore: options.offset + items.length < total,
      items
    };
  } finally {
    db.close();
  }
}

function normalizeSearchInput(input = {}) {
  const qualityStates = arrayOfStrings(input.qualityStates || input.qualityState);
  const purpose = String(input.purpose || "queryEvidence").trim() || "queryEvidence";
  const includeReview = input.includeReview === true || input.includeReview === "true";
  return {
    query: String(input.query || input.q || "").trim(),
    purpose,
    includeReview,
    qualityStates,
    documentId: String(input.documentId || input.document_id || "").trim(),
    sourceType: String(input.sourceType || input.source_type || "").trim(),
    structureNodeId: String(input.structureNodeId || input.structure_node_id || "").trim(),
    documentStatuses: arrayOfStrings(input.documentStatuses || input.documentStatus || input.document_status),
    pageStart: optionalNumber(input.pageStart ?? input.page_start),
    pageEnd: optionalNumber(input.pageEnd ?? input.page_end),
    limit: clampInteger(input.limit, 20, 1, 100),
    offset: clampInteger(input.offset, 0, 0, 100000)
  };
}

function buildSearchQuery(options) {
  const ftsQuery = buildFtsQuery(options.query);
  const usesFts = Boolean(ftsQuery);
  const params = [];
  const where = [];
  if (usesFts) {
    where.push("chunks_fts MATCH ?");
    params.push(ftsQuery);
  }
  appendQualityFilter(where, params, options);
  appendDocumentStatusFilter(where, params, options);
  if (options.documentId) {
    where.push("c.document_id = ?");
    params.push(options.documentId);
  }
  if (options.structureNodeId) {
    where.push("(c.structure_node_id = ? OR ci.structure_node_id = ?)");
    params.push(options.structureNodeId, options.structureNodeId);
  }
  if (options.sourceType) {
    where.push(`LOWER(COALESCE(
      json_extract(c.metadata_json, '$.sourceType'),
      json_extract(c.metadata_json, '$.metadata.sourceType'),
      sd.source_type,
      ''
    )) = LOWER(?)`);
    params.push(options.sourceType);
  }
  if (options.pageStart !== null) {
    where.push(`CAST(COALESCE(
      ci.page_number,
      json_extract(c.metadata_json, '$.page_start'),
      json_extract(c.metadata_json, '$.pageStart')
    ) AS INTEGER) >= ?`);
    params.push(options.pageStart);
  }
  if (options.pageEnd !== null) {
    where.push(`CAST(COALESCE(
      ci.page_number,
      json_extract(c.metadata_json, '$.page_end'),
      json_extract(c.metadata_json, '$.pageEnd'),
      json_extract(c.metadata_json, '$.page_start'),
      json_extract(c.metadata_json, '$.pageStart')
    ) AS INTEGER) <= ?`);
    params.push(options.pageEnd);
  }

  const from = usesFts
    ? "chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid"
    : "chunks c LEFT JOIN chunks_fts ON chunks_fts.rowid = c.rowid";
  const joins = `
    LEFT JOIN source_documents sd ON sd.document_id = c.document_id
    LEFT JOIN structure_nodes sn ON sn.node_id = c.structure_node_id
    LEFT JOIN citations ci ON ci.citation_id = (
      SELECT citation_id
      FROM citations
      WHERE chunk_id = c.chunk_id
      ORDER BY page_number ASC, citation_id ASC
      LIMIT 1
    )
    LEFT JOIN (
      SELECT result_key, count(*) AS feedback_boost
      FROM query_feedback
      WHERE action = 'useful' AND resolved = 0 AND result_key != ''
      GROUP BY result_key
    ) qfb ON qfb.result_key = c.chunk_id
  `;
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rankSql = usesFts ? "bm25(chunks_fts)" : "0";
  const titleMatchSql = `CASE WHEN LOWER(COALESCE(
    json_extract(c.metadata_json, '$.title'),
    json_extract(c.metadata_json, '$.metadata.title'),
    sd.title,
    ci.source_label,
    ''
  )) LIKE ? THEN 1 ELSE 0 END`;
  const structureMatchSql = `CASE WHEN LOWER(COALESCE(
    sn.title,
    sn.path,
    json_extract(c.metadata_json, '$.structurePath'),
    json_extract(c.metadata_json, '$.metadata.structurePath'),
    ''
  )) LIKE ? THEN 1 ELSE 0 END`;
  const citationReadySql = "CASE WHEN ci.citation_id IS NOT NULL THEN 1 ELSE 0 END";
  const qualityWeightSql = `CASE c.quality_state
    WHEN 'primary' THEN 1.0
    WHEN 'weighted' THEN 0.72
    WHEN 'review' THEN 0.35
    WHEN 'archive' THEN 0.1
    WHEN 'archived' THEN 0.1
    ELSE 0.5
  END`;
  const feedbackBoostSql = "MIN(COALESCE(qfb.feedback_boost, 0), 5)";
  const phraseLike = options.query ? `%${options.query.toLowerCase()}%` : "\u0000";
  return {
    countParams: params,
    rowsParams: [phraseLike, phraseLike, ...params],
    countSql: `SELECT count(*) AS total FROM ${from} ${joins} ${whereSql}`,
    rowsSql: `
      WITH base AS (
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
          sd.status AS document_status,
          sd.source_type,
          sd.normalized_relative_path,
          sn.title AS structure_title,
          sn.path AS structure_path,
          ci.citation_id,
          ci.page_id,
          ci.block_id AS citation_block_id,
          ci.structure_node_id AS citation_structure_node_id,
          ci.source_label,
          ci.page_number,
          ci.anchor,
          ci.metadata_json AS citation_metadata_json,
          ${rankSql} AS rank,
          ${titleMatchSql} AS title_match,
          ${structureMatchSql} AS structure_match,
          ${citationReadySql} AS citation_ready,
          ${qualityWeightSql} AS quality_weight,
          ${feedbackBoostSql} AS feedback_boost
        FROM ${from}
        ${joins}
        ${whereSql}
      )
      SELECT
        *,
        ((1.0 / (1.0 + ABS(rank))) * 4.0)
          + (title_match * 3.0)
          + (structure_match * 2.0)
          + (citation_ready * 1.5)
          + (quality_weight * 1.2)
          + (feedback_boost * 0.6) AS search_score
      FROM base
      ORDER BY search_score DESC, updated_at DESC, chunk_id ASC
      LIMIT ? OFFSET ?
    `
  };
}

function appendQualityFilter(where, params, options) {
  if (options.qualityStates.length) {
    where.push(`c.quality_state IN (${placeholders(options.qualityStates)})`);
    params.push(...options.qualityStates);
    return;
  }
  if (options.includeReview || options.purpose === "maintenance") return;
  where.push(`c.quality_state NOT IN (${placeholders([...inactiveQualityStates])})`);
  params.push(...inactiveQualityStates);
}

function appendDocumentStatusFilter(where, params, options) {
  if (options.documentStatuses.length) {
    where.push(`COALESCE(sd.status, 'included') IN (${placeholders(options.documentStatuses)})`);
    params.push(...options.documentStatuses);
    return;
  }
  if (options.purpose === "maintenance") return;
  where.push(`COALESCE(sd.status, 'included') NOT IN (${placeholders([...inactiveDocumentStatuses])})`);
  params.push(...inactiveDocumentStatuses);
}

function rowToSearchItem(row = {}, knowledgeBaseId, options) {
  const metadata = parseJson(row.metadata_json, {});
  const citationMetadata = parseJson(row.citation_metadata_json, {});
  const nestedMetadata = metadata.metadata && typeof metadata.metadata === "object" ? metadata.metadata : {};
  const sourceType = String(metadata.sourceType || nestedMetadata.sourceType || citationMetadata.sourceType || row.source_type || "");
  const relativePath = normalizeRelativePath(metadata.relativePath || nestedMetadata.relativePath || citationMetadata.relativePath || row.normalized_relative_path || "");
  const title = String(metadata.title || nestedMetadata.title || citationMetadata.title || row.source_label || row.document_title || row.document_id || "");
  const sourceUri = String(metadata.sourceUri || nestedMetadata.sourceUri || citationMetadata.sourceUri || relativePath || "");
  const pageNumber = firstNumber(row.page_number, metadata.page_start, metadata.pageStart, nestedMetadata.pageNumber, citationMetadata.page_start);
  const excerpt = boundedExcerpt(citationMetadata.excerpt || metadata.textPreview || metadata.text || "");
  const rank = Number(row.rank || 0);
  const searchScore = Number(row.search_score || 0);
  const titleMatch = Number(row.title_match || 0) > 0;
  const structureMatch = Number(row.structure_match || 0) > 0;
  const citationReady = Number(row.citation_ready || 0) > 0;
  const feedbackBoost = Number(row.feedback_boost || 0) || 0;
  const qualityWeight = Number(row.quality_weight ?? qualityWeightForState(row.quality_state));
  const documentStatus = String(row.document_status || "included");
  return {
    chunkId: String(row.chunk_id || ""),
    documentId: String(row.document_id || ""),
    objectId: String(row.object_id || ""),
    blockId: String(row.block_id || ""),
    structureNodeId: String(row.structure_node_id || row.citation_structure_node_id || ""),
    title,
    pageNumber,
    qualityState: String(row.quality_state || ""),
    score: options.query ? Number(Math.min(1, Math.max(0, searchScore / 15)).toFixed(6)) : 0,
    rankingSignals: {
      titleMatch,
      structureMatch,
      citationReady,
      qualityWeight,
      feedbackBoost,
      documentStatus
    },
    source: {
      type: sourceType,
      uri: sourceUri,
      relativePath,
      textPath: normalizeRelativePath(row.text_path || "")
    },
    excerpt,
    citation: {
      citationId: String(row.citation_id || ""),
      sourceLabel: String(row.source_label || title),
      pageNumber,
      anchor: String(row.anchor || ""),
      relativePath,
      sourceUri,
      sourceType
    },
    metadata: {
      sourceType,
      relativePath,
      sourceUri,
      contentType: String(metadata.contentType || nestedMetadata.contentType || ""),
      education: metadata.education || nestedMetadata.education || null,
      pageClassification: metadata.pageClassification || null,
      structurePath: String(row.structure_path || metadata.structurePath || nestedMetadata.structurePath || ""),
      documentStatus,
      pageStart: firstNumber(metadata.page_start, metadata.pageStart, pageNumber),
      pageEnd: firstNumber(metadata.page_end, metadata.pageEnd, pageNumber)
    },
    links: {
      document: scopedKnowledgeBasePath(knowledgeBaseId, `/maintain/document?documentId=${encodeURIComponent(row.document_id || "")}`),
      asset: scopedKnowledgeBasePath(knowledgeBaseId, `/maintain/documents?query=${encodeURIComponent(title || row.document_id || "")}`),
      evidence: scopedKnowledgeBasePath(knowledgeBaseId, `/maintain/documents/search?query=${encodeURIComponent(options.query || title || row.document_id || "")}&chunkId=${encodeURIComponent(row.chunk_id || "")}`),
      diagnostics: scopedKnowledgeBasePath(knowledgeBaseId, `/maintain/diagnostics?chunkId=${encodeURIComponent(row.chunk_id || "")}`)
    },
    updatedAt: String(row.updated_at || "")
  };
}

function buildFtsQuery(query) {
  const terms = String(query || "")
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((term) => term.trim().toLowerCase())
    .filter(Boolean) || [];
  if (!terms.length) return "";
  return [...new Set(terms)].slice(0, 12).map((term) => `${escapeFtsTerm(term)}*`).join(" OR ");
}

function escapeFtsTerm(term) {
  return term.replaceAll('"', '""');
}

function publicFilters(options) {
  return {
    qualityStates: options.qualityStates,
    includeReview: options.includeReview,
    documentId: options.documentId,
    sourceType: options.sourceType,
    structureNodeId: options.structureNodeId,
    documentStatuses: options.documentStatuses,
    pageStart: options.pageStart,
    pageEnd: options.pageEnd
  };
}

function qualityWeightForState(state) {
  switch (String(state || "")) {
    case "primary":
      return 1;
    case "weighted":
      return 0.72;
    case "review":
      return 0.35;
    case "archive":
    case "archived":
      return 0.1;
    default:
      return 0.5;
  }
}

function emptySearchResult(input = {}, reason = "empty") {
  const options = normalizeSearchInput(input);
  return {
    ok: false,
    kind: "knowmesh.catalogSearch",
    apiVersion: "1.0.0",
    knowledgeBase: { id: "" },
    query: {
      text: options.query,
      purpose: options.purpose,
      filters: publicFilters(options)
    },
    reason,
    total: 0,
    limit: options.limit,
    offset: options.offset,
    hasMore: false,
    items: []
  };
}

function boundedExcerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 360) return text;
  return `${text.slice(0, 357)}...`;
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function arrayOfStrings(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => String(item || "").trim()).filter(Boolean);
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function scopedKnowledgeBasePath(knowledgeBaseId, value = "") {
  const clean = String(value || "").startsWith("/") ? String(value || "") : `/${value || ""}`;
  return knowledgeBaseId ? `/kb/${encodeURIComponent(knowledgeBaseId)}${clean}` : clean;
}
