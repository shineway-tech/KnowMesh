import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { matchesAnyGlob } from "../core/glob.mjs";
import { getTemplate } from "../core/templates.mjs";
import { includePatterns, previewScan } from "./scan-preview.mjs";

const requiredBusinessSources = [
  "book.pdf",
  "book.pdf.1",
  "legacy.doc",
  "manual.docx",
  "macro.docm",
  "sheet.xls",
  "table.xlsx",
  "macro.xlsm",
  "deck.ppt",
  "slides.pptx",
  "macro.pptm",
  "memo.rtf",
  "notes.md",
  "notes.markdown",
  "plain.txt",
  "data.csv",
  "data.tsv",
  "scan.png",
  "scan.jpg",
  "scan.jpeg",
  "scan.webp",
  "scan.bmp",
  "scan.tif",
  "scan.tiff",
  "legacy.wps",
  "finance.et",
  "briefing.dps"
];

test("includePatterns includes commercial source formats for K12 and general templates", () => {
  for (const templateId of ["textbook-cn-k12", "general-docs"]) {
    const patterns = includePatterns(getTemplate(templateId));
    const misses = requiredBusinessSources.filter((file) => !matchesAnyGlob(file, patterns));
    assert.deepEqual(misses, [], templateId);
  }
});

test("previewScan groups files by how KnowMesh will handle them", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-preview-types-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (const file of ["guide.pdf", "manual.docx", "legacy.doc", "sheet.xls", "slide.ppt", "legacy.wps", "table.et", "deck.dps", "scan.png"]) {
    fs.writeFileSync(path.join(sourceRoot, file), file, "utf8");
  }

  const result = await previewScan({ projectRoot: temp }, {
    template: "general-docs",
    draft: {
      template: "general-docs",
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });

  const groups = new Map(result.preview.processingGroups.map((group) => [group.key, group]));
  assert.equal(groups.get("direct")?.count, 2);
  assert.equal(groups.get("autoConvert")?.count, 6);
  assert.equal(groups.get("ocr")?.count, 1);
});

test("previewScan filters K12 sources by selected stage subject grade and volume", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-preview-k12-scope-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (const file of [
    "小学/语文/一年级/小学语文一年级上册.pdf",
    "小学/数学/二年级/小学数学二年级下册.pdf",
    "小学/英语/三年级/小学英语三年级上册.pdf",
    "初中/语文/七年级/初中语文七年级上册.pdf",
    "小学/科学/一年级/小学科学一年级上册.pdf",
    "小学/语文/一年级/小学语文一年级全一册.pdf"
  ]) {
    writeSourceFile(sourceRoot, file);
  }

  const result = await previewScan({ projectRoot: temp }, {
    mode: "local",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["语文", "数学", "英语"],
      "metadata.grade": ["一年级", "二年级", "三年级"],
      "metadata.volume": ["上册", "下册"]
    }
  });

  assert.equal(result.preview.summary.scannedFiles, 6);
  assert.equal(result.preview.summary.includedFiles, 3);
  assert.equal(result.preview.summary.logicalDocuments, 3);
  assert.equal(result.preview.summary.scopeFilter.enabled, true);
  assert.equal(result.preview.summary.scopeFilter.excludedDocuments, 3);
  assert.deepEqual(result.preview.summary.scopeFilter.selected.stage, ["小学"]);
  assert.deepEqual(result.preview.documents.map((document) => document.relativePath).sort(), [
    "小学/数学/二年级/小学数学二年级下册.pdf",
    "小学/英语/三年级/小学英语三年级上册.pdf",
    "小学/语文/一年级/小学语文一年级上册.pdf"
  ]);
});

test("previewScan keeps K12 source scope exact for similar stage and subject folders", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-preview-k12-exact-scope-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (const file of [
    "小学/语文/一年级/小学语文一年级上册.pdf",
    "小学/数学/六年级/小学数学六年级下册.pdf.1",
    "小学/数学/六年级/小学数学六年级下册.pdf.2",
    "小学/英语/六年级/小学英语六年级下册.pdf",
    "小学/语文·书法练习指导/一年级/小学语文书法练习指导一年级上册.pdf",
    "小学（五•四学制）/数学/五年级/小学数学五年级上册.pdf",
    "初中（五•四学制）/数学/六年级/初中数学六年级上册.pdf"
  ]) {
    writeSourceFile(sourceRoot, file);
  }

  const result = await previewScan({ projectRoot: temp }, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["语文", "数学", "英语"],
      "metadata.grade": ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"],
      "metadata.volume": ["上册", "下册"]
    }
  });

  assert.equal(result.preview.summary.scannedFiles, 7);
  assert.equal(result.preview.summary.includedFiles, 4);
  assert.equal(result.preview.summary.logicalDocuments, 3);
  assert.equal(result.preview.summary.scopeFilter.excludedDocuments, 3);
  assert.deepEqual(result.preview.summary.scopeFilter.excluded.map((document) => document.relativePath).sort(), [
    "初中（五•四学制）/数学/六年级/初中数学六年级上册.pdf",
    "小学/语文·书法练习指导/一年级/小学语文书法练习指导一年级上册.pdf",
    "小学（五•四学制）/数学/五年级/小学数学五年级上册.pdf"
  ]);
  assert.deepEqual(result.preview.documents.map((document) => document.relativePath).sort(), [
    "小学/数学/六年级/小学数学六年级下册.pdf",
    "小学/英语/六年级/小学英语六年级下册.pdf",
    "小学/语文/一年级/小学语文一年级上册.pdf"
  ]);
});
test("previewScan does not filter by optional K12 volume when it is not selected", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-preview-k12-volume-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (const file of [
    "小学/语文/一年级/小学语文一年级上册.pdf",
    "小学/语文/一年级/小学语文一年级全一册.pdf",
    "小学/数学/一年级/小学数学一年级上册.pdf"
  ]) {
    writeSourceFile(sourceRoot, file);
  }

  const result = await previewScan({ projectRoot: temp }, {
    mode: "local",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["语文"],
      "metadata.grade": ["一年级"]
    }
  });

  assert.equal(result.preview.summary.includedFiles, 2);
  assert.deepEqual(result.preview.documents.map((document) => document.relativePath).sort(), [
    "小学/语文/一年级/小学语文一年级上册.pdf",
    "小学/语文/一年级/小学语文一年级全一册.pdf"
  ]);
});

test("previewScan keeps senior high sources without explicit grade when all senior grades are selected", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-preview-k12-senior-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (const file of [
    "高中/思想政治/统编版/普通高中教科书思想政治必修1.pdf",
    "高中/历史/统编版/普通高中历史必修上.pdf",
    "初中/道德与法治/九年级/初中道德与法治九年级上册.pdf"
  ]) {
    writeSourceFile(sourceRoot, file);
  }

  const result = await previewScan({ projectRoot: temp }, {
    mode: "local",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["高中"],
      "metadata.subject": ["思想政治"],
      "metadata.grade": ["高一", "高二", "高三"],
      "metadata.volume": ["必修"]
    }
  });

  assert.equal(result.preview.summary.includedFiles, 1);
  assert.deepEqual(result.preview.documents.map((document) => document.relativePath), [
    "高中/思想政治/统编版/普通高中教科书思想政治必修1.pdf"
  ]);
});

function writeSourceFile(sourceRoot, relativePath) {
  const fullPath = path.join(sourceRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, relativePath, "utf8");
}





