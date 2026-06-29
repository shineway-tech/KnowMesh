import assert from "node:assert/strict";
import test from "node:test";

import { classifyK12Page, k12ContentTypeForRecord } from "./k12-page-classifier.mjs";

test("K12 page classifier recognizes table-of-contents pages and emits toc entry content type", () => {
  const classification = classifyK12Page({
    pageNumber: 3,
    text: "目录\n第一单元\n1 白鹭 ........ 2\n2 落花生 ........ 7\n习作 我的心爱之物 ........ 12"
  });

  assert.equal(classification.primaryType, "table_of_contents");
  assert.ok(classification.pageTypes.includes("table_of_contents"));
  assert.equal(k12ContentTypeForRecord({ text: classification.sampleText, metadata: { pageClassification: classification } }), "toc_entry");
});

test("K12 page classifier recognizes exercise formula lesson and cover signals", () => {
  assert.equal(k12ContentTypeForRecord({ text: "课后练习\n做一做\n思考题" }), "exercise");
  assert.equal(k12ContentTypeForRecord({ text: "长方形面积公式 S = a \\times b" }), "formula");
  assert.equal(k12ContentTypeForRecord({ text: "第1课 白鹭\n色素的配合，身段的大小，一切都很适宜。" }, { lesson_no: 1 }), "lesson_text");

  const cover = classifyK12Page({
    pageNumber: 1,
    title: "语文五年级上册",
    text: "义务教育教科书\n语文\n五年级 上册\n人民教育出版社"
  });
  assert.equal(cover.primaryType, "cover");
  assert.ok(cover.signals.includes("front_page_book_title"));
});
