import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { confirmLocalJob, latestJob } from "./jobs.mjs";
import { createKnowledgeBase, listKnowledgeBases, switchKnowledgeBase } from "./knowledge-bases.mjs";
import { readSetupState, saveRetrievalStrategy, saveSetupDraft } from "./setup-store.mjs";
import { catalogDatabasePath, openCatalogDatabase, workspaceDatabasePath } from "./storage.mjs";

const migratedK12KnowledgeBaseId = "kb-k12-all-subjects";

test("fresh installs start without an implicit default knowledge base", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-default-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };

  const before = listKnowledgeBases(state);
  assert.equal(before.current, null);
  assert.deepEqual(before.items, []);

  const created = createKnowledgeBase(state, { name: "新教材库", template: "textbook-cn-k12" });
  const after = listKnowledgeBases(state);

  assert.equal(after.current.id, created.id);
  assert.deepEqual(after.items.map((item) => item.id), [created.id]);
});

test("catalog databases include the Knowledge Asset Layer foundation schema", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-catalog-schema-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const created = createKnowledgeBase(state, { name: "资产层教材库", template: "textbook-cn-k12" });
  const expectedTables = [
    "source_documents",
    "document_versions",
    "pages",
    "blocks",
    "structure_nodes",
    "knowledge_objects",
    "object_relations",
    "chunks",
    "citations",
    "index_records",
    "quality_issues",
    "build_versions",
    "release_manifests",
    "evaluation_cases",
    "evaluation_results",
    "artifact_registry",
    "document_overrides",
    "query_feedback_resolutions",
    "source_documents_fts",
    "structure_nodes_fts",
    "knowledge_objects_fts",
    "query_feedback_fts",
    "chunks_fts"
  ];
  const expectedIndexes = [
    "idx_source_documents_status",
    "idx_pages_document",
    "idx_blocks_page",
    "idx_structure_nodes_parent",
    "idx_knowledge_objects_type",
    "idx_object_relations_source",
    "idx_chunks_quality",
    "idx_citations_chunk",
    "idx_index_records_status",
    "idx_quality_issues_queue",
    "idx_document_overrides_status",
    "idx_artifact_registry_owner",
    "idx_query_feedback_action_created",
    "idx_chunks_document_quality_updated",
    "idx_chunks_structure_quality",
    "idx_citations_document_page_search",
    "idx_index_records_provider_index_status"
  ];

  assert.equal(readCatalogScalar(state, created.id, "select version from schema_version where id = 1"), 5);
  assert.equal(
    readCatalogScalar(state, created.id, "select count(*) from migration_history where id = ?", ["002_catalog_asset_tables"]),
    1
  );
  assert.equal(
    readCatalogScalar(state, created.id, "select count(*) from migration_history where id = ?", ["003_catalog_search_indexes"]),
    1
  );
  assert.equal(
    readCatalogScalar(state, created.id, "select count(*) from migration_history where id = ?", ["004_catalog_object_relations"]),
    1
  );
  assert.equal(
    readCatalogScalar(state, created.id, "select count(*) from migration_history where id = ?", ["005_catalog_chunk_search"]),
    1
  );
  for (const table of expectedTables) {
    assert.equal(readCatalogScalar(state, created.id, "select count(*) from sqlite_master where type = 'table' and name = ?", [table]), 1, table);
  }
  for (const index of expectedIndexes) {
    assert.equal(readCatalogScalar(state, created.id, "select count(*) from sqlite_master where type = 'index' and name = ?", [index]), 1, index);
  }
});

test("catalog FTS indexes follow document, structure, object, and feedback rows", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-catalog-fts-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const created = createKnowledgeBase(state, { name: "全文检索底座", template: "general-docs" });
  const now = new Date().toISOString();
  const db = new Database(catalogDatabasePath(state, created.id));
  try {
    db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "doc-1",
      "Grade five fractions guide",
      "pdf",
      "E:/sources/fractions.pdf",
      "math/fractions.pdf",
      "sha-doc-1",
      "windows",
      "active",
      "primary",
      JSON.stringify({ subject: "math" }),
      now,
      now
    );
    db.prepare(`
      INSERT INTO structure_nodes (node_id, document_id, node_type, title, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("node-1", "doc-1", "unit", "Fraction applications", "Unit 3/Fraction applications", now, now);
    db.prepare(`
      INSERT INTO knowledge_objects (object_id, document_id, structure_node_id, object_type, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("object-1", "doc-1", "node-1", "exercise", "Equivalent fraction exercise", now, now);
    db.prepare(`
      INSERT INTO query_feedback (id, action, needs_review, resolved, question, answer_status, result_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("feedback-1", "wrong_citation", 1, 0, "Why did the fraction answer cite page 9?", "answered", "result-1", now);

    assert.equal(db.prepare("SELECT document_id FROM source_documents_fts WHERE source_documents_fts MATCH ?").get("Grade").document_id, "doc-1");
    assert.equal(db.prepare("SELECT node_id FROM structure_nodes_fts WHERE structure_nodes_fts MATCH ?").get("applications").node_id, "node-1");
    assert.equal(db.prepare("SELECT object_id FROM knowledge_objects_fts WHERE knowledge_objects_fts MATCH ?").get("Equivalent").object_id, "object-1");
    assert.equal(db.prepare("SELECT id FROM query_feedback_fts WHERE query_feedback_fts MATCH ?").get("cite").id, "feedback-1");

    db.prepare("UPDATE source_documents SET title = ?, updated_at = ? WHERE document_id = ?").run("Decimal guide", now, "doc-1");
    assert.equal(db.prepare("SELECT document_id FROM source_documents_fts WHERE source_documents_fts MATCH ?").get("Grade"), undefined);
    assert.equal(db.prepare("SELECT document_id FROM source_documents_fts WHERE source_documents_fts MATCH ?").get("Decimal").document_id, "doc-1");
  } finally {
    db.close();
  }
});

test("legacy setup and jobs are adopted into the current named knowledge base", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-legacy-"));
  const userDataRoot = path.join(temp, "user-data");
  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const sourceRoot = path.join(temp, "ChinaTextbook");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, "setup-state.json"), `${JSON.stringify({
    draft: {
      "project.template": "textbook-cn-k12",
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    },
    updatedAt: "2026-06-19T01:00:00.000Z"
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), `${JSON.stringify({
    kind: "knowmesh.jobsState",
    apiVersion: "v1",
    updatedAt: "2026-06-19T02:00:00.000Z",
    latestJobId: "job-seven",
    jobs: [{
      id: "job-seven",
      status: "waiting",
      mode: "aliyun",
      template: "textbook-cn-k12",
      summary: { sourceRoot, workspaceRoot },
      tasks: [
        { key: "scan", status: "completed" },
        { key: "merge", status: "completed" },
        { key: "pages", status: "completed" },
        { key: "clean", status: "completed" },
        { key: "retrieval-policy", status: "completed" },
        { key: "report", status: "completed" },
        { key: "upload", status: "waiting" }
      ]
    }]
  }, null, 2)}\n`, "utf8");

  const library = listKnowledgeBases(state);
  const adopted = library.items[0];

  assert.equal(library.current.id, migratedK12KnowledgeBaseId);
  assert.equal(adopted.name, "K12全科知识库");
  assert.equal(adopted.template, "textbook-cn-k12");
  assert.equal(adopted.status, "active");
  assert.equal(adopted.latestJobId, "job-seven");
  assert.equal(adopted.latestJobStatus, "waiting");
  assert.equal(adopted.mode, "aliyun");
  assert.equal(adopted.sourceRoot, sourceRoot);
  assert.equal(adopted.workspaceRoot, workspaceRoot);
  assert.equal(fs.existsSync(workspaceDatabasePath(state)), true);
  assert.equal(fs.existsSync(catalogDatabasePath(state, migratedK12KnowledgeBaseId)), true);
  assert.equal(readCatalogJson(state, migratedK12KnowledgeBaseId, "select draft_json from setup_state where id = 1")["project.source"], sourceRoot);
  assert.equal(readCatalogScalar(state, migratedK12KnowledgeBaseId, "select job_id from jobs where job_id = ? limit 1", ["job-seven"]), "job-seven");
  assert.ok(readWorkspaceScalar(state, "select count(*) from migration_history") > 0);
  assert.ok(readCatalogScalar(state, migratedK12KnowledgeBaseId, "select count(*) from migration_history") > 0);
  assert.equal(fs.existsSync(path.join(userDataRoot, "setup-state.json")), false);
  assert.equal(fs.existsSync(path.join(userDataRoot, "jobs-state.json")), false);
  assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", migratedK12KnowledgeBaseId, "setup-state.json")), false);
  assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", migratedK12KnowledgeBaseId, "jobs-state.json")), false);
  assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", "default")), false);
});


test("legacy registry migrates only the K12 default knowledge base", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-duplicate-owner-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "ChinaTextbook");
  const workspaceRoot = path.join(temp, "workspace");
  const now = new Date().toISOString();
  const job = {
    id: "owned-by-default-job",
    status: "failed",
    mode: "aliyun",
    template: "textbook-cn-k12",
    knowledgeBase: { id: "kb-other" },
    summary: { sourceRoot, workspaceRoot },
    tasks: [{ key: "ocr", status: "failed" }]
  };
  fs.mkdirSync(path.join(userDataRoot, "knowledge-bases", "kb-other"), { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, "knowledge-bases.json"), JSON.stringify({
    kind: "knowmesh.knowledgeBaseRegistry",
    apiVersion: "v1",
    currentId: "default",
    updatedAt: now,
    items: [
      {
        id: "default",
        name: "K12全科知识库",
        template: "textbook-cn-k12",
        status: "active",
        latestJobId: job.id,
        latestJobStatus: "paused",
        sourceRoot,
        workspaceRoot,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "kb-other",
        name: "测试",
        template: "textbook-cn-k12",
        status: "configured",
        latestJobId: "",
        latestJobStatus: "",
        sourceRoot,
        workspaceRoot,
        createdAt: now,
        updatedAt: now
      }
    ]
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(userDataRoot, "knowledge-bases", "kb-other", "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const library = listKnowledgeBases({ projectRoot: temp, userDataRoot, enableSystemConverters: false });

  assert.equal(library.current.id, migratedK12KnowledgeBaseId);
  assert.equal(library.items.some((item) => item.id === "default"), false);
  assert.equal(library.items.some((item) => item.id === "kb-other"), false);
  assert.equal(library.items.length, 1);
  assert.equal(library.current.latestJobId, "");
  assert.equal(library.current.sourceRoot, sourceRoot);
  assert.equal(library.current.workspaceRoot, workspaceRoot);
  assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases.json")), false);
  assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", "kb-other", "jobs-state.json")), false);
  assert.throws(() => switchKnowledgeBase({ projectRoot: temp, userDataRoot, enableSystemConverters: false }, "default"), /Knowledge base not found/);
});

test("non-K12 per-knowledge-base legacy JSON state is cleaned without adoption", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-nonk12-legacy-"));
  const userDataRoot = path.join(temp, "user-data");
  const legacyRoot = path.join(userDataRoot, "knowledge-bases", "kb-general-legacy");
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "setup-state.json"), JSON.stringify({
    draft: {
      "project.template": "general-docs",
      "project.source": path.join(temp, "legacy-source")
    },
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(legacyRoot, "jobs-state.json"), JSON.stringify({
    latestJobId: "legacy-general-job",
    jobs: [{
      id: "legacy-general-job",
      status: "completed",
      mode: "local",
      template: "general-docs",
      tasks: [{ key: "scan", status: "completed" }]
    }]
  }, null, 2) + "\n", "utf8");

  const library = listKnowledgeBases({ projectRoot: temp, userDataRoot, enableSystemConverters: false });

  assert.equal(library.current, null);
  assert.deepEqual(library.items, []);
  assert.equal(fs.existsSync(path.join(legacyRoot, "setup-state.json")), false);
  assert.equal(fs.existsSync(path.join(legacyRoot, "jobs-state.json")), false);
  assert.equal(fs.existsSync(catalogDatabasePath({ projectRoot: temp, userDataRoot }, "kb-general-legacy")), false);
});

test("existing catalog setup and jobs win over stale per-knowledge-base JSON state", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-stale-json-"));
  const userDataRoot = path.join(temp, "user-data");
  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const sourceRoot = path.join(temp, "catalog-source");
  const workspaceRoot = path.join(temp, "catalog-workspace");
  const staleSourceRoot = path.join(temp, "stale-json-source");
  const staleWorkspaceRoot = path.join(temp, "stale-json-workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(staleSourceRoot, { recursive: true });
  fs.mkdirSync(staleWorkspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "current.txt"), "当前 catalog 状态", "utf8");

  const created = createKnowledgeBase(state, { name: "Catalog 当前状态", template: "general-docs" });
  saveSetupDraft(state, {
    "project.template": "general-docs",
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const currentJob = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.template": "general-docs",
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });
  assert.equal(currentJob.ok, true, JSON.stringify(currentJob.checks));

  const legacyRoot = path.join(userDataRoot, "knowledge-bases", created.id);
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "setup-state.json"), JSON.stringify({
    draft: {
      "project.template": "textbook-cn-k12",
      "project.source": staleSourceRoot,
      "project.workspace": staleWorkspaceRoot
    },
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(legacyRoot, "jobs-state.json"), JSON.stringify({
    kind: "knowmesh.jobsState",
    apiVersion: "v1",
    updatedAt: "2026-06-01T00:00:00.000Z",
    latestJobId: "job-stale-json",
    jobs: [{
      id: "job-stale-json",
      status: "blocked",
      mode: "aliyun",
      template: "textbook-cn-k12",
      summary: { sourceRoot: staleSourceRoot, workspaceRoot: staleWorkspaceRoot },
      tasks: [{ key: "scan", status: "blocked" }]
    }]
  }, null, 2) + "\n", "utf8");

  const migrated = listKnowledgeBases({ projectRoot: temp, userDataRoot, enableSystemConverters: false });
  const current = migrated.items.find((item) => item.id === created.id);
  assert.equal(current.latestJobId, currentJob.job.id);
  assert.equal(current.sourceRoot, sourceRoot);
  assert.equal(current.workspaceRoot, workspaceRoot);
  assert.equal(fs.existsSync(path.join(legacyRoot, "setup-state.json")), false);
  assert.equal(fs.existsSync(path.join(legacyRoot, "jobs-state.json")), false);

  const restarted = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  assert.equal(readSetupState(restarted).draft["project.source"], sourceRoot);
  assert.equal(latestJob(restarted).job.id, currentJob.job.id);
  assert.equal(readCatalogScalar(restarted, created.id, "select count(*) from jobs where job_id = ?", ["job-stale-json"]), 0);
});

test("one-time K12 legacy setup migration fills missing catalog draft keys without overwriting current keys", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-setup-merge-"));
  const userDataRoot = path.join(temp, "user-data");
  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const knowledgeBaseId = migratedK12KnowledgeBaseId;
  const sourceRoot = path.join(temp, "catalog-source");
  const staleSourceRoot = path.join(temp, "stale-json-source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(staleSourceRoot, { recursive: true });
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    db.prepare(`
      INSERT INTO setup_state (id, draft_json, updated_at)
      VALUES (1, ?, ?)
    `).run(JSON.stringify({
      "project.template": "general-docs",
      "project.source": sourceRoot,
      "aliyun.model.provider": "aliyun-bailian"
    }), "2026-06-01T00:00:01.000Z");
  } finally {
    db.close();
  }

  const legacyRoot = path.join(userDataRoot, "knowledge-bases", "default");
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "setup-state.json"), JSON.stringify({
    draft: {
      "project.template": "textbook-cn-k12",
      "project.source": staleSourceRoot,
      "retrieval.profile": "balanced",
      "retrieval.strategy.configured": true,
      "retrieval.strategy.updatedAt": "2026-06-01T00:00:00.000Z"
    },
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n", "utf8");

  listKnowledgeBases({ projectRoot: temp, userDataRoot, enableSystemConverters: false });
  const setup = readSetupState({ projectRoot: temp, userDataRoot, enableSystemConverters: false, knowledgeBaseId });

  assert.equal(setup.draft["project.template"], "general-docs");
  assert.equal(setup.draft["project.source"], sourceRoot);
  assert.equal(setup.draft["aliyun.model.provider"], "aliyun-bailian");
  assert.equal(setup.draft["retrieval.profile"], "balanced");
  assert.equal(setup.retrievalStrategy.configured, true);
  assert.equal(fs.existsSync(path.join(legacyRoot, "setup-state.json")), false);
});

test("stale setup json written after sqlite initialization is cleaned without mutating catalog draft", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-stale-setup-after-sqlite-"));
  const userDataRoot = path.join(temp, "user-data");
  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const sourceRoot = path.join(temp, "catalog-source");
  const staleSourceRoot = path.join(temp, "stale-json-source");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(staleSourceRoot, { recursive: true });

  const created = createKnowledgeBase(state, { name: "SQLite Setup Truth", template: "general-docs" });
  saveSetupDraft(state, {
    "project.template": "general-docs",
    "project.source": sourceRoot
  });

  const legacyRoot = path.join(userDataRoot, "knowledge-bases", created.id);
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "setup-state.json"), JSON.stringify({
    draft: {
      "project.template": "textbook-cn-k12",
      "project.source": staleSourceRoot,
      "retrieval.profile": "balanced",
      "retrieval.strategy.configured": true
    },
    updatedAt: "2026-06-01T00:00:00.000Z"
  }, null, 2) + "\n", "utf8");

  listKnowledgeBases({ projectRoot: temp, userDataRoot, enableSystemConverters: false });
  const setup = readSetupState({ projectRoot: temp, userDataRoot, enableSystemConverters: false });

  assert.equal(setup.draft["project.template"], "general-docs");
  assert.equal(setup.draft["project.source"], sourceRoot);
  assert.equal(setup.draft["retrieval.profile"], undefined);
  assert.equal(setup.retrievalStrategy.configured, false);
  assert.equal(fs.existsSync(path.join(legacyRoot, "setup-state.json")), false);
});

test("stale jobs json written after sqlite initialization is cleaned without becoming latest job", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-stale-jobs-after-sqlite-"));
  const userDataRoot = path.join(temp, "user-data");
  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const created = createKnowledgeBase(state, { name: "SQLite Job Truth", template: "general-docs" });
  const legacyRoot = path.join(userDataRoot, "knowledge-bases", created.id);
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, "jobs-state.json"), JSON.stringify({
    latestJobId: "job-stale-after-sqlite",
    jobs: [{
      id: "job-stale-after-sqlite",
      status: "completed",
      mode: "aliyun",
      template: "textbook-cn-k12",
      tasks: [{ key: "index", status: "completed" }]
    }]
  }, null, 2) + "\n", "utf8");

  const library = listKnowledgeBases({ projectRoot: temp, userDataRoot, enableSystemConverters: false });
  const current = library.items.find((item) => item.id === created.id);
  const restarted = { projectRoot: temp, userDataRoot, enableSystemConverters: false, knowledgeBaseId: created.id };

  assert.equal(current.latestJobId, "");
  assert.equal(latestJob(restarted).job, null);
  assert.equal(readCatalogScalar(restarted, created.id, "select count(*) from jobs where job_id = ?", ["job-stale-after-sqlite"]), 0);
  assert.equal(fs.existsSync(path.join(legacyRoot, "jobs-state.json")), false);
});

test("knowledge bases keep setup and jobs isolated", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-isolation-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const sourceA = path.join(temp, "source-a");
  const sourceB = path.join(temp, "source-b");
  const workspaceA = path.join(temp, "workspace-a");
  const workspaceB = path.join(temp, "workspace-b");
  fs.mkdirSync(sourceA, { recursive: true });
  fs.mkdirSync(sourceB, { recursive: true });
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });
  fs.writeFileSync(path.join(sourceA, "a.txt"), "A 知识库资料", "utf8");
  fs.writeFileSync(path.join(sourceB, "b.txt"), "B 知识库资料", "utf8");

  const first = createKnowledgeBase(state, { name: "小学教材库", template: "textbook-cn-k12" });
  saveSetupDraft(state, { "project.source": sourceA, "project.workspace": workspaceA });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const jobA = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: { "project.source": sourceA, "project.workspace": workspaceA }
  });
  assert.equal(jobA.ok, true, JSON.stringify(jobA.checks));

  const second = createKnowledgeBase(state, { name: "客服知识库", template: "general-docs" });
  saveSetupDraft(state, { "project.source": sourceB, "project.workspace": workspaceB });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const jobB = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: { "project.source": sourceB, "project.workspace": workspaceB }
  });
  assert.equal(jobB.ok, true, JSON.stringify(jobB.checks));

  assert.equal(latestJob(state).job.id, jobB.job.id);
  switchKnowledgeBase(state, first.id);
  assert.equal(readSetupState(state).draft["project.source"], sourceA);
  assert.equal(latestJob(state).job.id, jobA.job.id);

  switchKnowledgeBase(state, second.id);
  assert.equal(readSetupState(state).draft["project.source"], sourceB);
  assert.equal(latestJob(state).job.id, jobB.job.id);

  const library = listKnowledgeBases(state);
  assert.equal(library.current.id, second.id);
  assert.deepEqual(library.items.map((item) => item.name), ["小学教材库", "客服知识库"]);
  assert.equal(library.items.find((item) => item.id === first.id)?.latestJobId, jobA.job.id);
  assert.equal(library.items.find((item) => item.id === second.id)?.latestJobId, jobB.job.id);
  assert.equal(library.items.find((item) => item.id === second.id)?.latestJobStatus, "waiting");

  assert.equal(fs.existsSync(workspaceDatabasePath(state)), true);
  assert.equal(fs.existsSync(catalogDatabasePath(state, first.id)), true);
  assert.equal(fs.existsSync(catalogDatabasePath(state, second.id)), true);
  assert.equal(fs.existsSync(path.join(state.userDataRoot, "knowledge-bases.json")), false);
  assert.equal(fs.existsSync(path.join(state.userDataRoot, "knowledge-bases", first.id, "setup-state.json")), false);
  assert.equal(fs.existsSync(path.join(state.userDataRoot, "knowledge-bases", first.id, "jobs-state.json")), false);
  assert.equal(fs.existsSync(path.join(state.userDataRoot, "knowledge-bases", second.id, "setup-state.json")), false);
  assert.equal(fs.existsSync(path.join(state.userDataRoot, "knowledge-bases", second.id, "jobs-state.json")), false);

  const restarted = { projectRoot: temp, userDataRoot: state.userDataRoot, enableSystemConverters: false };
  assert.equal(listKnowledgeBases(restarted).current.id, second.id);
  assert.equal(readSetupState(restarted).draft["project.source"], sourceB);
  assert.equal(latestJob(restarted).job.id, jobB.job.id);
});

test("scoped knowledge-base state owns jobs even when workspace current differs", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-scoped-job-"));
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false };
  const sourceRoot = path.join(temp, "operator-source");
  const workspaceRoot = path.join(temp, "operator-workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "operator.txt"), "Operator scoped build source.", "utf8");

  const operator = createKnowledgeBase(state, { name: "Operator KB", template: "general-docs" });
  const k12 = createKnowledgeBase(state, { name: "K12 Gate KB", template: "textbook-cn-k12" });
  assert.equal(listKnowledgeBases(state).current.id, k12.id);

  const scoped = { ...state, knowledgeBaseId: operator.id };
  assert.equal(listKnowledgeBases(scoped).current.id, operator.id);
  saveSetupDraft(scoped, {
    "project.template": "general-docs",
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot
  });
  saveRetrievalStrategy(scoped, { "retrieval.profile": "balanced" });
  const job = await confirmLocalJob(scoped, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.template": "general-docs",
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });

  assert.equal(job.ok, true, JSON.stringify(job.checks));
  assert.equal(job.job.knowledgeBaseId, operator.id);
  assert.equal(latestJob(scoped).job.id, job.job.id);
  assert.equal(readCatalogScalar(scoped, operator.id, "select count(*) from jobs where job_id = ?", [job.job.id]), 1);
  assert.equal(readCatalogScalar(scoped, k12.id, "select count(*) from jobs where job_id = ?", [job.job.id]), 0);
  assert.equal(listKnowledgeBases(state).current.id, k12.id);
});

function readWorkspaceScalar(state, sql, params = []) {
  const db = new Database(workspaceDatabasePath(state), { readonly: true });
  try {
    return Object.values(db.prepare(sql).get(...params) || {})[0];
  } finally {
    db.close();
  }
}

function readCatalogScalar(state, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return Object.values(db.prepare(sql).get(...params) || {})[0];
  } finally {
    db.close();
  }
}

function readCatalogJson(state, knowledgeBaseId, sql, params = []) {
  const value = readCatalogScalar(state, knowledgeBaseId, sql, params);
  return value ? JSON.parse(value) : {};
}

