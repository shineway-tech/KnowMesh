import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

export function recordArtifact(state, input = {}) {
  const knowledgeBaseId = String(input.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) throw new Error("Knowledge base is required.");
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const record = normalizeArtifactRecord(input);
    upsertArtifactRecord(db, record);
    return record;
  } finally {
    db.close();
  }
}

export function listArtifactsForOwner(state, options = {}) {
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return [];
  const ownerType = String(options.ownerType || "").trim();
  const ownerId = String(options.ownerId || "").trim();
  if (!ownerType || !ownerId) return [];
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    return db.prepare(`
      SELECT artifact_id, owner_type, owner_id, artifact_type, relative_path,
             content_hash, size_bytes, media_type, metadata_json, created_at, updated_at
      FROM artifact_registry
      WHERE owner_type = ? AND owner_id = ?
      ORDER BY artifact_type ASC, relative_path ASC
    `).all(ownerType, ownerId).map(rowToArtifact);
  } finally {
    db.close();
  }
}

export function syncJobArtifactsToCatalog(db, job = {}) {
  const ownerId = String(job.id || "").trim();
  if (!ownerId) return;
  db.prepare("DELETE FROM artifact_registry WHERE owner_type = 'job' AND owner_id = ?").run(ownerId);
  for (const record of collectJobArtifacts(job)) upsertArtifactRecord(db, record);
}

function collectJobArtifacts(job) {
  const baseRoot = job.summary?.workspaceRoot || job.draft?.["project.workspace"] || "";
  const artifacts = [];
  const push = (artifact, metadata = {}) => {
    if (!artifact?.path) return;
    artifacts.push(normalizeArtifactRecord({
      ownerType: "job",
      ownerId: job.id,
      artifactType: artifact.key || artifact.type || "artifact",
      path: artifact.path,
      baseRoot,
      contentHash: artifact.contentHash || artifact.sha256 || "",
      mediaType: artifact.mediaType || "",
      metadata: {
        ...metadata,
        key: artifact.key || artifact.type || "",
        status: artifact.status || "",
        label: artifact.label || null,
        message: artifact.message || null
      }
    }));
  };

  for (const artifact of job.artifacts || []) push(artifact);
  for (const task of job.tasks || []) {
    for (const artifact of task.artifacts || []) push(artifact, { taskKey: task.key || "" });
  }
  for (const [taskKey, result] of Object.entries(job.testResults || {})) {
    for (const artifact of result?.artifacts || []) push(artifact, { taskKey, test: true });
  }

  const byId = new Map();
  for (const artifact of artifacts) byId.set(artifact.artifactId, artifact);
  return [...byId.values()];
}

function normalizeArtifactRecord(input = {}) {
  const ownerType = String(input.ownerType || "").trim();
  const ownerId = String(input.ownerId || "").trim();
  const artifactType = String(input.artifactType || input.key || "artifact").trim() || "artifact";
  if (!ownerType || !ownerId) throw new Error("Artifact owner is required.");
  const artifactPath = String(input.path || input.absolutePath || "").trim();
  const relativePath = normalizeArtifactPath(artifactPath, input.baseRoot);
  const fileInfo = inspectFile(artifactPath);
  const now = nowIso();
  const record = {
    artifactId: String(input.artifactId || stableArtifactId(ownerType, ownerId, artifactType, relativePath)),
    ownerType,
    ownerId,
    artifactType,
    relativePath,
    contentHash: String(input.contentHash || fileInfo.contentHash || ""),
    sizeBytes: Number(input.sizeBytes ?? fileInfo.sizeBytes ?? 0),
    mediaType: String(input.mediaType || fileInfo.mediaType || mediaTypeForPath(relativePath)),
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    createdAt: String(input.createdAt || now),
    updatedAt: String(input.updatedAt || now)
  };
  return record;
}

function upsertArtifactRecord(db, record) {
  db.prepare(`
    INSERT INTO artifact_registry (
      artifact_id, owner_type, owner_id, artifact_type, relative_path,
      content_hash, size_bytes, media_type, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id) DO UPDATE SET
      owner_type = excluded.owner_type,
      owner_id = excluded.owner_id,
      artifact_type = excluded.artifact_type,
      relative_path = excluded.relative_path,
      content_hash = excluded.content_hash,
      size_bytes = excluded.size_bytes,
      media_type = excluded.media_type,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    record.artifactId,
    record.ownerType,
    record.ownerId,
    record.artifactType,
    record.relativePath,
    record.contentHash,
    record.sizeBytes,
    record.mediaType,
    stableJson(record.metadata),
    record.createdAt,
    record.updatedAt
  );
}

function rowToArtifact(row = {}) {
  return {
    artifactId: String(row.artifact_id || ""),
    ownerType: String(row.owner_type || ""),
    ownerId: String(row.owner_id || ""),
    artifactType: String(row.artifact_type || ""),
    relativePath: String(row.relative_path || ""),
    contentHash: String(row.content_hash || ""),
    sizeBytes: Number(row.size_bytes || 0),
    mediaType: String(row.media_type || ""),
    metadata: parseJson(row.metadata_json, {}),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || "")
  };
}

function normalizeArtifactPath(value, baseRoot = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const resolvedBase = baseRoot ? path.resolve(String(baseRoot)) : "";
  if (resolvedBase) {
    const relative = path.relative(resolvedBase, path.resolve(raw));
    if (relative && relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return slashPath(relative);
    }
  }
  return slashPath(raw);
}

function inspectFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return {};
    return {
      sizeBytes: stat.size,
      contentHash: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
      mediaType: mediaTypeForPath(filePath)
    };
  } catch {
    return {};
  }
}

function stableArtifactId(ownerType, ownerId, artifactType, relativePath) {
  return crypto
    .createHash("sha256")
    .update([ownerType, ownerId, artifactType, relativePath].join("\n"))
    .digest("hex");
}

function mediaTypeForPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  if (ext === ".json") return "application/json";
  if (ext === ".jsonl") return "application/x-ndjson";
  if (ext === ".txt" || ext === ".md" || ext === ".csv" || ext === ".tsv") return "text/plain";
  if (ext === ".pdf") return "application/pdf";
  return "";
}

function slashPath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}
