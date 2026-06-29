import { buildK12SourceScopeGate, k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const activeStatuses = new Set(["", "active", "included", "planned"]);
const inactiveStatuses = new Set(["excluded", "missing", "archived"]);
const requiredScopeKeys = ["stage", "subject", "grade"];

export function readK12SourceScopeGateFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyGate();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableGate(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const draft = readSetupDraft(db);
    const documents = db.prepare(`
      SELECT document_id, title, source_type, normalized_relative_path, status, quality_state, metadata_json
      FROM source_documents
      ORDER BY normalized_relative_path ASC, document_id ASC
    `).all().map(sourceDocumentRow);
    const gate = buildK12SourceScopeGate({ id: k12TemplateId }, draft, documents);
    const activeOutOfScope = gate.excluded
      .filter((item) => activeStatuses.has(String(item.document.status || "")))
      .map(compactExcludedDocument);
    const missingRequiredScope = requiredScopeKeys.filter((key) => !(gate.selected?.[key] || []).length);
    const status = sourceScopeStatus({ gate, documents, missingRequiredScope, activeOutOfScope });
    const blockers = buildBlockers(missingRequiredScope, activeOutOfScope);

    return {
      ok: true,
      kind: "knowmesh.k12SourceScopeGate",
      apiVersion: "v1",
      phase: "phase3-k12-expert",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary: {
        status,
        enabled: gate.enabled,
        totalDocuments: documents.length,
        includedDocuments: gate.included.length,
        excludedDocuments: gate.excluded.length,
        inactiveExcludedDocuments: gate.excluded.filter((item) => inactiveStatuses.has(String(item.document.status || ""))).length,
        activeOutOfScopeDocuments: activeOutOfScope.length,
        missingRequiredScope
      },
      selected: gate.selected,
      includedDocuments: gate.included.map(compactIncludedDocument),
      excludedDocuments: gate.excluded.map(compactExcludedDocument),
      blockers
    };
  } finally {
    db.close();
  }
}

function readSetupDraft(db) {
  const row = db.prepare("SELECT draft_json FROM setup_state WHERE id = 1").get();
  return parseJson(row?.draft_json, {});
}

function sourceDocumentRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    documentId: String(row.document_id || ""),
    document_id: String(row.document_id || ""),
    title: String(row.title || ""),
    sourceType: String(row.source_type || ""),
    relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
    status: String(row.status || ""),
    qualityState: String(row.quality_state || ""),
    metadata,
    sourceParts: Array.isArray(metadata.sourceParts) ? metadata.sourceParts : []
  };
}

function sourceScopeStatus({ gate, documents, missingRequiredScope, activeOutOfScope }) {
  if (missingRequiredScope.length) return "blocked";
  if (activeOutOfScope.length) return "blocked";
  if (!documents.length) return "empty";
  if (!gate.enabled) return "blocked";
  return gate.included.length ? "pass" : "empty";
}

function buildBlockers(missingRequiredScope, activeOutOfScope) {
  const blockers = [];
  if (missingRequiredScope.length) {
    blockers.push({
      key: "missingRequiredScope",
      status: "blocked",
      count: missingRequiredScope.length,
      fields: missingRequiredScope
    });
  }
  if (activeOutOfScope.length) {
    blockers.push({
      key: "activeOutOfScopeDocuments",
      status: "blocked",
      count: activeOutOfScope.length,
      documents: activeOutOfScope
    });
  }
  return blockers;
}

function compactIncludedDocument({ document, decision }) {
  return {
    documentId: document.documentId,
    title: document.title,
    relativePath: document.relativePath,
    status: document.status,
    reason: decision.reason || "matched",
    scope: compactMetadata(decision.metadata)
  };
}

function compactExcludedDocument({ document, decision }) {
  return {
    documentId: document.documentId,
    title: document.title,
    relativePath: document.relativePath,
    status: document.status,
    reason: decision.reason || "outside_current_scope",
    scope: compactMetadata(decision.metadata)
  };
}

function compactMetadata(metadata = {}) {
  return {
    stage: String(metadata.stage || ""),
    subject: String(metadata.subject || ""),
    grade: String(metadata.grade || ""),
    volume: String(metadata.volume || "")
  };
}

function notApplicableGate(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12SourceScopeGate",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      name: knowledgeBase.name || knowledgeBase.id || "",
      template: knowledgeBase.template || ""
    },
    summary: {
      status: "not_applicable",
      enabled: false,
      totalDocuments: 0,
      includedDocuments: 0,
      excludedDocuments: 0,
      inactiveExcludedDocuments: 0,
      activeOutOfScopeDocuments: 0,
      missingRequiredScope: []
    },
    selected: emptySelected(),
    includedDocuments: [],
    excludedDocuments: [],
    blockers: []
  };
}

function emptyGate() {
  return {
    ok: false,
    kind: "knowmesh.k12SourceScopeGate",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "" },
    summary: {
      status: "empty",
      enabled: false,
      totalDocuments: 0,
      includedDocuments: 0,
      excludedDocuments: 0,
      inactiveExcludedDocuments: 0,
      activeOutOfScopeDocuments: 0,
      missingRequiredScope: []
    },
    selected: emptySelected(),
    includedDocuments: [],
    excludedDocuments: [],
    blockers: []
  };
}

function emptySelected() {
  return {
    stage: [],
    subject: [],
    grade: [],
    volume: [],
    publisher: [],
    edition: []
  };
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}
