import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const sourceAnchorState = "source_anchor";
const completedStates = new Set(["extracted", "recognized"]);
const failedStates = new Set(["failed", "missing", "error"]);

export function readExtractionManifestFromCatalog(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyExtractionManifest();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const documentRows = db.prepare(`
      SELECT
        sd.document_id,
        sd.title,
        sd.source_type,
        sd.normalized_relative_path,
        sd.status AS document_status,
        sd.quality_state AS document_quality_state,
        sd.metadata_json AS document_metadata_json,
        dv.version_id,
        dv.display_version,
        dv.status AS version_status,
        dv.content_hash AS version_content_hash,
        dv.artifact_path AS version_artifact_path,
        dv.metadata_json AS version_metadata_json,
        dv.updated_at AS version_updated_at
      FROM source_documents sd
      LEFT JOIN document_versions dv ON dv.document_id = sd.document_id
      ORDER BY sd.normalized_relative_path ASC, dv.updated_at DESC, dv.version_id DESC
    `).all();
    const pageRows = db.prepare(`
      SELECT
        p.page_id,
        p.document_id,
        p.version_id,
        p.page_number,
        p.artifact_path,
        p.text_hash,
        p.extraction_state,
        p.quality_state,
        p.metadata_json,
        p.updated_at
      FROM pages p
      ORDER BY p.version_id ASC, p.page_number ASC, p.page_id ASC
    `).all();
    const blockRows = db.prepare(`
      SELECT
        b.block_id,
        b.page_id,
        b.document_id,
        b.block_type,
        b.sort_order,
        b.text_path,
        b.text_hash,
        b.structure_path,
        b.quality_state,
        b.metadata_json,
        b.updated_at
      FROM blocks b
      ORDER BY b.page_id ASC, b.sort_order ASC, b.block_id ASC
    `).all();
    const qualityIssues = numberScalar(db, "SELECT count(*) FROM quality_issues WHERE status = 'open'");
    const blocksByPage = groupBlocksByPage(blockRows);
    const pagesByVersion = groupPagesByVersion(pageRows, blocksByPage);
    const workItems = buildWorkItems(documentRows, pagesByVersion);
    return {
      ok: true,
      kind: "knowmesh.extractionManifest",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeExtraction(workItems, qualityIssues),
      workItems
    };
  } finally {
    db.close();
  }
}

function buildWorkItems(documentRows, pagesByVersion) {
  return documentRows
    .filter((row) => row.version_id)
    .map((row) => {
      const documentMetadata = parseJson(row.document_metadata_json, {});
      const versionMetadata = parseJson(row.version_metadata_json, {});
      const pages = pagesByVersion.get(row.version_id) || [];
      const sourceAnchor = pages.find((page) => page.extractionState === sourceAnchorState) || null;
      const extractionPages = pages.filter((page) => page.extractionState !== sourceAnchorState);
      const status = workItemStatus(extractionPages);
      return {
        documentId: String(row.document_id || ""),
        versionId: String(row.version_id || ""),
        displayVersion: String(row.display_version || ""),
        title: String(row.title || row.normalized_relative_path || ""),
        relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
        sourceType: String(row.source_type || ""),
        documentStatus: String(row.document_status || ""),
        versionStatus: String(row.version_status || ""),
        qualityState: String(row.document_quality_state || ""),
        status,
        sourceAnchor: sourceAnchor ? compactPage(sourceAnchor) : null,
        pages: extractionPages.map(compactPage),
        blocks: extractionPages.reduce((total, page) => total + page.blocks.length, 0),
        sourceParts: Array.isArray(documentMetadata.sourceParts) ? documentMetadata.sourceParts.map(compactSourcePart) : [],
        metadata: {
          sourceRoot: documentMetadata.sourceRoot || "",
          workspaceRoot: documentMetadata.workspaceRoot || "",
          artifactPath: row.version_artifact_path || "",
          sourceUri: documentMetadata.sourceUri || versionMetadata.sourceUri || ""
        }
      };
    });
}

function groupPagesByVersion(rows, blocksByPage) {
  const byVersion = new Map();
  for (const row of rows) {
    const metadata = parseJson(row.metadata_json, {});
    const page = {
      pageId: String(row.page_id || ""),
      documentId: String(row.document_id || ""),
      versionId: String(row.version_id || ""),
      pageNumber: Number(row.page_number || 0),
      artifactPath: normalizeRelativePath(row.artifact_path || ""),
      textHash: String(row.text_hash || ""),
      extractionState: String(row.extraction_state || ""),
      qualityState: String(row.quality_state || ""),
      source: String(metadata.source || ""),
      inputKind: String(metadata.inputKind || ""),
      confidence: metadata.confidence ?? null,
      characters: Number(metadata.characters || 0),
      retry: metadata.retry && typeof metadata.retry === "object" ? metadata.retry : null,
      retryable: Boolean(metadata.retry?.retryable === true || failedStates.has(String(row.extraction_state || ""))),
      message: String(metadata.message || ""),
      updatedAt: String(row.updated_at || ""),
      blocks: blocksByPage.get(row.page_id) || []
    };
    if (!byVersion.has(page.versionId)) byVersion.set(page.versionId, []);
    byVersion.get(page.versionId).push(page);
  }
  return byVersion;
}

function groupBlocksByPage(rows) {
  const byPage = new Map();
  for (const row of rows) {
    const metadata = parseJson(row.metadata_json, {});
    const block = {
      blockId: String(row.block_id || ""),
      pageId: String(row.page_id || ""),
      documentId: String(row.document_id || ""),
      blockType: String(row.block_type || ""),
      sortOrder: Number(row.sort_order || 0),
      textPath: normalizeRelativePath(row.text_path || ""),
      textHash: String(row.text_hash || ""),
      structurePath: String(row.structure_path || ""),
      qualityState: String(row.quality_state || ""),
      source: String(metadata.source || ""),
      confidence: metadata.confidence ?? null,
      updatedAt: String(row.updated_at || "")
    };
    if (!byPage.has(block.pageId)) byPage.set(block.pageId, []);
    byPage.get(block.pageId).push(block);
  }
  return byPage;
}

function workItemStatus(pages) {
  if (!pages.length) return "pending";
  if (pages.some((page) => page.retryable)) return "retry";
  if (pages.some((page) => page.qualityState === "review")) return "review";
  if (pages.some((page) => completedStates.has(page.extractionState))) return "completed";
  return "pending";
}

function compactPage(page) {
  return {
    pageId: page.pageId,
    pageNumber: page.pageNumber,
    artifactPath: page.artifactPath,
    textHash: page.textHash,
    extractionState: page.extractionState,
    qualityState: page.qualityState,
    source: page.source,
    inputKind: page.inputKind,
    confidence: page.confidence,
    characters: page.characters,
    retryable: page.retryable,
    retry: page.retry,
    message: page.message,
    blocks: page.blocks
  };
}

function summarizeExtraction(workItems, qualityIssues) {
  const allPages = workItems.flatMap((item) => [item.sourceAnchor, ...item.pages].filter(Boolean));
  const extractionPages = workItems.flatMap((item) => item.pages);
  return {
    sourceDocuments: new Set(workItems.map((item) => item.documentId).filter(Boolean)).size,
    documentVersions: workItems.length,
    sourceAnchors: allPages.filter((page) => page.extractionState === sourceAnchorState).length,
    extractionPages: extractionPages.length,
    pendingDocuments: workItems.filter((item) => item.status === "pending").length,
    completedDocuments: workItems.filter((item) => item.status === "completed").length,
    reviewDocuments: workItems.filter((item) => item.status === "review").length,
    retryDocuments: workItems.filter((item) => item.status === "retry").length,
    extractedPages: extractionPages.filter((page) => page.extractionState === "extracted").length,
    recognizedPages: extractionPages.filter((page) => page.extractionState === "recognized").length,
    failedPages: extractionPages.filter((page) => failedStates.has(page.extractionState)).length,
    completedPages: extractionPages.filter((page) => completedStates.has(page.extractionState)).length,
    reviewPages: extractionPages.filter((page) => page.qualityState === "review").length,
    retryablePages: extractionPages.filter((page) => page.retryable).length,
    blocks: extractionPages.reduce((total, page) => total + page.blocks.length, 0),
    openQualityIssues: qualityIssues
  };
}

function compactSourcePart(part = {}) {
  return {
    relativePath: normalizeRelativePath(part.relativePath || ""),
    size: Number(part.size || 0),
    sha256: String(part.sha256 || "")
  };
}

function numberScalar(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return Number(row ? Object.values(row)[0] || 0 : 0);
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function emptyExtractionManifest() {
  return {
    ok: false,
    kind: "knowmesh.extractionManifest",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "" },
    summary: {
      sourceDocuments: 0,
      documentVersions: 0,
      sourceAnchors: 0,
      extractionPages: 0,
      pendingDocuments: 0,
      completedDocuments: 0,
      reviewDocuments: 0,
      retryDocuments: 0,
      extractedPages: 0,
      recognizedPages: 0,
      failedPages: 0,
      completedPages: 0,
      reviewPages: 0,
      retryablePages: 0,
      blocks: 0,
      openQualityIssues: 0
    },
    workItems: []
  };
}
