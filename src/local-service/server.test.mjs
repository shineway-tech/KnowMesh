import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { checkAliyunPermissions, checkAliyunStorage } from "./aliyun.mjs";
import { extractK12EducationMetadata, extractK12QueryConstraints } from "../core/k12-metadata.mjs";
import { checkEnvironment } from "./environment.mjs";
import { latestJob } from "./jobs.mjs";
import { buildOpenPathCommand } from "./local-paths.mjs";
import { startLocalService } from "./server.mjs";
import { catalogDatabasePath } from "./storage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createK12TestKnowledgeBase(service) {
  const response = await fetch(`${service.url}/api/knowledge-bases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "kb-k12-all-subjects", name: "K12全科知识库", template: "textbook-cn-k12" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.knowledgeBase.id, "kb-k12-all-subjects");
  return body.knowledgeBase;
}

function readCatalogScalar(userDataRoot, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId), { readonly: true });
  try {
    return Object.values(db.prepare(sql).get(...params) || {})[0];
  } finally {
    db.close();
  }
}

function readCatalogRows(userDataRoot, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId), { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

test("local service exposes platform runtime diagnostics without a selected knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-platform-api-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const runtimeResponse = await fetch(`${service.url}/api/platform/runtime`);
    const runtime = await runtimeResponse.json();
    const providersResponse = await fetch(`${service.url}/api/providers/capabilities`);
    const providers = await providersResponse.json();
    const maintenanceResponse = await fetch(`${service.url}/api/maintenance/status`);
    const maintenance = await maintenanceResponse.json();
    const exportResponse = await fetch(`${service.url}/api/maintenance/export`);
    const diagnostics = await exportResponse.json();

    assert.equal(runtimeResponse.status, 200);
    assert.equal(runtime.kind, "knowmesh.platformRuntimeInventory");
    assert.equal(runtime.apiVersion, "1.0.0");
    assert.ok(["ready", "attention"].includes(runtime.summary.status));
    assert.equal(runtime.workspace.packageName, "knowmesh");
    assert.ok(runtime.checks.some((item) => item.key === "nodeRuntime"));
    assert.ok(runtime.checks.some((item) => item.key === "launchers"));
    assert.equal(providersResponse.status, 200);
    assert.equal(providers.kind, "knowmesh.providerCapabilities");
    assert.ok(providers.providers.some((item) => item.id === "local-catalog" && item.configured));
    assert.ok(providers.costPrivacyCards.some((item) => item.providerId === "aliyun-model-studio"));
    assert.doesNotMatch(JSON.stringify(providers), /apiKey|secret/i);
    assert.equal(maintenanceResponse.status, 200);
    assert.equal(maintenance.maintenance.platformRuntime.kind, "knowmesh.platformRuntimeInventory");
    assert.equal(maintenance.maintenance.providerCapabilities.kind, "knowmesh.providerCapabilities");
    assert.ok(maintenance.checks.some((item) => item.key === "platformRuntime"));
    assert.ok(maintenance.checks.some((item) => item.key === "providerCapabilities"));
    assert.equal(exportResponse.status, 200);
    assert.equal(diagnostics.platformRuntime.kind, "knowmesh.platformRuntimeInventory");
    assert.equal(diagnostics.providerCapabilities.kind, "knowmesh.providerCapabilities");
    assert.equal(diagnostics.platformRuntime.workspace.packageName, "knowmesh");
    assert.doesNotMatch(JSON.stringify(diagnostics.platformRuntime), /apiKey|secret|credential/i);
    assert.doesNotMatch(JSON.stringify(diagnostics.providerCapabilities), /apiKey|secret/i);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes redacted package export and import previews", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-package-api-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createdResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "kb-package-api", name: "Package API KB", template: "general-docs" })
    });
    const created = await createdResponse.json();
    const db = new Database(catalogDatabasePath({ userDataRoot }, created.knowledgeBase.id));
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO artifact_registry (
          artifact_id, owner_type, owner_id, artifact_type, relative_path,
          content_hash, size_bytes, media_type, metadata_json, created_at, updated_at
        ) VALUES ('artifact-api-package', 'job', 'job-api-package', 'report', 'reports/build-report.json',
          'sha256-api-package', 88, 'application/json', '{}', ?, ?)
      `).run(now, now);
    } finally {
      db.close();
    }

    const exportResponse = await fetch(`${service.url}/kb/${created.knowledgeBase.id}/api/package/export/preview`);
    const exportPreview = await exportResponse.json();
    const importResponse = await fetch(`${service.url}/api/package/import/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: exportPreview.packageManifest })
    });
    const importPreview = await importResponse.json();

    assert.equal(createdResponse.status, 200);
    assert.equal(exportResponse.status, 200);
    assert.equal(exportPreview.kind, "knowmesh.packageExportPreview");
    assert.equal(exportPreview.packageManifest.knowledgeBase.id, "kb-package-api");
    assert.equal(exportPreview.packageManifest.artifacts.summary.total, 1);
    assert.equal(exportPreview.packageManifest.artifacts.items[0].contentHash, "sha256-api-package");
    assert.equal(importResponse.status, 200);
    assert.equal(importPreview.kind, "knowmesh.packageImportPreview");
    assert.ok(importPreview.checks.some((item) => item.key === "knowledgeBaseConflict" && item.status === "warn"));
    assert.equal(importPreview.importPlan.executionEnabled, false);
    assert.doesNotMatch(JSON.stringify(exportPreview), /apiKey|secret|rawText/i);
    assert.doesNotMatch(JSON.stringify(importPreview), /apiKey|secret|rawText/i);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("maintenance diagnostic export redacts latest job summary text fields", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-diagnostics-job-redaction-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-sensitive-summary",
      jobs: [{
        id: "job-sensitive-summary",
        status: "completed",
        mode: "local",
        template: "textbook-cn-k12",
        summary: {
          sourceRoot: path.join(userDataRoot, "source"),
          workspaceRoot: path.join(userDataRoot, "workspace"),
          includedFiles: 1,
          logicalDocuments: 1,
          question: "private diagnostic question",
          sourceContent: "private diagnostic source content",
          answerText: "private diagnostic answer text",
          expectedAnswers: ["private diagnostic expected answer"]
        },
        progress: { total: 1, completed: 1, waiting: 0, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
        tasks: [{ key: "index", status: "completed", label: { zh: "写入知识库", en: "Index" }, message: { zh: "完成", en: "Done" } }]
      }]
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/export`);
    const diagnostics = await response.json();
    const serialized = JSON.stringify(diagnostics);

    assert.equal(response.status, 200);
    assert.equal(diagnostics.latestJob.id, "job-sensitive-summary");
    assert.equal(diagnostics.latestJob.summary.includedFiles, 1);
    assert.equal(diagnostics.latestJob.summary.logicalDocuments, 1);
    assert.equal(diagnostics.latestJob.summary.question, undefined);
    assert.equal(diagnostics.latestJob.summary.sourceContent, undefined);
    assert.equal(diagnostics.latestJob.summary.answerText, undefined);
    assert.doesNotMatch(serialized, /private diagnostic question|private diagnostic source content|private diagnostic answer text|private diagnostic expected answer/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

function writeCatalogIndexFixtures(userDataRoot, knowledgeBaseId, records) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const insertSource = db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO NOTHING
    `);
    const insertChunk = db.prepare(`
      INSERT INTO chunks (
        chunk_id, document_id, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `);
    const insertRecord = db.prepare(`
      INSERT INTO index_records (
        record_id, chunk_id, provider, index_name, status, vector_id,
        keyword_key, structure_key, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET status = excluded.status, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `);
    const write = db.transaction(() => {
      for (const record of records) {
        insertSource.run(
          record.document_id,
          record.metadata?.title || record.document_id,
          "text",
          record.sourceUri,
          record.sourceUri,
          "",
          process.platform,
          "included",
          "primary",
          JSON.stringify({ sourceUri: record.sourceUri }),
          now,
          now
        );
        const metadata = JSON.stringify({
          text: record.text,
          sourceUri: record.sourceUri,
          page_start: record.page_start,
          metadata: record.metadata,
          document_id: record.document_id,
          version_id: record.version_id,
          quality: { writeEnabled: true, tier: "primary" },
          datasetVersionId: "build-catalog",
          active: true
        });
        insertChunk.run(record.chunk_id, record.document_id, "", Math.ceil(record.text.length / 4), "primary", metadata, now, now);
        insertRecord.run(
          record.chunk_id,
          record.chunk_id,
          "local",
          "catalog-local",
          "written",
          `local:${record.chunk_id}`,
          "",
          "",
          metadata,
          now,
          now
        );
      }
    });
    write();
  } finally {
    db.close();
  }
}

function writeK12CatalogTocRouteFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const insertDocument = db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'pdf', ?, ?, ?, ?, 'active', 'primary', ?, ?, ?)
    `);
    const insertNode = db.prepare(`
      INSERT INTO structure_nodes (
        node_id, parent_id, document_id, node_type, title, sort_order,
        page_start, page_end, path, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const write = db.transaction(() => {
      const documents = [
        {
          id: "doc-grade5-chinese-v1",
          title: "义务教育教科书·语文五年级上册",
          relativePath: "小学/语文/统编版/义务教育教科书·语文五年级上册.pdf",
          education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "上册" }
        },
        {
          id: "doc-grade5-chinese-v2",
          title: "义务教育教科书·语文五年级下册",
          relativePath: "小学/语文/统编版/义务教育教科书·语文五年级下册.pdf",
          education: { stage: "小学", grade: "五年级", subject: "语文", publisher: "统编版", volume: "下册" }
        },
        {
          id: "doc-grade6-chinese-v2",
          title: "义务教育教科书·语文六年级下册",
          relativePath: "小学/语文/统编版/义务教育教科书·语文六年级下册.pdf",
          education: { stage: "小学", grade: "六年级", subject: "语文", publisher: "统编版", volume: "下册" }
        }
      ];
      for (const document of documents) {
        insertDocument.run(
          document.id,
          document.title,
          document.relativePath,
          document.relativePath,
          `sha-${document.id}`,
          process.platform,
          JSON.stringify({ education: document.education }),
          now,
          now
        );
      }
      const nodes = [
        {
          id: "toc-grade5-upper-u3-l1",
          documentId: "doc-grade5-chinese-v1",
          title: "猎人海力布",
          page: 24,
          path: "目录/第三单元/1 猎人海力布",
          education: { ...documents[0].education, unit_no: 3, lesson_order_no: 1, lesson_title: "猎人海力布" }
        },
        {
          id: "toc-grade5-lower-u3-l1",
          documentId: "doc-grade5-chinese-v2",
          title: "汉字真有趣",
          page: 42,
          path: "目录/第三单元/1 汉字真有趣",
          education: { ...documents[1].education, unit_no: 3, lesson_order_no: 1, lesson_title: "汉字真有趣" }
        },
        {
          id: "toc-grade6-lower-u3-l1",
          documentId: "doc-grade6-chinese-v2",
          title: "匆匆",
          page: 8,
          path: "目录/第三单元/1 匆匆",
          education: { ...documents[2].education, unit_no: 3, lesson_order_no: 1, lesson_title: "匆匆" }
        }
      ];
      for (const [index, node] of nodes.entries()) {
        insertNode.run(
          node.id,
          null,
          node.documentId,
          "toc_entry",
          node.title,
          index + 1,
          node.page,
          node.page,
          node.path,
          JSON.stringify({
            unitNo: 3,
            lessonOrder: 1,
            lessonTitle: node.title,
            education: node.education
          }),
          now,
          now
        );
      }
    });
    write();
  } finally {
    db.close();
  }
}

function writeGeneralStructureRouteFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-policy', '员工手册', 'pdf', 'policy.pdf', '制度/员工手册.pdf', 'sha-doc-policy', ?, 'active', 'primary', '{}', ?, ?)
      `).run(process.platform, now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES ('node-reimbursement', NULL, 'doc-policy', 'section', '报销制度', 1, 12, 15, '员工手册/报销制度', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO citations (
          citation_id, chunk_id, document_id, page_id, block_id, structure_node_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
        ) VALUES ('citation-reimbursement', NULL, 'doc-policy', NULL, NULL, 'node-reimbursement', '员工手册', 12, 'p12', '{}', ?, ?)
      `).run(now, now);
    });
    write();
  } finally {
    db.close();
  }
}

function writeCatalogReleaseFixture(userDataRoot, knowledgeBaseId, input) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const buildId = String(input.buildId || "");
    const summary = JSON.stringify({
      job: { id: input.jobId || "fixture-job", mode: "local", template: "general-docs" },
      knowledgeBase: { id: knowledgeBaseId },
      datasetVersionId: buildId,
      target: input.target || null,
      sidecar: input.sidecar || null,
      quality: input.quality || null,
      activeVersions: []
    });
    db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, 'active', 1, '', ?, ?, ?)
      ON CONFLICT(build_id) DO UPDATE SET status = excluded.status, active = excluded.active, summary_json = excluded.summary_json, updated_at = excluded.updated_at
    `).run(buildId, summary, now, now);
    db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(release_id) DO UPDATE SET status = excluded.status, manifest_path = excluded.manifest_path, summary_json = excluded.summary_json, updated_at = excluded.updated_at
    `).run(`${buildId}:active`, buildId, input.manifestPath || "", summary, now, now);
  } finally {
    db.close();
  }
}

function writeCatalogVersionHistoryFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const insertBuild = db.prepare(`
      INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?, ?)
    `);
    const insertRelease = db.prepare(`
      INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertBuild.run("build-active", "active", 1, JSON.stringify({
      documents: { included: 12, excluded: 0, attention: 0 },
      write: { records: 120, failed: 0 },
      evaluation: { passed: 14, failed: 0 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "active-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://active/manifest.json", chunks: 120 },
      rawText: "SECRET raw content"
    }), "2026-06-29T08:00:00.000Z", "2026-06-29T09:00:00.000Z");
    insertRelease.run("release-active", "build-active", "active", "/workspace/build-active/manifests/active.json", JSON.stringify({
      documents: { included: 12, excluded: 0, attention: 0 },
      write: { records: 120, failed: 0 },
      evaluation: { passed: 14, failed: 0 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "active-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://active/manifest.json", chunks: 120 },
      notes: "SECRET raw content"
    }), "2026-06-29T08:10:00.000Z", "2026-06-29T09:10:00.000Z");
    insertBuild.run("build-previous", "published", 0, JSON.stringify({
      documents: { included: 9, excluded: 2, attention: 1 },
      write: { records: 90, failed: 1 },
      evaluation: { passed: 11, failed: 1 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "previous-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://previous/manifest.json", chunks: 90 },
      rawText: "SECRET raw content"
    }), "2026-06-28T08:00:00.000Z", "2026-06-28T09:00:00.000Z");
    insertRelease.run("release-previous", "build-previous", "published", "/workspace/build-previous/manifests/active.json", JSON.stringify({
      documents: { included: 9, excluded: 2, attention: 1 },
      write: { records: 90, failed: 1 },
      evaluation: { passed: 11, failed: 1 },
      target: { provider: "aliyun-vector", bucket: "vector-bucket", indexName: "previous-index", region: "cn-hangzhou" },
      sidecar: { authoritativeStore: "oss-sidecar", manifestUri: "oss://previous/manifest.json", chunks: 90 },
      notes: "SECRET raw content"
    }), "2026-06-28T08:10:00.000Z", "2026-06-28T09:10:00.000Z");
  } finally {
    db.close();
  }
}

function writeCatalogEvaluationDashboardFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = "2026-06-29T08:00:00.000Z";
    const active = "2026-06-29T09:00:00.000Z";
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-api-eval', 'active', 1, '', '{}', ?, ?)
      `).run(now, active);
      const caseInsert = db.prepare(`
        INSERT INTO evaluation_cases (case_id, template, category, question, expected_json, active, created_at, updated_at)
        VALUES (?, 'textbook-cn-k12', ?, ?, ?, 1, ?, ?)
      `);
      caseInsert.run("case-api-toc", "toc_lookup", "private evaluation question api toc", JSON.stringify({ expected: "private expected answer api toc" }), now, now);
      caseInsert.run("case-api-unit", "unit_lesson_lookup", "private evaluation question api unit", JSON.stringify({ expected: "private expected answer api unit" }), now, now);
      caseInsert.run("case-api-refusal", "out_of_scope_refusal", "private evaluation question api refusal", "{}", now, now);
      const resultInsert = db.prepare(`
        INSERT INTO evaluation_results (result_id, case_id, build_id, status, scores_json, details_json, created_at, updated_at)
        VALUES (?, ?, 'build-api-eval', ?, ?, ?, ?, ?)
      `);
      resultInsert.run("result-api-toc", "case-api-toc", "pass", JSON.stringify({ score: 0.98, citationBearing: true }), "{}", active, active);
      resultInsert.run(
        "result-api-unit",
        "case-api-unit",
        "fail",
        JSON.stringify({ score: 0.22, citationBearing: false }),
        JSON.stringify({ riskCodes: ["route_status_mismatch"], detail: "private failure detail api" }),
        active,
        active
      );
    });
    write();
  } finally {
    db.close();
  }
}

function writeCatalogTargetedRerunFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = "2026-06-29T11:00:00.000Z";
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-rerun-api', '局部重跑资料', 'pdf', 'E:/sources/rerun.pdf', 'rerun/rerun.pdf', 'hash-rerun', 'win32', 'included', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO document_versions (version_id, document_id, display_version, content_hash, artifact_path, status, metadata_json, created_at, updated_at)
        VALUES ('ver-rerun-api', 'doc-rerun-api', 'v1.0.0', 'hash-rerun', 'artifacts/rerun', 'active', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at)
        VALUES
          ('page-rerun-1', 'doc-rerun-api', 'ver-rerun-api', 1, 'pages/rerun-1.json', 'text-rerun-1', 'extracted', 'primary', '{"sample":"private rerun page text"}', ?, ?),
          ('page-rerun-2', 'doc-rerun-api', 'ver-rerun-api', 2, 'pages/rerun-2.json', 'text-rerun-2', 'retry', 'review', '{"retry":{"retryable":true},"sample":"private rerun retry text"}', ?, ?)
      `).run(now, now, now, now);
      db.prepare(`
        INSERT INTO chunks (chunk_id, document_id, text_hash, token_count, quality_state, metadata_json, created_at, updated_at)
        VALUES ('chunk-rerun-api', 'doc-rerun-api', 'chunk-rerun-hash', 31, 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO quality_issues (issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at)
        VALUES ('issue-rerun-api', 'document', 'doc-rerun-api', 'review', 'open', 'needs review', '{"detail":"private rerun failure detail"}', ?, ?)
      `).run(now, now);
    });
    write();
  } finally {
    db.close();
  }
}

function writeCatalogSetupFixture(userDataRoot, knowledgeBaseId, draft, updatedAt = new Date().toISOString()) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    db.prepare(`
      INSERT INTO setup_state (id, draft_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(draft || {}), updatedAt);
  } finally {
    db.close();
  }
}

function writeCatalogJobStateFixture(userDataRoot, knowledgeBaseId, state) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const latestJobId = String(state.latestJobId || state.jobs?.at(-1)?.id || "");
    const insertJob = db.prepare(`
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
    `);
    const insertStep = db.prepare(`
      INSERT INTO task_steps (job_id, step_key, sort_order, status, label_json, message_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id, step_key) DO UPDATE SET
        sort_order = excluded.sort_order,
        status = excluded.status,
        label_json = excluded.label_json,
        message_json = excluded.message_json,
        updated_at = excluded.updated_at
    `);
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO catalog_state (key, value, updated_at)
        VALUES ('latestJobId', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(latestJobId, state.updatedAt || now);
      for (const job of state.jobs || []) {
        const createdAt = job.createdAt || state.updatedAt || now;
        const updatedAt = job.updatedAt || state.updatedAt || createdAt;
        insertJob.run(
          job.id,
          String(job.status || ""),
          String(job.mode || ""),
          String(job.template || ""),
          JSON.stringify(job.summary || {}),
          JSON.stringify(job.progress || {}),
          JSON.stringify(job),
          createdAt,
          updatedAt
        );
        for (const [index, taskItem] of (job.tasks || []).entries()) {
          insertStep.run(
            job.id,
            String(taskItem.key || `step-${index}`),
            index,
            String(taskItem.status || ""),
            JSON.stringify(taskItem.label || {}),
            JSON.stringify(taskItem.message || {}),
            taskItem.updatedAt || updatedAt
          );
        }
      }
    });
    write();
  } finally {
    db.close();
  }
}

function writeCatalogQualityIssueFixture(userDataRoot, knowledgeBaseId, input) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO quality_issues (
        issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        target_type = excluded.target_type,
        target_id = excluded.target_id,
        severity = excluded.severity,
        status = excluded.status,
        reason = excluded.reason,
        details_json = excluded.details_json,
        updated_at = excluded.updated_at
    `).run(
      input.issueId,
      input.targetType || "document",
      input.targetId || input.documentId || "target-fixture",
      input.severity || "review",
      input.status || "open",
      input.reason || "需要复核。",
      JSON.stringify(input.details || {}),
      now,
      now
    );
  } finally {
    db.close();
  }
}

function writeCatalogContentGraphFixture(userDataRoot, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const insertSource = db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, 'pdf', ?, ?, '', ?, 'included', 'primary', ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET title = excluded.title, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `);
    const insertPage = db.prepare(`
      INSERT INTO pages (
        page_id, document_id, version_id, page_number, artifact_path, text_hash,
        extraction_state, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', '', 'extracted', ?, ?, ?, ?)
      ON CONFLICT(page_id) DO UPDATE SET metadata_json = excluded.metadata_json, quality_state = excluded.quality_state, updated_at = excluded.updated_at
    `);
    const insertBlock = db.prepare(`
      INSERT INTO blocks (
        block_id, page_id, document_id, block_type, sort_order, text_path, text_hash,
        structure_path, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, ?, ?)
      ON CONFLICT(block_id) DO UPDATE SET metadata_json = excluded.metadata_json, quality_state = excluded.quality_state, updated_at = excluded.updated_at
    `);
    const insertNode = db.prepare(`
      INSERT INTO structure_nodes (
        node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET title = excluded.title, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `);
    const insertObject = db.prepare(`
      INSERT INTO knowledge_objects (
        object_id, document_id, structure_node_id, object_type, title, source_page, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(object_id) DO UPDATE SET title = excluded.title, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `);
    const insertChunk = db.prepare(`
      INSERT INTO chunks (
        chunk_id, document_id, object_id, block_id, structure_node_id, text_path,
        text_hash, token_count, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET metadata_json = excluded.metadata_json, quality_state = excluded.quality_state, updated_at = excluded.updated_at
    `);
    const insertCitation = db.prepare(`
      INSERT INTO citations (
        citation_id, chunk_id, document_id, page_id, block_id, structure_node_id,
        source_label, page_number, anchor, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)
      ON CONFLICT(citation_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `);
    const write = db.transaction(() => {
      insertSource.run("doc-math-graph", "义务教育教科书·数学五年级上册", "小学/数学/五年级/数学五年级上册.pdf", "小学/数学/五年级/数学五年级上册.pdf", process.platform, JSON.stringify({ title: "义务教育教科书·数学五年级上册" }), now, now);
      insertPage.run("ver-math-graph:page:0029", "doc-math-graph", "ver-math-graph", 29, "primary", JSON.stringify({ title: "小数除法", relativePath: "小学/数学/五年级/数学五年级上册.pdf" }), now, now);
      insertBlock.run("block-math-decimal", "ver-math-graph:page:0029", "doc-math-graph", "body_text", 1, "primary", JSON.stringify({ textPreview: "本单元学习小数除法。", page_start: 29 }), now, now);
      insertNode.run("node-math-book", null, "doc-math-graph", "document", "数学五年级上册", 0, 1, 120, "小学/数学/五年级/数学五年级上册.pdf", JSON.stringify({ title: "数学五年级上册" }), now, now);
      insertNode.run("node-decimal-division", "node-math-book", "doc-math-graph", "section", "第三单元 小数除法", 3, 29, 40, "第三单元/小数除法", JSON.stringify({ unit: 3 }), now, now);
      insertObject.run("object-decimal-division", "doc-math-graph", "node-decimal-division", "knowledge_point", "小数除法知识点", 29, "primary", JSON.stringify({ chunk_id: "chunk-decimal-division", title: "小数除法知识点" }), now, now);
      insertChunk.run("chunk-decimal-division", "doc-math-graph", "object-decimal-division", "block-math-decimal", "node-decimal-division", 24, "primary", JSON.stringify({
        text: "第三单元讲小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。",
        textPreview: "第三单元讲小数除法。",
        page_start: 29,
        page_end: 29,
        sourceUri: "小学/数学/五年级/数学五年级上册.pdf",
        metadata: { title: "义务教育教科书·数学五年级上册", sourceType: "pdf" }
      }), now, now);
      insertCitation.run("citation-decimal-division", "chunk-decimal-division", "doc-math-graph", "ver-math-graph:page:0029", "block-math-decimal", "node-decimal-division", "义务教育教科书·数学五年级上册", 29, JSON.stringify({
        title: "义务教育教科书·数学五年级上册",
        sourceUri: "小学/数学/五年级/数学五年级上册.pdf",
        excerpt: "第三单元讲小数除法。",
        page_start: 29,
        page_end: 29
      }), now, now);

      insertObject.run("object-review-noise", "doc-math-graph", "node-decimal-division", "layout_noise", "页眉噪声", 29, "review", JSON.stringify({ chunk_id: "chunk-review-noise", title: "页眉噪声" }), now, now);
      insertChunk.run("chunk-review-noise", "doc-math-graph", "object-review-noise", "block-math-decimal", "node-decimal-division", 2, "review", JSON.stringify({
        text: "页眉",
        textPreview: "页眉",
        page_start: 29,
        sourceUri: "小学/数学/五年级/数学五年级上册.pdf",
        quality: { tier: "review", writeEnabled: false }
      }), now, now);
    });
    write();
  } finally {
    db.close();
  }
}

function writeCatalogPageBlockFixture(userDataRoot, knowledgeBaseId, input) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const documentId = input.documentId || "doc_fixture";
    const versionId = input.versionId || "ver_fixture";
    const relativePath = input.relativePath || "fixture.txt";
    const title = input.title || relativePath;
    db.prepare(`
      INSERT INTO source_documents (
        document_id, title, source_type, original_path, normalized_relative_path,
        content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', ?, 'included', 'primary', ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET title = excluded.title, normalized_relative_path = excluded.normalized_relative_path, updated_at = excluded.updated_at
    `).run(documentId, title, input.sourceType || "text", relativePath, relativePath, process.platform, JSON.stringify({ sourceUri: relativePath }), now, now);
    db.prepare(`
      INSERT INTO pages (
        page_id, document_id, version_id, page_number, artifact_path, text_hash,
        extraction_state, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', '', 'extracted', 'primary', ?, ?, ?)
    `).run(`${versionId}:page:0001`, documentId, versionId, 1, JSON.stringify({ title, relativePath, sourceType: input.sourceType || "text" }), now, now);
    db.prepare(`
      INSERT INTO blocks (
        block_id, page_id, document_id, block_type, sort_order, text_path, text_hash,
        structure_path, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, 'body_text', 0, '', '', '', 'primary', ?, ?, ?)
    `).run(`${versionId}:block:0001`, `${versionId}:page:0001`, documentId, JSON.stringify({
      text: input.text || "",
      textPreview: input.text || "",
      page_start: 1,
      page_end: 1,
      contentType: "body_text",
      title,
      relativePath,
      sourceType: input.sourceType || "text"
    }), now, now);
    db.prepare(`
      INSERT INTO chunks (
        chunk_id, document_id, text_path, text_hash, token_count, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, '', '', ?, 'primary', ?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `).run(`${versionId}:chunk:0001`, documentId, Math.ceil(String(input.text || "").length / 4), JSON.stringify({
      chunk_id: `${versionId}:chunk:0001`,
      document_id: documentId,
      version_id: versionId,
      text: input.text || "",
      sourceUri: relativePath,
      page_start: 1,
      page_end: 1,
      metadata: { title, sourceType: input.sourceType || "text" },
      quality: { writeEnabled: true, tier: "primary" },
      active: true
    }), now, now);
    db.prepare(`
      INSERT INTO citations (
        citation_id, chunk_id, document_id, page_id, source_label, page_number, anchor, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, '', ?, ?, ?)
      ON CONFLICT(citation_id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
    `).run(`${versionId}:chunk:0001:source`, `${versionId}:chunk:0001`, documentId, `${versionId}:page:0001`, title, JSON.stringify({
      title,
      relativePath,
      sourceUri: relativePath,
      excerpt: input.text || "",
      page_start: 1,
      page_end: 1
    }), now, now);
  } finally {
    db.close();
  }
}

test("k12 metadata contract understands textbook scope without confusing starting-point labels", () => {
  const query = extractK12QueryConstraints("五年级统编版语文第三单元第一课是什么");
  assert.equal(query.compact.fgs, "primary|g5|chinese");
  assert.equal(query.compact.pub, "tongbian");
  assert.equal(query.compact.unit, "u03");
  assert.equal(query.compact.lesson, undefined);
  assert.equal(query.education.lesson_order_no, 1);
  assert.equal(query.missing.volume, true);

  const education = extractK12EducationMetadata({
    sourceUri: "小学/英语/闽教版/义务教育教科书·英语（三年级起点）五年级上册.pdf"
  });
  assert.equal(education.stage, "小学");
  assert.equal(education.subject, "英语");
  assert.equal(education.grade, "五年级");
  assert.equal(education.volume, "上册");
  assert.equal(education.publisher, "闽教版");
});

test("local service exposes health endpoint", async () => {
  const service = await startLocalService({ projectRoot, port: 0, open: false });
  try {
    const response = await fetch(`${service.url}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.name, "knowmesh");
    assert.equal(body.service, "knowmesh-local-service");
    assert.equal(body.port, service.port);
    assert.equal(body.requestedPort, 0);
    assert.equal(body.portChanged, false);
    assert.ok(body.port >= 20000 && body.port < 44100);
    assert.equal(body.url, service.url);
  } finally {
    await service.close();
  }
});

test("local service reports port fallback details for first-run startup", async () => {
  const occupied = await startLocalService({ projectRoot, port: 0, open: false });
  let fallback = null;
  try {
    fallback = await startLocalService({ projectRoot, port: occupied.port, open: false });
    const response = await fetch(`${fallback.url}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(fallback.requestedPort, occupied.port);
    assert.equal(fallback.portChanged, true);
    assert.notEqual(fallback.port, occupied.port);
    assert.equal(body.port, fallback.port);
    assert.equal(body.requestedPort, occupied.port);
    assert.equal(body.portChanged, true);
    assert.equal(body.url, fallback.url);
  } finally {
    if (fallback) await fallback.close();
    await occupied.close();
  }
});

test("local service exposes knowledge-base library endpoints", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-api-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createdAResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "小学教材库", template: "textbook-cn-k12" })
    });
    const createdA = await createdAResponse.json();
    const createdBResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "客服知识库", template: "general-docs" })
    });
    const createdB = await createdBResponse.json();
    const switchResponse = await fetch(`${service.url}/api/knowledge-bases/current`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: createdA.knowledgeBase.id })
    });
    const switched = await switchResponse.json();
    const listResponse = await fetch(`${service.url}/api/knowledge-bases`);
    const list = await listResponse.json();

    assert.equal(createdAResponse.status, 200);
    assert.equal(createdBResponse.status, 200);
    assert.equal(switchResponse.status, 200);
    assert.equal(listResponse.status, 200);
    assert.equal(createdA.ok, true);
    assert.equal(createdB.ok, true);
    assert.equal(switched.current.id, createdA.knowledgeBase.id);
    assert.equal(list.current.id, createdA.knowledgeBase.id);
    assert.deepEqual(list.items.map((item) => item.name), ["小学教材库", "客服知识库"]);
    assert.ok(list.items.every((item) => item.root.includes("knowledge-bases")));
  } finally {
    await service.close();
  }
});
test("fresh local service does not create or route to an implicit knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-no-default-kb-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const homeResponse = await fetch(service.url);
    const home = await homeResponse.text();
    const setupRedirect = await fetch(`${service.url}/setup/mode`, { redirect: "manual" });
    const executionRedirect = await fetch(`${service.url}/execution`, { redirect: "manual" });
    const knowledgeBasesResponse = await fetch(`${service.url}/knowledge-bases`);
    const knowledgeBasesPage = await knowledgeBasesResponse.text();
    const listResponse = await fetch(`${service.url}/api/knowledge-bases`);
    const list = await listResponse.json();
    const documentsResponse = await fetch(`${service.url}/api/documents`);
    const documents = await documentsResponse.json();
    const blockedCredentialWriteResponse = await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "AKID_NO_KB", accessKeySecret: "secret", saveTarget: "secure-local" })
    });

    assert.equal(homeResponse.status, 200);
    assert.match(home, /href="\/knowledge-bases"/);
    assert.doesNotMatch(home, /\/kb\/default/);
    assert.doesNotMatch(home, /\/kb\/kb-k12-all-subjects/);
    assert.equal(setupRedirect.status, 302);
    assert.equal(setupRedirect.headers.get("location"), "/knowledge-bases");
    assert.equal(executionRedirect.status, 404);
    assert.equal(knowledgeBasesResponse.status, 200);
    assert.match(knowledgeBasesPage, /data-knowledge-base-empty/);
    assert.match(knowledgeBasesPage, /第一步/);
    assert.match(knowledgeBasesPage, /新建知识库/);
    assert.doesNotMatch(knowledgeBasesPage, /href="\/setup\/mode"/);
    assert.doesNotMatch(knowledgeBasesPage, /href="\/build"/);
    assert.doesNotMatch(knowledgeBasesPage, /href="\/execution"/);
    assert.equal(listResponse.status, 200);
    assert.equal(list.current, null);
    assert.deepEqual(list.items, []);
    assert.equal(documentsResponse.status, 200);
    assert.equal(documents.knowledgeBaseId, "");
    assert.deepEqual(documents.documents, []);
    assert.equal(documents.summary.totalDocuments, 0);
    assert.equal(blockedCredentialWriteResponse.status, 409);
    assert.equal(fs.existsSync(path.join(userDataRoot, "secrets", "aliyun-credential.json")), false);
    assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", "default")), false);
    assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", "kb-k12-all-subjects")), false);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("legacy default scoped routes are not treated as a real knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-no-default-route-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createdResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "K12全科知识库", template: "textbook-cn-k12" })
    });
    const defaultApiResponse = await fetch(`${service.url}/kb/default/api/jobs/latest`);
    const defaultSetupResponse = await fetch(`${service.url}/kb/default/setup/mode`, { redirect: "manual" });
    const migratedApiResponse = await fetch(`${service.url}/kb/not-a-real-kb/api/jobs/latest`);

    assert.equal(createdResponse.status, 200);
    assert.equal(defaultApiResponse.status, 404);
    assert.equal(defaultSetupResponse.status, 302);
    assert.equal(defaultSetupResponse.headers.get("location"), "/knowledge-bases");
    assert.equal(migratedApiResponse.status, 404);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});
test("local service exposes guarded local folder picker endpoint", async () => {
  const service = await startLocalService({ projectRoot, port: 0, open: false });
  try {
    const dryRunResponse = await fetch(`${service.url}/api/local/folders/pick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "source", dryRun: true })
    });
    const dryRun = await dryRunResponse.json();
    const invalidResponse = await fetch(`${service.url}/api/local/folders/pick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "system" })
    });

    assert.equal(dryRunResponse.status, 200);
    assert.equal(dryRun.ok, true);
    assert.equal(dryRun.target, "source");
    assert.equal(invalidResponse.status, 400);

    const pickerSource = fs.readFileSync(path.join(projectRoot, "src", "local-service", "folder-picker.mjs"), "utf8");
    assert.match(pickerSource, /IFileOpenDialog/);
    assert.match(pickerSource, /FOS_PICKFOLDERS/);
    assert.match(pickerSource, /TopMost\s*=\s*\$true/);
    assert.match(pickerSource, /\$owner\.Handle/);
    assert.doesNotMatch(pickerSource, /FolderBrowserDialog/);
  } finally {
    await service.close();
  }
});

test("local service prechecks selected local folders without running a scan", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-folder-precheck-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const sourcePath = path.join(projectRoot, "examples", "local-demo", "documents");
    const workspacePath = path.join(userDataRoot, "workspace");
    const sourceResponse = await fetch(`${service.url}/api/local/folders/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "source",
        path: sourcePath,
        template: "general-docs"
      })
    });
    const source = await sourceResponse.json();
    const workspaceResponse = await fetch(`${service.url}/api/local/folders/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "workspace",
        path: workspacePath
      })
    });
    const workspace = await workspaceResponse.json();
    const invalidResponse = await fetch(`${service.url}/api/local/folders/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "system", path: sourcePath })
    });

    assert.equal(sourceResponse.status, 200);
    assert.equal(source.ok, true);
    assert.equal(source.target, "source");
    assert.ok(source.preview.summary.matchedFiles >= 3);
    assert.ok(source.preview.fileTypes.some((item) => item.type === "pdf"));
    assert.ok(source.checks.some((item) => item.key === "readOnly" && item.status === "pass"));
    assert.equal(workspaceResponse.status, 200);
    assert.equal(workspace.ok, true);
    assert.equal(workspace.target, "workspace");
    assert.ok(workspace.checks.some((item) => item.key === "workspaceWritable" && item.status === "pass"));
    assert.equal(invalidResponse.status, 400);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes commercial template library", async () => {
  const service = await startLocalService({ projectRoot, port: 0, open: false });
  try {
    const response = await fetch(`${service.url}/api/templates`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.version, "1.2.0");
    assert.ok(Array.isArray(body.templates));

    const textbook = body.templates.find((template) => template.id === "textbook-cn-k12");
    assert.ok(textbook);
    assert.equal(textbook.recommended, true);
    assert.equal(textbook.templateRole, "industry-extension");
    assert.equal(textbook.extendsTemplate, "general-docs");
    assert.equal(textbook.archivePolicy.strategy, "archive-originals");
    assert.equal(textbook.processingInputPolicy.scannedPdf.ocrInput, "page-image-tasks");
    assert.match(textbook.commercialFit.zh, /商用教材知识库/);
    const subjectField = textbook.requiredFields.find((field) => field.key === "metadata.subject");
    assert.ok(subjectField);
    assert.equal(subjectField.type, "multi-select");
    assert.ok(subjectField.options.some((option) => option.value === "数学"));
    const physics = subjectField.options.find((option) => option.value === "物理");
    const chemistry = subjectField.options.find((option) => option.value === "化学");
    assert.ok(physics);
    assert.ok(chemistry);
    assert.deepEqual(physics.stages, ["初中", "高中"]);
    assert.deepEqual(chemistry.stages, ["初中", "高中"]);
    assert.ok(textbook.vectorFilterPolicy.remove.length >= 3);
    assert.ok(textbook.vectorFilterPolicy.metadataOnly.length >= 3);
    assert.ok(textbook.vectorFilterPolicy.review.length >= 2);
    assert.ok(textbook.chunkingPolicy.strategy.zh);
    assert.ok(textbook.chunkingPolicy.preserve.length >= 3);
    assert.ok(textbook.qualityGates.length >= 3);
    assert.ok(textbook.pitfalls.length >= 3);
    assert.ok(textbook.acceptanceCriteria.length >= 3);
    const general = body.templates.find((template) => template.id === "general-docs");
    assert.equal(general?.templateRole, "fallback");
    assert.equal(general?.extendsTemplate, null);
    assert.ok(body.templates.every((template) => template.archivePolicy && template.processingInputPolicy && template.citationPolicy && template.chunkingPolicy && template.qualityGates?.length && template.pitfalls?.length && template.acceptanceCriteria?.length));
  } finally {
    await service.close();
  }
});

test("local service refreshes the Aliyun model catalog without recommending old models", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-model-catalog-test-"));
  const officialDocs = [
    "qwen-vl-ocr-2025-11-20 qwen-plus qwen-max",
    "text-embedding-v4 qwen3-vl-embedding tongyi-embedding-vision-flash-2026-03-06",
    "qwen3-rerank qwen3-vl-rerank"
  ].join("\n");
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => officialDocs
    })
  });
  try {
    await createK12TestKnowledgeBase(service);
    const response = await fetch(`${service.url}/api/aliyun/model-catalog/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        current: {
          "aliyun.services.rerank": "gte-rerank"
        }
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.source, "official-docs");
    assert.ok(body.catalog.ocr.some((item) => item.id === "qwen-vl-ocr-2025-11-20" && item.status === "recommended"));
    assert.ok(body.catalog.embedding.some((item) => item.id === "text-embedding-v4" && item.status === "recommended"));
    assert.ok(body.catalog.embedding.some((item) => item.id === "qwen3-vl-embedding"));
    assert.ok(body.catalog.embedding.some((item) => item.id === "tongyi-embedding-vision-flash-2026-03-06"));
    assert.ok(body.catalog.rerank.some((item) => item.id === "qwen3-rerank" && item.status === "recommended"));
    assert.ok(body.catalog.rerank.some((item) => item.id === "qwen3-vl-rerank"));
    assert.equal(Object.values(body.catalog).flat().some((item) => item.id === "skip-now"), false);
    assert.equal(body.catalog.rerank.some((item) => /gte-rerank/.test(item.id)), false);
    assert.ok(body.migrations.some((item) => item.from === "gte-rerank" && item.to === "qwen3-rerank"));
    assert.ok(body.catalog.rerank.every((item) => item.docUrl && item.pricingUrl));
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes template detail endpoint", async () => {
  const service = await startLocalService({ projectRoot, port: 0, open: false });
  try {
    const response = await fetch(`${service.url}/api/templates/textbook-cn-k12`);
    const body = await response.json();
    const missingResponse = await fetch(`${service.url}/api/templates/missing-template`);

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.template.id, "textbook-cn-k12");
    assert.equal(body.template.defaultPaths.source, "source");
    assert.equal(body.template.defaultPaths.work, "workspace");
    assert.ok(body.template.evaluationQuestions.length >= 3);
    assert.ok(body.template.chunkingPolicy.targetSize.zh);
    assert.ok(body.template.pitfalls.some((item) => /页码|OCR|引用/.test(item.zh)));
    assert.equal(missingResponse.status, 404);
  } finally {
    await service.close();
  }
});

test("local service serves web console UI", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-web-ui-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const response = await fetch(service.url);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /KnowMesh/);
    assert.match(body, /lang="zh-CN"/);
    assert.match(body, /data-theme="dark"/);
    assert.match(body, /id="langZh"/);
    assert.match(body, /id="themeDark"/);
    assert.match(body, /data-i18n="welcome.actions.continueSetup">继续配置/);
    assert.match(body, /href="\/kb\/kb-k12-all-subjects\/setup\/mode"/);
    assert.match(body, /把资料变成可验证、可追溯、可维护的知识库/);
    assert.match(body, /这个知识库还没完成配置/);
    assert.match(body, /data-welcome-architecture/);
    assert.match(body, /welcome-brand/);
    assert.match(body, /知络 · v0\.1\.0/);
    assert.match(body, /welcome-kb-selector/);
    assert.match(body, /data-global-disclosure/);
    assert.match(body, /welcome-controls/);
    assert.match(body, /welcome-current-panel/);
    assert.match(body, /welcome-current-menu/);
    assert.match(body, /welcome-current-progress/);
    assert.match(body, /welcome-next-arrow/);
    assert.match(body, /welcome-flow-lines/);
    assert.match(body, /welcome-engine-strip/);
    assert.match(body, /icon-file/);
    assert.doesNotMatch(body, /用户会看到的搭建流程/);
    assert.doesNotMatch(body, /复杂控制台/);
    assert.doesNotMatch(body, /The Guided Build Flow/);
    assert.doesNotMatch(body, /front-load domain choices/);
    assert.doesNotMatch(body, /release-badge/);
    assert.doesNotMatch(body, /开发版/);
    assert.doesNotMatch(body, /welcome-workbench/);
    assert.doesNotMatch(body, /welcome-system-map/);
    assert.doesNotMatch(body, /welcome-scenario-grid/);
    assert.doesNotMatch(body, /data-welcome-capabilities/);
    assert.doesNotMatch(body, /data-welcome-principles/);
    assert.doesNotMatch(body, /data-welcome-open-source/);
    assert.match(body, /KnowMesh Core/);
    assert.match(body, /KnowMesh Expert/);
    assert.match(body, /Quality Gates/);
    assert.match(body, /Traceable Knowledge/);
    assert.doesNotMatch(body, /教材与培训/);
    assert.doesNotMatch(body, /welcome-example-strip/);
    assert.match(body, /MIT/);

    const cssResponse = await fetch(`${service.url}/web-console/styles.css`);
    const css = await cssResponse.text();
    const welcomeMainCss = css.match(/\.welcome-main\s*{([\s\S]*?)}/)?.[1] || "";
    assert.match(css, /html\s*{[\s\S]*height: 100%;[\s\S]*overflow: hidden;/);
    assert.match(css, /body\s*{[\s\S]*width: 100%;[\s\S]*height: 100dvh;[\s\S]*overflow: hidden;/);
    assert.match(css, /\.welcome-shell,\s*\.setup-shell\s*{[\s\S]*height: 100dvh;[\s\S]*overflow: hidden;[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);/);
    assert.match(welcomeMainCss, /width: 100%;/);
    assert.match(welcomeMainCss, /max-width: none;/);
    assert.match(welcomeMainCss, /padding: clamp\(30px, 3\.6vw, 54px\) clamp\(56px, 4\.5vw, 80px\) 32px;/);
    assert.match(welcomeMainCss, /height: 100%;[\s\S]*overflow-y: auto;[\s\S]*overflow-x: hidden;[\s\S]*overscroll-behavior: contain;/);
    assert.match(css, /\.welcome-brand/);
    assert.match(css, /\.welcome-kb-selector/);
    assert.match(css, /\.welcome-nav-link\.is-active::after/);
    assert.match(css, /\.welcome-console-link/);
    assert.doesNotMatch(css, /\.topbar-console-link/);
    assert.match(css, /\.welcome-controls/);
    assert.match(css, /\.welcome-current-panel/);
    assert.match(css, /\.welcome-current-progress/);
    assert.match(css, /\.welcome-architecture-map/);
    assert.match(css, /\.welcome-flow-lines/);
    assert.match(css, /\.welcome-stage-node/);
    assert.match(css, /:root\[data-theme="light"\] \.welcome-stage-node/);
    assert.match(css, /\.welcome-stage-node \.icon[\s\S]*width: 38px/);
    assert.match(css, /\.welcome-engine-strip/);
    assert.doesNotMatch(css, /\.welcome-architecture-note/);
    assert.match(css, /font-size: clamp\(54px, 4\.55vw, 76px\)/);
    assert.match(css, /\.welcome-architecture-map[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.welcome-current-panel[\s\S]*min-height: 318px/);
    assert.match(css, /\.welcome-copy h1[\s\S]*min-height: 154px/);
    assert.doesNotMatch(css, /\.release-badge/);
    assert.doesNotMatch(css, /\.welcome-card/);
    assert.doesNotMatch(css, /\.welcome-scenario-card/);
    assert.doesNotMatch(css, /\.welcome-proof-row/);
    assert.doesNotMatch(css, /\.welcome-example-strip/);
    assert.doesNotMatch(css, /\.welcome-workbench/);
    assert.doesNotMatch(css, /\.welcome-system-map/);
    assert.doesNotMatch(css, /\.topbar-link/);
    assert.match(css, /align-items: center/);
    assert.doesNotMatch(css, /font-size: clamp\(36px, 5vw, 68px\)/);

    const preferenceBootIndex = body.indexOf("knowmesh.theme");
    const stylesheetIndex = body.indexOf("/web-console/styles.css");
    assert.ok(preferenceBootIndex > -1);
    assert.ok(stylesheetIndex > -1);
    assert.ok(preferenceBootIndex < stylesheetIndex);
    assert.match(body, /root\.style\.colorScheme = theme/);
    assert.match(body, /knowmesh\.lang/);
    assert.doesNotMatch(body, /knowmesh\.mode/);
    assert.doesNotMatch(body, /knowmesh\.template/);
    assert.match(body, /preferenceHydrating/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});


test("home and setup keep knowledge-base switching available for draft knowledge bases", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-global-switch-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const draftResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "临时测试库", template: "general-docs" })
    });
    const draft = await draftResponse.json();
    assert.equal(draftResponse.status, 200);
    assert.equal(draft.ok, true);

    const homeResponse = await fetch(service.url);
    const home = await homeResponse.text();
    const setupResponse = await fetch(`${service.url}/kb/${draft.knowledgeBase.id}/setup/mode`);
    const setupPage = await setupResponse.text();

    assert.equal(homeResponse.status, 200);
    assert.equal(setupResponse.status, 200);
    assert.match(home, /临时测试库/);
    assert.match(home, /继续配置/);
    assert.doesNotMatch(home, /data-i18n="welcome.actions.continueBuild">继续生成知识库/);
    assert.match(home, /data-global-knowledge-base-switcher/);
    assert.match(home, /data-knowledge-base-switch="kb-k12-all-subjects"/);
    assert.match(setupPage, /data-global-knowledge-base-switcher/);
    assert.match(setupPage, /data-knowledge-base-switch="kb-k12-all-subjects"/);
    assert.match(setupPage, /K12全科知识库/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});
test("local service scopes setup, console, and API routes by knowledge base", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-route-scope-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const service = await startLocalService({ projectRoot, userDataRoot: path.join(temp, "user-data"), port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "企业制度库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;

    const legacySetupResponse = await fetch(`${service.url}/setup/mode`, { redirect: "manual" });
    assert.equal(legacySetupResponse.status, 302);
    assert.match(legacySetupResponse.headers.get("location"), new RegExp(`^/kb/${kbId}/setup/mode$`));

    const scopedDraftResponse = await fetch(`${service.url}/kb/${kbId}/api/setup/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "project.source": sourceRoot, "project.workspace": workspaceRoot, "project.template": "general-docs" } })
    });
    assert.equal(scopedDraftResponse.status, 200);

    const defaultStateResponse = await fetch(`${service.url}/kb/kb-k12-all-subjects/api/setup/state`);
    const scopedStateResponse = await fetch(`${service.url}/kb/${kbId}/api/setup/state`);
    const defaultState = await defaultStateResponse.json();
    const scopedState = await scopedStateResponse.json();
    assert.notEqual(defaultState.draft?.["project.source"], sourceRoot);
    assert.equal(scopedState.draft?.["project.source"], sourceRoot);

    const setupResponse = await fetch(`${service.url}/kb/${kbId}/setup/mode`);
    const setupPage = await setupResponse.text();
    const executionResponse = await fetch(`${service.url}/kb/${kbId}/build/execution`);
    const executionPage = await executionResponse.text();

    assert.equal(setupResponse.status, 200);
    assert.match(setupPage, new RegExp(`href="/kb/${kbId}/setup/aliyun/account"`));
    assert.match(setupPage, /class="welcome-kb-selector knowledge-base-context"/);
    assert.match(setupPage, /企业制度库/);
    assert.match(setupPage, new RegExp(`href="/kb/${kbId}/knowledge-bases"`));
    assert.match(setupPage, new RegExp(`data-api-base-path="/kb/${kbId}/api"`));
    assert.match(setupPage, new RegExp(`"basePath":"/kb/${kbId}"`));
    assert.equal(executionResponse.status, 200);
    assert.match(executionPage, new RegExp(`href="/kb/${kbId}/knowledge-bases"`));
    assert.match(executionPage, new RegExp(`data-api-endpoint="/kb/${kbId}/api/jobs/latest`));
  } finally {
    await service.close();
  }
});

test("local service exposes document inventory maintenance endpoints", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-documents-api-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "alpha.txt"), "Alpha handbook content", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "beta.txt"), "Beta handbook content", "utf8");
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "资料维护测试库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;

    const draftResponse = await fetch(`${service.url}/kb/${kbId}/api/setup/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "setup.mode": "local",
          "project.template": "general-docs",
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      })
    });
    const listResponse = await fetch(`${service.url}/kb/${kbId}/api/documents`);
    const list = await listResponse.json();
    const beta = list.documents.find((document) => document.relativePath === "beta.txt");

    assert.equal(createResponse.status, 200);
    assert.equal(draftResponse.status, 200);
    assert.equal(listResponse.status, 200);
    assert.equal(list.knowledgeBaseId, kbId);
    assert.equal(list.summary.includedDocuments, 2);
    assert.ok(beta);

    const excludeResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/exclude`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [beta], reason: "用户排除" })
    });
    const excluded = await excludeResponse.json();
    const excludedBeta = excluded.documents.find((document) => document.relativePath === "beta.txt");

    assert.equal(excludeResponse.status, 200);
    assert.equal(excluded.summary.includedDocuments, 1);
    assert.equal(excluded.summary.userExcludedDocuments, 1);
    assert.equal(excludedBeta.status, "excluded_by_user");

    const restoreResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [excludedBeta] })
    });
    const restored = await restoreResponse.json();

    assert.equal(restoreResponse.status, 200);
    assert.equal(restored.summary.includedDocuments, 2);
    assert.equal(restored.summary.userExcludedDocuments, 0);
  } finally {
    await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("local service document list prefers catalog rows over stale inventory json", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-documents-catalog-api-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "real-alpha.txt"), "Alpha handbook content", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "real-beta.txt"), "Beta handbook content", "utf8");
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Catalog 清单测试库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;

    await fetch(`${service.url}/kb/${kbId}/api/setup/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "setup.mode": "local",
          "project.template": "general-docs",
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      })
    });
    await fetch(`${service.url}/kb/${kbId}/api/setup/retrieval-strategy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "retrieval.profile": "balanced" } })
    });
    const confirmResponse = await fetch(`${service.url}/kb/${kbId}/api/jobs/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "general-docs",
        draft: {
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      })
    });
    const confirmed = await confirmResponse.json();
    const staleInventoryRoot = path.join(workspaceRoot, "manifests");
    fs.mkdirSync(staleInventoryRoot, { recursive: true });
    fs.writeFileSync(path.join(staleInventoryRoot, "document-inventory.json"), JSON.stringify({
      kind: "knowmesh.documentInventory",
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
      includedDocuments: [{ title: "stale.txt", relativePath: "stale.txt", sourceType: "text" }],
      excludedDocuments: []
    }));

    const listResponse = await fetch(`${service.url}/kb/${kbId}/api/documents?limit=10`);
    const list = await listResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(confirmResponse.status, 200);
    assert.equal(confirmed.ok, true, JSON.stringify(confirmed.checks));
    assert.equal(listResponse.status, 200);
    assert.equal(list.summary.includedDocuments, 2);
    assert.deepEqual(
      list.documents.map((document) => document.relativePath).sort(),
      ["real-alpha.txt", "real-beta.txt"]
    );
  } finally {
    await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("local service exposes the catalog source manifest through a scoped API", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-source-manifest-api-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(path.join(sourceRoot, "语文"), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "语文", "第一册.pdf.1"), "pdf part one", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "语文", "第一册.pdf.2"), "pdf part two", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "notes.txt"), "source note", "utf8");
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Source Manifest API 测试库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;
    const scanResponse = await fetch(`${service.url}/kb/${kbId}/api/scan/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "general-docs",
        draft: {
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      })
    });
    const scan = await scanResponse.json();
    const manifestResponse = await fetch(`${service.url}/kb/${kbId}/api/source/manifest`);
    const manifest = await manifestResponse.json();
    const extractionResponse = await fetch(`${service.url}/kb/${kbId}/api/extraction/manifest`);
    const extraction = await extractionResponse.json();
    const structureResponse = await fetch(`${service.url}/kb/${kbId}/api/structure/sidecar`);
    const structure = await structureResponse.json();
    const chunkResponse = await fetch(`${service.url}/kb/${kbId}/api/chunks/manifest`);
    const chunkManifest = await chunkResponse.json();
    const indexResponse = await fetch(`${service.url}/kb/${kbId}/api/index/manifest`);
    const indexManifest = await indexResponse.json();
    const versionResponse = await fetch(`${service.url}/kb/${kbId}/api/version/manifest`);
    const versionManifest = await versionResponse.json();
    const exportResponse = await fetch(`${service.url}/kb/${kbId}/api/maintenance/export`);
    const diagnostics = await exportResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(scanResponse.status, 200);
    assert.equal(scan.ok, true, JSON.stringify(scan.checks));
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifest.kind, "knowmesh.sourceManifest");
    assert.equal(manifest.knowledgeBase.id, kbId);
    assert.equal(manifest.summary.logicalDocuments, 2);
    assert.equal(manifest.summary.sourceParts, 3);
    assert.equal(manifest.summary.includedDocuments, 2);
    assert.equal(manifest.documents.find((document) => document.sourceType === "split-pdf").sourceParts.length, 2);
    assert.ok(manifest.documents.every((document) => !document.relativePath.includes("\\")));
    assert.equal(extractionResponse.status, 200);
    assert.equal(extraction.kind, "knowmesh.extractionManifest");
    assert.equal(extraction.summary.sourceAnchors, 2);
    assert.equal(extraction.summary.pendingDocuments, 2);
    assert.equal(extraction.summary.extractionPages, 0);
    assert.equal(structureResponse.status, 200);
    assert.equal(structure.kind, "knowmesh.structureSidecar");
    assert.equal(structure.summary.status, "empty");
    assert.equal(structure.summary.documents, 2);
    assert.equal(chunkResponse.status, 200);
    assert.equal(chunkManifest.kind, "knowmesh.chunkManifest");
    assert.equal(chunkManifest.summary.status, "empty");
    assert.equal(indexResponse.status, 200);
    assert.equal(indexManifest.kind, "knowmesh.indexManifest");
    assert.equal(indexManifest.summary.status, "empty");
    assert.equal(versionResponse.status, 200);
    assert.equal(versionManifest.kind, "knowmesh.versionManifest");
    assert.equal(versionManifest.summary.status, "empty");
    assert.equal(exportResponse.status, 200);
    assert.equal(diagnostics.sourceManifest.summary.logicalDocuments, 2);
    assert.equal(diagnostics.sourceManifest.summary.sourceParts, 3);
    assert.equal(diagnostics.sourceManifest.documents, undefined);
    assert.equal(diagnostics.extractionManifest.summary.pendingDocuments, 2);
    assert.equal(diagnostics.extractionManifest.workItems, undefined);
    assert.equal(diagnostics.structureSidecar.summary.status, "empty");
    assert.equal(diagnostics.structureSidecar.documents, undefined);
    assert.equal(diagnostics.chunkManifest.summary.status, "empty");
    assert.equal(diagnostics.chunkManifest.items, undefined);
    assert.equal(diagnostics.indexManifest.summary.status, "empty");
    assert.equal(diagnostics.indexManifest.records, undefined);
    assert.equal(diagnostics.versionManifest.summary.status, "empty");
    assert.equal(diagnostics.versionManifest.versions, undefined);
  } finally {
    await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("local service reveals source documents through a knowledge-base guarded endpoint", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-documents-reveal-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(path.join(sourceRoot, "nested"), { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "nested", "alpha.txt"), "Alpha handbook content", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "nested", "book.pdf.1"), "Split PDF part", "utf8");
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "资料定位测试库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;
    await fetch(`${service.url}/kb/${kbId}/api/setup/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "setup.mode": "local",
          "project.template": "general-docs",
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      })
    });

    const revealResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { relativePath: "nested/alpha.txt" }, dryRun: true })
    });
    const reveal = await revealResponse.json();
    const splitRevealResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { relativePath: "nested/book.pdf" }, dryRun: true })
    });
    const splitReveal = await splitRevealResponse.json();
    const escapeResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/reveal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { relativePath: "../outside.txt" }, dryRun: true })
    });
    const escape = await escapeResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(revealResponse.status, 200);
    assert.equal(reveal.ok, true);
    assert.equal(reveal.opened, false);
    assert.equal(path.resolve(reveal.path), path.join(sourceRoot, "nested", "alpha.txt"));
    assert.equal(path.resolve(reveal.directory), path.join(sourceRoot, "nested"));
    assert.equal(typeof reveal.command?.command, "string");
    assert.equal(splitRevealResponse.status, 200);
    assert.equal(splitReveal.resolvedFrom, "source-part");
    assert.equal(path.resolve(splitReveal.path), path.join(sourceRoot, "nested", "book.pdf.1"));
    assert.equal(escapeResponse.status, 400);
    assert.equal(escape.ok, false);
  } finally {
    await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("local service exposes processed document assets from the current knowledge-base sidecar", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-document-asset-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "book.txt"), "Original source", "utf8");
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "资料全文测试库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;
    await fetch(`${service.url}/kb/${kbId}/api/setup/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "setup.mode": "local",
          "project.template": "general-docs",
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      })
    });

    const versionRoot = path.join(workspaceRoot, "knowledge-bases", kbId, "versions", "v1");
    fs.mkdirSync(path.join(versionRoot, "manifests"), { recursive: true });
    fs.mkdirSync(path.join(versionRoot, "artifacts", "sidecar", "chunks"), { recursive: true });
    fs.writeFileSync(path.join(versionRoot, "manifests", "active-manifest.json"), JSON.stringify({
      kind: "knowmesh.activeManifest",
      datasetVersionId: "v1",
      status: "active",
      generatedAt: new Date().toISOString()
    }, null, 2));
    writeCatalogReleaseFixture(userDataRoot, kbId, {
      buildId: "v1",
      manifestPath: path.join(versionRoot, "manifests", "active-manifest.json")
    });
    writeCatalogIndexFixtures(userDataRoot, kbId, [{
      chunk_id: "chunk_1",
      document_id: "doc_book",
      version_id: "ver_book",
      text: "Page one processed text.",
      sourceUri: "book.txt",
      page_start: 1,
      metadata: { title: "Book", sourceType: "text" }
    }]);
    fs.writeFileSync(path.join(versionRoot, "artifacts", "sidecar", "chunks", "part-0001.jsonl"), [
      JSON.stringify({
        kind: "knowmesh.sidecarChunk",
        document_id: "doc_book",
        version_id: "ver_book",
        chunk_id: "chunk_1",
        text: "Page one processed text.",
        sourceUri: "book.txt",
        page_start: 1,
        page_end: 1,
        vectorMetadata: { ctype: "text" },
        metadata: { title: "Book", sourceType: "text" },
        quality: { score: 98, lifecycle: "active" }
      }),
      JSON.stringify({
        kind: "knowmesh.sidecarChunk",
        document_id: "doc_other",
        chunk_id: "chunk_other",
        text: "Other document text.",
        sourceUri: "other.txt",
        page_start: 1,
        page_end: 1
      })
    ].join("\n"));

    const assetResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/asset?documentId=doc_book`);
    const asset = await assetResponse.json();

    assert.equal(assetResponse.status, 200);
    assert.equal(asset.ok, true);
    assert.equal(asset.knowledgeBaseId, kbId);
    assert.equal(asset.document.title, "Book");
    assert.equal(asset.summary.pages, 1);
    assert.equal(asset.summary.chunks, 1);
    assert.equal(asset.pages[0].text, "Page one processed text.");
  } finally {
    await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("local service exposes processed document assets from catalog pages without sidecar jsonl", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-document-asset-catalog-"));
  const userDataRoot = path.join(temp, "user-data");
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "book.txt"), "Original source", "utf8");
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Catalog 资料全文测试库", template: "general-docs" })
    });
    const created = await createResponse.json();
    const kbId = created.knowledgeBase.id;
    const versionRoot = path.join(workspaceRoot, "knowledge-bases", kbId, "versions", "v1");
    fs.mkdirSync(path.join(versionRoot, "manifests"), { recursive: true });
    const activeManifestPath = path.join(versionRoot, "manifests", "active-manifest.json");
    fs.writeFileSync(activeManifestPath, JSON.stringify({
      kind: "knowmesh.activeManifest",
      datasetVersionId: "v1",
      status: "active",
      generatedAt: new Date().toISOString()
    }, null, 2));
    writeCatalogReleaseFixture(userDataRoot, kbId, {
      buildId: "v1",
      manifestPath: activeManifestPath
    });
    writeCatalogPageBlockFixture(userDataRoot, kbId, {
      documentId: "doc_book",
      versionId: "ver_book",
      title: "Book",
      relativePath: "book.txt",
      text: "Catalog page one processed text."
    });

    const assetResponse = await fetch(`${service.url}/kb/${kbId}/api/documents/asset?documentId=doc_book`);
    const asset = await assetResponse.json();

    assert.equal(createResponse.status, 200);
    assert.equal(assetResponse.status, 200);
    assert.equal(asset.ok, true);
    assert.equal(asset.sidecar.status, "catalog");
    assert.equal(asset.summary.pages, 1);
    assert.equal(asset.summary.chunks, 1);
    assert.equal(asset.pages[0].text, "Catalog page one processed text.");
  } finally {
    await service.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
test("local service serves console sections as separate routes", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-console-routes-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const removedLegacyResponses = await Promise.all([
      "/environment",
      "/scan",
      "/configuration",
      "/execution",
      "/integration",
      "/api-docs",
      "/maintenance",
      "/documents",
      "/qa",
      "/use/qa"
    ].map((item) => fetch(`${service.url}${item}`, { redirect: "manual" })));
    const overviewResponse = await fetch(`${service.url}/overview`);
    const overviewPage = await overviewResponse.text();
    const knowledgeBasesResponse = await fetch(`${service.url}/knowledge-bases`);
    const knowledgeBasesPage = await knowledgeBasesResponse.text();
    const buildResponse = await fetch(`${service.url}/build`);
    const buildPage = await buildResponse.text();
    const executionResponse = await fetch(`${service.url}/build/execution`);
    const executionPage = await executionResponse.text();
    const integrationResponse = await fetch(`${service.url}/use/integration`);
    const integrationPage = await integrationResponse.text();
    const apiDocsResponse = await fetch(`${service.url}/use/api-docs`);
    const apiDocsPage = await apiDocsResponse.text();
    const maintenanceResponse = await fetch(`${service.url}/maintain/diagnostics`);
    const maintenancePage = await maintenanceResponse.text();
    const maintenanceExportResponse = await fetch(`${service.url}/api/maintenance/export`);
    const maintenanceExport = await maintenanceExportResponse.json();
    const versionsResponse = await fetch(`${service.url}/maintain/versions`);
    const versionsPage = await versionsResponse.text();
    const evaluationPageResponse = await fetch(`${service.url}/maintain/evaluation`);
    const evaluationPage = await evaluationPageResponse.text();
    const maintainFeedbackResponse = await fetch(`${service.url}/maintain/feedback`);
    const maintainFeedbackPage = await maintainFeedbackResponse.text();
    const versionsApiResponse = await fetch(`${service.url}/api/versions`);
    const versionsApi = await versionsApiResponse.json();
    const documentsResponse = await fetch(`${service.url}/maintain/documents`);
    const documentsPage = await documentsResponse.text();
    const askResponse = await fetch(`${service.url}/use/ask`);
    const askPage = await askResponse.text();
    const feedbackResponse = await fetch(`${service.url}/use/feedback`);
    const feedbackPage = await feedbackResponse.text();
    const cssResponse = await fetch(`${service.url}/web-console/styles.css`);
    const jsResponse = await fetch(`${service.url}/web-console/app.js`);
    const css = await cssResponse.text();
    const js = await jsResponse.text();

    for (const legacyResponse of removedLegacyResponses) {
      assert.equal(legacyResponse.status, 404);
    }
    assert.equal(overviewResponse.status, 200);
    assert.equal(knowledgeBasesResponse.status, 200);
    assert.equal(buildResponse.status, 200);
    assert.equal(executionResponse.status, 200);
    assert.equal(integrationResponse.status, 200);
    assert.equal(apiDocsResponse.status, 200);
    assert.equal(maintenanceResponse.status, 200);
    assert.equal(maintenanceExportResponse.status, 200);
    assert.match(maintenanceExportResponse.headers.get("content-disposition") || "", /knowmesh-diagnostics\.json/);
    assert.equal(maintenanceExport.kind, "knowmesh.maintenanceDiagnostics");
    assert.equal(maintenanceExport.privacy.redacted, true);
    assert.deepEqual(maintenanceExport.privacy.excludes, ["credentials", "apiKeys", "documentText", "sourceContent", "queryText", "answerText", "evaluationQuestions", "expectedAnswers"]);
    assert.equal(maintenanceExport.knowledgeBase.id, "kb-k12-all-subjects");
    assert.equal(maintenanceExport.foundation.phase, "phase1-architecture-foundation");
    assert.equal(maintenanceExport.foundation.stateStores.jsonStateRuntime, false);
    assert.equal(maintenanceExport.foundation.phase2.totalManifests, 6);
    assert.equal(versionsResponse.status, 200);
    assert.equal(evaluationPageResponse.status, 200);
    assert.equal(maintainFeedbackResponse.status, 200);
    assert.equal(versionsApiResponse.status, 200);
    assert.equal(versionsApi.ok, true);
    assert.equal(versionsApi.kind, "knowmesh.versionRecords");
    assert.equal(versionsApi.knowledgeBase.id, "kb-k12-all-subjects");
    assert.equal(documentsResponse.status, 200);
    assert.equal(askResponse.status, 200);
    assert.equal(feedbackResponse.status, 200);
    assert.match(overviewPage, /data-overview-status-panel/);
    assert.match(overviewPage, /data-workbench-flow="overview"/);
    assert.doesNotMatch(overviewPage, /data-setup-shortcuts/);
    assert.match(knowledgeBasesPage, /class="knowledge-base-manager"/);
    assert.match(knowledgeBasesPage, /K12全科知识库/);
    assert.match(knowledgeBasesPage, /data-knowledge-base-create/);
    assert.doesNotMatch(knowledgeBasesPage, /data-i18n="knowledgeBases.continueBuild"/);
    assert.doesNotMatch(knowledgeBasesPage, /data-i18n="knowledgeBases.openTask"/);
    assert.doesNotMatch(knowledgeBasesPage, /data-i18n="knowledgeBases.validate"/);
    assert.doesNotMatch(knowledgeBasesPage, /data-i18n="knowledgeBases.editSetup"/);
    assert.doesNotMatch(overviewPage, /class="knowledge-base-item"/);
    assert.doesNotMatch(overviewPage, /href="\/kb\/kb-k12-all-subjects\/setup\/aliyun\/credential"/);
    assert.match(buildPage, /data-build-workflow/);
    assert.match(buildPage, /data-build-flow-rail/);
    assert.match(buildPage, /class="use-knowledge-tabs build-knowledge-tabs"/);
    assert.match(executionPage, /class="use-knowledge-tabs build-knowledge-tabs"/);
    assert.doesNotMatch(buildPage, /class="setup-return-link" href="\/kb\/kb-k12-all-subjects\/setup\/mode"/);
    assert.match(buildPage, /data-build-result-summary="preview-scan"/);
    assert.match(buildPage, /data-build-result-summary="preview-run"/);
    assert.match(buildPage, /data-build-action="preview-scan"/);
    assert.match(buildPage, /data-build-action="preview-run"/);
    assert.match(buildPage, /data-build-open-result="preview-scan"/);
    assert.match(buildPage, /data-build-open-result="preview-run"/);
    assert.match(buildPage, /data-console-api-action="preview-scan"/);
    assert.match(buildPage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/scan\/preview"/);
    assert.match(buildPage, /data-console-api-action="preview-run"/);
    assert.match(buildPage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/plan\/preview"/);
    assert.doesNotMatch(buildPage, /data-nav-key="environment"/);
    assert.doesNotMatch(buildPage, /data-nav-key="configuration"/);
    assert.doesNotMatch(buildPage, /data-nav-key="scan"/);
    assert.match(maintenancePage, /诊断导出/);
    assert.match(overviewPage, /data-nav-section="maintain-knowledge"[\s\S]*维护知识库/);
    assert.doesNotMatch(overviewPage, /data-nav-key="documents"[\s\S]*资料清单/);
    assert.doesNotMatch(overviewPage, /data-nav-key="versions"[\s\S]*版本记录/);
    assert.doesNotMatch(overviewPage, /data-nav-key="feedback-review"[\s\S]*问答反馈/);
    assert.doesNotMatch(overviewPage, /data-nav-key="maintenance"[\s\S]*诊断导出/);
    assert.doesNotMatch(maintenancePage, /data-console-api-action="maintenance-status"/);
    assert.doesNotMatch(maintenancePage, /data-console-api-action="maintenance-update-preview"/);
    assert.doesNotMatch(maintenancePage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/maintenance\/update\/preview"/);
    assert.match(maintenancePage, /data-api-result="maintenance-status"/);
    assert.match(maintenancePage, /data-api-autoload="maintenance-status"/);
    assert.match(maintenancePage, /data-api-autoload-endpoint="\/kb\/kb-k12-all-subjects\/api\/maintenance\/status"/);
    assert.match(maintenancePage, /data-api-result="package-export-preview"/);
    assert.match(maintenancePage, /data-api-autoload="package-export-preview"/);
    assert.match(maintenancePage, /data-api-autoload-endpoint="\/kb\/kb-k12-all-subjects\/api\/package\/export\/preview"/);
    assert.match(maintenancePage, /href="\/kb\/kb-k12-all-subjects\/api\/maintenance\/export"/);
    assert.match(maintenancePage, /download="knowmesh-diagnostics\.json"/);
    assert.match(maintenancePage, /data-api-inline-result="true"/);
    assert.doesNotMatch(maintenancePage, /data-api-result="query-feedback-summary"/);
    assert.match(versionsPage, /class="version-records-panel"/);
    assert.match(versionsPage, /data-api-result="version-records"/);
    assert.match(versionsPage, /data-api-autoload="version-records"/);
    assert.match(versionsPage, /data-api-autoload-endpoint="\/kb\/kb-k12-all-subjects\/api\/versions"/);
    assert.match(evaluationPage, /class="evaluation-dashboard-panel"/);
    assert.match(evaluationPage, /data-api-result="evaluation-dashboard"/);
    assert.match(evaluationPage, /data-api-autoload="evaluation-dashboard"/);
    assert.match(evaluationPage, /data-api-autoload-endpoint="\/kb\/kb-k12-all-subjects\/api\/evaluation\/dashboard"/);
    assert.match(maintainFeedbackPage, /class="feedback-console-panel feedback-review-panel"/);
    assert.match(maintainFeedbackPage, /data-api-result="query-feedback-summary"/);
    assert.match(maintainFeedbackPage, /data-query-feedback-mode="review"/);
    assert.match(maintainFeedbackPage, /data-api-autoload-endpoint="\/kb\/kb-k12-all-subjects\/api\/query\/feedback\/summary"/);
    assert.match(js, /function autoLoadApiResults/);
    assert.doesNotMatch(askPage, /class="use-runtime-path"/);
    assert.match(askPage, /data-query-runtime-panel/);
    assert.match(askPage, /data-query-runtime-question/);
    assert.match(askPage, /data-query-runtime-run/);
    assert.match(askPage, /data-query-endpoint="\/kb\/kb-k12-all-subjects\/api\/query"/);
    assert.match(askPage, /data-query-feedback-endpoint="\/kb\/kb-k12-all-subjects\/api\/query\/feedback"/);
    assert.match(askPage, /href="\/kb\/kb-k12-all-subjects\/use\/integration"/);
    assert.match(askPage, /href="\/kb\/kb-k12-all-subjects\/use\/api-docs"/);
    assert.match(askPage, /href="\/kb\/kb-k12-all-subjects\/use\/feedback"/);
    assert.match(feedbackPage, /class="feedback-console-panel"/);
    assert.match(feedbackPage, /data-api-result="query-feedback-summary"/);
    assert.match(feedbackPage, /data-query-feedback-mode="records"/);
    assert.match(feedbackPage, /data-api-autoload="query-feedback-summary"/);
    assert.match(feedbackPage, /data-api-autoload-endpoint="\/kb\/kb-k12-all-subjects\/api\/query\/feedback\/summary"/);
    assert.match(integrationPage, /data-nav-section="use-knowledge"[\s\S]*使用知识库/);
    assert.match(integrationPage, /data-nav-key="integration"[\s\S]*接入向导/);
    assert.match(integrationPage, /class="use-knowledge-tabs"/);
    assert.match(integrationPage, /class="integration-console-panel integration-guide-panel"/);
    assert.match(integrationPage, /class="integration-flow-section"/);
    assert.match(integrationPage, /data-query-runtime-panel/);
    assert.match(integrationPage, /\/kb\/kb-k12-all-subjects\/api\/query/);
    assert.match(integrationPage, /Query Runtime/);
    assert.match(integrationPage, /href="\/kb\/kb-k12-all-subjects\/use\/api-docs"/);
    assert.doesNotMatch(integrationPage, /class="integration-code-section"/);
    assert.match(apiDocsPage, /data-nav-key="api-docs"[\s\S]*API 文档/);
    assert.match(apiDocsPage, /class="api-docs-console-panel"/);
    assert.match(apiDocsPage, /class="api-docs-endpoint-list"/);
    assert.match(apiDocsPage, /class="integration-contract-section"/);
    assert.match(apiDocsPage, /class="integration-code-section"/);
    assert.match(apiDocsPage, /\/kb\/kb-k12-all-subjects\/api\/query\/contract/);
    assert.doesNotMatch(apiDocsPage, /class="integration-endpoint-card/);
    assert.match(executionPage, /data-console-api-action="pause-latest-job"/);
    assert.match(executionPage, /data-console-api-action="resume-latest-job"/);
    assert.match(executionPage, /data-console-api-action="stop-latest-job"/);
    assert.match(executionPage, /data-console-api-action="run-latest-job"/);
    assert.match(executionPage, /data-job-action-mode="step"/);
    assert.match(executionPage, /data-job-action-mode="continuous"/);
    assert.match(executionPage, /class="route-chip"/);
    assert.match(executionPage, /class="route-chip-mark"/);
    assert.doesNotMatch(executionPage, /<div class="route-chip"[^>]*>\s*<svg class="icon"/);
    assert.doesNotMatch(js, /class="job-dashboard"/);
    assert.doesNotMatch(js, /class="job-primary-panel"/);
    assert.doesNotMatch(js, /class="job-secondary-panel"/);
    assert.doesNotMatch(js, /class="job-run-summary"/);
    assert.match(js, /class="job-pipeline"/);
    assert.match(js, /class="job-log-summary"/);
    assert.match(js, /class="job-log-summary-percent"/);
    assert.match(js, /class="job-log-summary-copy"/);
    assert.doesNotMatch(js, /class="job-skipped-flow"/);
    assert.doesNotMatch(js, /const executableTasks = tasks\.filter\(\(item\) => item\.status !== "skipped"\)/);
    assert.match(js, /const flowTasks = tasks;/);
    assert.doesNotMatch(js, /function jobHasUnfinishedCloudSteps/);
    assert.doesNotMatch(js, /function restoreBuildHandoffFromLatestJob/);
    assert.doesNotMatch(js, /createJobButton\.dataset\.forceMode = "aliyun"/);
    assert.match(js, /bindKnowledgeBaseLibrary/);
    assert.match(js, /\/api\/knowledge-bases\/current/);
    assert.match(js, /\/api\/knowledge-bases/);
    assert.match(js, /showPromptDialog/);
    assert.match(js, /job-log-current/);
    assert.match(js, /data-job-log-step/);
    assert.match(js, /function jobLogVisibleLimit/);
    assert.match(js, /const runningTaskKey = Array\.isArray\(job\?\.tasks\)/);
    assert.match(js, /return job\?\.status === "running" && batchTaskKeys\.has\(taskKey\) \? 50 : 30/);
    assert.match(js, /function renderJobLogHeader/);
    assert.match(js, /data-job-log-filter="current"/);
    assert.match(js, /function jobLogFilteredEvents/);
    assert.match(css, /\.job-log-filter/);
    assert.doesNotMatch(js, /\.slice\(-14\)/);
    assert.doesNotMatch(js, /\.slice\(0, 9\)/);
    assert.match(js, /<details class="job-artifacts" id="job-artifacts"[^>]*>/);
    assert.doesNotMatch(executionPage, /data-job-action-control="continue"/);
    assert.match(executionPage, /class="primary-action job-action-main" href="\/kb\/kb-k12-all-subjects\/use\/ask" data-job-action-control="ask"/);
    assert.doesNotMatch(executionPage, /href="#job-artifacts"/);
    assert.doesNotMatch(executionPage, /data-job-open-artifacts/);
    assert.doesNotMatch(js, /data-job-open-artifacts/);
    assert.doesNotMatch(js, /<strong>\$\{escapeHtml\(labels\.created\)\}/);
    assert.doesNotMatch(js, /<strong>\$\{escapeHtml\(labels\.updated\)\}/);
    assert.doesNotMatch(executionPage, /class="card-grid"/);
    assert.doesNotMatch(askPage, /class="card-grid"/);
    assert.doesNotMatch(maintenancePage, /class="card-grid"/);
    assert.doesNotMatch(knowledgeBasesPage, /默认知识库/);
    for (const contentPage of [overviewPage, knowledgeBasesPage, buildPage, executionPage, integrationPage, feedbackPage, maintenancePage, versionsPage, maintainFeedbackPage, documentsPage, askPage]) {
      assert.match(contentPage, /class="welcome-kb-selector knowledge-base-context"/);
      assert.doesNotMatch(contentPage, /data-i18n="knowledgeBases.contextLabel"/);
      assert.match(contentPage, /href="\/kb\/kb-k12-all-subjects\/knowledge-bases"/);
      assert.match(contentPage, /K12全科知识库/);
      assert.match(contentPage, /data-nav-section="overview"/);
      assert.match(contentPage, /data-nav-section="build-workflow"/);
      assert.match(contentPage, /data-nav-section="use-knowledge"/);
      assert.match(contentPage, /data-nav-section="maintain-knowledge"/);
      assert.match(contentPage, /class="work-page-head console-page-head"/);
      assert.match(contentPage, /data-page-help/);
      assert.match(contentPage, /class="work-page-note console-page-note"/);
      assert.match(contentPage, /data-console-page-note/);
      assert.doesNotMatch(contentPage, /class="page-hero"/);
      assert.doesNotMatch(contentPage, /class="hero-copy"/);
      assert.doesNotMatch(contentPage, /class="hero-panel"/);
      assert.doesNotMatch(contentPage, /<p class="lead"/);
      assert.doesNotMatch(contentPage, /data-nav-key="mode"/);
      assert.doesNotMatch(contentPage, /data-nav-key="templates"/);
      assert.doesNotMatch(contentPage, /data-nav-key="environment"/);
      assert.doesNotMatch(contentPage, /data-nav-key="configuration"/);
      assert.doesNotMatch(contentPage, /data-nav-key="scan"/);
    }
    for (const buildContentPage of [buildPage, executionPage]) {
      assert.match(buildContentPage, /class="use-knowledge-tabs build-knowledge-tabs"/);
      assert.match(buildContentPage, /data-nav-key="build"/);
      assert.match(buildContentPage, /data-nav-key="execution"/);
    }
    for (const useContentPage of [askPage, integrationPage, apiDocsPage, feedbackPage]) {
      assert.match(useContentPage, /class="use-knowledge-tabs"/);
      assert.match(useContentPage, /data-nav-key="ask"/);
      assert.match(useContentPage, /data-nav-key="integration"/);
      assert.match(useContentPage, /data-nav-key="api-docs"/);
      assert.match(useContentPage, /data-nav-key="feedback"/);
    }
    for (const maintainContentPage of [maintenancePage, versionsPage, maintainFeedbackPage, documentsPage]) {
      assert.match(maintainContentPage, /class="use-knowledge-tabs maintain-knowledge-tabs"/);
      assert.match(maintainContentPage, /data-nav-key="documents"/);
      assert.match(maintainContentPage, /data-nav-key="versions"/);
      assert.match(maintainContentPage, /data-nav-key="feedback-review"/);
      assert.match(maintainContentPage, /data-nav-key="maintenance"/);
    }
    assert.equal(cssResponse.status, 200);
    assert.equal(jsResponse.status, 200);
    assert.match(css, /\.overview-status-panel\s*\{/);
    assert.match(css, /\.integration-console-panel\s*\{/);
    assert.match(css, /\.integration-code-grid\s*\{/);
    assert.match(css, /\.knowledge-base-item\[data-current="true"\]/);
    assert.match(css, /\.knowledge-base-current\s*\{/);
    assert.match(css, /\.knowledge-base-manager\s*\{/);
    assert.match(css, /\.knowledge-base-manager-actions\s*\{/);
    assert.match(css, /\.work-page-head \{[\s\S]*height: 48px;[\s\S]*min-height: 48px;[\s\S]*max-height: 48px;/);
    assert.match(css, /\.work-page-head h1 \{[\s\S]*font-size: var\(--text-lg\);/);
    assert.match(css, /\.route-chip\s*{[\s\S]*pointer-events: none;/);
    assert.match(css, /\.route-chip-mark/);
    assert.match(css, /\.topbar-left\s*\{/);
    assert.match(css, /\.knowledge-base-context\s*\{/);
    assert.match(css, /\.welcome-kb-selector\.knowledge-base-context/);
    assert.doesNotMatch(css, /\.knowledge-base-context-current/);
    assert.match(css, /\.work-page-title-row/);
    assert.match(css, /\.work-page-help summary/);
    assert.match(css, /\.work-page-note \{[\s\S]*position: absolute;/);
    assert.doesNotMatch(css, /\.page-hero/);
    assert.doesNotMatch(css, /\.hero-copy/);
    assert.doesNotMatch(css, /\.hero-panel/);
    assert.match(css, /data-preference-hydrating="true"/);
    assert.doesNotMatch(css, /--result-slot-height/);
    assert.match(css, /\.api-result \{[\s\S]*height: var\(--api-status-height\);/);
    assert.match(css, /\.api-result-open/);
    assert.match(css, /\.result-dialog-content/);
    assert.match(css, /\.api-result-detail/);
    assert.match(css, /\.setup-task-brief/);
    assert.match(css, /\.aliyun-step-guide/);
    assert.match(css, /\.api-result-findings/);
    assert.match(css, /\.api-result-remediation/);
    assert.match(css, /\.api-remediation-location/);
    assert.match(css, /\.api-result-passed-checks/);
    assert.doesNotMatch(css, /\.api-result-overview/);
    assert.match(css, /\.draft-field-section/);
    assert.match(css, /\.draft-field-row/);
    assert.match(css, /\.project-setup/);
    assert.match(css, /\.project-path-grid/);
    assert.match(css, /\.setup-panel--project/);
    assert.match(css, /\.folder-dropzone/);
    assert.match(css, /\.folder-dropzone-actions/);
    assert.match(css, /\.folder-path-entry/);
    assert.doesNotMatch(css, /\.folder-browser-dialog/);
    assert.doesNotMatch(css, /\.folder-browser-layout/);
    assert.doesNotMatch(css, /\.folder-browser-list/);
    assert.doesNotMatch(css, /\.folder-picker-overlay/);
    assert.match(css, /\.folder-picker-result/);
    assert.match(css, /\.folder-result-open/);
    assert.doesNotMatch(css, /\.folder-picker-result\.detail/);
    assert.doesNotMatch(css, /\.path-precheck-stats/);
    assert.doesNotMatch(css, /\.template-decision-grid/);
    assert.doesNotMatch(css, /\.template-rule-list/);
    assert.match(css, /\.template-choice-setup/);
    assert.match(css, /\.template-library--setup/);
    assert.match(css, /\.template-choice-status/);
    assert.match(css, /\.readiness-panel/);
    assert.doesNotMatch(css, /\.scan-preview-grid/);
    assert.match(css, /\.scan-result-stack/);
    assert.match(css, /\.scan-result-summary/);
    assert.match(css, /\.scan-result-section/);
    assert.match(js, /scan-result-stack/);
    assert.match(css, /\.scan-issue-groups/);
    assert.match(css, /\.scan-issue-group/);
    assert.match(css, /\.setup-config-summary/);
    assert.doesNotMatch(css, /\.setup-gate-action/);
    assert.match(css, /\.setup-field-gate-result/);
    assert.match(css, /\.setup-gate-message/);
    assert.match(css, /\.api-fix-card/);
    assert.match(css, /\.job-console-actions/);
    assert.doesNotMatch(css, /\.job-flow-map/);
    assert.doesNotMatch(css, /\.job-step-detail/);
    assert.match(css, /\.job-pipeline/);
    assert.match(css, /\.job-log-current/);
    assert.match(css, /\.job-log-stream/);
    assert.match(css, /\.job-log-summary\s*{[\s\S]*min-height: 40px;/);
    assert.match(css, /\.job-log-summary-percent/);
    assert.match(css, /\.job-log-summary-copy/);
    assert.match(css, /\.job-log-stream li\[data-log-kind="event"\]/);
    assert.match(css, /\.job-log-heartbeat/);
    assert.match(js, /normalizeJobEvents/);
    assert.match(js, /renderJobEventLine/);
    assert.match(js, /renderJobHeartbeatLogLine/);
    assert.match(css, /--job-action-bar-height:\s*58px/);
    assert.doesNotMatch(executionPage, /class="api-result job-api-result"/);
    assert.match(executionPage, /class="job-api-result"/);
    assert.match(js, /className = `job-api-result \$\{status\}`/);
    assert.match(js, /const preserveJobConsole = jobResultUsesInline\(resultNode, actionKey\) && currentJobSnapshot && status !== "pass"/);
    assert.match(js, /renderJobApiResultContent\(\{ ok: true, job: currentJobSnapshot \}, "latest-job"\)/);
    assert.doesNotMatch(js, /visible\.add\("continue"\)/);
    assert.match(js, /const canClickWhileWorking = state === "working" && \["pause", "stop"\]\.includes\(key\);/);
    assert.doesNotMatch(js, /\["waiting", "running"\]\.includes\(status\)/);
    assert.match(js, /startJobActionPolling/);
    assert.match(js, /stopJobActionPolling/);
    assert.match(js, /class="job-result-detail/);
    assert.match(css, /\.job-api-result\s*{[\s\S]*height: auto;/);
    assert.match(css, /\.job-api-result\s*{[\s\S]*display: block;/);
    assert.match(css, /\.job-api-result > \.job-result-detail\s*{[\s\S]*height: auto;/);
    assert.match(css, /\.job-execution-shell\s*{[\s\S]*display: block;/);
    assert.match(css, /\.job-execution-shell\s*{[\s\S]*padding-bottom: calc\(var\(--job-action-bar-height\) \+ 20px\)/);
    assert.match(css, /\.job-execution-shell::after\s*{[\s\S]*height: calc\(var\(--job-action-bar-height\) \+ 20px\)/);
    assert.match(css, /\.job-action-bar\s*{[\s\S]*min-height: var\(--job-action-bar-height\)/);
    assert.doesNotMatch(css, /\.job-progress-grid/);
    assert.match(css, /\.job-artifact-list/);
    assert.match(css, /\.job-artifacts summary/);
    assert.doesNotMatch(css, /\.job-task-actions/);
    assert.match(css, /\.job-test-result/);
    assert.match(css, /\.job-filter-preview/);
    assert.match(css, /\.cloud-confirmation/);
    assert.match(css, /\.ask-console-panel/);
    assert.match(css, /\.feedback-console-panel/);
    assert.match(css, /\.use-knowledge-tabs/);
    assert.match(css, /\.query-runtime-result/);
    assert.match(css, /\.query-runtime-result-citations/);
    assert.match(css, /\.query-runtime-feedback/);
    assert.match(css, /overflow-x: hidden/);
    assert.match(css, /min-width: var\(--sidebar-collapsed\)/);
    assert.match(css, /transition: none/);
    assert.match(css, /flex-wrap: wrap/);
    assert.match(css, /\.maintenance-console-panel/);
    assert.match(css, /\.maintenance-status-grid/);
    assert.match(css, /\.maintenance-diagnostics/);
    assert.match(css, /\.maintenance-update-gate/);
    assert.match(css, /\.maintenance-template-contract/);
    assert.match(css, /\.maintenance-progress-card/);
    assert.doesNotMatch(css, /\.maintenance-next-actions/);
    assert.doesNotMatch(css, /\.maintenance-card-list/);
    assert.match(css, /\.api-result\.api-result--inline\.fail/);
    assert.match(css, /\.maintenance-contract-action/);
    assert.match(js, /maintenance-update-index/);
    assert.match(js, /maintenance-update-state/);
    assert.match(js, /maintenance-update-copy/);
    assert.match(css, /\.maintenance-update-index/);
    assert.match(css, /\.maintenance-update-state/);
    assert.match(css, /\.maintenance-update-copy/);
    assert.doesNotMatch(css, /\.maintenance-update-gate li::before/);
    assert.doesNotMatch(js, /maintenance-diagnostics[\s\S]{0,2200}item\.href/);
    assert.match(js, /backdropReady/);
    assert.match(js, /if \(!backdropReady\) return/);
    assert.match(css, /\.draft-save-state\[data-status="saving"\]/);
    assert.match(css, /\.api-result\[hidden\]/);
    assert.match(css, /visibility: hidden/);
    assert.match(js, /renderJobFlowMap/);
    assert.doesNotMatch(js, /renderJobStepDetail/);
    assert.match(js, /renderJobLogStream/);
    assert.match(js, /refreshJobActionAvailability/);
    assert.match(js, /jobCanValidateKnowledge/);
    assert.match(js, /syncCompletedJobActionPriority/);
    assert.match(js, /data-job-step-button/);
    assert.match(js, /finishPreferenceHydration/);
    assert.match(js, /root\.style\.colorScheme = settings\.theme/);
    assert.match(js, /initializeOverflowTooltips/);
    assert.match(js, /MutationObserver\(scheduleOverflowTooltips\)/);
    assert.match(js, /node\.scrollWidth > node\.clientWidth \+ 1/);
    assert.match(js, /node\.dataset\.overflowTitle = "true"/);
    assert.doesNotMatch(js, /knowmesh\.mode/);
    assert.doesNotMatch(js, /knowmesh\.template/);
    assert.doesNotMatch(js, /knowmesh\.setup\.draft/);
    assert.doesNotMatch(js, /knowmesh\.setup\.results/);
    assert.doesNotMatch(js, /knowmesh\.setup\.completed/);
    assert.doesNotMatch(js, /knowmesh\.setup\.finished/);
    assert.match(js, /setupProgress = new Set\(\)/);
    assert.match(js, /setupActionResults = \{\}/);
    assert.match(js, /handleFolderDrop/);
    assert.match(js, /runSystemFolderPicker/);
    assert.match(js, /showFolderPathDialog/);
    assert.match(js, /folderResultState/);
    assert.match(js, /data-folder-result-open/);
    assert.match(js, /data-folder-dropzone/);
    assert.doesNotMatch(js, /showFolderPickerOverlay/);
    assert.doesNotMatch(js, /hideFolderPickerOverlay/);
    assert.doesNotMatch(js, /renderPathPrecheck/);
    assert.doesNotMatch(js, /browseLocalFolders/);
    assert.doesNotMatch(js, /createFolderFromBrowser/);
    assert.match(js, /renderApiResultFindings/);
    assert.match(js, /renderCheckRemediation/);
    assert.match(js, /renderRemediationLocation/);
    assert.match(js, /renderPassedChecks/);
    assert.doesNotMatch(js, /renderApiResultOverview/);
    assert.match(js, /updateApiStatusLine/);
    assert.match(js, /showApiResultDialog/);
    assert.match(js, /data-api-result-open/);
    assert.match(js, /showToast\(apiResultToastMessage/);
    assert.doesNotMatch(js, /resultNode\.innerHTML = `\$\{overview\}/);
    assert.match(js, /applyAliyunGuides/);
    assert.match(js, /bindFolderPickers/);
    assert.match(js, /runPathPrecheck/);
    assert.match(js, /renderPreScanPanel/);
    assert.match(js, /renderScanIssues/);
    assert.match(js, /renderScanIssueGroups/);
    assert.match(js, /applyConfigSummary/);
    assert.doesNotMatch(js, /renderSelectedTemplateCommercialRules/);
    assert.match(js, /ensureSetupStepCanComplete/);
    assert.match(js, /requiredSetupActionForStep/);
    assert.match(js, /missingRequiredSetupFields/);
    assert.match(js, /save-aliyun-credentials/);
    assert.match(js, /preview-aliyun-services/);
    assert.match(js, /isApiResultClear/);
    assert.match(js, /data-rerun-setup-action/);
    assert.doesNotMatch(js, /renderJobProgress/);
    assert.match(js, /renderJobArtifacts/);
    assert.doesNotMatch(js, /renderJobTaskActions/);
    assert.match(js, /renderJobTestResult/);
    assert.match(js, /renderJobFilterPreview/);
    assert.match(js, /renderCloudConfirmation/);
    assert.match(js, /bindQueryRuntimePanels/);
    assert.match(js, /renderQueryRuntimeResult/);
    assert.match(js, /renderMaintenanceStatus/);
    assert.match(js, /renderMaintenanceDiagnostics/);
    assert.match(js, /renderMaintenanceUpdateGate/);
    assert.match(js, /rerenderVisibleApiResults/);
    assert.match(js, /showConfirmDialog/);
    assert.match(js, /showAlertDialog/);
    assert.match(js, /showPromptDialog/);
    assert.match(js, /showToast/);
    assert.doesNotMatch(js, /window\.confirm/);
    assert.match(js, /data-query-runtime-question/);
    assert.match(js, /collectDraftFields\(\{ includeSensitive: false \}\)/);
    assert.match(js, /restoreSetupProgressFromServer/);
    assert.match(js, /inferCompletedSetupSteps/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes guided setup before mode-specific checks", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-guided-setup-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const modeResponse = await fetch(`${service.url}/setup/mode`);
    const modePage = await modeResponse.text();
    const modeCssResponse = await fetch(`${service.url}/web-console/styles.css`);
    const modeCss = await modeCssResponse.text();
    const accountResponse = await fetch(`${service.url}/setup/aliyun/account`);
    const accountPage = await accountResponse.text();
    const credentialResponse = await fetch(`${service.url}/setup/aliyun/credential`);
    const credentialPage = await credentialResponse.text();
    const storageResponse = await fetch(`${service.url}/setup/aliyun/storage`);
    const storagePage = await storageResponse.text();
    const servicesResponse = await fetch(`${service.url}/setup/aliyun/services`);
    const servicesPage = await servicesResponse.text();
    const modelQualityResponse = await fetch(`${service.url}/setup/aliyun/model-quality`);
    const modelQualityPage = await modelQualityResponse.text();
    const searchResponse = await fetch(`${service.url}/setup/aliyun/search`);
    const searchPage = await searchResponse.text();
    const templateResponse = await fetch(`${service.url}/setup/template`);
    const templatePage = await templateResponse.text();
    const retrievalResponse = await fetch(`${service.url}/setup/retrieval`);
    const retrievalPage = await retrievalResponse.text();
    const projectResponse = await fetch(`${service.url}/setup/project`);
    const projectPage = await projectResponse.text();
    const environmentResponse = await fetch(`${service.url}/setup/environment`);
    const environmentPage = await environmentResponse.text();
    const scanResponse = await fetch(`${service.url}/setup/scan`);
    const scanPage = await scanResponse.text();
    const planResponse = await fetch(`${service.url}/setup/plan`);
    const planPage = await planResponse.text();
    const finishResponse = await fetch(`${service.url}/setup/finish`);
    const finishPage = await finishResponse.text();

    assert.equal(modeResponse.status, 200);
    assert.equal(modeCssResponse.status, 200);
    assert.match(modePage, /选择资料处理方式/);
    assert.match(modePage, /这会决定后面需要连接哪些服务/);
    assert.match(modePage, /资料在哪里完成识别、清洗和检索/);
    assert.doesNotMatch(modePage, /先选择这次怎么运行/);
    assert.match(modePage, /data-mode-option="aliyun"/);
    assert.match(modePage, /data-mode-option="local"/);
    assert.match(modePage, /class="setup-panel-scroll"/);
    assert.match(modePage, /class="work-page-head setup-page-head"/);
    assert.match(modePage, /data-page-help/);
    assert.match(modePage, /class="work-page-note setup-page-note"/);
    assert.match(modePage, /data-setup-page-note/);
    assert.match(modePage, /步骤[\s\S]*1[\s\S]*\/[\s\S]*7[\s\S]*选择运行方式/);
    assert.doesNotMatch(modePage, /<p class="lead"/);
    assert.match(modePage, /data-setup-action-bar/);
    assert.match(modePage, /适合大批量资料和长期使用/);
    assert.match(modePage, /适合先试跑或资料不出本机/);
    assert.match(modePage, /需要准备/);
    assert.match(modePage, /选择阿里云模式/);
    assert.match(modePage, /选择本地模式/);
    assert.match(modePage, /class="mode-choice-panel"/);
    assert.equal((modePage.match(/class="mode-choice-card"/g) || []).length, 2);
    assert.match(modePage, /data-mode-choice-hint/);
    assert.match(modePage, /涉及上传、创建资源或写入数据的动作，都会在执行前再次确认/);
    assert.doesNotMatch(modePage, /<aside class="setup-task-help"/);
    assert.doesNotMatch(modePage, /class="mode-strip"/);
    assert.match(modePage, /data-setup-complete="mode"/);
    assert.doesNotMatch(modePage, /data-setup-config-summary/);
    assert.doesNotMatch(modePage, /data-summary-mode/);
    assert.doesNotMatch(modePage, /data-summary-step/);
    assert.equal((modePage.match(/data-setup-complete="mode"/g) || []).length, 1);
    assert.match(modePage, /"templates":/);
    assert.match(modePage, /"setupDraftPanels":/);
    assert.match(modePage, /"setupTaskBriefs":/);
    assert.match(modePage, /"setupAliyunGuides":/);
    assert.doesNotMatch(modePage, /"setupApiResultGuides":/);
    assert.match(modePage, /"projectDraftSections":/);
    assert.match(modePage, /"setupGroups":/);
    assert.match(modePage, /data-setup-group-wrapper="aliyun"/);
    assert.match(modePage, /data-setup-group-link="aliyun"/);
    assert.match(modePage, /class="setup-group-steps"/);
    assert.match(modePage, /"key":"aliyun-storage"[\s\S]*"key":"aliyun-services"[\s\S]*"key":"aliyun-model-quality"[\s\S]*"key":"aliyun-search"/);
    assert.match(modePage, /class="setup-step-number">2\.4<\/span>[\s\S]*保存位置/);
    assert.match(modePage, /class="setup-step-number">2\.5<\/span>[\s\S]*模型服务/);
    assert.match(modePage, /class="setup-step-number">2\.6<\/span>[\s\S]*模型方案/);
    assert.match(modePage, /class="setup-step-number">2\.7<\/span>[\s\S]*知识检索/);
    assert.match(modePage, /"key":"template"[\s\S]*"key":"retrieval"[\s\S]*"key":"project"/);
    assert.match(modePage, /class="setup-step-number">3\.2<\/span>[\s\S]*问答效果/);
    assert.doesNotMatch(templatePage, /data-setup-config-summary/);
    assert.match(modePage, /class="setup-step-number">2\.1<\/span>/);
    assert.match(modePage, /"key":"aliyun-credential"/);
    assert.match(modePage, /"scope":"aliyun"/);
    assert.match(modeCss, /\.setup-layout[\s\S]*width: 100%/);
    assert.match(modeCss, /\.setup-layout[\s\S]*max-width: none/);
    assert.match(modeCss, /body \{[\s\S]*overflow: hidden;/);
    assert.match(modeCss, /\.setup-shell \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*overflow: hidden;/);
    assert.match(modeCss, /\.setup-layout \{[\s\S]*height: 100%;[\s\S]*overflow: hidden;/);
    assert.match(modeCss, /\.setup-rail \{[\s\S]*overflow: auto;/);
    assert.match(modeCss, /\.setup-panel-scroll \{[\s\S]*overflow: auto;/);
    assert.match(modeCss, /\.work-page-head \{[\s\S]*height: 48px;[\s\S]*min-height: 48px;[\s\S]*max-height: 48px;/);
    assert.match(modeCss, /\.work-page-head h1 \{[\s\S]*font-size: var\(--text-lg\);/);
    assert.match(modeCss, /\.work-page-title-row/);
    assert.match(modeCss, /\.work-page-help summary/);
    assert.match(modeCss, /\.work-page-note \{[\s\S]*position: absolute;/);
    assert.match(modeCss, /\.setup-actions \{[\s\S]*position: sticky;[\s\S]*bottom: 0;/);
    assert.match(modeCss, /\.app-shell \{[\s\S]*height: 100dvh;[\s\S]*overflow: hidden;/);
    assert.match(modeCss, /\.page-shell \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*overflow: hidden;/);
    assert.match(modeCss, /\.content \{[\s\S]*overflow: auto;/);
    assert.match(modeCss, /\.nav-list \{[\s\S]*overflow: auto;/);
    assert.match(modeCss, /\.setup-panel--mode/);
    assert.match(modeCss, /\.mode-decision/);
    assert.match(modeCss, /\.mode-choice-card[\s\S]*min-height: 360px/);
    assert.match(modeCss, /\.mode-choice-fit[\s\S]*min-height: 38px/);
    assert.match(modeCss, /\.mode-choice-body[\s\S]*min-height: 84px/);
    assert.match(modeCss, /\.mode-choice-detail[\s\S]*min-height: 88px/);
    assertNoFixedHeight(modeCss, ".mode-choice-card");
    assertNoFixedHeight(modeCss, ".mode-choice-fit");
    assertNoFixedHeight(modeCss, ".mode-choice-body");
    assertNoFixedHeight(modeCss, ".mode-choice-detail");
    assert.equal(accountResponse.status, 200);
    assert.match(accountPage, /你准备用哪个阿里云账号/);
    assert.match(accountPage, /选择你现在最容易完成的连接方式/);
    assert.match(accountPage, /class="work-page-head setup-page-head"/);
    assert.match(accountPage, /data-page-help/);
    assert.match(accountPage, /class="work-page-note setup-page-note"/);
    assert.match(accountPage, /data-setup-page-note/);
    assert.doesNotMatch(accountPage, /<p class="lead"/);
    assert.match(accountPage, /data-draft-field="aliyun\.account\.method"/);
    assert.match(accountPage, /class="account-method-panel"/);
    assert.equal((accountPage.match(/class="account-method-card"/g) || []).length, 3);
    assert.match(accountPage, /使用专用 RAM 用户/);
    assert.match(accountPage, /检测本机配置/);
    assert.match(accountPage, /查看创建指引/);
    assert.match(accountPage, /你需要准备/);
    assert.match(accountPage, /接下来会做什么/);
    assert.match(accountPage, /一个只给 KnowMesh 使用的 RAM 用户和 AccessKey/);
    assert.match(accountPage, /先测试连接，测试通过后再保存凭证/);
    assert.doesNotMatch(accountPage, /后续影响/);
    assert.equal((accountPage.match(/data-account-method-card/g) || []).length, 3);
    assert.match(accountPage, /data-account-selected-action/);
    assert.match(accountPage, /data-account-dedicated-next="\/kb\/kb-k12-all-subjects\/setup\/aliyun\/credential"/);
    assert.match(accountPage, /data-account-check-endpoint="\/kb\/kb-k12-all-subjects\/api\/aliyun\/identity\/check"/);
    assert.match(accountPage, /data-account-success-next="\/kb\/kb-k12-all-subjects\/setup\/aliyun\/permissions"/);
    assert.match(accountPage, /data-account-failure-next="\/kb\/kb-k12-all-subjects\/setup\/aliyun\/credential"/);
    assert.doesNotMatch(accountPage, /data-account-method-action/);
    assert.doesNotMatch(accountPage, /data-account-action-kind/);
    assert.doesNotMatch(accountPage, /class="account-method-action"/);
    assert.match(accountPage, /data-account-method-result/);
    assert.match(accountPage, /data-account-creation-guide/);
    assert.match(accountPage, /data-account-guide-continue/);
    assert.doesNotMatch(accountPage, /account-method-cta/);
    assert.doesNotMatch(accountPage, /data-account-next-action/);
    assert.doesNotMatch(accountPage, /data-setup-config-summary/);
    assert.doesNotMatch(accountPage, /data-setup-task-brief="aliyun-account"/);
    assert.doesNotMatch(accountPage, /data-aliyun-step-guide="aliyun-account"/);
    assert.doesNotMatch(accountPage, /<aside class="setup-task-help"/);
    assert.doesNotMatch(accountPage, /data-field-gate-panel="aliyun-account"/);
    assert.match(modeCss, /\.setup-panel--account/);
    assert.match(modeCss, /\.account-method-card[\s\S]*min-height: 360px/);
    assert.match(modeCss, /\.account-method-card[\s\S]*padding: 20px/);
    assert.doesNotMatch(modeCss, /\.account-method-action/);
    assert.match(modeCss, /\.account-method-stage[\s\S]*max-height: 240px/);
    assert.match(modeCss, /\.account-method-body[\s\S]*min-height: 72px/);
    assert.match(modeCss, /\.account-method-impact[\s\S]*min-height: 96px/);
    assertNoFixedHeight(modeCss, ".account-method-card");
    assertNoFixedHeight(modeCss, ".account-method-fit");
    assertNoFixedHeight(modeCss, ".account-method-body");
    assertNoFixedHeight(modeCss, ".account-method-impact");

    const appJs = fs.readFileSync(path.join(projectRoot, "src", "web-console", "app.js"), "utf8");
    assert.doesNotMatch(appJs, /completeAccountStepAndNavigate/);
    assert.doesNotMatch(appJs, /runAccountMethodAction/);
    assert.match(appJs, /runSelectedAccountAction/);
    assert.match(appJs, /completeAccountStepsAndNavigate\("aliyun-account"/);
    assert.equal(credentialResponse.status, 200);
    assert.match(credentialPage, /填写阿里云连接凭证/);
    assert.match(credentialPage, /粘贴专用 RAM 用户的 AccessKey/);
    assert.match(credentialPage, /class="work-page-head setup-page-head"/);
    assert.match(credentialPage, /data-page-help/);
    assert.match(credentialPage, /class="work-page-note setup-page-note"/);
    assert.match(credentialPage, /data-setup-page-note/);
    assert.doesNotMatch(credentialPage, /<p class="lead"/);
    assert.match(credentialPage, /data-setup-step-link="aliyun-credential"/);
    assert.match(credentialPage, /class="setup-group-step-link active"/);
    assert.match(credentialPage, /class="setup-step-number">2\.2<\/span>/);
    assert.match(credentialPage, /data-credential-setup/);
    assert.match(credentialPage, /data-credential-current-method/);
    assert.match(credentialPage, /当前选择/);
    assert.match(credentialPage, /使用专用 RAM 用户/);
    assert.match(credentialPage, /data-draft-field="aliyun\.credential\.accessKeyId"/);
    assert.match(credentialPage, /data-draft-sensitive="true"/);
    assert.match(credentialPage, /data-credential-advanced-toggle/);
    assert.match(credentialPage, /高级保存方式/);
    assert.match(credentialPage, /data-credential-secure-path/);
    assert.match(credentialPage, /aliyun-credential\.json/);
    assert.match(credentialPage, /data-credential-env-path/);
    assert.match(credentialPage, /\.env/);
    assert.match(credentialPage, /data-copy-local-path="credential-secure"/);
    assert.match(credentialPage, /data-open-local-path="credential-directory"/);
    assert.match(credentialPage, /data-copy-local-path="project-env"/);
    assert.match(credentialPage, /data-open-local-path="project-env-directory"/);
    assert.match(credentialPage, /data-app-dialog-root/);
    assert.match(credentialPage, /data-toast-region/);
    assert.match(credentialPage, /同时写入项目 \.env 文件/);
    assert.doesNotMatch(credentialPage, /保存到哪里/);
    assert.doesNotMatch(credentialPage, /读取已有环境变量/);
    assert.doesNotMatch(credentialPage, /data-setup-task-brief="aliyun-credential"/);
    assert.doesNotMatch(credentialPage, /data-task-brief="aliyun-credential\.guard"/);
    assert.doesNotMatch(credentialPage, /data-aliyun-step-guide="aliyun-credential"/);
    assert.doesNotMatch(credentialPage, /data-aliyun-guide="aliyun-credential\.fix"/);
    assert.doesNotMatch(credentialPage, /data-setup-config-summary/);
    assert.doesNotMatch(credentialPage, /class="setup-api-buttons"/);
    assert.match(credentialPage, /data-setup-api-source="footer"/);
    assert.match(credentialPage, /data-setup-api-action="save-aliyun-credentials"/);
    assert.match(credentialPage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/setup\/aliyun\/credentials\/check"/);
    assert.doesNotMatch(credentialPage, /data-setup-footer-test="save-aliyun-credentials"/);
    assert.match(credentialPage, /class="setup-tool-action setup-tool-action--danger"[^>]*data-setup-api-action="clear-aliyun-credentials"[^>]*data-requires-saved-credential/);
    assert.match(credentialPage, /class="setup-tool-action setup-tool-action--primary"[^>]*data-setup-api-action="save-aliyun-credentials"/);
    assert.match(credentialPage, /data-setup-api-action="save-aliyun-credentials"[^>]*>测试凭证<\/button>/);
    assert.match(credentialPage, /data-setup-complete="aliyun-credential"[^>]*data-setup-requires-passed-action="save-aliyun-credentials"[^>]*disabled/);
    assert.doesNotMatch(credentialPage, /data-confirm-body-zh="KnowMesh 会把凭证保存到本机/);
    assert.equal((credentialPage.match(/>测试凭证<\/button>/g) || []).length, 1);
    assert.doesNotMatch(credentialPage, /保存并测试连接/);
    assert.match(credentialPage, /测试连接/);
    assert.match(credentialPage, /保存凭证/);
    assert.doesNotMatch(credentialPage, /data-credential-secret-state/);
    assert.doesNotMatch(credentialPage, /Secret 已保存/);
    assert.match(appJs, /showSavedCredentialResult/);
    assert.doesNotMatch(credentialPage, /data-credential-check-existing/);
    assert.doesNotMatch(credentialPage, />本机检测<\/button>/);
    assert.doesNotMatch(credentialPage, /data-setup-api-action="check-existing-aliyun-config"/);
    assert.doesNotMatch(credentialPage, />检测配置<\/button>/);
    assert.doesNotMatch(credentialPage, /检测已有本机配置/);
    assert.match(credentialPage, /data-setup-api-action="clear-aliyun-credentials"/);
    assert.match(credentialPage, /data-api-method="DELETE"/);
    assert.match(credentialPage, />清除凭证<\/button>/);
    assert.equal((credentialPage.match(/>清除凭证<\/button>/g) || []).length, 1);
    assert.doesNotMatch(credentialPage, /清除本机凭证/);
    assert.match(modeCss, /\.setup-panel--credential/);
    assertNoFixedHeight(modeCss, ".work-page-head h1");
    assertNoFixedHeight(modeCss, ".work-page-note");
    assert.match(modeCss, /\.credential-setup/);
    assert.match(modeCss, /\.app-dialog-backdrop/);
    assert.match(modeCss, /\.toast-region/);
    assert.match(modeCss, /\[hidden\]\s*{\s*display: none !important;/);
    const dialogCss = modeCss.match(/\.app-dialog\s*{([\s\S]*?)}/)?.[1] || "";
    const dialogBodyCss = modeCss.match(/\.app-dialog-body\s*{([\s\S]*?)}/)?.[1] || "";
    assert.match(dialogCss, /max-height: min\(680px, calc\(100dvh - 48px\)\);/);
    assert.match(dialogCss, /overflow: hidden;/);
    assert.match(dialogCss, /display: flex;/);
    assert.match(dialogCss, /flex-direction: column;/);
    assert.match(dialogBodyCss, /flex: 1 1 auto;/);
    assert.match(dialogBodyCss, /min-height: 0;/);
    assert.match(dialogBodyCss, /max-height: none;/);
    assert.match(dialogBodyCss, /overscroll-behavior: contain;/);
    assert.match(modeCss, /\.app-dialog-body[\s\S]*scrollbar-width: none/);
    assert.match(modeCss, /\.app-dialog-body::-webkit-scrollbar[\s\S]*width: 0/);
    assert.doesNotMatch(dialogBodyCss, /scrollbar-gutter/);
    assert.doesNotMatch(modeCss, /\.app-dialog-body:is\(:hover, :focus-within\)/);
    assert.match(modeCss, /\.app-dialog-actions\s*{[\s\S]*flex: 0 0 auto;/);
    assert.match(modeCss, /\.app-dialog-backdrop\[data-dialog-kind="result"\] \.app-dialog\s*{[\s\S]*max-height: min\(760px, calc\(100dvh - 48px\)\);/);
    assert.match(modeCss, /\.result-dialog-content\s*{[\s\S]*min-height: 0;/);
    assert.match(modeCss, /\.credential-path-actions/);
    assert.match(modeCss, /\.credential-setup-grid[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 380px\), 1fr\)\)/);
    assert.match(modeCss, /\.credential-advanced:not\(\[open\]\) > :not\(summary\)[\s\S]*display: none !important/);
    assert.doesNotMatch(modeCss, /\.credential-form-card \.setup-api-action[\s\S]*min-height: 148px/);
    assert.match(modeCss, /\.setup-tool-action--primary/);
    assert.match(modeCss, /\.setup-nav-action/);
    assert.match(modeCss, /\.credential-test-summary/);
    assert.doesNotMatch(appJs, /draftState\[`\$\{key\}\.configured`\] = true/);
    assert.match(appJs, /draftState\[`\$\{key\}\.pending`\] = true/);
    assert.match(appJs, /selectAliyunCredentialTestRequest/);
    assert.match(appJs, /function credentialInputState\(\)/);
    assert.match(appJs, /const input = credentialInputState\(\);[\s\S]*if \(input\.hasCurrentInput\)/);
    assert.match(appJs, /input\.hasCurrentInput \? input\.accessKeyId/);
    assert.match(appJs, /else clearSavedCredentialState\(\)/);
    assert.match(appJs, /renderCredentialSaveSummary/);
    assert.doesNotMatch(appJs, /showCredentialSavePrompt\(data, actionKey\)[\s\S]*renderApiResultContent\(data, actionKey\)/);
    assert.equal(storageResponse.status, 200);
    assert.match(storagePage, /配置云端保存位置/);
    assert.match(storagePage, /data-storage-setup/);
    assert.match(storagePage, /资料保存空间/);
    assert.match(storagePage, /OSS 向量 Bucket/);
    assert.match(storagePage, /data-draft-field="aliyun\.region"/);
    assert.match(storagePage, /data-draft-field="aliyun\.storage\.bucket"/);
    assert.match(storagePage, /data-draft-field="aliyun\.search\.storageMode"/);
    assert.match(storagePage, /data-draft-field="aliyun\.search\.region"/);
    assert.match(storagePage, /data-draft-field="aliyun\.search\.bucket"/);
    assert.match(storagePage, /data-generate-bucket-name="source"/);
    assert.match(storagePage, /data-generate-bucket-name="vector"/);
    assert.match(storagePage, /data-setup-api-action="preview-aliyun-storage"/);
    assert.doesNotMatch(storagePage, /data-setup-task-brief="aliyun-storage"/);
    assert.doesNotMatch(storagePage, /data-aliyun-guide="aliyun-storage\.check"/);
    assert.doesNotMatch(storagePage, /data-setup-api-action="prepare-aliyun-storage-create"/);
    assert.doesNotMatch(storagePage, /真正创建仍默认关闭/);
    assert.match(storagePage, /data-setup-complete="aliyun-storage"[^>]*data-setup-requires-passed-action="preview-aliyun-storage"[^>]*disabled/);
    assert.match(appJs, /runAliyunStorageConfirmFlow/);
    assert.match(appJs, /actionKey === "preview-aliyun-storage"/);
    assert.match(appJs, /\/api\/aliyun\/storage\/create/);
    assert.match(appJs, /storage\?\.confirmed/);
    assert.match(appJs, /创建并保存/);
    assert.equal(servicesResponse.status, 200);
    assert.match(servicesPage, /连接阿里百炼/);
    assert.match(servicesPage, /先把模型服务接通/);
    assert.match(servicesPage, /先验证模型服务是否可用/);
    assert.match(servicesPage, /确认当前地域和接口地址可以正常连接/);
    assert.doesNotMatch(servicesPage, /后续增加其它供应商/);
    assert.doesNotMatch(servicesPage, /未来供应商/);
    assert.match(servicesPage, /data-model-provider-setup/);
    assert.doesNotMatch(servicesPage, /model-provider-field-block/);
    assert.doesNotMatch(servicesPage, /model-provider-section-copy/);
    assert.match(servicesPage, /data-draft-field="aliyun\.model\.provider"/);
    assert.match(servicesPage, /data-draft-field="aliyun\.model\.protocol"/);
    assert.match(servicesPage, /data-draft-field="aliyun\.model\.region"/);
    assert.match(servicesPage, /data-draft-field="aliyun\.model\.baseUrl"/);
    assert.match(servicesPage, /data-draft-field="aliyun\.model\.apiKey"/);
    assert.match(servicesPage, /data-model-provider-secure-path/);
    assert.match(servicesPage, /aliyun-model-provider\.json/);
    assert.match(servicesPage, /data-model-provider-location-toggle/);
    assert.match(servicesPage, /class="credential-advanced model-provider-location-toggle"/);
    assert.doesNotMatch(servicesPage, /data-model-provider-key-state/);
    assert.doesNotMatch(servicesPage, /class="model-provider-key-note"/);
    assert.match(servicesPage, /model-provider-hint-strip[\s\S]*API Key 只保存在本机[\s\S]*新加坡或德国地域需要 Workspace ID/);
    assert.doesNotMatch(servicesPage, /data-draft-field="aliyun\.model\.testModel"/);
    assert.doesNotMatch(servicesPage, /data-draft-label="aliyun\.model\.testModel"/);
    assert.match(servicesPage, /data-api-result="test-aliyun-model-provider"/);
    assert.match(servicesPage, /data-setup-api-action="test-aliyun-model-provider"/);
    assert.match(servicesPage, />测试连接<\/button>/);
    assert.match(appJs, /runModelProviderTestFlow/);
    assert.match(appJs, /showSavedModelProviderResult/);
    assert.match(appJs, /已保存本机凭证/);
    assert.match(appJs, /\/api\/setup\/aliyun\/model-provider/);
    assert.match(servicesPage, /data-setup-complete="aliyun-services"[^>]*data-setup-requires-passed-action="test-aliyun-model-provider"[^>]*disabled/);
    assert.doesNotMatch(servicesPage, /data-setup-task-brief="aliyun-services"/);
    assert.doesNotMatch(servicesPage, /data-aliyun-step-guide="aliyun-services"/);
    assert.doesNotMatch(servicesPage, /class="setup-task-help"/);
    assert.doesNotMatch(servicesPage, /data-model-quality-profile-grid/);
    assert.doesNotMatch(servicesPage, /模型服务授权/);
    assert.equal(modelQualityResponse.status, 200);
    assert.match(modelQualityPage, /模型与质量方案/);
    assert.match(modelQualityPage, /选择这次知识库的处理质量/);
    assert.match(modelQualityPage, /data-model-quality-setup/);
    assert.match(modelQualityPage, /data-model-catalog-toolbar/);
    assert.match(modelQualityPage, /data-refresh-model-catalog/);
    assert.match(modelQualityPage, /aria-label="刷新模型列表"/);
    assert.doesNotMatch(modelQualityPage, />刷新模型列表<\/button>/);
    assert.doesNotMatch(modelQualityPage, />使用本地内置推荐<\/button>/);
    assert.match(modelQualityPage, /data-model-catalog-state/);
    assert.match(modelQualityPage, /模型列表：本地推荐/);
    assert.match(modelQualityPage, /data-model-catalog-help/);
    assert.match(modelQualityPage, /data-model-quality-profile-grid/);
    assert.doesNotMatch(modelQualityPage, /model-quality-profile-block/);
    assert.doesNotMatch(modelQualityPage, /model-quality-field-block/);
    assert.doesNotMatch(modelQualityPage, /model-quality-section-copy/);
    assert.match(modelQualityPage, /data-model-quality-profile-card="recommended"/);
    assert.match(modelQualityPage, /data-model-quality-profile-card="high-quality"/);
    assert.match(modelQualityPage, /data-model-quality-profile-card="low-cost"/);
    assert.match(modelQualityPage, /推荐配置/);
    assert.match(modelQualityPage, /高质量配置/);
    assert.match(modelQualityPage, /低成本配置/);
    assert.doesNotMatch(modelQualityPage, /<option value="" data-i18n="setup\.selectPlaceholder">请选择<\/option>/);
    assert.doesNotMatch(modelQualityPage, /skip-now|稍后补齐|稍后配置|关闭重排/);
    assert.match(modelQualityPage, /type="hidden"[^>]*data-draft-field="aliyun\.services\.profile"/);
    assert.doesNotMatch(modelQualityPage, /<select[^>]*data-draft-field="aliyun\.services\.profile"/);
    assert.doesNotMatch(modelQualityPage, /data-draft-field="aliyun\.services\.authorization"/);
    assert.doesNotMatch(modelQualityPage, /data-model-quality-context-strip/);
    assert.match(modelQualityPage, /data-model-slot="ocr"/);
    assert.match(modelQualityPage, /data-model-slot="organizer"/);
    assert.match(modelQualityPage, /data-model-slot="embedding"/);
    assert.match(modelQualityPage, /data-model-slot="rerank"/);
    assert.match(modelQualityPage, /data-draft-field="aliyun\.services\.ocr"/);
    assert.doesNotMatch(modelQualityPage, /data-draft-label="aliyun\.services\.ocr"/);
    assert.match(modelQualityPage, /qwen-vl-ocr-2025-11-20（推荐）/);
    assert.doesNotMatch(modelQualityPage, /Qwen OCR 当前快照/);
    assert.match(modelQualityPage, /data-draft-field="aliyun\.services\.organizer"/);
    assert.doesNotMatch(modelQualityPage, /data-draft-label="aliyun\.services\.organizer"/);
    assert.match(modelQualityPage, /qwen-plus/);
    assert.match(modelQualityPage, /qwen-max/);
    assert.match(modelQualityPage, /data-draft-field="aliyun\.services\.embedding"/);
    assert.doesNotMatch(modelQualityPage, /data-draft-label="aliyun\.services\.embedding"/);
    assert.match(modelQualityPage, /text-embedding-v4/);
    assert.match(modelQualityPage, /qwen3-vl-embedding/);
    assert.match(modelQualityPage, /tongyi-embedding-vision-flash-2026-03-06/);
    assert.match(modelQualityPage, /data-draft-field="aliyun\.services\.rerank"/);
    assert.doesNotMatch(modelQualityPage, /data-draft-label="aliyun\.services\.rerank"/);
    assert.match(modelQualityPage, /qwen3-rerank/);
    assert.match(modelQualityPage, /qwen3-vl-rerank/);
    assert.doesNotMatch(modelQualityPage, /gte-rerank/);
    assert.doesNotMatch(modelQualityPage, /data-model-slot-purpose/);
    assert.doesNotMatch(modelQualityPage, /<p class="draft-save-state"[^>]*>已保存在本机浏览器/);
    assert.match(modelQualityPage, /提高问答命中/);
    assert.match(modelQualityPage, /会增加少量延迟和模型调用费用/);
    assert.match(modelQualityPage, /data-model-slot-actions="ocr"/);
    assert.match(modelQualityPage, /aria-label="模型详情"/);
    assert.match(modelQualityPage, /aria-label="价格"/);
    assert.doesNotMatch(modelQualityPage, />模型详情<\/a>/);
    assert.doesNotMatch(modelQualityPage, />价格<\/a>/);
    assert.match(modelQualityPage, /data-model-quality-hint-strip/);
    assert.doesNotMatch(modelQualityPage, /model-quality-side-notes/);
    assert.match(modelQualityPage, /data-api-result="save-aliyun-model-quality"/);
    assert.match(modelQualityPage, /data-setup-api-action="save-aliyun-model-quality"/);
    assert.match(modelQualityPage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/setup\/aliyun\/model-quality"/);
    assert.match(modelQualityPage, />保存模型方案<\/button>/);
    assert.match(appJs, /showSavedModelQualityResult/);
    assert.match(modelQualityPage, /data-setup-complete="aliyun-model-quality"[^>]*data-setup-requires-passed-action="save-aliyun-model-quality"[^>]*disabled/);
    assert.doesNotMatch(modelQualityPage, /data-api-result="preview-aliyun-model-quality"/);
    assert.doesNotMatch(modelQualityPage, /data-setup-api-action="preview-aliyun-model-quality"/);
    assert.doesNotMatch(modelQualityPage, /data-setup-task-brief="aliyun-model-quality"/);
    assert.doesNotMatch(modelQualityPage, /class="setup-task-help"/);
    assert.equal(searchResponse.status, 200);
    assert.match(searchPage, /设置知识库索引/);
    assert.match(searchPage, /模型与质量方案已经在上一步确认/);
    assert.match(searchPage, /data-search-setup/);
    assert.match(searchPage, /data-search-primary-card/);
    assert.doesNotMatch(searchPage, /data-search-context-strip/);
    assert.match(searchPage, /data-search-model-note/);
    assert.match(searchPage, /data-draft-field="aliyun\.search\.action"/);
    assert.match(searchPage, /data-draft-field="aliyun\.search\.index"/);
    assert.doesNotMatch(searchPage, /<p class="draft-save-state"[^>]*>已保存在本机浏览器/);
    assert.match(searchPage, /data-api-result="save-aliyun-search"/);
    assert.match(searchPage, /data-setup-api-action="save-aliyun-search"/);
    assert.match(searchPage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/setup\/aliyun\/search"/);
    assert.match(searchPage, />保存索引配置<\/button>/);
    assert.match(appJs, /showSavedSearchResult/);
    assert.match(searchPage, /data-setup-complete="aliyun-search"[^>]*data-setup-requires-passed-action="save-aliyun-search"[^>]*disabled/);
    assert.doesNotMatch(searchPage, /preview-aliyun-search/);
    assert.doesNotMatch(searchPage, /data-setup-task-brief="aliyun-search"/);
    assert.doesNotMatch(searchPage, /data-aliyun-step-guide="aliyun-search"/);
    assert.doesNotMatch(searchPage, /class="setup-task-help"/);
    assert.doesNotMatch(searchPage, /生成检索位置确认/);
    assert.doesNotMatch(searchPage, /OSS 向量 Bucket 已在保存位置页确认。/);
    assert.match(modeCss, /\.search-setup/);
    assert.match(modeCss, /\.search-primary-card/);
    assert.doesNotMatch(modeCss, /\.search-context-strip/);
    assert.match(modeCss, /\.search-api-result/);
    assert.match(modeCss, /\.search-setup[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(280px, 360px\)/);
    assert.match(modeCss, /\.search-api-result\s*{[\s\S]*min-height: 0;/);
    assert.match(modeCss, /\.model-quality-setup/);
    assert.match(modeCss, /\.retrieval-setup/);
    assert.match(modeCss, /\.model-provider-setup/);
    assert.match(modeCss, /\.model-provider-form-card/);
    assert.match(cssRule(modeCss, ".model-provider-form"), /padding: 0;/);
    assert.match(cssRule(modeCss, ".model-provider-form"), /border: 0;/);
    assert.match(cssRule(modeCss, ".model-provider-form"), /background: transparent;/);
    assert.match(modeCss, /\.model-provider-hint-strip/);
    assert.match(modeCss, /\.model-quality-profile-grid/);
    assert.match(modeCss, /\.retrieval-profile-grid/);
    assert.match(modeCss, /\.retrieval-method-list/);
    assert.match(modeCss, /\.model-quality-primary-card,\s*\.retrieval-primary-card\s*{[\s\S]*padding: 0;/);
    assert.match(modeCss, /\.model-quality-primary-card,\s*\.retrieval-primary-card\s*{[\s\S]*border: 0;/);
    assert.match(modeCss, /\.model-quality-primary-card,\s*\.retrieval-primary-card\s*{[\s\S]*background: transparent;/);
    assert.match(modeCss, /\.model-quality-form,\s*\.retrieval-form\s*{[\s\S]*padding: 0;/);
    assert.match(modeCss, /\.model-quality-form,\s*\.retrieval-form\s*{[\s\S]*border: 0;/);
    assert.match(modeCss, /\.model-quality-form,\s*\.retrieval-form\s*{[\s\S]*background: transparent;/);
    assert.match(cssRule(modeCss, ".model-slot-detail"), /padding: 0;/);
    assert.match(cssRule(modeCss, ".model-slot-detail"), /border: 0;/);
    assert.match(cssRule(modeCss, ".model-slot-detail"), /background: transparent;/);
    assert.doesNotMatch(modeCss, /\.model-quality-profile-block/);
    assert.doesNotMatch(modeCss, /\.model-quality-field-block/);
    assert.match(modeCss, /\.model-slot-grid/);
    assert.match(modeCss, /\.model-slot-card/);
    assert.match(modeCss, /\.model-catalog-toolbar/);
    assert.match(cssRule(modeCss, ".model-catalog-refresh"), /width: 34px;/);
    assert.match(cssRule(modeCss, ".model-catalog-help p"), /background: var\(--popover-surface\);/);
    assert.doesNotMatch(cssRule(modeCss, ".model-catalog-help p"), /surface-elevated/);
    assert.match(modeCss, /\.model-slot-actions/);
    assert.match(modeCss, /\.model-slot-icon-link/);
    assert.match(modeCss, /\.visually-hidden/);
    assert.match(modeCss, /\.model-quality-hint-strip/);
    assert.match(modeCss, /\.retrieval-hint-strip/);
    assert.match(modeCss, /\.model-quality-api-result\s*{[\s\S]*min-height: 0;/);
    assert.match(modeCss, /\.retrieval-api-result\s*{[\s\S]*min-height: 0;/);
    assert.match(appJs, /actionKey === "save-aliyun-search"/);
    assert.match(appJs, /applyModelProviderContext/);
    assert.match(appJs, /refreshModelCatalog/);
    assert.match(appJs, /autoRefreshModelCatalog/);
    assert.match(appJs, /modelCatalogAutoRefreshStarted/);
    assert.match(appJs, /applyModelQualityModelCards/);
    assert.doesNotMatch(appJs, /skip-now/);
    const legacyRegionResponse = await fetch(`${service.url}/setup/aliyun/region`);
    const legacyRegionPage = await legacyRegionResponse.text();
    assert.equal(legacyRegionResponse.status, 200);
    assert.match(legacyRegionPage, /配置云端保存位置/);
    assert.doesNotMatch(legacyRegionPage, /选择资料保存位置/);
    const permissionsResponse = await fetch(`${service.url}/setup/aliyun/permissions`);
    const permissionsPage = await permissionsResponse.text();
    assert.equal(permissionsResponse.status, 200);
    assert.match(permissionsPage, /data-setup-api-action="copy-aliyun-policy"/);
    assert.match(permissionsPage, /data-permission-check-panel/);
    assert.match(permissionsPage, /data-permission-primary-action/);
    assert.match(permissionsPage, /data-permission-fix-hint/);
    assert.doesNotMatch(permissionsPage, /data-permission-fix-note/);
    assert.match(permissionsPage, /检查阿里云账号是否可用/);
    assert.match(permissionsPage, /data-permission-scope="identity"[\s\S]*阿里云连接/);
    assert.match(permissionsPage, /data-permission-scope="ram"[\s\S]*专用 RAM 用户/);
    assert.match(permissionsPage, /data-permission-scope="storage"[\s\S]*保存空间读取/);
    assert.doesNotMatch(permissionsPage, /data-permission-scope="search"/);
    assert.doesNotMatch(permissionsPage, /data-permission-scope="services"/);
    assert.equal((permissionsPage.match(/data-permission-scope-status/g) || []).length, 3);
    assert.match(permissionsPage, /data-permission-status="pending"/);
    assert.match(permissionsPage, /data-permission-result-status[^>]*data-api-result="check-aliyun-permissions"/);
    assert.doesNotMatch(permissionsPage, /data-permission-result-zone/);
    assert.doesNotMatch(permissionsPage, /data-permission-result-hint/);
    assert.doesNotMatch(permissionsPage, /data-permission-result-slot/);
    assert.match(permissionsPage, /data-setup-api-action="check-aliyun-permissions"[^>]*>检查账号<\/button>/);
    assert.match(permissionsPage, /data-setup-complete="aliyun-permissions"[^>]*data-setup-requires-passed-action="check-aliyun-permissions"[^>]*disabled/);
    assert.match(permissionsPage, /data-setup-api-action="copy-aliyun-policy"[^>]*>生成权限清单<\/button>/);
    assert.doesNotMatch(permissionsPage, /data-setup-footer-test="check-aliyun-permissions"/);
    assert.doesNotMatch(permissionsPage, /data-setup-draft-panel="aliyun-permissions"/);
    assert.doesNotMatch(permissionsPage, /data-setup-task-brief="aliyun-permissions"/);
    assert.doesNotMatch(permissionsPage, /data-aliyun-step-guide="aliyun-permissions"/);
    assert.doesNotMatch(permissionsPage, /data-draft-field="aliyun\.permissions\.mode"/);
    assert.doesNotMatch(permissionsPage, /class="setup-task-help"/);
    assert.doesNotMatch(permissionsPage, /permission-side-card/);
    assert.doesNotMatch(permissionsPage, /permission-fix-panel/);
    assert.doesNotMatch(permissionsPage, /权限处理/);
    assert.doesNotMatch(permissionsPage, /生成最小权限清单/);
    assert.match(modeCss, /\.permission-check/);
    assert.match(modeCss, /\.permission-action-card/);
    assert.match(modeCss, /\.permission-check[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    assert.match(modeCss, /\.permission-fix-hint[\s\S]*grid-template-columns: 64px 110px minmax\(0, 1fr\) auto/);
    assert.match(modeCss, /\.permission-scope-status/);
    assert.match(modeCss, /\.permission-api-result/);
    const permissionResultCss = modeCss.match(/\.permission-api-result\s*{([\s\S]*?)}/)?.[1] || "";
    assert.doesNotMatch(permissionResultCss, /display:\s*none\s*!important/);
    assert.match(modeCss, /--success:\s*#22c55e/);
    assert.match(modeCss, /\.permission-scope-status\[data-permission-status="pass"\][\s\S]*var\(--success/);
    assert.match(modeCss, /\.api-result\.pass[\s\S]*var\(--success/);
    assert.match(modeCss, /\.setup-nav-action--continue:disabled[\s\S]*cursor:\s*not-allowed/);
    assert.doesNotMatch(modeCss, /\.permission-result-zone/);
    assert.doesNotMatch(modeCss, /\.permission-result-hint/);
    assert.doesNotMatch(modeCss, /\.permission-result-slot/);
    assert.doesNotMatch(modeCss, /\.permission-fix-note/);
    assert.doesNotMatch(modeCss, /\.permission-side-card/);
    assert.doesNotMatch(modeCss, /\.permission-fix-panel/);
    assert.match(appJs, /function updatePermissionScopeStatuses/);
    assert.match(appJs, /function resetPermissionScopeStatuses/);
    assert.match(appJs, /fail:\s*"未通过"/);
    assert.match(appJs, /data-setup-requires-passed-action/);
    assert.match(appJs, /function refreshSetupContinueState/);
    assert.match(appJs, /function setupRequiredActionPassed/);
    assert.doesNotMatch(appJs, /if \(options\.showDialog !== false && contentHtml\) showApiResultDialog\(resultNode\)/);
    assert.match(appJs, /key === "credential" \|\| key === "identity"\) return \["identity"\]/);
    assert.match(appJs, /if \(key === "ramUser"\) return \["ram"\]/);
    assert.match(appJs, /if \(key === "ossListBuckets"\) return \["storage"\]/);
    assert.equal(templateResponse.status, 200);
    assert.match(templatePage, /setup-panel--template/);
    assert.match(templatePage, /data-template-choice-setup/);
    assert.match(templatePage, /class="template-library template-library--setup"/);
    assert.match(templatePage, /data-selected-template-choice/);
    assert.match(templatePage, /data-template-choice-next/);
    assert.match(templatePage, /模板库 v1\.2\.0/);
    assert.match(templatePage, /当前模板 v1\.2\.0/);
    assert.match(templatePage, /data-template-library-version/);
    assert.match(templatePage, /data-template-contract-version/);
    assert.doesNotMatch(templatePage, /data-setup-task-brief="template"/);
    assert.doesNotMatch(templatePage, /class="setup-task-help"/);
    assert.doesNotMatch(templatePage, /data-setup-config-summary/);
    assert.doesNotMatch(templatePage, /data-selected-template-panel/);
    assert.doesNotMatch(templatePage, /template-detail-grid/);
    assert.doesNotMatch(templatePage, /template-decision-grid/);
    assert.doesNotMatch(templatePage, /data-selected-template-fields/);
    assert.doesNotMatch(templatePage, /data-selected-template-filters/);
    assert.doesNotMatch(templatePage, /data-selected-template-source/);
    assert.doesNotMatch(templatePage, /data-selected-template-chunking-strategy/);
    assert.doesNotMatch(templatePage, /data-selected-template-quality-gates/);
    assert.doesNotMatch(templatePage, /data-selected-template-acceptance/);
    assert.equal(retrievalResponse.status, 200);
    assert.match(retrievalPage, /setup-panel--retrieval/);
    assert.match(retrievalPage, /问答效果策略/);
    assert.match(retrievalPage, /用户提问时怎么找到正确资料/);
    assert.match(retrievalPage, /data-retrieval-setup/);
    assert.match(retrievalPage, /data-retrieval-profile-grid/);
    assert.match(retrievalPage, /data-retrieval-profile-card="balanced"/);
    assert.match(retrievalPage, /data-retrieval-profile-card="coverage"/);
    assert.match(retrievalPage, /data-retrieval-profile-card="precision"/);
    assert.match(retrievalPage, /data-retrieval-profile-card="low-cost"/);
    assert.match(retrievalPage, /data-draft-field="retrieval\.profile"/);
    assert.match(retrievalPage, /data-retrieval-advanced/);
    assert.match(retrievalPage, /问题改写/);
    assert.match(retrievalPage, /混合检索/);
    assert.match(retrievalPage, /引用校验/);
    assert.match(retrievalPage, /data-api-result="save-retrieval-strategy"/);
    assert.match(retrievalPage, /data-setup-api-action="save-retrieval-strategy"/);
    assert.match(retrievalPage, /data-api-endpoint="\/kb\/kb-k12-all-subjects\/api\/setup\/retrieval-strategy"/);
    assert.match(retrievalPage, />保存问答策略<\/button>/);
    assert.match(retrievalPage, /data-setup-complete="retrieval"[^>]*data-setup-requires-passed-action="save-retrieval-strategy"[^>]*disabled/);
    assert.doesNotMatch(retrievalPage, /class="setup-task-help"/);
    assert.doesNotMatch(retrievalPage, /data-setup-task-brief="retrieval"/);
    assert.equal(projectResponse.status, 200);
    assert.match(projectPage, /setup-panel--project/);
    assert.match(projectPage, /data-project-setup/);
    assert.match(projectPage, /class="project-path-grid"/);
    assert.match(projectPage, /data-project-field-section="source"/);
    assert.match(projectPage, /data-project-field-section="workspace"/);
    assert.match(projectPage, /data-project-field-section="metadata"/);
    assert.match(projectPage, /data-folder-picker="source"/);
    assert.match(projectPage, /data-folder-picker="workspace"/);
    assert.match(projectPage, /data-folder-dropzone="source"/);
    assert.match(projectPage, /data-folder-dropzone="workspace"/);
    assert.match(projectPage, /data-folder-use-path="source"/);
    assert.match(projectPage, /data-folder-use-path="workspace"/);
    assert.match(projectPage, /data-path-precheck="source"/);
    assert.match(projectPage, /data-project-section-title="source"[\s\S]*资料目录/);
    assert.match(projectPage, /data-project-section-title="workspace"[\s\S]*工作目录/);
    assert.doesNotMatch(projectPage, /data-draft-label="project\.source"/);
    assert.doesNotMatch(projectPage, /data-draft-label="project\.workspace"/);
    assert.equal(fs.existsSync(path.join(projectRoot, "source")), true);
    assert.equal(fs.existsSync(path.join(projectRoot, "workspace")), true);
    assert.match(projectPage, new RegExp(`value="${escapeRegExp(path.join(projectRoot, "source"))}"`));
    assert.match(projectPage, new RegExp(`value="${escapeRegExp(path.join(projectRoot, "workspace"))}"`));
    assert.match(projectPage, /<section class="draft-field-section source-scope-section"[^>]*data-source-scope/);
    assert.match(projectPage, /<div class="source-scope-status"[^>]*data-source-scope-status/);
    assert.match(projectPage, /还差：学段、学科、年级/);
    assert.match(projectPage, /data-source-scope-step="metadata\.stage"/);
    assert.match(projectPage, /data-source-scope-step="metadata\.subject"/);
    assert.match(projectPage, /data-source-scope-step="metadata\.grade"/);
    assert.match(projectPage, /data-source-scope-extra/);
    assert.match(projectPage, /<summary[^>]*>补充信息/);
    assert.match(projectPage, /data-draft-field="metadata\.stage"/);
    assert.doesNotMatch(projectPage, /<select data-draft-field="metadata\.stage">/);
    assert.match(projectPage, /data-k12-range-field="metadata\.stage"/);
    assert.match(projectPage, /data-k12-range-field="metadata\.subject"/);
    assert.match(projectPage, /data-k12-range-field="metadata\.grade"/);
    assert.match(projectPage, /data-k12-range-field="metadata\.volume"/);
    assert.match(projectPage, /data-k12-select-all="metadata\.stage"[^>]*>全学段/);
    assert.match(projectPage, /data-k12-preset="core"/);
    assert.match(projectPage, /data-k12-preset="science"/);
    assert.match(projectPage, /data-k12-select-all="metadata\.grade"[^>]*>全部年级/);
    assert.match(projectPage, /data-k12-option-stages="初中 高中"[^>]*data-k12-option="物理"/);
    assert.doesNotMatch(projectPage, /data-k12-option-stages="小学[^"]*"[^>]*data-k12-option="物理"/);
    assert.doesNotMatch(projectPage, /<small>可多选<\/small>/);
    assert.match(projectPage, /data-setup-complete="project"[^>]*data-setup-requires-fields="true"[^>]*disabled/);
    assert.match(projectPage, /class="api-result setup-field-gate-result"[^>]*data-field-gate-panel="project"/);
    assert.doesNotMatch(projectPage, /填写完成后点击继续确认本步/);
    assert.doesNotMatch(projectPage, /data-folder-browser-dialog/);
    assert.doesNotMatch(projectPage, /data-folder-browser-list/);
    assert.doesNotMatch(projectPage, /data-folder-browser-create/);
    assert.match(projectPage, /data-folder-picker-result="project"/);
    assert.doesNotMatch(projectPage, /data-folder-picker-overlay/);
    assert.doesNotMatch(projectPage, /系统目录选择已打开/);
    assert.doesNotMatch(projectPage, /拖入资料文件夹/);
    assert.match(projectPage, /选择资料文件夹/);
    assert.match(projectPage, /选择工作目录/);
    assert.doesNotMatch(projectPage, /选择资料文件夹，或粘贴路径/);
    assert.doesNotMatch(projectPage, /选择工作目录，或粘贴路径/);
    assert.doesNotMatch(projectPage, /data-setup-task-brief="project"/);
    assert.doesNotMatch(projectPage, /class="setup-task-help"/);
    assert.doesNotMatch(projectPage, /data-setup-config-summary/);
    assert.doesNotMatch(projectPage, /class="setup-checklist"/);
    assert.doesNotMatch(projectPage, /data-draft-checklist="project"/);
    assert.doesNotMatch(projectPage, /data-i18n="setup\.draftLocal"/);
    assert.match(environmentPage, /开始扫描前检查/);
    assert.match(environmentPage, /处理前检查/);
    assert.match(environmentPage, /只确认能否进入扫描预览/);
    assert.doesNotMatch(environmentPage, /检查这次需要准备什么/);
    assert.doesNotMatch(environmentPage, /准备度检查/);
    assert.doesNotMatch(environmentPage, /本机运行环境/);
    assert.match(environmentPage, /data-setup-step-workspace="environment"/);
    assert.match(environmentPage, /data-step-workspace-result="check-environment"/);
    assert.doesNotMatch(environmentPage, /data-setup-task-brief="environment"/);
    assert.doesNotMatch(environmentPage, /class="setup-task-help"/);
    assert.doesNotMatch(environmentPage, /data-mode-i18n="setup.steps.environment.modes.\{mode\}.lead"/);
    assert.doesNotMatch(environmentPage, /class="setup-checklist"/);
    assert.doesNotMatch(environmentPage, /class="setup-api-action"/);
    assert.match(environmentPage, /data-setup-group-link="mode"/);
    assert.match(environmentPage, /data-setup-api-action="check-environment"/);
    assert.match(environmentPage, /data-setup-complete="environment"[^>]*data-setup-requires-passed-action="check-environment"[^>]*disabled/);
    assert.equal(scanResponse.status, 200);
    assert.match(scanPage, /data-setup-step-workspace="scan"/);
    assert.match(scanPage, /data-step-workspace-result="preview-scan"/);
    assert.doesNotMatch(scanPage, /data-setup-task-brief="scan"/);
    assert.doesNotMatch(scanPage, /class="setup-task-help"/);
    assert.doesNotMatch(scanPage, /class="setup-api-action"/);
    assert.doesNotMatch(scanPage, /class="setup-checklist"/);
    assert.doesNotMatch(scanPage, /data-setup-roadmap="scan"/);
    assert.doesNotMatch(scanPage, /data-roadmap-stage="chunk"/);
    assert.equal(planResponse.status, 200);
    assert.match(planPage, /data-setup-step-workspace="plan"/);
    assert.match(planPage, /data-step-workspace-result="preview-run"/);
    assert.match(planPage, /data-plan-preview-empty/);
    assert.doesNotMatch(planPage, /data-setup-roadmap="plan"/);
    assert.doesNotMatch(planPage, /data-roadmap-stage="embedding"/);
    assert.match(planPage, /先生成本次计划/);
    assert.match(planPage, /data-setup-api-action="preview-run"/);
    assert.match(planPage, /生成本次计划/);
    assert.match(planPage, /data-setup-complete="plan"[^>]*data-setup-requires-passed-action="preview-run"[^>]*disabled/);
    assert.doesNotMatch(planPage, /data-setup-task-brief="plan"/);
    assert.doesNotMatch(planPage, /class="setup-task-help"/);
    assert.doesNotMatch(planPage, /class="setup-api-action"/);
    assert.doesNotMatch(planPage, /class="setup-checklist"/);
    assert.equal(finishResponse.status, 200);
    assert.match(finishPage, /data-setup-step-workspace="finish"/);
    assert.match(finishPage, /准备好了，可以开始使用/);
    assert.match(finishPage, /data-setup-finish="true"/);
    assert.doesNotMatch(finishPage, /data-setup-task-brief="finish"/);
    assert.doesNotMatch(finishPage, /class="setup-task-help"/);
    assert.doesNotMatch(finishPage, /class="setup-api-action"/);
    assert.doesNotMatch(finishPage, /class="setup-checklist"/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes pre-scan checks and confirmation previews", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-preview-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const sourcePath = path.join(userDataRoot, "source");
    const workspacePath = path.join(userDataRoot, "workspace");
    fs.cpSync(path.join(projectRoot, "examples", "local-demo", "documents"), sourcePath, { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "policy-note.txt"),
      [
        "Policy note",
        "12",
        "The onboarding page is https://example.com/start and should become metadata.",
        "ACCESS_KEY_SECRET=demo-secret-value",
        "Keep this business rule as normal body text."
      ].join("\n"),
      "utf8"
    );
    const retrievalSaveResponse = await fetch(`${service.url}/api/setup/retrieval-strategy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "retrieval.profile": "balanced"
        }
      })
    });
    const retrievalSaved = await retrievalSaveResponse.json();
    const retrievalStateResponse = await fetch(`${service.url}/api/setup/state`);
    const retrievalState = await retrievalStateResponse.json();
    const environmentResponse = await fetch(`${service.url}/api/environment/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath,
          "metadata.stage": "小学",
          "metadata.subject": "语文",
          "metadata.grade": "一年级"
        }
      })
    });
    const environment = await environmentResponse.json();
    const missingEnvironmentResponse = await fetch(`${service.url}/api/environment/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        draft: {}
      })
    });
    const missingEnvironment = await missingEnvironmentResponse.json();
    const aliyunEnvironment = await checkEnvironment({ projectRoot, userDataRoot }, {
      mode: "aliyun",
      draft: {},
      fetchImpl: async () => ({ status: 200 })
    });
    const storagePreviewResponse = await fetch(`${service.url}/api/aliyun/storage/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.region": "cn-hangzhou",
          "aliyun.storage.action": "create",
          "aliyun.storage.bucket": "knowmesh-test-bucket",
          "aliyun.search.storageMode": "same-region",
          "aliyun.search.bucket": "knowmesh-test-vector"
        }
      })
    });
    const storagePreview = await storagePreviewResponse.json();
    const searchPreviewResponse = await fetch(`${service.url}/api/aliyun/search/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.search.action": "create",
          "aliyun.search.bucket": "knowmesh-test-search",
          "aliyun.search.index": "textbookv1",
          "aliyun.services.embedding": "text-embedding-v4"
        }
      })
    });
    const searchPreview = await searchPreviewResponse.json();
    const searchSaveResponse = await fetch(`${service.url}/api/setup/aliyun/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.search.action": "create",
          "aliyun.search.bucket": "knowmesh-test-search",
          "aliyun.search.index": "textbookv1",
          "aliyun.services.embedding": "text-embedding-v4"
        }
      })
    });
    const searchSaved = await searchSaveResponse.json();
    const searchStateResponse = await fetch(`${service.url}/api/setup/state`);
    const searchState = await searchStateResponse.json();
    const policyResponse = await fetch(`${service.url}/api/aliyun/permissions/policy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.region": "cn-hangzhou",
          "aliyun.storage.bucket": "knowmesh-test-bucket",
          "aliyun.search.bucket": "knowmesh-test-search"
        }
      })
    });
    const policyPreview = await policyResponse.json();
    const modelProviderPreviewResponse = await fetch(`${service.url}/api/aliyun/model-provider/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.model.provider": "aliyun-bailian",
          "aliyun.model.protocol": "openai-compatible",
          "aliyun.model.region": "cn-beijing",
          "aliyun.model.baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "aliyun.model.apiKey": "sk-test"
        }
      })
    });
    const modelProviderPreview = await modelProviderPreviewResponse.json();
    const modelQualityPreviewResponse = await fetch(`${service.url}/api/aliyun/model-quality/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.model.provider": "aliyun-bailian",
          "aliyun.model.protocol": "openai-compatible",
          "aliyun.model.region": "cn-beijing",
          "aliyun.model.baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "aliyun.model.apiKey.pending": true,
          "aliyun.services.profile": "recommended",
          "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
          "aliyun.services.organizer": "qwen-plus",
          "aliyun.services.embedding": "text-embedding-v4",
          "aliyun.services.rerank": "qwen3-rerank"
        }
      })
    });
    const modelQualityPreview = await modelQualityPreviewResponse.json();
    const modelQualitySaveResponse = await fetch(`${service.url}/api/setup/aliyun/model-quality`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.model.provider": "aliyun-bailian",
          "aliyun.model.protocol": "openai-compatible",
          "aliyun.model.region": "cn-beijing",
          "aliyun.model.baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "aliyun.model.apiKey.pending": true,
          "aliyun.services.profile": "recommended",
          "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
          "aliyun.services.organizer": "qwen-plus",
          "aliyun.services.embedding": "text-embedding-v4",
          "aliyun.services.rerank": "qwen3-rerank"
        }
      })
    });
    const modelQualitySaved = await modelQualitySaveResponse.json();
    const modelQualityStateResponse = await fetch(`${service.url}/api/setup/state`);
    const modelQualityState = await modelQualityStateResponse.json();
    const scanWithoutSourceResponse = await fetch(`${service.url}/api/scan/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "textbook-cn-k12",
        draft: {}
      })
    });
    const scanWithoutSource = await scanWithoutSourceResponse.json();
    const scanPreviewResponse = await fetch(`${service.url}/api/scan/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "general-docs",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath
        }
      })
    });
    const scanPreview = await scanPreviewResponse.json();
    const scanPreviewCatalogDocuments = readCatalogScalar(
      userDataRoot,
      knowledgeBase.id,
      "select count(*) from source_documents"
    );
    const planPreviewResponse = await fetch(`${service.url}/api/plan/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "general-docs",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath
        }
      })
    });
    const planPreview = await planPreviewResponse.json();
    const aliyunPlanResponse = await fetch(`${service.url}/api/plan/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "aliyun",
        template: "general-docs",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath
        }
      })
    });
    const aliyunPlan = await aliyunPlanResponse.json();
    const localJobResponse = await fetch(`${service.url}/api/jobs/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "general-docs",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath
        }
      })
    });
    const localJob = await localJobResponse.json();
    const jobWorkspacePath = localJob.job?.summary?.workspaceRoot;
    const latestJobResponse = await fetch(`${service.url}/api/jobs/latest`);
    const latestJob = await latestJobResponse.json();
    const testJobResponse = await fetch(`${service.url}/api/jobs/latest/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskKey: "merge" })
    });
    const testedJob = await testJobResponse.json();
    const cleanTestJobResponse = await fetch(`${service.url}/api/jobs/latest/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskKey: "clean" })
    });
    const cleanTestedJob = await cleanTestJobResponse.json();
    const pauseJobResponse = await fetch(`${service.url}/api/jobs/latest/pause`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const pausedJob = await pauseJobResponse.json();
    const pausedAdvanceResponse = await fetch(`${service.url}/api/jobs/latest/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const pausedAdvance = await pausedAdvanceResponse.json();
    const resumeJobResponse = await fetch(`${service.url}/api/jobs/latest/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const resumedJob = await resumeJobResponse.json();
    const advanceJobResponse = await fetch(`${service.url}/api/jobs/latest/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const advancedJob = await advanceJobResponse.json();
    const runAllJobResponse = await fetch(`${service.url}/api/jobs/latest/run`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const runAllJob = await runAllJobResponse.json();
    const stopLocalJobResponse = await fetch(`${service.url}/api/jobs/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "local",
        template: "general-docs",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath
        }
      })
    });
    const stopLocalJob = await stopLocalJobResponse.json();
    const stopJobResponse = await fetch(`${service.url}/api/jobs/latest/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const stoppedJob = await stopJobResponse.json();
    const stoppedAdvanceResponse = await fetch(`${service.url}/api/jobs/latest/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const stoppedAdvance = await stoppedAdvanceResponse.json();
    const blockedJobResponse = await fetch(`${service.url}/api/jobs/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "aliyun",
        template: "general-docs",
        draft: {
          "project.source": sourcePath,
          "project.workspace": workspacePath
        }
      })
    });
    const blockedJob = await blockedJobResponse.json();
    const maintenanceResponse = await fetch(`${service.url}/api/maintenance/status`);
    const maintenance = await maintenanceResponse.json();
    const updatePreviewResponse = await fetch(`${service.url}/api/maintenance/update/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const updatePreview = await updatePreviewResponse.json();
    const blockedCreateResponse = await fetch(`${service.url}/api/aliyun/storage/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.region": "cn-hangzhou",
          "aliyun.storage.bucket": "knowmesh-test-bucket",
          "aliyun.search.storageMode": "same-region",
          "aliyun.search.bucket": "knowmesh-test-vector"
        }
      })
    });
    const blockedCreate = await blockedCreateResponse.json();

    assert.equal(environmentResponse.status, 200);
    assert.equal(retrievalSaveResponse.status, 200);
    assert.equal(retrievalSaved.ok, true);
    assert.equal(retrievalSaved.retrievalStrategy.configured, true);
    assert.equal(retrievalSaved.retrievalStrategy.profile, "balanced");
    assert.ok(retrievalSaved.checks.some((item) => item.key === "retrievalStrategySaved" && item.status === "pass"));
    assert.equal(retrievalStateResponse.status, 200);
    assert.equal(retrievalState.retrievalStrategy.configured, true);
    assert.equal(retrievalState.retrievalStrategy.profile, "balanced");
    assert.equal(environment.ok, true);
    assert.equal(environment.phase, "preScan");
    assert.equal(environment.readiness, undefined);
    assert.ok(!environment.checks.some((item) => ["node", "npm", "localService"].includes(item.key)));
    assert.ok(environment.checks.some((item) => item.key === "sourceFolder" && item.status === "pass"));
    assert.ok(environment.checks.some((item) => item.key === "sourceScope" && item.status === "pass"));
    assert.ok(environment.checks.some((item) => item.key === "retrievalStrategy" && item.status === "pass"));
    assert.ok(environment.checks.some((item) => item.key === "cloudSkipped" && item.status === "skip"));
    assert.equal(environment.preScan.summary.fail, 0);
    assert.ok(environment.preScan.groups.some((item) => item.key === "source" && item.status === "pass"));
    assert.ok(environment.preScan.groups.some((item) => item.key === "answer" && item.status === "pass"));
    assert.ok(environment.preScan.groups.some((item) => item.key === "modeConfig" && item.status === "skip"));
    assert.ok(!environment.preScan.groups.some((item) => item.key === "local"));
    assert.equal(environment.fixes.length, 0);
    assert.equal(missingEnvironmentResponse.status, 200);
    assert.equal(missingEnvironment.ok, false);
    assert.ok(missingEnvironment.fixes.some((item) => item.step === "/setup/project"));
    assert.ok(missingEnvironment.preScan.groups.some((item) => item.key === "source" && item.status === "fail"));
    assert.ok(missingEnvironment.preScan.groups.some((item) => item.key === "scope" && item.status === "fail"));
    assert.ok(missingEnvironment.preScan.groups.some((item) => item.key === "answer" && item.status === "pass"));
    assert.equal(aliyunEnvironment.ok, false);
    assert.ok(aliyunEnvironment.fixes.some((item) => item.step === "/setup/aliyun/credential"));
    assert.ok(aliyunEnvironment.preScan.groups.some((item) => item.key === "modeConfig" && item.status === "fail"));
    assert.equal(storagePreviewResponse.status, 200);
    assert.equal(storagePreview.ok, false);
    assert.ok(storagePreview.checks.some((item) => item.key === "credential" && item.status === "fail"));
    assert.equal(searchPreviewResponse.status, 200);
    assert.equal(searchPreview.ok, true);
    assert.equal(searchPreview.confirmation.executionEnabled, false);
    assert.match(searchPreview.confirmation.title.zh, /检索/);
    assert.ok(searchPreview.checks.some((item) => item.key === "searchModelRelation"));
    assert.ok(searchPreview.confirmation.summary.some((item) => item.label.zh === "模型关系"));
    assert.equal(searchSaveResponse.status, 200);
    assert.equal(searchSaved.ok, true);
    assert.equal(searchSaved.search.configured, true);
    assert.equal(searchSaved.search.action, "create");
    assert.equal(searchSaved.search.bucket, "knowmesh-test-search");
    assert.equal(searchSaved.search.index, "textbookv1");
    assert.equal(searchSaved.search.embedding, "text-embedding-v4");
    assert.ok(searchSaved.checks.some((item) => item.key === "searchSaved" && item.status === "pass"));
    assert.equal(searchStateResponse.status, 200);
    assert.equal(searchState.search.configured, true);
    assert.equal(searchState.search.index, "textbookv1");
    assert.equal(searchState.search.embedding, "text-embedding-v4");
    assert.equal(policyResponse.status, 200);
    assert.equal(policyPreview.ok, true);
    assert.match(policyPreview.copyText, /oss:ListBuckets/);
    assert.match(policyPreview.copyText, /oss:PutBucket/);
    assert.match(policyPreview.copyText, /oss:ListVectorBuckets/);
    assert.match(policyPreview.copyText, /oss:PutVectorBucket/);
    assert.match(policyPreview.copyText, /dashscope:Embeddings/);
    assert.equal(policyPreview.confirmation.executionEnabled, false);
    assert.equal(modelProviderPreviewResponse.status, 200);
    assert.equal(modelProviderPreview.ok, true);
    assert.equal(modelProviderPreview.confirmation.executionEnabled, false);
    assert.match(modelProviderPreview.confirmation.title.zh, /模型服务/);
    assert.ok(modelProviderPreview.checks.some((item) => item.key === "modelProvider" && item.status === "pass"));
    assert.ok(modelProviderPreview.checks.some((item) => item.key === "modelProtocol" && item.status === "pass"));
    assert.ok(modelProviderPreview.checks.some((item) => item.key === "modelBaseUrl" && item.status === "pass"));
    assert.ok(modelProviderPreview.checks.some((item) => item.key === "modelApiKey" && item.status === "pass"));
    assert.ok(modelProviderPreview.checks.some((item) => item.key === "modelSmokeTest" && item.status === "pass"));
    assert.ok(modelProviderPreview.confirmation.summary.some((item) => item.label.zh === "模型供应商" && /阿里百炼/.test(item.value.zh)));
    assert.ok(modelProviderPreview.confirmation.summary.some((item) => item.label.zh === "Base URL" && /compatible-mode/.test(item.value.zh)));
    assert.ok(modelProviderPreview.confirmation.summary.some((item) => item.label.zh === "连接测试" && /qwen-plus/.test(item.value.zh)));
    assert.equal(modelQualityPreviewResponse.status, 200);
    assert.equal(modelQualityPreview.ok, true);
    assert.equal(modelQualityPreview.confirmation.executionEnabled, false);
    assert.match(modelQualityPreview.confirmation.title.zh, /模型与质量/);
    assert.ok(modelQualityPreview.checks.some((item) => item.key === "modelProviderReady" && item.status === "pass"));
    assert.ok(modelQualityPreview.checks.some((item) => item.key === "qualityProfile" && item.status === "pass"));
    assert.ok(modelQualityPreview.checks.some((item) => item.key === "ocrModel" && item.status === "pass"));
    assert.ok(modelQualityPreview.checks.some((item) => item.key === "organizerModel" && item.status === "pass"));
    assert.ok(modelQualityPreview.checks.some((item) => item.key === "embeddingModel" && item.status === "pass"));
    assert.ok(modelQualityPreview.checks.some((item) => item.key === "rerankModel" && item.status === "pass"));
    assert.ok(modelQualityPreview.confirmation.summary.some((item) => item.label.zh === "处理方案" && /推荐/.test(item.value.zh)));
    assert.ok(modelQualityPreview.confirmation.summary.some((item) => item.label.zh === "内容整理模型" && item.value.zh === "qwen-plus"));
    assert.ok(modelQualityPreview.confirmation.summary.some((item) => item.label.zh === "向量化模型" && item.value.zh === "text-embedding-v4"));
    assert.ok(modelQualityPreview.confirmation.summary.some((item) => item.label.zh === "重排模型" && item.value.zh === "qwen3-rerank"));
    assert.equal(modelQualitySaveResponse.status, 200);
    assert.equal(modelQualitySaved.ok, true);
    assert.equal(modelQualitySaved.modelQuality.configured, true);
    assert.equal(modelQualitySaved.modelQuality.profile, "recommended");
    assert.equal(modelQualitySaved.modelQuality.ocr, "qwen-vl-ocr-2025-11-20");
    assert.equal(modelQualitySaved.modelQuality.organizer, "qwen-plus");
    assert.equal(modelQualitySaved.modelQuality.embedding, "text-embedding-v4");
    assert.equal(modelQualitySaved.modelQuality.rerank, "qwen3-rerank");
    assert.ok(modelQualitySaved.checks.some((item) => item.key === "modelQualitySaved" && item.status === "pass"));
    assert.equal(modelQualityStateResponse.status, 200);
    assert.equal(modelQualityState.modelQuality.configured, true);
    assert.equal(modelQualityState.modelQuality.profile, "recommended");
    assert.equal(modelQualityState.modelQuality.embedding, "text-embedding-v4");
    const staleSkippedModelQualityResponse = await fetch(`${service.url}/api/aliyun/model-quality/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.model.provider": "aliyun-bailian",
          "aliyun.model.protocol": "openai-compatible",
          "aliyun.model.region": "cn-beijing",
          "aliyun.model.baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "aliyun.model.apiKey.pending": true,
          "aliyun.services.profile": "recommended",
          "aliyun.services.ocr": "skip-now",
          "aliyun.services.organizer": "qwen-plus",
          "aliyun.services.embedding": "text-embedding-v4",
          "aliyun.services.rerank": "skip-now"
        }
      })
    });
    const staleSkippedModelQuality = await staleSkippedModelQualityResponse.json();
    assert.equal(staleSkippedModelQualityResponse.status, 200);
    assert.equal(staleSkippedModelQuality.ok, false);
    assert.ok(staleSkippedModelQuality.checks.some((item) => item.key === "ocrModel" && item.status === "fail"));
    assert.ok(staleSkippedModelQuality.checks.some((item) => item.key === "rerankModel" && item.status === "fail"));
    assert.doesNotMatch(JSON.stringify(staleSkippedModelQuality), /稍后配置|暂不启用|Configure later|Not enabled now/);
    assert.equal(scanWithoutSourceResponse.status, 200);
    assert.equal(scanWithoutSource.ok, false);
    assert.equal(scanWithoutSource.preview.summary.sourceRoot, "");
    assert.match(scanWithoutSource.checks[0].message.zh, /还没有选择资料目录/);
    assert.ok(scanWithoutSource.fixes.some((item) => item.step === "/setup/project"));
    assert.ok(scanWithoutSource.preview.issueGroups.some((group) => group.key === "blockers" && group.status === "fail"));
    assert.ok(scanWithoutSource.preview.issueGroups.some((group) => group.items.some((item) => item.href === "/setup/project")));
    assert.equal(scanPreviewResponse.status, 200);
    assert.equal(scanPreview.ok, true);
    assert.equal(scanPreview.fixes.length, 0);
    assert.ok(scanPreview.checks.some((item) => item.key === "readOnly" && item.status === "pass"));
    assert.ok(scanPreview.preview.issueGroups.some((group) => group.key === "blockers" && group.status === "pass"));
    assert.ok(scanPreview.preview.issueGroups.some((group) => group.key === "ready" && group.items.some((item) => item.key === "readOnly")));
    assert.ok(scanPreview.preview.summary.includedFiles >= 3);
    assert.ok(scanPreview.preview.summary.logicalDocuments >= 2);
    assert.equal(scanPreview.catalog?.documents, scanPreview.preview.summary.logicalDocuments);
    assert.equal(scanPreviewCatalogDocuments, scanPreview.preview.summary.logicalDocuments);
    assert.equal(scanPreview.preview.summary.splitPdfGroups, 1);
    assert.equal(planPreviewResponse.status, 200);
    assert.equal(planPreview.ok, true);
    assert.equal(planPreview.planPreview.summary.logicalDocuments, 3);
    assert.equal(planPreview.planPreview.summary.cloudActions, 0);
    assert.ok(planPreview.planPreview.actions.some((item) => item.key === "clean" && item.status === "planned"));
    assert.equal(planPreview.planPreview.executionPlan.summary.totalStages, 8);
    assert.ok(planPreview.planPreview.executionPlan.summary.totalRounds >= 24);
    assert.ok(planPreview.planPreview.executionPlan.stages.some((item) => item.key === "text" && item.rounds.some((round) => round.key === "text-ocr" && round.status === "skipped")));
    assert.ok(planPreview.planPreview.executionPlan.stages.some((item) => item.key === "chunk" && item.validationStatus === "pending"));
    assert.ok(planPreview.planPreview.actions.some((item) => item.key === "retrieval-policy" && item.status === "planned"));
    assert.equal(planPreview.planPreview.summary.retrievalProfile.zh, "稳健推荐");
    assert.equal(aliyunPlanResponse.status, 200);
    assert.equal(aliyunPlan.ok, false);
    assert.ok(aliyunPlan.planPreview.blockers.some((item) => item.step === "/setup/aliyun/credential"));
    assert.ok(aliyunPlan.planPreview.blockers.some((item) => item.step === "/setup/aliyun/storage"));
    assert.equal(aliyunPlan.planPreview.cloudConfirmation.executionEnabled, false);
    assert.ok(aliyunPlan.planPreview.cloudConfirmation.steps.some((item) => item.key === "credential" && item.status === "fail" && item.href === "/setup/aliyun/credential"));
    assert.ok(aliyunPlan.planPreview.cloudConfirmation.steps.some((item) => item.key === "cloud-upload" && item.status === "confirm_later" && item.confirmationRequired === true));
    assert.ok(aliyunPlan.planPreview.cloudConfirmation.steps.filter((item) => item.status === "confirm_later").every((item) => !item.href));
    assert.ok(aliyunPlan.planPreview.cloudConfirmation.steps.some((item) => item.key === "cloud-index" && item.confirmationRequired === true));
    assert.ok(aliyunPlan.planPreview.actions.some((item) => item.key === "upload" && item.status === "planned"));
    assert.ok(aliyunPlan.planPreview.executionPlan.stages.some((item) => item.key === "text" && item.status !== "blocked"));
    assert.equal(localJobResponse.status, 200);
    assert.equal(localJob.ok, true);
    assert.equal(localJob.job.status, "waiting");
    assert.equal(localJob.job.executionPlan.summary.totalStages, 8);
    assert.ok(localJob.job.executionPlan.stages.some((item) => item.key === "validation" && item.rounds.some((round) => round.key === "validation-report")));
    assert.ok(localJob.job.tasks.some((item) => item.key === "clean" && item.status === "waiting"));
    assert.ok(!localJob.job.tasks.some((item) => item.key === "upload"));
    assert.equal(latestJobResponse.status, 200);
    assert.equal(latestJob.ok, true);
    assert.equal(latestJob.job.id, localJob.job.id);
    assert.equal(testJobResponse.status, 200);
    assert.equal(testedJob.ok, true);
    assert.equal(testedJob.testResult.task.key, "merge");
    assert.ok(testedJob.testResult.artifacts.some((item) => item.key === "testReport"));
    assert.equal(testedJob.job.progress.completed, localJob.job.progress.completed);
    assert.equal(testedJob.job.tasks.find((item) => item.key === "merge").status, "waiting");
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "tests", "merge.test-report.json")));
    assert.equal(cleanTestJobResponse.status, 200);
    assert.equal(cleanTestedJob.ok, true);
    assert.equal(cleanTestedJob.testResult.task.key, "clean");
    assert.ok(cleanTestedJob.testResult.filterPreview.summary.filteredItems >= 2);
    assert.ok(cleanTestedJob.testResult.filterPreview.ruleGroups.some((group) => group.key === "review" && group.count >= 1));
    assert.ok(cleanTestedJob.testResult.filterPreview.records.some((item) => item.rule_id === "external_url"));
    assert.equal(cleanTestedJob.job.progress.completed, localJob.job.progress.completed);
    assert.equal(cleanTestedJob.job.tasks.find((item) => item.key === "clean").status, "waiting");
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "tests", "clean.test-report.json")));
    assert.equal(pauseJobResponse.status, 200);
    assert.equal(pausedJob.ok, true);
    assert.equal(pausedJob.job.status, "paused");
    assert.equal(pausedAdvanceResponse.status, 200);
    assert.equal(pausedAdvance.ok, false);
    assert.equal(pausedAdvance.job.status, "paused");
    assert.ok(pausedAdvance.checks.some((item) => item.key === "jobPaused"));
    assert.equal(resumeJobResponse.status, 200);
    assert.equal(resumedJob.ok, true);
    assert.equal(resumedJob.job.status, "waiting");
    assert.equal(advanceJobResponse.status, 200);
    assert.equal(advancedJob.ok, true);
    assert.equal(advancedJob.job.id, localJob.job.id);
    assert.equal(advancedJob.job.status, "waiting");
    assert.ok(advancedJob.job.progress.completed > localJob.job.progress.completed);
    assert.ok(advancedJob.job.executionPlan.summary.completedRounds >= localJob.job.executionPlan.summary.completedRounds);
    assert.ok(advancedJob.checks.some((item) => item.key === "advanced"));
    assert.ok(advancedJob.advanced.artifacts.some((item) => item.key === "sourceScan"));
    assert.ok(advancedJob.job.artifacts.some((item) => item.key === "pipelineReport"));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "manifests", "source-scan.manifest.json")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "manifests", "document-manifest.planned.json")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "pipeline-plan.report.json")));
    assert.equal(runAllJobResponse.status, 200);
    assert.equal(runAllJob.ok, true);
    assert.equal(runAllJob.job.status, "completed");
    assert.equal(runAllJob.job.progress.total, runAllJob.job.tasks.filter((item) => item.status !== "skipped").length);
    assert.equal(runAllJob.job.progress.completed, runAllJob.job.progress.total);
    assert.equal(runAllJob.job.progress.skipped, 0);
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "pagePreparationReport"));
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "textRecognitionPlan"));
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "textRecognitionWorkOrder"));
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "normalizedText"));
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "localChunks"));
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "filterReport"));
    assert.ok(runAllJob.job.artifacts.some((item) => item.key === "localRunReport"));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "page-preparation.report.json")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "text-recognition-plan.report.json")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "ocr", "text-recognition.work-order.jsonl")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "normalized", "local-text.normalized.json")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "chunks", "local-chunks.jsonl")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "filter-report.json")));
    assert.ok(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "local-run.report.json")));
    assert.equal(fs.existsSync(path.join(jobWorkspacePath, "artifacts", "reports", "query-evidence.report.json")), false);
    const registeredArtifacts = readCatalogRows(
      userDataRoot,
      knowledgeBase.id,
      "select artifact_type, relative_path, content_hash, size_bytes from artifact_registry where owner_type = 'job' and owner_id = ? order by artifact_type",
      [runAllJob.job.id]
    );
    assert.ok(registeredArtifacts.some((item) => item.artifact_type === "localRunReport" && item.relative_path === "artifacts/reports/local-run.report.json"));
    assert.ok(registeredArtifacts.some((item) => item.artifact_type === "sourceScan" && item.relative_path === "manifests/source-scan.manifest.json"));
    assert.ok(registeredArtifacts.every((item) => /^[a-f0-9]{64}$/.test(item.content_hash)));
    assert.ok(registeredArtifacts.every((item) => item.size_bytes > 0));
    const filterReport = JSON.parse(fs.readFileSync(path.join(jobWorkspacePath, "artifacts", "reports", "filter-report.json"), "utf8"));
    assert.ok(filterReport.summary.filteredItems >= 2);
    assert.ok(filterReport.ruleGroups.some((group) => group.key === "metadataOnly" && group.count >= 1));
    assert.ok(filterReport.ruleGroups.some((group) => group.key === "remove" && group.count >= 1));
    assert.ok(filterReport.ruleGroups.some((group) => group.key === "review" && group.count >= 1));
    assert.ok(filterReport.records.some((item) => item.rule_id === "external_url" && item.action === "metadata_only" && item.review_required === false));
    assert.ok(filterReport.records.some((item) => item.rule_id === "isolated_page_number" && item.action === "remove"));
    assert.ok(filterReport.review.some((item) => item.rule_id === "possible_secret" && item.review_required === true));
    assert.equal(stopLocalJobResponse.status, 200);
    assert.equal(stopLocalJob.ok, true);
    assert.equal(stopJobResponse.status, 200);
    assert.equal(stoppedJob.ok, true);
    assert.equal(stoppedJob.job.status, "stopped");
    assert.equal(stoppedAdvanceResponse.status, 200);
    assert.equal(stoppedAdvance.ok, false);
    assert.equal(stoppedAdvance.job.status, "stopped");
    assert.ok(stoppedAdvance.checks.some((item) => item.key === "jobStopped"));
    assert.equal(blockedJobResponse.status, 200);
    assert.equal(blockedJob.ok, false);
    assert.equal(blockedJob.job.status, "blocked");
    assert.equal(blockedJob.job.cloudConfirmation.executionEnabled, false);
    assert.ok(blockedJob.job.cloudConfirmation.steps.some((item) => item.key === "credential" && item.href === "/setup/aliyun/credential"));
    assert.ok(blockedJob.job.cloudConfirmation.steps.some((item) => item.key === "cloud-upload" && item.confirmationRequired === true));
    assert.ok(blockedJob.job.failures.some((item) => item.step === "/setup/aliyun/credential"));
    assert.ok(blockedJob.job.recovery.some((item) => item.href === "/setup/aliyun/storage"));
    assert.equal(maintenanceResponse.status, 200);
    assert.equal(maintenance.ok, false);
    assert.equal(maintenance.maintenance.summary.latestJobStatus, "blocked");
    assert.ok(maintenance.checks.some((item) => item.key === "updates" && item.status === "warn"));
    assert.ok(maintenance.maintenance.diagnostics.some((item) => item.key === "latestJob" && item.status === "fail" && item.href === "/build/execution"));
    assert.equal(maintenance.maintenance.updateGate.executionEnabled, false);
    assert.ok(maintenance.maintenance.updateGate.steps.some((item) => item.key === "preview" && item.status === "blocked"));
    assert.equal(maintenance.maintenance.cards, undefined);
    assert.equal(maintenance.maintenance.actions, undefined);
    assert.equal(maintenance.maintenance.templateContract.version, "1.2.0");
    assert.equal(maintenance.maintenance.nextActions, undefined);
    assert.equal(updatePreviewResponse.status, 200);
    assert.equal(updatePreview.ok, true);
    assert.equal(updatePreview.confirmation.executionEnabled, false);
    assert.ok(updatePreview.confirmation.summary.some((item) => item.label.zh === "当前版本"));
    assert.ok(updatePreview.checks.some((item) => item.key === "updateExecution" && item.status === "blocked"));
    assert.equal(blockedCreateResponse.status, 200);
    assert.equal(blockedCreate.ok, false);
    assert.ok(blockedCreate.checks.some((item) => item.key === "credential" && item.status === "fail"));
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service restores latest job progress after restart", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-job-persistence-test-"));
  const sourcePath = path.join(userDataRoot, "source");
  const workspacePath = path.join(userDataRoot, "workspace");
  fs.mkdirSync(sourcePath, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(path.join(sourcePath, "policy-note.txt"), "知识库更新策略\n正文内容。", "utf8");

  let service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const draft = {
      "project.source": sourcePath,
      "project.workspace": workspacePath
    };
    await fetch(`${service.url}/api/setup/retrieval-strategy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "retrieval.profile": "balanced" } })
    });
    const createdResponse = await fetch(`${service.url}/api/jobs/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "local", template: "general-docs", draft })
    });
    const created = await createdResponse.json();
    const advancedResponse = await fetch(`${service.url}/api/jobs/latest/advance`, {
      method: "POST",
      headers: { "content-type": "application/json" }
    });
    const advanced = await advancedResponse.json();

    assert.equal(createdResponse.status, 200);
    assert.equal(created.ok, true);
    assert.equal(advancedResponse.status, 200);
    assert.equal(advanced.ok, true);
    assert.equal(advanced.job.tasks.find((item) => item.key === "merge").status, "completed");
    assert.equal(fs.existsSync(catalogDatabasePath({ userDataRoot }, "kb-k12-all-subjects")), true);
    assert.equal(readCatalogScalar(userDataRoot, "kb-k12-all-subjects", "select job_id from jobs where job_id = ?", [advanced.job.id]), advanced.job.id);
    assert.equal(fs.existsSync(path.join(userDataRoot, "knowledge-bases", "kb-k12-all-subjects", "jobs-state.json")), false);

    await service.close();
    service = null;
    service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
    const restoredResponse = await fetch(`${service.url}/api/jobs/latest`);
    const restored = await restoredResponse.json();

    assert.equal(restoredResponse.status, 200);
    assert.equal(restored.ok, true);
    assert.equal(restored.job.id, advanced.job.id);
    assert.equal(restored.job.progress.completed, advanced.job.progress.completed);
    assert.equal(restored.job.tasks.find((item) => item.key === "merge").status, "completed");
    assert.ok(restored.job.artifacts.some((item) => item.key === "pipelineReport"));
  } finally {
    if (service) await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("job isolation preserves POSIX absolute workspace roots", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-posix-workspace-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const posixBaseWorkspace = "/tmp/knowmesh-ci-workspace/workspace";
    const posixWorkspaceRoot = `${posixBaseWorkspace}/knowledge-bases/${knowledgeBase.id}/versions/build-posix-root`;
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-posix-root",
      jobs: [{
        id: "job-posix-root",
        status: "completed",
        mode: "local",
        template: "textbook-cn-k12",
        createdAt: "2026-06-29T00:00:00.000Z",
        updatedAt: "2026-06-29T00:00:00.000Z",
        summary: { workspaceRoot: posixWorkspaceRoot },
        tasks: [
          { key: "index", status: "completed" }
        ]
      }]
    });

    const restored = latestJob({ userDataRoot, knowledgeBaseId: knowledgeBase.id }).job;

    assert.equal(restored.summary.baseWorkspaceRoot.replaceAll("\\", "/"), posixBaseWorkspace);
    assert.equal(restored.summary.workspaceRoot.replaceAll("\\", "/"), posixWorkspaceRoot);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime uses completed index records when local chunks are empty", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-index-source-test-"));
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: "人教版数学五年级上册第三单元讲小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。[1]"
            }
          }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({})
    };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-20260621010101-jobqa");
    const indexRecordsPath = path.join(workspaceRoot, "artifacts", "index_records", "index-records.pending.jsonl");
    const localChunksPath = path.join(workspaceRoot, "artifacts", "chunks", "local-chunks.jsonl");
    fs.mkdirSync(path.dirname(indexRecordsPath), { recursive: true });
    fs.mkdirSync(path.dirname(localChunksPath), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "reports"), { recursive: true });
    fs.writeFileSync(localChunksPath, "", "utf8");
    fs.writeFileSync(indexRecordsPath, [
      {
        chunk_id: "chunk-k12-english-001",
        document_id: "doc-k12-english",
        version_id: "ver-k12-english",
        active: true,
        text: "五年级上册会学习很多单元主题，但这是英语教材的语言学习内容。",
        sourceUri: "小学/英语/北京版/义务教育教科书·英语五年级上册.pdf",
        page_start: 3,
        metadata: {
          title: "义务教育教科书·英语五年级上册"
        },
        quality: {
          writeEnabled: true
        },
        status: "embedded"
      },
      {
        chunk_id: "chunk-k12-math-cover",
        document_id: "doc-k12-math",
        version_id: "ver-k12-math",
        active: true,
        text: "义务教育教科书 数学 五年级 上册 人民教育出版社 课程教材研究所 小学数学教材编委会。",
        sourceUri: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
        page_start: 2,
        metadata: {
          title: "义务教育教科书·数学五年级上册"
        },
        quality: {
          writeEnabled: true
        },
        status: "embedded"
      },
      {
        chunk_id: "chunk-k12-math-001",
        document_id: "doc-k12-math",
        version_id: "ver-k12-math",
        active: true,
        text: "<h2>3 小数除法</h2> 本单元主要学习小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。",
        sourceUri: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
        page_start: 29,
        metadata: {
          title: "义务教育教科书·数学五年级上册"
        },
        quality: {
          writeEnabled: true
        },
        status: "embedded"
      }
    ].map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
    writeCatalogSetupFixture(userDataRoot, knowledgeBase.id, {
      "retrieval.profile": "balanced",
      "retrieval.strategy.configured": true,
      "retrieval.strategy.updatedAt": "2026-06-21T01:01:01.000Z"
    }, "2026-06-21T01:01:01.000Z");
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-query-index-source",
      jobs: [{
        id: "job-query-index-source",
        status: "completed",
        mode: "aliyun",
        template: "textbook-cn-k12",
        summary: { workspaceRoot },
        tasks: [
          { key: "scan", status: "completed" },
          { key: "merge", status: "completed" },
          { key: "pages", status: "completed" },
          { key: "clean", status: "completed" },
          { key: "retrieval-policy", status: "completed" },
          { key: "upload", status: "completed" },
          { key: "ocr", status: "completed" },
          { key: "embedding", status: "completed" },
          { key: "index", status: "completed" }
        ],
        artifacts: [
          { key: "localChunks", path: localChunksPath },
          { key: "pendingIndexRecords", path: indexRecordsPath }
        ]
      }]
    });

    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "人教版数学五年级上册第三单元讲的什么知识点"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "knowmesh.queryResult");
    assert.equal(body.runtime.source.kind, "pendingIndexRecords");
    assert.equal(body.status, "answered");
    assert.equal(body.citations[0].pageNumber, 29);
    assert.match(body.citations[0].sourceUri, /小学\/数学\/人教版/);
    assert.match(body.citations[0].excerpt, /小数除法/);
    assert.match(body.answer.text, /小数除法/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime prefers catalog chunks when index jsonl artifacts are absent", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-catalog-index-test-"));
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: "人教版数学五年级上册第三单元讲小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。[1]"
            }
          }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({})
    };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-catalog");
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "reports"), { recursive: true });
    writeCatalogIndexFixtures(userDataRoot, knowledgeBase.id, [
      {
        chunk_id: "chunk-k12-math-catalog",
        document_id: "doc-k12-math-catalog",
        version_id: "ver-k12-math-catalog",
        text: "<h2>3 小数除法</h2> 本单元主要学习小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。",
        sourceUri: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
        page_start: 29,
        metadata: {
          title: "义务教育教科书·数学五年级上册"
        }
      }
    ]);
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-query-catalog-index",
      jobs: [{
        id: "job-query-catalog-index",
        status: "completed",
        mode: "local",
        template: "textbook-cn-k12",
        summary: { workspaceRoot },
        tasks: [
          { key: "scan", status: "completed" },
          { key: "merge", status: "completed" },
          { key: "pages", status: "completed" },
          { key: "clean", status: "completed" },
          { key: "retrieval-policy", status: "completed" },
          { key: "upload", status: "completed" },
          { key: "ocr", status: "completed" },
          { key: "embedding", status: "completed" },
          { key: "index", status: "completed" }
        ],
        artifacts: []
      }]
    });

    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/retrieval-strategy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "retrieval.profile": "balanced" } })
    });
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "人教版数学五年级上册第三单元讲的什么知识点"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runtime.source.kind, "catalogChunks");
    assert.equal(body.status, "answered");
    assert.equal(body.citations[0].pageNumber, 29);
    assert.match(body.answer.text, /小数除法/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime uses structure catalog for general page lookups before hybrid retrieval", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-structure-route-test-"));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    requests.push({ url: target, method: options.method || "GET", body: String(options.body || "") });
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{ message: { content: "报销制度在《员工手册》第12页。[1]" } }]
        })
      };
    }
    return { ok: true, status: 200, headers: new Map(), text: async () => "" };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const kbResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "kb-general-structure", name: "制度知识库", template: "general-docs" })
    });
    const knowledgeBase = (await kbResponse.json()).knowledgeBase;
    writeGeneralStructureRouteFixture(userDataRoot, knowledgeBase.id);
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "报销制度在哪一页？" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runtime.source.kind, "structureCatalog");
    assert.equal(body.query.retrieval.source, "structureCatalog");
    assert.equal(body.citations[0].pageNumber, 12);
    assert.equal(body.citations[0].metadata.contentType, "section");
    assert.equal(requests.find((item) => item.url.includes("/embeddings")), undefined);
    assert.equal(requests.find((item) => item.url.includes("?queryVectors")), undefined);
    assert.match(body.answer.text, /第12页/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime uses catalog chunks when index artifacts are absent", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-catalog-chunks-test-"));
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: "人教版数学五年级上册第三单元讲小数除法。[1]"
            }
          }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      text: async () => JSON.stringify({})
    };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-catalog-chunks");
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "reports"), { recursive: true });
    writeCatalogPageBlockFixture(userDataRoot, knowledgeBase.id, {
      documentId: "doc-k12-math-catalog-chunk",
      versionId: "ver-k12-math-catalog-chunk",
      title: "义务教育教科书·数学五年级上册",
      relativePath: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
      text: "<h2>3 小数除法</h2> 本单元主要学习小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。"
    });
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-query-catalog-chunks",
      jobs: [{
        id: "job-query-catalog-chunks",
        status: "completed",
        mode: "local",
        template: "textbook-cn-k12",
        summary: { workspaceRoot },
        tasks: [
          { key: "scan", status: "completed" },
          { key: "merge", status: "completed" },
          { key: "pages", status: "completed" },
          { key: "clean", status: "completed" },
          { key: "retrieval-policy", status: "completed" },
          { key: "upload", status: "completed" },
          { key: "ocr", status: "completed" },
          { key: "embedding", status: "completed" },
          { key: "index", status: "completed" }
        ],
        artifacts: []
      }]
    });

    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/retrieval-strategy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "retrieval.profile": "balanced" } })
    });
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "人教版数学五年级上册第三单元讲的什么知识点"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runtime.source.kind, "catalogChunks");
    assert.equal(body.status, "answered");
    assert.match(body.citations[0].excerpt, /小数除法/);
    assert.match(body.answer.text, /小数除法/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime in aliyun mode queries OSS Vector and resolves OSS sidecar citations", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-cloud-vector-test-"));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    const body = String(options.body || "");
    requests.push({ url: target, method, body });
    if (target.includes("/compatible-mode/v1/embeddings")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          data: [{ embedding: [0.11, 0.22, 0.33] }],
          usage: { total_tokens: 8 }
        })
      };
    }
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: "五年级上册第三单元主要学习小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。[1]"
            }
          }],
          usage: { total_tokens: 96 }
        })
      };
    }
    if (target.includes("?queryVectors")) {
      return {
        ok: true,
        status: 200,
        headers: new Map([["x-oss-request-id", "query-cloud-vector"]]),
        text: async () => JSON.stringify({
          vectors: [
            {
              key: "chunk-grade6-chinese",
              distance: 0.01,
              metadata: {
                doc: "doc-grade6-chinese",
                cid: "chunk-grade6-chinese",
                fgs: "primary|g6|chinese",
                pub: "renjiao",
                vol: "v2",
                unit: "u03",
                sidecar: "oss://knowmesh-source/knowmesh/kb/kb-k12-all-subjects/versions/build-cloud/sidecar/chunks/part-0001.jsonl#chunk-grade6-chinese"
              }
            },
            {
              key: "chunk-grade5-math-wrong-sidecar",
              distance: 0.02,
              metadata: {
                doc: "doc-grade5-math-wrong-sidecar",
                cid: "chunk-grade5-math-wrong-sidecar",
                fgs: "primary|g5|math",
                pub: "renjiao",
                vol: "v1",
                unit: "u03",
                sidecar: "oss://knowmesh-source/knowmesh/kb/kb-k12-all-subjects/versions/build-cloud/sidecar/chunks/part-0001.jsonl#chunk-grade5-math-wrong-sidecar"
              }
            },
            {
              key: "chunk-grade5-math",
              distance: 0.08,
              metadata: {
                doc: "doc-grade5-math",
                cid: "chunk-grade5-math",
                fgs: "primary|g5|math",
                pub: "renjiao",
                vol: "v1",
                unit: "u03",
                sidecar: "oss://knowmesh-source/knowmesh/kb/kb-k12-all-subjects/versions/build-cloud/sidecar/chunks/part-0001.jsonl#chunk-grade5-math"
              }
            }
          ]
        })
      };
    }
    if (method === "GET" && target.includes("knowmesh-source.oss-cn-hangzhou.aliyuncs.com/knowmesh/kb/kb-k12-all-subjects/versions/build-cloud/sidecar/chunks/part-0001.jsonl")) {
      return {
        ok: true,
        status: 200,
        headers: new Map([["etag", "\"sidecar\""]]),
        text: async () => [
          JSON.stringify({
            chunk_id: "chunk-grade6-chinese",
            document_id: "doc-grade6-chinese",
            version_id: "build-cloud",
            text: "六年级下册第三单元是语文综合性学习内容。",
            sourceUri: "小学/语文/统编版/义务教育教科书·语文六年级下册.pdf",
            metadata: { title: "义务教育教科书·语文六年级下册", pageNumber: 42, grade: "六年级", subject: "语文" }
          }),
          JSON.stringify({
            chunk_id: "chunk-grade5-math-wrong-sidecar",
            document_id: "doc-grade5-math-wrong-sidecar",
            version_id: "build-cloud",
            text: "六年级上册第三单元是分数除法内容。",
            sourceUri: "小学/数学/人教版/义务教育教科书·数学六年级上册.pdf",
            metadata: { title: "义务教育教科书·数学六年级上册", pageNumber: 31, grade: "六年级", subject: "数学" }
          }),
          JSON.stringify({
            chunk_id: "chunk-grade5-math",
            document_id: "doc-grade5-math",
            version_id: "build-cloud",
            text: "<h2>3 小数除法</h2> 第三单元主要学习小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。",
            sourceUri: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
            metadata: { title: "义务教育教科书·数学五年级上册", pageNumber: 29, grade: "五年级", subject: "数学" }
          })
        ].join("\n") + "\n"
      };
    }
    return { ok: true, status: 200, headers: new Map(), text: async () => "" };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "LTAI_TEST", accessKeySecret: "secret", saveTarget: "secure-local" })
    });
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-cloud");
    fs.mkdirSync(path.join(workspaceRoot, "manifests"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "reports"), { recursive: true });
    writeCatalogSetupFixture(userDataRoot, knowledgeBase.id, {
      "retrieval.profile": "balanced",
      "retrieval.strategy.configured": true,
      "retrieval.strategy.updatedAt": "2026-06-21T01:01:01.000Z"
    }, "2026-06-21T01:01:01.000Z");
    const activeManifestPath = path.join(workspaceRoot, "manifests", "active-manifest.json");
    const activeManifest = {
      kind: "knowmesh.activeManifest",
      status: "active",
      datasetVersionId: "build-cloud",
      target: {
        provider: "aliyun-vector",
        region: "cn-hangzhou",
        bucket: "knowmesh-vector",
        index: "textbookv1",
        accountId: "123456789012"
      },
      sidecar: {
        authoritativeStore: "oss-sidecar",
        bucket: "knowmesh-source",
        region: "cn-hangzhou",
        manifestUri: "oss://knowmesh-source/knowmesh/kb/kb-k12-all-subjects/versions/build-cloud/sidecar/manifest.json",
        chunks: 2
      }
    };
    fs.writeFileSync(activeManifestPath, JSON.stringify(activeManifest, null, 2), "utf8");
    writeCatalogReleaseFixture(userDataRoot, knowledgeBase.id, {
      buildId: "build-cloud",
      manifestPath: activeManifestPath,
      target: activeManifest.target,
      sidecar: activeManifest.sidecar
    });
    fs.rmSync(activeManifestPath);
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-cloud-query",
      jobs: [{
        id: "job-cloud-query",
        status: "completed",
        mode: "aliyun",
        template: "textbook-cn-k12",
        summary: { workspaceRoot },
        tasks: [
          { key: "scan", status: "completed" },
          { key: "merge", status: "completed" },
          { key: "pages", status: "completed" },
          { key: "clean", status: "completed" },
          { key: "retrieval-policy", status: "completed" },
          { key: "upload", status: "completed" },
          { key: "ocr", status: "completed" },
          { key: "embedding", status: "completed" },
          { key: "index", status: "completed" }
        ],
        artifacts: [
          { key: "activeManifest", path: activeManifestPath }
        ]
      }]
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "人教版数学五年级上册第三单元讲的什么知识点"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "knowmesh.queryResult");
    assert.equal(body.runtime.source.kind, "aliyunVector");
    assert.equal(fs.existsSync(activeManifestPath), false);
    const releaseRows = readCatalogRows(userDataRoot, knowledgeBase.id, `
      SELECT b.status AS build_status, b.active, r.status AS release_status, r.summary_json
      FROM build_versions b
      JOIN release_manifests r ON r.build_id = b.build_id
      WHERE b.build_id = 'build-cloud'
      ORDER BY r.release_id
    `);
    assert.equal(releaseRows[0]?.build_status, "active");
    assert.equal(releaseRows[0]?.active, 1);
    assert.equal(releaseRows[0]?.release_status, "active");
    const releaseSummary = JSON.parse(releaseRows[0].summary_json);
    assert.equal(releaseSummary.target.provider, "aliyun-vector");
    assert.equal(releaseSummary.sidecar.authoritativeStore, "oss-sidecar");
    assert.equal(body.status, "answered");
    assert.ok(body.citations.length >= 1);
    const mathCitation = body.citations.find((item) => item.id === "chunk-grade5-math");
    assert.ok(mathCitation);
    assert.ok(body.query.retrieval.rejectedCitations >= 1);
    assert.equal(mathCitation.pageNumber, 29);
    assert.match(mathCitation.sourceUri, /数学五年级上册/);
    assert.doesNotMatch(JSON.stringify(body.citations), /六年级/);
    const queryRequest = requests.find((item) => item.url.includes("?queryVectors"));
    assert.ok(queryRequest, "query runtime must call OSS Vector QueryVectors");
    assert.match(queryRequest.body, /primary\|g5\|math/);
    assert.match(queryRequest.body, /"\$and"/);
    assert.match(queryRequest.body, /"\$eq"/);
    assert.match(queryRequest.body, /"unit":\{"\$eq":"u03"\}/);

    assert.equal(body.answer.status, "answered");
    assert.equal(body.answer.reliable, true);
    assert.match(body.answer.text, /小数除法/);
    assert.equal(mathCitation.documentId, "doc-grade5-math");
    assert.equal(mathCitation.links.document, `/kb/${knowledgeBase.id}/maintain/document?documentId=doc-grade5-math`);
    const chatRequest = requests.find((item) => item.url.includes("/chat/completions"));
    assert.ok(chatRequest, "answer generation must call the configured Model Studio chat endpoint");
    assert.match(chatRequest.body, /只能使用用户提供的来源片段回答/);
    assert.match(chatRequest.body, /义务教育教科书·数学五年级上册/);
    assert.doesNotMatch(chatRequest.body, /义务教育教科书·数学六年级上册/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime explains no evidence without pretending the model answered", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-no-evidence-test-"));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    const body = String(options.body || "");
    requests.push({ url: target, method, body });
    if (target.includes("/compatible-mode/v1/embeddings")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          data: [{ embedding: [0.21, 0.22, 0.23] }]
        })
      };
    }
    if (target.includes("?queryVectors")) {
      return {
        ok: true,
        status: 200,
        headers: new Map([["x-oss-request-id", "query-no-evidence"]]),
        text: async () => JSON.stringify({ vectors: [] })
      };
    }
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      throw new Error("chat completion must not be called when there are no citable sources");
    }
    return { ok: true, status: 200, headers: new Map(), text: async () => "" };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "LTAI_TEST", accessKeySecret: "secret", saveTarget: "secure-local" })
    });
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-no-evidence");
    fs.mkdirSync(path.join(workspaceRoot, "manifests"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "reports"), { recursive: true });
    writeCatalogSetupFixture(userDataRoot, knowledgeBase.id, {
      "retrieval.profile": "balanced",
      "retrieval.strategy.configured": true,
      "retrieval.strategy.updatedAt": "2026-06-21T01:01:01.000Z"
    }, "2026-06-21T01:01:01.000Z");
    fs.writeFileSync(path.join(workspaceRoot, "manifests", "active-manifest.json"), JSON.stringify({
      kind: "knowmesh.activeManifest",
      status: "active",
      datasetVersionId: "build-no-evidence",
      target: {
        provider: "aliyun-vector",
        region: "cn-hangzhou",
        bucket: "knowmesh-vector",
        index: "textbookv1",
        accountId: "123456789012"
      },
      sidecar: {
        authoritativeStore: "oss-sidecar",
        bucket: "knowmesh-source",
        region: "cn-hangzhou",
        manifestUri: "oss://knowmesh-source/knowmesh/kb/kb-k12-all-subjects/versions/build-no-evidence/sidecar/manifest.json",
        chunks: 0
      }
    }, null, 2), "utf8");
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-no-evidence-query",
      jobs: [{
        id: "job-no-evidence-query",
        status: "completed",
        mode: "aliyun",
        template: "textbook-cn-k12",
        summary: { workspaceRoot },
        tasks: [
          { key: "scan", status: "completed" },
          { key: "merge", status: "completed" },
          { key: "pages", status: "completed" },
          { key: "clean", status: "completed" },
          { key: "retrieval-policy", status: "completed" },
          { key: "upload", status: "completed" },
          { key: "ocr", status: "completed" },
          { key: "embedding", status: "completed" },
          { key: "index", status: "completed" }
        ],
        artifacts: [
          { key: "activeManifest", path: path.join(workspaceRoot, "manifests", "active-manifest.json") }
        ]
      }]
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "六年级上册数学第三单元讲的什么"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.status, "no_evidence");
    assert.equal(body.runtime.source.kind, "aliyunVector");
    assert.equal(body.query.retrieval.cloudMatches, 0);
    assert.equal(body.query.retrieval.acceptedCitations, 0);
    assert.equal(body.citations.length, 0);
    assert.equal(body.answer.status, "no_evidence");
    assert.equal(body.answer.text, "");
    assert.match(body.answer.message.zh, /不会编造答案/);
    assert.ok(body.checks.some((item) => item.key === "sources" && item.status === "fail"));
    const modelCheck = body.checks.find((item) => item.key === "model");
    assert.equal(modelCheck.status, "warn");
    assert.match(modelCheck.message.zh, /没有调用模型生成答案/);
    assert.ok(body.fixes.some((item) => item.key === "missingEvidence"));
    assert.equal(body.maintenance.queued, true);
    assert.equal(body.maintenance.issue.targetType, "query");
    assert.equal(body.maintenance.issue.reviewHref, `/kb/${knowledgeBase.id}/maintain/feedback`);
    assert.match(body.maintenance.issue.retestHref, new RegExp(`/kb/${knowledgeBase.id}/use/ask\\?question=`));
    assert.ok(requests.some((item) => item.url.includes("?queryVectors")));
    assert.ok(!requests.some((item) => item.url.includes("/chat/completions")));

    const repeatResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "六年级上册数学第三单元讲的什么"
      })
    });
    const repeatBody = await repeatResponse.json();
    const issueRows = readCatalogRows(userDataRoot, knowledgeBase.id, `
      SELECT issue_id, target_type, severity, status, reason, details_json
      FROM quality_issues
      WHERE target_type = 'query'
    `);
    const details = JSON.parse(issueRows[0].details_json);

    assert.equal(repeatResponse.status, 200);
    assert.equal(repeatBody.maintenance.issue.id, body.maintenance.issue.id);
    assert.equal(issueRows.length, 1);
    assert.equal(issueRows[0].status, "open");
    assert.equal(issueRows[0].reason, "查询没有找到可引用证据。");
    assert.equal(details.stage, "query-runtime");
    assert.equal(details.issueType, "no_evidence");
    assert.equal(details.questionPreview, "六年级上册数学第三单元讲的什么");
    assert.equal(details.occurrences, 2);
    assert.ok(details.quality.failedGates.some((item) => item.key === "evidenceFound"));
    assert.equal(details.answerText, undefined);
    assert.equal(details.citations, undefined);

    const reviewResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/review?status=open`);
    const review = await reviewResponse.json();
    assert.equal(review.review.summary.byTargetType.query, 1);
    assert.equal(review.review.items[0].targetType, "query");
    assert.match(review.review.items[0].targetHref, new RegExp(`/kb/${knowledgeBase.id}/use/ask\\?question=`));
    assert.match(review.review.items[0].details.reason.zh, /没有找到可引用证据/);

    const maintenanceStatusResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/status`);
    const maintenanceStatus = await maintenanceStatusResponse.json();
    assert.equal(maintenanceStatus.maintenance.qualityIssues.open, 1);
    assert.equal(maintenanceStatus.maintenance.qualityIssues.byTargetType.query, 1);
    assert.ok(maintenanceStatus.checks.some((item) => item.key === "qualityIssues" && item.status === "warn"));

    const diagnosticsResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/export`);
    const diagnostics = await diagnosticsResponse.json();
    assert.equal(diagnostics.qualityIssues.summary.open, 1);
    assert.equal(diagnostics.qualityIssues.summary.byTargetType.query, 1);
    assert.doesNotMatch(JSON.stringify(diagnostics), /六年级上册数学第三单元讲的什么/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime prefers K12 catalog lesson anchors over unit intros and checks both volumes when volume is missing", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-k12-lesson-anchor-test-"));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    const body = String(options.body || "");
    requests.push({ url: target, method, body });
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: "未指定册别时同时检查上下册：五年级上册第三单元第一课是《猎人海力布》[1]；五年级下册第三单元第一课是《汉字真有趣》[2]。"
            }
          }]
        })
      };
    }
    return { ok: true, status: 200, headers: new Map(), text: async () => "" };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "LTAI_TEST", accessKeySecret: "secret", saveTarget: "secure-local" })
    });
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });
    writeK12CatalogTocRouteFixture(userDataRoot, knowledgeBase.id);

    const queryResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "五年级统编版语文第三单元第一课是什么？"
      })
    });
    const queryBody = await queryResponse.json();
    const result = queryBody.query || {};

    assert.equal(queryResponse.status, 200);
    assert.equal(queryBody.ok, true);
    assert.equal(queryBody.status, "answered");
    assert.equal(queryBody.kind, "knowmesh.queryResult");
    assert.equal(queryBody.apiVersion, "1.0.0");
    assert.equal(queryBody.knowledgeBase.id, knowledgeBase.id);
    assert.equal(queryBody.runtime.name, "KnowMesh Query Runtime");
    assert.equal(queryBody.runtime.source.kind, "k12Catalog");
    assert.equal(queryBody.runtime.source.target, null);
    assert.equal(typeof queryBody.timing.durationMs, "number");
    assert.equal(queryBody.answer.status, "answered");
    assert.equal(queryBody.answer.reliable, true);
    assert.match(queryBody.answer.text, /猎人海力布/);
    assert.match(queryBody.answer.text, /汉字真有趣/);
    assert.equal(result.understanding.kind, "k12");
    assert.ok(result.understanding.items.some((item) => item.key === "grade" && /五年级/.test(item.value.zh)));
    assert.ok(result.understanding.items.some((item) => item.key === "subject" && /语文/.test(item.value.zh)));
    assert.ok(result.understanding.items.some((item) => item.key === "volume" && /上册和下册/.test(item.value.zh)));
    assert.ok(result.understanding.ambiguities.some((item) => item.key === "volume" && item.status === "warn"));
    assert.equal(result.retrieval.source, "k12Catalog");
    assert.equal(result.retrieval.route, "first_lesson_lookup");
    assert.equal(result.retrieval.acceptedCitations, 2);
    assert.equal(result.retrieval.rejectedCitations, 0);
    assert.deepEqual(result.retrieval.tableOrder, ["structure_nodes", "knowledge_objects", "object_relations"]);
    assert.equal(result.quality.status, "ready");
    assert.ok(result.quality.checks.some((item) => item.key === "scopeFit" && item.status === "pass"));
    assert.deepEqual(queryBody.citations.map((item) => item.id), [
      "toc-grade5-upper-u3-l1",
      "toc-grade5-lower-u3-l1"
    ]);
    assert.ok(queryBody.citations.every((item) => item.trustReasons.some((reason) => reason.key === "catalogTrace")));
    assert.ok(queryBody.citations.every((item) => item.trustReasons.some((reason) => reason.key === "lesson")));
    assert.deepEqual(queryBody.citations.map((item) => item.links.document), [
      `/kb/${knowledgeBase.id}/maintain/document?documentId=doc-grade5-chinese-v1`,
      `/kb/${knowledgeBase.id}/maintain/document?documentId=doc-grade5-chinese-v2`
    ]);
    assert.ok(queryBody.citations.every((item) => item.metadata.education.grade === "五年级"));
    assert.match(result.plan.scope.zh, /未指定册别，会同时查看上册和下册/);
    assert.doesNotMatch(JSON.stringify(queryBody.citations), /六年级/);
    assert.doesNotMatch(JSON.stringify(queryBody.citations), /民间故事的学习提示/);
    assert.equal(queryBody.feedback.endpoint, `/kb/${knowledgeBase.id}/api/query/feedback`);
    assert.ok(queryBody.feedback.actions.some((item) => item.key === "wrong_citation"));
    const queryRequest = requests.find((item) => item.url.includes("?queryVectors"));
    assert.equal(queryRequest, undefined, "K12 structure route must not query OSS Vector before catalog anchors");
    const chatRequest = requests.find((item) => item.url.includes("/chat/completions"));
    assert.ok(chatRequest, "query runtime must call Model Studio with selected citations");
    assert.match(chatRequest.body, /猎人海力布/);
    assert.match(chatRequest.body, /汉字真有趣/);
    assert.doesNotMatch(chatRequest.body, /民间故事的学习提示/);

    const emptyQueryResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "   " })
    });
    const emptyQueryBody = await emptyQueryResponse.json();
    assert.equal(emptyQueryResponse.status, 200);
    assert.equal(emptyQueryBody.ok, false);
    assert.equal(emptyQueryBody.status, "invalid_request");
    assert.equal(emptyQueryBody.error.code, "missing_question");
    assert.equal(emptyQueryBody.answer.status, "invalid_request");
    assert.deepEqual(emptyQueryBody.citations, []);

    const feedbackResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "wrong_citation",
        question: "五年级统编版语文第三单元第一课是什么？",
        resultKey: "query-runtime-1",
        citationIds: ["chunk-grade5-chinese-v1-unit3-lesson1"]
      })
    });
    const feedbackBody = await feedbackResponse.json();
    assert.equal(feedbackResponse.status, 200);
    assert.equal(feedbackBody.ok, true);
    assert.equal(feedbackBody.feedback.action, "wrong_citation");
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query feedback is stored under the current knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-feedback-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const usefulResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "useful",
        question: "五年级统编版语文第三单元第一课是什么？",
        resultKey: "adhoc-0"
      })
    });
    const usefulBody = await usefulResponse.json();
    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "wrong_citation",
        question: "五年级统编版语文第三单元第一课是什么？",
        resultKey: "adhoc-1",
        citationIds: ["chunk-grade5-chinese-v1-unit3-lesson1"],
        citationRefs: [{
          id: "chunk-grade5-chinese-v1-unit3-lesson1",
          title: "义务教育教科书·语文五年级上册",
          pageNumber: 24,
          documentHref: `/kb/${knowledgeBase.id}/maintain/documents?query=%E8%AF%AD%E6%96%87%E4%BA%94%E5%B9%B4%E7%BA%A7%E4%B8%8A%E5%86%8C`,
          excerpt: "第三单元第一课"
        }]
      })
    });
    const body = await response.json();
    const feedbackPath = path.join(userDataRoot, "knowledge-bases", knowledgeBase.id, "feedback", "query-feedback.jsonl");
    const resolutionPath = path.join(userDataRoot, "knowledge-bases", knowledgeBase.id, "feedback", "query-feedback-resolutions.jsonl");
    const records = readCatalogRows(
      userDataRoot,
      knowledgeBase.id,
      "select id, action, question, result_key, citation_ids_json, citation_refs_json from query_feedback order by created_at"
    );

    assert.equal(usefulResponse.status, 200);
    assert.equal(usefulBody.ok, true);
    assert.equal(usefulBody.feedback.action, "useful");
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.feedback.action, "wrong_citation");
    assert.equal(body.feedback.needsReview, true);
    assert.equal(body.feedback.reviewHref, `/kb/${knowledgeBase.id}/maintain/feedback`);
    assert.equal(body.feedback.retestHref, `/kb/${knowledgeBase.id}/use/ask?question=${encodeURIComponent("五年级统编版语文第三单元第一课是什么？")}`);
    assert.equal(fs.existsSync(feedbackPath), false);
    assert.equal(fs.existsSync(resolutionPath), false);
    assert.equal(records.length, 2);
    assert.equal(records[1].action, "wrong_citation");
    assert.deepEqual(JSON.parse(records[1].citation_ids_json), ["chunk-grade5-chinese-v1-unit3-lesson1"]);
    assert.equal(JSON.parse(records[1].citation_refs_json)[0].title, "义务教育教科书·语文五年级上册");
    assert.equal(JSON.parse(records[1].citation_refs_json)[0].pageNumber, 24);

    const feedbackSummaryResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback/summary`);
    const feedbackSummary = await feedbackSummaryResponse.json();
    const maintenanceResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/status`);
    const maintenance = await maintenanceResponse.json();
    assert.equal(feedbackSummaryResponse.status, 200);
    assert.equal(feedbackSummary.feedback.total, 2);
    assert.equal(feedbackSummary.feedback.open, 1);
    assert.equal(feedbackSummary.feedback.positive, 1);
    assert.equal(feedbackSummary.feedback.byAction.wrong_citation, 1);
    assert.equal(feedbackSummary.feedback.openByAction.wrong_citation, 1);
    assert.equal(feedbackSummary.feedback.recent[0].question, "五年级统编版语文第三单元第一课是什么？");
    assert.equal(feedbackSummary.feedback.recent[0].retestHref, `/kb/${knowledgeBase.id}/use/ask?question=${encodeURIComponent("五年级统编版语文第三单元第一课是什么？")}`);
    assert.equal(feedbackSummary.feedback.recent[0].citationRefs[0].documentHref, `/kb/${knowledgeBase.id}/maintain/documents?query=%E8%AF%AD%E6%96%87%E4%BA%94%E5%B9%B4%E7%BA%A7%E4%B8%8A%E5%86%8C`);
    assert.equal(feedbackSummary.feedback.recentRecords.length, 2);
    assert.equal(feedbackSummary.feedback.recentRecords[0].action, "wrong_citation");
    assert.equal(feedbackSummary.feedback.recentRecords[1].action, "useful");
    assert.equal(maintenanceResponse.status, 200);
    assert.equal(maintenance.maintenance.feedback, undefined);
    assert.equal(maintenance.maintenance.diagnostics.some((item) => item.key === "queryFeedback"), false);

    const resolveResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: body.feedback.id, message: "已检查引用并补充来源。" })
    });
    const resolveBody = await resolveResponse.json();
    assert.equal(resolveResponse.status, 200);
    assert.equal(resolveBody.ok, true);
    assert.equal(resolveBody.resolved, true);
    assert.equal(resolveBody.feedback.resolution.message, "已检查引用并补充来源。");
    assert.equal(fs.existsSync(resolutionPath), false);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select count(*) from query_feedback_resolutions"), 1);

    const duplicateResolveResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: body.feedback.id, message: "重复点击不应新增记录。" })
    });
    const duplicateResolveBody = await duplicateResolveResponse.json();
    assert.equal(duplicateResolveResponse.status, 200);
    assert.equal(duplicateResolveBody.ok, true);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select count(*) from query_feedback_resolutions"), 1);

    const resolvedFeedbackSummaryResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback/summary`);
    const resolvedFeedbackSummary = await resolvedFeedbackSummaryResponse.json();
    assert.equal(resolvedFeedbackSummary.feedback.open, 0);
    assert.equal(resolvedFeedbackSummary.feedback.resolved, 1);
    assert.equal(resolvedFeedbackSummary.feedback.positive, 1);
    assert.equal(resolvedFeedbackSummary.feedback.recentRecords[0].resolved, true);
    assert.equal(resolvedFeedbackSummary.feedback.recentRecords[0].resolution.message, "已检查引用并补充来源。");
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("stale query feedback jsonl written after sqlite initialization is cleaned without entering feedback summary", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-feedback-stale-json-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const feedbackPath = path.join(userDataRoot, "knowledge-bases", knowledgeBase.id, "feedback", "query-feedback.jsonl");
    const resolutionPath = path.join(userDataRoot, "knowledge-bases", knowledgeBase.id, "feedback", "query-feedback-resolutions.jsonl");
    const qaFeedbackPath = path.join(userDataRoot, "knowledge-bases", knowledgeBase.id, "feedback", "qa-feedback.jsonl");
    fs.mkdirSync(path.dirname(feedbackPath), { recursive: true });
    fs.writeFileSync(feedbackPath, `${JSON.stringify({
      id: "stale-feedback-jsonl",
      action: "wrong_citation",
      question: "stale question",
      resultKey: "stale-result",
      createdAt: "2026-06-01T00:00:00.000Z"
    })}\n`, "utf8");
    fs.writeFileSync(resolutionPath, `${JSON.stringify({
      id: "stale-resolution-jsonl",
      feedbackId: "stale-feedback-jsonl",
      message: "stale resolution",
      createdAt: "2026-06-01T00:00:01.000Z"
    })}\n`, "utf8");
    fs.writeFileSync(qaFeedbackPath, `${JSON.stringify({
      id: "stale-qa-feedback-jsonl",
      question: "stale qa feedback question",
      createdAt: "2026-06-01T00:00:02.000Z"
    })}\n`, "utf8");

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/feedback/summary`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.feedback.total, 0);
    assert.equal(body.feedback.open, 0);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select count(*) from query_feedback"), 0);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select count(*) from query_feedback_resolutions"), 0);
    assert.equal(fs.existsSync(feedbackPath), false);
    assert.equal(fs.existsSync(resolutionPath), false);
    assert.equal(fs.existsSync(qaFeedbackPath), false);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime contract is scoped to the current knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-contract-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/contract`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "knowmesh.queryContract");
    assert.equal(body.apiVersion, "1.0.0");
    assert.equal(body.knowledgeBase.id, knowledgeBase.id);
    assert.equal(body.endpoints.query.path, `/kb/${knowledgeBase.id}/api/query`);
    assert.equal(body.endpoints.feedback.path, `/kb/${knowledgeBase.id}/api/query/feedback`);
    assert.equal(body.endpoints.feedbackSummary.path, `/kb/${knowledgeBase.id}/api/query/feedback/summary`);
    assert.equal(body.endpoints.feedbackResolve.path, `/kb/${knowledgeBase.id}/api/query/feedback/resolve`);
    assert.equal(body.endpoints.plan.path, `/kb/${knowledgeBase.id}/api/query/plan`);
    assert.equal(body.endpoints.diagnostics.path, `/kb/${knowledgeBase.id}/api/maintenance/status`);
    assert.deepEqual(body.routePlanner.routes, ["k12Catalog", "structureCatalog", "hybridRetrieval"]);
    assert.ok(body.routePlanner.qualityGates.includes("displaySerialization"));
    assert.deepEqual(body.request.required, ["question"]);
    assert.ok(body.response.statusValues.includes("answered"));
    assert.ok(body.feedback.actions.some((item) => item.key === "wrong_citation"));
    assert.ok(body.feedback.actions.some((item) => item.key === "useful" && item.needsReview === false));
    assert.deepEqual(body.feedback.review.reviewActions, ["wrong_citation", "missed_point"]);
    assert.deepEqual(body.feedback.review.positiveActions, ["useful"]);
    assert.equal(body.feedback.review.summaryEndpoint, `/kb/${knowledgeBase.id}/api/query/feedback/summary`);
    assert.deepEqual(body.examples.flow.map((item) => item.key), ["query", "render", "cite", "feedback"]);
    assert.equal(body.examples.query.endpoint, `/kb/${knowledgeBase.id}/api/query`);
    assert.equal(body.examples.query.successHandling.condition, "ok === true && status === 'answered'");
    assert.ok(body.examples.query.fallbackHandling.render.includes("error.message"));
    assert.equal(body.examples.feedback.endpoint, `/kb/${knowledgeBase.id}/api/query/feedback`);
    assert.equal(body.examples.feedback.positive.action, "useful");
    assert.equal(body.examples.feedback.positive.needsReview, false);
    assert.deepEqual(body.examples.feedback.needsReview.map((item) => item.action), ["wrong_citation", "missed_point"]);
    assert.deepEqual(body.examples.feedback.needsReview.map((item) => item.needsReview), [true, true]);
    assert.equal(body.examples.feedback.request.citationIds[0], "citation-id-from-query-response");
    assert.equal(body.examples.feedback.request.citationRefs[0].documentHref, `/kb/${knowledgeBase.id}/maintain/document?documentId=source-document-id`);
    assert.equal(body.examples.plan.endpoint, `/kb/${knowledgeBase.id}/api/query/plan`);
    assert.ok(body.integrationNotes.zh.some((item) => item.includes("Query Runtime")));

    const planResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "五年级统编版语文第三单元第一课是什么？" })
    });
    const plan = await planResponse.json();

    assert.equal(planResponse.status, 200);
    assert.equal(plan.kind, "knowmesh.queryRoutePlan");
    assert.equal(plan.domain, "k12");
    assert.equal(plan.intent, "first_lesson_lookup");
    assert.equal(plan.route.key, "k12Catalog");
    assert.ok(plan.qualityGates.some((gate) => gate.key === "citationTraceability"));
    assert.ok(plan.qualityGates.some((gate) => gate.key === "displaySerialization"));
    assert.doesNotMatch(JSON.stringify(plan), /secret|apiKey|rawText|documentText/i);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("answer feedback review stays isolated by knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-feedback-isolation-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const k12 = await createK12TestKnowledgeBase(service);
    const docsResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "kb-general-docs", name: "企业制度库", template: "general-docs" })
    });
    const docs = await docsResponse.json();

    const feedbackResponse = await fetch(`${service.url}/kb/${k12.id}/api/query/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "missed_point",
        question: "五年级统编版语文第三单元第一课是什么？",
        resultKey: "isolation-1"
      })
    });
    const feedback = await feedbackResponse.json();

    const wrongKbResolveResponse = await fetch(`${service.url}/kb/${docs.knowledgeBase.id}/api/query/feedback/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: feedback.feedback.id })
    });
    const wrongKbResolve = await wrongKbResolveResponse.json();

    const docsFeedbackResponse = await fetch(`${service.url}/kb/${docs.knowledgeBase.id}/api/query/feedback/summary`);
    const docsFeedback = await docsFeedbackResponse.json();
    const k12FeedbackBeforeResponse = await fetch(`${service.url}/kb/${k12.id}/api/query/feedback/summary`);
    const k12FeedbackBefore = await k12FeedbackBeforeResponse.json();

    const rightKbResolveResponse = await fetch(`${service.url}/kb/${k12.id}/api/query/feedback/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: feedback.feedback.id })
    });
    const rightKbResolve = await rightKbResolveResponse.json();
    const k12FeedbackAfterResponse = await fetch(`${service.url}/kb/${k12.id}/api/query/feedback/summary`);
    const k12FeedbackAfter = await k12FeedbackAfterResponse.json();

    assert.equal(docsResponse.status, 200);
    assert.equal(docs.ok, true);
    assert.equal(feedbackResponse.status, 200);
    assert.equal(feedback.ok, true);
    assert.equal(wrongKbResolveResponse.status, 200);
    assert.equal(wrongKbResolve.ok, false);
    assert.equal(wrongKbResolve.error.code, "feedback_not_found");
    assert.equal(docsFeedback.feedback.total, 0);
    assert.equal(docsFeedback.feedback.open, 0);
    assert.equal(k12FeedbackBefore.feedback.total, 1);
    assert.equal(k12FeedbackBefore.feedback.open, 1);
    assert.equal(rightKbResolveResponse.status, 200);
    assert.equal(rightKbResolve.ok, true);
    assert.equal(rightKbResolve.resolved, true);
    assert.equal(k12FeedbackAfter.feedback.total, 1);
    assert.equal(k12FeedbackAfter.feedback.open, 0);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("maintenance review API reads and resolves catalog quality issues without stale review jsonl", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-maintenance-review-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-review-fixture");
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "review"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "artifacts", "review", "review-queue.jsonl"), `${JSON.stringify({
      chunk_id: "stale-jsonl-review",
      document_id: "stale-jsonl-doc",
      quality: { tier: "archive" },
      reason: "这个旧 JSONL 项不应出现在维护 API。"
    })}\n`, "utf8");
    writeCatalogQualityIssueFixture(userDataRoot, knowledgeBase.id, {
      issueId: "issue-clean-doc-1",
      targetType: "document",
      targetId: "ver-review-doc",
      severity: "review",
      status: "open",
      reason: "旧版 Word 需要兼容转换后复核。",
      details: {
        stage: "clean",
        document_id: "doc-review",
        version_id: "ver-review-doc",
        title: "五年级数学复习资料",
        relativePath: "小学/数学/五年级/复习资料.doc",
        sourceType: "doc"
      }
    });
    writeCatalogQualityIssueFixture(userDataRoot, knowledgeBase.id, {
      issueId: "issue-low-chunk-1",
      targetType: "chunk",
      targetId: "chunk-low-quality",
      severity: "archive",
      status: "resolved",
      reason: "内容过短，需要确认是否是页眉。",
      details: {
        stage: "quality-lifecycle",
        document_id: "doc-review",
        chunk_id: "chunk-low-quality",
        title: "五年级数学复习资料",
        sourceUri: "小学/数学/五年级/复习资料.doc",
        page_start: 1,
        quality: { tier: "archive", reasons: ["内容过短，需要确认是否是页眉。"] }
      }
    });

    const reviewResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/review?status=open&limit=10`);
    const review = await reviewResponse.json();

    assert.equal(reviewResponse.status, 200);
    assert.equal(review.ok, true);
    assert.equal(review.kind, "knowmesh.maintenanceReview");
    assert.equal(review.review.summary.total, 2);
    assert.equal(review.review.summary.open, 1);
    assert.equal(review.review.summary.resolved, 1);
    assert.equal(review.review.items.length, 1);
    assert.equal(review.review.items[0].id, "issue-clean-doc-1");
    assert.equal(review.review.items[0].targetType, "document");
    assert.equal(review.review.items[0].details.stage, "clean");
    assert.match(review.review.items[0].targetHref, new RegExp(`/kb/${knowledgeBase.id}/maintain/documents\\?query=`));
    assert.doesNotMatch(JSON.stringify(review), /stale-jsonl-review/);

    const resolveResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/review/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "issue-clean-doc-1", message: "已确认转换后重新导入。" })
    });
    const resolved = await resolveResponse.json();
    const resolvedDetails = JSON.parse(readCatalogRows(
      userDataRoot,
      knowledgeBase.id,
      "select details_json from quality_issues where issue_id = ?",
      ["issue-clean-doc-1"]
    )[0].details_json);

    assert.equal(resolveResponse.status, 200);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.resolved, true);
    assert.equal(resolved.issue.id, "issue-clean-doc-1");
    assert.equal(resolved.issue.status, "resolved");
    assert.equal(resolved.issue.resolution.message, "已确认转换后重新导入。");
    assert.equal(resolved.review.summary.open, 0);
    assert.equal(resolved.review.summary.resolved, 2);
    assert.equal(resolvedDetails.resolution.message, "已确认转换后重新导入。");

    const allResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/review?status=all`);
    const all = await allResponse.json();
    assert.equal(all.review.items.length, 2);
    assert.ok(all.review.items.every((item) => item.status === "resolved"));
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes architecture foundation readiness through the scoped maintenance API", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-foundation-api-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/foundation`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "knowmesh.architectureFoundation");
    assert.equal(body.phase, "phase1-architecture-foundation");
    assert.equal(body.knowledgeBase.id, "kb-k12-all-subjects");
    assert.equal(body.stateStores.jsonStateRuntime, false);
    assert.deepEqual(body.stateStores.primary, ["workspace.sqlite", "catalog.sqlite"]);
    assert.ok(body.checks.some((item) => item.key === "workspaceSqlite" && item.status === "pass"));
    assert.ok(body.checks.some((item) => item.key === "catalogSqlite" && item.status === "pass"));
    assert.equal(body.k12Migration.preserved, true);
    assert.deepEqual(body.phase2.manifests.map((item) => item.key), ["source", "extraction", "structure", "chunk", "index", "version"]);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("version diff and rollback APIs are scoped to the current knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-version-api-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    writeCatalogVersionHistoryFixture(userDataRoot, knowledgeBase.id);

    const diffResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/versions/diff?targetBuildId=build-previous`);
    const diff = await diffResponse.json();
    assert.equal(diffResponse.status, 200);
    assert.equal(diff.kind, "knowmesh.versionDiff");
    assert.equal(diff.summary.baseBuildId, "build-active");
    assert.equal(diff.summary.targetBuildId, "build-previous");
    assert.equal(diff.comparison.documents.included.delta, -3);
    assert.doesNotMatch(JSON.stringify(diff), /SECRET|raw content/);

    const previewResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/versions/rollback/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetBuildId: "build-previous" })
    });
    const preview = await previewResponse.json();
    assert.equal(previewResponse.status, 200);
    assert.equal(preview.kind, "knowmesh.versionRollbackPreview");
    assert.equal(preview.requiresConfirmation, true);
    assert.equal(preview.currentBuildId, "build-active");
    assert.equal(preview.targetBuildId, "build-previous");

    const rejectedResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/versions/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetBuildId: "build-previous" })
    });
    const rejected = await rejectedResponse.json();
    assert.equal(rejectedResponse.status, 409);
    assert.equal(rejected.error.code, "CONFIRMATION_REQUIRED");

    const rollbackResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/versions/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetBuildId: "build-previous", confirm: true })
    });
    const rollback = await rollbackResponse.json();
    assert.equal(rollbackResponse.status, 200);
    assert.equal(rollback.kind, "knowmesh.versionRollback");
    assert.equal(rollback.activatedBuildId, "build-previous");
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select active from build_versions where build_id = 'build-active'"), 0);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select active from build_versions where build_id = 'build-previous'"), 1);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select status from release_manifests where release_id = 'release-active'"), "published");
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select status from release_manifests where release_id = 'release-previous'"), "active");
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes K12 expert readiness manifests through scoped APIs", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-expert-api-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const sourceScopeResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/k12/source-scope/gate`);
    const readinessResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/k12/readiness`);
    const structureResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/k12/structure/readiness`);
    const queryReadinessResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/k12/query/readiness`);
    const evaluationResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/k12/evaluation/manifest`);
    const diagnosticsResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/export`);
    const sourceScope = await sourceScopeResponse.json();
    const readiness = await readinessResponse.json();
    const structure = await structureResponse.json();
    const queryReadiness = await queryReadinessResponse.json();
    const evaluation = await evaluationResponse.json();
    const diagnostics = await diagnosticsResponse.json();

    assert.equal(sourceScopeResponse.status, 200);
    assert.equal(readinessResponse.status, 200);
    assert.equal(structureResponse.status, 200);
    assert.equal(queryReadinessResponse.status, 200);
    assert.equal(evaluationResponse.status, 200);
    assert.equal(diagnosticsResponse.status, 200);
    assert.equal(sourceScope.kind, "knowmesh.k12SourceScopeGate");
    assert.equal(readiness.kind, "knowmesh.k12ExpertReadiness");
    assert.equal(structure.kind, "knowmesh.k12StructureReadiness");
    assert.equal(queryReadiness.kind, "knowmesh.k12QueryReadiness");
    assert.equal(evaluation.kind, "knowmesh.k12EvaluationManifest");
    assert.equal(sourceScope.knowledgeBase.id, knowledgeBase.id);
    assert.equal(readiness.knowledgeBase.template, "textbook-cn-k12");
    assert.equal(structure.summary.status, "empty");
    assert.equal(queryReadiness.summary.status, "empty");
    assert.equal(evaluation.summary.status, "empty");
    assert.equal(diagnostics.k12Expert.sourceScopeGate.summary.status, sourceScope.summary.status);
    assert.equal(diagnostics.k12Expert.readiness.summary.status, readiness.summary.status);
    assert.equal(diagnostics.k12Expert.structureReadiness.summary.status, "empty");
    assert.equal(diagnostics.k12Expert.queryReadiness.summary.status, "empty");
    assert.equal(diagnostics.k12Expert.queryReadiness.evaluation.status, "blocked");
    assert.equal(diagnostics.k12Expert.evaluationManifest.summary.status, "empty");
    assert.equal(diagnostics.k12Expert.evaluationManifest.risks, undefined);
    assert.equal(diagnostics.queryRuntime.apiVersion, "1.0.0");
    assert.equal(diagnostics.queryRuntime.endpoints.query.path, `/kb/${knowledgeBase.id}/api/query`);
    assert.equal(diagnostics.queryRuntime.endpoints.plan.path, `/kb/${knowledgeBase.id}/api/query/plan`);
    assert.ok(diagnostics.queryRuntime.routePlanner.routes.includes("structureCatalog"));
    assert.ok(diagnostics.queryRuntime.routePlanner.qualityGates.includes("displaySerialization"));
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service exposes evaluation dashboard without leaking evaluation case text", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-evaluation-dashboard-api-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    writeCatalogEvaluationDashboardFixture(userDataRoot, knowledgeBase.id);

    const dashboardResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/evaluation/dashboard`);
    const diagnosticsResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/export`);
    const dashboard = await dashboardResponse.json();
    const diagnostics = await diagnosticsResponse.json();
    const serialized = `${JSON.stringify(dashboard)}\n${JSON.stringify(diagnostics)}`;

    assert.equal(dashboardResponse.status, 200);
    assert.equal(diagnosticsResponse.status, 200);
    assert.equal(dashboard.kind, "knowmesh.evaluationDashboard");
    assert.equal(dashboard.knowledgeBase.id, knowledgeBase.id);
    assert.equal(dashboard.summary.status, "attention");
    assert.equal(dashboard.summary.activeBuildId, "build-api-eval");
    assert.equal(dashboard.summary.cases, 3);
    assert.equal(dashboard.summary.results, 2);
    assert.equal(dashboard.summary.failed, 1);
    assert.equal(dashboard.summary.missing, 1);
    assert.equal(dashboard.failureGroups[0].category, "unit_lesson_lookup");
    assert.equal(dashboard.failureGroups[0].action.href, "/maintain/documents");
    assert.equal(dashboard.failureGroups[1].category, "out_of_scope_refusal");
    assert.equal(diagnostics.evaluationDashboard.summary.status, dashboard.summary.status);
    assert.equal(diagnostics.evaluationDashboard.summary.failed, 1);
    assert.equal(diagnostics.evaluationDashboard.failureGroups[0].category, "unit_lesson_lookup");
    assert.deepEqual(diagnostics.evaluationDashboard.privacy.excludes, ["evaluationQuestions", "expectedAnswers", "sourceContent", "answerText"]);
    assert.doesNotMatch(serialized, /private evaluation question api/);
    assert.doesNotMatch(serialized, /private expected answer api/);
    assert.doesNotMatch(serialized, /private failure detail api/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service creates targeted rerun jobs from scoped catalog previews", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-targeted-rerun-api-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    writeCatalogTargetedRerunFixture(userDataRoot, knowledgeBase.id);

    const previewResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/rerun/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "pageRange", documentId: "doc-rerun-api", startPage: 2, endPage: 2 })
    });
    const confirmResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/rerun/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "pageRange", documentId: "doc-rerun-api", startPage: 2, endPage: 2, mode: "local" })
    });
    const preview = await previewResponse.json();
    const confirm = await confirmResponse.json();
    const latestResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/jobs/latest`);
    const latest = await latestResponse.json();
    const serialized = `${JSON.stringify(preview)}\n${JSON.stringify(confirm)}\n${JSON.stringify(latest)}`;

    assert.equal(previewResponse.status, 200);
    assert.equal(confirmResponse.status, 200);
    assert.equal(latestResponse.status, 200);
    assert.equal(preview.kind, "knowmesh.targetedRerunPreview");
    assert.equal(preview.summary.documents, 1);
    assert.equal(preview.summary.pages, 1);
    assert.equal(preview.summary.retryablePages, 1);
    assert.equal(confirm.kind, "knowmesh.targetedRerunConfirm");
    assert.equal(confirm.job.kind, "knowmesh.targetedRerunJob");
    assert.equal(confirm.job.targetedRerun.summary.pages, 1);
    assert.equal(latest.job.id, confirm.job.id);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "SELECT job_id FROM jobs WHERE job_id = ?", [confirm.job.id]), confirm.job.id);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "SELECT count(*) FROM task_steps WHERE job_id = ?", [confirm.job.id]), 6);
    assert.doesNotMatch(serialized, /private rerun page text/);
    assert.doesNotMatch(serialized, /private rerun retry text/);
    assert.doesNotMatch(serialized, /private rerun failure detail/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("content graph API browses catalog objects with search quality filter and pagination", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-content-graph-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    writeCatalogContentGraphFixture(userDataRoot, knowledgeBase.id);

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/content/graph?query=${encodeURIComponent("小数除法")}&quality=primary&limit=1`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.kind, "knowmesh.contentGraph");
    assert.equal(body.graph.summary.documents, 1);
    assert.equal(body.graph.summary.chunks, 1);
    assert.equal(body.graph.summary.citations, 1);
    assert.equal(body.graph.filters.query, "小数除法");
    assert.equal(body.graph.filters.quality, "primary");
    assert.equal(body.graph.pagination.returned, 1);
    assert.equal(body.graph.documents.length, 1);
    assert.equal(body.graph.documents[0].id, "doc-math-graph");
    assert.equal(body.graph.documents[0].pages[0].pageNumber, 29);
    assert.equal(body.graph.documents[0].pages[0].blocks[0].id, "block-math-decimal");
    assert.equal(body.graph.documents[0].pages[0].objects[0].id, "object-decimal-division");
    assert.equal(body.graph.documents[0].pages[0].chunks[0].id, "chunk-decimal-division");
    assert.equal(body.graph.documents[0].pages[0].chunks[0].citations[0].pageNumber, 29);
    assert.match(body.graph.documents[0].pages[0].chunks[0].textPreview, /小数除法/);
    assert.doesNotMatch(JSON.stringify(body), /chunk-review-noise/);

    const reviewResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/content/graph?quality=review&limit=5`);
    const reviewBody = await reviewResponse.json();
    assert.equal(reviewResponse.status, 200);
    assert.equal(reviewBody.graph.summary.chunks, 1);
    assert.equal(reviewBody.graph.documents[0].pages[0].chunks[0].id, "chunk-review-noise");

    const pagedResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/content/graph?quality=all&limit=1&cursor=1`);
    const paged = await pagedResponse.json();
    assert.equal(paged.graph.pagination.cursor, "1");
    assert.equal(paged.graph.pagination.returned, 1);
    assert.equal(paged.graph.pagination.total, 2);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime uses K12 catalog structure before vector retrieval for lesson anchors", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-k12-catalog-route-test-"));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    const body = String(options.body || "");
    requests.push({ url: target, method, body });
    if (target.includes("/compatible-mode/v1/chat/completions")) {
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        text: async () => JSON.stringify({
          choices: [{
            message: {
              content: "未指定册别时同时检查上下册：五年级上册第三单元第一课是《猎人海力布》[1]；五年级下册第三单元第一课是《汉字真有趣》[2]。"
            }
          }]
        })
      };
    }
    return { ok: true, status: 200, headers: new Map(), text: async () => "" };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-test"
      })
    });
    writeK12CatalogTocRouteFixture(userDataRoot, knowledgeBase.id);

    const answerResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "五年级统编版语文第三单元第一课是什么？"
      })
    });
    const answerBody = await answerResponse.json();
    const citations = answerBody.citations || [];

    assert.equal(answerResponse.status, 200);
    assert.equal(answerBody.ok, true);
    assert.equal(answerBody.status, "answered");
    assert.deepEqual(citations.map((item) => item.metadata.lessonTitle), ["猎人海力布", "汉字真有趣"]);
    assert.ok(citations.every((item) => item.metadata.contentType === "toc_entry"));
    assert.ok(citations.every((item) => item.metadata.lessonOrder === 1));
    assert.doesNotMatch(JSON.stringify(citations), /六年级/);
    const queryRequest = requests.find((item) => item.url.includes("?queryVectors"));
    assert.equal(queryRequest, undefined, "K12 structure route must not query OSS Vector before catalog anchors");
    const chatRequest = requests.find((item) => item.url.includes("/chat/completions"));
    assert.ok(chatRequest, "query runtime must call Model Studio after catalog TOC anchors are found");
    assert.match(chatRequest.body, /课文：猎人海力布/);
    assert.match(chatRequest.body, /课文：汉字真有趣/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime refuses out-of-scope K12 questions before retrieval", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-k12-scope-refusal-test-"));
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), method: options.method || "GET", body: String(options.body || "") });
    return { ok: true, status: 200, headers: new Map(), text: async () => "" };
  };
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false, fetchImpl });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    writeK12CatalogTocRouteFixture(userDataRoot, knowledgeBase.id);

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "五年级人教版数学第三单元第一课是什么？"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.status, "out_of_scope");
    assert.equal(body.query.retrieval.source, "k12Catalog");
    assert.equal(body.query.retrieval.scanned, 0);
    assert.deepEqual(body.citations, []);
    assert.equal(body.maintenance, undefined);
    assert.equal(readCatalogScalar(userDataRoot, knowledgeBase.id, "select count(*) from quality_issues where target_type = 'query'"), 0);
    assert.equal(requests.find((item) => item.url.includes("?queryVectors")), undefined);
    assert.equal(requests.find((item) => item.url.includes("/chat/completions")), undefined);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("query runtime blocks aliyun vector manifests that have no OSS sidecar contract", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-cloud-sidecar-required-test-"));
  const cloudRequests = [];
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: async (url, options = {}) => {
      cloudRequests.push({
        method: options.method || "GET",
        url: String(url),
        body: options.body ? String(options.body) : ""
      });
      return {
        ok: true,
        status: 200,
        headers: new Map([["x-oss-request-id", "req-upgrade"]]),
        text: async () => JSON.stringify({ ok: true, requestId: "req-upgrade", accountId: "123456789012" })
      };
    }
  });
  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const workspaceRoot = path.join(userDataRoot, "workspace", "knowledge-bases", knowledgeBase.id, "versions", "build-cloud-legacy");
    const activeManifestPath = path.join(workspaceRoot, "manifests", "active-manifest.json");
    const indexRecordsPath = path.join(workspaceRoot, "artifacts", "index_records", "index-records.pending.jsonl");
    fs.mkdirSync(path.dirname(activeManifestPath), { recursive: true });
    fs.mkdirSync(path.dirname(indexRecordsPath), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "artifacts", "reports"), { recursive: true });
    fs.writeFileSync(indexRecordsPath, `${JSON.stringify({
      chunk_id: "chunk-grade5-math",
      document_id: "doc-grade5-math",
      version_id: "build-cloud-legacy",
      active: true,
      text: "五年级上册第三单元主要学习小数除法。",
      embedding: [0.1, 0.2, 0.3],
      sourceUri: "小学/数学/人教版/义务教育教科书·数学五年级上册.pdf",
      page_start: 29,
      metadata: { title: "义务教育教科书·数学五年级上册" },
      quality: { writeEnabled: true },
      status: "embedded"
    })}\n`, "utf8");
    fs.writeFileSync(activeManifestPath, JSON.stringify({
      kind: "knowmesh.activeManifest",
      status: "active",
      datasetVersionId: "build-cloud-legacy",
      target: {
        provider: "aliyun-vector",
        region: "cn-hangzhou",
        bucket: "knowmesh-vector",
        index: "textbookv1",
        accountId: "123456789012"
      }
    }, null, 2), "utf8");
    writeCatalogSetupFixture(userDataRoot, knowledgeBase.id, {
      "retrieval.profile": "balanced",
      "retrieval.strategy.configured": true,
      "retrieval.strategy.updatedAt": "2026-06-21T01:01:01.000Z",
      "aliyun.storage.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    }, "2026-06-21T01:01:01.000Z");
    writeCatalogJobStateFixture(userDataRoot, knowledgeBase.id, {
      latestJobId: "job-cloud-legacy-query",
      jobs: [{
        id: "job-cloud-legacy-query",
        status: "completed",
        mode: "aliyun",
        template: "textbook-cn-k12",
        summary: { workspaceRoot },
        tasks: [
          { key: "scan", status: "completed" },
          { key: "merge", status: "completed" },
          { key: "pages", status: "completed" },
          { key: "clean", status: "completed" },
          { key: "retrieval-policy", status: "completed" },
          { key: "upload", status: "completed" },
          { key: "ocr", status: "completed" },
          { key: "embedding", status: "completed" },
          { key: "index", status: "completed" }
        ],
        artifacts: [
          { key: "activeManifest", path: activeManifestPath },
          { key: "pendingIndexRecords", path: indexRecordsPath }
        ]
      }]
    });

    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: "人教版数学五年级上册第三单元讲的什么知识点"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.checks.some((item) => item.key === "metadataContract" && item.status === "fail"), true);
    assert.equal(body.fixes.some((item) => item.key === "metadataContractUpgrade"), true);
    assert.deepEqual(body.citations, []);

    const maintenanceResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/status`);
    const maintenance = await maintenanceResponse.json();
    assert.equal(maintenance.checks.some((item) => item.key === "metadataContract" && item.status === "fail"), true);
    assert.equal(maintenance.maintenance.diagnostics.some((item) => item.key === "metadataContract"), true);
    const contractDiagnostic = maintenance.maintenance.diagnostics.find((item) => item.key === "metadataContract");
    assert.equal(contractDiagnostic.action.label.zh, "升级契约");
    assert.equal(contractDiagnostic.action.confirmLabel.zh, "升级契约");
    assert.match(contractDiagnostic.action.confirmBody.zh, /不会重跑 OCR 或向量化/);
    assert.match(contractDiagnostic.action.confirmBody.zh, /不会删除原始资料/);
    assert.match(contractDiagnostic.action.confirmBody.zh, /完成后可重新验证问答引用/);
    assert.equal(maintenance.maintenance.templateContract.id, "textbook-cn-k12");
    assert.equal(maintenance.maintenance.templateContract.version, "1.2.0");
    assert.ok(maintenance.maintenance.templateContract.capabilities.some((item) => item.key === "metadata"));
    assert.ok(maintenance.maintenance.templateContract.gates.some((item) => item.key === "citation"));

    const credentialResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "LTAI_TEST", accessKeySecret: "secret", saveTarget: "secure-local" })
    });
    assert.equal(credentialResponse.status, 200);

    const upgradeResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/metadata-contract/upgrade`, { method: "POST" });
    const upgrade = await upgradeResponse.json();
    assert.equal(upgradeResponse.status, 200);
    assert.equal(upgrade.ok, true, JSON.stringify(upgrade));
    assert.equal(upgrade.accepted, true);
    let completedMaintenance = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const pollResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/status`);
      const pollBody = await pollResponse.json();
      if (pollBody.checks.some((item) => item.key === "metadataContract" && item.status === "pass")) {
        completedMaintenance = pollBody;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(completedMaintenance, "metadata contract upgrade should complete in background");
    assert.equal(completedMaintenance.maintenance.metadataContractProgress.status, "completed");
    assert.equal(completedMaintenance.maintenance.metadataContractProgress.completed, 1);
    assert.equal(completedMaintenance.maintenance.nextActions, undefined);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "artifacts", "sidecar", "manifest.json")), true);
    assert.equal(JSON.parse(fs.readFileSync(activeManifestPath, "utf8")).sidecar.authoritativeStore, "oss-sidecar");
    assert.ok(cloudRequests.some((item) => item.method === "PUT" && item.url.includes("/sidecar/manifest.json")));
    assert.ok(cloudRequests.some((item) => item.method === "POST" && item.url.includes("putVectors") && item.body.includes("textbookv1") && item.body.includes("sidecar")));
    const requestCountAfterFirstUpgrade = cloudRequests.length;
    const secondUpgradeResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/maintenance/metadata-contract/upgrade`, { method: "POST" });
    const secondUpgrade = await secondUpgradeResponse.json();
    assert.equal(secondUpgradeResponse.status, 200);
    assert.equal(secondUpgrade.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(cloudRequests.length, requestCountAfterFirstUpgrade);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service stores setup state without echoing secrets", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-setup-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const draftResponse = await fetch(`${service.url}/api/setup/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "project.source": "E:/repos/ChinaTextbook",
          "metadata.stage": ["小学", "初中"],
          "metadata.subject": ["语文", "物理"],
          "metadata.grade": ["一年级", "七年级"],
          "aliyun.credential.accessKeySecret": "do-not-store"
        }
      })
    });
    const stateResponse = await fetch(`${service.url}/api/setup/state`);
    const state = await stateResponse.json();
    const missingCredentialResponse = await fetch(`${service.url}/api/aliyun/permissions/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "aliyun.region": "cn-hangzhou" } })
    });
    const missingCredential = await missingCredentialResponse.json();
    const invalidSaveResponse = await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "AKID_TEST", saveTarget: "secure-local" })
    });

    assert.equal(draftResponse.status, 200);
    assert.equal(stateResponse.status, 200);
    assert.equal(state.draft["project.source"], "E:/repos/ChinaTextbook");
    assert.deepEqual(state.draft["metadata.stage"], ["小学", "初中"]);
    assert.deepEqual(state.draft["metadata.subject"], ["语文", "物理"]);
    assert.deepEqual(state.draft["metadata.grade"], ["一年级", "七年级"]);
    assert.equal(state.draft["aliyun.credential.accessKeySecret"], undefined);
    assert.equal(state.credential.configured, false);
    assert.match(state.credential.locations.secureLocal, /secrets[\\/]aliyun-credential\.json$/);
    assert.match(state.credential.locations.envFile, /\.env$/);
    assert.deepEqual(state.credential.locations.environmentVariables, [
      "ALIBABA_CLOUD_ACCESS_KEY_ID",
      "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
      "ALIYUN_OSS_ACCESS_KEY_ID",
      "ALIYUN_OSS_ACCESS_KEY_SECRET"
    ]);
    assert.equal(missingCredentialResponse.status, 200);
    assert.equal(missingCredential.ok, false);
    assert.equal(missingCredential.checks[0].status, "fail");
    assert.match(missingCredential.checks[0].label.zh, /凭证/);
    assert.equal(invalidSaveResponse.status, 400);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("aliyun search setup generates a provider-safe index name when the field is empty", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-search-index-default-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });

  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.search.action": "create",
          "aliyun.search.bucket": "knowmesh-test-vector",
          "aliyun.search.index": "",
          "aliyun.services.embedding": "text-embedding-v4"
        }
      })
    });
    const saved = await response.json();
    const stateResponse = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/state`);
    const setupState = await stateResponse.json();

    assert.equal(response.status, 200);
    assert.equal(saved.ok, true);
    assert.equal(saved.search.index, "kbk12allsubjects");
    assert.equal(setupState.search.index, "kbk12allsubjects");
    assert.ok(saved.checks.some((item) => item.key === "searchIndex" && item.status === "pass"));
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("aliyun search setup normalizes a pasted index name before saving", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-search-index-normalize-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });

  try {
    const knowledgeBase = await createK12TestKnowledgeBase(service);
    const response = await fetch(`${service.url}/kb/${knowledgeBase.id}/api/setup/aliyun/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.search.action": "create",
          "aliyun.search.bucket": "knowmesh-test-vector",
          "aliyun.search.index": "textbook-v1",
          "aliyun.services.embedding": "text-embedding-v4"
        }
      })
    });
    const saved = await response.json();

    assert.equal(response.status, 200);
    assert.equal(saved.ok, true);
    assert.equal(saved.search.index, "textbookv1");
    assert.ok(saved.checks.some((item) => item.key === "searchIndex" && item.status === "pass"));
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("aliyun account check returns only current-step readiness checks", async () => {
  const result = await checkAliyunPermissions(
    { accessKeyId: "AKID_TEST", accessKeySecret: "SECRET_TEST" },
    { "aliyun.region": "cn-hangzhou" },
    { fetchImpl: mockAliyunFetch({ identityType: "RAMUser", arn: "acs:ram::123456789012:user/KnowMesh" }) }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((item) => item.key), ["identity", "ramUser", "ossListBuckets"]);
  assert.deepEqual(result.checks.map((item) => item.status), ["pass", "pass", "pass"]);
  assert.match(result.checks[1].label.zh, /专用 RAM 用户/);
  assert.equal(result.checks.some((item) => item.key === "resourceCreation"), false);
});

test("aliyun account check blocks non RAM-user credentials", async () => {
  const result = await checkAliyunPermissions(
    { accessKeyId: "AKID_TEST", accessKeySecret: "SECRET_TEST" },
    { "aliyun.region": "cn-hangzhou" },
    { fetchImpl: mockAliyunFetch({ identityType: "Account", arn: "acs:ram::123456789012:root" }) }
  );

  assert.equal(result.ok, false);
  const ramUser = result.checks.find((item) => item.key === "ramUser");
  assert.equal(ramUser?.status, "fail");
  assert.match(ramUser?.message.zh || "", /专用 RAM 用户/);
});

test("local service tests Aliyun credentials before saving and can retest saved credentials", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-credential-flow-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const testResponse = await fetch(`${service.url}/api/setup/aliyun/credentials/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "AKID_UNSAVED",
        accessKeySecret: "unsaved-secret",
        saveTarget: "secure-local"
      })
    });
    const tested = await testResponse.json();
    const stateAfterTestResponse = await fetch(`${service.url}/api/setup/state`);
    const stateAfterTest = await stateAfterTestResponse.json();

    const saveResponse = await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "AKID_SAVED",
        accessKeySecret: "saved-secret",
        saveTarget: "secure-local"
      })
    });
    const saved = await saveResponse.json();
    const retestResponse = await fetch(`${service.url}/api/setup/aliyun/credentials/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saveTarget: "secure-local", useSavedCredential: true })
    });
    const retested = await retestResponse.json();
    const partialInputResponse = await fetch(`${service.url}/api/setup/aliyun/credentials/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "AKID_PARTIAL", saveTarget: "secure-local" })
    });
    const partialInput = await partialInputResponse.json();

    assert.equal(testResponse.status, 200);
    assert.equal(tested.credential.configured, false);
    assert.equal(tested.credential.source, "current-input");
    assert.match(tested.credential.accessKeyId, /AKID/);
    assert.equal(stateAfterTest.credential.configured, false);
    assert.equal(saveResponse.status, 200);
    assert.equal(saved.ok, true);
    assert.equal(saved.credential.configured, true);
    assert.match(saved.credential.accessKeyId, /AKID/);
    assert.equal(retestResponse.status, 200);
    assert.equal(retested.credential.configured, true);
    assert.notEqual(retested.checks[0]?.key, "credential");
    assert.equal(partialInputResponse.status, 200);
    assert.equal(partialInput.credential.configured, false);
    assert.equal(partialInput.credential.source, "current-input");
    assert.equal(partialInput.checks[0]?.key, "credential");
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service saves the Model Studio API key as a separate local credential", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-model-provider-test-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const saveResponse = await fetch(`${service.url}/api/setup/aliyun/model-provider`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        workspaceId: "",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-bailian-secret"
      })
    });
    const saved = await saveResponse.json();
    const stateResponse = await fetch(`${service.url}/api/setup/state`);
    const state = await stateResponse.json();
    const savedFile = path.join(userDataRoot, "secrets", "aliyun-model-provider.json");
    const stored = JSON.parse(fs.readFileSync(savedFile, "utf8"));

    assert.equal(saveResponse.status, 200);
    assert.equal(saved.ok, true);
    assert.equal(saved.modelProvider.configured, true);
    assert.equal(saved.modelProvider.provider, "aliyun-bailian");
    assert.equal(saved.modelProvider.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
    assert.equal(saved.modelProvider.apiKey, "sk-****cret");
    assert.equal(stateResponse.status, 200);
    assert.equal(state.modelProvider.configured, true);
    assert.equal(state.modelProvider.apiKey, "sk-****cret");
    assert.equal(state.modelProvider.apiKey.includes("sk-bailian-secret"), false);
    assert.match(state.modelProvider.locations.secureLocal, /secrets[\\/]aliyun-model-provider\.json$/);
    assert.equal(state.draft["aliyun.model.apiKey"], undefined);
    assert.equal(state.draft["aliyun.model.apiKey.configured"], true);
    assert.equal(stored.apiKey.value.includes("sk-bailian-secret"), process.platform !== "win32");
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});


test("local service routes Aliyun credential and permission checks through injected cloud fetch", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-cloud-fetch-test-"));
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: mockAliyunFetch({ identityType: "RAMUser", arn: "acs:ram::123456789012:user/KnowMesh" })
  });

  try {
    await createK12TestKnowledgeBase(service);
    const testResponse = await fetch(`${service.url}/api/setup/aliyun/credentials/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "AKID_TEST",
        accessKeySecret: "secret-test",
        saveTarget: "secure-local"
      })
    });
    const tested = await testResponse.json();

    await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "AKID_TEST",
        accessKeySecret: "secret-test",
        saveTarget: "secure-local"
      })
    });
    const permissionResponse = await fetch(`${service.url}/api/aliyun/permissions/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: { "aliyun.region": "cn-hangzhou" } })
    });
    const permissions = await permissionResponse.json();

    assert.equal(testResponse.status, 200);
    assert.equal(tested.ok, true);
    assert.equal(tested.credential.verified, true);
    assert.equal(permissionResponse.status, 200);
    assert.equal(permissions.ok, true);
    assert.deepEqual(permissions.checks.map((item) => item.key), ["identity", "ramUser", "ossListBuckets"]);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service creates source OSS bucket and vector bucket after confirmation", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-storage-create-test-"));
  const cloudRequests = [];
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: mockAliyunStorageFetch({ requests: cloudRequests })
  });

  try {
    await createK12TestKnowledgeBase(service);
    await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "AKID_SAVED",
        accessKeySecret: "saved-secret",
        saveTarget: "secure-local"
      })
    });

    const createResponse = await fetch(`${service.url}/api/aliyun/storage/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.region": "cn-hangzhou",
          "aliyun.storage.action": "create",
          "aliyun.storage.bucket": "knowmesh-source-test",
          "aliyun.search.storageMode": "separate-region",
          "aliyun.search.region": "cn-shanghai",
          "aliyun.search.bucket": "knowmesh-vector-test"
        }
      })
    });
    const created = await createResponse.json();
    const stateResponse = await fetch(`${service.url}/api/setup/state`);
    const setupState = await stateResponse.json();
    const putRequests = cloudRequests.filter((item) => item.method === "PUT");
    const ordinaryPutRequests = putRequests.filter((item) => item.url.includes(".oss-") && !item.url.includes(".oss-vectors."));
    const vectorPutRequests = putRequests.filter((item) => item.url.includes(".oss-vectors."));

    assert.equal(createResponse.status, 200);
    assert.equal(created.ok, true);
    assert.equal(created.storage.confirmed, true);
    assert.deepEqual(created.storage.operations.map((item) => item.action), ["created", "vector-created"]);
    assert.ok(created.checks.some((item) => item.key === "sourceBucketReady" && item.status === "pass"));
    assert.ok(created.checks.some((item) => item.key === "vectorBucketReady" && item.status === "pass"));
    assert.equal(putRequests.length, 2);
    assert.equal(ordinaryPutRequests.length, 1);
    assert.equal(vectorPutRequests.length, 1);
    assert.ok(ordinaryPutRequests[0].url.includes("knowmesh-source-test.oss-cn-hangzhou.aliyuncs.com"));
    assert.ok(vectorPutRequests[0].url.includes("knowmesh-vector-test-123456789012.cn-shanghai.oss-vectors.aliyuncs.com"));
    assert.ok(ordinaryPutRequests.every((item) => item.headers["x-oss-acl"] === "private"));
    assert.ok(ordinaryPutRequests.every((item) => /<StorageClass>Standard<\/StorageClass>/.test(item.body)));
    assert.ok(vectorPutRequests.every((item) => item.headers.authorization.startsWith("OSS4-HMAC-SHA256 ")));
    assert.ok(vectorPutRequests.every((item) => item.headers["x-oss-content-sha256"] === "UNSIGNED-PAYLOAD"));
    const vectorListRequests = cloudRequests.filter((item) => item.method === "GET" && item.url.includes(".oss-vectors."));
    assert.equal(vectorListRequests.length, 1);
    assertOssV4SignatureMatches(vectorListRequests[0], {
      accessKeyId: "AKID_SAVED",
      accessKeySecret: "saved-secret",
      region: "cn-shanghai",
      canonicalUri: "/acs%3Aossvector%3Acn-shanghai%3A%3A/"
    });
    assertOssV4SignatureMatches(vectorPutRequests[0], {
      accessKeyId: "AKID_SAVED",
      accessKeySecret: "saved-secret",
      region: "cn-shanghai",
      canonicalUri: "/acs%3Aossvector%3Acn-shanghai%3A123456789012%3Aknowmesh-vector-test/"
    });
    assert.equal(setupState.draft["aliyun.storage.bucket"], "knowmesh-source-test");
    assert.equal(setupState.draft["aliyun.search.bucket"], "knowmesh-vector-test");
    assert.equal(setupState.draft["aliyun.storage.confirmed"], true);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("local service binds existing source OSS bucket and vector bucket without recreating them", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-storage-bind-test-"));
  const cloudRequests = [];
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    port: 0,
    open: false,
    fetchImpl: mockAliyunStorageFetch({
      requests: cloudRequests,
      buckets: [
        { name: "knowmesh-source-existing", region: "cn-hangzhou" }
      ],
      vectorBuckets: [
        { name: "knowmesh-vector-existing", region: "cn-hangzhou" }
      ]
    })
  });

  try {
    await createK12TestKnowledgeBase(service);
    await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "AKID_SAVED",
        accessKeySecret: "saved-secret",
        saveTarget: "secure-local"
      })
    });

    const bindResponse = await fetch(`${service.url}/api/aliyun/storage/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draft: {
          "aliyun.region": "cn-hangzhou",
          "aliyun.storage.action": "use-existing",
          "aliyun.storage.bucket": "knowmesh-source-existing",
          "aliyun.search.storageMode": "same-region",
          "aliyun.search.bucket": "knowmesh-vector-existing"
        }
      })
    });
    const bound = await bindResponse.json();
    const putRequests = cloudRequests.filter((item) => item.method === "PUT");

    assert.equal(bindResponse.status, 200);
    assert.equal(bound.ok, true);
    assert.deepEqual(bound.storage.operations.map((item) => item.action), ["bound", "vector-bound"]);
    assert.equal(putRequests.length, 0);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("aliyun storage check explains missing OSS vector bucket permissions", async () => {
  const result = await checkAliyunStorage(
    { accessKeyId: "AKID_TEST", accessKeySecret: "SECRET_TEST" },
    {
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.action": "create",
      "aliyun.storage.bucket": "knowmesh-source-test",
      "aliyun.search.storageMode": "same-region",
      "aliyun.search.bucket": "knowmesh-vector-test"
    },
    {
      fetchImpl: async (url, options = {}) => {
        const target = String(url);
        const method = options.method || "GET";
        if (method === "GET" && /oss-cn-hangzhou\.aliyuncs\.com\/?$/.test(target)) {
          return textResponse("<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>");
        }
        if (method === "GET" && /\.oss-vectors\.aliyuncs\.com\/?$/.test(target)) {
          return textResponse(JSON.stringify({
            Code: "AccessDenied",
            Message: "You are forbidden to list vector buckets.",
            RequestId: "REQ_VECTOR_DENIED"
          }), { ok: false, status: 403, statusText: "Forbidden" });
        }
        throw new Error(`Unexpected Aliyun storage mock request: ${method} ${target}`);
      }
    }
  );

  const vectorLookup = result.checks.find((item) => item.key === "vectorStorageLookup");

  assert.equal(result.ok, false);
  assert.equal(vectorLookup?.status, "fail");
  assert.match(vectorLookup?.message.zh || "", /缺少读取 OSS 向量 Bucket 的权限/);
  assert.equal(vectorLookup?.remediation?.type, "aliyun-ram-policy");
  assert.deepEqual(vectorLookup?.remediation?.missingActions, ["oss:ListVectorBuckets"]);
  assert.equal(vectorLookup?.remediation?.consoleUrl, "https://ram.console.aliyun.com/users");
  assert.match(vectorLookup?.remediation?.steps?.[0]?.zh || "", /RAM 控制台/);
  assert.match(vectorLookup?.diagnostics?.code || "", /AccessDenied/);
  assert.equal(vectorLookup?.diagnostics?.status, 403);
});

test("aliyun storage check still gives a fix location when vector permission error is opaque", async () => {
  const result = await checkAliyunStorage(
    { accessKeyId: "AKID_TEST", accessKeySecret: "SECRET_TEST" },
    {
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.action": "create",
      "aliyun.storage.bucket": "knowmesh-source-test",
      "aliyun.search.storageMode": "same-region",
      "aliyun.search.bucket": "knowmesh-vector-test"
    },
    {
      fetchImpl: async (url, options = {}) => {
        const target = String(url);
        const method = options.method || "GET";
        if (method === "GET" && /oss-cn-hangzhou\.aliyuncs\.com\/?$/.test(target)) {
          return textResponse("<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>");
        }
        if (method === "GET" && /\.oss-vectors\.aliyuncs\.com\/?$/.test(target)) {
          return textResponse("Forbidden", { ok: false, status: 403, statusText: "Forbidden" });
        }
        throw new Error(`Unexpected Aliyun storage mock request: ${method} ${target}`);
      }
    }
  );

  const vectorLookup = result.checks.find((item) => item.key === "vectorStorageLookup");

  assert.equal(result.ok, false);
  assert.equal(vectorLookup?.status, "fail");
  assert.match(vectorLookup?.message.zh || "", /缺少读取 OSS 向量 Bucket 的权限/);
  assert.equal(vectorLookup?.remediation?.type, "aliyun-ram-policy");
  assert.match(vectorLookup?.remediation?.location?.zh || "", /RAM 控制台/);
  assert.deepEqual(vectorLookup?.remediation?.missingActions, ["oss:ListVectorBuckets"]);
  assert.match(vectorLookup?.remediation?.copyText || "", /oss:ListVectorBuckets/);
  assert.equal(vectorLookup?.diagnostics?.code, "403");
});

test("aliyun storage check does not diagnose OSS vector signature errors as RAM permissions", async () => {
  const result = await checkAliyunStorage(
    { accessKeyId: "AKID_TEST", accessKeySecret: "SECRET_TEST" },
    {
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.action": "create",
      "aliyun.storage.bucket": "knowmesh-source-test",
      "aliyun.search.storageMode": "same-region",
      "aliyun.search.bucket": "knowmesh-vector-test"
    },
    {
      fetchImpl: async (url, options = {}) => {
        const target = String(url);
        const method = options.method || "GET";
        if (method === "GET" && /oss-cn-hangzhou\.aliyuncs\.com\/?$/.test(target)) {
          return textResponse("<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>");
        }
        if (method === "GET" && /\.oss-vectors\.aliyuncs\.com\/?$/.test(target)) {
          return textResponse(JSON.stringify({
            Error: {
              CanonicalRequest: "GET\n/acs%3Aossvector%3Acn-hangzhou%3A%3A/",
              Message: "The request signature we calculated does not match the signature you provided."
            }
          }), {
            ok: false,
            status: 403,
            statusText: "Forbidden",
            headers: {
              "x-oss-ec": "0002-00000201",
              "x-oss-request-id": "REQ_SIGNATURE"
            }
          });
        }
        throw new Error(`Unexpected Aliyun storage mock request: ${method} ${target}`);
      }
    }
  );

  const vectorLookup = result.checks.find((item) => item.key === "vectorStorageLookup");

  assert.equal(result.ok, false);
  assert.equal(vectorLookup?.status, "fail");
  assert.equal(vectorLookup?.diagnostics?.code, "0002-00000201");
  assert.equal(vectorLookup?.remediation?.type, "aliyun-signature");
  assert.notEqual(vectorLookup?.remediation?.type, "aliyun-ram-policy");
  assert.doesNotMatch(vectorLookup?.message.zh || "", /缺少.*权限/);
});

test("local service defaults credentials to the OS user data directory and exposes safe open targets", async () => {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const tempLocalAppData = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-os-user-data-"));
  process.env.LOCALAPPDATA = tempLocalAppData;
  const service = await startLocalService({ projectRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const stateResponse = await fetch(`${service.url}/api/setup/state`);
    const state = await stateResponse.json();
    const openCredentialResponse = await fetch(`${service.url}/api/local/paths/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "credential-directory", dryRun: true })
    });
    const openCredential = await openCredentialResponse.json();
    const blockedResponse = await fetch(`${service.url}/api/local/paths/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "../package.json", dryRun: true })
    });
    const blocked = await blockedResponse.json();

    assert.equal(stateResponse.status, 200);
    assert.match(state.credential.locations.secureLocal, /KnowMesh|knowmesh/);
    assert.match(state.credential.locations.secureLocal, /secrets[\\/]aliyun-credential\.json$/);
    assert.doesNotMatch(state.credential.locations.secureLocal, /workspace[\\/]local-service/);
    assert.equal(state.credential.locations.security.method, process.platform === "win32" ? "windows-dpapi" : "file-permissions");
    assert.equal(openCredentialResponse.status, 200);
    assert.equal(openCredential.ok, true);
    assert.equal(openCredential.opened, false);
    assert.equal(openCredential.target, "credential-directory");
    assert.equal(openCredential.path, state.credential.locations.secureLocalDir);
    assert.equal(blockedResponse.status, 400);
    assert.equal(blocked.ok, false);
  } finally {
    await service.close();
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }
    fs.rmSync(tempLocalAppData, { recursive: true, force: true });
  }
});

test("local path opener uses visible OS directory commands", () => {
  const windows = buildOpenPathCommand("C:\\Users\\Wilson\\AppData\\Local\\KnowMesh\\secrets", "win32");
  const mac = buildOpenPathCommand("/Users/wilson/Library/Application Support/KnowMesh", "darwin");
  const linux = buildOpenPathCommand("/home/wilson/.local/share/knowmesh", "linux");

  assert.equal(windows.command, "explorer.exe");
  assert.deepEqual(windows.args, ["C:\\Users\\Wilson\\AppData\\Local\\KnowMesh\\secrets"]);
  assert.equal(windows.options.windowsHide, false);
  assert.equal(mac.command, "open");
  assert.deepEqual(mac.args, ["/Users/wilson/Library/Application Support/KnowMesh"]);
  assert.equal(linux.command, "xdg-open");
  assert.deepEqual(linux.args, ["/home/wilson/.local/share/knowmesh"]);
});

test("local service checks existing Aliyun environment without using saved credentials", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-existing-env-test-"));
  const tempProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-empty-project-"));
  const envNames = [
    "ALIBABA_CLOUD_ACCESS_KEY_ID",
    "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
    "ALIYUN_OSS_ACCESS_KEY_ID",
    "ALIYUN_OSS_ACCESS_KEY_SECRET"
  ];
  const originalEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  envNames.forEach((name) => delete process.env[name]);

  const service = await startLocalService({ projectRoot: tempProjectRoot, userDataRoot, port: 0, open: false });
  try {
    await createK12TestKnowledgeBase(service);
    const saveResponse = await fetch(`${service.url}/api/setup/aliyun/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessKeyId: "AKID_SAVED", accessKeySecret: "saved-secret", saveTarget: "secure-local" })
    });
    const existingResponse = await fetch(`${service.url}/api/setup/aliyun/existing/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    const existing = await existingResponse.json();

    assert.equal(saveResponse.status, 200);
    assert.equal(existingResponse.status, 200);
    assert.equal(existing.ok, false);
    assert.equal(existing.credential.configured, false);
    assert.equal(existing.credential.source, "environment");
    assert.ok(existing.checks.some((item) => item.status === "fail"));
  } finally {
    await service.close();
    envNames.forEach((name) => {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    });
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    fs.rmSync(tempProjectRoot, { recursive: true, force: true });
  }
});

function assertNoFixedHeight(css, selector) {
  const rule = cssRule(css, selector);
  assert.doesNotMatch(rule, /(^|[;\s])height\s*:/);
}

function cssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
}

function mockAliyunFetch({ identityType = "RAMUser", arn = "acs:ram::123456789012:user/KnowMesh" } = {}) {
  return async (url) => {
    const target = String(url);
    if (target.includes("sts.aliyuncs.com")) {
      return textResponse(JSON.stringify({
        IdentityType: identityType,
        AccountId: "123456789012",
        PrincipalId: "mock-principal",
        Arn: arn
      }));
    }
    if (target.includes("oss-cn-hangzhou.aliyuncs.com")) {
      return textResponse("<ListAllMyBucketsResult><Buckets><Bucket><Name>knowmesh-demo</Name><Region>cn-hangzhou</Region></Bucket></Buckets></ListAllMyBucketsResult>");
    }
    throw new Error(`Unexpected Aliyun mock request: ${target}`);
  };
}

function mockAliyunStorageFetch({ requests = [], buckets = [], vectorBuckets = [] } = {}) {
  return async (url, options = {}) => {
    const target = String(url);
    const method = options.method || "GET";
    requests.push({
      url: target,
      method,
      headers: Object.fromEntries(
        Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
      ),
      body: String(options.body || "")
    });

    if (target.includes("sts.aliyuncs.com")) {
      return textResponse(JSON.stringify({
        IdentityType: "RAMUser",
        AccountId: "123456789012",
        PrincipalId: "mock-principal",
        Arn: "acs:ram::123456789012:user/KnowMesh"
      }));
    }

    if (method === "GET" && /\.oss-vectors\.aliyuncs\.com\/?$/.test(target)) {
      const bucketJson = vectorBuckets.map((bucket) => {
        return {
          Name: `acs:ossvector:${bucket.region}:123456789012:${bucket.name}`,
          Region: bucket.region,
          Location: `oss-${bucket.region}`,
          ExtranetEndpoint: `${bucket.region}.oss-vectors.aliyuncs.com`
        };
      });
      return textResponse(JSON.stringify({
        ListAllMyBucketsResult: {
          Buckets: bucketJson
        }
      }));
    }

    if (method === "GET" && /oss-[a-z0-9-]+\.aliyuncs\.com\/?$/.test(target)) {
      const bucketXml = buckets.map((bucket) => {
        return `<Bucket><Name>${bucket.name}</Name><Region>${bucket.region}</Region></Bucket>`;
      }).join("");
      return textResponse(`<ListAllMyBucketsResult><Buckets>${bucketXml}</Buckets></ListAllMyBucketsResult>`);
    }

    if (method === "PUT" && /\.oss-vectors\.aliyuncs\.com\/?$/.test(target)) {
      return textResponse("", { status: 200 });
    }

    if (method === "PUT" && /\.oss-[a-z0-9-]+\.aliyuncs\.com\/?$/.test(target)) {
      return textResponse("", { status: 200 });
    }

    throw new Error(`Unexpected Aliyun storage mock request: ${method} ${target}`);
  };
}

function textResponse(body, options = {}) {
  const headers = Object.fromEntries(
    Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    statusText: options.statusText || "OK",
    headers: {
      get: (name) => headers[String(name).toLowerCase()] || null
    },
    text: async () => body
  };
}

function assertOssV4SignatureMatches(request, options) {
  const authorization = request.headers.authorization || "";
  const actualSignature = authorization.match(/Signature=([a-f0-9]+)/)?.[1] || "";
  const xOssDate = request.headers["x-oss-date"];
  const signedHeaderNames = Object.keys(request.headers)
    .map((key) => key.toLowerCase())
    .filter((key) => key === "content-type" || key === "content-md5" || key.startsWith("x-oss-"))
    .sort()
    .filter((key, index, names) => index === 0 || key !== names[index - 1]);
  const canonicalHeaders = signedHeaderNames
    .map((key) => `${key}:${String(request.headers[key]).trim()}\n`)
    .join("");
  const canonicalQuery = new URL(request.url).search.replace(/^\?/, "");
  const canonicalRequest = [
    request.method,
    options.canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    "",
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const signDate = xOssDate.slice(0, 8);
  const scope = `${signDate}/${options.region}/oss/aliyun_v4_request`;
  const stringToSign = [
    "OSS4-HMAC-SHA256",
    xOssDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex")
  ].join("\n");
  const signingKey = hmacSha256(
    hmacSha256(
      hmacSha256(
        hmacSha256(`aliyun_v4${options.accessKeySecret}`, signDate),
        options.region
      ),
      "oss"
    ),
    "aliyun_v4_request"
  );
  const expectedSignature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  assert.match(authorization, new RegExp(`Credential=${options.accessKeyId}/${scope}`));
  assert.equal(authorization.includes("AdditionalHeaders=host"), false);
  assert.equal(actualSignature, expectedSignature);
}

function hmacSha256(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}





