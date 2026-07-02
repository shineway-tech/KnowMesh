import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOcrAdapterPreflight,
  ocrSourceTypeRequiresRecognition
} from "./ocr-provider.mjs";

test("OCR preflight keeps local-only recognition reviewable without external calls", () => {
  const preflight = buildOcrAdapterPreflight({
    relativePath: "scan.pdf",
    sourceType: "pdf"
  }, {
    mode: "local",
    localOcrConfigured: false
  });

  assert.equal(preflight.adapterId, "local-ocr");
  assert.equal(preflight.status, "review");
  assert.equal(preflight.externalCallsBeforeExecution, 0);
  assert.equal(preflight.dryRun.required, false);
  assert.ok(preflight.userFixableErrors.some((item) => item.key === "localOcrMissing"));
  assert.match(preflight.nextAction.en, /install/i);
});

test("OCR preflight blocks cloud OCR until the provider is configured", () => {
  const preflight = buildOcrAdapterPreflight({
    relativePath: "worksheet.png",
    sourceType: "image"
  }, {
    mode: "aliyun",
    cloudOcrConfigured: false
  });

  assert.equal(preflight.adapterId, "dashscope-ocr");
  assert.equal(preflight.status, "blocked");
  assert.equal(preflight.externalCallsBeforeExecution, 0);
  assert.equal(preflight.dryRun.required, true);
  assert.equal(preflight.dryRun.plannedExternalCall, false);
  assert.ok(preflight.userFixableErrors.some((item) => item.key === "modelCredentialMissing"));
});

test("OCR preflight marks configured cloud OCR as dry-run required", () => {
  const preflight = buildOcrAdapterPreflight({
    relativePath: "scan.pdf",
    sourceType: "pdf"
  }, {
    mode: "aliyun",
    cloudOcrConfigured: true,
    selectedOcrModel: "qwen-vl-ocr-2025-11-20"
  });

  assert.equal(preflight.adapterId, "dashscope-ocr");
  assert.equal(preflight.status, "dryRunRequired");
  assert.equal(preflight.externalCallsBeforeExecution, 0);
  assert.equal(preflight.dryRun.required, true);
  assert.equal(preflight.dryRun.plannedExternalCall, true);
  assert.equal(preflight.dryRun.sendsSourceContent, true);
  assert.equal(preflight.dryRun.writesRemoteState, false);
  assert.equal(preflight.model, "qwen-vl-ocr-2025-11-20");
});

test("OCR source recognition helper handles PDFs images and non-OCR sources", () => {
  assert.equal(ocrSourceTypeRequiresRecognition("pdf"), true);
  assert.equal(ocrSourceTypeRequiresRecognition("split-pdf"), true);
  assert.equal(ocrSourceTypeRequiresRecognition("image"), true);
  assert.equal(ocrSourceTypeRequiresRecognition("markdown"), false);
});
