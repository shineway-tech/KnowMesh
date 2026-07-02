import fs from "node:fs";
import path from "node:path";

import { ensureDir, writeJsonFile } from "../../core/config.mjs";

export async function runBuildVersionPublishStage(context, job, log, implementation) {
  assertStageImplementation(implementation, "build version publisher");
  return implementation(context, job, log);
}

export function publishBuildVersion(input = {}) {
  const draftManifestPath = String(input.draftManifestPath || "").trim();
  const activeManifestPath = String(input.activeManifestPath || "").trim();
  if (!draftManifestPath || !activeManifestPath) throw new Error("Build version publisher requires draft and active manifest paths.");
  const now = new Date().toISOString();
  const draftManifest = {
    ...(input.manifest || {}),
    status: "draft",
    draftedAt: now,
    updatedAt: now
  };
  writeJsonFile(draftManifestPath, draftManifest);
  validateQualityGates(draftManifest, input.qualityGates || {});

  const activeManifest = {
    ...draftManifest,
    status: "active",
    activatedAt: now,
    updatedAt: now
  };
  writeJsonAtomic(activeManifestPath, activeManifest);
  return {
    ok: true,
    draftManifestPath,
    activeManifestPath,
    status: "active",
    activatedAt: now
  };
}

export function publishBuildVersionToCatalog(db, input = {}) {
  const buildId = String(input.buildId || "").trim();
  const releaseId = String(input.releaseId || `${buildId}:active`).trim();
  const manifestPath = String(input.manifestPath || "").trim();
  if (!db || !buildId || !releaseId || !manifestPath) {
    throw new Error("Catalog publisher requires db, buildId, releaseId, and manifestPath.");
  }
  const now = new Date().toISOString();
  upsertCatalogDraft(db, {
    buildId,
    releaseId,
    manifestPath,
    buildSummary: input.buildSummary || {},
    releaseSummary: input.releaseSummary || {},
    now
  });
  validateQualityGates(input.manifest || {}, input.qualityGates || {});
  const activate = db.transaction(() => {
    db.prepare(`
      UPDATE build_versions
      SET active = 0,
          status = CASE WHEN status = 'active' THEN 'published' ELSE status END,
          updated_at = ?
      WHERE build_id <> ?
    `).run(now, buildId);
    db.prepare(`
      UPDATE release_manifests
      SET status = CASE WHEN status = 'active' THEN 'published' ELSE status END,
          updated_at = ?
      WHERE release_id <> ?
    `).run(now, releaseId);
    db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, 'active', 1, ?, ?, ?, ?)
      ON CONFLICT(build_id) DO UPDATE SET
        status = 'active',
        active = 1,
        summary_json = excluded.summary_json,
        updated_at = excluded.updated_at
    `).run(buildId, String(input.parentBuildId || ""), stableJson(input.buildSummary || {}), now, now);
    db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(release_id) DO UPDATE SET
        build_id = excluded.build_id,
        status = 'active',
        manifest_path = excluded.manifest_path,
        summary_json = excluded.summary_json,
        updated_at = excluded.updated_at
    `).run(releaseId, buildId, manifestPath, stableJson(input.releaseSummary || {}), now, now);
  });
  activate();
  return {
    ok: true,
    buildId,
    releaseId,
    status: "active",
    activatedAt: now
  };
}

function assertStageImplementation(implementation, label) {
  if (typeof implementation !== "function") {
    throw new TypeError(`Missing ${label} execution implementation.`);
  }
}

function validateQualityGates(manifest = {}, gates = {}) {
  const quality = manifest.quality || {};
  const reviewRecords = Number(quality.reviewRecords || 0);
  const activeRecords = Number(quality.activeRecords ?? quality.primaryRecords ?? 0);
  const hasActiveRecordMetric = Object.prototype.hasOwnProperty.call(quality, "activeRecords")
    || Object.prototype.hasOwnProperty.call(quality, "primaryRecords");
  if (gates.allowReviewRecords === false && reviewRecords > 0) {
    throw new Error(`Build version quality gate failed: ${reviewRecords} review record(s) remain.`);
  }
  if (gates.requireActiveRecords !== false && hasActiveRecordMetric && activeRecords <= 0) {
    throw new Error("Build version quality gate failed: no active records are publishable.");
  }
}

function upsertCatalogDraft(db, input = {}) {
  db.prepare(`
    INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
    VALUES (?, 'draft', 0, ?, ?, ?, ?)
    ON CONFLICT(build_id) DO UPDATE SET
      status = CASE WHEN active = 1 THEN status ELSE 'draft' END,
      active = CASE WHEN active = 1 THEN active ELSE 0 END,
      summary_json = excluded.summary_json,
      updated_at = excluded.updated_at
  `).run(input.buildId, "", stableJson(input.buildSummary || {}), input.now, input.now);
  db.prepare(`
    INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
    VALUES (?, ?, 'draft', ?, ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      build_id = excluded.build_id,
      status = CASE WHEN status = 'active' THEN status ELSE 'draft' END,
      manifest_path = excluded.manifest_path,
      summary_json = excluded.summary_json,
      updated_at = excluded.updated_at
  `).run(input.releaseId, input.buildId, input.manifestPath, stableJson(input.releaseSummary || {}), input.now, input.now);
}

function stableJson(value) {
  return JSON.stringify(value ?? {});
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}
