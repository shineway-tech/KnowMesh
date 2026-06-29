import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase } from "./storage.mjs";

export function readVersionManifestFromCatalog(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyVersionManifest();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const releases = db.prepare(`
      SELECT release_id, build_id, status, manifest_path, created_at, updated_at
      FROM release_manifests
      ORDER BY updated_at DESC, release_id DESC
    `).all().map(releaseRow);
    const latestReleaseByBuild = new Map();
    for (const release of releases) {
      if (!latestReleaseByBuild.has(release.buildId)) latestReleaseByBuild.set(release.buildId, release);
    }
    const versions = db.prepare(`
      SELECT build_id, status, active, parent_build_id, created_at, updated_at
      FROM build_versions
    `).all().map((row) => versionRow(row, latestReleaseByBuild.get(row.build_id) || null))
      .sort(compareVersionRows);
    return {
      ok: true,
      kind: "knowmesh.versionManifest",
      apiVersion: "v1",
      generatedAt: nowIso(),
      knowledgeBase: { id: knowledgeBaseId },
      summary: summarizeVersions(versions, releases),
      versions
    };
  } finally {
    db.close();
  }
}

function versionRow(row = {}, release = null) {
  return {
    buildId: String(row.build_id || ""),
    status: String(row.status || ""),
    active: Number(row.active || 0) === 1,
    parentBuildId: String(row.parent_build_id || ""),
    release,
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function releaseRow(row = {}) {
  return {
    releaseId: String(row.release_id || ""),
    buildId: String(row.build_id || ""),
    status: String(row.status || ""),
    manifestPath: normalizeRelativePath(row.manifest_path || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function summarizeVersions(versions, releases) {
  const byStatus = {};
  for (const version of versions) byStatus[version.status || "unknown"] = (byStatus[version.status || "unknown"] || 0) + 1;
  const active = versions.find((version) => version.active) || null;
  return {
    status: active ? "ready" : versions.length ? "partial" : "empty",
    builds: versions.length,
    releases: releases.length,
    activeBuildId: active?.buildId || "",
    rollbackCandidates: versions.filter((version) => !version.active && version.release).length,
    byStatus
  };
}

function compareVersionRows(a, b) {
  if (a.active !== b.active) return a.active ? -1 : 1;
  const statusRank = { draft: 1, failed: 2 };
  const rankA = statusRank[a.status] ?? 0;
  const rankB = statusRank[b.status] ?? 0;
  if (rankA !== rankB) return rankA - rankB;
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.buildId.localeCompare(b.buildId);
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function emptyVersionManifest() {
  return {
    ok: false,
    kind: "knowmesh.versionManifest",
    apiVersion: "v1",
    generatedAt: nowIso(),
    knowledgeBase: { id: "" },
    summary: {
      status: "empty",
      builds: 0,
      releases: 0,
      activeBuildId: "",
      rollbackCandidates: 0,
      byStatus: {}
    },
    versions: []
  };
}
