import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { startLocalService } from "./server.mjs";
import { catalogDatabasePath } from "./storage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("catalog search API supports scoped GET and POST without cross-knowledge-base leakage", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-catalog-search-api-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const alpha = await createKnowledgeBase(service, {
      id: "kb-search-alpha",
      name: "Search Alpha",
      template: "general-docs"
    });
    const beta = await createKnowledgeBase(service, {
      id: "kb-search-beta",
      name: "Search Beta",
      template: "general-docs"
    });
    seedSearchCatalog(userDataRoot, alpha.id, {
      documentId: "doc-alpha",
      title: "Alpha Biology Notes",
      term: "mitochondria",
      reviewTerm: "mitochondria-review"
    });
    seedSearchCatalog(userDataRoot, beta.id, {
      documentId: "doc-beta",
      title: "Beta Botany Notes",
      term: "photosynthesis",
      reviewTerm: "photosynthesis-review"
    });

    await selectKnowledgeBase(service, alpha.id);

    const currentResponse = await fetch(`${service.url}/api/search?q=mitochondria&limit=1`);
    const current = await currentResponse.json();
    const scopedMissResponse = await fetch(`${service.url}/kb/${alpha.id}/api/search?q=photosynthesis`);
    const scopedMiss = await scopedMissResponse.json();
    const scopedBetaResponse = await fetch(`${service.url}/kb/${beta.id}/api/search?q=photosynthesis&sourceType=md`);
    const scopedBeta = await scopedBetaResponse.json();
    const postResponse = await fetch(`${service.url}/kb/${alpha.id}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "mitochondria",
        purpose: "maintenance",
        includeReview: true,
        limit: 2,
        offset: 1
      })
    });
    const post = await postResponse.json();

    assert.equal(currentResponse.status, 200);
    assert.equal(current.kind, "knowmesh.catalogSearch");
    assert.equal(current.knowledgeBase.id, alpha.id);
    assert.equal(current.total, 2);
    assert.equal(current.items.length, 1);
    assert.equal(current.hasMore, true);
    assert.equal(current.items[0].documentId, "doc-alpha");
    assert.match(current.items[0].excerpt, /mitochondria/i);
    assert.equal(current.items[0].links.document, `/kb/${alpha.id}/maintain/document?documentId=doc-alpha`);

    assert.equal(scopedMissResponse.status, 200);
    assert.equal(scopedMiss.total, 0);
    assert.deepEqual(scopedMiss.items, []);

    assert.equal(scopedBetaResponse.status, 200);
    assert.equal(scopedBeta.knowledgeBase.id, beta.id);
    assert.equal(scopedBeta.total, 2);
    assert.equal(scopedBeta.items[0].documentId, "doc-beta");
    assert.equal(scopedBeta.items[0].source.type, "md");

    assert.equal(postResponse.status, 200);
    assert.equal(post.knowledgeBase.id, alpha.id);
    assert.equal(post.total, 3);
    assert.equal(post.offset, 1);
    assert.equal(post.limit, 2);
    assert.equal(post.hasMore, false);
    assert.deepEqual(post.items.map((item) => item.qualityState), ["primary", "review"]);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("catalog search API requires an active knowledge base", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-catalog-search-api-empty-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const response = await fetch(`${service.url}/api/search?q=mitochondria`);
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.ok, false);
    assert.match(body.error, /Knowledge base is required/);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

async function createKnowledgeBase(service, payload) {
  const response = await fetch(`${service.url}/api/knowledge-bases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  return body.knowledgeBase;
}

async function selectKnowledgeBase(service, id) {
  const response = await fetch(`${service.url}/api/knowledge-bases/current`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id })
  });
  assert.equal(response.status, 200);
}

function seedSearchCatalog(userDataRoot, knowledgeBaseId, input) {
  const db = new Database(catalogDatabasePath({ userDataRoot }, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const versionId = `${input.documentId}:v1`;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO source_documents (
          document_id, title, source_type, original_path, normalized_relative_path,
          content_hash, platform_path_hint, status, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'md', ?, ?, ?, ?, 'included', 'primary', ?, ?, ?)
      `).run(
        input.documentId,
        input.title,
        `${input.documentId}.md`,
        `${input.documentId}.md`,
        `hash-${input.documentId}`,
        process.platform,
        JSON.stringify({ title: input.title, sourceType: "md" }),
        now,
        now
      );
      db.prepare(`
        INSERT INTO document_versions (
          version_id, document_id, display_version, content_hash, artifact_path,
          status, metadata_json, created_at, updated_at
        ) VALUES (?, ?, 'v1', ?, '', 'active', '{}', ?, ?)
      `).run(versionId, input.documentId, `hash-${input.documentId}`, now, now);
      db.prepare(`
        INSERT INTO pages (
          page_id, document_id, version_id, page_number, artifact_path, text_hash,
          extraction_state, quality_state, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, 1, '', ?, 'extracted', 'primary', '{}', ?, ?)
      `).run(`${versionId}:page:0001`, input.documentId, versionId, `text-${input.documentId}`, now, now);

      for (const [index, row] of [
        { suffix: "a", text: `${input.term} evidence one`, qualityState: "primary" },
        { suffix: "b", text: `${input.term} evidence two`, qualityState: "primary" },
        { suffix: "review", text: `${input.reviewTerm} needs review`, qualityState: "review" }
      ].entries()) {
        const chunkId = `${input.documentId}:chunk:${row.suffix}`;
        db.prepare(`
          INSERT INTO chunks (
            chunk_id, document_id, text_hash, token_count, quality_state,
            metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          chunkId,
          input.documentId,
          `hash-${chunkId}`,
          12 + index,
          row.qualityState,
          JSON.stringify({
            title: input.title,
            text: row.text,
            textPreview: row.text,
            page_start: 1,
            page_end: 1,
            sourceUri: `${input.documentId}.md`,
            metadata: { title: input.title, sourceType: "md" }
          }),
          now,
          now
        );
        db.prepare(`
          INSERT INTO citations (
            citation_id, chunk_id, document_id, page_id, source_label,
            page_number, anchor, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, '', ?, ?, ?)
        `).run(
          `${chunkId}:citation`,
          chunkId,
          input.documentId,
          `${versionId}:page:0001`,
          input.title,
          JSON.stringify({
            title: input.title,
            relativePath: `${input.documentId}.md`,
            sourceUri: `${input.documentId}.md`,
            excerpt: row.text,
            sourceType: "md"
          }),
          now,
          now
        );
      }
    })();
  } finally {
    db.close();
  }
}
