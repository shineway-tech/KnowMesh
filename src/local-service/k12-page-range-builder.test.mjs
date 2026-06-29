import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { syncK12TocEntriesToCatalog } from "./k12-toc-builder.mjs";
import { syncK12UnitLessonRangesToCatalog } from "./k12-page-range-builder.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 page-range builder derives unit and lesson nodes from TOC entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-page-ranges-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-page-ranges", name: "K12 Ranges", template: "textbook-cn-k12" });
  writeTocBlockFixture(state, kb.id);
  syncK12TocEntriesToCatalog(state);

  const result = syncK12UnitLessonRangesToCatalog(state);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.k12PageRangeBuildResult");
  assert.equal(result.summary.units, 1);
  assert.equal(result.summary.lessons, 2);
  assert.deepEqual(result.units[0].lessons.map((lesson) => [lesson.title, lesson.pageStart, lesson.pageEnd]), [
    ["白鹭", 2, 6],
    ["落花生", 7, 7]
  ]);

  const db = new Database(catalogDatabasePath(state, kb.id), { readonly: true });
  try {
    const rows = db.prepare(`
      SELECT node_id, parent_id, node_type, title, page_start, page_end, path, metadata_json
      FROM structure_nodes
      WHERE node_type IN ('unit', 'lesson', 'toc_entry')
      ORDER BY node_type ASC, sort_order ASC, node_id ASC
    `).all();
    const unit = rows.find((row) => row.node_type === "unit");
    const lessons = rows.filter((row) => row.node_type === "lesson");
    const toc = rows.filter((row) => row.node_type === "toc_entry");
    const tocMetadata = JSON.parse(toc[0].metadata_json);

    assert.equal(unit.title, "第一单元");
    assert.equal(unit.page_start, 2);
    assert.equal(unit.page_end, 7);
    assert.ok(lessons.every((lesson) => lesson.parent_id === unit.node_id));
    assert.deepEqual(lessons.map((lesson) => lesson.page_end), [6, 7]);
    assert.ok(toc.every((entry) => entry.parent_id === unit.node_id));
    assert.equal(tocMetadata.lessonNodeId, lessons[0].node_id);
  } finally {
    db.close();
  }
});

function writeTocBlockFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const tocText = "目录\n第一单元\n1 白鹭 ........ 2\n2 落花生 ........ 7";
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-k12-ranges', '语文五年级上册', 'pdf', 'source.pdf', '小学/语文/五年级/语文五年级上册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash, extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('page-toc', 'doc-k12-ranges', 'ver-k12-ranges', 3, 'artifacts/pages/3.json', 'sha-page', 'completed', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO blocks (
          block_id, page_id, document_id, block_type, sort_order, text_path, text_hash, structure_path, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('block-toc', 'page-toc', 'doc-k12-ranges', 'toc_entry', 1, 'artifacts/text/toc.md', 'sha-block', '', 'primary', ?, ?, ?)
      `).run(JSON.stringify({ text: tocText, pageClassification: { primaryType: "table_of_contents" } }), now, now);
    });
    write();
  } finally {
    db.close();
  }
}
