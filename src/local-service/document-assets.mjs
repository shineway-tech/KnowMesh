import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { knowledgeBaseVersions } from "./knowledge-versions.mjs";
import { readCatalogDocumentInventory } from "./document-inventory.mjs";
import { openCatalogDatabase, parseJson } from "./storage.mjs";

const assetCache = new Map();
const maxCachedAssets = 12;

export async function buildDocumentAssetPayload(state, input = {}) {
  const documentKey = normalizeKey(input.documentId || input.id || "");
  const relativePath = normalizeRelativePath(input.path || input.relativePath || "");
  const cursor = Math.max(0, Number.parseInt(input.cursor ?? 0, 10) || 0);
  const limit = Math.min(80, Math.max(1, Number.parseInt(input.limit ?? 30, 10) || 30));
  const kbId = currentKnowledgeBaseId(state);
  if (!kbId) return assetError("NO_KNOWLEDGE_BASE", "Knowledge base is required.");

  const inventory = readCatalogDocumentInventory(state);
  const document = findInventoryDocument(inventory, { documentKey, relativePath });
  if (!document) return assetError("DOCUMENT_NOT_FOUND", "Document was not found in the current knowledge base.");

  const version = activeVersionRecord(state);
  const versionRoot = version?.path || "";
  const sidecar = versionRoot ? await readSidecarAsset(versionRoot, document) : emptySidecarAsset();
  const catalogAsset = sidecar.chunks > 0 ? null : readCatalogAsset(state, document);
  const asset = sidecar.chunks > 0 ? sidecar : catalogAsset;
  const assetStatus = sidecar.chunks > 0 ? "ready" : catalogAsset.chunks > 0 ? "catalog" : "missing";
  const pages = asset.pages.slice(cursor, cursor + limit);
  const nextCursor = cursor + pages.length < asset.pages.length ? String(cursor + pages.length) : "";

  return {
    ok: true,
    kind: "knowmesh.documentAsset",
    apiVersion: "v1.0.0",
    knowledgeBaseId: kbId,
    document: normalizeAssetDocument(document),
    version: version ? {
      id: version.id || "",
      active: version.active === true,
      createdAt: version.createdAt || "",
      sidecar: version.sidecar || null,
      target: version.target || null
    } : null,
    summary: {
      pages: asset.pages.length,
      chunks: asset.chunks,
      sourceParts: Array.isArray(document.sourceParts) ? document.sourceParts.length : 0,
      quality: asset.quality,
      contentTypes: asset.contentTypes
    },
    pages,
    pagination: {
      cursor: String(cursor),
      limit,
      returned: pages.length,
      nextCursor,
      hasMore: Boolean(nextCursor),
      totalPages: asset.pages.length
    },
    sidecar: {
      status: assetStatus,
      files: sidecar.files,
      versionRoot
    }
  };
}

function findInventoryDocument(inventory, input) {
  const documents = [
    ...(Array.isArray(inventory?.includedDocuments) ? inventory.includedDocuments : []),
    ...(Array.isArray(inventory?.excludedDocuments) ? inventory.excludedDocuments : [])
  ];
  return documents.find((document) => {
    const keys = [
      document.document_id,
      document.id,
      document.version_id,
      normalizeRelativePath(document.relativePath)
    ].map(normalizeKey).filter(Boolean);
    if (input.documentKey && keys.includes(input.documentKey)) return true;
    return input.relativePath && normalizeRelativePath(document.relativePath) === input.relativePath;
  }) || null;
}

function activeVersionRecord(state) {
  const versions = knowledgeBaseVersions(state, { limit: 100 });
  if (!versions.ok) return null;
  return versions.versions.find((item) => item.active) || versions.versions[0] || null;
}

function readCatalogAsset(state, document) {
  const kbId = currentKnowledgeBaseId(state);
  if (!kbId) return emptySidecarAsset();
  const db = openCatalogDatabase(state, kbId);
  try {
    const documentId = String(document.document_id || "");
    const versionId = String(document.version_id || "");
    const pageRows = db.prepare(`
      SELECT page_id, document_id, version_id, page_number, extraction_state, quality_state, metadata_json
      FROM pages
      WHERE (document_id = ? OR version_id = ?)
        AND extraction_state <> 'source_anchor'
      ORDER BY page_number ASC, page_id ASC
    `).all(documentId, versionId);
    if (!pageRows.length) return emptySidecarAsset();
    const blockRows = db.prepare(`
      SELECT page_id, block_id, block_type, sort_order, quality_state, metadata_json
      FROM blocks
      WHERE document_id = ?
      ORDER BY page_id ASC, sort_order ASC, block_id ASC
    `).all(documentId);
    const blocksByPage = new Map();
    for (const row of blockRows) {
      const list = blocksByPage.get(row.page_id) || [];
      list.push(row);
      blocksByPage.set(row.page_id, list);
    }
    return summarizeCatalogPages(pageRows, blocksByPage);
  } finally {
    db.close();
  }
}

function summarizeCatalogPages(pageRows, blocksByPage) {
  const contentTypes = {};
  const quality = { active: 0, review: 0, lowScore: 0 };
  const pages = pageRows.map((pageRow) => {
    const pageMetadata = parseJson(pageRow.metadata_json, {});
    const blocks = (blocksByPage.get(pageRow.page_id) || []).map((blockRow) => {
      const metadata = parseJson(blockRow.metadata_json, {});
      const score = Number(metadata.quality?.score ?? 0) || 0;
      const lifecycle = String(metadata.quality?.lifecycle || "");
      if (blockRow.quality_state === "review" || lifecycle === "review") quality.review += 1;
      else quality.active += 1;
      if (score && score < 70) quality.lowScore += 1;
      const contentType = String(metadata.contentType || blockRow.block_type || "");
      if (contentType) contentTypes[contentType] = (contentTypes[contentType] || 0) + 1;
      return {
        chunkId: String(metadata.chunk_id || metadata.taskId || blockRow.block_id || ""),
        contentType,
        quality: {
          score,
          tier: String(metadata.quality?.tier || blockRow.quality_state || ""),
          lifecycle,
          reasons: Array.isArray(metadata.quality?.reasons) ? metadata.quality.reasons : []
        },
        excerpt: clampText(metadata.textPreview || metadata.text || "", 1200),
        text: String(metadata.text || metadata.textPreview || "")
      };
    });
    const text = clampText(blocks.map((block) => block.text || block.excerpt).filter(Boolean).join("\n\n"), 12000);
    return {
      pageStart: Number(pageRow.page_number || 0) || 0,
      pageEnd: Math.max(Number(pageRow.page_number || 0) || 0, ...blocks.map((block) => Number(block.pageEnd || 0) || 0)),
      title: String(pageMetadata.title || ""),
      education: pageMetadata.education || {},
      chunks: blocks.map(({ text: _text, ...block }) => block),
      text
    };
  });
  return {
    chunks: [...blocksByPage.values()].reduce((total, blocks) => total + blocks.length, 0),
    pages,
    files: [],
    quality,
    contentTypes
  };
}

async function readSidecarAsset(versionRoot, document) {
  const files = sidecarChunkFiles(versionRoot);
  if (!files.length) return emptySidecarAsset();
  const cacheKey = sidecarCacheKey(versionRoot, document, files);
  const cached = assetCache.get(cacheKey);
  if (cached) return cached;

  const chunks = [];
  for (const file of files) {
    await collectDocumentChunks(file, document, chunks);
  }
  const asset = summarizeChunks(chunks, files);
  rememberAsset(cacheKey, asset);
  return asset;
}

function sidecarChunkFiles(versionRoot) {
  const root = path.join(versionRoot, "artifacts", "sidecar", "chunks");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(root, name))
    .filter((file) => {
      try {
        return fs.statSync(file).isFile() && fs.statSync(file).size > 0;
      } catch {
        return false;
      }
    })
    .sort((a, b) => a.localeCompare(b));
}

function sidecarCacheKey(versionRoot, document, files) {
  const fileStamp = files.map((file) => {
    const stat = fs.statSync(file);
    return `${path.basename(file)}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  }).join("|");
  return [
    path.resolve(versionRoot).toLowerCase(),
    normalizeKey(document.document_id || document.version_id || document.relativePath || ""),
    fileStamp
  ].join("::");
}

async function collectDocumentChunks(file, document, chunks) {
  const stream = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (chunkBelongsToDocument(item, document)) chunks.push(normalizeChunk(item));
  }
}

function chunkBelongsToDocument(chunk, document) {
  const documentId = normalizeKey(document.document_id || "");
  const versionId = normalizeKey(document.version_id || "");
  const relative = normalizeRelativePath(document.relativePath || "");
  if (documentId && normalizeKey(chunk.document_id || chunk.vectorMetadata?.doc || "") === documentId) return true;
  if (versionId && normalizeKey(chunk.version_id || "") === versionId) return true;
  return relative && normalizeRelativePath(chunk.sourceUri || chunk.citation?.sourceUri || "") === relative;
}

function normalizeChunk(chunk) {
  const pageStart = Number(chunk.page_start || chunk.pageStart || chunk.citation?.page_start || 0) || 0;
  const pageEnd = Number(chunk.page_end || chunk.pageEnd || chunk.citation?.page_end || pageStart || 0) || pageStart;
  const education = chunk.metadata?.education || {};
  return {
    chunkId: String(chunk.chunk_id || chunk.id || ""),
    pageStart,
    pageEnd,
    text: String(chunk.text || ""),
    excerpt: String(chunk.citation?.excerpt || chunk.text || ""),
    contentType: String(chunk.vectorMetadata?.ctype || chunk.metadata?.source || ""),
    quality: {
      score: Number(chunk.quality?.score ?? 0) || 0,
      tier: String(chunk.quality?.tier || ""),
      lifecycle: String(chunk.quality?.lifecycle || ""),
      reasons: Array.isArray(chunk.quality?.reasons) ? chunk.quality.reasons : []
    },
    metadata: {
      title: String(chunk.metadata?.title || ""),
      sourceType: String(chunk.metadata?.sourceType || ""),
      education: {
        stage: String(education.stage || ""),
        subject: String(education.subject || ""),
        grade: String(education.grade || ""),
        publisher: String(education.publisher || ""),
        volume: String(education.volume || ""),
        unit: education.unit_no ?? "",
        lesson: education.lesson_no ?? ""
      }
    }
  };
}

function summarizeChunks(chunks, files) {
  const pages = new Map();
  const contentTypes = {};
  const quality = { active: 0, review: 0, lowScore: 0 };
  for (const chunk of chunks.sort((a, b) => a.pageStart - b.pageStart || a.chunkId.localeCompare(b.chunkId))) {
    const pageKey = String(chunk.pageStart || 0);
    const page = pages.get(pageKey) || {
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      title: chunk.metadata.title,
      education: chunk.metadata.education,
      chunks: [],
      text: ""
    };
    page.pageEnd = Math.max(page.pageEnd || 0, chunk.pageEnd || page.pageStart || 0);
    page.chunks.push({
      chunkId: chunk.chunkId,
      contentType: chunk.contentType,
      quality: chunk.quality,
      excerpt: clampText(chunk.excerpt || chunk.text, 1200)
    });
    page.text = clampText([page.text, chunk.text].filter(Boolean).join("\n\n"), 12000);
    pages.set(pageKey, page);
    if (chunk.contentType) contentTypes[chunk.contentType] = (contentTypes[chunk.contentType] || 0) + 1;
    if (chunk.quality.lifecycle === "review") quality.review += 1;
    else quality.active += 1;
    if (chunk.quality.score && chunk.quality.score < 70) quality.lowScore += 1;
  }
  return {
    chunks: chunks.length,
    pages: [...pages.values()].sort((a, b) => a.pageStart - b.pageStart),
    files: files.map((file) => ({ path: file, name: path.basename(file) })),
    quality,
    contentTypes
  };
}

function rememberAsset(key, asset) {
  assetCache.set(key, asset);
  while (assetCache.size > maxCachedAssets) {
    const oldest = assetCache.keys().next().value;
    assetCache.delete(oldest);
  }
}

function normalizeAssetDocument(document) {
  return {
    status: document.status || "",
    reason: document.reason || "",
    document_id: document.document_id || "",
    version_id: document.version_id || "",
    displayVersion: document.displayVersion || document.display_version || "",
    title: document.title || document.relativePath || "",
    relativePath: normalizeRelativePath(document.relativePath || ""),
    sourceType: document.sourceType || "",
    source_fingerprint: document.source_fingerprint || "",
    updatedAt: document.updatedAt || "",
    sourceParts: Array.isArray(document.sourceParts) ? document.sourceParts : []
  };
}

function emptySidecarAsset() {
  return { chunks: 0, pages: [], files: [], quality: { active: 0, review: 0, lowScore: 0 }, contentTypes: {} };
}

function assetError(code, message) {
  return { ok: false, error: message, code };
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function clampText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
