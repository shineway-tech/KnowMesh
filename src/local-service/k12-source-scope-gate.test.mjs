import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { readK12SourceScopeGateFromCatalog } from "./k12-source-scope-gate.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("K12 source-scope gate reads catalog documents with the same scope decisions used by scan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-source-scope-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-k12-source-scope", name: "K12 Scope", template: "textbook-cn-k12" });
  writeScopeCatalogFixture(state, kb.id, { outsideStatus: "excluded" });

  const gate = readK12SourceScopeGateFromCatalog(state);

  assert.equal(gate.ok, true);
  assert.equal(gate.kind, "knowmesh.k12SourceScopeGate");
  assert.equal(gate.knowledgeBase.id, kb.id);
  assert.equal(gate.summary.status, "pass");
  assert.equal(gate.summary.enabled, true);
  assert.equal(gate.summary.totalDocuments, 2);
  assert.equal(gate.summary.includedDocuments, 1);
  assert.equal(gate.summary.excludedDocuments, 1);
  assert.equal(gate.summary.activeOutOfScopeDocuments, 0);
  assert.equal(gate.excludedDocuments[0].reason, "subject_outside_scope");
  assert.deepEqual(gate.selected.stage, ["小学"]);
  assert.deepEqual(gate.selected.subject, ["语文"]);
  assert.deepEqual(gate.selected.grade, ["五年级"]);
  assert.doesNotMatch(JSON.stringify(gate), /private source excerpt/);
});

test("K12 source-scope gate blocks active catalog rows that drift outside the selected scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-source-scope-blocked-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-k12-source-scope-blocked", name: "K12 Scope Blocked", template: "textbook-cn-k12" });
  writeScopeCatalogFixture(state, "kb-k12-source-scope-blocked", { outsideStatus: "active" });

  const gate = readK12SourceScopeGateFromCatalog(state);

  assert.equal(gate.summary.status, "blocked");
  assert.equal(gate.summary.activeOutOfScopeDocuments, 1);
  assert.equal(gate.blockers[0].key, "activeOutOfScopeDocuments");
});

function writeScopeCatalogFixture(state, knowledgeBaseId, options = {}) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const write = db.transaction(() => {
      db.prepare(`
        INSERT INTO setup_state (id, draft_json, updated_at)
        VALUES (1, ?, ?)
      `).run(JSON.stringify({
        "project.template": "textbook-cn-k12",
        "metadata.stage": ["小学"],
        "metadata.subject": ["语文"],
        "metadata.grade": ["五年级"],
        "metadata.volume": ["上册"]
      }), now);
      const insert = db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'pdf', ?, ?, ?, 'windows', ?, 'primary', ?, ?, ?)
      `);
      insert.run(
        "doc-in-scope",
        "小学语文五年级上册",
        "source/in.pdf",
        "小学/语文/五年级/小学语文五年级上册.pdf",
        "sha-in",
        "active",
        JSON.stringify({ private: "private source excerpt" }),
        now,
        now
      );
      insert.run(
        "doc-out-scope",
        "小学数学五年级上册",
        "source/out.pdf",
        "小学/数学/五年级/小学数学五年级上册.pdf",
        "sha-out",
        options.outsideStatus || "excluded",
        "{}",
        now,
        now
      );
    });
    write();
  } finally {
    db.close();
  }
}
