import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { syncK12TocEntriesToCatalog } from "./k12-toc-builder.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 TOC builder writes toc_entry structure nodes from classified catalog blocks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-toc-builder-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-toc-builder", name: "K12 TOC", template: "textbook-cn-k12" });
  writeTocBlockFixture(state, kb.id);

  const result = syncK12TocEntriesToCatalog(state);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.k12TocBuildResult");
  assert.equal(result.summary.documents, 1);
  assert.equal(result.summary.tocBlocks, 1);
  assert.equal(result.summary.tocEntries, 2);
  assert.equal(result.entries[0].title, "白鹭");
  assert.equal(result.entries[0].unitNo, 1);
  assert.equal(result.entries[0].lessonOrder, 1);
  assert.equal(result.entries[0].pageNumber, 2);

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT node_type, title, page_start, page_end, path, metadata_json
      FROM structure_nodes
      WHERE node_type = 'toc_entry'
      ORDER BY sort_order ASC
    `).all();
    const metadata = JSON.parse(rows[0].metadata_json);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.title), ["白鹭", "落花生"]);
    assert.deepEqual(rows.map((row) => row.page_start), [2, 7]);
    assert.equal(rows[0].path, "目录/第一单元/1 白鹭");
    assert.equal(metadata.sourceBlockId, "block-toc");
    assert.equal(metadata.unitNo, 1);
    assert.equal(metadata.sourceText, undefined);
    assert.doesNotMatch(JSON.stringify(rows), /private toc source/);
  } finally {
    db.close();
  }
});

function writeTocBlockFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const tocText = "目录\n第一单元 private toc source\n1 白鹭 ........ 2\n2 落花生 ........ 7";
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-toc', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-toc', 'doc-k12-toc', 'ver-k12-toc', 3, 'artifacts/pages/3.json', 'sha-page', 'completed', 'primary', ?, ?, ?)
      `).run(JSON.stringify({ pageClassification: { primaryType: "table_of_contents" } }), now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('block-toc', 'page-toc', 'doc-k12-toc', 'toc_entry', 1, 'artifacts/text/toc.md', 'sha-block', '', 'primary', ?, ?, ?)
      `).run(JSON.stringify({
        text: tocText,
        page_start: 3,
        page_end: 3,
        pageClassification: { primaryType: "table_of_contents" }
      }), now, now);
    });
    write();
  } finally {
    db.close();
  }
}
