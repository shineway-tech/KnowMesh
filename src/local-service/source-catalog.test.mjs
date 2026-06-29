import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { buildTemplateScan } from "./scan-preview.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import {
  readSourceManifestFromCatalog,
  resolveSourceManifest,
  syncSourceManifestToCatalog
} from "./source-catalog.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("source manifest resolver reports added modified missing and out-of-scope documents before sync", () => {
  const { state } = tempState("knowmesh-source-manifest-change-");
  const kb = createKnowledgeBase(state, { name: "Source Manifest 变化测试", template: "general-docs" });
  const outOfScope = sourceDocument("archive/outdated.docx", "hash-out-v1", {
    documentId: "doc-out",
    versionId: "ver-out-v1",
    sourceType: "docx",
    reason: "outside_current_scope"
  });

  const first = sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha-v1", { documentId: "doc-alpha", versionId: "ver-alpha-v1" }),
    sourceDocument("beta.txt", "hash-beta-v1", { documentId: "doc-beta", versionId: "ver-beta-v1" })
  ], [outOfScope]);
  syncSourceManifestToCatalog(state, first, { workspaceRoot: state.defaultSetupDraft["project.workspace"] });

  const second = sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha-v2", { documentId: "doc-alpha", versionId: "ver-alpha-v2" }),
    sourceDocument("gamma.txt", "hash-gamma-v1", { documentId: "doc-gamma", versionId: "ver-gamma-v1" })
  ], [outOfScope]);
  const resolved = resolveSourceManifest(state, second, { workspaceRoot: state.defaultSetupDraft["project.workspace"] });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.kind, "knowmesh.sourceManifestResolution");
  assert.equal(resolved.summary.addedDocuments, 1);
  assert.equal(resolved.summary.modifiedDocuments, 1);
  assert.equal(resolved.summary.missingDocuments, 1);
  assert.equal(resolved.summary.outOfScopeDocuments, 1);
  assert.equal(resolved.summary.needsAttention, 2);
  assert.equal(resolved.documents.find((document) => document.documentId === "doc-alpha").changeStatus, "modified");
  assert.equal(resolved.documents.find((document) => document.documentId === "doc-gamma").changeStatus, "added");
  assert.equal(resolved.missingDocuments[0].documentId, "doc-beta");
  assert.equal(resolved.excludedDocuments[0].status, "excluded");

  syncSourceManifestToCatalog(state, second, { workspaceRoot: state.defaultSetupDraft["project.workspace"] });
  const catalog = readSourceManifestFromCatalog(state);
  const alpha = catalog.documents.find((document) => document.documentId === "doc-alpha");
  const beta = catalog.documents.find((document) => document.documentId === "doc-beta");

  assert.equal(catalog.kind, "knowmesh.sourceManifest");
  assert.equal(catalog.knowledgeBase.id, kb.id);
  assert.equal(catalog.summary.includedDocuments, 2);
  assert.equal(catalog.summary.excludedDocuments, 1);
  assert.equal(catalog.summary.missingDocuments, 1);
  assert.equal(catalog.summary.changedDocuments, 1);
  assert.equal(alpha.status, "included");
  assert.deepEqual(alpha.versions.map((version) => version.status).sort(), ["missing", "planned"]);
  assert.equal(beta.status, "missing");
  assert.equal(readCatalogScalar(state, kb.id, "select status from document_versions where version_id = ?", ["ver-alpha-v1"]), "missing");
  assert.equal(readCatalogScalar(state, kb.id, "select status from document_versions where version_id = ?", ["ver-alpha-v2"]), "planned");
});

test("source manifest sync stores split logical documents with normalized paths and source parts", async () => {
  const { state, sourceRoot, workspaceRoot } = tempState("knowmesh-source-manifest-split-");
  createKnowledgeBase(state, { name: "Source Manifest 分卷测试", template: "general-docs" });
  writeText(path.join(sourceRoot, "语文", "第一册.pdf.1"), "pdf part one");
  writeText(path.join(sourceRoot, "语文", "第一册.pdf.2"), "pdf part two");
  writeText(path.join(sourceRoot, "notes with spaces", "课堂 记录.txt"), "class notes");

  const scan = await buildTemplateScan(state, {
    mode: "local",
    template: "general-docs",
    draft: state.defaultSetupDraft,
    hashFiles: true
  });
  const resolved = resolveSourceManifest(state, scan.manifest, { workspaceRoot });
  const split = resolved.documents.find((document) => document.relativePath === "语文/第一册.pdf");

  assert.equal(resolved.summary.logicalDocuments, 2);
  assert.equal(resolved.summary.sourceParts, 3);
  assert.equal(split.sourceType, "split-pdf");
  assert.equal(split.sourceParts.length, 2);
  assert.equal(split.merge.required, true);
  assert.ok(split.artifactPath.startsWith("artifacts/raw/"));

  syncSourceManifestToCatalog(state, scan.manifest, { workspaceRoot });
  const catalog = readSourceManifestFromCatalog(state);
  const catalogSplit = catalog.documents.find((document) => document.relativePath === "语文/第一册.pdf");

  assert.equal(catalog.summary.logicalDocuments, 2);
  assert.equal(catalog.summary.sourceParts, 3);
  assert.equal(catalogSplit.sourceType, "split-pdf");
  assert.deepEqual(catalogSplit.sourceParts.map((part) => part.relativePath), ["语文/第一册.pdf.1", "语文/第一册.pdf.2"]);
  assert.ok(catalog.documents.every((document) => !document.relativePath.includes("\\")));
  assert.ok(catalog.documents.every((document) => document.artifactPath.startsWith("artifacts/")));
});

function tempState(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function sourceManifest(documents, excluded = []) {
  return {
    kind: "knowmesh.sourceScanManifest",
    apiVersion: "v1",
    generatedAt: "2026-06-29T00:00:00.000Z",
    project: { id: "general-docs", name: "General Docs" },
    source: { type: "filesystem", root: "E:/资料", include: ["**/*"] },
    workspace: { root: "E:/workspace", artifactRoot: "E:/workspace/artifacts", manifests: "E:/workspace/manifests" },
    files: { scanned: documents.length + excluded.length, supported: documents.length + excluded.length, included: documents.length },
    splitPdfGroups: [],
    logicalDocuments: documents,
    scopeFilter: {
      enabled: excluded.length > 0,
      excludedDocuments: excluded.length,
      userExcludedDocuments: excluded.filter((document) => document.reason === "excluded_by_user").length,
      excluded
    },
    warnings: []
  };
}

function sourceDocument(relativePath, hash, options = {}) {
  const documentId = options.documentId || `doc-${relativePath.replace(/[^a-z0-9]+/gi, "-")}`;
  const versionId = options.versionId || `ver-${documentId}-${hash}`;
  return {
    document_id: documentId,
    version_id: versionId,
    title: path.basename(relativePath).replace(/\.[^.]+$/i, ""),
    sourceType: options.sourceType || "text",
    sourcePath: `E:/资料/${relativePath}`,
    sourceUri: `file:///E:/%E8%B5%84%E6%96%99/${encodeURIComponent(relativePath)}`,
    relativePath,
    source_fingerprint: hash,
    reason: options.reason || "",
    sourceParts: [{
      path: `E:/资料/${relativePath}`,
      uri: `file:///E:/%E8%B5%84%E6%96%99/${encodeURIComponent(relativePath)}`,
      relativePath,
      size: 32,
      sha256: hash
    }],
    merge: { required: false, outputPath: `E:/资料/${relativePath}`, status: "not_required" }
  };
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function readCatalogScalar(state, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return Object.values(db.prepare(sql).get(...params) || {})[0];
  } finally {
    db.close();
  }
}
