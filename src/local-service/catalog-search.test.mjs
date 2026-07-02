import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { searchCatalog } from "./catalog-search.mjs";
import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("catalog search indexes chunks and filters query evidence by metadata quality page and structure", () => {
  const { state, workspaceRoot } = tempState("knowmesh-catalog-search-");
  createKnowledgeBase(state, { name: "Searchable KB", template: "general-docs" });
  seedSourcesAndChunks(state, workspaceRoot);

  const all = searchCatalog(state, { query: "mitochondria", purpose: "queryEvidence", limit: 10 });
  assert.equal(all.ok, true);
  assert.equal(all.total, 2);
  assert.deepEqual(all.items.map((item) => item.chunkId).sort(), ["chunk-alpha-primary", "chunk-beta-primary"]);
  assert.ok(all.items.every((item) => item.qualityState === "primary"));
  assert.ok(all.items.every((item) => item.excerpt.length <= 360));
  assert.equal(all.items.find((item) => item.chunkId === "chunk-alpha-primary").citation.pageNumber, 3);
  assert.equal(all.items.find((item) => item.chunkId === "chunk-alpha-primary").metadata.sourceType, "txt");

  const maintenance = searchCatalog(state, { query: "mitochondria", purpose: "maintenance", includeReview: true, limit: 10 });
  assert.equal(maintenance.total, 3);
  assert.ok(maintenance.items.some((item) => item.chunkId === "chunk-alpha-review" && item.qualityState === "review"));

  const documentFiltered = searchCatalog(state, { query: "mitochondria", documentId: "doc-alpha", limit: 10 });
  assert.deepEqual(documentFiltered.items.map((item) => item.chunkId), ["chunk-alpha-primary"]);

  const sourceFiltered = searchCatalog(state, { query: "mitochondria", sourceType: "md", limit: 10 });
  assert.deepEqual(sourceFiltered.items.map((item) => item.chunkId), ["chunk-beta-primary"]);

  const pageFiltered = searchCatalog(state, { query: "mitochondria", pageStart: 7, pageEnd: 8, limit: 10 });
  assert.deepEqual(pageFiltered.items.map((item) => item.chunkId), ["chunk-beta-primary"]);

  const structureFiltered = searchCatalog(state, {
    query: "mitochondria",
    structureNodeId: "ver-alpha:page:0003:structure",
    limit: 10
  });
  assert.deepEqual(structureFiltered.items.map((item) => item.chunkId), ["chunk-alpha-primary"]);
});

test("catalog search fts rows follow chunk updates and deletes", () => {
  const { state, workspaceRoot } = tempState("knowmesh-catalog-search-stale-");
  const kb = createKnowledgeBase(state, { name: "Search Sync", template: "general-docs" });
  seedSourcesAndChunks(state, workspaceRoot, {
    alphaPrimaryText: "Old mitochondria wording that will be replaced."
  });

  assert.equal(searchCatalog(state, { query: "mitochondria" }).total, 2);
  assert.equal(searchCatalog(state, { query: "chlorophyll" }).total, 0);

  seedSourcesAndChunks(state, workspaceRoot, {
    alphaPrimaryText: "Fresh chlorophyll wording after the catalog update."
  });

  assert.deepEqual(searchCatalog(state, { query: "chlorophyll", documentId: "doc-alpha" }).items.map((item) => item.chunkId), ["chunk-alpha-primary"]);
  assert.equal(searchCatalog(state, { query: "mitochondria", documentId: "doc-alpha" }).total, 0);

  const db = new Database(catalogDatabasePath(state, kb.id));
  try {
    db.prepare("DELETE FROM chunks WHERE chunk_id = ?").run("chunk-alpha-primary");
  } finally {
    db.close();
  }

  assert.equal(searchCatalog(state, { query: "chlorophyll", documentId: "doc-alpha" }).total, 0);
});

test("catalog search ranks evidence with stable catalog signals and document status filters", () => {
  const { state, workspaceRoot } = tempState("knowmesh-catalog-search-ranking-");
  const kb = createKnowledgeBase(state, { name: "Search Ranking", template: "general-docs" });
  seedRankingCatalog(state, workspaceRoot, kb.id);

  const firstPage = mustSearchCatalog(state, { query: "rollback policy", limit: 2 });
  const secondPage = mustSearchCatalog(state, { query: "rollback policy", limit: 2, offset: 2 });

  assert.equal(firstPage.ok, true);
  assert.equal(firstPage.total, 4);
  assert.deepEqual(firstPage.items.map((item) => item.chunkId), [
    "chunk-title-structure-cited-feedback",
    "chunk-title-cited-weighted"
  ]);
  assert.deepEqual(secondPage.items.map((item) => item.chunkId), [
    "chunk-body-cited",
    "chunk-body-uncited"
  ]);
  assert.equal(firstPage.items[0].score > firstPage.items[1].score, true);
  assert.deepEqual(firstPage.items[0].rankingSignals, {
    titleMatch: true,
    structureMatch: true,
    citationReady: true,
    qualityWeight: 1,
    feedbackBoost: 2,
    documentStatus: "included"
  });
  assert.equal(secondPage.items[1].rankingSignals.citationReady, false);
  assert.equal(secondPage.items[1].links.evidence, `/kb/${kb.id}/maintain/documents/search?query=rollback%20policy&chunkId=chunk-body-uncited`);

  const excluded = mustSearchCatalog(state, { query: "rollback policy", documentStatus: "excluded_by_user", purpose: "maintenance", limit: 10 });
  assert.equal(excluded.total, 1);
  assert.deepEqual(excluded.items.map((item) => item.chunkId), ["chunk-excluded-document"]);

  const noExcludedByDefault = mustSearchCatalog(state, { query: "rollback policy", limit: 10 });
  assert.equal(noExcludedByDefault.items.some((item) => item.chunkId === "chunk-excluded-document"), false);
});

function mustSearchCatalog(state, input) {
  try {
    return searchCatalog(state, input);
  } catch (error) {
    throw new Error(`searchCatalog failed for ${JSON.stringify(input)}: ${error?.message || JSON.stringify(error)}`);
  }
}

function seedSourcesAndChunks(state, workspaceRoot, options = {}) {
  syncSourceManifestToCatalog(state, sourceManifest([
    sourceDocument("alpha.txt", "hash-alpha", { documentId: "doc-alpha", versionId: "ver-alpha", sourceType: "txt" }),
    sourceDocument("beta.md", "hash-beta", { documentId: "doc-beta", versionId: "ver-beta", sourceType: "md" })
  ]), { workspaceRoot });

  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      title: "Alpha",
      relativePath: "alpha.txt",
      sourceType: "txt",
      text: "Alpha source body."
    }, {
      document_id: "doc-beta",
      version_id: "ver-beta",
      title: "Beta",
      relativePath: "beta.md",
      sourceType: "md",
      text: "Beta source body."
    }],
    chunks: [{
      chunk_id: "chunk-alpha-primary",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      page_start: 3,
      page_end: 3,
      text: options.alphaPrimaryText || "Mitochondria evidence belongs to the alpha document.",
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "txt" }
    }, {
      chunk_id: "chunk-alpha-review",
      document_id: "doc-alpha",
      version_id: "ver-alpha",
      page_start: 4,
      page_end: 4,
      text: "Mitochondria draft evidence should require maintenance review.",
      quality: { tier: "review", writeEnabled: false },
      metadata: { title: "Alpha", relativePath: "alpha.txt", sourceType: "txt" }
    }, {
      chunk_id: "chunk-beta-primary",
      document_id: "doc-beta",
      version_id: "ver-beta",
      page_start: 8,
      page_end: 8,
      text: "Mitochondria evidence also appears in beta markdown.",
      metadata: { title: "Beta", relativePath: "beta.md", sourceType: "md" }
    }]
  }, {
    normalizedPath: path.join(workspaceRoot, "artifacts", "normalized", "local.normalized.json"),
    chunksPath: path.join(workspaceRoot, "artifacts", "chunks", "local-chunks.jsonl")
  });
}

function seedRankingCatalog(state, workspaceRoot, knowledgeBaseId) {
  const now = new Date("2026-07-01T00:00:00.000Z").toISOString();
  void workspaceRoot;
  const feedbackDb = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const write = feedbackDb.transaction(() => {
      insertSearchDocument(feedbackDb, {
        documentId: "doc-ranking",
        title: "Rollback Policy Handbook",
        status: "included",
        relativePath: "ranking.md",
        now
      });
      insertSearchDocument(feedbackDb, {
        documentId: "doc-excluded",
        title: "Excluded Rollback Notes",
        status: "excluded_by_user",
        relativePath: "excluded.md",
        now
      });
      feedbackDb.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order,
          page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES (?, NULL, ?, 'section', ?, 1, 1, 2, ?, '{}', ?, ?)
      `).run("node-rollback", "doc-ranking", "Rollback policy", "/Operations/Rollback policy", now, now);

      insertSearchChunk(feedbackDb, {
        chunkId: "chunk-title-structure-cited-feedback",
        documentId: "doc-ranking",
        title: "Rollback Policy Handbook",
        text: "The release rollback policy requires weekly review and a rollback-ready version.",
        pageNumber: 1,
        qualityState: "primary",
        structureNodeId: "node-rollback",
        structurePath: "/Operations/Rollback policy",
        now
      });
      insertSearchChunk(feedbackDb, {
        chunkId: "chunk-title-cited-weighted",
        documentId: "doc-ranking",
        title: "Rollback Policy Handbook",
        text: "Rollback policy evidence appears in a lower-confidence maintenance paragraph.",
        pageNumber: 2,
        qualityState: "weighted",
        now
      });
      insertSearchChunk(feedbackDb, {
        chunkId: "chunk-body-cited",
        documentId: "doc-ranking",
        title: "Operations Handbook",
        text: "A release can use the rollback policy after evidence review.",
        pageNumber: 3,
        qualityState: "primary",
        now
      });
      insertSearchChunk(feedbackDb, {
        chunkId: "chunk-body-uncited",
        documentId: "doc-ranking",
        title: "Operations Handbook",
        text: "The rollback policy is mentioned here without a page citation.",
        pageNumber: null,
        qualityState: "primary",
        cited: false,
        now
      });
      insertSearchChunk(feedbackDb, {
        chunkId: "chunk-excluded-document",
        documentId: "doc-excluded",
        title: "Excluded Rollback Notes",
        text: "Excluded rollback policy evidence must not enter query evidence by default.",
        pageNumber: 1,
        qualityState: "primary",
        now
      });
      for (const id of ["feedback-ranking-1", "feedback-ranking-2"]) {
        feedbackDb.prepare(`
          INSERT INTO query_feedback (
            id, question, action, message, result_key, citation_ids_json, citation_refs_json,
            needs_review, resolved, created_at
          ) VALUES (?, ?, 'useful', '', ?, ?, '[]', 0, 0, ?)
        `).run(
          id,
          id === "feedback-ranking-1" ? "What is the rollback policy?" : "Which answer explains rollback policy?",
          "chunk-title-structure-cited-feedback",
          JSON.stringify(["chunk-title-structure-cited-feedback:citation"]),
          now
        );
      }
    });
    try {
      write();
    } catch (error) {
      throw new Error(`direct ranking seed failed: ${error?.message || JSON.stringify(error)}`);
    }
  } finally {
    feedbackDb.close();
  }
}

function insertSearchDocument(db, input) {
  db.prepare(`
    INSERT INTO source_documents (
      document_id, title, source_type, original_path, normalized_relative_path,
      content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, 'md', ?, ?, ?, ?, ?, 'primary', ?, ?, ?)
  `).run(
    input.documentId,
    input.title,
    input.relativePath,
    input.relativePath,
    `hash-${input.documentId}`,
    process.platform,
    input.status,
    JSON.stringify({ title: input.title, sourceType: "md", relativePath: input.relativePath }),
    input.now,
    input.now
  );
}

function insertSearchChunk(db, input) {
  db.prepare(`
    INSERT INTO chunks (
      chunk_id, document_id, structure_node_id, text_hash, token_count,
      quality_state, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 20, ?, ?, ?, ?)
  `).run(
    input.chunkId,
    input.documentId,
    input.structureNodeId || null,
    `hash-${input.chunkId}`,
    input.qualityState,
    JSON.stringify({
      title: input.title,
      text: input.text,
      textPreview: input.text,
      sourceType: "md",
      relativePath: input.documentId === "doc-excluded" ? "excluded.md" : "ranking.md",
      sourceUri: input.documentId === "doc-excluded" ? "excluded.md" : "ranking.md",
      page_start: input.pageNumber,
      page_end: input.pageNumber,
      structurePath: input.structurePath || ""
    }),
    input.now,
    input.now
  );
  if (input.cited === false) return;
  db.prepare(`
    INSERT INTO citations (
      citation_id, chunk_id, document_id, structure_node_id, source_label,
      page_number, anchor, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
  `).run(
    `${input.chunkId}:citation`,
    input.chunkId,
    input.documentId,
    input.structureNodeId || null,
    input.title,
    input.pageNumber,
    JSON.stringify({
      title: input.title,
      relativePath: input.documentId === "doc-excluded" ? "excluded.md" : "ranking.md",
      sourceUri: input.documentId === "doc-excluded" ? "excluded.md" : "ranking.md",
      excerpt: input.text,
      sourceType: "md"
    }),
    input.now,
    input.now
  );
}

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
    generatedAt: "2026-06-30T00:00:00.000Z",
    project: { id: "general-docs", name: "General Docs" },
    source: { type: "filesystem", root: "E:/source", include: ["**/*"] },
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
    sourceType: options.sourceType || "txt",
    sourcePath: `E:/source/${relativePath}`,
    sourceUri: `file:///E:/source/${encodeURIComponent(relativePath)}`,
    relativePath,
    source_fingerprint: hash,
    sourceParts: [{
      path: `E:/source/${relativePath}`,
      uri: `file:///E:/source/${encodeURIComponent(relativePath)}`,
      relativePath,
      size: 32,
      sha256: hash
    }],
    merge: { required: false, outputPath: `E:/source/${relativePath}`, status: "not_required" }
  };
}
