import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function readStructureSidecarFromCatalog(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyStructureSidecar();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const sourceDocuments = db.prepare(`
      SELECT document_id, title, source_type, normalized_relative_path, status, quality_state, metadata_json, updated_at
      FROM source_documents
      ORDER BY normalized_relative_path ASC, title ASC
    `).all().map(sourceDocumentRow);
    const nodes = db.prepare(`
      SELECT node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, updated_at
      FROM structure_nodes
      ORDER BY document_id ASC, sort_order ASC, node_id ASC
    `).all().map(structureNodeRow);
    const objects = db.prepare(`
      SELECT object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, updated_at
      FROM knowledge_objects
      ORDER BY document_id ASC, source_page ASC, object_type ASC, object_id ASC
    `).all().map(knowledgeObjectRow);
    const documents = buildStructureDocuments(sourceDocuments, nodes, objects);
    return {
      ok: true,
      kind: "knowmesh.structureSidecar",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeStructure(sourceDocuments, nodes, objects),
      documents
    };
  } finally {
    db.close();
  }
}

function buildStructureDocuments(sourceDocuments, nodes, objects) {
  const nodesByDocument = groupBy(nodes, (node) => node.documentId);
  const objectsByNode = groupBy(objects, (object) => object.structureNodeId);
  const objectsByDocument = groupBy(objects, (object) => object.documentId);
  return sourceDocuments.map((document) => {
    const documentNodes = nodesByDocument.get(document.documentId) || [];
    const pages = documentNodes
      .filter((node) => node.nodeType === "page")
      .map((node) => ({
        nodeId: node.nodeId,
        title: node.title,
        path: node.path,
        pageStart: node.pageStart,
        pageEnd: node.pageEnd,
        sortOrder: node.sortOrder,
        objects: (objectsByNode.get(node.nodeId) || []).map(compactObject)
      }));
    const attachedObjectIds = new Set(pages.flatMap((page) => page.objects.map((object) => object.objectId)));
    return {
      documentId: document.documentId,
      title: document.title,
      relativePath: document.relativePath,
      sourceType: document.sourceType,
      status: document.status,
      qualityState: document.qualityState,
      nodes: documentNodes.map(compactNode),
      pages,
      objects: (objectsByDocument.get(document.documentId) || [])
        .filter((object) => !attachedObjectIds.has(object.objectId))
        .map(compactObject)
    };
  });
}

function sourceDocumentRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    documentId: String(row.document_id || ""),
    title: String(row.title || row.normalized_relative_path || ""),
    relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
    sourceType: String(row.source_type || ""),
    status: String(row.status || ""),
    qualityState: String(row.quality_state || ""),
    sourceUri: metadata.sourceUri || "",
    updatedAt: String(row.updated_at || "")
  };
}

function structureNodeRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    nodeId: String(row.node_id || ""),
    parentId: String(row.parent_id || ""),
    documentId: String(row.document_id || ""),
    nodeType: String(row.node_type || ""),
    title: String(row.title || ""),
    sortOrder: Number(row.sort_order || 0),
    pageStart: row.page_start === null || row.page_start === undefined ? null : Number(row.page_start),
    pageEnd: row.page_end === null || row.page_end === undefined ? null : Number(row.page_end),
    path: normalizeRelativePath(row.path || ""),
    metadata: {
      relativePath: normalizeRelativePath(metadata.relativePath || ""),
      sourceType: String(metadata.sourceType || ""),
      pageNumber: metadata.pageNumber ?? null,
      source: String(metadata.source || "")
    },
    updatedAt: String(row.updated_at || "")
  };
}

function knowledgeObjectRow(row = {}) {
  return {
    objectId: String(row.object_id || ""),
    documentId: String(row.document_id || ""),
    structureNodeId: String(row.structure_node_id || ""),
    objectType: String(row.object_type || ""),
    title: String(row.title || ""),
    sourcePage: row.source_page === null || row.source_page === undefined ? null : Number(row.source_page),
    qualityState: String(row.quality_state || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function summarizeStructure(sourceDocuments, nodes, objects) {
  const objectTypes = {};
  for (const object of objects) {
    const key = object.objectType || "unknown";
    objectTypes[key] = (objectTypes[key] || 0) + 1;
  }
  const structureNodes = nodes.length;
  const knowledgeObjects = objects.length;
  return {
    status: structureNodes && knowledgeObjects ? "ready" : structureNodes || knowledgeObjects ? "partial" : "empty",
    documents: sourceDocuments.length,
    structureNodes,
    documentNodes: nodes.filter((node) => node.nodeType === "document").length,
    pageNodes: nodes.filter((node) => node.nodeType === "page").length,
    knowledgeObjects,
    reviewObjects: objects.filter((object) => object.qualityState === "review").length,
    objectTypes
  };
}

function compactNode(node) {
  return {
    nodeId: node.nodeId,
    parentId: node.parentId,
    nodeType: node.nodeType,
    title: node.title,
    sortOrder: node.sortOrder,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    path: node.path,
    metadata: node.metadata
  };
}

function compactObject(object) {
  return {
    objectId: object.objectId,
    structureNodeId: object.structureNodeId,
    objectType: object.objectType,
    title: object.title,
    sourcePage: object.sourcePage,
    qualityState: object.qualityState
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

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function emptyStructureSidecar() {
  return {
    ok: false,
    kind: "knowmesh.structureSidecar",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "" },
    summary: {
      status: "empty",
      documents: 0,
      structureNodes: 0,
      documentNodes: 0,
      pageNodes: 0,
      knowledgeObjects: 0,
      reviewObjects: 0,
      objectTypes: {}
    },
    documents: []
  };
}
