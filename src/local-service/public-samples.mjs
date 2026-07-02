import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createKnowledgeBase, listKnowledgeBases, switchKnowledgeBase, touchKnowledgeBaseById } from "./knowledge-bases.mjs";
import { saveRetrievalStrategy, saveSetupDraft } from "./setup-store.mjs";
import {
  catalogDatabasePath,
  knowledgeBaseDataRoot,
  nowIso,
  openCatalogDatabase,
  openWorkspaceDatabase,
  parseJson,
  safeId,
  stableJson,
  userDataRoot
} from "./storage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicSamplesRoot = path.join(projectRoot, "examples", "public-samples");
const sampleOwnerKey = "publicSampleOwner";
const sampleIdKey = "publicSampleId";
export const publicSampleOwner = "knowmesh-public-sample-wizard";

const publicSampleDefinitions = [
  {
    id: "general-docs",
    knowledgeBaseId: "sample-general-docs",
    name: "Public General Sample",
    template: "general-docs",
    sourceType: "markdown",
    relativePath: "general-docs/source/operations-handbook.md",
    sourceFile: path.join(publicSamplesRoot, "general-docs", "source", "operations-handbook.md"),
    documentId: "doc-public-operations",
    versionId: "ver-public-operations",
    buildId: "build-public-general",
    releaseId: "release-public-general",
    title: "Public Sample Operations Handbook",
    summary: {
      zh: "公开通用资料样例：制度、复核节奏、回滚和引用回答。",
      en: "Public general-document sample for review cadence, rollback, and cited answers."
    },
    expectedQuestions: [
      "What review cadence and rollback rule does the public sample require?"
    ]
  },
  {
    id: "operations-handbook",
    knowledgeBaseId: "sample-operations-handbook",
    name: "Public Operations Handbook Expert Sample",
    template: "operations-handbook",
    sourceType: "markdown",
    relativePath: "operations-handbook/source/incident-operations-handbook.md",
    sourceFile: path.join(publicSamplesRoot, "operations-handbook", "source", "incident-operations-handbook.md"),
    documentId: "doc-public-operations-handbook",
    versionId: "ver-public-operations-handbook",
    buildId: "build-public-operations-handbook",
    releaseId: "release-public-operations-handbook",
    title: "Incident Operations Handbook",
    summary: {
      zh: "公开 Operations Handbook Expert 样例：制度范围、流程步骤、复核节奏、回滚规则和证据要求。",
      en: "Public Operations Handbook Expert sample for policy scope, procedures, review cadence, rollback rules, and evidence requirements."
    },
    metadata: {
      operations: {
        domain: "incident-operations",
        owner: "source-owner",
        documentType: "operations-handbook",
        effectiveDate: "2026-07-01",
        publicFixture: true
      }
    },
    expectedQuestions: [
      "What review cadence and rollback rule does the operations handbook require?"
    ]
  },
  {
    id: "k12-synthetic",
    knowledgeBaseId: "sample-k12-synthetic",
    name: "Public Synthetic K12 Sample",
    template: "textbook-cn-k12",
    sourceType: "markdown",
    relativePath: "k12-synthetic/source/math-grade5-unit3.md",
    sourceFile: path.join(publicSamplesRoot, "k12-synthetic", "source", "math-grade5-unit3.md"),
    documentId: "doc-public-k12-math",
    versionId: "ver-public-k12-math",
    buildId: "build-public-k12",
    releaseId: "release-public-k12",
    title: "Synthetic Grade 5 Math Unit 3",
    summary: {
      zh: "合成 K12 样例：五年级数学第三单元，小数除法结构与引用。",
      en: "Synthetic K12 sample for grade-5 math unit 3 structure and citations."
    },
    scope: {
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"]
    },
    metadata: {
      education: {
        stage: "小学",
        subject: "数学",
        grade: "五年级",
        unit: "第三单元",
        unit_no: 3,
        unit_title: "小数除法",
        synthetic: true
      }
    },
    expectedQuestions: [
      "五年级数学第三单元小数除法有哪些知识点？"
    ]
  }
];

export function listPublicSamples(state = {}) {
  return {
    ok: true,
    kind: "knowmesh.publicSamples",
    samples: publicSampleDefinitions.map((definition) => sampleSummary(state, definition))
  };
}

export function publicSampleOwnershipSummary(state, knowledgeBaseId = "") {
  const targetId = safeId(knowledgeBaseId || listKnowledgeBases(state).current?.id || state.knowledgeBaseId || "");
  if (!targetId) return emptyPublicSampleOwnership();
  const ownership = readPublicSampleOwnership(state, targetId);
  if (ownership.owner !== publicSampleOwner || !ownership.sampleId) return emptyPublicSampleOwnership();
  return {
    publicSample: true,
    sampleId: ownership.sampleId,
    owner: publicSampleOwner,
    resetAllowed: true,
    cleanupScope: "sample-owned-knowledge-base-only"
  };
}

export function createPublicSampleKnowledgeBase(state, input = {}) {
  const sample = resolvePublicSample(input.sampleId || input.id || "general-docs");
  const existing = findExistingPublicSampleKnowledgeBase(state, sample.id);
  if (existing) {
    switchKnowledgeBase(state, existing.id);
    return publicSampleCreateResult(state, sample, existing, { alreadyExists: true });
  }

  const knowledgeBase = createKnowledgeBase(state, {
    id: sample.knowledgeBaseId,
    name: sample.name,
    template: sample.template
  });
  const sourceRoot = path.dirname(sample.sourceFile);
  const workspaceRoot = path.join(knowledgeBaseDataRoot(state, knowledgeBase.id), "artifacts", "public-sample");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  saveSetupDraft(state, {
    "project.name": sample.name,
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot,
    "project.template": sample.template,
    "template.id": sample.template,
    "setup.mode": "local",
    "publicSample.id": sample.id,
    "publicSample.owner": publicSampleOwner,
    ...(sample.scope || {})
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  writePublicSampleCatalog(state, knowledgeBase.id, sample, { sourceRoot, workspaceRoot });
  const job = writeCompletedPublicSampleJob(state, knowledgeBase.id, sample, { sourceRoot, workspaceRoot });
  const readyKnowledgeBase = touchKnowledgeBaseById(state, knowledgeBase.id, {
    status: "ready",
    mode: "local",
    sourceRoot,
    workspaceRoot,
    latestJobId: job.id,
    latestJobStatus: "completed",
    setupSummary: {
      configured: true,
      mode: "local",
      template: sample.template,
      sourceRoot,
      workspaceRoot,
      publicSample: true,
      publicSampleId: sample.id
    },
    taskSummary: job.progress
  }) || knowledgeBase;

  return publicSampleCreateResult(state, sample, readyKnowledgeBase, { alreadyExists: false });
}

export function resetPublicSampleKnowledgeBase(state, input = {}) {
  const knowledgeBaseId = safeId(input.knowledgeBaseId || input.id || "");
  const sampleId = String(input.sampleId || "").trim();
  const target = knowledgeBaseId
    ? listKnowledgeBases(state).items.find((item) => item.id === knowledgeBaseId)
    : sampleId
      ? findExistingPublicSampleKnowledgeBase(state, sampleId)
      : null;
  if (!target) {
    return {
      ok: false,
      status: 404,
      error: { code: "public_sample_not_found", message: "Public sample knowledge base was not found." }
    };
  }
  const ownership = readPublicSampleOwnership(state, target.id);
  if (ownership.owner !== publicSampleOwner || !ownership.sampleId) {
    return {
      ok: false,
      status: 409,
      error: { code: "not_public_sample", message: "Only knowledge bases created by the public sample wizard can be reset here." }
    };
  }

  deleteKnowledgeBaseRecord(state, target.id);
  removeKnowledgeBaseDirectory(state, target.id);
  return {
    ok: true,
    kind: "knowmesh.publicSampleReset",
    removed: {
      knowledgeBaseId: target.id,
      sampleId: ownership.sampleId
    },
    knowledgeBases: listKnowledgeBases(state)
  };
}

export function isPublicSampleKnowledgeBase(state) {
  try {
    const current = listKnowledgeBases(state).current;
    if (!current?.id) return false;
    const ownership = readPublicSampleOwnership(state, current.id);
    return ownership.owner === publicSampleOwner && Boolean(ownership.sampleId);
  } catch {
    return false;
  }
}

export function buildPublicSampleAnswer(result = {}) {
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const evidence = citations
    .map((citation, index) => {
      const metadata = citation.metadata && typeof citation.metadata === "object" ? citation.metadata : {};
      const excerpt = String(citation.excerpt || metadata.excerpt || metadata.textPreview || "").trim();
      if (!excerpt) return "";
      return `${excerpt}${index === 0 ? " [1]" : ""}`;
    })
    .filter(Boolean);
  if (!evidence.length) return "";
  return evidence[0].replace(/\s+/g, " ").slice(0, 900);
}

function publicSampleCreateResult(state, sample, knowledgeBase, options = {}) {
  return {
    ok: true,
    kind: "knowmesh.publicSampleCreated",
    alreadyExists: options.alreadyExists === true,
    sample: sampleSummary(state, sample),
    knowledgeBase,
    links: {
      open: `/kb/${knowledgeBase.id}/use/ask`,
      diagnostics: `/kb/${knowledgeBase.id}/maintain/diagnostics`,
      reset: "/api/public-samples/reset"
    }
  };
}

function sampleSummary(state, definition) {
  const existing = findExistingPublicSampleKnowledgeBase(state, definition.id);
  const sourceRoot = path.dirname(definition.sourceFile);
  return {
    id: definition.id,
    title: definition.name,
    template: definition.template,
    summary: definition.summary,
    sourceRoot,
    sourceFile: definition.sourceFile,
    sourceType: definition.sourceType,
    publicSafe: true,
    credentialFree: true,
    externalCalls: false,
    existingKnowledgeBaseId: existing?.id || "",
    expectedQuestions: definition.expectedQuestions
  };
}

function resolvePublicSample(sampleId) {
  const id = String(sampleId || "").trim();
  const sample = publicSampleDefinitions.find((item) => item.id === id);
  if (!sample) {
    const error = new Error(`Unknown public sample: ${id || "(empty)"}`);
    error.status = 404;
    error.code = "unknown_public_sample";
    throw error;
  }
  if (!fs.existsSync(sample.sourceFile)) {
    const error = new Error(`Public sample source is missing: ${sample.sourceFile}`);
    error.status = 500;
    error.code = "public_sample_source_missing";
    throw error;
  }
  return sample;
}

function findExistingPublicSampleKnowledgeBase(state, sampleId) {
  for (const item of listKnowledgeBases(state).items || []) {
    const ownership = readPublicSampleOwnership(state, item.id);
    if (ownership.owner === publicSampleOwner && ownership.sampleId === sampleId) return item;
  }
  return null;
}

function readPublicSampleOwnership(state, knowledgeBaseId) {
  try {
    const db = openCatalogDatabase(state, knowledgeBaseId);
    try {
      const rows = db.prepare(`
        SELECT key, value
        FROM catalog_state
        WHERE key IN (?, ?)
      `).all(sampleOwnerKey, sampleIdKey);
      const data = Object.fromEntries(rows.map((row) => [row.key, row.value]));
      return {
        owner: data[sampleOwnerKey] || "",
        sampleId: data[sampleIdKey] || ""
      };
    } finally {
      db.close();
    }
  } catch {
    return { owner: "", sampleId: "" };
  }
}

function writePublicSampleCatalog(state, knowledgeBaseId, sample, paths) {
  const text = fs.readFileSync(sample.sourceFile, "utf8");
  const now = nowIso();
  const textHash = crypto.createHash("sha256").update(text).digest("hex");
  const metadata = {
    title: sample.title,
    sourceType: sample.sourceType,
    sourceUri: sample.relativePath,
    page_start: 1,
    page_end: 1,
    active: true,
    publicSample: true,
    publicSampleId: sample.id,
    quality: { tier: "primary", writeEnabled: true },
    ...(sample.metadata || {})
  };
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO catalog_state (key, value, updated_at)
        VALUES (?, ?, ?), (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(sampleIdKey, sample.id, now, sampleOwnerKey, publicSampleOwner, now);
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'primary', ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          title = excluded.title,
          source_type = excluded.source_type,
          original_path = excluded.original_path,
          normalized_relative_path = excluded.normalized_relative_path,
          content_hash = excluded.content_hash,
          status = excluded.status,
          quality_state = excluded.quality_state,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(sample.documentId, sample.title, sample.sourceType, sample.sourceFile, sample.relativePath, textHash, process.platform, stableJson(metadata), now, now);
      db.prepare(`
        INSERT INTO document_versions (
          version_id, document_id, display_version, content_hash, artifact_path, status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'v1.0.0', ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(version_id) DO UPDATE SET
          content_hash = excluded.content_hash,
          artifact_path = excluded.artifact_path,
          status = excluded.status,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(sample.versionId, sample.documentId, textHash, sample.relativePath, stableJson(metadata), now, now);
      const pageId = `${sample.versionId}:page:0001`;
      const blockId = `${sample.versionId}:block:0001`;
      const chunkId = `${sample.versionId}:chunk:0001`;
      const citationId = `${sample.versionId}:citation:0001`;
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash,
          extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, 'extracted', 'primary', ?, ?, ?)
        ON CONFLICT(page_id) DO UPDATE SET
          artifact_path = excluded.artifact_path,
          text_hash = excluded.text_hash,
          extraction_state = excluded.extraction_state,
          quality_state = excluded.quality_state,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(pageId, sample.documentId, sample.versionId, sample.relativePath, textHash, stableJson(metadata), now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash,
          structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'body_text', 0, ?, ?, '', 'primary', ?, ?, ?)
        ON CONFLICT(block_id) DO UPDATE SET
          text_path = excluded.text_path,
          text_hash = excluded.text_hash,
          quality_state = excluded.quality_state,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(blockId, pageId, sample.documentId, sample.relativePath, textHash, stableJson({ ...metadata, textPreview: text.slice(0, 220) }), now, now);
      db.prepare(`
        INSERT INTO chunks (
          chunk_id, document_id, block_id, text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'primary', ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          text_path = excluded.text_path,
          text_hash = excluded.text_hash,
          token_count = excluded.token_count,
          quality_state = excluded.quality_state,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(chunkId, sample.documentId, blockId, sample.relativePath, textHash, Math.ceil(text.length / 4), stableJson({ ...metadata, text, chunk_id: chunkId, document_id: sample.documentId }), now, now);
      db.prepare(`
        INSERT INTO citations (
          citation_id, chunk_id, document_id, page_id, block_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 'page-1', ?, ?, ?)
        ON CONFLICT(citation_id) DO UPDATE SET
          source_label = excluded.source_label,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at
      `).run(citationId, chunkId, sample.documentId, pageId, blockId, sample.title, stableJson({ ...metadata, excerpt: text.slice(0, 320) }), now, now);
      if (sample.metadata?.operations) writeOperationsHandbookStructure(db, sample, { now, metadata });
      if (sample.metadata?.education) writeSyntheticK12Structure(db, sample, { now, metadata });
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES (?, 'active', 1, '', ?, ?, ?)
        ON CONFLICT(build_id) DO UPDATE SET
          status = excluded.status,
          active = excluded.active,
          summary_json = excluded.summary_json,
          updated_at = excluded.updated_at
      `).run(sample.buildId, stableJson({ documents: 1, chunks: 1, citations: 1, publicSample: true, sourceRoot: paths.sourceRoot }), now, now);
      db.prepare(`
        INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?, ?)
        ON CONFLICT(release_id) DO UPDATE SET
          status = excluded.status,
          manifest_path = excluded.manifest_path,
          summary_json = excluded.summary_json,
          updated_at = excluded.updated_at
      `).run(sample.releaseId, sample.buildId, `published/${sample.releaseId}/manifest.json`, stableJson({ publicSample: true, documents: 1, chunks: 1 }), now, now);
    })();
  } finally {
    db.close();
  }
}

function writeOperationsHandbookStructure(db, sample, context) {
  const operations = sample.metadata.operations || {};
  const baseMetadata = {
    ...context.metadata,
    operations,
    sourceUri: sample.relativePath,
    publicFixture: operations.publicFixture === true
  };
  const nodes = [
    operationsNode(sample, "policy", "Policy Scope", 1, baseMetadata),
    operationsNode(sample, "procedure", "Procedure", 2, baseMetadata),
    operationsNode(sample, "review_cadence", "Review Cadence", 3, baseMetadata),
    operationsNode(sample, "rollback_rule", "Rollback Rule", 4, baseMetadata),
    operationsNode(sample, "evidence_requirement", "Evidence Requirement", 5, baseMetadata)
  ];
  const upsertNode = db.prepare(`
    INSERT INTO structure_nodes (
      node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
    ) VALUES (?, NULL, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      node_type = excluded.node_type,
      title = excluded.title,
      sort_order = excluded.sort_order,
      path = excluded.path,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const upsertObject = db.prepare(`
    INSERT INTO knowledge_objects (
      object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 'primary', ?, ?, ?)
    ON CONFLICT(object_id) DO UPDATE SET
      structure_node_id = excluded.structure_node_id,
      object_type = excluded.object_type,
      title = excluded.title,
      quality_state = excluded.quality_state,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  for (const node of nodes) {
    upsertNode.run(
      node.nodeId,
      sample.documentId,
      node.nodeType,
      node.title,
      node.sortOrder,
      node.path,
      stableJson(node.metadata),
      context.now,
      context.now
    );
    upsertObject.run(
      node.objectId,
      sample.documentId,
      node.nodeId,
      node.nodeType,
      node.title,
      stableJson(node.metadata),
      context.now,
      context.now
    );
  }
  const roleNode = operationsNode(sample, "role", "Responsible Roles", 6, baseMetadata);
  upsertObject.run(
    roleNode.objectId,
    sample.documentId,
    nodes[1].nodeId,
    "role",
    roleNode.title,
    stableJson(roleNode.metadata),
    context.now,
    context.now
  );
}

function operationsNode(sample, nodeType, title, sortOrder, metadata) {
  const nodeId = `${sample.versionId}:operations:${nodeType}`;
  return {
    nodeId,
    objectId: `${nodeId}:object`,
    nodeType,
    title,
    sortOrder,
    path: `Incident Operations Handbook/${title}`,
    metadata: {
      ...metadata,
      objectType: nodeType,
      sectionTitle: title,
      pageNumber: 1
    }
  };
}

function emptyPublicSampleOwnership() {
  return {
    publicSample: false,
    sampleId: "",
    owner: "",
    resetAllowed: false,
    cleanupScope: "normal-knowledge-base-not-resettable-here"
  };
}

function writeSyntheticK12Structure(db, sample, context) {
  const education = sample.metadata.education;
  const unitNo = Number(education.unit_no || 0) || 1;
  const unitNodeId = `${sample.versionId}:unit:${unitNo}`;
  const objectId = `${sample.versionId}:object:knowledge-point`;
  const unitTitle = education.unit_title || sample.title;
  const metadata = {
    ...context.metadata,
    unitNo,
    education,
    sourceUri: sample.relativePath,
    synthetic: education.synthetic === true
  };
  db.prepare(`
    INSERT INTO structure_nodes (
      node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
    ) VALUES (?, NULL, ?, 'unit', ?, ?, 1, 1, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
      title = excluded.title,
      sort_order = excluded.sort_order,
      path = excluded.path,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(unitNodeId, sample.documentId, unitTitle, unitNo, `第三单元/${unitTitle}`, stableJson(metadata), context.now, context.now);
  db.prepare(`
    INSERT INTO knowledge_objects (
      object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'knowledge_point', ?, 1, 'primary', ?, ?, ?)
    ON CONFLICT(object_id) DO UPDATE SET
      title = excluded.title,
      quality_state = excluded.quality_state,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(objectId, sample.documentId, unitNodeId, unitTitle, stableJson(metadata), context.now, context.now);
}

function writeCompletedPublicSampleJob(state, knowledgeBaseId, sample, paths) {
  const now = nowIso();
  const tasks = [
    sampleTask("scan", "Read public sample source"),
    sampleTask("clean", "Create clean catalog chunk"),
    sampleTask("structure", "Write sample structures"),
    sampleTask("index", "Enable catalog search"),
    sampleTask("release", "Publish sample version")
  ];
  const progress = {
    total: tasks.length,
    completed: tasks.length,
    waiting: 0,
    running: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    stopped: 0
  };
  const job = {
    id: `job-public-${sample.id}`,
    status: "completed",
    mode: "local",
    template: sample.template,
    knowledgeBaseId,
    createdAt: now,
    updatedAt: now,
    summary: {
      sourceRoot: paths.sourceRoot,
      workspaceRoot: paths.workspaceRoot,
      baseWorkspaceRoot: paths.workspaceRoot,
      publicSample: true,
      publicSampleId: sample.id,
      externalCalls: false
    },
    progress,
    tasks,
    artifacts: []
  };
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO jobs (job_id, status, mode, template, summary_json, progress_json, job_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id) DO UPDATE SET
          status = excluded.status,
          mode = excluded.mode,
          template = excluded.template,
          summary_json = excluded.summary_json,
          progress_json = excluded.progress_json,
          job_json = excluded.job_json,
          updated_at = excluded.updated_at
      `).run(job.id, job.status, job.mode, job.template, stableJson(job.summary), stableJson(progress), stableJson(job), now, now);
      const insertStep = db.prepare(`
        INSERT INTO task_steps (job_id, step_key, sort_order, status, label_json, message_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, step_key) DO UPDATE SET
          status = excluded.status,
          label_json = excluded.label_json,
          message_json = excluded.message_json,
          updated_at = excluded.updated_at
      `);
      for (const [index, taskItem] of tasks.entries()) {
        insertStep.run(job.id, taskItem.key, index, taskItem.status, stableJson(taskItem.label), stableJson(taskItem.message), now);
      }
      db.prepare(`
        INSERT INTO catalog_state (key, value, updated_at)
        VALUES ('latestJobId', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(job.id, now);
    })();
  } finally {
    db.close();
  }
  return job;
}

function sampleTask(key, enLabel) {
  return {
    key,
    status: "completed",
    label: { zh: enLabel, en: enLabel },
    message: { zh: `${enLabel} completed.`, en: `${enLabel} completed.` },
    updatedAt: nowIso()
  };
}

function deleteKnowledgeBaseRecord(state, knowledgeBaseId) {
  const db = openWorkspaceDatabase(state);
  try {
    const now = nowIso();
    const currentId = db.prepare("SELECT value FROM workspace_state WHERE key = 'currentKnowledgeBaseId'").get()?.value || "";
    db.transaction(() => {
      db.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(knowledgeBaseId);
      if (currentId === knowledgeBaseId) {
        const fallback = db.prepare("SELECT id FROM knowledge_bases ORDER BY updated_at DESC, created_at DESC LIMIT 1").get()?.id || "";
        db.prepare(`
          INSERT INTO workspace_state (key, value, updated_at)
          VALUES ('currentKnowledgeBaseId', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(fallback, now);
        state.knowledgeBaseId = fallback;
      }
    })();
  } finally {
    db.close();
  }
}

function removeKnowledgeBaseDirectory(state, knowledgeBaseId) {
  const root = path.resolve(knowledgeBaseDataRoot(state, knowledgeBaseId));
  const basesRoot = path.resolve(path.join(userDataRoot(state), "knowledge-bases"));
  const relative = path.relative(basesRoot, root);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refusing to delete a path outside the KnowMesh knowledge-bases directory.");
  }
  fs.rmSync(root, { recursive: true, force: true });
}
