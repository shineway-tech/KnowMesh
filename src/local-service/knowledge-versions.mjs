import path from "node:path";

import { listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function knowledgeBaseVersions(state, options = {}) {
  const limit = Number(options.limit || 20);
  const registry = listKnowledgeBases(state);
  const current = registry.current;
  if (!current?.id) {
    return {
      ok: false,
      kind: "knowmesh.versionRecords",
      error: { code: "NO_KNOWLEDGE_BASE", message: "Knowledge base is required." },
      knowledgeBase: null,
      summary: emptySummary(),
      versions: []
    };
  }

  const versions = readVersionRecordsFromCatalog(state, current.id)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(100, limit)));
  const active = versions.find((item) => item.active) || versions[0] || null;
  const sidecarReady = versions.filter((item) => item.sidecar?.status === "ready").length;

  return {
    ok: true,
    kind: "knowmesh.versionRecords",
    knowledgeBase: {
      id: current.id,
      name: current.name || current.id,
      template: current.template || "",
      status: current.status || ""
    },
    summary: {
      total: versions.length,
      active: active?.id || "",
      latest: versions[0]?.id || "",
      sidecarReady,
      sidecarMissing: versions.length - sidecarReady
    },
    versions
  };
}

export function knowledgeBaseVersionDiff(state, options = {}) {
  const context = readVersionContext(state);
  if (!context.ok) return context;
  const baseBuildId = String(options.baseBuildId || context.active?.buildId || "").trim();
  const targetBuildId = String(options.targetBuildId || options.buildId || "").trim();
  if (!targetBuildId) return versionError("knowmesh.versionDiff", "TARGET_VERSION_REQUIRED", "Target version is required.", context);
  const base = context.versions.find((item) => item.buildId === baseBuildId) || null;
  const target = context.versions.find((item) => item.buildId === targetBuildId) || null;
  if (!base) return versionError("knowmesh.versionDiff", "BASE_VERSION_NOT_FOUND", "Base version was not found.", context);
  if (!target) return versionError("knowmesh.versionDiff", "TARGET_VERSION_NOT_FOUND", "Target version was not found.", context);
  return buildVersionDiff(context, base, target);
}

export function previewKnowledgeBaseRollback(state, input = {}) {
  const targetBuildId = String(input.targetBuildId || input.buildId || "").trim();
  const context = readVersionContext(state);
  if (!context.ok) return context;
  if (!targetBuildId) return versionError("knowmesh.versionRollbackPreview", "TARGET_VERSION_REQUIRED", "Target version is required.", context);
  const target = context.versions.find((item) => item.buildId === targetBuildId) || null;
  if (!target) return versionError("knowmesh.versionRollbackPreview", "TARGET_VERSION_NOT_FOUND", "Target version was not found.", context);
  if (!target.release) return versionError("knowmesh.versionRollbackPreview", "TARGET_RELEASE_REQUIRED", "Target version has no release to activate.", context);
  if (target.active) return versionError("knowmesh.versionRollbackPreview", "TARGET_ALREADY_ACTIVE", "Target version is already active.", context);
  const diff = buildVersionDiff(context, context.active, target);
  return {
    ok: true,
    kind: "knowmesh.versionRollbackPreview",
    apiVersion: "1.0.0",
    knowledgeBase: publicKnowledgeBase(context.current),
    requiresConfirmation: true,
    currentBuildId: context.active?.buildId || "",
    targetBuildId,
    targetReleaseId: target.release.releaseId,
    diff,
    checks: [
      versionCheck("targetRelease", "pass", "目标版本", "Target version", "目标版本有可激活发布记录。", "The target version has an activatable release."),
      versionCheck("activation", "warn", "回滚确认", "Rollback confirmation", "确认后会切换当前生效版本。", "Confirmation switches the active version.")
    ],
    confirmation: {
      required: true,
      action: "rollback-version",
      targetBuildId,
      label: { zh: "确认回滚", en: "Confirm rollback" }
    }
  };
}

export function rollbackKnowledgeBaseVersion(state, input = {}) {
  const preview = previewKnowledgeBaseRollback(state, input);
  if (!preview.ok) return preview;
  if (input.confirm !== true) {
    return {
      ok: false,
      kind: "knowmesh.versionRollback",
      error: { code: "CONFIRMATION_REQUIRED", message: "Rollback confirmation is required." },
      preview
    };
  }

  const context = readVersionContext(state);
  const target = context.versions.find((item) => item.buildId === preview.targetBuildId);
  const now = nowIso();
  const db = openCatalogDatabase(state, context.current.id);
  try {
    const targetSummary = {
      ...target.buildSummary,
      rollback: {
        activatedAt: now,
        previousActiveBuildId: preview.currentBuildId,
        targetBuildId: preview.targetBuildId,
        releaseId: preview.targetReleaseId
      }
    };
    const activate = db.transaction(() => {
      db.prepare(`
        UPDATE build_versions
        SET active = 0,
            status = CASE WHEN status = 'active' THEN 'published' ELSE status END,
            updated_at = ?
        WHERE active = 1
      `).run(now);
      db.prepare(`
        UPDATE release_manifests
        SET status = CASE WHEN status = 'active' THEN 'published' ELSE status END,
            updated_at = ?
        WHERE status = 'active'
      `).run(now);
      db.prepare(`
        UPDATE build_versions
        SET active = 1, status = 'active', summary_json = ?, updated_at = ?
        WHERE build_id = ?
      `).run(stableJson(targetSummary), now, preview.targetBuildId);
      db.prepare(`
        UPDATE release_manifests
        SET status = 'active', updated_at = ?
        WHERE release_id = ?
      `).run(now, preview.targetReleaseId);
    });
    activate();
  } finally {
    db.close();
  }

  return {
    ok: true,
    kind: "knowmesh.versionRollback",
    apiVersion: "1.0.0",
    knowledgeBase: preview.knowledgeBase,
    activatedBuildId: preview.targetBuildId,
    previousActiveBuildId: preview.currentBuildId,
    activatedAt: now,
    diff: preview.diff,
    versions: knowledgeBaseVersions(state, { limit: 40 })
  };
}

function readVersionRecordsFromCatalog(state, knowledgeBaseId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const documentCounts = countByStatus(db, "source_documents");
    const indexCounts = countByStatus(db, "index_records");
    const buildRows = db.prepare(`
      SELECT
        b.build_id,
        b.status AS build_status,
        b.active,
        b.summary_json AS build_summary_json,
        b.created_at AS build_created_at,
        b.updated_at AS build_updated_at
      FROM build_versions b
      ORDER BY b.updated_at DESC, b.build_id ASC
    `).all();
    const releaseByBuild = preferredReleaseByBuild(db.prepare(`
      SELECT
        r.build_id,
        r.release_id,
        r.status AS release_status,
        r.manifest_path,
        r.summary_json AS release_summary_json,
        r.created_at AS release_created_at,
        r.updated_at AS release_updated_at
      FROM release_manifests r
      ORDER BY r.build_id ASC, r.updated_at DESC, r.release_id ASC
    `).all());
    return buildRows
      .map((row) => versionRecordFromCatalogRow({ ...row, ...(releaseByBuild.get(row.build_id) || {}) }, { documentCounts, indexCounts }))
      .filter(Boolean);
  } finally {
    db.close();
  }
}

function readVersionContext(state) {
  const registry = listKnowledgeBases(state);
  const current = registry.current;
  if (!current?.id) {
    return {
      ok: false,
      kind: "knowmesh.versionContext",
      error: { code: "NO_KNOWLEDGE_BASE", message: "Knowledge base is required." },
      knowledgeBase: null,
      versions: []
    };
  }
  const db = openCatalogDatabase(state, current.id);
  try {
    const buildRows = db.prepare(`
      SELECT build_id, status, active, parent_build_id, summary_json, created_at, updated_at
      FROM build_versions
      ORDER BY updated_at DESC, build_id ASC
    `).all();
    const releaseRows = db.prepare(`
      SELECT release_id, build_id, status, manifest_path, summary_json, created_at, updated_at
      FROM release_manifests
      ORDER BY build_id ASC, updated_at DESC, release_id ASC
    `).all();
    const releaseByBuild = preferredReleaseByBuild(releaseRows);
    const versions = buildRows.map((row) => rawVersionRow(row, releaseByBuild.get(row.build_id) || null));
    return {
      ok: true,
      current,
      versions,
      active: versions.find((item) => item.active) || versions[0] || null
    };
  } finally {
    db.close();
  }
}

function rawVersionRow(row, release = null) {
  return {
    buildId: String(row.build_id || ""),
    status: String(row.status || ""),
    active: Number(row.active || 0) === 1,
    parentBuildId: String(row.parent_build_id || ""),
    buildSummary: parseJson(row.summary_json, {}),
    release: release ? {
      releaseId: String(release.release_id || ""),
      buildId: String(release.build_id || ""),
      status: String(release.status || release.release_status || ""),
      manifestPath: String(release.manifest_path || ""),
      summary: parseJson(release.summary_json || release.release_summary_json, {}),
      createdAt: String(release.created_at || release.release_created_at || ""),
      updatedAt: String(release.updated_at || release.release_updated_at || "")
    } : null,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function preferredReleaseByBuild(rows) {
  const byBuild = new Map();
  for (const row of rows) {
    const current = byBuild.get(row.build_id);
    if (!current || compareReleasePreference(row, current) < 0) byBuild.set(row.build_id, row);
  }
  return byBuild;
}

function compareReleasePreference(a, b) {
  const rank = releaseStatusRank(a.release_status || a.status) - releaseStatusRank(b.release_status || b.status);
  if (rank !== 0) return rank;
  const updated = String(b.release_updated_at || b.updated_at || "").localeCompare(String(a.release_updated_at || a.updated_at || ""));
  if (updated !== 0) return updated;
  const created = String(b.release_created_at || b.created_at || "").localeCompare(String(a.release_created_at || a.created_at || ""));
  if (created !== 0) return created;
  return String(a.release_id || "").localeCompare(String(b.release_id || ""));
}

function releaseStatusRank(status) {
  switch (String(status || "")) {
    case "active": return 0;
    case "published": return 1;
    case "ready": return 2;
    case "draft": return 3;
    default: return 4;
  }
}

function versionRecordFromCatalogRow(row, counts) {
  const buildSummary = parseJson(row.build_summary_json, {});
  const releaseSummary = parseJson(row.release_summary_json, {});
  const target = releaseSummary.target || buildSummary.target || {};
  const sidecar = releaseSummary.sidecar || null;
  const manifestPath = String(row.manifest_path || "");
  const writeRecords = Number(counts.indexCounts.written || counts.indexCounts.embedded || 0);
  const writeFailed = Number(counts.indexCounts.failed || 0);
  const includedDocuments = Number(counts.documentCounts.included || 0);
  const excludedDocuments = Number(counts.documentCounts.excluded || 0) + Number(counts.documentCounts.excluded_by_user || 0);
  const attentionDocuments = Number(counts.documentCounts.missing || 0);
  const totalDocuments = includedDocuments + excludedDocuments + attentionDocuments;
  const sidecarRecords = Number(sidecar?.chunks || sidecar?.records || writeRecords || 0);

  return {
    id: row.build_id,
    active: Number(row.active || 0) === 1,
    status: row.release_status || row.build_status || "draft",
    createdAt: row.release_created_at || row.build_created_at || "",
    path: versionRootFromManifestPath(manifestPath),
    target: {
      provider: target.provider || "",
      bucket: target.bucket || target.vectorBucket || "",
      indexName: target.indexName || target.index || "",
      region: target.region || ""
    },
    sidecar: {
      status: sidecar?.authoritativeStore === "oss-sidecar" || sidecar?.manifestUri ? "ready" : "missing",
      store: sidecar?.authoritativeStore || "",
      manifestUri: sidecar?.manifestUri || "",
      chunks: sidecarRecords
    },
    documents: {
      total: totalDocuments,
      included: includedDocuments,
      excluded: excludedDocuments,
      attention: attentionDocuments
    },
    write: {
      records: writeRecords,
      success: writeRecords,
      failed: writeFailed
    }
  };
}

function buildVersionDiff(context, base, target) {
  const baseSafe = safeVersionSummary(base);
  const targetSafe = safeVersionSummary(target);
  const comparison = {
    documents: compareNumericGroup(baseSafe.documents, targetSafe.documents, ["included", "excluded", "attention", "total"]),
    write: compareNumericGroup(baseSafe.write, targetSafe.write, ["records", "success", "failed"]),
    evaluation: compareNumericGroup(baseSafe.evaluation, targetSafe.evaluation, ["passed", "failed", "review"]),
    target: compareValueGroup(baseSafe.target, targetSafe.target, ["provider", "bucket", "indexName", "region"]),
    sidecar: compareValueGroup(baseSafe.sidecar, targetSafe.sidecar, ["status", "store", "manifestUri", "chunks"])
  };
  return {
    ok: true,
    kind: "knowmesh.versionDiff",
    apiVersion: "1.0.0",
    knowledgeBase: publicKnowledgeBase(context.current),
    summary: {
      baseBuildId: base.buildId,
      targetBuildId: target.buildId,
      direction: target.active ? "inspect-active" : "compare-target",
      changedGroups: Object.values(comparison).filter(groupChanged).length
    },
    base: baseSafe,
    target: targetSafe,
    comparison,
    changes: [
      change("documents", comparison.documents),
      change("write", comparison.write),
      change("evaluation", comparison.evaluation),
      change("target", comparison.target),
      change("sidecar", comparison.sidecar)
    ]
  };
}

function safeVersionSummary(version) {
  const summary = {
    ...safeObject(version.buildSummary),
    ...safeObject(version.release?.summary)
  };
  const documents = safeObject(summary.documents);
  const write = safeObject(summary.write);
  const evaluation = safeObject(summary.evaluation);
  const target = safeObject(summary.target);
  const sidecar = safeObject(summary.sidecar);
  return {
    buildId: version.buildId,
    status: version.release?.status || version.status,
    active: version.active,
    releaseId: version.release?.releaseId || "",
    createdAt: version.release?.createdAt || version.createdAt,
    updatedAt: version.release?.updatedAt || version.updatedAt,
    documents: {
      included: numberValue(documents.included),
      excluded: numberValue(documents.excluded),
      attention: numberValue(documents.attention),
      total: numberValue(documents.total, numberValue(documents.included) + numberValue(documents.excluded) + numberValue(documents.attention))
    },
    write: {
      records: numberValue(write.records),
      success: numberValue(write.success, numberValue(write.records)),
      failed: numberValue(write.failed)
    },
    evaluation: {
      passed: numberValue(evaluation.passed),
      failed: numberValue(evaluation.failed),
      review: numberValue(evaluation.review)
    },
    target: {
      provider: String(target.provider || ""),
      bucket: String(target.bucket || target.vectorBucket || ""),
      indexName: String(target.indexName || target.index || ""),
      region: String(target.region || "")
    },
    sidecar: {
      status: sidecar.authoritativeStore === "oss-sidecar" || sidecar.manifestUri ? "ready" : "missing",
      store: String(sidecar.authoritativeStore || ""),
      manifestUri: String(sidecar.manifestUri || ""),
      chunks: numberValue(sidecar.chunks || sidecar.records)
    }
  };
}

function compareNumericGroup(base, target, keys) {
  const result = {};
  for (const key of keys) {
    const baseValue = numberValue(base[key]);
    const targetValue = numberValue(target[key]);
    result[key] = {
      base: baseValue,
      target: targetValue,
      delta: targetValue - baseValue
    };
  }
  return result;
}

function compareValueGroup(base, target, keys) {
  const result = {};
  for (const key of keys) {
    const baseValue = base[key] ?? "";
    const targetValue = target[key] ?? "";
    result[key] = {
      base: baseValue,
      target: targetValue,
      changed: baseValue !== targetValue
    };
  }
  return result;
}

function change(key, comparison) {
  return {
    key,
    status: groupChanged(comparison) ? "changed" : "unchanged"
  };
}

function groupChanged(group) {
  return Object.values(group || {}).some((item) => {
    if (item && typeof item === "object" && "delta" in item) return Number(item.delta || 0) !== 0;
    if (item && typeof item === "object" && "changed" in item) return Boolean(item.changed);
    return false;
  });
}

function publicKnowledgeBase(current) {
  return current ? {
    id: current.id,
    name: current.name || current.id,
    template: current.template || "",
    status: current.status || ""
  } : null;
}

function versionCheck(key, status, labelZh, labelEn, messageZh, messageEn) {
  return {
    key,
    status,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn }
  };
}

function versionError(kind, code, message, context = {}) {
  return {
    ok: false,
    kind,
    knowledgeBase: publicKnowledgeBase(context.current),
    error: { code, message }
  };
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function countByStatus(db, tableName) {
  const counts = {};
  for (const row of db.prepare(`SELECT status, count(*) AS count FROM ${tableName} GROUP BY status`).all()) {
    counts[row.status || ""] = Number(row.count || 0);
  }
  return counts;
}

function versionRootFromManifestPath(manifestPath) {
  if (!manifestPath) return "";
  const manifestsRoot = path.dirname(manifestPath);
  return path.basename(manifestsRoot) === "manifests" ? path.dirname(manifestsRoot) : "";
}

function emptySummary() {
  return { total: 0, active: "", latest: "", sidecarReady: 0, sidecarMissing: 0 };
}
