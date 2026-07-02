import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { maintenanceReview, resolveMaintenanceReviewIssue } from "./maintenance-review.mjs";
import { recordQueryFeedback } from "./query-feedback.mjs";
import { catalogDatabasePath } from "./storage.mjs";

test("maintenance review normalizes quality issues and negative query feedback into one filtered queue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-maintenance-review-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-maintenance-review", name: "Maintenance Review", template: "textbook-cn-k12" });
  writeQualityIssueFixture(state, kb.id);
  const useful = recordQueryFeedback(state, {
    action: "useful",
    question: "这次答案有帮助",
    resultKey: "positive-signal"
  });
  const wrongCitation = recordQueryFeedback(state, {
    action: "wrong_citation",
    question: "第三单元第一课是什么？",
    resultKey: "wrong-citation-result",
    citationRefs: [{
      id: "chunk-lesson-1",
      title: "语文五年级上册",
      sourceUri: "小学/语文/五年级/语文五年级上册.pdf",
      pageNumber: 24,
      documentHref: `/kb/${kb.id}/maintain/documents?query=%E8%AF%AD%E6%96%87`
    }]
  });

  const review = maintenanceReview(state, {
    status: "open",
    issueType: "wrong_citation",
    severity: "review",
    document: "语文五年级",
    page: "24"
  });

  assert.equal(useful.feedback.needsReview, false);
  assert.equal(wrongCitation.feedback.needsReview, true);
  assert.equal(review.ok, true);
  assert.equal(review.review.summary.total, 3);
  assert.equal(review.review.summary.open, 3);
  assert.equal(review.review.summary.signals.positiveFeedback, 1);
  assert.equal(review.review.summary.byIssueType.wrong_citation, 1);
  assert.equal(review.review.filters.issueType, "wrong_citation");
  assert.equal(review.review.filters.severity, "review");
  assert.equal(review.review.items.length, 1);
  assert.equal(review.review.items[0].source, "query_feedback");
  assert.equal(review.review.items[0].issueType, "wrong_citation");
  assert.equal(review.review.items[0].targetType, "query");
  assert.equal(review.review.items[0].ownerPath, `/kb/${kb.id}/maintain/feedback`);
  assert.equal(review.review.items[0].retestAction.href, `/kb/${kb.id}/use/ask?question=${encodeURIComponent("第三单元第一课是什么？")}`);
  assert.equal(review.review.items[0].evidenceTarget.kind, "citation");
  assert.equal(review.review.items[0].evidenceTarget.citationId, "chunk-lesson-1");
  assert.equal(review.review.items[0].evidenceTarget.pageNumber, 24);
  assert.deepEqual(review.review.items[0].rerunScope, {
    type: "query_feedback",
    feedbackId: wrongCitation.feedback.id,
    resultKey: "wrong-citation-result",
    citationIds: ["chunk-lesson-1"],
    sourceUris: ["小学/语文/五年级/语文五年级上册.pdf"],
    pages: [24]
  });
  assert.equal(review.review.items[0].document.path, "小学/语文/五年级/语文五年级上册.pdf");
  assert.equal(review.review.items[0].page.number, 24);
  assert.doesNotMatch(JSON.stringify(review), /这次答案有帮助/);
});

test("maintenance review resolve delegates feedback work without touching other knowledge bases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-maintenance-review-resolve-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kbOne = createKnowledgeBase(state, { id: "kb-review-one", name: "Review One", template: "textbook-cn-k12" });
  const feedback = recordQueryFeedback(state, {
    action: "missed_point",
    question: "词语表漏了什么？",
    resultKey: "missed-point"
  });
  createKnowledgeBase(state, { id: "kb-review-two", name: "Review Two", template: "general-docs" });
  const kbOneState = { ...state, knowledgeBaseId: kbOne.id };

  const resolved = resolveMaintenanceReviewIssue(kbOneState, {
    id: `feedback:${feedback.feedback.id}`,
    message: "已补充词语表引用。"
  });
  const kbOneReview = maintenanceReview(kbOneState, { status: "all" });
  const kbTwoReview = maintenanceReview(state, { status: "all" });

  assert.equal(resolved.ok, true);
  assert.equal(resolved.issue.source, "query_feedback");
  assert.equal(resolved.issue.status, "resolved");
  assert.equal(resolved.issue.resolution.message, "已补充词语表引用。");
  assert.equal(kbOneReview.review.summary.resolved, 1);
  assert.equal(kbTwoReview.review.summary.total, 0);
});

function writeQualityIssueFixture(state, knowledgeBaseId) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId));
  try {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO quality_issues (
        issue_id, target_type, target_id, severity, status, reason, details_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "issue-document-review",
      "document",
      "doc-chinese",
      "review",
      "open",
      "文档需要复核。",
      JSON.stringify({
        stage: "clean",
        issueType: "low_confidence",
        title: "语文五年级上册",
        relativePath: "小学/语文/五年级/语文五年级上册.pdf",
        page_start: 24
      }),
      now,
      now
    );
    insert.run(
      "issue-query-runtime",
      "query",
      "question-hash",
      "fail",
      "open",
      "查询没有找到可引用证据。",
      JSON.stringify({
        stage: "query-runtime",
        issueType: "insufficient_evidence",
        questionPreview: "第三单元第一课是什么？",
        retestHref: `/kb/${knowledgeBaseId}/use/ask?question=%E7%AC%AC%E4%B8%89%E5%8D%95%E5%85%83`
      }),
      now,
      now
    );
  } finally {
    db.close();
  }
}
