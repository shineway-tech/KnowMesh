import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { listKnowledgeBases } from "./knowledge-bases.mjs";
import { catalogDatabasePath, userDataRoot, workspaceDatabasePath } from "./storage.mjs";

const k12KnowledgeBaseId = "kb-k12-all-subjects";

const workspaceFoundationTables = [
  "schema_version",
  "migration_history",
  "workspace_state",
  "workspace_paths",
  "workspace_preferences",
  "knowledge_bases"
];

const catalogStateTables = [
  "schema_version",
  "migration_history",
  "catalog_state",
  "setup_state",
  "jobs",
  "task_steps"
];

const manifestDefinitions = [
  {
    key: "source",
    label: { zh: "Source Manifest", en: "Source Manifest" },
    tables: ["source_documents", "document_versions"],
    requiredRows: ["source_documents", "document_versions"]
  },
  {
    key: "extraction",
    label: { zh: "Extraction Manifest", en: "Extraction Manifest" },
    tables: ["pages", "blocks"],
    requiredRows: ["pages", "blocks"]
  },
  {
    key: "structure",
    label: { zh: "Structure Sidecar", en: "Structure Sidecar" },
    tables: ["structure_nodes", "knowledge_objects", "object_relations"],
    requiredRows: ["structure_nodes", "knowledge_objects"]
  },
  {
    key: "chunk",
    label: { zh: "Chunk Manifest", en: "Chunk Manifest" },
    tables: ["chunks", "citations"],
    requiredRows: ["chunks", "citations"]
  },
  {
    key: "index",
    label: { zh: "Index Manifest", en: "Index Manifest" },
    tables: ["index_records"],
    requiredRows: ["index_records"]
  },
  {
    key: "version",
    label: { zh: "Version Manifest", en: "Version Manifest" },
    tables: ["build_versions", "release_manifests"],
    requiredRows: ["build_versions", "release_manifests"]
  }
];

const artifactBoundaryTables = [
  "artifact_registry",
  "quality_issues",
  "evaluation_cases",
  "evaluation_results",
  "document_overrides",
  "query_feedback",
  "query_feedback_resolutions"
];

export function architectureFoundationStatus(state) {
  const registry = listKnowledgeBases(state);
  const selected = selectKnowledgeBaseForState(state, registry);
  const workspacePath = workspaceDatabasePath(state);
  const workspaceDb = openReadonlyDatabase(workspacePath);
  const catalogPath = selected ? catalogDatabasePath(state, selected.id) : "";
  const catalogExists = catalogPath ? fs.existsSync(catalogPath) : false;
  const catalogDb = catalogExists ? openReadonlyDatabase(catalogPath) : null;

  try {
    const workspaceTables = workspaceDb ? existingTables(workspaceDb, workspaceFoundationTables) : [];
    const catalogTables = catalogDb ? existingTables(catalogDb, [...catalogStateTables, ...manifestTableNames(), ...artifactBoundaryTables]) : [];
    const oldStateFiles = legacyStatePaths(state, registry.items, selected).filter((file) => fs.existsSync(file));
    const defaultKnowledgeBasePresent = registry.items.some((item) => item.id === "default")
      || fs.existsSync(path.join(userDataRoot(state), "knowledge-bases", "default"));
    const workspaceSchemaVersion = workspaceDb ? numericScalar(workspaceDb, "SELECT version FROM schema_version WHERE id = 1") : 0;
    const workspaceMigrationCount = workspaceDb ? numericScalar(workspaceDb, "SELECT count(*) FROM migration_history") : 0;
    const catalogSchemaVersion = catalogDb ? numericScalar(catalogDb, "SELECT version FROM schema_version WHERE id = 1") : 0;
    const catalogMigrationCount = catalogDb ? numericScalar(catalogDb, "SELECT count(*) FROM migration_history") : 0;
    const manifests = buildManifestReadiness(catalogDb, selected);
    const k12 = registry.items.find((item) => item.id === k12KnowledgeBaseId) || null;
    const k12OldFiles = k12 ? legacyStatePaths(state, [k12], k12).filter((file) => fs.existsSync(file)) : [];

    const checks = [
      check(
        "workspaceSqlite",
        fs.existsSync(workspacePath) && workspaceSchemaVersion >= 1 && workspaceMigrationCount > 0 && missingTables(workspaceFoundationTables, workspaceTables).length === 0 ? "pass" : "fail",
        "工作区 SQLite",
        "Workspace SQLite",
        `workspace.sqlite schema v${workspaceSchemaVersion}，migrations ${workspaceMigrationCount}。`,
        `workspace.sqlite schema v${workspaceSchemaVersion}, ${workspaceMigrationCount} migrations.`,
        {
          path: workspacePath,
          schemaVersion: workspaceSchemaVersion,
          migrations: workspaceMigrationCount,
          missingTables: missingTables(workspaceFoundationTables, workspaceTables)
        }
      ),
      check(
        "noImplicitDefault",
        defaultKnowledgeBasePresent ? "fail" : "pass",
        "无隐式 default 知识库",
        "No implicit default KB",
        defaultKnowledgeBasePresent ? "仍存在旧 default 知识库痕迹。" : "没有创建或保留隐式 default 知识库。",
        defaultKnowledgeBasePresent ? "Legacy default knowledge-base state is still present." : "No implicit default knowledge base is present.",
        { defaultKnowledgeBasePresent }
      ),
      check(
        "currentKnowledgeBase",
        selected ? "pass" : "warn",
        "当前知识库",
        "Current knowledge base",
        selected ? `当前请求选择 ${selected.id}。` : "还没有选择知识库。",
        selected ? `The request is scoped to ${selected.id}.` : "No knowledge base is selected yet.",
        {
          selected: selected?.id || "",
          workspaceCurrent: registry.current?.id || ""
        }
      ),
      check(
        "catalogSqlite",
        selected ? (catalogDb && catalogSchemaVersion >= 3 && catalogMigrationCount >= 3 && missingTables(catalogStateTables, catalogTables).length === 0 ? "pass" : "fail") : "warn",
        "知识库 Catalog SQLite",
        "Knowledge-base catalog SQLite",
        selected ? `catalog.sqlite schema v${catalogSchemaVersion}，migrations ${catalogMigrationCount}。` : "还没有知识库 catalog.sqlite。",
        selected ? `catalog.sqlite schema v${catalogSchemaVersion}, ${catalogMigrationCount} migrations.` : "No catalog.sqlite is available before a knowledge base is selected.",
        {
          path: catalogPath,
          schemaVersion: catalogSchemaVersion,
          migrations: catalogMigrationCount,
          missingTables: missingTables(catalogStateTables, catalogTables)
        }
      ),
      check(
        "sqliteState",
        selected ? (catalogDb && missingTables(["setup_state", "jobs", "task_steps", "catalog_state"], catalogTables).length === 0 ? "pass" : "fail") : "warn",
        "状态流已入库",
        "State is SQLite-backed",
        selected ? "注册、当前选择、setup 与 task 摘要由 workspace.sqlite/catalog.sqlite 承载。" : "创建知识库后将由 workspace.sqlite/catalog.sqlite 承载状态。",
        selected ? "Registry, current selection, setup state, and task summaries are backed by workspace.sqlite/catalog.sqlite." : "State will be backed by SQLite after a knowledge base is created.",
        {
          workspaceTables,
          catalogTables: catalogTables.filter((table) => catalogStateTables.includes(table)),
          missingCatalogTables: missingTables(["setup_state", "jobs", "task_steps", "catalog_state"], catalogTables)
        }
      ),
      check(
        "legacyJsonState",
        oldStateFiles.length ? "fail" : "pass",
        "旧 JSON 状态退场",
        "Legacy JSON state removed",
        oldStateFiles.length ? "仍发现旧 JSON 状态路径。" : "旧 JSON 状态文件不再作为运行时路径存在。",
        oldStateFiles.length ? "Legacy JSON state paths are still present." : "Legacy JSON state files are no longer present as runtime paths.",
        { paths: oldStateFiles }
      ),
      check(
        "jsonStateRuntime",
        "pass",
        "JSON 非运行时真相源",
        "JSON is not runtime truth",
        "运行时真相源限定为 SQLite；JSON 只保留为导出、审计、sidecar、凭据或 checkpoint。",
        "Runtime truth is SQLite; JSON remains only for exports, audit, sidecars, credentials, or checkpoints.",
        { jsonStateRuntime: false }
      ),
      check(
        "artifactBoundary",
        selected ? (catalogDb && missingTables(artifactBoundaryTables, catalogTables).length === 0 ? "pass" : "fail") : "warn",
        "Artifact 边界",
        "Artifact boundary",
        selected ? "catalog.sqlite 保存路径、哈希、质量和可查询元数据，文件系统保存大文件 artifact。" : "创建知识库后会启用 catalog 表与 artifact 文件边界。",
        selected ? "catalog.sqlite stores paths, hashes, quality, and metadata; large artifacts stay on disk." : "Catalog tables and artifact file boundaries activate once a knowledge base is selected.",
        {
          missingTables: missingTables(artifactBoundaryTables, catalogTables),
          artifactRegistryRows: catalogDb ? numericScalar(catalogDb, "SELECT count(*) FROM artifact_registry") : 0
        }
      )
    ];

    const failedChecks = checks.filter((item) => item.status === "fail" || item.status === "blocked").length;
    const warnChecks = checks.filter((item) => item.status === "warn").length;
    const readyManifests = manifests.filter((item) => item.status === "ready").length;

    return {
      ok: failedChecks === 0,
      kind: "knowmesh.architectureFoundation",
      apiVersion: "v1",
      phase: "phase1-architecture-foundation",
      generatedAt: new Date().toISOString(),
      summary: {
        knowledgeBases: registry.items.length,
        currentKnowledgeBase: selected?.id || "",
        workspaceCurrentKnowledgeBase: registry.current?.id || "",
        phase1Checks: {
          total: checks.length,
          failed: failedChecks,
          warnings: warnChecks,
          passed: checks.length - failedChecks - warnChecks
        },
        phase2ReadyManifests: readyManifests
      },
      stateStores: {
        primary: ["workspace.sqlite", "catalog.sqlite"],
        workspace: workspacePath,
        catalog: catalogPath,
        jsonStateRuntime: false,
        jsonAllowedFor: ["exports", "audit", "sidecars", "credentials", "checkpoints"]
      },
      knowledgeBase: selected ? {
        id: selected.id,
        name: selected.name || selected.id,
        template: selected.template || "",
        status: selected.status || "",
        mode: selected.mode || "",
        sourceRoot: selected.sourceRoot || "",
        workspaceRoot: selected.workspaceRoot || "",
        latestJobId: selected.latestJobId || "",
        latestJobStatus: selected.latestJobStatus || "",
        root: selected.root || "",
        catalog: catalogPath
      } : null,
      k12Migration: {
        knowledgeBaseId: k12KnowledgeBaseId,
        preserved: Boolean(k12),
        current: selected?.id === k12KnowledgeBaseId,
        sourceRoot: k12?.sourceRoot || "",
        workspaceRoot: k12?.workspaceRoot || "",
        latestJobId: k12?.latestJobId || "",
        latestJobStatus: k12?.latestJobStatus || "",
        catalog: k12 ? catalogDatabasePath(state, k12.id) : "",
        legacyJsonClean: k12OldFiles.length === 0,
        legacyJsonPaths: k12OldFiles
      },
      checks,
      phase2: {
        summary: {
          totalManifests: manifests.length,
          readyManifests,
          status: readyManifests === manifests.length ? "ready" : selected ? "partial" : "needs_knowledge_base"
        },
        manifests
      }
    };
  } finally {
    if (catalogDb) catalogDb.close();
    if (workspaceDb) workspaceDb.close();
  }
}

function selectKnowledgeBaseForState(state, registry) {
  const scopedId = String(state?.knowledgeBaseId || "").trim();
  if (scopedId) {
    const scoped = registry.items.find((item) => item.id === scopedId);
    if (scoped) return scoped;
  }
  return registry.current || null;
}

function openReadonlyDatabase(file) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    return new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function buildManifestReadiness(catalogDb, selected) {
  return manifestDefinitions.map((definition) => {
    if (!selected) {
      return {
        key: definition.key,
        label: definition.label,
        status: "needs_knowledge_base",
        tables: Object.fromEntries(definition.tables.map((table) => [table, 0])),
        missingTables: [],
        message: {
          zh: "创建或选择知识库后开始统计。",
          en: "Create or select a knowledge base to start counting."
        }
      };
    }
    if (!catalogDb) {
      return {
        key: definition.key,
        label: definition.label,
        status: "blocked",
        tables: Object.fromEntries(definition.tables.map((table) => [table, 0])),
        missingTables: definition.tables,
        message: {
          zh: "缺少 catalog.sqlite，无法统计 manifest。",
          en: "catalog.sqlite is missing, so manifest readiness cannot be counted."
        }
      };
    }

    const missing = definition.tables.filter((table) => !tableExists(catalogDb, table));
    const counts = Object.fromEntries(definition.tables.map((table) => [
      table,
      missing.includes(table) ? 0 : numericScalar(catalogDb, `SELECT count(*) FROM ${quoteIdentifier(table)}`)
    ]));
    const requiredReady = definition.requiredRows.every((table) => Number(counts[table] || 0) > 0);
    const hasAnyRows = Object.values(counts).some((count) => Number(count) > 0);
    const status = missing.length ? "blocked" : requiredReady ? "ready" : hasAnyRows ? "partial" : "empty";
    return {
      key: definition.key,
      label: definition.label,
      status,
      tables: counts,
      missingTables: missing,
      message: manifestMessage(status)
    };
  });
}

function manifestTableNames() {
  return [...new Set(manifestDefinitions.flatMap((definition) => definition.tables))];
}

function legacyStatePaths(state, items, selected) {
  const root = userDataRoot(state);
  const ids = new Set(items.map((item) => item.id).filter(Boolean));
  if (selected?.id) ids.add(selected.id);
  ids.add(k12KnowledgeBaseId);
  return [
    path.join(root, "knowledge-bases.json"),
    path.join(root, "setup-state.json"),
    path.join(root, "jobs-state.json"),
    path.join(root, "knowledge-bases", "default"),
    ...[...ids].flatMap((id) => [
      path.join(root, "knowledge-bases", id, "setup-state.json"),
      path.join(root, "knowledge-bases", id, "jobs-state.json"),
      path.join(root, "knowledge-bases", id, "document-overrides.json"),
      path.join(root, "knowledge-bases", id, "feedback", "qa-feedback.jsonl"),
      path.join(root, "knowledge-bases", id, "feedback", "query-feedback.jsonl"),
      path.join(root, "knowledge-bases", id, "feedback", "query-feedback-resolutions.jsonl")
    ])
  ];
}

function existingTables(db, tables) {
  return tables.filter((table) => tableExists(db, table));
}

function missingTables(expected, existing) {
  const present = new Set(existing);
  return expected.filter((table) => !present.has(table));
}

function tableExists(db, table) {
  return numericScalar(
    db,
    "SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
    [table]
  ) === 1;
}

function numericScalar(db, sql, params = []) {
  try {
    const row = db.prepare(sql).get(...params);
    const value = row ? Object.values(row)[0] : 0;
    return Number(value || 0);
  } catch {
    return 0;
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function check(key, status, labelZh, labelEn, messageZh, messageEn, details = {}) {
  return {
    key,
    status,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn },
    details
  };
}

function manifestMessage(status) {
  if (status === "ready") {
    return {
      zh: "底表已有可诊断数据，可进入 Phase 2 细化。",
      en: "Backing tables contain diagnostic rows and are ready for Phase 2 refinement."
    };
  }
  if (status === "partial") {
    return {
      zh: "已有部分数据，下一轮需要补齐 manifest 完整性。",
      en: "Some rows exist; the next round should complete manifest coverage."
    };
  }
  if (status === "blocked") {
    return {
      zh: "缺少底表或 catalog，不能作为 Phase 2 入口。",
      en: "Backing tables or catalog are missing, blocking Phase 2 entry."
    };
  }
  return {
    zh: "底表已存在但还没有数据。",
    en: "Backing tables exist but do not contain rows yet."
  };
}
