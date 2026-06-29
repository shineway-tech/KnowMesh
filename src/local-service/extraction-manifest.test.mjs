import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { readExtractionManifestFromCatalog } from "./extraction-manifest.mjs";
import { syncCleanArtifactsToCatalog, syncOcrResultsToCatalog } from "./content-catalog.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("extraction manifest reports pending work from source anchors without JSON sidecars", () => {
  const { state } = tempState("knowmesh-extraction-pending-");
  createKnowledgeBase(state, { name: "Extraction Pending", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha", { documentId: "doc-alpha", versionId: "ver-alpha" }),
    sourceDocument("beta.pdf", "hash-beta", { documentId: "doc-beta", versionId: "ver-beta", sourceType: "pdf" })
  ]), { workspaceRoot: state.defaultSetupDraft["project.workspace"] });
  fs.mkdirSync(path.join(state.defaultSetupDraft["project.workspace"], "manifests"), { recursive: true });
  fs.writeFileSync(path.join(state.defaultSetupDraft["project.workspace"], "manifests", "extraction-manifest.json"), JSON.stringify({
    kind: "stale-json",
    documents: [{ documentId: "stale-json-doc" }]
  }), "utf8");

  const manifest = readExtractionManifestFromCatalog(state);

  assert.equal(manifest.ok, true);
  assert.equal(manifest.kind, "knowmesh.extractionManifest");
  assert.equal(manifest.summary.sourceDocuments, 2);
  assert.equal(manifest.summary.sourceAnchors, 2);
  assert.equal(manifest.summary.extractionPages, 0);
  assert.equal(manifest.summary.pendingDocuments, 2);
  assert.equal(manifest.summary.completedPages, 0);
  assert.equal(manifest.summary.retryablePages, 0);
  assert.deepEqual(manifest.workItems.map((item) => item.status).sort(), ["pending", "pending"]);
  assert.doesNotMatch(JSON.stringify(manifest), /stale-json-doc/);
});

test("extraction manifest summarizes extracted recognized review and retry page states", () => {
  const { state, workspaceRoot } = tempState("knowmesh-extraction-states-");
  const kb = createKnowledgeBase(state, { name: "Extraction States", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha", { documentId: "doc-alpha", versionId: "ver-alpha" }),
    sourceDocument("beta.pdf", "hash-beta", { documentId: "doc-beta", versionId: "ver-beta", sourceType: "pdf" }),
    sourceDocument("gamma.pdf", "hash-gamma", { documentId: "doc-gamma", versionId: "ver-gamma", sourceType: "pdf" })
  ]), { workspaceRoot });
  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      title: "Alpha",
      relativePath: "alpha.txt",
      sourceType: "text",
      text: "Alpha extracted body that must not leak from the manifest."
    }],
    chunks: [{
      chunk_id: "chunk-alpha",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      text: "Alpha extracted body that must not leak from the manifest.",
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "text" }
    }]
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "local-text.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "local-chunks.jsonl")
  });
  syncOcrResultsToCatalog(state, [{
    taskId: "ocr-beta-p1",
    document_id: "doc-beta",
    version_id: "ver-beta",
    title: "Beta",
    sourceType: "pdf",
    relativePath: "beta.pdf",
    inputKind: "pdf-page",
    inputPath: path.join(workspaceRoot, "artifacts", "pages", "beta-1.png"),
    page_number: 1,
    status: "recognized",
    text: "Beta OCR text that must stay out of the manifest.",
    confidence: 55,
    model: "qwen-vl-ocr"
  }], {
    resultPath: path.join(workspaceRoot, "artifacts", "ocr", "ocr-result.jsonl")
  });
  insertFailedExtractionPage(state, kb.id, {
    documentId: "doc-gamma",
    versionId: "ver-gamma",
    pageId: "ver-gamma:page:0001",
    pageNumber: 1,
    artifactPath: "artifacts/pages/gamma-1.png",
    message: "provider timeout"
  });

  const manifest = readExtractionManifestFromCatalog(state);
  const alpha = manifest.workItems.find((item) => item.documentId === "doc-alpha");
  const beta = manifest.workItems.find((item) => item.documentId === "doc-beta");
  const gamma = manifest.workItems.find((item) => item.documentId === "doc-gamma");

  assert.equal(manifest.summary.sourceDocuments, 3);
  assert.equal(manifest.summary.sourceAnchors, 3);
  assert.equal(manifest.summary.extractionPages, 3);
  assert.equal(manifest.summary.extractedPages, 1);
  assert.equal(manifest.summary.recognizedPages, 1);
  assert.equal(manifest.summary.failedPages, 1);
  assert.equal(manifest.summary.reviewPages, 2);
  assert.equal(manifest.summary.completedPages, 2);
  assert.equal(manifest.summary.retryablePages, 1);
  assert.equal(manifest.summary.blocks, 2);
  assert.equal(alpha.status, "completed");
  assert.equal(beta.status, "review");
  assert.equal(gamma.status, "retry");
  assert.equal(beta.pages[0].confidence, 55);
  assert.equal(gamma.pages[0].retryable, true);
  assert.doesNotMatch(JSON.stringify(manifest), /Alpha extracted body/);
  assert.doesNotMatch(JSON.stringify(manifest), /Beta OCR text/);
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

function sourceManifest(documents) {
  return {
    kind: "knowmesh.sourceScanManifest",
    apiVersion: "v1",
    generatedAt: "2026-06-29T00:00:00.000Z",
    project: { id: "general-docs", name: "General Docs" },
    source: { type: "filesystem", root: "E:/资料", include: ["**/*"] },
    workspace: { root: "E:/workspace", artifactRoot: "E:/workspace/artifacts", manifests: "E:/workspace/manifests" },
    files: { scanned: documents.length, supported: documents.length, included: documents.length },
    splitPdfGroups: [],
    logicalDocuments: documents,
    scopeFilter: { enabled: false, excluded: [] },
    warnings: []
  };
}

function sourceDocument(relativePath, hash, options = {}) {
  return {
    document_id: options.documentId,
    version_id: options.versionId,
    title: path.basename(relativePath).replace(/\.[^.]+$/i, ""),
    sourceType: options.sourceType || "text",
    sourcePath: `E:/资料/${relativePath}`,
    sourceUri: `file:///E:/%E8%B5%84%E6%96%99/${encodeURIComponent(relativePath)}`,
    relativePath,
    source_fingerprint: hash,
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

function insertFailedExtractionPage(state, knowledgeBaseId, input) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO pages (
        page_id, document_id, version_id, page_number, artifact_path,
        text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, '', 'failed', 'review', ?, ?, ?)
    `).run(
      input.pageId,
      input.documentId,
      input.versionId,
      input.pageNumber,
      input.artifactPath,
      JSON.stringify({
        source: "ocr",
        message: input.message,
        retry: { retryable: true, attempts: 1, nextAction: "retry_page" }
      }),
      now,
      now
    );
  } finally {
    db.close();
  }
}
