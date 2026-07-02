import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildQueryRuntimeContract, shapeQueryResponse } from "./query-answer-contract.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";

test("shapes public query responses with stable fields and normalized statuses", () => {
  const { state } = tempState("knowmesh-answer-contract-shape-");
  const kb = createKnowledgeBase(state, { id: "kb-answer-contract", name: "Answer Contract", template: "general-docs" });
  const response = shapeQueryResponse(state, {
    ok: false,
    status: "no_evidence",
    answerRun: {
      source: { kind: "catalogSearch", label: { zh: "Catalog", en: "Catalog" } },
      model: "qwen-plus",
      results: [{
        status: "no_evidence",
        answer: "[object Object]",
        message: { zh: "没有找到证据。", en: "No evidence." },
        queryPlan: { route: { source: "catalogSearch" } },
        retrieval: { source: "catalogSearch", acceptedCitations: 0 },
        evidencePack: {
          version: "2026-07-query-runtime.1",
          answerPolicy: "citation_ready_evidence_only",
          status: "empty",
          items: []
        },
        quality: [{ key: "evidenceFound", status: "fail" }],
        citations: []
      }]
    },
    checks: [{ key: "sources", status: "fail" }],
    fixes: [{ key: "missingEvidence" }]
  }, {
    question: "What is the policy?",
    startedAt: Date.parse("2026-06-30T00:00:00.000Z"),
    finishedAt: Date.parse("2026-06-30T00:00:01.000Z")
  });

  assert.deepEqual(Object.keys(response), [
    "ok",
    "status",
    "kind",
    "apiVersion",
    "knowledgeBase",
    "runtime",
    "timing",
    "request",
    "query",
    "answer",
    "citations",
    "feedback",
    "maintenance",
    "error",
    "checks",
    "fixes"
  ]);
  assert.equal(response.knowledgeBase.id, kb.id);
  assert.equal(response.status, "insufficient_evidence");
  assert.equal(response.query.evidencePack.version, "2026-07-query-runtime.1");
  assert.equal(response.query.evidencePack.answerPolicy, "citation_ready_evidence_only");
  assert.equal(response.answer.status, "insufficient_evidence");
  assert.equal(response.answer.text, "");
  assert.equal(response.answer.reliable, false);
  assert.equal(response.feedback.endpoint, `/kb/${kb.id}/api/query/feedback`);
  assert.doesNotMatch(JSON.stringify(response), /\[object Object\]/);
});

test("builds an OpenAPI-ready query runtime contract", () => {
  const { state } = tempState("knowmesh-answer-contract-schema-");
  const kb = createKnowledgeBase(state, { id: "kb-answer-contract-schema", name: "Answer Contract Schema", template: "textbook-cn-k12" });

  const contract = buildQueryRuntimeContract(state);

  assert.equal(contract.ok, true);
  assert.equal(contract.endpoints.query.path, `/kb/${kb.id}/api/query`);
  assert.deepEqual(contract.request.required, ["question"]);
  assert.ok(contract.request.schema.properties.scope);
  assert.ok(contract.request.schema.properties.filters);
  assert.deepEqual(contract.response.fields, ["ok", "status", "answer", "citations", "checks", "feedback", "maintenance"]);
  assert.ok(contract.response.statusValues.includes("insufficient_evidence"));
  assert.ok(contract.response.statusValues.includes("provider_unavailable"));
  assert.ok(contract.response.statusValues.includes("blocked_by_quality"));
  assert.equal(contract.routePlanner.contract.version, "2026-07-query-runtime.1");
  assert.equal(contract.routePlanner.contract.answerPolicy, "citation_ready_evidence_only");
  assert.deepEqual(contract.routePlanner.contract.refusalTaxonomy.map((item) => item.key), [
    "out_of_scope",
    "unsupported_source",
    "insufficient_evidence",
    "low_confidence",
    "provider_unavailable",
    "maintenance_required"
  ]);
  assert.deepEqual(contract.routePlanner.contract.candidateRouteKeys, ["k12Catalog", "structureCatalog", "catalogSearch", "vectorSidecar"]);
  assert.equal(contract.examples.query.successHandling.condition, "ok === true && status === 'answered'");
  assert.equal(contract.openapi.operationId, "queryKnowledgeBase");
});

function tempState(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    state: {
      projectRoot: root,
      userDataRoot: path.join(root, ".knowmesh")
    }
  };
}
