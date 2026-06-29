import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 catalog sync stores page classification and content types without leaking classifier samples", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-classifier-catalog-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-classifier-catalog", name: "K12 Classifier Catalog", template: "textbook-cn-k12" });
  const tocText = "目录\n第一单元\n1 白鹭 ........ 2\n2 落花生 ........ 7";

  syncCleanArtifactsToCatalog(state, {
    normalized: [{
      document_id: "doc-k12-toc",
      version_id: "ver-k12-toc",
      title: "语文五年级上册",
      relativePath: "小学/语文/五年级/语文五年级上册.pdf",
      sourceType: "pdf",
      text: tocText
    }],
    chunks: [{
      chunk_id: "chunk-k12-toc",
      document_id: "doc-k12-toc",
      version_id: "ver-k12-toc",
      text: tocText,
      page_start: 1,
      page_end: 1,
      metadata: {
        title: "语文五年级上册",
        relativePath: "小学/语文/五年级/语文五年级上册.pdf",
        sourceType: "pdf"
      }
    }]
  }, { template: "textbook-cn-k12", chunksPath: "artifacts/chunks/local.jsonl", normalizedPath: "artifacts/clean/doc.json" });

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const block = db.prepare("SELECT block_type, metadata_json FROM blocks WHERE block_id = ?").get("chunk-k12-toc");
    const object = db.prepare("SELECT object_type FROM knowledge_objects WHERE object_id = ?").get("chunk-k12-toc:object");
    const chunk = db.prepare("SELECT metadata_json FROM chunks WHERE chunk_id = ?").get("chunk-k12-toc");
    const page = db.prepare("SELECT metadata_json FROM pages WHERE page_id = ?").get("ver-k12-toc:page:0001");
    const blockMetadata = JSON.parse(block.metadata_json);
    const chunkMetadata = JSON.parse(chunk.metadata_json);
    const pageMetadata = JSON.parse(page.metadata_json);

    assert.equal(block.block_type, "toc_entry");
    assert.equal(object.object_type, "toc_entry");
    assert.equal(blockMetadata.contentType, "toc_entry");
    assert.equal(chunkMetadata.contentType, "toc_entry");
    assert.equal(pageMetadata.pageClassification.primaryType, "table_of_contents");
    assert.equal(pageMetadata.pageClassification.sampleText, undefined);
    assert.doesNotMatch(JSON.stringify(pageMetadata.pageClassification), /白鹭/);
  } finally {
    db.close();
  }
});
