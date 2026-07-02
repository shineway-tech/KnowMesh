import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNoAnswerStatus, validateQueryCitations } from "./query-citation-validator.mjs";

test("accepts traceable citations that support the answer", () => {
  const validation = validateQueryCitations({
    status: "answered",
    question: "What is the refund policy?",
    answer: "The refund policy is described on page 12.",
    citations: [{
      chunk_id: "chunk-policy",
      document_id: "doc-policy",
      sourceUri: "docs/policy.pdf",
      pageNumber: 12,
      excerpt: "Refund policy: employees can request reimbursement on page 12."
    }]
  });

  assert.equal(validation.ok, true);
  assert.equal(validation.status, "citation_valid");
  assert.equal(validation.checks.find((item) => item.key === "citationTraceability").status, "pass");
  assert.equal(validation.checks.find((item) => item.key === "citationSupportsAnswer").status, "pass");
});

test("blocks unrelated citations instead of counting weak evidence as usable", () => {
  const validation = validateQueryCitations({
    status: "answered",
    question: "What is the refund policy?",
    answer: "The refund policy is about page 12.",
    citations: [{
      chunk_id: "chunk-biology",
      document_id: "doc-biology",
      sourceUri: "docs/biology.pdf",
      pageNumber: 3,
      excerpt: "Mitochondria are organelles in cells."
    }]
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.status, "blocked_by_quality");
  assert.equal(validation.checks.find((item) => item.key === "citationSupportsAnswer").status, "fail");
});

test("requires page or structure anchors for citation traceability", () => {
  const validation = validateQueryCitations({
    status: "answered",
    question: "Where is the refund policy?",
    answer: "The refund policy is in the handbook.",
    citations: [{
      chunk_id: "chunk-policy",
      document_id: "doc-policy",
      sourceUri: "docs/policy.pdf",
      excerpt: "Refund policy."
    }]
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.status, "insufficient_evidence");
  assert.equal(validation.checks.find((item) => item.key === "citationTraceability").status, "fail");
});

test("refusals must not carry unrelated citations", () => {
  const clean = validateQueryCitations({
    status: "out_of_scope",
    answer: "",
    citations: []
  });
  const leaking = validateQueryCitations({
    status: "out_of_scope",
    answer: "Cannot answer.",
    citations: [{ document_id: "doc-policy", sourceUri: "docs/policy.pdf", pageNumber: 12 }]
  });

  assert.equal(clean.ok, true);
  assert.equal(clean.status, "out_of_scope");
  assert.equal(clean.checks.find((item) => item.key === "noOutOfScopeLeakage").status, "pass");
  assert.equal(leaking.ok, false);
  assert.equal(leaking.status, "blocked_by_quality");
  assert.equal(leaking.checks.find((item) => item.key === "noOutOfScopeLeakage").status, "fail");
});

test("detects display serialization leaks in answer and citation payloads", () => {
  const validation = validateQueryCitations({
    status: "answered",
    answer: "The result is [object Object].",
    citations: [{
      document_id: "doc-policy",
      sourceUri: "docs/policy.pdf",
      pageNumber: 12,
      excerpt: "Refund policy."
    }]
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.status, "blocked_by_quality");
  assert.equal(validation.checks.find((item) => item.key === "displaySerialization").status, "fail");
});

test("normalizes first-class no-answer statuses", () => {
  assert.equal(normalizeNoAnswerStatus("no_evidence"), "insufficient_evidence");
  assert.equal(normalizeNoAnswerStatus("metadataContractMissing"), "no_index");
  assert.equal(normalizeNoAnswerStatus("model_unavailable"), "provider_unavailable");
  assert.equal(normalizeNoAnswerStatus("review_required"), "blocked_by_quality");
  assert.equal(normalizeNoAnswerStatus("out_of_scope"), "out_of_scope");
});
