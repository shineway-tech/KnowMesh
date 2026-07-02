import crypto from "node:crypto";

import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { providerCapabilities } from "./provider-capabilities.mjs";
import { publicSampleOwnershipSummary } from "./public-samples.mjs";
import { readChunkManifestFromCatalog, readIndexManifestFromCatalog } from "./retrieval-manifests.mjs";
import { readExtractionManifestFromCatalog } from "./extraction-manifest.mjs";
import { readSourceManifestFromCatalog } from "./source-catalog.mjs";
import { readStructureSidecarFromCatalog } from "./structure-sidecar.mjs";
import { readVersionManifestFromCatalog } from "./version-manifest.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

const formatVersion = "1.0.0";
const privacyExcludes = ["providerTokens", "rawSources", "pageBodies", "chunkBodies", "queryPrompts", "answers", "evaluationCases"];

export function buildExportPackagePreview(state, input = {}) {
  const knowledgeBase = resolveKnowledgeBase(state, input.knowledgeBaseId);
  if (!knowledgeBase) {
    return {
      ok: false,
      kind: "knowmesh.packageExportPreview",
      error: {
        code: "KNOWLEDGE_BASE_REQUIRED",
        message: { zh: "需要先选择知识库。", en: "Select a knowledge base first." }
      }
    };
  }

  const manifest = buildPackageManifest(state, knowledgeBase);
  const sampleOwnership = manifest.sampleOwnership || publicSampleOwnershipSummary(state, knowledgeBase.id);
  return {
    ok: true,
    kind: "knowmesh.packageExportPreview",
    apiVersion: "1.0.0",
    generatedAt: nowIso(),
    packageManifest: manifest,
    exportPlan: {
      executionEnabled: false,
      format: "knowmesh-package-manifest",
      nextStep: {
        zh: "确认后可生成实际归档包；预览不会复制原始资料或写入新状态。",
        en: "After confirmation a real archive can be produced; preview does not copy raw sources or write new state."
      },
      includes: manifest.contents.includes,
      excludes: manifest.privacy.excludes,
      resetSafety: {
        sampleOwnedOnly: sampleOwnership.publicSample === true,
        removesNormalKnowledgeBases: false,
        cleanupScope: sampleOwnership.cleanupScope
      }
    },
    checks: [
      check("knowledgeBase", "pass", "知识库", "Knowledge base", `将导出 ${knowledgeBase.name || knowledgeBase.id}。`, `${knowledgeBase.name || knowledgeBase.id} will be exported.`),
      check("privacy", "pass", "隐私", "Privacy", "包预览只包含摘要、路径和校验值。", "The package preview contains summaries, paths, and checksums only."),
      check("integrity", "pass", "校验", "Integrity", "已生成 manifest hash。", "Manifest hash is generated.")
    ]
  };
}

export function previewImportPackage(state, input = {}) {
  const manifest = input.manifest || input.packageManifest || {};
  const checks = validatePackageManifest(state, manifest);
  const summary = summarizeImportChecks(checks);
  return {
    ok: checks.every((item) => item.status !== "fail"),
    kind: "knowmesh.packageImportPreview",
    apiVersion: "1.0.0",
    generatedAt: nowIso(),
    summary,
    packageManifest: summarizeIncomingManifest(manifest),
    checks,
    importPlan: {
      executionEnabled: false,
      writes: [],
      nextStep: {
        zh: "导入预检只验证格式、冲突和能力边界；确认导入会在后续版本单独执行。",
        en: "Import preview only validates format, conflicts, and capability boundaries; confirmed import is executed separately later."
      }
    },
    privacy: {
      redacted: true,
      excludes: privacyExcludes
    }
  };
}

function buildPackageManifest(state, knowledgeBase) {
  const knowledgeBaseId = knowledgeBase.id;
  const sourceManifest = readSourceManifestFromCatalog(state, { knowledgeBaseId });
  const extractionManifest = readExtractionManifestFromCatalog(state, { knowledgeBaseId });
  const structureSidecar = readStructureSidecarFromCatalog(state, { knowledgeBaseId });
  const chunkManifest = readChunkManifestFromCatalog(state, { knowledgeBaseId });
  const indexManifest = readIndexManifestFromCatalog(state, { knowledgeBaseId });
  const versionManifest = readVersionManifestFromCatalog(state, { knowledgeBaseId });
  const artifacts = readPackageArtifacts(state, knowledgeBaseId);
  const providers = providerCapabilities({ ...state, knowledgeBaseId });
  const sampleOwnership = publicSampleOwnershipSummary(state, knowledgeBaseId);
  const generatedAt = nowIso();
  const baseManifest = {
    kind: "knowmesh.packageManifest",
    formatVersion,
    packageId: packageId(knowledgeBaseId, generatedAt),
    generatedAt,
    knowledgeBase: {
      id: knowledgeBase.id,
      name: knowledgeBase.name || knowledgeBase.id,
      template: knowledgeBase.template || "",
      status: knowledgeBase.status || "",
      createdAt: knowledgeBase.createdAt || "",
      updatedAt: knowledgeBase.updatedAt || ""
    },
    sampleOwnership,
    contents: {
      includes: ["workspaceRegistration", "catalogSummaries", "versionManifest", "artifactChecksums", "providerCapabilityContract"],
      excludes: privacyExcludes
    },
    manifests: {
      source: pickManifestSummary(sourceManifest),
      extraction: pickManifestSummary(extractionManifest),
      structure: pickManifestSummary(structureSidecar),
      chunks: pickManifestSummary(chunkManifest),
      index: pickManifestSummary(indexManifest),
      versions: pickManifestSummary(versionManifest)
    },
    providerCapabilities: {
      apiVersion: providers.apiVersion,
      summary: providers.summary,
      providers: providers.providers.map((provider) => ({
        id: provider.id,
        type: provider.type,
        configured: provider.configured,
        status: provider.status,
        label: provider.label
      })),
      costPrivacyCards: providers.costPrivacyCards.map((item) => ({
        providerId: item.providerId,
        title: item.title,
        cost: item.cost,
        privacy: item.privacy,
        configured: item.configured
      }))
    },
    artifacts,
    privacy: {
      redacted: true,
      excludes: privacyExcludes
    }
  };
  return {
    ...baseManifest,
    integrity: {
      algorithm: "sha256",
      manifestHash: sha256Json(baseManifest)
    }
  };
}

function readPackageArtifacts(state, knowledgeBaseId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const items = db.prepare(`
      SELECT artifact_id, owner_type, owner_id, artifact_type, relative_path,
             content_hash, size_bytes, media_type, metadata_json, created_at, updated_at
      FROM artifact_registry
      ORDER BY artifact_type ASC, relative_path ASC, artifact_id ASC
    `).all().map((row) => ({
      artifactId: String(row.artifact_id || ""),
      ownerType: String(row.owner_type || ""),
      ownerId: String(row.owner_id || ""),
      artifactType: String(row.artifact_type || ""),
      relativePath: normalizeRelativePath(row.relative_path),
      contentHash: String(row.content_hash || ""),
      sizeBytes: Number(row.size_bytes || 0),
      mediaType: String(row.media_type || ""),
      metadata: summarizeArtifactMetadata(parseJson(row.metadata_json, {})),
      createdAt: String(row.created_at || ""),
      updatedAt: String(row.updated_at || "")
    }));
    return {
      summary: summarizeArtifacts(items),
      items
    };
  } finally {
    db.close();
  }
}

function summarizeArtifactMetadata(metadata) {
  return {
    key: metadata.key || "",
    status: metadata.status || "",
    taskKey: metadata.taskKey || ""
  };
}

function validatePackageManifest(state, manifest) {
  const registry = listKnowledgeBases(state);
  const existing = registry.items.find((item) => item.id === manifest?.knowledgeBase?.id);
  const checks = [
    check(
      "formatKind",
      manifest?.kind === "knowmesh.packageManifest" ? "pass" : "fail",
      "格式类型",
      "Format kind",
      manifest?.kind === "knowmesh.packageManifest" ? "包格式类型正确。" : "不是 KnowMesh package manifest。",
      manifest?.kind === "knowmesh.packageManifest" ? "Package kind is valid." : "This is not a KnowMesh package manifest."
    ),
    check(
      "formatVersion",
      manifest?.formatVersion === formatVersion ? "pass" : "fail",
      "格式版本",
      "Format version",
      manifest?.formatVersion === formatVersion ? `格式版本 ${formatVersion} 可导入。` : `仅支持格式版本 ${formatVersion}。`,
      manifest?.formatVersion === formatVersion ? `Format version ${formatVersion} can be imported.` : `Only format version ${formatVersion} is supported.`
    ),
    check(
      "privacy",
      manifest?.privacy?.redacted === true ? "pass" : "fail",
      "隐私声明",
      "Privacy declaration",
      manifest?.privacy?.redacted === true ? "包声明已排除敏感内容。" : "包缺少隐私排除声明。",
      manifest?.privacy?.redacted === true ? "The package declares sensitive content exclusions." : "The package is missing privacy exclusions."
    ),
    check(
      "knowledgeBaseIdentity",
      manifest?.knowledgeBase?.id ? "pass" : "fail",
      "知识库标识",
      "Knowledge-base identity",
      manifest?.knowledgeBase?.id ? `目标知识库 ${manifest.knowledgeBase.id}。` : "包缺少知识库 ID。",
      manifest?.knowledgeBase?.id ? `Target knowledge base ${manifest.knowledgeBase.id}.` : "The package is missing a knowledge-base id."
    ),
    check(
      "knowledgeBaseConflict",
      existing ? "warn" : "pass",
      "命名冲突",
      "Name conflict",
      existing ? "本机已有同 ID 知识库，导入前需要确认覆盖、改名或跳过。" : "没有发现同 ID 知识库。",
      existing ? "A knowledge base with the same id already exists; choose overwrite, rename, or skip before import." : "No knowledge base with the same id was found."
    ),
    check(
      "integrity",
      manifest?.integrity?.algorithm === "sha256" && /^[a-f0-9]{64}$/i.test(String(manifest?.integrity?.manifestHash || "")) ? "pass" : "warn",
      "校验摘要",
      "Integrity digest",
      "已读取 manifest 校验摘要。",
      "Manifest integrity digest was read."
    )
  ];
  if (/apiKey|secret/i.test(JSON.stringify(manifest || {}))) {
    checks.push(check("sensitiveLeak", "fail", "敏感字段", "Sensitive fields", "包中疑似包含敏感字段。", "The package appears to contain sensitive fields."));
  }
  return checks;
}

function summarizeIncomingManifest(manifest) {
  return {
    kind: String(manifest?.kind || ""),
    formatVersion: String(manifest?.formatVersion || ""),
    knowledgeBase: manifest?.knowledgeBase ? {
      id: String(manifest.knowledgeBase.id || ""),
      name: String(manifest.knowledgeBase.name || ""),
      template: String(manifest.knowledgeBase.template || "")
    } : null,
    artifacts: manifest?.artifacts?.summary || { total: 0, sizeBytes: 0, byType: {} },
    privacy: manifest?.privacy || null
  };
}

function summarizeImportChecks(checks) {
  const fail = checks.filter((item) => item.status === "fail").length;
  const warn = checks.filter((item) => item.status === "warn").length;
  return {
    status: fail ? "blocked" : warn ? "attention" : "ready",
    total: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    warn,
    fail
  };
}

function summarizeArtifacts(items) {
  const byType = {};
  let sizeBytes = 0;
  for (const item of items) {
    byType[item.artifactType || "artifact"] = (byType[item.artifactType || "artifact"] || 0) + 1;
    sizeBytes += Number(item.sizeBytes || 0);
  }
  return {
    total: items.length,
    sizeBytes,
    byType
  };
}

function pickManifestSummary(manifest) {
  return {
    ok: Boolean(manifest?.ok),
    kind: String(manifest?.kind || ""),
    apiVersion: String(manifest?.apiVersion || ""),
    generatedAt: String(manifest?.generatedAt || ""),
    knowledgeBase: manifest?.knowledgeBase || null,
    summary: manifest?.summary || {}
  };
}

function resolveKnowledgeBase(state, knowledgeBaseId = "") {
  const registry = listKnowledgeBases(state);
  const targetId = String(knowledgeBaseId || currentKnowledgeBaseId(state) || registry.current?.id || "").trim();
  return registry.items.find((item) => item.id === targetId) || registry.current || null;
}

function packageId(knowledgeBaseId, generatedAt) {
  const suffix = crypto.createHash("sha256").update(`${knowledgeBaseId}\n${generatedAt}`).digest("hex").slice(0, 12);
  return `kmpkg_${knowledgeBaseId}_${suffix}`;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalizeRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}
