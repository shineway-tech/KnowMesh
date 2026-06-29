import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { catalogDatabasePath, openCatalogDatabase, parseJson } from "./storage.mjs";

export function contentGraph(state, options = {}) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const query = String(options.query || "").trim();
  const quality = normalizeQualityFilter(options.quality);
  const cursor = Math.max(0, Number.parseInt(options.cursor ?? 0, 10) || 0);
  const limit = normalizeLimit(options.limit);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const fts = collectFtsMatches(db, query);
    const entries = buildGraphEntries(db.prepare(`
      SELECT
        sd.document_id,
        sd.title AS document_title,
        sd.source_type,
        sd.normalized_relative_path,
        sd.status AS document_status,
        sd.quality_state AS document_quality_state,
        sd.metadata_json AS document_metadata_json,
        p.page_id,
        p.version_id,
        p.page_number,
        p.extraction_state,
        p.quality_state AS page_quality_state,
        p.metadata_json AS page_metadata_json,
        b.block_id,
        b.block_type,
        b.sort_order AS block_sort_order,
        b.quality_state AS block_quality_state,
        b.metadata_json AS block_metadata_json,
        sn.node_id,
        sn.parent_id AS node_parent_id,
        sn.node_type,
        sn.title AS node_title,
        sn.path AS node_path,
        sn.page_start AS node_page_start,
        sn.page_end AS node_page_end,
        sn.metadata_json AS node_metadata_json,
        ko.object_id,
        ko.object_type,
        ko.title AS object_title,
        ko.source_page AS object_source_page,
        ko.quality_state AS object_quality_state,
        ko.metadata_json AS object_metadata_json,
        c.chunk_id,
        c.quality_state AS chunk_quality_state,
        c.token_count,
        c.metadata_json AS chunk_metadata_json,
        ci.citation_id,
        ci.source_label,
        ci.page_number AS citation_page_number,
        ci.anchor AS citation_anchor,
        ci.metadata_json AS citation_metadata_json
      FROM chunks c
      JOIN source_documents sd ON sd.document_id = c.document_id
      LEFT JOIN knowledge_objects ko ON ko.object_id = c.object_id
      LEFT JOIN structure_nodes sn ON sn.node_id = COALESCE(c.structure_node_id, ko.structure_node_id)
      LEFT JOIN blocks b ON b.block_id = c.block_id
      LEFT JOIN pages p ON p.page_id = COALESCE(b.page_id, (
        SELECT page_id
        FROM pages
        WHERE document_id = c.document_id
        ORDER BY ABS(page_number - COALESCE(json_extract(c.metadata_json, '$.page_start'), 0)) ASC, page_number ASC
        LIMIT 1
      ))
      LEFT JOIN citations ci ON ci.chunk_id = c.chunk_id
      ORDER BY sd.title ASC, p.page_number ASC, c.chunk_id ASC, ci.page_number ASC, ci.citation_id ASC
    `).all());
    const filtered = entries.filter((entry) => qualityMatches(entry, quality) && queryMatches(entry, query, fts));
    const page = filtered.slice(cursor, cursor + limit);
    return {
      ok: true,
      kind: "knowmesh.contentGraph",
      apiVersion: "1.0.0",
      knowledgeBaseId,
      graph: {
        filters: { query, quality },
        summary: summarizeEntries(filtered),
        documents: nestGraphEntries(page, knowledgeBaseId),
        pagination: {
          cursor: String(cursor),
          limit,
          returned: page.length,
          total: filtered.length,
          nextCursor: cursor + page.length < filtered.length ? String(cursor + page.length) : "",
          hasMore: cursor + page.length < filtered.length
        },
        path: catalogDatabasePath(state, knowledgeBaseId)
      }
    };
  } finally {
    db.close();
  }
}

function buildGraphEntries(rows) {
  const entries = new Map();
  for (const row of rows) {
    const chunkMetadata = parseJson(row.chunk_metadata_json, {});
    const pageMetadata = parseJson(row.page_metadata_json, {});
    const blockMetadata = parseJson(row.block_metadata_json, {});
    const objectMetadata = parseJson(row.object_metadata_json, {});
    const nodeMetadata = parseJson(row.node_metadata_json, {});
    const documentMetadata = parseJson(row.document_metadata_json, {});
    let entry = entries.get(row.chunk_id);
    if (!entry) {
      entry = {
        document: {
          id: row.document_id,
          title: row.document_title || documentMetadata.title || "",
          sourceType: row.source_type || "",
          relativePath: row.normalized_relative_path || "",
          status: row.document_status || "",
          qualityState: row.document_quality_state || ""
        },
        page: row.page_id ? {
          id: row.page_id,
          versionId: row.version_id || "",
          pageNumber: Number(row.page_number || 0) || 0,
          title: pageMetadata.title || "",
          extractionState: row.extraction_state || "",
          qualityState: row.page_quality_state || ""
        } : null,
        block: row.block_id ? {
          id: row.block_id,
          type: row.block_type || "",
          sortOrder: Number(row.block_sort_order || 0) || 0,
          qualityState: row.block_quality_state || "",
          textPreview: blockMetadata.textPreview || blockMetadata.text || ""
        } : null,
        structureNode: row.node_id ? {
          id: row.node_id,
          parentId: row.node_parent_id || "",
          type: row.node_type || "",
          title: row.node_title || nodeMetadata.title || "",
          path: row.node_path || "",
          pageStart: row.node_page_start ?? null,
          pageEnd: row.node_page_end ?? null
        } : null,
        object: row.object_id ? {
          id: row.object_id,
          type: row.object_type || "",
          title: row.object_title || objectMetadata.title || "",
          sourcePage: row.object_source_page ?? null,
          qualityState: row.object_quality_state || ""
        } : null,
        chunk: {
          id: row.chunk_id,
          qualityState: row.chunk_quality_state || "",
          tokenCount: Number(row.token_count || 0) || 0,
          text: String(chunkMetadata.text || chunkMetadata.textPreview || ""),
          textPreview: clampText(chunkMetadata.textPreview || chunkMetadata.text || "", 1200),
          sourceUri: chunkMetadata.sourceUri || chunkMetadata.metadata?.sourceUri || "",
          pageStart: chunkMetadata.page_start ?? null,
          pageEnd: chunkMetadata.page_end ?? null,
          metadata: chunkMetadata.metadata || {},
          citations: []
        }
      };
      entries.set(row.chunk_id, entry);
    }
    if (row.citation_id && !entry.chunk.citations.some((item) => item.id === row.citation_id)) {
      const citationMetadata = parseJson(row.citation_metadata_json, {});
      entry.chunk.citations.push({
        id: row.citation_id,
        sourceLabel: row.source_label || citationMetadata.title || "",
        pageNumber: row.citation_page_number ?? citationMetadata.page_start ?? null,
        anchor: row.citation_anchor || "",
        sourceUri: citationMetadata.sourceUri || "",
        excerpt: citationMetadata.excerpt || "",
        metadata: citationMetadata
      });
    }
  }
  return [...entries.values()].sort((a, b) => {
    const doc = a.document.title.localeCompare(b.document.title);
    if (doc) return doc;
    const page = Number(a.page?.pageNumber || 0) - Number(b.page?.pageNumber || 0);
    if (page) return page;
    return a.chunk.id.localeCompare(b.chunk.id);
  });
}

function nestGraphEntries(entries, knowledgeBaseId) {
  const documents = new Map();
  for (const entry of entries) {
    let document = documents.get(entry.document.id);
    if (!document) {
      document = {
        ...entry.document,
        href: `/kb/${knowledgeBaseId}/maintain/documents?query=${encodeURIComponent(entry.document.relativePath || entry.document.title || entry.document.id)}`,
        pages: []
      };
      documents.set(entry.document.id, document);
    }
    const pageId = entry.page?.id || `${entry.document.id}:page:unknown`;
    let page = document.pages.find((item) => item.id === pageId);
    if (!page) {
      page = {
        ...(entry.page || { id: pageId, pageNumber: 0, title: "", qualityState: "" }),
        blocks: [],
        structureNodes: [],
        objects: [],
        chunks: []
      };
      document.pages.push(page);
    }
    pushUnique(page.blocks, entry.block);
    pushUnique(page.structureNodes, entry.structureNode);
    pushUnique(page.objects, entry.object);
    page.chunks.push({
      ...entry.chunk,
      blockId: entry.block?.id || "",
      objectId: entry.object?.id || "",
      structureNodeId: entry.structureNode?.id || ""
    });
  }
  return [...documents.values()];
}

function summarizeEntries(entries) {
  const documents = new Set();
  const pages = new Set();
  const blocks = new Set();
  const objects = new Set();
  const structureNodes = new Set();
  let citations = 0;
  for (const entry of entries) {
    if (entry.document.id) documents.add(entry.document.id);
    if (entry.page?.id) pages.add(entry.page.id);
    if (entry.block?.id) blocks.add(entry.block.id);
    if (entry.object?.id) objects.add(entry.object.id);
    if (entry.structureNode?.id) structureNodes.add(entry.structureNode.id);
    citations += entry.chunk.citations.length;
  }
  return {
    documents: documents.size,
    pages: pages.size,
    blocks: blocks.size,
    structureNodes: structureNodes.size,
    objects: objects.size,
    chunks: entries.length,
    citations
  };
}

function collectFtsMatches(db, query) {
  const value = String(query || "").trim();
  if (!value) return { documentIds: new Set(), nodeIds: new Set(), objectIds: new Set() };
  const match = `"${value.replaceAll('"', '""')}"`;
  return {
    documentIds: ftsIds(db, "source_documents_fts", "document_id", match),
    nodeIds: ftsIds(db, "structure_nodes_fts", "node_id", match),
    objectIds: ftsIds(db, "knowledge_objects_fts", "object_id", match)
  };
}

function ftsIds(db, table, column, match) {
  try {
    return new Set(db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${table} MATCH ?`).all(match).map((row) => row.id));
  } catch {
    return new Set();
  }
}

function queryMatches(entry, query, fts) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return true;
  if (fts.documentIds.has(entry.document.id)) return true;
  if (entry.structureNode?.id && fts.nodeIds.has(entry.structureNode.id)) return true;
  if (entry.object?.id && fts.objectIds.has(entry.object.id)) return true;
  return [
    entry.document.title,
    entry.document.relativePath,
    entry.page?.title,
    entry.block?.textPreview,
    entry.structureNode?.title,
    entry.structureNode?.path,
    entry.object?.title,
    entry.chunk.text,
    entry.chunk.textPreview,
    entry.chunk.sourceUri,
    ...entry.chunk.citations.flatMap((citation) => [citation.sourceLabel, citation.sourceUri, citation.excerpt])
  ].some((item) => String(item || "").toLowerCase().includes(value));
}

function qualityMatches(entry, quality) {
  if (quality === "all") return true;
  return entry.chunk.qualityState === quality;
}

function pushUnique(list, item) {
  if (!item?.id || list.some((current) => current.id === item.id)) return;
  list.push(item);
}

function normalizeQualityFilter(value) {
  const quality = String(value || "all").trim();
  return quality || "all";
}

function normalizeLimit(value) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function clampText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
