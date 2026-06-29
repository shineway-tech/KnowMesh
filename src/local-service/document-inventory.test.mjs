import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { buildTemplateScan } from "./scan-preview.mjs";
import { confirmLocalJob } from "./jobs.mjs";
import { createKnowledgeBase, switchKnowledgeBase } from "./knowledge-bases.mjs";
import { saveRetrievalStrategy } from "./setup-store.mjs";
import {
  buildDocumentListPayload,
  buildDocumentInventoryFromScan,
  excludeKnowledgeBaseDocuments,
  restoreKnowledgeBaseDocuments,
  summarizeDocumentChanges
} from "./document-inventory.mjs";
import { catalogDatabasePath } from "./storage.mjs";

function tempState() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-documents-"));
  const sourceRoot = path.join(root, "source");
  const workspaceRoot = path.join(root, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  return {
    root,
    sourceRoot,
    workspaceRoot,
    state: {
      projectRoot: root,
      userDataRoot: path.join(root, ".knowmesh"),
      defaultSetupDraft: {
        "setup.mode": "local",
        "template.id": "general-docs",
        "project.source": sourceRoot,
        "project.workspace": workspaceRoot
      }
    }
  };
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

async function scan(state) {
  return buildTemplateScan(state, {
    mode: "local",
    template: "general-docs",
    draft: state.defaultSetupDraft,
    hashFiles: true
  });
}

test("user excluded documents stay out of the current knowledge-base scan and can be restored", async () => {
  const { state, sourceRoot } = tempState();
  writeText(path.join(sourceRoot, "keep.txt"), "keep this document");
  writeText(path.join(sourceRoot, "remove.txt"), "remove this document");

  const knowledgeBase = createKnowledgeBase(state, { name: "资料排除测试", template: "general-docs" });

  excludeKnowledgeBaseDocuments(state, {
    documents: [{ relativePath: "remove.txt", title: "remove.txt" }],
    reason: "用户不希望进入当前知识库"
  });

  const legacyOverridesPath = path.join(state.userDataRoot, "knowledge-bases", knowledgeBase.id, "document-overrides.json");
  assert.equal(fs.existsSync(legacyOverridesPath), false);
  assert.equal(readCatalogScalar(state, knowledgeBase.id, "select count(*) from document_overrides"), 1);
  assert.equal(readCatalogJson(state, knowledgeBase.id, "select document_json from document_overrides where document_key = ?", ["path:remove.txt"]).title, "remove.txt");

  const excludedScan = await scan(state);
  assert.deepEqual(
    excludedScan.manifest.logicalDocuments.map((document) => document.relativePath).sort(),
    ["keep.txt"]
  );
  assert.equal(excludedScan.manifest.scopeFilter.userExcludedDocuments, 1);
  assert.equal(excludedScan.manifest.scopeFilter.excluded[0].reason, "excluded_by_user");

  const inventory = buildDocumentInventoryFromScan(excludedScan);
  assert.equal(inventory.summary.includedDocuments, 1);
  assert.equal(inventory.summary.userExcludedDocuments, 1);

  restoreKnowledgeBaseDocuments(state, {
    documents: [{ relativePath: "remove.txt" }]
  });
  assert.equal(fs.existsSync(legacyOverridesPath), false);
  assert.equal(readCatalogScalar(state, knowledgeBase.id, "select count(*) from document_overrides"), 0);

  const restoredScan = await scan(state);
  assert.deepEqual(
    restoredScan.manifest.logicalDocuments.map((document) => document.relativePath).sort(),
    ["keep.txt", "remove.txt"]
  );
});

test("stale document overrides json written after sqlite initialization is cleaned without excluding documents", async () => {
  const { state, sourceRoot } = tempState();
  writeText(path.join(sourceRoot, "keep.txt"), "keep this document");
  writeText(path.join(sourceRoot, "stale.txt"), "stale override should be ignored");
  const knowledgeBase = createKnowledgeBase(state, { name: "旧排除文件忽略测试", template: "general-docs" });
  const legacyOverridesPath = path.join(state.userDataRoot, "knowledge-bases", knowledgeBase.id, "document-overrides.json");
  fs.mkdirSync(path.dirname(legacyOverridesPath), { recursive: true });
  fs.writeFileSync(legacyOverridesPath, JSON.stringify({
    updatedAt: "2026-06-01T00:00:00.000Z",
    excluded: [{
      title: "stale.txt",
      relativePath: "stale.txt",
      reason: "stale-json"
    }]
  }, null, 2) + "\n", "utf8");

  const result = await scan(state);

  assert.deepEqual(
    result.manifest.logicalDocuments.map((document) => document.relativePath).sort(),
    ["keep.txt", "stale.txt"]
  );
  assert.equal(result.manifest.scopeFilter.userExcludedDocuments, 0);
  assert.equal(readCatalogScalar(state, knowledgeBase.id, "select count(*) from document_overrides"), 0);
  assert.equal(fs.existsSync(legacyOverridesPath), false);
});

test("confirmed jobs persist source documents and document versions in catalog", async () => {
  const { state, sourceRoot, workspaceRoot } = tempState();
  writeText(path.join(sourceRoot, "keep.txt"), "keep this document");
  writeText(path.join(sourceRoot, "notes", "math.md"), "# Math notes");
  const knowledgeBase = createKnowledgeBase(state, { name: "资料入库测试", template: "general-docs" });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const result = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result.checks));
  const documents = readCatalogRows(
    state,
    knowledgeBase.id,
    "select document_id, title, source_type, original_path, normalized_relative_path, content_hash, status, quality_state, metadata_json from source_documents order by normalized_relative_path"
  );
  const versions = readCatalogRows(
    state,
    knowledgeBase.id,
    "select version_id, document_id, display_version, content_hash, status, artifact_path, metadata_json from document_versions order by document_id"
  );
  const pages = readCatalogRows(
    state,
    knowledgeBase.id,
    "select page_id, document_id, version_id, page_number, extraction_state, quality_state, metadata_json from pages order by document_id"
  );

  assert.deepEqual(documents.map((document) => document.normalized_relative_path), ["keep.txt", "notes/math.md"]);
  assert.equal(documents[0].source_type, "text");
  assert.equal(documents[0].status, "included");
  assert.equal(documents[0].quality_state, "primary");
  assert.ok(documents.every((document) => document.original_path.includes(sourceRoot)));
  assert.ok(documents.every((document) => document.content_hash));
  assert.deepEqual(JSON.parse(documents[1].metadata_json).sourceParts.map((part) => part.relativePath), ["notes/math.md"]);
  assert.equal(versions.length, 2);
  assert.ok(versions.every((version) => version.status === "planned"));
  assert.ok(versions.every((version) => version.content_hash));
  assert.ok(versions.every((version) => version.artifact_path.startsWith("artifacts/")));
  assert.equal(pages.length, 2);
  assert.ok(pages.every((page) => page.extraction_state === "source_anchor"));
  assert.ok(pages.every((page) => page.page_number === 0));
  assert.deepEqual(pages.map((page) => JSON.parse(page.metadata_json).relativePath).sort(), ["keep.txt", "notes/math.md"]);
});

test("document list payload reads confirmed source documents from catalog", async () => {
  const { state, sourceRoot, workspaceRoot } = tempState();
  writeText(path.join(sourceRoot, "keep.txt"), "keep this document");
  writeText(path.join(sourceRoot, "notes", "math.md"), "# Math notes");
  writeText(path.join(sourceRoot, "remove.txt"), "remove this document");
  createKnowledgeBase(state, { name: "SQLite 清单测试", template: "general-docs" });
  excludeKnowledgeBaseDocuments(state, {
    documents: [{ relativePath: "remove.txt", title: "remove.txt" }],
    reason: "用户排除"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const result = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });

  assert.equal(result.ok, true, JSON.stringify(result.checks));

  const defaultList = buildDocumentListPayload(state, { listOptions: { limit: 10 } });
  assert.equal(defaultList.summary.includedDocuments, 2);
  assert.equal(defaultList.summary.excludedDocuments, 1);
  assert.equal(defaultList.summary.userExcludedDocuments, 1);
  assert.deepEqual(
    defaultList.documents.map((document) => document.relativePath).sort(),
    ["keep.txt", "notes/math.md", "remove.txt"]
  );

  const searchList = buildDocumentListPayload(state, {
    listOptions: { query: "math", filter: "included", limit: 10 }
  });
  assert.equal(searchList.resultSummary.totalMatched, 1);
  assert.deepEqual(searchList.documents.map((document) => document.relativePath), ["notes/math.md"]);

  const excludedList = buildDocumentListPayload(state, {
    listOptions: { filter: "excluded", limit: 10 }
  });
  assert.equal(excludedList.documents.length, 1);
  assert.equal(excludedList.documents[0].relativePath, "remove.txt");
  assert.equal(excludedList.documents[0].status, "excluded_by_user");
  assert.equal(excludedList.documents[0].reason, "excluded_by_user");
  assert.equal(excludedList.documents[0].userReason, "用户排除");
});

test("catalog document list reflects user exclude and restore immediately", async () => {
  const { state, sourceRoot, workspaceRoot } = tempState();
  writeText(path.join(sourceRoot, "keep.txt"), "keep this document");
  writeText(path.join(sourceRoot, "remove.txt"), "remove this document");
  createKnowledgeBase(state, { name: "Catalog 排除恢复测试", template: "general-docs" });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const result = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });
  assert.equal(result.ok, true, JSON.stringify(result.checks));

  excludeKnowledgeBaseDocuments(state, {
    documents: [{ relativePath: "remove.txt", title: "remove.txt" }],
    reason: "用户排除"
  });
  const excluded = buildDocumentListPayload(state, { listOptions: { filter: "excluded", limit: 10 } });
  assert.equal(excluded.summary.includedDocuments, 1);
  assert.equal(excluded.summary.userExcludedDocuments, 1);
  assert.deepEqual(excluded.documents.map((document) => document.relativePath), ["remove.txt"]);

  restoreKnowledgeBaseDocuments(state, { documents: [{ relativePath: "remove.txt" }] });
  const restored = buildDocumentListPayload(state, { listOptions: { limit: 10 } });
  assert.equal(restored.summary.includedDocuments, 2);
  assert.equal(restored.summary.userExcludedDocuments, 0);
  assert.deepEqual(
    restored.documents.map((document) => document.relativePath).sort(),
    ["keep.txt", "remove.txt"]
  );
});

test("document change summary reports added, modified and missing source documents", async () => {
  const { state, sourceRoot } = tempState();
  writeText(path.join(sourceRoot, "alpha.txt"), "alpha v1");
  writeText(path.join(sourceRoot, "beta.txt"), "beta v1");
  createKnowledgeBase(state, { name: "变化检测测试", template: "general-docs" });

  const initialInventory = buildDocumentInventoryFromScan(await scan(state));

  writeText(path.join(sourceRoot, "alpha.txt"), "alpha v2");
  fs.rmSync(path.join(sourceRoot, "beta.txt"));
  writeText(path.join(sourceRoot, "gamma.txt"), "gamma v1");

  const changes = summarizeDocumentChanges(initialInventory, await scan(state));
  assert.deepEqual(
    changes.added.map((document) => document.relativePath),
    ["gamma.txt"]
  );
  assert.deepEqual(
    changes.modified.map((document) => document.relativePath),
    ["alpha.txt"]
  );
  assert.deepEqual(
    changes.missing.map((document) => document.relativePath),
    ["beta.txt"]
  );
  assert.equal(changes.summary.needsAttention, 3);
});

test("document exclusions are isolated by knowledge base", async () => {
  const { state, sourceRoot } = tempState();
  writeText(path.join(sourceRoot, "shared.txt"), "same source file");

  const first = createKnowledgeBase(state, { name: "第一个知识库", template: "general-docs" });
  excludeKnowledgeBaseDocuments(state, {
    documents: [{ relativePath: "shared.txt" }],
    reason: "只排除第一个知识库"
  });

  const second = createKnowledgeBase(state, { name: "第二个知识库", template: "general-docs" });

  let secondScan = await scan(state);
  assert.deepEqual(secondScan.manifest.logicalDocuments.map((document) => document.relativePath), ["shared.txt"]);

  switchKnowledgeBase(state, first.id);
  let firstScan = await scan(state);
  assert.deepEqual(firstScan.manifest.logicalDocuments.map((document) => document.relativePath), []);
  assert.equal(firstScan.manifest.scopeFilter.userExcludedDocuments, 1);

  switchKnowledgeBase(state, second.id);
  secondScan = await scan(state);
  assert.deepEqual(secondScan.manifest.logicalDocuments.map((document) => document.relativePath), ["shared.txt"]);
});

test("document list payload is paginated and summarizes the current search result", () => {
  const { state } = tempState();
  createKnowledgeBase(state, { name: "分页资料库", template: "general-docs" });
  const includedDocuments = Array.from({ length: 80 }, (_, index) => ({
    title: `数学资料 ${String(index + 1).padStart(3, "0")}`,
    relativePath: `math/source-${String(index + 1).padStart(3, "0")}.pdf`,
    sourceType: "pdf"
  }));
  const excludedDocuments = Array.from({ length: 40 }, (_, index) => ({
    title: `英语资料 ${String(index + 1).padStart(3, "0")}`,
    relativePath: `english/source-${String(index + 1).padStart(3, "0")}.pdf`,
    sourceType: "pdf",
    reason: index % 2 === 0 ? "excluded_by_user" : "outside_scope"
  }));

  const payload = buildDocumentListPayload(state, {
    inventory: { includedDocuments, excludedDocuments },
    listOptions: { query: "数学", filter: "included", limit: 25, cursor: 25 }
  });

  assert.equal(payload.summary.totalDocuments, 120);
  assert.equal(payload.summary.includedDocuments, 80);
  assert.equal(payload.summary.excludedDocuments, 40);
  assert.equal(payload.resultSummary.totalMatched, 80);
  assert.equal(payload.resultSummary.loadedCount, 25);
  assert.equal(payload.resultSummary.showingFrom, 26);
  assert.equal(payload.resultSummary.showingTo, 50);
  assert.equal(payload.pagination.hasMore, true);
  assert.equal(payload.pagination.nextCursor, "50");
  assert.equal(payload.documents.length, 25);
  assert.ok(payload.documents.every((document) => document.relativePath.startsWith("math/")));
  assert.equal(payload.inventory, undefined);
  assert.equal(payload.includedDocuments, undefined);
  assert.equal(payload.excludedDocuments, undefined);
});

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

function readCatalogRows(state, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

