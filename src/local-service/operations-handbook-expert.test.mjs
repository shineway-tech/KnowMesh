import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { getExpert, validateExpertAuthoringManifest } from "./expert-registry.mjs";
import { createPublicSampleKnowledgeBase, listPublicSamples } from "./public-samples.mjs";
import { retrieveQueryEvidence } from "./query-evidence.mjs";
import { catalogDatabasePath } from "./storage.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requiredObjects = [
  "policy",
  "procedure",
  "role",
  "review_cadence",
  "rollback_rule",
  "evidence_requirement"
];

test("operations handbook Expert ships schema template docs and public-safe fixtures", () => {
  const expert = getExpert("operations-handbook");
  const template = JSON.parse(fs.readFileSync(path.join(projectRoot, "src", "experts", "operations-handbook", "template.json"), "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.join(projectRoot, "src", "experts", "operations-handbook", "schema.json"), "utf8"));

  assert.equal(validateExpertAuthoringManifest(expert).ok, true);
  for (const objectType of requiredObjects) {
    assert.ok(expert.extraction.objects.includes(objectType), `registry missing ${objectType}`);
    assert.ok(template.extraction.objects.includes(objectType), `template missing ${objectType}`);
    assert.ok(schema.objects.includes(objectType), `schema missing ${objectType}`);
  }
  assert.equal(template.supportedContractVersion, "2026-07-query-runtime.1");
  assert.equal(template.sourceScope.policy, "public-handbook-scope");
  assert.deepEqual(template.queryRouteRules.map((item) => item.key), [
    "policyScopeLookup",
    "workflowStepLookup",
    "noAnswerWithoutEvidence"
  ]);
  assert.ok(expert.docs.includes("docs/experts/operations-handbook.zh-CN.md"));
  assert.ok(expert.docs.includes("docs/experts/operations-handbook.en.md"));
  for (const doc of expert.docs) assert.equal(fs.existsSync(path.join(projectRoot, doc)), true, `${doc} should exist`);
  for (const fixture of expert.fixtures) assert.equal(fs.existsSync(path.join(projectRoot, fixture)), true, `${fixture} should exist`);
  assert.doesNotMatch(JSON.stringify({ expert, template, schema }), /AccessKey|sk-|真实教材|customer|student|C:\\|E:\\/i);
});

test("operations handbook public sample writes domain objects and citation-ready evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-ops-expert-sample-"));
  const state = { projectRoot, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };

  const samples = listPublicSamples(state);
  const sample = samples.samples.find((item) => item.id === "operations-handbook");
  assert.equal(sample?.template, "operations-handbook");
  assert.equal(sample.publicSafe, true);
  assert.equal(sample.credentialFree, true);
  assert.equal(fs.existsSync(sample.sourceFile), true);

  const created = createPublicSampleKnowledgeBase(state, { sampleId: "operations-handbook" });
  assert.equal(created.ok, true);
  assert.equal(created.knowledgeBase.template, "operations-handbook");
  assert.equal(created.knowledgeBase.status, "ready");

  const db = new Database(catalogDatabasePath(state, created.knowledgeBase.id));
  try {
    const objectTypes = db.prepare("SELECT object_type FROM knowledge_objects ORDER BY object_type").all().map((row) => row.object_type);
    const nodeTypes = db.prepare("SELECT node_type FROM structure_nodes ORDER BY node_type").all().map((row) => row.node_type);
    for (const objectType of requiredObjects) assert.ok(objectTypes.includes(objectType), `catalog missing ${objectType}`);
    assert.ok(nodeTypes.includes("policy"));
    assert.ok(nodeTypes.includes("procedure"));
    assert.equal(db.prepare("SELECT count(*) AS count FROM citations").get().count > 0, true);
  } finally {
    db.close();
  }

  const evidence = await retrieveQueryEvidence(state, {
    knowledgeBaseId: created.knowledgeBase.id,
    template: "operations-handbook",
    question: "What review cadence and rollback rule does the operations handbook require?"
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.status, "evidence_found");
  assert.equal(evidence.route.expert.id, "operations-handbook");
  assert.equal(evidence.evidencePack.expert.id, "operations-handbook");
  assert.ok(evidence.citations.some((item) => item.document_id === "doc-public-operations-handbook" && item.pageNumber === 1));
  assert.doesNotMatch(JSON.stringify(evidence), /AccessKey|sk-|source text|private source|真实教材/i);

  fs.rmSync(root, { recursive: true, force: true });
});
