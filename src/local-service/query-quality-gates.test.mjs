import assert from "node:assert/strict";
import test from "node:test";

import { evaluateQueryQualityGates } from "./query-quality-gates.mjs";

test("query quality gates pass citation-bearing supported answers", () => {
  const gates = evaluateQueryQualityGates({
    status: "answered",
    answer: "报销制度在第12页。[1]",
    citations: [{
      document_id: "doc-policy",
      sourceUri: "制度/员工手册.pdf",
      pageNumber: 12,
      excerpt: "section · 报销制度 · p.12"
    }],
    retrieval: { rejectedCitations: 0 }
  });

  assert.equal(gates.every((gate) => gate.status === "pass"), true);
});

test("query quality gates block weak answers and display serialization leaks", () => {
  const gates = evaluateQueryQualityGates({
    status: "answered",
    answer: "当前来源无法确认。[object Object]",
    citations: [{
      document_id: "doc-policy",
      sourceUri: "",
      pageNumber: null,
      excerpt: ""
    }],
    retrieval: { rejectedCitations: 2 }
  });

  assert.equal(gates.find((gate) => gate.key === "scopeFit").status, "review");
  assert.equal(gates.find((gate) => gate.key === "citationTraceability").status, "fail");
  assert.equal(gates.find((gate) => gate.key === "citationSupportsAnswer").status, "fail");
  assert.equal(gates.find((gate) => gate.key === "noWeakAnswer").status, "fail");
  assert.equal(gates.find((gate) => gate.key === "displaySerialization").status, "fail");
});

test("query quality gates prevent out-of-scope citation leakage", () => {
  const gates = evaluateQueryQualityGates({
    status: "out_of_scope",
    answer: "",
    citations: [{
      document_id: "doc-policy",
      sourceUri: "制度/员工手册.pdf",
      pageNumber: 12,
      excerpt: "报销制度"
    }]
  });

  assert.equal(gates.find((gate) => gate.key === "noOutOfScopeLeakage").status, "fail");
  assert.equal(gates.find((gate) => gate.key === "citationSupportsAnswer").status, "fail");
});
