import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { routeStructureQueryFromCatalog } from "./query-structure-route.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("structure query route resolves section and page citations from catalog", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-structure-route-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-structure-route", name: "Structure Route", template: "general-docs" });
  writeStructureRouteFixture(state, kb.id);

  const result = routeStructureQueryFromCatalog(state, {
    question: "报销制度在哪一页？"
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "evidence_found");
  assert.equal(result.route.intent, "structure_lookup");
  assert.equal(result.citations[0].metadata.nodeTitle, "报销制度");
  assert.equal(result.citations[0].pageNumber, 12);
  assert.equal(result.citations[0].document_id, "doc-policy");
  assert.doesNotMatch(JSON.stringify(result), /private reimbursement text/);
});

test("structure query route reports no evidence without scanning chunks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-structure-route-empty-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-structure-route-empty", name: "Structure Route Empty", template: "general-docs" });

  const result = routeStructureQueryFromCatalog(state, {
    question: "报销制度在哪一页？"
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "no_evidence");
  assert.equal(result.retrieval.scanned, 0);
  assert.deepEqual(result.citations, []);
});

function writeStructureRouteFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES ('doc-policy', '员工手册', 'pdf', 'policy.pdf', '制度/员工手册.pdf', 'sha-doc', 'windows', 'active', 'primary', '{}', ?, ?)
      `).run(now, now);
      db.prepare(`
        INSERT INTO structure_nodes (
          node_id, parent_id, document_id, node_type, title, sort_order, page_start, page_end, path, metadata_json, created_at, updated_at
        ) VALUES ('node-reimbursement', NULL, 'doc-policy', 'section', '报销制度', 1, 12, 15, '员工手册/报销制度', '{"private":"private reimbursement text"}', ?, ?)
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
