import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function routeStructureQueryFromCatalog(state, input = {}) {
  const question = String(input.question || input.query || "").trim();
  const knowledgeBaseId = String(input.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  const route = {
    kind: "query.structureRoute",
    intent: "structure_lookup",
    source: "catalog",
    tableOrder: ["structure_nodes", "citations", "source_documents"]
  };
  if (!knowledgeBaseId || !question) return emptyResult(knowledgeBaseId, route, "invalid_request");

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const terms = tokenize(question);
    const rows = db.prepare(`
      SELECT
        sn.node_id,
        sn.document_id,
        sn.node_type,
        sn.title,
        sn.page_start,
        sn.page_end,
        sn.path,
        sn.metadata_json,
        sd.title AS document_title,
        sd.normalized_relative_path,
        ci.citation_id,
        ci.page_number AS citation_page_number,
        ci.anchor AS citation_anchor
      FROM structure_nodes sn
      JOIN source_documents sd ON sd.document_id = sn.document_id
      LEFT JOIN citations ci ON ci.citation_id = (
        SELECT citation_id
        FROM citations
        WHERE structure_node_id = sn.node_id
        ORDER BY page_number ASC, citation_id ASC
        LIMIT 1
      )
      WHERE sd.status = 'active'
      ORDER BY sd.title ASC, sn.page_start ASC, sn.sort_order ASC, sn.node_id ASC
    `).all();
    const citations = rows
      .map((row) => ({ row, score: scoreStructureRow(row, terms) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || Number(left.row.page_start || 0) - Number(right.row.page_start || 0))
      .slice(0, 6)
      .map((item) => rowToCitation(item.row));
    return {
      ok: citations.length > 0,
      status: citations.length ? "evidence_found" : "no_evidence",
      kind: "knowmesh.structureQueryRouteResult",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBaseId,
      route,
      retrieval: {
        source: "structureCatalog",
        scanned: rows.length,
        accepted: citations.length,
        rejected: Math.max(0, rows.length - citations.length)
      },
      citations,
      message: citations.length
        ? { zh: "已从 catalog 结构节点找到可引用位置。", en: "Citable locations were found in catalog structure nodes." }
        : { zh: "没有找到匹配的结构节点。", en: "No matching structure node was found." }
    };
  } finally {
    db.close();
  }
}

function scoreStructureRow(row = {}, terms = []) {
  const searchable = normalize([
    row.title,
    row.path,
    row.document_title,
    row.normalized_relative_path
  ].filter(Boolean).join(" "));
  let score = 0;
  for (const term of terms) {
    if (term.length >= 2 && searchable.includes(term)) score += Math.min(20, term.length * 3);
  }
  if (/页|page|位置|章节|目录/.test(terms.join(" "))) score += 10;
  if (row.citation_id) score += 20;
  if (row.page_start) score += 12;
  return score >= 16 ? score : 0;
}

function rowToCitation(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    id: row.citation_id || row.node_id,
    citationId: row.citation_id || "",
    chunk_id: row.citation_id || row.node_id,
    document_id: row.document_id || "",
    version_id: "",
    title: row.document_title || "",
    sourceUri: row.normalized_relative_path || "",
    pageNumber: row.citation_page_number ?? row.page_start ?? null,
    excerpt: [
      row.node_type || "section",
      row.title || "",
      row.page_start ? `p.${row.page_start}` : ""
    ].filter(Boolean).join(" · "),
    contentType: row.node_type || "section",
    structureNodeId: row.node_id || "",
    metadata: safeMetadata({
      contentType: row.node_type || "section",
      nodeType: row.node_type || "",
      nodeTitle: row.title || "",
      structurePath: row.path || "",
      pageEnd: row.page_end ?? null,
      anchor: row.citation_anchor || "",
      labels: metadata.labels || []
    })
  };
}

function tokenize(value) {
  const text = normalize(value);
  const words = text.match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/gi) || [];
  const grams = [];
  for (const word of words) {
    if (/^[\u4e00-\u9fa5]+$/.test(word) && word.length > 4) {
      for (let index = 0; index <= word.length - 2; index += 1) grams.push(word.slice(index, index + 2));
    }
    grams.push(word);
  }
  return [...new Set(grams)].slice(0, 24);
}

function normalize(value) {
  return String(value || "")
    .replace(/[？?。！!,，、：:；;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function safeMetadata(metadata = {}) {
  return JSON.parse(JSON.stringify(metadata, (key, value) => {
    if (["text", "rawText", "sourceText", "textPreview", "private"].includes(key)) return undefined;
    return value === undefined ? undefined : value;
  }));
}

function emptyResult(knowledgeBaseId, route, status) {
  return {
    ok: false,
    status,
    kind: "knowmesh.structureQueryRouteResult",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBaseId,
    route,
    retrieval: { source: "structureCatalog", scanned: 0, accepted: 0, rejected: 0 },
    citations: []
  };
}
