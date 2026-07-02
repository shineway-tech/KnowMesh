import { buildK12SourceScopeGate, k12TemplateId, normalizeDraftList } from "../core/document-scope.mjs";
import { expertCapabilityKeys, publicExpertSummary, resolveExpertForTemplate } from "./expert-registry.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

const tocCompletenessTarget = 0.95;

export function readK12ExpertReadinessFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyReadiness();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  const expert = resolveExpertForTemplate(knowledgeBase.template);
  if (knowledgeBase.template !== k12TemplateId || !expert) {
    return notApplicableReadiness(knowledgeBase);
  }

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const setupDraft = readSetupDraft(db);
    const documents = db.prepare(`
      SELECT document_id, title, status, quality_state, normalized_relative_path, metadata_json
      FROM source_documents
      ORDER BY normalized_relative_path ASC, document_id ASC
    `).all().map(documentRow);
    const structureRows = db.prepare(`
      SELECT node_id, node_type, title, metadata_json
      FROM structure_nodes
      ORDER BY sort_order ASC, node_id ASC
    `).all().map(structureRow);
    const objectRows = db.prepare(`
      SELECT object_id, object_type, quality_state
      FROM knowledge_objects
      ORDER BY object_type ASC, object_id ASC
    `).all().map(objectRow);
    const chunkRows = db.prepare(`
      SELECT chunk_id, object_id, structure_node_id, quality_state
      FROM chunks
      ORDER BY chunk_id ASC
    `).all().map(chunkRow);
    const citations = numericScalar(db, "SELECT count(*) FROM citations");
    const indexRecords = db.prepare(`
      SELECT chunk_id, status
      FROM index_records
      ORDER BY chunk_id ASC, record_id ASC
    `).all();
    const activeBuild = db.prepare(`
      SELECT build_id, status
      FROM build_versions
      WHERE active = 1
      ORDER BY updated_at DESC, build_id DESC
      LIMIT 1
    `).get();
    const release = activeBuild ? db.prepare(`
      SELECT release_id, status, manifest_path
      FROM release_manifests
      WHERE build_id = ?
      ORDER BY updated_at DESC, release_id DESC
      LIMIT 1
    `).get(activeBuild.build_id) : null;
    const evaluation = readEvaluationSummary(db, activeBuild?.build_id || "");
    const dimensions = summarizeDimensions(documents, setupDraft);
    const sourceScope = summarizeSourceScope(buildK12SourceScopeGate({ id: k12TemplateId }, setupDraft, documents));
    const counts = summarizeCounts(structureRows, objectRows, chunkRows, indexRecords, citations);
    const gates = summarizeGates({ sourceScope, counts, activeBuild, release, evaluation });
    const gaps = buildGaps(gates);

    return {
      ok: true,
      kind: "knowmesh.k12ExpertReadiness",
      apiVersion: "v1",
      phase: "phase3-k12-expert",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template: knowledgeBase.template || "",
        expert: publicExpertSummary(expert)
      },
      summary: {
        status: readinessStatus(gates, documents.length),
        expertCapabilities: expertCapabilityKeys(expert),
        documents: documents.length,
        activeDocuments: documents.filter((item) => item.status === "active").length,
        reviewDocuments: documents.filter((item) => item.qualityState === "review").length,
        structureNodes: structureRows.length,
        units: counts.units,
        lessons: counts.lessons,
        tocEntries: counts.tocEntries,
        tocCompletenessTarget: counts.tocCompletenessTarget,
        tocCompletenessRate: counts.tocCompletenessRate,
        tocCompletenessPercent: counts.tocCompletenessPercent,
        knowledgeObjects: objectRows.length,
        chunks: chunkRows.length,
        citations,
        indexedChunks: counts.indexedChunks,
        activeBuildId: activeBuild?.build_id || "",
        activeReleaseId: release?.release_id || "",
        evaluationCases: evaluation.cases,
        evaluationResults: evaluation.results,
        passedEvaluationResults: evaluation.passed,
        sourceScope,
        gates
      },
      dimensions,
      objectTypes: counts.objectTypes,
      gaps
    };
  } finally {
    db.close();
  }
}

function readSetupDraft(db) {
  const row = db.prepare("SELECT draft_json FROM setup_state WHERE id = 1").get();
  return parseJson(row?.draft_json, {});
}

function documentRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  return {
    documentId: String(row.document_id || ""),
    title: String(row.title || ""),
    relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
    status: String(row.status || ""),
    qualityState: String(row.quality_state || ""),
    education: normalizeEducationMetadata(metadata)
  };
}

function structureRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  const contentType = String(metadata.contentType || metadata.content_type || "");
  return {
    nodeId: String(row.node_id || ""),
    nodeType: String(row.node_type || contentType || ""),
    title: String(row.title || ""),
    contentType
  };
}

function objectRow(row = {}) {
  return {
    objectId: String(row.object_id || ""),
    objectType: String(row.object_type || ""),
    qualityState: String(row.quality_state || "")
  };
}

function chunkRow(row = {}) {
  return {
    chunkId: String(row.chunk_id || ""),
    objectId: String(row.object_id || ""),
    structureNodeId: String(row.structure_node_id || ""),
    qualityState: String(row.quality_state || "")
  };
}

function readEvaluationSummary(db, activeBuildId) {
  const cases = numericScalar(db, "SELECT count(*) FROM evaluation_cases WHERE template = ? AND active = 1", [k12TemplateId]);
  const results = activeBuildId
    ? numericScalar(db, `
      SELECT count(*)
      FROM evaluation_results er
      JOIN evaluation_cases ec ON ec.case_id = er.case_id
      WHERE ec.template = ? AND ec.active = 1 AND er.build_id = ?
    `, [k12TemplateId, activeBuildId])
    : 0;
  const passed = activeBuildId
    ? numericScalar(db, `
      SELECT count(*)
      FROM evaluation_results er
      JOIN evaluation_cases ec ON ec.case_id = er.case_id
      WHERE ec.template = ? AND ec.active = 1 AND er.build_id = ? AND er.status IN ('pass', 'passed')
    `, [k12TemplateId, activeBuildId])
    : 0;
  return { cases, results, passed };
}

function normalizeEducationMetadata(metadata = {}) {
  const education = metadata.education || metadata.k12 || metadata;
  return {
    stage: stringValue(education.stage || metadata.stage),
    subject: stringValue(education.subject || metadata.subject),
    grade: stringValue(education.grade || metadata.grade),
    volume: stringValue(education.volume || metadata.volume),
    publisher: stringValue(education.publisher || metadata.publisher),
    edition: stringValue(education.edition || metadata.edition),
    bookTitle: stringValue(education.bookTitle || education.book_title || metadata.bookTitle || metadata.book_title)
  };
}

function summarizeDimensions(documents, setupDraft) {
  const dimensions = {
    stage: [],
    subject: [],
    grade: [],
    volume: [],
    publisher: [],
    edition: [],
    bookTitle: []
  };
  for (const document of documents) {
    for (const key of Object.keys(dimensions)) addUnique(dimensions[key], document.education[key]);
    if (!document.education.bookTitle) addUnique(dimensions.bookTitle, document.title);
  }
  addDraftDimension(dimensions.stage, setupDraft["metadata.stage"]);
  addDraftDimension(dimensions.subject, setupDraft["metadata.subject"]);
  addDraftDimension(dimensions.grade, setupDraft["metadata.grade"]);
  addDraftDimension(dimensions.volume, setupDraft["metadata.volume"]);
  addDraftDimension(dimensions.publisher, setupDraft["metadata.publisher"]);
  addDraftDimension(dimensions.edition, setupDraft["metadata.edition"]);
  return dimensions;
}

function summarizeCounts(structureRows, objectRows, chunkRows, indexRecords, citations) {
  const objectTypes = countBy(objectRows, (row) => row.objectType || "unknown");
  const writtenChunkIds = new Set(indexRecords.filter((row) => row.status === "written").map((row) => String(row.chunk_id || "")));
  const lessons = structureRows.filter((row) => row.nodeType === "lesson").length;
  const tocEntries = structureRows.filter((row) => row.nodeType === "toc_entry" || row.contentType === "toc_entry").length;
  const tocCompletenessRate = lessons > 0 ? roundRate(Math.min(tocEntries, lessons) / lessons) : 0;
  return {
    units: structureRows.filter((row) => row.nodeType === "unit").length,
    lessons,
    tocEntries,
    tocCompletenessTarget,
    tocCompletenessRate,
    tocCompletenessPercent: Math.round(tocCompletenessRate * 100),
    indexedChunks: chunkRows.filter((row) => writtenChunkIds.has(row.chunkId)).length,
    objectTypes,
    citationReady: chunkRows.length > 0 && citations >= chunkRows.length
  };
}

function summarizeSourceScope(gate = {}) {
  const missingRequiredScope = ["stage", "subject", "grade"].filter((key) => !(gate.selected?.[key] || []).length);
  return {
    status: missingRequiredScope.length ? "blocked" : gate.status || "blocked",
    enabled: gate.enabled === true,
    selected: gate.selected || {},
    totalDocuments: Number(gate.totalDocumentsBeforeScope || 0),
    includedDocuments: Number(gate.includedDocuments || 0),
    excludedDocuments: Number(gate.excludedDocuments || 0),
    missingRequiredScope
  };
}

function summarizeGates({ sourceScope, counts, activeBuild, release, evaluation }) {
  const sourceScopeReady = sourceScope.status === "pass" && sourceScope.includedDocuments > 0;
  const tocReady = counts.units > 0 && counts.lessons > 0 && counts.tocCompletenessRate >= counts.tocCompletenessTarget;
  const objectReady = ["book", "unit", "lesson"].every((key) => Number(counts.objectTypes[key] || 0) > 0);
  const retrievalReady = counts.indexedChunks > 0 && counts.citationReady && activeBuild?.status === "active" && release?.status === "active";
  const evaluationReady = evaluation.cases > 0 && evaluation.results > 0;
  return {
    sourceScope: sourceScopeReady ? "pass" : "blocked",
    tocStructure: tocReady ? "pass" : "blocked",
    domainObjects: objectReady ? "pass" : "blocked",
    retrieval: retrievalReady ? "pass" : "blocked",
    evaluation: evaluationReady ? "pass" : "blocked"
  };
}

function readinessStatus(gates, documentCount) {
  if (!documentCount) return "empty";
  return Object.values(gates).every((status) => status === "pass") ? "ready" : "partial";
}

function buildGaps(gates) {
  const labels = {
    sourceScope: "K12 documents need stage, subject, and grade dimensions.",
    tocStructure: "K12 TOC/unit/lesson structure is not complete enough for structure-first lookup.",
    domainObjects: "K12 book, unit, and lesson objects are required before expert routing.",
    retrieval: "Chunks, citations, written index records, and an active release are required.",
    evaluation: "K12 evaluation cases and build results must exist before expert acceptance."
  };
  return Object.entries(gates)
    .filter(([, status]) => status !== "pass")
    .map(([key, status]) => ({ key, status, message: labels[key] || key }));
}

function roundRate(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function notApplicableReadiness(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12ExpertReadiness",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      name: knowledgeBase.name || knowledgeBase.id || "",
      template: knowledgeBase.template || "",
      expert: null
    },
    summary: {
      status: "not_applicable",
      expertCapabilities: [],
      documents: 0,
      activeDocuments: 0,
      reviewDocuments: 0,
      structureNodes: 0,
      units: 0,
      lessons: 0,
      tocEntries: 0,
      tocCompletenessTarget,
      tocCompletenessRate: 0,
      tocCompletenessPercent: 0,
      knowledgeObjects: 0,
      chunks: 0,
      citations: 0,
      indexedChunks: 0,
      activeBuildId: "",
      activeReleaseId: "",
      evaluationCases: 0,
      evaluationResults: 0,
      passedEvaluationResults: 0,
      gates: {}
    },
    dimensions: emptyDimensions(),
    objectTypes: {},
    gaps: []
  };
}

function emptyReadiness() {
  return {
    ok: false,
    kind: "knowmesh.k12ExpertReadiness",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "", expert: "" },
    summary: {
      status: "empty",
      expertCapabilities: [],
      documents: 0,
      activeDocuments: 0,
      reviewDocuments: 0,
      structureNodes: 0,
      units: 0,
      lessons: 0,
      tocEntries: 0,
      tocCompletenessTarget,
      tocCompletenessRate: 0,
      tocCompletenessPercent: 0,
      knowledgeObjects: 0,
      chunks: 0,
      citations: 0,
      indexedChunks: 0,
      activeBuildId: "",
      activeReleaseId: "",
      evaluationCases: 0,
      evaluationResults: 0,
      passedEvaluationResults: 0,
      gates: {}
    },
    dimensions: emptyDimensions(),
    objectTypes: {},
    gaps: []
  };
}

function emptyDimensions() {
  return {
    stage: [],
    subject: [],
    grade: [],
    volume: [],
    publisher: [],
    edition: [],
    bookTitle: []
  };
}

function addDraftDimension(target, value) {
  for (const item of normalizeDraftList(value)) addUnique(target, item);
}

function addUnique(target, value) {
  const text = stringValue(value);
  if (text && !target.includes(text)) target.push(text);
}

function countBy(items, resolveKey) {
  const counts = {};
  for (const item of items) {
    const key = resolveKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function numericScalar(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return Number(row ? Object.values(row)[0] || 0 : 0);
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function stringValue(value) {
  return String(value || "").trim();
}
