import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseSplitPdfPart, scanSource } from "./scanner.mjs";

test("parseSplitPdfPart detects numbered binary PDF parts", () => {
  assert.deepEqual(parseSplitPdfPart("math/book.pdf.12"), {
    logicalRelativePath: "math/book.pdf",
    partNumber: 12
  });
  assert.equal(parseSplitPdfPart("math/book.pdf"), null);
  assert.equal(parseSplitPdfPart("math/book.pdf.backup"), null);
});

test("scanSource groups split PDF parts into one logical document", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-scan-"));
  const docs = path.join(temp, "documents");
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, "algebra.pdf.2"), "part two", "utf8");
  fs.writeFileSync(path.join(docs, "algebra.pdf.1"), "part one", "utf8");
  fs.writeFileSync(path.join(docs, "science.md"), "# Science\n", "utf8");

  const config = {
    project: { id: "test-kb", name: "Test KB" },
    workspace: {
      root: path.join(temp, "workspace"),
      artifactRoot: path.join(temp, "workspace/artifacts"),
      manifests: path.join(temp, "workspace/manifests")
    },
    source: {
      type: "filesystem",
      root: "documents",
      include: ["**/*.pdf", "**/*.pdf.*", "**/*.md"],
      splitPdf: { mergeParts: true, orderBy: "partNumber", sourcePartsField: "sourceParts" }
    }
  };

  const manifest = await scanSource(config, { configPath: path.join(temp, "kb.yaml") });
  const split = manifest.logicalDocuments.find((document) => document.sourceType === "split-pdf");

  assert.equal(manifest.logicalDocuments.length, 2);
  assert.equal(manifest.splitPdfGroups.length, 1);
  assert.equal(split.relativePath, "algebra.pdf");
  assert.deepEqual(split.sourceParts.map((part) => part.partNumber), [1, 2]);
  assert.equal(split.merge.required, true);
});

test("scanSource classifies commercial knowledge-base source formats", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-scan-types-"));
  const docs = path.join(temp, "documents");
  fs.mkdirSync(docs, { recursive: true });
  const sources = new Map([
    ["guide.pdf", "pdf"],
    ["legacy.doc", "doc"],
    ["manual.docx", "docx"],
    ["macro.docm", "docm"],
    ["sheet.xls", "xls"],
    ["table.xlsx", "xlsx"],
    ["macro.xlsm", "xlsm"],
    ["deck.ppt", "ppt"],
    ["slides.pptx", "pptx"],
    ["macro.pptm", "pptm"],
    ["memo.rtf", "rtf"],
    ["notes.md", "markdown"],
    ["readme.markdown", "markdown"],
    ["plain.txt", "text"],
    ["data.csv", "csv"],
    ["data.tsv", "tsv"],
    ["scan.png", "image"],
    ["photo.jpg", "image"],
    ["photo.jpeg", "image"],
    ["page.webp", "image"],
    ["fax.bmp", "image"],
    ["scan.tif", "image"],
    ["scan.tiff", "image"],
    ["wps-doc.wps", "wps"],
    ["wps-sheet.et", "et"],
    ["wps-slides.dps", "dps"]
  ]);

  for (const file of sources.keys()) {
    fs.writeFileSync(path.join(docs, file), file, "utf8");
  }

  const manifest = await scanSource({
    project: { id: "business-kb", name: "Business KB" },
    workspace: {
      root: path.join(temp, "workspace"),
      artifactRoot: path.join(temp, "workspace/artifacts"),
      manifests: path.join(temp, "workspace/manifests")
    },
    source: {
      type: "filesystem",
      root: "documents",
      include: ["**/*"],
      splitPdf: { mergeParts: true }
    }
  }, { configPath: path.join(temp, "kb.yaml"), skipHash: true });

  const byPath = new Map(manifest.logicalDocuments.map((document) => [document.relativePath, document.sourceType]));
  for (const [file, type] of sources.entries()) {
    assert.equal(byPath.get(file), type, file);
  }
});
