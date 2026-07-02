import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { startLocalService } from "./server.mjs";
import { catalogDatabasePath, workspaceDatabasePath } from "./storage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const publicSamplesRoot = path.join(projectRoot, "examples", "public-samples");

test("public sample wizard creates queryable local sample knowledge bases and resets only sample-owned data", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-public-sample-wizard-test-"));
  const requests = [];
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), body: String(options.body || "") });
      return jsonResponse({});
    }
  });

  try {
    const samplesResponse = await fetch(`${service.url}/api/public-samples`);
    const samples = await samplesResponse.json();

    assert.equal(samplesResponse.status, 200);
    assert.equal(samples.ok, true);
    assert.deepEqual(samples.samples.map((item) => item.id), ["general-docs", "operations-handbook", "k12-synthetic"]);
    assert.equal(samples.samples.every((item) => item.publicSafe === true), true);
    assert.equal(samples.samples.every((item) => fs.existsSync(item.sourceRoot)), true);

    const createResponse = await fetch(`${service.url}/api/public-samples/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleId: "general-docs" })
    });
    const created = await createResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(created.ok, true);
    assert.equal(created.sample.id, "general-docs");
    assert.equal(created.knowledgeBase.template, "general-docs");
    assert.equal(created.knowledgeBase.status, "ready");
    assert.equal(created.knowledgeBase.mode, "local");
    assert.match(created.links.open, new RegExp(`/kb/${created.knowledgeBase.id}/use/ask$`));
    assert.match(created.links.reset, /\/api\/public-samples\/reset$/);

    const workspaceDb = new Database(workspaceDatabasePath({ userDataRoot }));
    const row = workspaceDb.prepare("SELECT status, mode, latest_job_status FROM knowledge_bases WHERE id = ?").get(created.knowledgeBase.id);
    workspaceDb.close();
    assert.deepEqual(row, { status: "ready", mode: "local", latest_job_status: "completed" });
    assert.equal(readCatalogScalar(userDataRoot, created.knowledgeBase.id, "SELECT value FROM catalog_state WHERE key = 'publicSampleId'"), "general-docs");
    assert.equal(readCatalogScalar(userDataRoot, created.knowledgeBase.id, "SELECT count(*) FROM chunks"), 1);
    assert.equal(readCatalogScalar(userDataRoot, created.knowledgeBase.id, "SELECT count(*) FROM release_manifests WHERE status = 'active'"), 1);

    const queryResponse = await fetch(`${service.url}/kb/${created.knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What review cadence and rollback rule does the public sample require?" })
    });
    const query = await queryResponse.json();

    assert.equal(queryResponse.status, 200);
    assert.equal(query.ok, true);
    assert.equal(query.status, "answered");
    assert.equal(query.runtime.source.kind, "catalogSearch");
    assert.match(query.answer.text, /weekly review cadence|rollback/i);
    assert.equal(query.citations.length > 0, true);
    assert.equal(requests.length, 0, "public samples should not call external model providers");
    assert.doesNotMatch(JSON.stringify(query), /ACCESS_KEY|SECRET|sk-|private textbook|真实教材/i);

    const realKb = await createKnowledgeBase(service.url, {
      id: "ordinary-kb",
      name: "Ordinary KB",
      template: "general-docs"
    });
    const deniedResetResponse = await fetch(`${service.url}/api/public-samples/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ knowledgeBaseId: realKb.id })
    });
    const deniedReset = await deniedResetResponse.json();
    assert.equal(deniedResetResponse.status, 409);
    assert.equal(deniedReset.ok, false);
    assert.equal(deniedReset.error.code, "not_public_sample");

    const resetResponse = await fetch(`${service.url}/api/public-samples/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ knowledgeBaseId: created.knowledgeBase.id })
    });
    const reset = await resetResponse.json();
    assert.equal(resetResponse.status, 200);
    assert.equal(reset.ok, true);
    assert.equal(reset.removed.knowledgeBaseId, created.knowledgeBase.id);
    assert.equal(fs.existsSync(catalogDatabasePath({ userDataRoot }, created.knowledgeBase.id)), false);

    const afterResetResponse = await fetch(`${service.url}/api/knowledge-bases`);
    const afterReset = await afterResetResponse.json();
    assert.equal(afterReset.items.some((item) => item.id === created.knowledgeBase.id), false);
    assert.equal(afterReset.items.some((item) => item.id === realKb.id), true);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("public samples drive Query Runtime feedback package and version APIs without private content", async () => {
  const generalSource = path.join(publicSamplesRoot, "general-docs", "source", "operations-handbook.md");
  const k12Source = path.join(publicSamplesRoot, "k12-synthetic", "source", "math-grade5-unit3.md");

  assert.equal(fs.existsSync(generalSource), true, "general public sample source must exist");
  assert.equal(fs.existsSync(k12Source), true, "synthetic K12 public sample source must exist");

  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-public-samples-test-"));
  const requests = [];
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), body: String(options.body || "") });
      if (String(url).includes("/compatible-mode/v1/chat/completions")) {
        return jsonResponse({
          choices: [{
            message: {
              content: "Public sample operations require source owners, a weekly review cadence, rollback-ready releases, and cited answers.[1]"
            }
          }]
        });
      }
      return jsonResponse({});
    }
  });

  try {
    const generalKb = await createKnowledgeBase(service.url, {
      id: "kb-public-general-sample",
      name: "Public General Sample",
      template: "general-docs"
    });
    await configureLocalSample(service.url, generalKb.id, {
      sourceRoot: path.dirname(generalSource),
      workspaceRoot: path.join(userDataRoot, "sample-workspaces", "general"),
      template: "general-docs"
    });
    await configureModelProvider(service.url, generalKb.id);
    writePublicSampleCatalog(userDataRoot, generalKb.id, {
      documentId: "doc-public-operations",
      versionId: "ver-public-operations",
      buildId: "build-public-general",
      releaseId: "release-public-general",
      sourcePath: generalSource,
      title: "Public Sample Operations Handbook",
      sourceType: "markdown",
      relativePath: "general-docs/source/operations-handbook.md",
      text: fs.readFileSync(generalSource, "utf8")
    });
    writeCompletedSampleJob(userDataRoot, generalKb.id, {
      jobId: "job-public-general",
      template: "general-docs",
      sourceRoot: path.dirname(generalSource),
      workspaceRoot: path.join(userDataRoot, "sample-workspaces", "general")
    });

    const queryResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What review cadence and rollback rule does the public sample require?" })
    });
    const query = await queryResponse.json();

    assert.equal(queryResponse.status, 200);
    assert.equal(query.ok, true);
    assert.equal(query.kind, "knowmesh.queryResult");
    assert.equal(query.runtime.source.kind, "catalogSearch");
    assert.equal(query.status, "answered");
    assert.match(query.answer.text, /weekly review cadence/i);
    assert.ok(query.citations.some((item) => item.documentId === "doc-public-operations" && item.pageNumber === 1));
    assert.doesNotMatch(JSON.stringify(query), /ACCESS_KEY|SECRET|private textbook|真实教材/i);

    const noEvidenceResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What is the cafeteria lunch menu for tomorrow?" })
    });
    const noEvidence = await noEvidenceResponse.json();

    assert.equal(noEvidenceResponse.status, 200);
    assert.equal(noEvidence.ok, false);
    assert.notEqual(noEvidence.status, "answered");
    assert.equal(noEvidence.citations.length, 0);

    const feedbackResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/query/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "positive",
        question: "What review cadence and rollback rule does the public sample require?",
        resultKey: query.resultKey,
        citationRefs: query.citations.slice(0, 1)
      })
    });
    const feedback = await feedbackResponse.json();
    const feedbackSummaryResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/query/feedback/summary`);
    const feedbackSummary = await feedbackSummaryResponse.json();

    assert.equal(feedbackResponse.status, 200);
    assert.equal(feedback.ok, true);
    assert.equal(feedbackSummary.feedback.total, 1);

    const searchResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/search?query=rollback&limit=5`);
    const search = await searchResponse.json();
    assert.equal(searchResponse.status, 200);
    assert.equal(search.ok, true);
    assert.equal(search.total, 1);
    assert.equal(search.items[0].documentId, "doc-public-operations");

    const packageResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/package/export/preview`);
    const packagePreview = await packageResponse.json();
    assert.equal(packageResponse.status, 200);
    assert.equal(packagePreview.ok, true);
    assert.equal(packagePreview.kind, "knowmesh.packageExportPreview");
    assert.doesNotMatch(JSON.stringify(packagePreview), /weekly review cadence|ACCESS_KEY|SECRET/i);

    const versionResponse = await fetch(`${service.url}/kb/${generalKb.id}/api/version/manifest`);
    const version = await versionResponse.json();
    assert.equal(versionResponse.status, 200);
    assert.equal(version.summary.activeBuildId, "build-public-general");
    assert.equal(version.versions[0].release.releaseId, "release-public-general");

    const k12Kb = await createKnowledgeBase(service.url, {
      id: "kb-public-k12-synthetic",
      name: "Public Synthetic K12 Sample",
      template: "textbook-cn-k12"
    });
    await configureLocalSample(service.url, k12Kb.id, {
      sourceRoot: path.dirname(k12Source),
      workspaceRoot: path.join(userDataRoot, "sample-workspaces", "k12"),
      template: "textbook-cn-k12",
      scope: {
        "metadata.stage": ["小学"],
        "metadata.subject": ["数学"],
        "metadata.grade": ["五年级"]
      }
    });
    await configureModelProvider(service.url, k12Kb.id);
    writePublicSampleCatalog(userDataRoot, k12Kb.id, {
      documentId: "doc-public-k12-math",
      versionId: "ver-public-k12-math",
      buildId: "build-public-k12",
      releaseId: "release-public-k12",
      sourcePath: k12Source,
      title: "Synthetic Grade 5 Math Unit 3",
      sourceType: "markdown",
      relativePath: "k12-synthetic/source/math-grade5-unit3.md",
      text: fs.readFileSync(k12Source, "utf8"),
      metadata: {
        education: {
          stage: "小学",
          subject: "数学",
          grade: "五年级",
          unit: "第三单元",
          unit_no: 3,
          unit_title: "小数除法",
          synthetic: true
        }
      }
    });
    writeCompletedSampleJob(userDataRoot, k12Kb.id, {
      jobId: "job-public-k12",
      template: "textbook-cn-k12",
      sourceRoot: path.dirname(k12Source),
      workspaceRoot: path.join(userDataRoot, "sample-workspaces", "k12")
    });

    const k12QueryResponse = await fetch(`${service.url}/kb/${k12Kb.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "五年级数学第三单元小数除法有哪些知识点？" })
    });
    const k12Query = await k12QueryResponse.json();

    assert.equal(k12QueryResponse.status, 200);
    assert.equal(k12Query.ok, true);
    assert.equal(k12Query.status, "answered");
    assert.match(JSON.stringify(k12Query), /小数除法|decimal division/i);
    assert.ok(k12Query.citations.some((item) => item.documentId === "doc-public-k12-math"));
    assert.doesNotMatch(JSON.stringify(k12Query), /真实教材|copyrighted textbook|private source/i);
    assert.equal(requests.some((item) => item.body.includes("ACCESS_KEY")), false);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

async function createKnowledgeBase(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/knowledge-bases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  return body.knowledgeBase;
}

async function configureLocalSample(baseUrl, knowledgeBaseId, input) {
  const draft = {
    "project.source": input.sourceRoot,
    "project.workspace": input.workspaceRoot,
    "project.template": input.template,
    "template.id": input.template,
    "setup.mode": "local",
    ...(input.scope || {})
  };
  fs.mkdirSync(input.workspaceRoot, { recursive: true });
  await fetch(`${baseUrl}/kb/${knowledgeBaseId}/api/setup/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "local", template: input.template, draft })
  });
  await fetch(`${baseUrl}/kb/${knowledgeBaseId}/api/setup/retrieval-strategy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ draft: { "retrieval.profile": "balanced" } })
  });
}

async function configureModelProvider(baseUrl, knowledgeBaseId) {
  const response = await fetch(`${baseUrl}/kb/${knowledgeBaseId}/api/setup/aliyun/model-provider`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "aliyun-bailian",
      protocol: "openai-compatible",
      region: "cn-beijing",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "sk-public-sample-test"
    })
  });
  assert.equal(response.status, 200);
}

function writePublicSampleCatalog(userDataRoot, knowledgeBaseId, input) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const text = String(input.text || "");
    const metadata = {
      title: input.title,
      sourceType: input.sourceType,
      sourceUri: input.relativePath,
      page_start: 1,
      page_end: 1,
      active: true,
      quality: { tier: "primary", writeEnabled: true },
      ...(input.metadata || {})
    };
    const textHash = crypto.createHash("sha256").update(text).digest("hex");
    db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'primary', ?, ?, ?)
      `).run(input.documentId, input.title, input.sourceType, input.sourcePath, input.relativePath, textHash, process.platform, JSON.stringify(metadata), now, now);
      db.prepare(`
        INSERT INTO document_versions (
          version_id, document_id, display_version, content_hash, artifact_path, status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'v1.0.0', ?, ?, 'active', ?, ?, ?)
      `).run(input.versionId, input.documentId, textHash, input.relativePath, JSON.stringify(metadata), now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash,
          extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, 'extracted', 'primary', ?, ?, ?)
      `).run(`${input.versionId}:page:0001`, input.documentId, input.versionId, input.relativePath, textHash, JSON.stringify(metadata), now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash,
          structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, 'body_text', 0, ?, ?, '', 'primary', ?, ?, ?)
      `).run(`${input.versionId}:block:0001`, `${input.versionId}:page:0001`, input.documentId, input.relativePath, textHash, JSON.stringify({ ...metadata, textPreview: text.slice(0, 220) }), now, now);
      db.prepare(`
        INSERT INTO chunks (
          chunk_id, document_id, block_id, text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'primary', ?, ?, ?)
      `).run(`${input.versionId}:chunk:0001`, input.documentId, `${input.versionId}:block:0001`, input.relativePath, textHash, Math.ceil(text.length / 4), JSON.stringify({ ...metadata, text, chunk_id: `${input.versionId}:chunk:0001`, document_id: input.documentId }), now, now);
      db.prepare(`
        INSERT INTO citations (
          citation_id, chunk_id, document_id, page_id, block_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 'page-1', ?, ?, ?)
      `).run(`${input.versionId}:citation:0001`, `${input.versionId}:chunk:0001`, input.documentId, `${input.versionId}:page:0001`, `${input.versionId}:block:0001`, input.title, JSON.stringify({ ...metadata, excerpt: text.slice(0, 320) }), now, now);
      if (input.metadata?.education) {
        const education = input.metadata.education;
        const unitNo = Number(education.unit_no || 0) || 1;
        const unitNodeId = `${input.versionId}:unit:${unitNo}`;
        const objectId = `${input.versionId}:object:knowledge-point`;
        const unitTitle = education.unit_title || input.title;
        const k12Metadata = {
          unitNo,
          education,
          sourceUri: input.relativePath,
          synthetic: education.synthetic === true
        };
        db.prepare(`
          INSERT INTO structure_nodes (
            node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
          ) VALUES (?, NULL, ?, 'unit', ?, ?, 1, 1, ?, ?, ?, ?)
        `).run(unitNodeId, input.documentId, unitTitle, unitNo, `第三单元/${unitTitle}`, JSON.stringify(k12Metadata), now, now);
        db.prepare(`
          INSERT INTO knowledge_objects (
            object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, 'knowledge_point', ?, 1, 'primary', ?, ?, ?)
        `).run(objectId, input.documentId, unitNodeId, unitTitle, JSON.stringify(k12Metadata), now, now);
      }
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES (?, 'active', 1, '', ?, ?, ?)
      `).run(input.buildId, JSON.stringify({ documents: 1, chunks: 1, citations: 1, sample: true }), now, now);
      db.prepare(`
        INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, ?, ?)
      `).run(input.releaseId, input.buildId, `published/${input.releaseId}/manifest.json`, JSON.stringify({ publicSample: true, documents: 1, chunks: 1 }), now, now);
    })();
  } finally {
    db.close();
  }
}

function writeCompletedSampleJob(userDataRoot, knowledgeBaseId, input) {
  const now = new Date().toISOString();
  const tasks = [
    sampleTask("scan", "Read-only scan"),
    sampleTask("clean", "Clean and chunk"),
    sampleTask("embedding", "Create retrieval data"),
    sampleTask("index", "Write catalog index"),
    sampleTask("report", "Generate run summary")
  ];
  const progress = {
    total: tasks.length,
    completed: tasks.length,
    waiting: 0,
    running: 0,
    blocked: 0,
    failed: 0,
    skipped: 0,
    stopped: 0
  };
  const job = {
    id: input.jobId,
    status: "completed",
    mode: "local",
    template: input.template,
    knowledgeBaseId,
    createdAt: now,
    updatedAt: now,
    summary: {
      sourceRoot: input.sourceRoot,
      workspaceRoot: input.workspaceRoot,
      baseWorkspaceRoot: input.workspaceRoot,
      publicSample: true
    },
    progress,
    tasks,
    artifacts: []
  };

  const catalogDb = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    catalogDb.transaction(() => {
      catalogDb.prepare(`
        INSERT INTO jobs (job_id, status, mode, template, summary_json, progress_json, job_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(job.id, job.status, job.mode, job.template, JSON.stringify(job.summary), JSON.stringify(progress), JSON.stringify(job), now, now);
      const insertStep = catalogDb.prepare(`
        INSERT INTO task_steps (job_id, step_key, sort_order, status, label_json, message_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const [index, taskItem] of tasks.entries()) {
        insertStep.run(job.id, taskItem.key, index, taskItem.status, JSON.stringify(taskItem.label), JSON.stringify(taskItem.message), now);
      }
      catalogDb.prepare(`
        INSERT INTO catalog_state (key, value, updated_at)
        VALUES ('latestJobId', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(job.id, now);
    })();
  } finally {
    catalogDb.close();
  }

  const workspaceDb = new Database(workspaceDatabasePath({ userDataRoot }));
  try {
    workspaceDb.prepare(`
      UPDATE knowledge_bases
      SET latest_job_id = ?, latest_job_status = ?, mode = ?, template = ?, source_root = ?, workspace_root = ?, task_summary_json = ?, updated_at = ?
      WHERE id = ?
    `).run(job.id, job.status, job.mode, job.template, input.sourceRoot, input.workspaceRoot, JSON.stringify(progress), now, knowledgeBaseId);
  } finally {
    workspaceDb.close();
  }
}

function readCatalogScalar(userDataRoot, knowledgeBaseId, sql) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const row = db.prepare(sql).get();
    if (!row) return undefined;
    const values = Object.values(row);
    return values[0];
  } finally {
    db.close();
  }
}

function sampleTask(key, enLabel) {
  return {
    key,
    status: "completed",
    label: { zh: enLabel, en: enLabel },
    message: { zh: `${enLabel} completed.`, en: `${enLabel} completed.` },
    updatedAt: new Date().toISOString()
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    text: async () => JSON.stringify(body)
  };
}
