import fs from "node:fs";
import path from "node:path";

import { currentKnowledgeBaseId, knowledgeBaseDataRoot } from "./knowledge-bases.mjs";
import { catalogDatabasePath, nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

const overridesFileName = "document-overrides.json";

export function documentOverridesPath(state, knowledgeBaseId = currentKnowledgeBaseId(state)) {
  return catalogDatabasePath(state, knowledgeBaseId);
}

export function readDocumentOverrides(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const db = openDocumentOverrideDatabase(state, knowledgeBaseId);
  try {
    const rows = db.prepare(`
      SELECT document_key, status, reason, document_json, created_at, updated_at
      FROM document_overrides
      WHERE status = 'excluded_by_user'
      ORDER BY document_key ASC
    `).all();
    const excluded = rows.map((row) => {
      const document = parseJson(row.document_json, {});
      return {
        ...document,
        status: "excluded_by_user",
        reason: String(row.reason || document.reason || "用户排除"),
        createdAt: String(row.created_at || document.createdAt || ""),
        updatedAt: String(row.updated_at || document.updatedAt || "")
      };
    });
    return normalizeOverrides({
      updatedAt: rows.reduce((latest, row) => String(row.updated_at || "") > latest ? String(row.updated_at || "") : latest, ""),
      excluded
    });
  } finally {
    db.close();
  }
}

export function excludeKnowledgeBaseDocuments(state, input = {}) {
  const overrides = readDocumentOverrides(state);
  const now = new Date().toISOString();
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const reason = String(input.reason || "用户排除").trim() || "用户排除";
  const byKey = new Map(overrides.excluded.flatMap((item) => documentIdentityKeys(item).map((key) => [key, item])));

  for (const document of documents) {
    const keys = documentIdentityKeys(document);
    if (!keys.length) continue;
    const existing = keys.map((key) => byKey.get(key)).find(Boolean);
    const record = {
      status: "excluded_by_user",
      reason,
      document_id: String(document.document_id || existing?.document_id || ""),
      version_id: String(document.version_id || existing?.version_id || ""),
      title: String(document.title || existing?.title || document.relativePath || ""),
      relativePath: normalizeRelativePath(document.relativePath || existing?.relativePath || ""),
      sourceType: String(document.sourceType || existing?.sourceType || ""),
      source_fingerprint: String(document.source_fingerprint || existing?.source_fingerprint || ""),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    const primaryKey = keys[0];
    byKey.set(primaryKey, record);
  }

  const next = {
    ...overrides,
    updatedAt: now,
    excluded: uniqueOverrideRecords([...byKey.values()])
  };
  writeOverrides(state, next);
  markCatalogDocumentsExcludedByUser(state, next.excluded);
  return { ok: true, overrides: next, summary: { excludedByUser: next.excluded.length } };
}

export function restoreKnowledgeBaseDocuments(state, input = {}) {
  const overrides = readDocumentOverrides(state);
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const restoreKeys = new Set(documents.flatMap(documentIdentityKeys));
  const next = {
    ...overrides,
    updatedAt: new Date().toISOString(),
    excluded: overrides.excluded.filter((item) => !documentIdentityKeys(item).some((key) => restoreKeys.has(key)))
  };
  writeOverrides(state, next);
  restoreCatalogDocumentsExcludedByUser(state, documents);
  return { ok: true, overrides: next, summary: { excludedByUser: next.excluded.length } };
}

export function applyDocumentOverridesToManifest(state, manifest) {
  const overrides = readDocumentOverrides(state);
  const excludedRules = overrides.excluded || [];
  const scopeFilter = manifest.scopeFilter || { enabled: false, selected: {} };
  if (!excludedRules.length) {
    return {
      ...manifest,
      scopeFilter: {
        ...scopeFilter,
        userExcludedDocuments: 0
      }
    };
  }

  const includedDocuments = [];
  const userExcludedDocuments = [];
  for (const document of manifest.logicalDocuments || []) {
    const rule = findOverrideRule(document, excludedRules);
    if (rule) {
      userExcludedDocuments.push(formatUserExcludedDocument(document, rule));
    } else {
      includedDocuments.push(document);
    }
  }

  const includedPaths = new Set(includedDocuments.map((document) => identityPath(document.relativePath)));
  const splitPdfGroups = Array.isArray(manifest.splitPdfGroups)
    ? manifest.splitPdfGroups.filter((group) => includedPaths.has(identityPath(group.logicalRelativePath)))
    : [];
  const warnings = Array.isArray(manifest.warnings)
    ? manifest.warnings.filter((warning) => !warning.logicalRelativePath || includedPaths.has(identityPath(warning.logicalRelativePath)))
    : [];
  const includedFiles = includedDocuments.reduce((total, document) => total + Math.max(1, document.sourceParts?.length || 0), 0);
  const excludedFiles = userExcludedDocuments.reduce((total, document) => total + Math.max(1, document.sourceParts?.length || 0), 0);
  const existingExcluded = Array.isArray(scopeFilter.excluded) ? scopeFilter.excluded : [];

  return {
    ...manifest,
    files: {
      ...manifest.files,
      included: includedFiles
    },
    splitPdfGroups,
    logicalDocuments: includedDocuments,
    warnings,
    scopeFilter: {
      ...scopeFilter,
      totalDocumentsBeforeScope: scopeFilter.totalDocumentsBeforeScope ?? (includedDocuments.length + userExcludedDocuments.length + existingExcluded.length),
      includedDocuments: includedDocuments.length,
      excludedDocuments: existingExcluded.length + userExcludedDocuments.length,
      excludedFiles: Number(scopeFilter.excludedFiles || 0) + excludedFiles,
      userExcludedDocuments: userExcludedDocuments.length,
      excluded: [...existingExcluded, ...userExcludedDocuments]
    }
  };
}

export function buildDocumentInventory(plan, job = {}, context = {}) {
  const documents = Array.isArray(plan.documents) ? plan.documents : [];
  const excludedArtifacts = context.excludedArtifacts || [];
  const excludedDocuments = context.excludedDocuments || [];
  const userExcludedDocuments = excludedDocuments.filter((document) => document.status === "excluded_by_user" || document.reason === "excluded_by_user");
  return {
    kind: "knowmesh.documentInventory",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project || {},
    job: { id: job.id || "", mode: job.mode || "", template: job.template || plan.project?.id || "" },
    scope: {
      enabled: context.scope?.enabled === true,
      selected: context.scope?.selected || {}
    },
    summary: {
      includedDocuments: documents.length,
      excludedDocuments: excludedDocuments.length,
      userExcludedDocuments: userExcludedDocuments.length,
      includedArtifacts: context.inputs?.length || 0,
      excludedArtifacts: excludedArtifacts.length
    },
    includedDocuments: documents.map((document) => inventoryDocument(document, "included", "current_scope")),
    excludedDocuments,
    excludedArtifacts
  };
}

export function buildDocumentInventoryFromScan(scan, job = {}) {
  const manifest = scan?.manifest || {};
  return buildDocumentInventory(
    {
      project: manifest.project || { id: scan?.template?.id || "", name: scan?.template?.title?.zh || "" },
      documents: manifest.logicalDocuments || []
    },
    job,
    {
      scope: manifest.scopeFilter || {},
      excludedDocuments: Array.isArray(manifest.scopeFilter?.excluded) ? manifest.scopeFilter.excluded : []
    }
  );
}

export function summarizeDocumentChanges(previousInventory, currentScan) {
  const previousDocuments = Array.isArray(previousInventory?.includedDocuments) ? previousInventory.includedDocuments : [];
  const manifest = currentScan?.manifest || {};
  const currentIncluded = Array.isArray(manifest.logicalDocuments) ? manifest.logicalDocuments : [];
  const currentExcluded = Array.isArray(manifest.scopeFilter?.excluded) ? manifest.scopeFilter.excluded : [];
  const currentAll = [...currentIncluded, ...currentExcluded];
  const currentIncludedByKey = documentMap(currentIncluded);
  const currentAllByKey = documentMap(currentAll);
  const previousByKey = documentMap(previousDocuments);

  const added = currentIncluded.filter((document) => !findMappedDocument(document, previousByKey)).map((document) => inventoryDocument(document, "added", "new_source"));
  const modified = currentIncluded
    .filter((document) => {
      const previous = findMappedDocument(document, previousByKey);
      return previous && String(previous.source_fingerprint || "") !== String(document.source_fingerprint || "");
    })
    .map((document) => {
      const previous = findMappedDocument(document, previousByKey);
      return inventoryDocument(document, "modified", "source_changed", {
        displayVersion: nextDocumentDisplayVersion(previous)
      });
    });
  const missing = previousDocuments
    .filter((document) => !findMappedDocument(document, currentAllByKey))
    .map((document) => ({ ...document, status: "missing", reason: "source_missing" }));
  const unchanged = currentIncluded.filter((document) => {
    const previous = findMappedDocument(document, previousByKey);
    return previous && String(previous.source_fingerprint || "") === String(document.source_fingerprint || "");
  }).length;
  const excludedByUser = currentExcluded.filter((document) => document.status === "excluded_by_user" || document.reason === "excluded_by_user").length;

  return {
    summary: {
      added: added.length,
      modified: modified.length,
      missing: missing.length,
      unchanged,
      excludedByUser,
      needsAttention: added.length + modified.length + missing.length
    },
    added,
    modified,
    missing,
    excluded: currentExcluded
  };
}

export function buildDocumentListPayload(state, options = {}) {
  const scanInventory = options.scan ? buildDocumentInventoryFromScan(options.scan, options.job || {}) : null;
  const inventory = options.inventory || scanInventory || null;
  const changes = options.changes || null;
  const catalogRows = inventory ? null : readCatalogDocumentRows(state);
  const fallbackUpdatedAt = inventory?.generatedAt || "";
  const included = inventory
    ? (inventory.includedDocuments || []).map((document) => documentRow(document, "included", fallbackUpdatedAt))
    : catalogRows.filter((document) => document.status === "included");
  const excluded = inventory
    ? (inventory.excludedDocuments || []).map((document) => documentRow(document, document.reason === "excluded_by_user" ? "excluded_by_user" : "excluded", fallbackUpdatedAt))
    : catalogRows.filter((document) => String(document.status).startsWith("excluded"));
  const baseRows = inventory ? [...included, ...excluded] : catalogRows;
  const rows = applyDocumentChanges(baseRows, changes);
  const list = selectDocumentPage(rows, options.listOptions || {});

  return {
    ok: true,
    knowledgeBaseId: currentKnowledgeBaseId(state),
    summary: {
      includedDocuments: included.length,
      excludedDocuments: excluded.length,
      userExcludedDocuments: excluded.filter((document) => document.status === "excluded_by_user").length,
      totalDocuments: baseRows.length,
      changes: changes?.summary || null
    },
    resultSummary: list.resultSummary,
    pagination: list.pagination,
    facets: list.facets,
    documents: list.documents,
    changes
  };
}

export function readCatalogDocumentInventory(state) {
  const rows = readCatalogDocumentRows(state);
  const includedDocuments = rows.filter((document) => document.status === "included");
  const excludedDocuments = rows.filter((document) => String(document.status).startsWith("excluded"));
  const generatedAt = rows.reduce((latest, row) => String(row.updatedAt || "") > latest ? String(row.updatedAt || "") : latest, "");
  return {
    ...emptyInventory(),
    generatedAt,
    summary: {
      includedDocuments: includedDocuments.length,
      excludedDocuments: excludedDocuments.length,
      userExcludedDocuments: excludedDocuments.filter((document) => document.status === "excluded_by_user").length,
      includedArtifacts: 0,
      excludedArtifacts: 0,
      totalDocuments: rows.length
    },
    includedDocuments,
    excludedDocuments,
    missingDocuments: rows.filter((document) => document.status === "missing")
  };
}

function readCatalogDocumentRows(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return [];
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const rows = db.prepare(`
      SELECT
        sd.document_id,
        sd.title,
        sd.source_type,
        sd.normalized_relative_path,
        sd.content_hash,
        sd.status,
        sd.quality_state,
        sd.metadata_json,
        sd.updated_at,
        dv.version_id,
        dv.display_version,
        dv.status AS version_status,
        dv.artifact_path,
        dv.metadata_json AS version_metadata_json,
        dv.updated_at AS version_updated_at
      FROM source_documents sd
      LEFT JOIN document_versions dv
        ON dv.version_id = (
          SELECT latest.version_id
          FROM document_versions latest
          WHERE latest.document_id = sd.document_id
          ORDER BY latest.updated_at DESC, latest.version_id DESC
          LIMIT 1
        )
      ORDER BY sd.normalized_relative_path ASC, sd.title ASC
    `).all();
    return rows.map(catalogDocumentRow);
  } finally {
    db.close();
  }
}

function catalogDocumentRow(row) {
  const metadata = parseJson(row.metadata_json, {});
  const versionMetadata = parseJson(row.version_metadata_json, {});
  const sourceParts = Array.isArray(metadata.sourceParts)
    ? metadata.sourceParts.map((part) => ({
      relativePath: normalizeRelativePath(part.relativePath || ""),
      path: String(part.path || ""),
      uri: String(part.uri || ""),
      size: Number(part.size || 0),
      sha256: String(part.sha256 || "")
    }))
    : [];
  const status = catalogDocumentStatus(row.status);
  return documentRow(
    {
      status,
      document_id: row.document_id,
      version_id: row.version_id || "",
      displayVersion: row.display_version || "",
      title: row.title || row.normalized_relative_path || "",
      relativePath: row.normalized_relative_path || "",
      sourceType: row.source_type || "",
      source_fingerprint: row.content_hash || "",
      reason: catalogDocumentReason(row.status, metadata),
      userReason: String(metadata.userReason || ""),
      updatedAt: row.version_updated_at || row.updated_at || "",
      sourceParts,
      artifactPath: row.artifact_path || "",
      sourceUri: metadata.sourceUri || versionMetadata.sourceUri || ""
    },
    status,
    row.updated_at || ""
  );
}

function catalogDocumentStatus(status) {
  if (status === "excluded_by_user") return "excluded_by_user";
  if (status === "excluded") return "excluded";
  if (status === "missing") return "missing";
  return "included";
}

function catalogDocumentReason(status, metadata = {}) {
  if (status === "excluded_by_user") return "excluded_by_user";
  if (status === "excluded") return String(metadata.reason || "outside_scope");
  if (status === "missing") return "source_missing";
  return "";
}

function applyDocumentChanges(documents, changes) {
  const changeMap = new Map();
  const versionMap = new Map();
  for (const [status, items] of [["added", changes?.added], ["modified", changes?.modified]]) {
    for (const item of Array.isArray(items) ? items : []) {
      const key = documentKey(item);
      changeMap.set(key, status);
      if (item.displayVersion || item.display_version) versionMap.set(key, documentDisplayVersion(item));
    }
  }
  const rows = documents.map((document) => ({
    ...document,
    changeStatus: changeMap.get(documentKey(document)) || document.status,
    displayVersion: versionMap.get(documentKey(document)) || document.displayVersion || documentDisplayVersion(document)
  }));
  const known = new Set(rows.map(documentKey));
  for (const item of Array.isArray(changes?.missing) ? changes.missing : []) {
    const key = documentKey(item);
    if (!known.has(key)) rows.push({ ...documentRow(item, "missing"), changeStatus: "missing" });
  }
  return rows;
}

function selectDocumentPage(documents, options = {}) {
  const listOptions = normalizeListOptions(options);
  const queryMatched = documents.filter((document) => documentMatchesQuery(document, listOptions.query));
  const matched = queryMatched.filter((document) => documentMatchesFilter(document, listOptions.filter));
  const page = matched.slice(listOptions.cursor, listOptions.cursor + listOptions.limit);
  const showingFrom = matched.length ? listOptions.cursor + 1 : 0;
  const showingTo = listOptions.cursor + page.length;
  const nextCursor = showingTo < matched.length ? String(showingTo) : "";

  return {
    documents: page,
    facets: countDocumentStatuses(queryMatched),
    resultSummary: {
      query: listOptions.query,
      filter: listOptions.filter,
      totalMatched: matched.length,
      loadedCount: page.length,
      showingFrom,
      showingTo,
      statusCounts: countDocumentStatuses(matched)
    },
    pagination: {
      cursor: String(listOptions.cursor),
      limit: listOptions.limit,
      returned: page.length,
      nextCursor,
      hasMore: Boolean(nextCursor),
      totalMatched: matched.length
    }
  };
}

function normalizeListOptions(options = {}) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(options.limit ?? 50, 10) || 50));
  const cursor = Math.max(0, Number.parseInt(options.cursor ?? 0, 10) || 0);
  const filter = ["all", "included", "excluded", "attention"].includes(String(options.filter || "")) ? String(options.filter) : "all";
  return {
    query: String(options.query || "").trim(),
    filter,
    limit,
    cursor
  };
}

function documentMatchesQuery(document, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return true;
  return [document.title, document.relativePath, document.sourceType, document.reason, document.userReason]
    .some((value) => String(value || "").toLowerCase().includes(needle));
}

function documentMatchesFilter(document, filter) {
  const baseStatus = document.status || "included";
  const changeStatus = document.changeStatus || baseStatus;
  if (!filter || filter === "all") return true;
  if (filter === "included") return baseStatus === "included";
  if (filter === "excluded") return String(baseStatus).startsWith("excluded");
  if (filter === "attention") return ["added", "modified", "missing"].includes(changeStatus);
  return true;
}
function countDocumentStatuses(documents) {
  const counts = { included: 0, excluded: 0, excludedByUser: 0, attention: 0, added: 0, modified: 0, missing: 0 };
  for (const document of documents) {
    const baseStatus = document.status || "included";
    const changeStatus = document.changeStatus || baseStatus;
    if (baseStatus === "included") counts.included += 1;
    if (String(baseStatus).startsWith("excluded")) counts.excluded += 1;
    if (baseStatus === "excluded_by_user") counts.excludedByUser += 1;
    if (["added", "modified", "missing"].includes(changeStatus)) {
      counts.attention += 1;
      counts[changeStatus] += 1;
    }
  }
  return counts;
}
function documentKey(documentItem) {
  return documentItem?.document_id || documentItem?.relativePath || documentItem?.version_id || "";
}
function writeOverrides(state, overrides) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const db = openDocumentOverrideDatabase(state, knowledgeBaseId);
  try {
    const normalized = normalizeOverrides(overrides);
    const replace = db.transaction(() => {
      db.prepare("DELETE FROM document_overrides").run();
      const insert = db.prepare(`
        INSERT INTO document_overrides (
          override_id, document_key, status, reason, document_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const record of normalized.excluded) {
        const key = documentIdentityKeys(record)[0];
        if (!key) continue;
        insert.run(
          key,
          key,
          "excluded_by_user",
          String(record.reason || "用户排除"),
          stableJson(record),
          String(record.createdAt || normalized.updatedAt || nowIso()),
          String(record.updatedAt || normalized.updatedAt || nowIso())
        );
      }
    });
    replace();
  } finally {
    db.close();
  }
}

function markCatalogDocumentsExcludedByUser(state, documents) {
  updateCatalogDocumentStatuses(state, documents, (row, document) => {
    const metadata = parseJson(row.metadata_json, {});
    return {
      sourceStatus: "excluded_by_user",
      versionStatus: "excluded_by_user",
      qualityState: "archive",
      metadata: {
        ...metadata,
        reason: "excluded_by_user",
        userReason: document.reason || document.userReason || "用户排除"
      }
    };
  });
}

function restoreCatalogDocumentsExcludedByUser(state, documents) {
  updateCatalogDocumentStatuses(state, documents, (row) => {
    if (row.status !== "excluded_by_user") return null;
    const metadata = parseJson(row.metadata_json, {});
    delete metadata.reason;
    delete metadata.userReason;
    return {
      sourceStatus: "included",
      versionStatus: "planned",
      qualityState: "primary",
      metadata
    };
  });
}

function updateCatalogDocumentStatuses(state, documents, resolveNext) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return;
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const select = db.prepare(`
      SELECT DISTINCT
        sd.document_id,
        sd.normalized_relative_path,
        sd.status,
        sd.metadata_json,
        dv.version_id
      FROM source_documents sd
      LEFT JOIN document_versions dv ON dv.document_id = sd.document_id
      WHERE sd.document_id = ?
         OR lower(sd.normalized_relative_path) = ?
         OR dv.version_id = ?
    `);
    const updateSource = db.prepare(`
      UPDATE source_documents
      SET status = ?, quality_state = ?, metadata_json = ?, updated_at = ?
      WHERE document_id = ?
    `);
    const updateVersions = db.prepare(`
      UPDATE document_versions
      SET status = ?, updated_at = ?
      WHERE document_id = ?
    `);
    const write = db.transaction(() => {
      const now = nowIso();
      for (const document of Array.isArray(documents) ? documents : []) {
        const documentId = String(document.document_id || "");
        const relativePath = identityPath(document.relativePath || "");
        const versionId = String(document.version_id || "");
        const matches = select.all(documentId, relativePath, versionId);
        const byDocumentId = new Map(matches.map((row) => [row.document_id, row]));
        for (const row of byDocumentId.values()) {
          const next = resolveNext(row, document);
          if (!next) continue;
          updateSource.run(next.sourceStatus, next.qualityState, stableJson(next.metadata || {}), now, row.document_id);
          updateVersions.run(next.versionStatus, now, row.document_id);
        }
      }
    });
    write();
  } finally {
    db.close();
  }
}

function openDocumentOverrideDatabase(state, knowledgeBaseId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  cleanupLegacyDocumentOverrides(state, knowledgeBaseId);
  return db;
}

function legacyDocumentOverridesPath(state, knowledgeBaseId) {
  return path.join(knowledgeBaseDataRoot(state, knowledgeBaseId), overridesFileName);
}

function cleanupLegacyDocumentOverrides(state, knowledgeBaseId) {
  removeFile(legacyDocumentOverridesPath(state, knowledgeBaseId));
}

function removeFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    // Legacy cleanup is best-effort after SQLite migration has been written.
  }
}

function emptyOverrides() {
  return {
    kind: "knowmesh.documentOverrides",
    apiVersion: "v1",
    updatedAt: "",
    excluded: []
  };
}

function normalizeOverrides(value) {
  const base = emptyOverrides();
  return {
    ...base,
    ...value,
    excluded: Array.isArray(value?.excluded) ? value.excluded.map((item) => ({
      status: "excluded_by_user",
      reason: String(item.reason || "用户排除"),
      document_id: String(item.document_id || ""),
      version_id: String(item.version_id || ""),
      displayVersion: documentDisplayVersion(item),
      display_version: documentDisplayVersion(item),
      title: String(item.title || ""),
      relativePath: normalizeRelativePath(item.relativePath || ""),
      sourceType: String(item.sourceType || ""),
      source_fingerprint: String(item.source_fingerprint || ""),
      createdAt: String(item.createdAt || ""),
      updatedAt: String(item.updatedAt || "")
    })) : []
  };
}

function uniqueOverrideRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = documentIdentityKeys(record)[0];
    if (key) byKey.set(key, record);
  }
  return [...byKey.values()].sort((a, b) => identityPath(a.relativePath).localeCompare(identityPath(b.relativePath)));
}

function findOverrideRule(document, rules) {
  const keys = new Set(documentIdentityKeys(document));
  return rules.find((rule) => documentIdentityKeys(rule).some((key) => keys.has(key))) || null;
}

function formatUserExcludedDocument(document, rule) {
  return {
    status: "excluded_by_user",
    reason: "excluded_by_user",
    userReason: rule.reason || "",
    document_id: document.document_id || rule.document_id || "",
    version_id: document.version_id || rule.version_id || "",
    displayVersion: documentDisplayVersion(document, documentDisplayVersion(rule)),
    display_version: documentDisplayVersion(document, documentDisplayVersion(rule)),
    title: document.title || rule.title || "",
    relativePath: normalizeRelativePath(document.relativePath || rule.relativePath || ""),
    sourceType: document.sourceType || rule.sourceType || "",
    source_fingerprint: document.source_fingerprint || rule.source_fingerprint || "",
    updatedAt: rule.updatedAt || "",
    sourceParts: Array.isArray(document.sourceParts) ? document.sourceParts.map((part) => ({
      relativePath: normalizeRelativePath(part.relativePath || ""),
      size: part.size || 0,
      sha256: part.sha256 || ""
    })) : []
  };
}

function inventoryDocument(document, status, reason, options = {}) {
  const displayVersion = documentDisplayVersion({ ...document, displayVersion: options.displayVersion });
  return {
    status,
    reason,
    document_id: document.document_id || "",
    version_id: document.version_id || "",
    displayVersion,
    display_version: displayVersion,
    title: document.title || "",
    relativePath: normalizeRelativePath(document.relativePath || ""),
    sourceType: document.sourceType || "",
    source_fingerprint: document.source_fingerprint || "",
    updatedAt: String(options.updatedAt || document.updatedAt || document.modifiedAt || ""),
    sourceParts: Array.isArray(document.sourceParts) ? document.sourceParts.map((part) => ({
      relativePath: normalizeRelativePath(part.relativePath || ""),
      size: part.size || 0,
      sha256: part.sha256 || ""
    })) : []
  };
}

function documentRow(document, status, fallbackUpdatedAt = "") {
  const displayVersion = documentDisplayVersion(document);
  return {
    status,
    document_id: document.document_id || "",
    version_id: document.version_id || "",
    displayVersion,
    display_version: displayVersion,
    title: document.title || document.relativePath || "",
    relativePath: normalizeRelativePath(document.relativePath || ""),
    sourceType: document.sourceType || "",
    source_fingerprint: document.source_fingerprint || "",
    reason: document.reason || "",
    userReason: document.userReason || "",
    updatedAt: String(document.updatedAt || document.modifiedAt || fallbackUpdatedAt || ""),
    sourceParts: Array.isArray(document.sourceParts) ? document.sourceParts : [],
    artifactPath: normalizeRelativePath(document.artifactPath || ""),
    sourceUri: String(document.sourceUri || "")
  };
}

function documentDisplayVersion(document, fallback = "v1.0.0") {
  return normalizeDisplayVersion(
    document?.displayVersion
    || document?.display_version
    || document?.contentVersion
    || document?.content_version
    || ""
  ) || normalizeDisplayVersion(fallback) || "v1.0.0";
}

function nextDocumentDisplayVersion(document) {
  const version = documentDisplayVersion(document);
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return "v1.0.1";
  return `v${Number(match[1])}.${Number(match[2])}.${Number(match[3]) + 1}`;
}

function normalizeDisplayVersion(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/.exec(raw);
  if (!match) return "";
  return `v${Number(match[1])}.${Number(match[2] || 0)}.${Number(match[3] || 0)}`;
}

function documentMap(documents) {
  const map = new Map();
  for (const document of documents) {
    for (const key of documentIdentityKeys(document)) {
      if (!map.has(key)) map.set(key, document);
    }
  }
  return map;
}

function findMappedDocument(document, map) {
  for (const key of documentIdentityKeys(document)) {
    if (map.has(key)) return map.get(key);
  }
  return null;
}

function documentIdentityKeys(document) {
  const keys = [
    document?.document_id ? `doc:${document.document_id}` : "",
    document?.relativePath ? `path:${identityPath(document.relativePath)}` : "",
    document?.version_id ? `version:${document.version_id}` : ""
  ].filter(Boolean);
  return [...new Set(keys)];
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function identityPath(value) {
  return normalizeRelativePath(value).toLowerCase();
}

function emptyInventory() {
  return {
    kind: "knowmesh.documentInventory",
    apiVersion: "v1",
    generatedAt: "",
    project: {},
    job: {},
    scope: { enabled: false, selected: {} },
    summary: { includedDocuments: 0, excludedDocuments: 0, userExcludedDocuments: 0, includedArtifacts: 0, excludedArtifacts: 0 },
    includedDocuments: [],
    excludedDocuments: [],
    excludedArtifacts: []
  };
}



