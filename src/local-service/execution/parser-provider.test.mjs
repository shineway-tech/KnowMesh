import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourcePreparationPlan,
  classifyParserInput,
  compatibilityConversionFor,
  sourcePreparationCategory,
  sourceReviewReason
} from "./parser-provider.mjs";

test("parser provider classifies source families without executing macro-capable files", () => {
  assert.equal(sourcePreparationCategory({ sourceType: "markdown" }), "directText");
  assert.equal(sourcePreparationCategory({ sourceType: "pdf" }), "ocr");
  assert.equal(sourcePreparationCategory({ sourceType: "doc" }), "autoConvert");
  assert.equal(sourcePreparationCategory({ sourceType: "wps" }), "autoConvert");
  assert.equal(sourcePreparationCategory({ sourceType: "bin" }), "unsupported");

  const docm = classifyParserInput({ sourceType: "docm", relativePath: "macro.docm" });
  assert.equal(docm.category, "office");
  assert.equal(docm.macroDisabled, true);
  assert.equal(docm.review.status, "");
});

test("parser provider exposes converter contracts and review fallbacks", () => {
  assert.deepEqual(compatibilityConversionFor("doc").candidateTools.map((tool) => tool.name), ["LibreOffice"]);
  assert.equal(compatibilityConversionFor("wps").outputPreference, "docx");
  assert.deepEqual(compatibilityConversionFor("wps").candidateTools.map((tool) => tool.name), ["WPS Office"]);

  const missingConverter = sourceReviewReason({ sourceType: "doc" }, { status: "converter_missing" });
  const failedConverter = sourceReviewReason({ sourceType: "wps" }, { status: "conversion_failed" });
  const unsupported = classifyParserInput({ sourceType: "file", relativePath: "archive.bin" });

  assert.match(missingConverter, /兼容转换器/);
  assert.match(failedConverter, /兼容转换没有成功/);
  assert.equal(unsupported.review.status, "review");
  assert.match(unsupported.review.reason, /暂未生成正文分段/);
});

test("source preparation plan routes parser and OCR decisions through adapter boundaries", () => {
  const plan = buildSourcePreparationPlan([
    document("notes.md", "markdown"),
    document("macro.docm", "docm"),
    document("legacy.wps", "wps"),
    document("scan.pdf", "pdf"),
    document("photo.png", "image"),
    document("archive.bin", "file")
  ], { mode: "local", localOcrConfigured: false });

  assert.equal(plan.kind, "knowmesh.sourcePreparationPlan");
  assert.equal(plan.summary.total, 6);
  assert.equal(plan.summary.directText, 1);
  assert.equal(plan.summary.office, 1);
  assert.equal(plan.summary.autoConvert, 1);
  assert.equal(plan.summary.ocr, 2);
  assert.equal(plan.summary.unsupported, 1);
  assert.equal(plan.summary.externalCallsBeforeExecution, 0);
  assert.equal(plan.adapters.find((item) => item.id === "local-parser").storageBoundary, "core-extraction-writer-api");
  assert.equal(plan.adapters.find((item) => item.id === "local-ocr").status, "review");

  const macro = plan.documents.find((item) => item.relativePath === "macro.docm");
  assert.equal(macro.adapterId, "local-parser");
  assert.equal(macro.category, "office");
  assert.equal(macro.macroPolicy.neverExecute, true);
  assert.equal(macro.persistentTruth.catalog, "catalog-writer-api");
  assert.match(macro.nextAction.en, /read locally/i);

  const scan = plan.documents.find((item) => item.relativePath === "scan.pdf");
  assert.equal(scan.adapterId, "local-ocr");
  assert.equal(scan.category, "ocr");
  assert.equal(scan.review.status, "review");
  assert.ok(scan.userFixableErrors.some((item) => item.key === "localOcrMissing"));
  assert.equal(scan.externalCallsBeforeExecution, 0);

  const unsupported = plan.documents.find((item) => item.relativePath === "archive.bin");
  assert.equal(unsupported.adapterId, "no-provider-fallback");
  assert.equal(unsupported.review.status, "review");
  assert.ok(unsupported.userFixableErrors.some((item) => item.key === "unsupportedSourceType"));
});

test("source preparation plan requires dry-run before cloud OCR", () => {
  const plan = buildSourcePreparationPlan([
    document("scan.pdf", "pdf")
  ], {
    mode: "aliyun",
    cloudOcrConfigured: true,
    selectedOcrModel: "qwen-vl-ocr-2025-11-20"
  });

  assert.equal(plan.summary.ocr, 1);
  assert.equal(plan.summary.externalCallsBeforeExecution, 0);
  assert.equal(plan.summary.plannedExternalCalls, 1);
  const scan = plan.documents[0];
  assert.equal(scan.adapterId, "dashscope-ocr");
  assert.equal(scan.status, "dryRunRequired");
  assert.equal(scan.dryRun.required, true);
  assert.equal(scan.dryRun.sendsSourceContent, true);
  assert.equal(scan.dryRun.writesRemoteState, false);
  assert.match(scan.nextAction.en, /dry-run/i);
});

function document(relativePath, sourceType) {
  return {
    relativePath,
    sourceType,
    extractionState: ""
  };
}
