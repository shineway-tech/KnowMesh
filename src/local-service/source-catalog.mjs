import path from "node:path";

import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function syncSourceManifestToCatalog(state, manifest = {}, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return { ok: false, documents: 0, versions: 0 };
  const records = sourceRecordsFromManifest(manifest, options);
  const resolution = resolveSourceManifest(state, manifest, { ...options, knowledgeBaseId });
  const delta = buildSourceDelta(resolution);
  const deltaByDocumentId = new Map(delta.versionNotes.map((note) => [note.documentId, note]));
  for (const record of records) {
    const note = deltaByDocumentId.get(record.documentId);
    if (note) record.sourceDelta = note;
  }
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const write = db.transaction(() => {
      const seenDocumentIds = new Set();
      const seenVersionIds = new Set();
      for (const record of records) {
        seenDocumentIds.add(record.documentId);
        seenVersionIds.add(record.versionId);
        upsertSourceDocument(db, record);
        upsertDocumentVersion(db, record);
        upsertSourcePageAnchor(db, record);
      }
      if (seenDocumentIds.size) {
        markMissingDocuments(db, seenDocumentIds, seenVersionIds);
      }
    });
    write();
    return {
      ok: true,
      documents: records.length,
      versions: records.length,
      pages: records.length,
      sourceManifest: readSourceManifestFromCatalog(state, { knowledgeBaseId }).summary,
      resolution: resolution.summary,
      delta
    };
  } finally {
    db.close();
  }
}

export function resolveSourceManifest(state, manifest = {}, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  const records = sourceRecordsFromManifest(manifest, options);
  const existing = knowledgeBaseId ? readExistingSourceRecords(state, knowledgeBaseId) : [];
  const existingByDocumentId = new Map(existing.map((record) => [record.documentId, record]));
  const seenDocumentIds = new Set(records.map((record) => record.documentId).filter(Boolean));
  const documents = [];
  const excludedDocuments = [];

  for (const record of records) {
    const previous = existingByDocumentId.get(record.documentId) || null;
    const changeStatus = sourceChangeStatus(record, previous);
    const payload = sourceRecordPayload(record, { changeStatus, previous });
    if (String(record.status || "").startsWith("excluded")) {
      excludedDocuments.push(payload);
    } else {
      documents.push(payload);
    }
  }

  const missingDocuments = existing
    .filter((record) => record.documentId && !seenDocumentIds.has(record.documentId))
    .map((record) => sourceRecordPayload({
      ...record,
      status: "missing",
      versionStatus: "missing",
      qualityState: "review"
    }, { changeStatus: "missing", previous: record }));
  const summary = summarizeResolvedSourceManifest(documents, excludedDocuments, missingDocuments);

  return {
    ok: Boolean(knowledgeBaseId),
    kind: "knowmesh.sourceManifestResolution",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: knowledgeBaseId },
    source: manifest.source || {},
    workspace: manifest.workspace || {},
    summary,
    documents,
    excludedDocuments,
    missingDocuments
  };
}

export function readSourceManifestFromCatalog(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) {
    return emptyCatalogSourceManifest();
  }
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const rows = db.prepare(`
      SELECT
        sd.document_id,
        sd.title,
        sd.source_type,
        sd.original_path,
        sd.normalized_relative_path,
        sd.content_hash,
        sd.platform_path_hint,
        sd.status,
        sd.quality_state,
        sd.metadata_json,
        sd.created_at,
        sd.updated_at,
        dv.version_id,
        dv.display_version,
        dv.content_hash AS version_content_hash,
        dv.artifact_path,
        dv.status AS version_status,
        dv.metadata_json AS version_metadata_json,
        dv.created_at AS version_created_at,
        dv.updated_at AS version_updated_at
      FROM source_documents sd
      LEFT JOIN document_versions dv ON dv.document_id = sd.document_id
      ORDER BY sd.normalized_relative_path ASC, dv.updated_at DESC, dv.version_id DESC
    `).all();
    const documents = catalogSourceDocuments(rows);
    return {
      ok: true,
      kind: "knowmesh.sourceManifest",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeCatalogSourceManifest(documents),
      documents
    };
  } finally {
    db.close();
  }
}

function sourceRecordsFromManifest(manifest = {}, options = {}) {
  const included = (manifest.logicalDocuments || []).map((document) => normalizeSourceRecord(document, {
    status: "included",
    qualityState: "primary",
    manifest,
    options
  }));
  const excluded = (manifest.scopeFilter?.excluded || []).map((document) => normalizeSourceRecord(document, {
    status: document.status === "excluded_by_user" || document.reason === "excluded_by_user" ? "excluded_by_user" : "excluded",
    qualityState: "archive",
    manifest,
    options
  }));
  const byDocumentId = new Map();
  for (const record of [...included, ...excluded].filter((record) => record.documentId && record.versionId)) {
    byDocumentId.set(record.documentId, record);
  }
  return [...byDocumentId.values()];
}

function normalizeSourceRecord(document = {}, context = {}) {
  const sourceParts = Array.isArray(document.sourceParts) ? document.sourceParts.map(normalizeSourcePart) : [];
  const sourcePart = sourceParts[0] || {};
  const relativePath = normalizeRelativePath(document.relativePath || sourcePart.relativePath || "");
  const now = nowIso();
  const contentHash = String(document.source_fingerprint || sourcePart.sha256 || "");
  return {
    documentId: String(document.document_id || ""),
    versionId: String(document.version_id || ""),
    title: String(document.title || relativePath || ""),
    sourceType: String(document.sourceType || ""),
    originalPath: String(document.sourcePath || sourcePart.path || ""),
    normalizedRelativePath: relativePath,
    contentHash,
    platformPathHint: process.platform,
    status: context.status || "included",
    versionStatus: context.status === "included" ? "planned" : context.status || "excluded",
    qualityState: context.qualityState || "primary",
    artifactPath: workspaceRelativeArtifactPath(document, context.manifest),
    metadata: {
      sourceUri: document.sourceUri || sourcePart.uri || "",
      sourceRoot: context.manifest?.source?.root || "",
      workspaceRoot: context.options?.workspaceRoot || context.manifest?.workspace?.root || "",
      reason: document.reason || "",
      userReason: document.userReason || "",
      sourceParts,
      merge: document.merge || null,
      scope: document.metadata || null
    },
    createdAt: String(document.createdAt || now),
    updatedAt: String(document.updatedAt || now)
  };
}

function upsertSourceDocument(db, record) {
  const metadata = record.sourceDelta ? { ...record.metadata, sourceDelta: record.sourceDelta } : record.metadata;
  db.prepare(`
    INSERT INTO source_documents (
      document_id, title, source_type, original_path, normalized_relative_path,
      content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      title = excluded.title,
      source_type = excluded.source_type,
      original_path = excluded.original_path,
      normalized_relative_path = excluded.normalized_relative_path,
      content_hash = excluded.content_hash,
      platform_path_hint = excluded.platform_path_hint,
      status = excluded.status,
      quality_state = excluded.quality_state,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    record.documentId,
    record.title,
    record.sourceType,
    record.originalPath,
    record.normalizedRelativePath,
    record.contentHash,
    record.platformPathHint,
    record.status,
    record.qualityState,
    stableJson(metadata),
    record.createdAt,
    record.updatedAt
  );
}

function upsertDocumentVersion(db, record) {
  const metadata = record.sourceDelta ? { ...record.metadata, sourceDelta: record.sourceDelta } : record.metadata;
  db.prepare(`
    INSERT INTO document_versions (
      version_id, document_id, display_version, content_hash, artifact_path,
      status, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(version_id) DO UPDATE SET
      document_id = excluded.document_id,
      content_hash = excluded.content_hash,
      artifact_path = excluded.artifact_path,
      status = excluded.status,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    record.versionId,
    record.documentId,
    "v1.0.0",
    record.contentHash,
    record.artifactPath,
    record.versionStatus,
    stableJson(metadata),
    record.createdAt,
    record.updatedAt
  );
}

function upsertSourcePageAnchor(db, record) {
  db.prepare(`
    INSERT INTO pages (
      page_id, document_id, version_id, page_number, artifact_path,
      text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET
      document_id = excluded.document_id,
      version_id = excluded.version_id,
      artifact_path = excluded.artifact_path,
      text_hash = excluded.text_hash,
      extraction_state = excluded.extraction_state,
      quality_state = excluded.quality_state,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    `${record.versionId}:source`,
    record.documentId,
    record.versionId,
    0,
    record.artifactPath,
    record.contentHash,
    "source_anchor",
    record.qualityState,
    stableJson({
      title: record.title,
      relativePath: record.normalizedRelativePath,
      sourceType: record.sourceType,
      sourceUri: record.metadata.sourceUri || "",
      sourceParts: record.metadata.sourceParts || [],
      sourceAnchor: true
    }),
    record.createdAt,
    record.updatedAt
  );
}

function markMissingDocuments(db, seenDocumentIds, seenVersionIds) {
  const existingDocuments = db.prepare("SELECT document_id, status, metadata_json FROM source_documents").all();
  const existingVersions = db.prepare("SELECT version_id, document_id, status, metadata_json FROM document_versions").all();
  const markDocument = db.prepare(`
    UPDATE source_documents
    SET status = 'missing', quality_state = 'review', metadata_json = ?, updated_at = ?
    WHERE document_id = ?
  `);
  const markVersion = db.prepare(`
    UPDATE document_versions
    SET status = 'missing', metadata_json = ?, updated_at = ?
    WHERE version_id = ?
  `);
  const markPage = db.prepare(`
    UPDATE pages
    SET extraction_state = 'missing', quality_state = 'review', updated_at = ?
    WHERE version_id = ? AND extraction_state = 'source_anchor'
  `);
  const now = nowIso();
  for (const row of existingDocuments) {
    if (!seenDocumentIds.has(row.document_id)) {
      const metadata = {
        ...parseJson(row.metadata_json, {}),
        sourceDelta: {
          documentId: row.document_id || "",
          versionId: "",
          changeStatus: "missing",
          previousStatus: row.status || "",
          previousContentHash: "",
          contentHash: "",
          reason: "source_missing"
        }
      };
      markDocument.run(stableJson(metadata), now, row.document_id);
    }
  }
  for (const row of existingVersions) {
    if (!seenVersionIds.has(row.version_id)) {
      const metadata = {
        ...parseJson(row.metadata_json, {}),
        sourceDelta: {
          documentId: row.document_id || "",
          versionId: row.version_id || "",
          changeStatus: "missing",
          previousStatus: row.status || "",
          previousContentHash: "",
          contentHash: "",
          reason: "source_missing"
        }
      };
      markVersion.run(stableJson(metadata), now, row.version_id);
      markPage.run(now, row.version_id);
    }
  }
}

function readExistingSourceRecords(state, knowledgeBaseId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    return db.prepare(`
      SELECT
        document_id,
        title,
        source_type,
        original_path,
        normalized_relative_path,
        content_hash,
        platform_path_hint,
        status,
        quality_state,
        metadata_json,
        created_at,
        updated_at
      FROM source_documents
      ORDER BY normalized_relative_path ASC
    `).all().map((row) => {
      const metadata = parseJson(row.metadata_json, {});
      return {
        documentId: row.document_id || "",
        versionId: "",
        title: row.title || row.normalized_relative_path || "",
        sourceType: row.source_type || "",
        originalPath: row.original_path || "",
        normalizedRelativePath: row.normalized_relative_path || "",
        contentHash: row.content_hash || "",
        platformPathHint: row.platform_path_hint || "",
        status: row.status || "",
        versionStatus: row.status || "",
        qualityState: row.quality_state || "",
        artifactPath: "",
        metadata,
        sourceParts: Array.isArray(metadata.sourceParts) ? metadata.sourceParts.map(normalizeSourcePart) : [],
        merge: metadata.merge || null,
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || ""
      };
    });
  } finally {
    db.close();
  }
}

function sourceChangeStatus(record, previous) {
  if (record.status === "excluded_by_user") return "excluded_by_user";
  if (record.status === "excluded") return "excluded";
  if (!previous) return "added";
  if (["missing", "excluded", "excluded_by_user", "out_of_scope"].includes(previous.status)) return "restored";
  if (record.contentHash && previous.contentHash && record.contentHash !== previous.contentHash) return "modified";
  return "unchanged";
}

function sourceRecordPayload(record, context = {}) {
  const metadata = record.metadata || {};
  const sourceParts = Array.isArray(record.sourceParts)
    ? record.sourceParts.map(normalizeSourcePart)
    : Array.isArray(metadata.sourceParts)
      ? metadata.sourceParts.map(normalizeSourcePart)
      : [];
  return {
    documentId: record.documentId || "",
    versionId: record.versionId || "",
    title: record.title || record.normalizedRelativePath || "",
    relativePath: normalizeRelativePath(record.normalizedRelativePath || record.relativePath || ""),
    sourceType: record.sourceType || "",
    contentHash: record.contentHash || "",
    status: record.status || "included",
    versionStatus: record.versionStatus || "",
    qualityState: record.qualityState || "",
    changeStatus: context.changeStatus || "",
    previousContentHash: context.previous?.contentHash || "",
    previousStatus: context.previous?.status || "",
    reason: metadata.reason || record.reason || "",
    userReason: metadata.userReason || record.userReason || "",
    originalPath: record.originalPath || "",
    sourceUri: metadata.sourceUri || "",
    artifactPath: record.artifactPath || "",
    sourceParts,
    merge: metadata.merge || record.merge || null,
    metadata: {
      sourceRoot: metadata.sourceRoot || "",
      workspaceRoot: metadata.workspaceRoot || "",
      scope: metadata.scope || null
    },
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || ""
  };
}

function summarizeResolvedSourceManifest(documents, excludedDocuments, missingDocuments) {
  const allCurrent = [...documents, ...excludedDocuments];
  const addedDocuments = documents.filter((document) => document.changeStatus === "added").length;
  const modifiedDocuments = documents.filter((document) => document.changeStatus === "modified").length;
  const restoredDocuments = documents.filter((document) => document.changeStatus === "restored").length;
  const unchangedDocuments = documents.filter((document) => document.changeStatus === "unchanged").length;
  const userExcludedDocuments = excludedDocuments.filter((document) => document.status === "excluded_by_user").length;
  return {
    logicalDocuments: allCurrent.length,
    includedDocuments: documents.length,
    excludedDocuments: excludedDocuments.length,
    userExcludedDocuments,
    outOfScopeDocuments: excludedDocuments.length - userExcludedDocuments,
    sourceParts: allCurrent.reduce((total, document) => total + Math.max(1, document.sourceParts.length), 0),
    addedDocuments,
    modifiedDocuments,
    restoredDocuments,
    unchangedDocuments,
    missingDocuments: missingDocuments.length,
    needsAttention: modifiedDocuments + restoredDocuments + missingDocuments.length
  };
}

function buildSourceDelta(resolution = {}) {
  const documents = [
    ...(resolution.documents || []),
    ...(resolution.excludedDocuments || []),
    ...(resolution.missingDocuments || [])
  ];
  const versionNotes = documents
    .filter((document) => document.changeStatus && document.changeStatus !== "unchanged")
    .map((document) => ({
      documentId: document.documentId || "",
      versionId: document.versionId || "",
      title: document.title || "",
      relativePath: document.relativePath || "",
      changeStatus: document.changeStatus || "",
      status: document.status || "",
      previousStatus: document.previousStatus || "",
      contentHash: document.contentHash || "",
      previousContentHash: document.previousContentHash || "",
      reason: document.reason || document.userReason || ""
    }));
  return {
    kind: "knowmesh.sourceDelta",
    apiVersion: "1.0.0",
    generatedAt: nowIso(),
    knowledgeBase: resolution.knowledgeBase || { id: "" },
    summary: {
      addedDocuments: Number(resolution.summary?.addedDocuments || 0),
      modifiedDocuments: Number(resolution.summary?.modifiedDocuments || 0),
      restoredDocuments: Number(resolution.summary?.restoredDocuments || 0),
      excludedDocuments: Number(resolution.summary?.excludedDocuments || 0),
      missingDocuments: Number(resolution.summary?.missingDocuments || 0),
      changedDocuments: versionNotes.length
    },
    versionNotes,
    rerunScope: {
      documentIds: [...new Set(versionNotes.map((note) => note.documentId).filter(Boolean))].sort(),
      relativePaths: [...new Set(versionNotes.map((note) => note.relativePath).filter(Boolean))].sort()
    }
  };
}

function catalogSourceDocuments(rows) {
  const byDocumentId = new Map();
  for (const row of rows) {
    if (!byDocumentId.has(row.document_id)) {
      const metadata = parseJson(row.metadata_json, {});
      byDocumentId.set(row.document_id, {
        documentId: row.document_id || "",
        title: row.title || row.normalized_relative_path || "",
        relativePath: normalizeRelativePath(row.normalized_relative_path || ""),
        sourceType: row.source_type || "",
        contentHash: row.content_hash || "",
        status: row.status || "included",
        qualityState: row.quality_state || "",
        reason: metadata.reason || "",
        userReason: metadata.userReason || "",
        originalPath: row.original_path || "",
        sourceUri: metadata.sourceUri || "",
        artifactPath: "",
        sourceParts: Array.isArray(metadata.sourceParts) ? metadata.sourceParts.map(normalizeSourcePart) : [],
        merge: metadata.merge || null,
        metadata: {
          sourceRoot: metadata.sourceRoot || "",
          workspaceRoot: metadata.workspaceRoot || "",
          scope: metadata.scope || null
        },
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || "",
        versions: []
      });
    }
    const document = byDocumentId.get(row.document_id);
    if (row.version_id) {
      const versionMetadata = parseJson(row.version_metadata_json, {});
      document.versions.push({
        id: row.version_id,
        displayVersion: row.display_version || "",
        contentHash: row.version_content_hash || "",
        status: row.version_status || "",
        artifactPath: row.artifact_path || "",
        metadata: {
          sourceUri: versionMetadata.sourceUri || "",
          sourceParts: Array.isArray(versionMetadata.sourceParts) ? versionMetadata.sourceParts.map(normalizeSourcePart) : []
        },
        createdAt: row.version_created_at || "",
        updatedAt: row.version_updated_at || ""
      });
      if (!document.artifactPath && row.artifact_path) document.artifactPath = row.artifact_path;
    }
  }
  return [...byDocumentId.values()].map((document) => ({
    ...document,
    changeStatus: document.status === "missing" ? "missing" : document.versions.length > 1 ? "changed" : document.status
  }));
}

function summarizeCatalogSourceManifest(documents) {
  const excludedDocuments = documents.filter((document) => String(document.status).startsWith("excluded"));
  const userExcludedDocuments = excludedDocuments.filter((document) => document.status === "excluded_by_user").length;
  const missingDocuments = documents.filter((document) => document.status === "missing").length;
  return {
    logicalDocuments: documents.length,
    includedDocuments: documents.filter((document) => document.status === "included").length,
    excludedDocuments: excludedDocuments.length,
    userExcludedDocuments,
    outOfScopeDocuments: excludedDocuments.length - userExcludedDocuments,
    missingDocuments,
    changedDocuments: documents.filter((document) => document.versions.length > 1).length,
    sourceParts: documents.reduce((total, document) => total + Math.max(1, document.sourceParts.length), 0),
    versions: documents.reduce((total, document) => total + document.versions.length, 0)
  };
}

function emptyCatalogSourceManifest() {
  return {
    ok: false,
    kind: "knowmesh.sourceManifest",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "" },
    summary: {
      logicalDocuments: 0,
      includedDocuments: 0,
      excludedDocuments: 0,
      userExcludedDocuments: 0,
      outOfScopeDocuments: 0,
      missingDocuments: 0,
      changedDocuments: 0,
      sourceParts: 0,
      versions: 0
    },
    documents: []
  };
}

function workspaceRelativeArtifactPath(document = {}, manifest = {}) {
  const artifactRoot = manifest?.workspace?.artifactRoot || "";
  const outputPath = document.merge?.outputPath || "";
  if (artifactRoot && outputPath) {
    const relative = path.relative(artifactRoot, outputPath);
    if (relative && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return normalizeRelativePath(path.join("artifacts", relative));
    }
  }
  return normalizeRelativePath(path.join("artifacts", "sources", document.relativePath || document.sourceParts?.[0]?.relativePath || ""));
}

function normalizeSourcePart(part = {}) {
  return {
    path: String(part.path || ""),
    uri: String(part.uri || ""),
    relativePath: normalizeRelativePath(part.relativePath || ""),
    size: Number(part.size || 0),
    sha256: String(part.sha256 || ""),
    ...(part.partNumber ? { partNumber: Number(part.partNumber) } : {})
  };
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}
