import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { syncK12ExpertStructureFromCatalog } from "./local-executor.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 build integration turns classified clean chunks into TOC unit and lesson structure", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-build-integration-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-build-integration", name: "K12 Build Integration", template: "textbook-cn-k12" });
  const plan = { project: { id: "textbook-cn-k12" } };
  const tocText = "目录\n第一单元\n1 白鹭 ........ 2\n2 落花生 ........ 7";

  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-k12-build",
      version_id: "ver-k12-build",
      title: "语文五年级上册",
      relativePath: "小学/语文/五年级/语文五年级上册.pdf",
      sourceType: "pdf",
      text: tocText
    }],
    chunks: [{
      chunk_id: "chunk-k12-build-toc",
      document_id: "doc-k12-build",
      version_id: "ver-k12-build",
      text: tocText,
      page_start: 1,
      page_end: 1,
      metadata: {
        title: "语文五年级上册",
        relativePath: "小学/语文/五年级/语文五年级上册.pdf",
        sourceType: "pdf"
      }
    }]
  }, { plan, chunksPath: "artifacts/chunks/local.jsonl", normalizedPath: "artifacts/clean/doc.json" });

  const result = syncK12ExpertStructureFromCatalog(state, { plan, job: { template: "textbook-cn-k12" } });

  assert.equal(result.toc.summary.tocEntries, 2);
  assert.equal(result.ranges.summary.units, 1);
  assert.equal(result.ranges.summary.lessons, 2);

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) FROM structure_nodes WHERE node_type = 'unit'").get()["count(*)"], 1);
    assert.equal(db.prepare("SELECT count(*) FROM structure_nodes WHERE node_type = 'lesson'").get()["count(*)"], 2);
    assert.equal(db.prepare("SELECT count(*) FROM structure_nodes WHERE node_type = 'toc_entry'").get()["count(*)"], 2);
  } finally {
    db.close();
  }
});
