import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { planQueryRoute } from "./query-route-planner.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";

test("query route planner chooses K12 catalog structure route before hybrid retrieval", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-planner-k12-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-query-planner-k12", name: "K12 Planner", template: "textbook-cn-k12" });

  const plan = planQueryRoute(state, {
    question: "五年级统编版语文第三单元第一课是什么？"
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.kind, "knowmesh.queryRoutePlan");
  assert.equal(plan.domain, "k12");
  assert.equal(plan.intent, "first_lesson_lookup");
  assert.equal(plan.route.key, "k12Catalog");
  assert.deepEqual(plan.route.evidenceSources, ["structure_nodes", "knowledge_objects", "object_relations", "citations"]);
  assert.equal(plan.route.fallback, "none_for_structure_questions");
  assert.ok(plan.qualityGates.some((gate) => gate.key === "scopeFit" && gate.required === true));
  assert.ok(plan.qualityGates.some((gate) => gate.key === "citationTraceability" && gate.required === true));
  assert.ok(plan.qualityGates.some((gate) => gate.key === "displaySerialization" && gate.required === true));
  assert.equal(plan.scope.kind, "k12");
  assert.equal(plan.scope.filter.unit, "u03");
  assert.doesNotMatch(JSON.stringify(plan), /secret|apiKey|private/i);
});

test("query route planner keeps general knowledge bases on hybrid retrieval with citation gates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-planner-general-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-query-planner-general", name: "General Planner", template: "general-docs" });

  const plan = planQueryRoute(state, {
    question: "公司的报销制度是什么？"
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.domain, "general");
  assert.equal(plan.intent, "general_answer");
  assert.equal(plan.route.key, "hybridRetrieval");
  assert.deepEqual(plan.route.evidenceSources, ["structure_nodes", "chunks", "index_records", "aliyun_vector"]);
  assert.equal(plan.route.fallback, "no_answer_without_sources");
  assert.ok(plan.qualityGates.some((gate) => gate.key === "noWeakAnswer" && gate.required === true));
});

test("query route planner sends general page and section lookups to structure catalog first", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-planner-structure-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-query-planner-structure", name: "Structure Planner", template: "general-docs" });

  const plan = planQueryRoute(state, {
    question: "报销制度在哪一页？"
  });

  assert.equal(plan.domain, "general");
  assert.equal(plan.intent, "structure_lookup");
  assert.equal(plan.route.key, "structureCatalog");
  assert.deepEqual(plan.route.evidenceSources, ["structure_nodes", "citations", "source_documents"]);
  assert.equal(plan.route.fallback, "hybridRetrieval");
});
