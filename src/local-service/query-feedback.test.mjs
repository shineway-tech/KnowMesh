import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { maintenanceReview } from "./maintenance-review.mjs";
import { queryFeedbackSummary, recordQueryFeedback } from "./query-feedback.mjs";

test("positive query feedback is counted as signal but not maintenance work", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-query-feedback-positive-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  createKnowledgeBase(state, { id: "kb-feedback-positive", name: "Feedback Positive", template: "general-docs" });

  const feedback = recordQueryFeedback(state, {
    action: "useful",
    question: "这个回答有帮助",
    resultKey: "positive-answer"
  });
  const summary = queryFeedbackSummary(state);
  const review = maintenanceReview(state, { status: "all" });

  assert.equal(feedback.feedback.needsReview, false);
  assert.equal(summary.total, 1);
  assert.equal(summary.positive, 1);
  assert.equal(summary.open, 0);
  assert.equal(review.review.summary.signals.positiveFeedback, 1);
  assert.equal(review.review.summary.total, 0);
  assert.deepEqual(review.review.items, []);
});
