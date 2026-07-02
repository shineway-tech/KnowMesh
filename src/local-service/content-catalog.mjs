import crypto from "node:crypto";

import { k12TemplateId } from "../core/document-scope.mjs";
import { extractK12EducationMetadata } from "../core/k12-metadata.mjs";
import { classifyK12Page, k12ContentTypeForRecord } from "../core/k12-page-classifier.mjs";
import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function syncCleanArtifactsToCatalog(state, clean = {}, context = {}) {
  const knowledgeBaseId = String(context.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, pages: 0, blocks: 0 };

  const normalizedByDocument = new Map((clean.normalized || []).map((document) => [document.document_id, document]));
  const chunks = Array.isArray(clean.chunks) ? clean.chunks : [];
  const qualityByDocument = cleanQualityByDocument(chunks);
  const basePages = [...normalizedByDocument.values()].map((document) => cleanDocumentPage(document, {
    ...context,
    qualityState: qualityByDocument.get(document.document_id) || "primary"
  }));
  const blocks = chunks.map((chunk, index) => cleanChunkBlock(chunk, normalizedByDocument.get(chunk.document_id), index, context)).filter(Boolean);
  const chunkRows = chunks.map((chunk) => cleanChunkRow(chunk, normalizedByDocument.get(chunk.document_id), context)).filter(Boolean);
  const pages = uniquePages([
    ...basePages,
    ...chunkRows.map((chunk) => cleanChunkPage(chunk, normalizedByDocument.get(chunk.documentId), context)).filter(Boolean)
  ]);
  const citations = chunkRows.map((chunk) => citationForChunk(chunk)).filter(Boolean);
  return writeContentRows(state, knowledgeBaseId, { pages, blocks, chunks: chunkRows, citations });
}

export function syncOcrResultsToCatalog(state, records = [], context = {}) {
  const knowledgeBaseId = String(context.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, pages: 0, blocks: 0 };
  const recognized = (Array.isArray(records) ? records : []).filter((record) => record?.status === "recognized");
  const pages = recognized.map((record) => ocrResultPage(record, context));
  const blocks = recognized.map((record, index) => ocrResultBlock(record, index, context));
  const chunks = recognized.map((record) => ocrChunkRow(record, context)).filter(Boolean);
  const citations = chunks.map((chunk) => citationForChunk(chunk)).filter(Boolean);
  return writeContentRows(state, knowledgeBaseId, { pages, blocks, chunks, citations });
}

export function readCatalogChunks(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return [];
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    return db.prepare(`
      SELECT
        c.chunk_id,
        c.document_id,
        c.quality_state,
        c.metadata_json,
        sd.title AS document_title,
        sd.source_type,
        sd.normalized_relative_path,
        ci.source_label,
        ci.page_number,
        ci.metadata_json AS citation_metadata_json
      FROM chunks c
      LEFT JOIN source_documents sd ON sd.document_id = c.document_id
      LEFT JOIN citations ci ON ci.citation_id = (
        SELECT citation_id
        FROM citations
        WHERE chunk_id = c.chunk_id
        ORDER BY page_number ASC, citation_id ASC
        LIMIT 1
      )
      WHERE c.quality_state NOT IN ('archive', 'archived', 'excluded', 'excluded_by_user')
      ORDER BY c.updated_at DESC, c.chunk_id ASC
    `).all().map((row) => catalogChunkRowToValidationChunk(row, options)).filter(Boolean);
  } finally {
    db.close();
  }
}

function writeContentRows(state, knowledgeBaseId, rows) {
  const pages = rows.pages || [];
  const blocks = rows.blocks || [];
  const chunks = rows.chunks || [];
  const citations = rows.citations || [];
  const structureNodes = buildStructureNodes(pages);
  const knowledgeObjects = buildKnowledgeObjects(chunks);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const ensureSource = db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO NOTHING
    `);
    const upsertPage = db.prepare(`
      INSERT INTO pages (
        page_id, document_id, version_id, page_number, artifact_path,
        text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET
        document_id = excluded.document_id,
        version_id = excluded.version_id,
        page_number = excluded.page_number,
        artifact_path = excluded.artifact_path,
        text_hash = excluded.text_hash,
        extraction_state = excluded.extraction_state,
        quality_state = excluded.quality_state,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const upsertBlock = db.prepare(`
      INSERT INTO blocks (
        block_id, page_id, document_id, block_type, sort_order,
        text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(block_id) DO UPDATE SET
        page_id = excluded.page_id,
        document_id = excluded.document_id,
        block_type = excluded.block_type,
        sort_order = excluded.sort_order,
        text_path = excluded.text_path,
        text_hash = excluded.text_hash,
        structure_path = excluded.structure_path,
        quality_state = excluded.quality_state,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const upsertStructureNode = db.prepare(`
      INSERT INTO structure_nodes (
        node_id, parent_id, document_id, node_type, title, sort_order,
        page_start, page_end, path, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        parent_id = excluded.parent_id,
        document_id = excluded.document_id,
        node_type = excluded.node_type,
        title = excluded.title,
        sort_order = excluded.sort_order,
        page_start = excluded.page_start,
        page_end = excluded.page_end,
        path = excluded.path,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const upsertKnowledgeObject = db.prepare(`
      INSERT INTO knowledge_objects (
        object_id, document_id, structure_node_id, object_type, title,
        source_page, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id) DO UPDATE SET
        document_id = excluded.document_id,
        structure_node_id = excluded.structure_node_id,
        object_type = excluded.object_type,
        title = excluded.title,
        source_page = excluded.source_page,
        quality_state = excluded.quality_state,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const upsertChunk = db.prepare(`
      INSERT INTO chunks (
        chunk_id, document_id, object_id, block_id, structure_node_id,
        text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET
        document_id = excluded.document_id,
        object_id = excluded.object_id,
        block_id = excluded.block_id,
        structure_node_id = excluded.structure_node_id,
        text_path = excluded.text_path,
        text_hash = excluded.text_hash,
        token_count = excluded.token_count,
        quality_state = excluded.quality_state,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const upsertCitation = db.prepare(`
      INSERT INTO citations (
        citation_id, chunk_id, document_id, page_id, block_id, structure_node_id,
        source_label, page_number, anchor, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(citation_id) DO UPDATE SET
        chunk_id = excluded.chunk_id,
        document_id = excluded.document_id,
        page_id = excluded.page_id,
        block_id = excluded.block_id,
        structure_node_id = excluded.structure_node_id,
        source_label = excluded.source_label,
        page_number = excluded.page_number,
        anchor = excluded.anchor,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `);
    const write = db.transaction(() => {
      const now = nowIso();
      for (const page of pages) {
        ensureSource.run(
          page.documentId,
          page.title,
          page.sourceType,
          page.sourceUri,
          page.relativePath,
          "",
          process.platform,
          "included",
          "primary",
          stableJson({ sourceUri: page.sourceUri, relativePath: page.relativePath }),
          now,
          now
        );
        upsertPage.run(
          page.pageId,
          page.documentId,
          page.versionId,
          page.pageNumber,
          page.artifactPath,
          page.textHash,
          page.extractionState,
          page.qualityState,
          stableJson(page.metadata),
          now,
          now
        );
      }
      for (const block of blocks) {
        upsertBlock.run(
          block.blockId,
          block.pageId,
          block.documentId,
          block.blockType,
          block.sortOrder,
          block.textPath,
          block.textHash,
          block.structurePath,
          block.qualityState,
          stableJson(block.metadata),
          now,
          now
        );
      }
      for (const node of structureNodes) {
        upsertStructureNode.run(
          node.nodeId,
          node.parentId || null,
          node.documentId,
          node.nodeType,
          node.title,
          node.sortOrder,
          node.pageStart,
          node.pageEnd,
          node.path,
          stableJson(node.metadata),
          now,
          now
        );
      }
      for (const object of knowledgeObjects) {
        upsertKnowledgeObject.run(
          object.objectId,
          object.documentId,
          object.structureNodeId || null,
          object.objectType,
          object.title,
          object.sourcePage,
          object.qualityState,
          stableJson(object.metadata),
          now,
          now
        );
      }
      for (const chunk of chunks) {
        upsertChunk.run(
          chunk.chunkId,
          chunk.documentId,
          chunk.objectId || knowledgeObjectId(chunk.chunkId),
          chunk.blockId || null,
          chunk.structureNodeId || (chunk.pageId ? pageStructureNodeId(chunk.pageId) : null),
          chunk.textPath,
          chunk.textHash,
          chunk.tokenCount,
          chunk.qualityState,
          stableJson(chunk.metadata),
          now,
          now
        );
      }
      for (const citation of citations) {
        upsertCitation.run(
          citation.citationId,
          citation.chunkId,
          citation.documentId,
          citation.pageId,
          citation.blockId || null,
          citation.structureNodeId || (citation.pageId ? pageStructureNodeId(citation.pageId) : null),
          citation.sourceLabel,
          citation.pageNumber,
          citation.anchor,
          stableJson(citation.metadata),
          now,
          now
        );
      }
    });
    write();
    return {
      ok: true,
      pages: pages.length,
      blocks: blocks.length,
      structureNodes: structureNodes.length,
      knowledgeObjects: knowledgeObjects.length,
      chunks: chunks.length,
      citations: citations.length
    };
  } finally {
    db.close();
  }
}

function buildStructureNodes(pages = []) {
  const documents = new Map();
  const pageNodes = [];
  for (const page of pages) {
    if (!page.documentId) continue;
    const metadata = page.metadata || {};
    const documentNodeId = documentStructureNodeId(page.documentId);
    const existing = documents.get(page.documentId);
    const pageStart = Number(page.pageNumber || 1) || 1;
    const documentPath = metadata.relativePath || page.relativePath || page.sourceUri || "";
    documents.set(page.documentId, {
      nodeId: documentNodeId,
      parentId: null,
      documentId: page.documentId,
      nodeType: "document",
      title: metadata.title || page.title || documentPath || page.documentId,
      sortOrder: existing?.sortOrder ?? documents.size,
      pageStart: Math.min(existing?.pageStart ?? pageStart, pageStart),
      pageEnd: Math.max(existing?.pageEnd ?? pageStart, pageStart),
      path: documentPath,
      metadata: {
        title: metadata.title || page.title || "",
        relativePath: documentPath,
        sourceType: metadata.sourceType || page.sourceType || "",
        sourceUri: metadata.sourceUri || page.sourceUri || documentPath,
        source: metadata.source || ""
      }
    });
    pageNodes.push({
      nodeId: pageStructureNodeId(page.pageId),
      parentId: documentNodeId,
      documentId: page.documentId,
      nodeType: "page",
      title: `${metadata.title || page.title || documentPath || page.documentId} p.${pageStart}`,
      sortOrder: pageStart,
      pageStart,
      pageEnd: pageStart,
      path: `${documentPath}#page=${pageStart}`,
      metadata: {
        title: metadata.title || page.title || "",
        relativePath: documentPath,
        sourceType: metadata.sourceType || page.sourceType || "",
        sourceUri: metadata.sourceUri || page.sourceUri || documentPath,
        pageNumber: pageStart,
        source: metadata.source || ""
      }
    });
  }
  return [...documents.values(), ...pageNodes];
}

function buildKnowledgeObjects(chunks = []) {
  return chunks.map((chunk) => {
    if (!chunk?.chunkId || !chunk.documentId) return null;
    const metadata = chunk.metadata || {};
    return {
      objectId: chunk.objectId || knowledgeObjectId(chunk.chunkId),
      documentId: chunk.documentId,
      structureNodeId: chunk.structureNodeId || "",
      objectType: chunk.objectType || metadata.contentType || "body_text",
      title: metadata.title || chunk.sourceLabel || chunk.documentId,
      sourcePage: metadata.page_start ?? chunk.pageNumber ?? null,
      qualityState: chunk.qualityState || "primary",
      metadata: {
        chunk_id: chunk.chunkId,
        document_id: chunk.documentId,
        version_id: metadata.version_id || "",
        sourceUri: metadata.sourceUri || "",
        relativePath: metadata.relativePath || "",
        sourceType: metadata.sourceType || "",
        page_start: metadata.page_start ?? null,
        page_end: metadata.page_end ?? null,
        textPreview: metadata.textPreview || clampText(metadata.text || "", 1200)
      }
    };
  }).filter(Boolean);
}

function catalogChunkRowToValidationChunk(row, options = {}) {
  const metadata = parseJson(row.metadata_json, {});
  if (!options.includeInactive && metadata.active === false) return null;
  if (!options.includeWriteDisabled && metadata.quality?.writeEnabled === false) return null;
  const citation = parseJson(row.citation_metadata_json, {});
  const nestedMetadata = metadata.metadata && typeof metadata.metadata === "object" ? metadata.metadata : {};
  const text = String(metadata.text || metadata.textPreview || citation.excerpt || "").trim();
  if (!text) return null;
  const sourceUri = String(
    metadata.sourceUri ||
    nestedMetadata.sourceUri ||
    citation.sourceUri ||
    row.normalized_relative_path ||
    ""
  );
  const pageStart = firstPresent(metadata.page_start, metadata.pageStart, citation.page_start, row.page_number);
  const pageEnd = firstPresent(metadata.page_end, metadata.pageEnd, citation.page_end, pageStart);
  return {
    chunk_id: row.chunk_id,
    document_id: metadata.document_id || metadata.documentId || row.document_id || "",
    version_id: metadata.version_id || metadata.versionId || "",
    active: metadata.active !== false,
    text,
    sourceUri,
    sourceParts: Array.isArray(metadata.sourceParts) ? metadata.sourceParts : [],
    page_start: pageStart,
    page_end: pageEnd,
    metadata: {
      ...nestedMetadata,
      title: nestedMetadata.title || metadata.title || citation.title || row.source_label || row.document_title || "",
      sourceUri,
      relativePath: metadata.relativePath || citation.relativePath || row.normalized_relative_path || "",
      sourceType: nestedMetadata.sourceType || metadata.sourceType || citation.sourceType || row.source_type || "",
      source: nestedMetadata.source || metadata.source || "catalog-chunk",
      pageNumber: nestedMetadata.pageNumber ?? pageStart
    },
    quality: metadata.quality || { tier: row.quality_state || "primary", writeEnabled: true },
    status: "catalog"
  };
}

function cleanDocumentPage(document = {}, context = {}) {
  const text = String(document.text || "");
  const pageId = pageIdFor(document.version_id, 1);
  const classification = classifyK12CatalogRecord({
    text,
    title: document.title || document.relativePath || "",
    relativePath: document.relativePath || "",
    sourceType: document.sourceType || "",
    pageNumber: 1,
    source: "clean"
  }, context);
  return {
    pageId,
    documentId: String(document.document_id || ""),
    versionId: String(document.version_id || ""),
    pageNumber: 1,
    artifactPath: normalizeRelativePath(context.normalizedPath || ""),
    textHash: sha256(text),
    extractionState: "extracted",
    qualityState: context.qualityState || "primary",
    title: String(document.title || document.relativePath || ""),
    relativePath: normalizeRelativePath(document.relativePath || ""),
    sourceType: String(document.sourceType || ""),
    sourceUri: normalizeRelativePath(document.relativePath || ""),
    metadata: {
      title: document.title || "",
      relativePath: normalizeRelativePath(document.relativePath || ""),
      sourceType: document.sourceType || "",
      source: "clean",
      characters: text.length,
      pageClassification: classification.pageClassification
    }
  };
}

function cleanChunkPage(chunk = {}, document = {}, context = {}) {
  if (!chunk.pageId || !chunk.documentId) return null;
  const pageNumber = Number(chunk.pageNumber || chunk.metadata?.page_start || 1) || 1;
  const title = chunk.metadata?.title || document?.title || chunk.documentId;
  const relativePath = normalizeRelativePath(chunk.metadata?.relativePath || document?.relativePath || "");
  return {
    pageId: chunk.pageId,
    documentId: String(chunk.documentId || ""),
    versionId: String(chunk.metadata?.version_id || document?.version_id || ""),
    pageNumber,
    artifactPath: normalizeRelativePath(context.normalizedPath || ""),
    textHash: chunk.textHash || "",
    extractionState: "extracted",
    qualityState: chunk.qualityState || "primary",
    title,
    relativePath,
    sourceType: String(chunk.metadata?.sourceType || document?.sourceType || ""),
    sourceUri: normalizeRelativePath(chunk.metadata?.sourceUri || document?.relativePath || relativePath),
    metadata: {
      title,
      relativePath,
      sourceType: chunk.metadata?.sourceType || document?.sourceType || "",
      sourceUri: normalizeRelativePath(chunk.metadata?.sourceUri || document?.relativePath || relativePath),
      source: chunk.metadata?.source || "cleaned-chunk",
      characters: String(chunk.metadata?.text || chunk.metadata?.textPreview || "").length,
      pageNumber,
      pageClassification: chunk.metadata?.pageClassification || null
    }
  };
}

function cleanChunkBlock(chunk = {}, document = {}, index = 0, context = {}) {
  if (!chunk.chunk_id || !chunk.document_id) return null;
  const text = String(chunk.text || "");
  const pageNumber = Number(chunk.page_start || 1) || 1;
  const qualityState = qualityStateForChunk(chunk);
  const classification = classifyK12CatalogRecord({
    text,
    title: chunk.metadata?.title || document?.title || "",
    relativePath: chunk.metadata?.relativePath || document?.relativePath || "",
    sourceType: chunk.metadata?.sourceType || document?.sourceType || "",
    pageNumber,
    source: chunk.metadata?.source || "cleaned-chunk",
    metadata: chunk.metadata || {}
  }, context);
  return {
    blockId: String(chunk.chunk_id),
    pageId: pageIdFor(chunk.version_id, pageNumber),
    documentId: String(chunk.document_id || ""),
    blockType: classification.contentType || "body_text",
    sortOrder: index,
    textPath: normalizeRelativePath(context.chunksPath || ""),
    textHash: sha256(text),
    structurePath: "",
    qualityState,
    metadata: {
      chunk_id: chunk.chunk_id,
      version_id: chunk.version_id || "",
      title: chunk.metadata?.title || document?.title || "",
      relativePath: normalizeRelativePath(chunk.metadata?.relativePath || document?.relativePath || ""),
      sourceUri: normalizeRelativePath(chunk.sourceUri || document?.relativePath || ""),
      sourceType: chunk.metadata?.sourceType || document?.sourceType || "",
      page_start: pageNumber,
      page_end: Number(chunk.page_end || pageNumber) || pageNumber,
      text,
      textPreview: clampText(text, 1200),
      source: chunk.metadata?.source || "cleaned-chunk",
      contentType: classification.contentType || "body_text",
      education: classification.education,
      pageClassification: classification.pageClassification
    }
  };
}

function cleanChunkRow(chunk = {}, document = {}, context = {}) {
  if (!chunk.chunk_id || !chunk.document_id) return null;
  const text = String(chunk.text || "");
  const pageNumber = Number(chunk.page_start || 1) || 1;
  const qualityState = qualityStateForChunk(chunk);
  const classification = classifyK12CatalogRecord({
    text,
    title: chunk.metadata?.title || document?.title || "",
    relativePath: chunk.metadata?.relativePath || document?.relativePath || "",
    sourceType: chunk.metadata?.sourceType || document?.sourceType || "",
    pageNumber,
    source: chunk.metadata?.source || "cleaned-chunk",
    metadata: chunk.metadata || {}
  }, context);
  return {
    chunkId: String(chunk.chunk_id),
    documentId: String(chunk.document_id),
    objectId: knowledgeObjectId(chunk.chunk_id),
    blockId: String(chunk.chunk_id),
    structureNodeId: pageStructureNodeId(pageIdFor(chunk.version_id, pageNumber)),
    pageId: pageIdFor(chunk.version_id, pageNumber),
    pageNumber,
    sourceLabel: chunk.metadata?.title || document?.title || "",
    textPath: normalizeRelativePath(context.chunksPath || ""),
    textHash: sha256(text),
    tokenCount: estimateTokenCount(text),
    qualityState,
    objectType: classification.contentType || "body_text",
    metadata: {
      chunk_id: chunk.chunk_id,
      document_id: chunk.document_id,
      version_id: chunk.version_id || "",
      title: chunk.metadata?.title || document?.title || "",
      relativePath: normalizeRelativePath(chunk.metadata?.relativePath || document?.relativePath || ""),
      sourceUri: normalizeRelativePath(chunk.sourceUri || document?.relativePath || ""),
      sourceType: chunk.metadata?.sourceType || document?.sourceType || "",
      sourceParts: Array.isArray(chunk.sourceParts) ? chunk.sourceParts : [],
      page_start: pageNumber,
      page_end: Number(chunk.page_end || pageNumber) || pageNumber,
      text,
      textPreview: clampText(text, 1200),
      source: chunk.metadata?.source || "cleaned-chunk",
      contentType: classification.contentType || "body_text",
      education: classification.education,
      pageClassification: classification.pageClassification,
      metadata: chunk.metadata || {}
    }
  };
}

function ocrResultPage(record = {}, context = {}) {
  const pageNumber = Number(record.page_number || 1) || 1;
  const text = String(record.text || "");
  const classification = classifyK12CatalogRecord({
    text,
    title: record.title || record.relativePath || "",
    relativePath: record.relativePath || "",
    sourceType: record.sourceType || "",
    pageNumber,
    source: "ocr-page",
    metadata: {
      title: record.title || "",
      sourceType: record.sourceType || "",
      inputKind: record.inputKind || ""
    }
  }, context);
  return {
    pageId: pageIdFor(record.version_id, pageNumber),
    documentId: String(record.document_id || ""),
    versionId: String(record.version_id || ""),
    pageNumber,
    artifactPath: normalizeRelativePath(record.inputPath || context.resultPath || ""),
    textHash: sha256(text),
    extractionState: "recognized",
    qualityState: Number(record.confidence || 0) && Number(record.confidence || 0) < 70 ? "review" : "primary",
    title: String(record.title || record.relativePath || ""),
    relativePath: normalizeRelativePath(record.relativePath || ""),
    sourceType: String(record.sourceType || ""),
    sourceUri: normalizeRelativePath(record.relativePath || ""),
    metadata: {
      title: record.title || "",
      relativePath: normalizeRelativePath(record.relativePath || ""),
      sourceType: record.sourceType || "",
      source: "ocr",
      inputKind: record.inputKind || "",
      confidence: record.confidence ?? null,
      characters: text.length,
      pageClassification: classification.pageClassification
    }
  };
}

function ocrResultBlock(record = {}, index = 0, context = {}) {
  const pageNumber = Number(record.page_number || 1) || 1;
  const text = String(record.text || "");
  const classification = classifyK12CatalogRecord({
    text,
    title: record.title || record.relativePath || "",
    relativePath: record.relativePath || "",
    sourceType: record.sourceType || "",
    pageNumber,
    source: "ocr-page",
    metadata: {
      title: record.title || "",
      sourceType: record.sourceType || "",
      inputKind: record.inputKind || ""
    }
  }, context);
  return {
    blockId: `${record.taskId || record.version_id || "ocr"}:block`,
    pageId: pageIdFor(record.version_id, pageNumber),
    documentId: String(record.document_id || ""),
    blockType: classification.contentType || "ocr_text",
    sortOrder: index,
    textPath: normalizeRelativePath(context.resultPath || ""),
    textHash: sha256(text),
    structurePath: "",
    qualityState: Number(record.confidence || 0) && Number(record.confidence || 0) < 70 ? "review" : "primary",
    metadata: {
      taskId: record.taskId || "",
      version_id: record.version_id || "",
      title: record.title || "",
      relativePath: normalizeRelativePath(record.relativePath || ""),
      sourceUri: normalizeRelativePath(record.relativePath || ""),
      sourceType: record.sourceType || "",
      page_start: pageNumber,
      page_end: pageNumber,
      text,
      textPreview: clampText(text, 1200),
      source: "ocr-page",
      confidence: record.confidence ?? null,
      contentType: classification.contentType || "ocr_text",
      education: classification.education,
      pageClassification: classification.pageClassification
    }
  };
}

function ocrChunkRow(record = {}, context = {}) {
  if (!record.taskId || !record.document_id) return null;
  const text = String(record.text || "");
  const pageNumber = Number(record.page_number || 1) || 1;
  const classification = classifyK12CatalogRecord({
    text,
    title: record.title || record.relativePath || "",
    relativePath: record.relativePath || "",
    sourceType: record.sourceType || "",
    pageNumber,
    source: "ocr-page",
    metadata: {
      title: record.title || "",
      sourceType: record.sourceType || "",
      inputKind: record.inputKind || ""
    }
  }, context);
  return {
    chunkId: `${record.taskId}:chunk`,
    documentId: String(record.document_id),
    objectId: knowledgeObjectId(`${record.taskId}:chunk`),
    blockId: `${record.taskId || record.version_id || "ocr"}:block`,
    structureNodeId: pageStructureNodeId(pageIdFor(record.version_id, pageNumber)),
    pageId: pageIdFor(record.version_id, pageNumber),
    pageNumber,
    sourceLabel: record.title || record.relativePath || "",
    textPath: normalizeRelativePath(context.resultPath || ""),
    textHash: sha256(text),
    tokenCount: estimateTokenCount(text),
    qualityState: Number(record.confidence || 0) && Number(record.confidence || 0) < 70 ? "review" : "primary",
    objectType: classification.contentType || "ocr_text",
    metadata: {
      chunk_id: `${record.taskId}:chunk`,
      document_id: record.document_id,
      version_id: record.version_id || "",
      title: record.title || "",
      relativePath: normalizeRelativePath(record.relativePath || ""),
      sourceUri: normalizeRelativePath(record.relativePath || ""),
      sourceType: record.sourceType || "",
      page_start: pageNumber,
      page_end: pageNumber,
      text,
      textPreview: clampText(text, 1200),
      source: "ocr-page",
      confidence: record.confidence ?? null,
      contentType: classification.contentType || "ocr_text",
      education: classification.education,
      pageClassification: classification.pageClassification,
      metadata: {
        title: record.title || "",
        sourceType: record.sourceType || "",
        inputKind: record.inputKind || ""
      }
    }
  };
}

function citationForChunk(chunk) {
  if (!chunk?.chunkId || !chunk.documentId) return null;
  return {
    citationId: `${chunk.chunkId}:source`,
    chunkId: chunk.chunkId,
    documentId: chunk.documentId,
    pageId: chunk.pageId || "",
    blockId: chunk.blockId || "",
    structureNodeId: chunk.structureNodeId || "",
    sourceLabel: chunk.sourceLabel || chunk.metadata?.title || "",
    pageNumber: chunk.pageNumber || chunk.metadata?.page_start || null,
    anchor: "",
    metadata: {
      title: chunk.metadata?.title || "",
      relativePath: chunk.metadata?.relativePath || "",
      sourceUri: chunk.metadata?.sourceUri || "",
      sourceType: chunk.metadata?.sourceType || "",
      excerpt: clampText(chunk.metadata?.text || chunk.metadata?.textPreview || "", 1200),
      page_start: chunk.metadata?.page_start ?? null,
      page_end: chunk.metadata?.page_end ?? null
    }
  };
}

function pageIdFor(versionId, pageNumber) {
  return `${versionId || "document"}:page:${String(pageNumber || 1).padStart(4, "0")}`;
}

function documentStructureNodeId(documentId) {
  return `${documentId || "document"}:structure:document`;
}

function pageStructureNodeId(pageId) {
  return `${pageId || "page"}:structure`;
}

function knowledgeObjectId(chunkId) {
  return `${chunkId || "chunk"}:object`;
}

function classifyK12CatalogRecord(record = {}, context = {}) {
  if (!isK12Context(context)) {
    return { contentType: "", education: null, pageClassification: null };
  }
  const metadata = {
    ...(record.metadata || {}),
    title: record.title || record.metadata?.title || "",
    relativePath: normalizeRelativePath(record.relativePath || record.metadata?.relativePath || ""),
    sourceType: record.sourceType || record.metadata?.sourceType || "",
    source: record.source || record.metadata?.source || ""
  };
  const education = extractK12EducationMetadata({
    text: record.text || "",
    sourceUri: metadata.relativePath,
    metadata
  });
  const pageClassification = classifyK12Page({
    text: record.text || "",
    title: metadata.title,
    pageNumber: record.pageNumber || record.page_number || metadata.pageNumber || 0,
    metadata
  }, education);
  return {
    contentType: k12ContentTypeForRecord({ text: record.text || "", metadata: { ...metadata, pageClassification } }, education),
    education,
    pageClassification: compactPageClassification(pageClassification)
  };
}

function compactPageClassification(classification = null) {
  if (!classification) return null;
  return {
    primaryType: classification.primaryType || "",
    pageTypes: Array.isArray(classification.pageTypes) ? classification.pageTypes : [],
    confidence: classification.confidence ?? null,
    signals: Array.isArray(classification.signals) ? classification.signals : []
  };
}

function isK12Context(context = {}) {
  return context.job?.template === k12TemplateId
    || context.plan?.project?.id === k12TemplateId
    || context.plan?.project?.template === k12TemplateId
    || context.template === k12TemplateId
    || context.templateId === k12TemplateId;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function estimateTokenCount(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  return Math.max(1, Math.ceil(value.length / 4));
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function clampText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function uniquePages(pages = []) {
  const byId = new Map();
  for (const page of pages) {
    if (!page?.pageId) continue;
    if (!byId.has(page.pageId)) {
      byId.set(page.pageId, page);
      continue;
    }
    const existing = byId.get(page.pageId);
    byId.set(page.pageId, {
      ...existing,
      ...page,
      metadata: {
        ...(existing.metadata || {}),
        ...(page.metadata || {})
      },
      qualityState: existing.qualityState === "review" || page.qualityState === "review" ? "review" : page.qualityState || existing.qualityState
    });
  }
  return [...byId.values()];
}

function cleanQualityByDocument(chunks = []) {
  const byDocument = new Map();
  for (const chunk of chunks) {
    const documentId = String(chunk?.document_id || "");
    if (!documentId) continue;
    const qualityState = qualityStateForChunk(chunk);
    if (qualityState === "review") byDocument.set(documentId, "review");
    else if (!byDocument.has(documentId)) byDocument.set(documentId, qualityState);
  }
  return byDocument;
}

function qualityStateForChunk(chunk = {}) {
  const quality = chunk.quality && typeof chunk.quality === "object"
    ? chunk.quality
    : chunk.metadata?.quality && typeof chunk.metadata.quality === "object"
      ? chunk.metadata.quality
      : null;
  if (!quality) return "primary";
  const tier = String(quality.tier || "").trim();
  const lifecycle = String(quality.lifecycle || "").trim();
  if (quality.writeEnabled === false || lifecycle === "review" || tier === "review" || tier === "archive" || tier === "archived") {
    return "review";
  }
  return "primary";
}
