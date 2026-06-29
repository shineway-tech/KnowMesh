import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  catalogDatabasePath,
  knowledgeBaseDataRoot as storageKnowledgeBaseDataRoot,
  nowIso,
  openCatalogDatabase,
  openWorkspaceDatabase,
  parseJson,
  safeId,
  stableJson,
  userDataRoot
} from "./storage.mjs";

const registryFile = "knowledge-bases.json";
const setupFile = "setup-state.json";
const jobsStateFile = "jobs-state.json";
const legacyJsonMigrationCompletedKey = "legacyJsonStateMigrationCompletedAt";
const legacyDefaultKnowledgeBaseId = "default";
const migratedK12KnowledgeBaseId = "kb-k12-all-subjects";
const currentKnowledgeBaseName = "K12全科知识库";
const legacyDefaultNames = new Set(["", "default", "默认知识库", "知识库", currentKnowledgeBaseName]);

export function currentKnowledgeBaseId(state) {
  migrateLegacyKnowledgeBaseFiles(state);
  if (state.knowledgeBaseId) {
    const scopedId = normalizeKnowledgeBaseId(state.knowledgeBaseId);
    state.knowledgeBaseId = scopedId;
    if (!knowledgeBaseExists(state, scopedId)) {
      if (scopedId === legacyDefaultKnowledgeBaseId) throw new Error(`Knowledge base not found: ${state.knowledgeBaseId}`);
      registerExplicitKnowledgeBaseSelection(state, scopedId);
    }
    return scopedId;
  }

  const db = openWorkspaceDatabase(state);
  try {
    const id = readWorkspaceState(db, "currentKnowledgeBaseId");
    if (!id || !knowledgeBaseExistsInDb(db, id)) return "";
    state.knowledgeBaseId = id;
    return id;
  } finally {
    db.close();
  }
}

export function knowledgeBaseDataRoot(state, id = currentKnowledgeBaseId(state)) {
  return storageKnowledgeBaseDataRoot(state, id);
}

export function knowledgeBaseIdForJob(state, job, fallback = "") {
  migrateLegacyKnowledgeBaseFiles(state);
  const registry = listKnowledgeBases(state);
  const matched = job?.id ? registry.items.find((item) => item.latestJobId === job.id) : null;
  if (matched?.id) return matched.id;
  const existing = normalizeKnowledgeBaseId(job?.knowledgeBase?.id || job?.knowledgeBaseId || "");
  if (existing && registry.items.some((item) => item.id === existing)) return existing;
  const fallbackId = normalizeKnowledgeBaseId(fallback || "");
  if (fallbackId && registry.items.some((item) => item.id === fallbackId)) return fallbackId;
  return registry.current?.id || "";
}

export function listKnowledgeBases(state) {
  migrateLegacyKnowledgeBaseFiles(state);
  const db = openWorkspaceDatabase(state);
  try {
    const items = db.prepare(`
      SELECT id, name, template, status, mode, source_root, workspace_root,
             latest_job_id, latest_job_status, setup_summary_json, task_summary_json,
             created_at, updated_at
      FROM knowledge_bases
      ORDER BY created_at ASC, id ASC
    `).all().map(rowToKnowledgeBase);
    const currentId = readWorkspaceState(db, "currentKnowledgeBaseId");
    const current = items.find((item) => item.id === currentId) || null;
    return {
      ok: true,
      current,
      items: items.map((item) => ({
        ...item,
        current: Boolean(current && item.id === current.id),
        root: knowledgeBaseDataRoot(state, item.id),
        catalog: catalogDatabasePath(state, item.id)
      }))
    };
  } finally {
    db.close();
  }
}

export function createKnowledgeBase(state, input = {}) {
  migrateLegacyKnowledgeBaseFiles(state);
  const name = String(input.name || "未命名知识库").trim();
  const db = openWorkspaceDatabase(state);
  try {
    const existing = new Set(db.prepare("SELECT id FROM knowledge_bases").all().map((row) => row.id));
    const id = uniqueId(existing, slugify(String(input.id || name || "knowledge-base")));
    const now = nowIso();
    const record = {
      id,
      name,
      template: String(input.template || "general-docs"),
      status: "draft",
      mode: "",
      sourceRoot: "",
      workspaceRoot: "",
      latestJobId: "",
      latestJobStatus: "",
      setupSummary: {},
      taskSummary: {},
      createdAt: now,
      updatedAt: now
    };
    const create = db.transaction(() => {
      insertKnowledgeBase(db, record);
      writeWorkspaceState(db, "currentKnowledgeBaseId", id, now);
    });
    create();
    state.knowledgeBaseId = id;
    ensureCatalogDatabase(state, id);
    ensureKnowledgeBaseProjectFolders(state, id);
    return record;
  } finally {
    db.close();
  }
}

export function switchKnowledgeBase(state, id) {
  migrateLegacyKnowledgeBaseFiles(state);
  const targetId = normalizeKnowledgeBaseId(id);
  const db = openWorkspaceDatabase(state);
  try {
    const row = db.prepare("SELECT * FROM knowledge_bases WHERE id = ?").get(targetId);
    if (!row) throw new Error(`Knowledge base not found: ${id}`);
    const now = nowIso();
    const change = db.transaction(() => {
      writeWorkspaceState(db, "currentKnowledgeBaseId", targetId, now);
      db.prepare("UPDATE knowledge_bases SET updated_at = ? WHERE id = ?").run(now, targetId);
    });
    change();
    state.knowledgeBaseId = targetId;
    delete state.jobs;
    delete state.latestJobId;
    return rowToKnowledgeBase({ ...row, updated_at: now });
  } finally {
    db.close();
  }
}

export function touchKnowledgeBase(state, patch = {}) {
  return touchKnowledgeBaseById(state, currentKnowledgeBaseId(state), patch);
}

export function touchKnowledgeBaseById(state, id, patch = {}) {
  migrateLegacyKnowledgeBaseFiles(state);
  const targetId = normalizeKnowledgeBaseId(id);
  if (!targetId) return null;
  const db = openWorkspaceDatabase(state);
  try {
    const current = db.prepare("SELECT * FROM knowledge_bases WHERE id = ?").get(targetId);
    if (!current) return null;
    const next = {
      name: patch.name ?? current.name,
      template: patch.template ?? current.template,
      status: patch.status ?? current.status,
      mode: patch.mode ?? current.mode ?? "",
      sourceRoot: patch.sourceRoot ?? current.source_root ?? "",
      workspaceRoot: patch.workspaceRoot ?? current.workspace_root ?? "",
      latestJobId: patch.latestJobId ?? current.latest_job_id ?? "",
      latestJobStatus: patch.latestJobStatus ?? current.latest_job_status ?? "",
      setupSummary: patch.setupSummary ?? parseJson(current.setup_summary_json, {}),
      taskSummary: patch.taskSummary ?? parseJson(current.task_summary_json, {}),
      updatedAt: nowIso()
    };
    db.prepare(`
      UPDATE knowledge_bases
      SET name = ?, template = ?, status = ?, mode = ?, source_root = ?, workspace_root = ?,
          latest_job_id = ?, latest_job_status = ?, setup_summary_json = ?, task_summary_json = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      String(next.name || ""),
      String(next.template || "general-docs"),
      String(next.status || "draft"),
      String(next.mode || ""),
      String(next.sourceRoot || ""),
      String(next.workspaceRoot || ""),
      String(next.latestJobId || ""),
      String(next.latestJobStatus || ""),
      stableJson(next.setupSummary),
      stableJson(next.taskSummary),
      next.updatedAt,
      targetId
    );
    return rowToKnowledgeBase(db.prepare("SELECT * FROM knowledge_bases WHERE id = ?").get(targetId));
  } finally {
    db.close();
  }
}

function migrateLegacyKnowledgeBaseFiles(state) {
  const root = userDataRoot(state);
  const db = openWorkspaceDatabase(state);
  try {
    if (readWorkspaceState(db, legacyJsonMigrationCompletedKey)) {
      cleanupLegacyStateFiles(root);
      return;
    }
    const changed = migrateK12LegacyState(state, db, root);
    writeWorkspaceState(db, legacyJsonMigrationCompletedKey, nowIso());
    cleanupLegacyStateFiles(root);
    if (changed) pruneInvalidCurrentSelection(db);
  } finally {
    db.close();
  }
}

function migrateK12LegacyState(state, db, root) {
  const now = nowIso();
  const registry = readLegacyK12Registry(root);
  const stateFiles = legacyK12StateFiles(root);
  const hasStateFiles = [...stateFiles.setupFiles, ...stateFiles.jobFiles].some((file) => fs.existsSync(file));
  if (!registry && !hasStateFiles) {
    return false;
  }

  const setup = migrateCatalogJsonState(state, migratedK12KnowledgeBaseId, stateFiles.setupFiles, stateFiles.jobFiles);
  const record = {
    id: migratedK12KnowledgeBaseId,
    name: displayNameForKnowledgeBase(migratedK12KnowledgeBaseId, registry?.name || ""),
    template: String(registry?.template || "textbook-cn-k12"),
    status: String(registry?.status || "draft"),
    mode: String(registry?.mode || ""),
    sourceRoot: String(registry?.sourceRoot || ""),
    workspaceRoot: String(registry?.workspaceRoot || ""),
    latestJobId: "",
    latestJobStatus: "",
    setupSummary: {},
    taskSummary: {},
    createdAt: registry?.createdAt || now,
    updatedAt: registry?.updatedAt || now
  };
  applyDerivedPatch(record, setup);
  upsertKnowledgeBase(db, record);
  writeWorkspaceState(db, "currentKnowledgeBaseId", migratedK12KnowledgeBaseId, now);
  return true;
}

function readLegacyK12Registry(root) {
  const data = readJson(path.join(root, registryFile), null);
  const items = Array.isArray(data?.items) ? data.items : [];
  const currentId = normalizeLegacyKnowledgeBaseId(data?.currentId || "");
  const candidates = items.filter((item) => normalizeLegacyKnowledgeBaseId(item?.id || "") === migratedK12KnowledgeBaseId);
  if (!candidates.length) return null;
  return candidates.find((item) => normalizeLegacyKnowledgeBaseId(item?.id || "") === currentId) || candidates[0];
}

function migrateCatalogJsonState(state, id, setupFiles = [], jobFiles = []) {
  let snapshot = { hasSetup: false, setup: null, hasJobs: false, jobs: null };
  let legacySetup = null;
  let setup = null;
  let shouldWriteSetup = false;
  let jobs = null;
  let jobRecords = [];
  const db = openCatalogDatabase(state, id);
  try {
    snapshot = readCatalogMigrationSnapshot(db);
    legacySetup = setupFiles.map((file) => readJson(file, null)).find((data) => data && typeof data === "object") || null;
    setup = snapshot.hasSetup ? mergeCatalogSetupState(snapshot.setup, legacySetup) : legacySetup;
    shouldWriteSetup = snapshot.hasSetup
      ? Boolean(legacySetup) && stableJson(setup?.draft || {}) !== stableJson(snapshot.setup?.draft || {})
      : Boolean(setup);
    jobs = snapshot.hasJobs
      ? snapshot.jobs
      : jobFiles.map((file) => readJson(file, null)).find((data) => data && typeof data === "object") || null;
    jobRecords = !snapshot.hasJobs && Array.isArray(jobs?.jobs) ? jobs.jobs.filter((job) => job?.id) : [];
    const write = db.transaction(() => {
      if (shouldWriteSetup && setup) {
        db.prepare(`
          INSERT INTO setup_state (id, draft_json, updated_at)
          VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at
        `).run(stableJson(setup.draft || {}), setup.updatedAt || nowIso());
      }
      if (!snapshot.hasJobs && jobRecords.length) {
        const latestJobId = jobs.latestJobId || jobRecords.at(-1)?.id || "";
        db.prepare(`
          INSERT INTO catalog_state (key, value, updated_at)
          VALUES ('latestJobId', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(latestJobId, jobs.updatedAt || nowIso());
      }
      for (const job of jobRecords) {
        upsertJobRecord(db, job);
      }
    });
    if (shouldWriteSetup || (!snapshot.hasJobs && jobs)) write();
  } finally {
    db.close();
  }
  for (const file of [...setupFiles, ...jobFiles]) removeFile(file);
  return { setup, jobs };
}

function mergeCatalogSetupState(current, legacy) {
  if (!legacy) return current;
  const currentDraft = current?.draft && typeof current.draft === "object" ? current.draft : {};
  const legacyDraft = legacy?.draft && typeof legacy.draft === "object" ? legacy.draft : {};
  return {
    draft: { ...legacyDraft, ...currentDraft },
    updatedAt: current?.updatedAt || legacy.updatedAt || null
  };
}

function readCatalogMigrationSnapshot(db) {
  const setupRow = db.prepare("SELECT draft_json, updated_at FROM setup_state WHERE id = 1").get();
  const latestJobRow = db.prepare("SELECT value, updated_at FROM catalog_state WHERE key = 'latestJobId'").get();
  const jobRows = db.prepare("SELECT job_json, updated_at FROM jobs ORDER BY created_at ASC, job_id ASC").all();
  const jobs = jobRows.map((row) => parseJson(row.job_json, null)).filter((job) => job?.id);
  const hasJobs = Boolean(latestJobRow) || jobs.length > 0;
  return {
    hasSetup: Boolean(setupRow),
    setup: setupRow ? {
      draft: parseJson(setupRow.draft_json, {}),
      updatedAt: setupRow.updated_at || null
    } : null,
    hasJobs,
    jobs: hasJobs ? {
      latestJobId: latestJobRow?.value || "",
      updatedAt: latestJobRow?.updated_at || jobRows.at(-1)?.updated_at || null,
      jobs
    } : null
  };
}

function applyDerivedPatch(record, stateData = {}) {
  const draft = stateData.setup?.draft || {};
  const latestJob = latestJobFromState(stateData.jobs);

  if (record.id === migratedK12KnowledgeBaseId && legacyDefaultNames.has(String(record.name || ""))) {
    record.name = currentKnowledgeBaseName;
  }

  const draftName = String(draft["project.name"] || draft["project.title"] || "").trim();
  if (draftName && record.id !== migratedK12KnowledgeBaseId) record.name = draftName;

  const template = String(draft["project.template"] || draft.template || latestJob?.template || "").trim();
  if (template) record.template = template;

  const sourceRoot = String(draft["project.source"] || latestJob?.summary?.sourceRoot || latestJob?.draft?.["project.source"] || "").trim();
  if (sourceRoot) record.sourceRoot = sourceRoot;

  const workspaceRoot = String(
    draft["project.workspace.base"]
    || draft["project.workspace"]
    || latestJob?.summary?.baseWorkspaceRoot
    || latestJob?.draft?.["project.workspace.base"]
    || latestJob?.summary?.workspaceRoot
    || latestJob?.draft?.["project.workspace"]
    || ""
  ).trim();
  if (workspaceRoot) record.workspaceRoot = workspaceRoot;

  if (latestJob?.id) {
    record.latestJobId = latestJob.id;
    record.latestJobStatus = latestJob.status || "";
    record.mode = latestJob.mode || "";
    record.status = latestJob.status === "completed" ? "ready" : "active";
    record.taskSummary = latestJob.progress || summarizeTasks(latestJob.tasks || []);
  } else if (Object.keys(draft).length) {
    record.status = "configured";
  }

  record.setupSummary = summarizeSetupDraft(draft);
}

function upsertKnowledgeBase(db, record) {
  const existing = db.prepare("SELECT * FROM knowledge_bases WHERE id = ?").get(record.id);
  const next = existing ? {
    id: record.id,
    name: record.name || existing.name,
    template: record.template || existing.template,
    status: record.status || existing.status,
    mode: record.mode || existing.mode || "",
    sourceRoot: record.sourceRoot || existing.source_root || "",
    workspaceRoot: record.workspaceRoot || existing.workspace_root || "",
    latestJobId: record.latestJobId || existing.latest_job_id || "",
    latestJobStatus: record.latestJobStatus || existing.latest_job_status || "",
    setupSummary: record.setupSummary || parseJson(existing.setup_summary_json, {}),
    taskSummary: record.taskSummary || parseJson(existing.task_summary_json, {}),
    createdAt: existing.created_at || record.createdAt,
    updatedAt: record.updatedAt || nowIso()
  } : record;

  insertKnowledgeBase(db, next);
}

function insertKnowledgeBase(db, record) {
  db.prepare(`
    INSERT INTO knowledge_bases (
      id, name, template, status, mode, source_root, workspace_root,
      latest_job_id, latest_job_status, setup_summary_json, task_summary_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      template = excluded.template,
      status = excluded.status,
      mode = excluded.mode,
      source_root = excluded.source_root,
      workspace_root = excluded.workspace_root,
      latest_job_id = excluded.latest_job_id,
      latest_job_status = excluded.latest_job_status,
      setup_summary_json = excluded.setup_summary_json,
      task_summary_json = excluded.task_summary_json,
      updated_at = excluded.updated_at
  `).run(
    record.id,
    String(record.name || "知识库"),
    String(record.template || "general-docs"),
    String(record.status || "draft"),
    String(record.mode || ""),
    String(record.sourceRoot || ""),
    String(record.workspaceRoot || ""),
    String(record.latestJobId || ""),
    String(record.latestJobStatus || ""),
    stableJson(record.setupSummary || {}),
    stableJson(record.taskSummary || {}),
    record.createdAt || nowIso(),
    record.updatedAt || nowIso()
  );
}

function upsertJobRecord(db, job) {
  const createdAt = job.createdAt || nowIso();
  const updatedAt = job.updatedAt || createdAt;
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
  `).run(
    job.id,
    String(job.status || ""),
    String(job.mode || ""),
    String(job.template || ""),
    stableJson(job.summary || {}),
    stableJson(job.progress || summarizeTasks(job.tasks || [])),
    stableJson(job),
    createdAt,
    updatedAt
  );
}

function ensureCatalogDatabase(state, id) {
  const db = openCatalogDatabase(state, id);
  db.close();
}

function rowToKnowledgeBase(row = {}) {
  return {
    id: row.id,
    name: row.name,
    template: row.template,
    status: row.status,
    mode: row.mode || "",
    sourceRoot: row.source_root || "",
    workspaceRoot: row.workspace_root || "",
    latestJobId: row.latest_job_id || "",
    latestJobStatus: row.latest_job_status || "",
    setupSummary: parseJson(row.setup_summary_json, {}),
    taskSummary: parseJson(row.task_summary_json, {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

function readWorkspaceState(db, key) {
  return db.prepare("SELECT value FROM workspace_state WHERE key = ?").get(key)?.value || "";
}

function writeWorkspaceState(db, key, value, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO workspace_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value || ""), updatedAt);
}

function pruneInvalidCurrentSelection(db) {
  const currentId = readWorkspaceState(db, "currentKnowledgeBaseId");
  if (!currentId || knowledgeBaseExistsInDb(db, currentId)) return;
  const fallback = db.prepare("SELECT id FROM knowledge_bases ORDER BY created_at ASC, id ASC LIMIT 1").get()?.id || "";
  writeWorkspaceState(db, "currentKnowledgeBaseId", fallback);
}

function knowledgeBaseExists(state, id) {
  const db = openWorkspaceDatabase(state);
  try {
    return knowledgeBaseExistsInDb(db, id);
  } finally {
    db.close();
  }
}

function knowledgeBaseExistsInDb(db, id) {
  if (!id) return false;
  return Boolean(db.prepare("SELECT 1 FROM knowledge_bases WHERE id = ?").get(id));
}

function registerExplicitKnowledgeBaseSelection(state, id) {
  const db = openWorkspaceDatabase(state);
  try {
    const now = nowIso();
    upsertKnowledgeBase(db, {
      id,
      name: displayNameForKnowledgeBase(id, id),
      template: id === migratedK12KnowledgeBaseId ? "textbook-cn-k12" : "general-docs",
      status: "draft",
      mode: "",
      sourceRoot: "",
      workspaceRoot: "",
      latestJobId: "",
      latestJobStatus: "",
      setupSummary: {},
      taskSummary: {},
      createdAt: now,
      updatedAt: now
    });
    writeWorkspaceState(db, "currentKnowledgeBaseId", id, now);
    ensureCatalogDatabase(state, id);
  } finally {
    db.close();
  }
}

function legacyK12StateFiles(root) {
  const currentRoot = path.join(root, "knowledge-bases", migratedK12KnowledgeBaseId);
  const legacyRoot = path.join(root, "knowledge-bases", legacyDefaultKnowledgeBaseId);
  return {
    setupFiles: [
      path.join(root, setupFile),
      path.join(currentRoot, setupFile),
      path.join(legacyRoot, setupFile)
    ],
    jobFiles: [
      path.join(root, jobsStateFile),
      path.join(currentRoot, jobsStateFile),
      path.join(legacyRoot, jobsStateFile)
    ]
  };
}

function cleanupLegacyStateFiles(root) {
  removeFile(path.join(root, registryFile));
  removeFile(path.join(root, setupFile));
  removeFile(path.join(root, jobsStateFile));
  removeDirectory(path.join(root, "knowledge-bases", legacyDefaultKnowledgeBaseId));
  const basesRoot = path.join(root, "knowledge-bases");
  if (!fs.existsSync(basesRoot)) return;
  for (const entry of fs.readdirSync(basesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    removeFile(path.join(basesRoot, entry.name, setupFile));
    removeFile(path.join(basesRoot, entry.name, jobsStateFile));
    removeFile(path.join(basesRoot, entry.name, "document-overrides.json"));
    const feedbackRoot = path.join(basesRoot, entry.name, "feedback");
    removeFile(path.join(feedbackRoot, "qa-feedback.jsonl"));
    removeFile(path.join(feedbackRoot, "query-feedback.jsonl"));
    removeFile(path.join(feedbackRoot, "query-feedback-resolutions.jsonl"));
    removeEmptyDirectory(feedbackRoot);
  }
}

function displayNameForKnowledgeBase(id, name) {
  const value = String(name || "").trim();
  if (id === migratedK12KnowledgeBaseId && legacyDefaultNames.has(value)) return currentKnowledgeBaseName;
  return value || (id === migratedK12KnowledgeBaseId ? currentKnowledgeBaseName : "知识库");
}

function latestJobFromState(data) {
  const jobs = Array.isArray(data?.jobs) ? data.jobs.filter((job) => job?.id) : [];
  if (!jobs.length) return null;
  if (data?.latestJobId) {
    const exact = jobs.find((job) => job.id === data.latestJobId);
    if (exact) return exact;
  }
  return jobs[jobs.length - 1];
}

function summarizeSetupDraft(draft = {}) {
  return {
    configured: Object.keys(draft || {}).length > 0,
    mode: String(draft["setup.mode"] || ""),
    template: String(draft["project.template"] || draft.template || ""),
    sourceRoot: String(draft["project.source"] || ""),
    workspaceRoot: String(draft["project.workspace.base"] || draft["project.workspace"] || "")
  };
}

function summarizeTasks(tasks = []) {
  const actionableTasks = tasks.filter((item) => item.status !== "skipped");
  return {
    total: actionableTasks.length,
    completed: actionableTasks.filter((item) => item.status === "completed").length,
    waiting: actionableTasks.filter((item) => item.status === "waiting").length,
    running: actionableTasks.filter((item) => item.status === "running").length,
    blocked: actionableTasks.filter((item) => item.status === "blocked").length,
    failed: actionableTasks.filter((item) => item.status === "failed").length,
    skipped: tasks.filter((item) => item.status === "skipped").length,
    stopped: actionableTasks.filter((item) => item.status === "stopped").length
  };
}

function uniqueId(existing, baseId) {
  const base = safeId(baseId) || `kb-${randomUUID().slice(0, 8)}`;
  if (!existing.has(base)) return base;
  const suffix = randomUUID().slice(0, 8);
  let id = `${base}-${suffix}`;
  let index = 2;
  while (existing.has(id)) {
    id = `${base}-${suffix}-${index}`;
    index += 1;
  }
  return id;
}

function slugify(value) {
  const ascii = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `kb-${randomUUID().slice(0, 8)}`;
}

function normalizeKnowledgeBaseId(id) {
  return safeId(id);
}

function normalizeLegacyKnowledgeBaseId(id) {
  const value = normalizeKnowledgeBaseId(id);
  return value === legacyDefaultKnowledgeBaseId ? migratedK12KnowledgeBaseId : value;
}

function ensureKnowledgeBaseProjectFolders(state, id) {
  const root = path.join(state.projectRoot || process.cwd(), "knowledge-bases", safeId(id));
  fs.mkdirSync(path.join(root, "source"), { recursive: true });
  fs.mkdirSync(path.join(root, "workspace"), { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function removeFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    // Legacy cleanup is best-effort after SQLite migration has been written.
  }
}

function removeDirectory(directory) {
  try {
    if (directory && fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // Legacy cleanup is best-effort after SQLite migration has been written.
  }
}

function removeEmptyDirectory(directory) {
  try {
    if (directory && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // Empty legacy folder cleanup is best-effort.
  }
}
