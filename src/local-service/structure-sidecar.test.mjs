import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { readStructureSidecarFromCatalog } from "./structure-sidecar.mjs";
import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";

test("structure sidecar reads nodes and knowledge objects from catalog without stale JSON", () => {
  const { state, workspaceRoot } = tempState("knowmesh-structure-sidecar-");
  const kb = createKnowledgeBase(state, { name: "Structure Sidecar", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha", { documentId: "doc-alpha", versionId: "ver-alpha" })
  ]), { workspaceRoot });
  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      title: "Alpha",
      relativePath: "alpha.txt",
      sourceType: "text",
      text: "Alpha section body that should not leak from structure sidecar."
    }],
    chunks: [{
      chunk_id: "chunk-alpha-1",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      text: "Alpha primary body text that should stay private.",
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "text" }
    }, {
      chunk_id: "chunk-alpha-review",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      text: "Alpha review body text that should stay private.",
      quality: { tier: "review", writeEnabled: false },
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "text" }
    }]
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "local-text.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "local-chunks.jsonl")
  });
  fs.mkdirSync(path.join(workspaceRoot, "manifests"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "manifests", "structure-sidecar.json"), JSON.stringify({
    kind: "stale-json-sidecar",
    nodes: [{ id: "stale-node" }]
  }), "utf8");

  const sidecar = readStructureSidecarFromCatalog(state);
  const document = sidecar.documents.find((item) => item.documentId === "doc-alpha");

  assert.equal(sidecar.ok, true);
  assert.equal(sidecar.kind, "knowmesh.structureSidecar");
  assert.equal(sidecar.knowledgeBase.id, kb.id);
  assert.equal(sidecar.summary.status, "ready");
  assert.equal(sidecar.summary.documents, 1);
  assert.equal(sidecar.summary.structureNodes, 2);
  assert.equal(sidecar.summary.documentNodes, 1);
  assert.equal(sidecar.summary.pageNodes, 1);
  assert.equal(sidecar.summary.knowledgeObjects, 2);
  assert.equal(sidecar.summary.reviewObjects, 1);
  assert.deepEqual(sidecar.summary.objectTypes, { body_text: 2 });
  assert.equal(document.pages.length, 1);
  assert.equal(document.pages[0].objects.length, 2);
  assert.ok(document.pages[0].objects.some((item) => item.qualityState === "review"));
  assert.doesNotMatch(JSON.stringify(sidecar), /stale-node/);
  assert.doesNotMatch(JSON.stringify(sidecar), /Alpha primary body text/);
  assert.doesNotMatch(JSON.stringify(sidecar), /Alpha review body text/);
});

test("structure sidecar reports empty readiness when only source anchors exist", () => {
  const { state, workspaceRoot } = tempState("knowmesh-structure-empty-");
  createKnowledgeBase(state, { name: "Structure Empty", template: "general-docs" });
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha", { documentId: "doc-alpha", versionId: "ver-alpha" })
  ]), { workspaceRoot });

  const sidecar = readStructureSidecarFromCatalog(state);

  assert.equal(sidecar.summary.status, "empty");
  assert.equal(sidecar.summary.documents, 1);
  assert.equal(sidecar.summary.structureNodes, 0);
  assert.equal(sidecar.summary.knowledgeObjects, 0);
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
