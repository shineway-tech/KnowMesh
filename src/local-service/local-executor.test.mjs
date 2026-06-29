import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

import { advanceLatestJob, confirmLocalJob, latestJob, pauseLatestJob, resumeLatestJob, runLatestJob } from "./jobs.mjs";
import { putVectors, queryVectors, validateVectorIndexName } from "./aliyun.mjs";
import { syncCleanArtifactsToCatalog } from "./content-catalog.mjs";
import { buildEmbeddingInputs } from "./local-executor.mjs";
import { createKnowledgeBase, switchKnowledgeBase } from "./knowledge-bases.mjs";
import { saveAliyunCredentials, saveAliyunModelProvider, saveAliyunModelQuality, saveRetrievalStrategy } from "./setup-store.mjs";
import { catalogDatabasePath } from "./storage.mjs";

const migratedK12KnowledgeBaseId = "kb-k12-all-subjects";

function actualWorkspaceRoot(workspaceRoot) {
  const versionsRoot = path.join(workspaceRoot, "knowledge-bases");
  if (!fs.existsSync(versionsRoot)) return workspaceRoot;
  const candidates = [];
  for (const knowledgeBaseDir of fs.readdirSync(versionsRoot, { withFileTypes: true })) {
    if (!knowledgeBaseDir.isDirectory()) continue;
    const root = path.join(versionsRoot, knowledgeBaseDir.name, "versions");
    if (!fs.existsSync(root)) continue;
    for (const versionDir of fs.readdirSync(root, { withFileTypes: true })) {
      if (versionDir.isDirectory()) candidates.push(path.join(root, versionDir.name));
    }
  }
  return candidates.sort()[0] || workspaceRoot;
}

function artifactPath(workspaceRoot, ...segments) {
  return path.join(actualWorkspaceRoot(workspaceRoot), "artifacts", ...segments);
}

function manifestPath(workspaceRoot, ...segments) {
  return path.join(actualWorkspaceRoot(workspaceRoot), "manifests", ...segments);
}

function readCatalogRows(state, knowledgeBaseId, sql, params = []) {
  const db = new Database(catalogDatabasePath(state, knowledgeBaseId), { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function expectedOssVectorV4Authorization({ accessKeyId, accessKeySecret, region, method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, timestamp }) {
  const isoTime = timestamp.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const signDate = isoTime.slice(0, 8);
  const scope = `${signDate}/${region}/oss/aliyun_v4_request`;
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD"
  ].join("\n");
  const signingKey = testHmac(
    testHmac(
      testHmac(
        testHmac(`aliyun_v4${accessKeySecret}`, signDate),
        region
      ),
      "oss"
    ),
    "aliyun_v4_request"
  );
  const signature = crypto.createHmac("sha256", signingKey)
    .update([
      "OSS4-HMAC-SHA256",
      isoTime,
      scope,
      crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex")
    ].join("\n"), "utf8")
    .digest("hex");
  return `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},Signature=${signature}`;
}

function testHmac(key, value) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

test("local execution prepares commercial source formats and extracts local table text", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-local-executor-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const sources = {
    "plain.txt": "知识库运行手册\n1\n访问 https://example.com\nAccessKey Secret: should-not-index\n正文继续。",
    "notes.md": "# 培训资料\n\n这是 Markdown 内容。",
    "data.csv": "name,role\nAlice,Teacher\nBob,Reviewer\n",
    "data.tsv": "chapter\tpage\nIntro\t1\nPractice\t2\n",
    "manual.docx": "docx placeholder",
    "table.xlsx": "xlsx placeholder",
    "slides.pptx": "pptx placeholder",
    "legacy.doc": "doc placeholder",
    "sheet.xls": "xls placeholder",
    "deck.ppt": "ppt placeholder",
    "memo.rtf": "{\\rtf1\\ansi RTF 正文\\par 第二段 RTF}",
    "wps-doc.wps": "wps placeholder",
    "wps-sheet.et": "et placeholder",
    "wps-slides.dps": "dps placeholder",
    "guide.pdf": "%PDF placeholder",
    "scan.png": "image placeholder"
  };

  for (const [file, content] of Object.entries(sources)) {
    fs.writeFileSync(path.join(sourceRoot, file), content, "utf8");
  }

  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false , knowledgeBaseId: migratedK12KnowledgeBaseId };
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const draft = {
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot
  };

  const created = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  const completed = await runLatestJob(state);
  assert.equal(completed.ok, true);
  assert.equal(completed.job.status, "completed");

  const pipelinePlan = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "pipeline-plan.report.json"), "utf8"));
  assert.equal(pipelinePlan.retrieval.profile, "balanced");
  assert.ok(pipelinePlan.retrieval.methods.includes("multiQuery"));

  const preparationReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "page-preparation.report.json"), "utf8"));
  assert.equal(preparationReport.summary.totalDocuments, Object.keys(sources).length);
  assert.equal(preparationReport.summary.directTextDocuments, 5);
  assert.equal(preparationReport.summary.officeDocuments, 3);
  assert.equal(preparationReport.summary.autoConvertDocuments, 6);
  assert.equal(preparationReport.summary.ocrDocuments, 2);
  assert.ok(preparationReport.directTextQueue.some((item) => item.sourceType === "csv" && item.title === "data"));
  assert.ok(preparationReport.directTextQueue.some((item) => item.sourceType === "rtf" && item.title === "memo"));
  assert.ok(preparationReport.officeQueue.some((item) => item.sourceType === "docx" && item.status === "ready_for_structured_extraction"));
  assert.ok(preparationReport.autoConvertQueue.some((item) => item.sourceType === "wps" && item.status === "waiting_for_compatible_conversion"));
  assert.ok(preparationReport.autoConvertQueue.every((item) => item.compatibilityConversion?.required === true));
  assert.ok(preparationReport.autoConvertQueue.some((item) => item.compatibilityConversion?.candidateTools?.some((tool) => tool.name === "LibreOffice")));
  assert.ok(preparationReport.ocrQueue.some((item) => item.sourceType === "image" && item.status === "waiting_for_text_recognition"));

  const recognitionPlan = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "text-recognition-plan.report.json"), "utf8"));
  assert.equal(recognitionPlan.summary.totalDocuments, 2);
  assert.equal(recognitionPlan.summary.pdfDocuments, 1);
  assert.equal(recognitionPlan.summary.imageDocuments, 1);
  assert.equal(recognitionPlan.summary.modelCallsEnabled, false);
  assert.equal(recognitionPlan.summary.confirmationRequired, true);
  assert.ok(recognitionPlan.items.every((item) => item.status === "blocked_until_text_recognition_confirmation"));
  assert.ok(recognitionPlan.items.some((item) => item.sourceType === "pdf" && item.pageEstimate === "unknown"));
  assert.ok(recognitionPlan.items.some((item) => item.sourceType === "image" && item.pageEstimate === 1));
  const recognitionWorkOrder = fs.readFileSync(artifactPath(workspaceRoot, "ocr", "text-recognition.work-order.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(recognitionWorkOrder.length, 2);
  assert.ok(recognitionWorkOrder.every((item) => item.status === "waiting_for_confirmation" && item.confirmation.required === true));

  const normalizedText = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "normalized", "local-text.normalized.json"), "utf8"));
  assert.ok(normalizedText.documents.some((item) => item.sourceType === "csv" && item.text.includes("Alice")));
  assert.ok(normalizedText.documents.some((item) => item.sourceType === "tsv" && item.text.includes("Practice")));
  assert.ok(normalizedText.documents.some((item) => item.sourceType === "rtf" && item.text.includes("RTF 正文")));

  const filterReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "filter-report.json"), "utf8"));
  assert.ok(filterReport.review.some((item) => item.sourceType === "doc" && /兼容转换/.test(item.reason)));
  assert.ok(filterReport.review.some((item) => item.sourceType === "docx" && /未能读取/.test(item.reason)));
  assert.ok(filterReport.review.some((item) => item.sourceType === "image" && /文字识别/.test(item.reason)));

  const pageRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT document_id, version_id, page_number, extraction_state, metadata_json
    FROM pages
    ORDER BY document_id, page_number
  `);
  const blockRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT document_id, block_type, sort_order, quality_state, metadata_json
    FROM blocks
    ORDER BY document_id, sort_order
  `);
  assert.ok(pageRows.length >= 5);
  assert.ok(blockRows.length >= 5);
  const processedPageRows = pageRows.filter((row) => row.extraction_state !== "source_anchor");
  assert.ok(pageRows.some((row) => JSON.parse(row.metadata_json).relativePath === "plain.txt"));
  assert.ok(blockRows.some((row) => JSON.parse(row.metadata_json).text.includes("知识库运行手册")));
  assert.ok(blockRows.every((row) => row.block_type === "body_text"));

  const chunkRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT chunk_id, document_id, text_hash, quality_state, metadata_json
    FROM chunks
    ORDER BY chunk_id
  `);
  const citationRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT citation_id, chunk_id, document_id, page_number, metadata_json
    FROM citations
    ORDER BY citation_id
  `);
  assert.ok(chunkRows.length >= 5);
  assert.ok(citationRows.length >= chunkRows.length);
  assert.ok(chunkRows.some((row) => JSON.parse(row.metadata_json).text.includes("知识库运行手册")));
  assert.ok(citationRows.some((row) => JSON.parse(row.metadata_json).relativePath === "plain.txt"));

  const structureRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT node_id, document_id, node_type, title, path, metadata_json
    FROM structure_nodes
    ORDER BY node_id
  `);
  const objectRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT object_id, document_id, structure_node_id, object_type, title, quality_state, metadata_json
    FROM knowledge_objects
    ORDER BY object_id
  `);
  const structureFtsRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT node_id
    FROM structure_nodes_fts
    WHERE structure_nodes_fts MATCH 'plain'
  `);
  const objectFtsRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT object_id
    FROM knowledge_objects_fts
    WHERE knowledge_objects_fts MATCH 'body_text'
  `);
  assert.ok(structureRows.length >= processedPageRows.length);
  assert.ok(objectRows.length >= chunkRows.length);
  assert.ok(structureRows.some((row) => row.node_type === "document" && row.path === "plain.txt"));
  assert.ok(objectRows.some((row) => row.object_type === "body_text" && JSON.parse(row.metadata_json).chunk_id));
  assert.ok(structureFtsRows.length > 0);
  assert.ok(objectFtsRows.length > 0);

  const cleanIssueRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT target_type, target_id, severity, status, reason, details_json
    FROM quality_issues
    WHERE details_json LIKE '%"stage":"clean"%'
    ORDER BY issue_id
  `);
  assert.ok(cleanIssueRows.length >= filterReport.review.length);
  assert.ok(cleanIssueRows.every((row) => row.target_type === "document" && row.status === "open"));
  assert.ok(cleanIssueRows.some((row) => /兼容转换|未能读取|文字识别/.test(row.reason)));
});

test("local execution extracts readable text from modern Office files without running macros", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-office-executor-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  writeStoredZip(path.join(sourceRoot, "lesson.docx"), {
    "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>DOCX 教材正文</w:t></w:r></w:p><w:p><w:r><w:t>第二段内容</w:t></w:r></w:p></w:body></w:document>`
  });
  writeStoredZip(path.join(sourceRoot, "macro.docm"), {
    "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>DOCM 只读取正文</w:t></w:r></w:p></w:body></w:document>`,
    "word/vbaProject.bin": "macro binary placeholder"
  });
  writeStoredZip(path.join(sourceRoot, "table.xlsx"), {
    "xl/sharedStrings.xml": `<sst><si><t>学科</t></si><si><t>语文</t></si><si><t>数学</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>2</v></c></row></sheetData></worksheet>`
  });
  writeStoredZip(path.join(sourceRoot, "slides.pptx"), {
    "ppt/slides/slide1.xml": `<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>PPTX 第一页标题</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld><p:cSld><p:spTree><a:p><a:r><a:t>第二页要点</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>`
  });

  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false , knowledgeBaseId: migratedK12KnowledgeBaseId };
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const created = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  const completed = await runLatestJob(state);
  assert.equal(completed.ok, true);

  const preparationReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "page-preparation.report.json"), "utf8"));
  assert.equal(preparationReport.summary.officeDocuments, 4);
  assert.ok(preparationReport.officeQueue.every((item) => item.status === "ready_for_structured_extraction"));
  assert.ok(preparationReport.officeQueue.some((item) => item.sourceType === "docm" && item.macroDisabled === true));

  const normalizedText = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "normalized", "local-text.normalized.json"), "utf8"));
  const combinedText = normalizedText.documents.map((item) => item.text).join("\n");
  assert.match(combinedText, /DOCX 教材正文/);
  assert.match(combinedText, /DOCM 只读取正文/);
  assert.match(combinedText, /语文/);
  assert.match(combinedText, /PPTX 第一页标题/);

  const filterReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "filter-report.json"), "utf8"));
  assert.equal(filterReport.review.filter((item) => ["docx", "docm", "xlsx", "pptx"].includes(item.sourceType)).length, 0);
});

test("local execution converts legacy office files when a compatible converter is available", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-convert-executor-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const converterScript = path.join(temp, "fake-converter.mjs");
  const convertedTemplate = path.join(temp, "converted-template.docx");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  fs.writeFileSync(path.join(sourceRoot, "legacy.doc"), "legacy placeholder", "utf8");
  writeStoredZip(convertedTemplate, {
    "word/document.xml": `<w:document><w:body><w:p><w:r><w:t>转换后的 DOC 正文</w:t></w:r></w:p></w:body></w:document>`
  });
  fs.writeFileSync(converterScript, `
import fs from "node:fs";
import path from "node:path";
const [template, ...args] = process.argv.slice(2);
const outdir = args[args.indexOf("--outdir") + 1];
const source = args.at(-1);
const output = path.join(outdir, path.basename(source, path.extname(source)) + ".docx");
fs.mkdirSync(outdir, { recursive: true });
fs.copyFileSync(template, output);
`, "utf8");

  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    compatibilityConverters: [
      {
        name: "测试转换器",
        command: process.execPath,
        args: [converterScript, convertedTemplate],
        sourceTypes: ["doc"]
      }
    ]
  };
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const created = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  const completed = await runLatestJob(state);
  assert.equal(completed.ok, true);

  const normalizedText = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "normalized", "local-text.normalized.json"), "utf8"));
  assert.ok(normalizedText.documents.some((item) => item.sourceType === "doc" && item.text.includes("转换后的 DOC 正文")));

  const conversionReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "compatibility-conversion.report.json"), "utf8"));
  assert.equal(conversionReport.summary.convertedDocuments, 1);
  assert.ok(conversionReport.records.some((item) => item.sourceType === "doc" && item.status === "converted" && item.converter === "测试转换器"));

  const filterReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "filter-report.json"), "utf8"));
  assert.equal(filterReport.review.filter((item) => item.sourceType === "doc").length, 0);
});

test("legacy aliyun jobs completed after the old report step resume at upload", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-legacy-aliyun-job-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "教材正文\n第三单元 小数除法。", "utf8");

  const now = new Date().toISOString();
  const task = (key, status, zh) => ({
    key,
    status,
    label: { zh, en: key },
    message: { zh: zh + " " + status, en: key + " " + status }
  });
  const legacyJob = {
    id: "legacy-aliyun-job",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 10, completed: 6, waiting: 0, running: 0, blocked: 4, failed: 0, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    },
    artifacts: [],
    tasks: [
      task("scan", "completed", "只读扫描"),
      task("merge", "completed", "整理执行计划"),
      task("pages", "completed", "资料处理准备"),
      task("clean", "completed", "清洗分段"),
      task("retrieval-policy", "completed", "准备问答策略"),
      task("report", "completed", "生成报告"),
      task("upload", "blocked", "上传资料"),
      task("ocr", "blocked", "OCR 识别"),
      task("embedding", "blocked", "生成检索数据"),
      task("index", "blocked", "写入知识库")
    ],
    failures: [],
    recovery: [],
    nextAction: { label: { zh: "查看任务结果", en: "View result" }, href: "/build/execution" }
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: legacyJob.id, jobs: [legacyJob] }, null, 2) + "\n", "utf8");

  const state = { projectRoot: temp, userDataRoot, enableSystemConverters: false };
  const restored = latestJob(state);
  assert.equal(restored.job.status, "waiting");
  assert.equal(restored.job.tasks.find((item) => item.key === "upload")?.status, "waiting");
  assert.equal(restored.job.progress.completed, 6);
  assert.equal(restored.job.progress.waiting, 4);

  const advanced = await advanceLatestJob(state);
  assert.equal(advanced.ok, false);
  assert.equal(advanced.job.status, "failed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "upload")?.status, "failed");
  assert.match(advanced.job.tasks.find((item) => item.key === "upload")?.message.zh || "", /上传资料/);
});

test("legacy aliyun jobs failed by old unavailable cloud executors resume from upload", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-legacy-cloud-failed-job-"));
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(userDataRoot, { recursive: true });

  const now = new Date().toISOString();
  const task = (key, status, zh, message = `${zh} ${status}`) => ({
    key,
    status,
    label: { zh, en: key },
    message: { zh: message, en: message }
  });
  const legacyUploadMessage = "上传资料 没有完成：上传资料的真实执行器还没有接入，KnowMesh 不会把这一步假装成已完成。";
  const legacyOcrMessage = "OCR 识别 没有完成：没有找到处理输入清单，请先完成上传资料。";
  const legacyJob = {
    id: "legacy-cloud-failed-job",
    status: "failed",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    progress: { total: 10, completed: 6, waiting: 2, running: 0, blocked: 0, failed: 2, skipped: 0, stopped: 0 },
    tasks: [
      task("scan", "completed", "只读扫描"),
      task("merge", "completed", "整理执行计划"),
      task("pages", "completed", "资料处理准备"),
      task("clean", "completed", "清洗分段"),
      task("retrieval-policy", "completed", "准备问答策略"),
      task("report", "completed", "生成报告"),
      task("upload", "failed", "上传资料", legacyUploadMessage),
      task("ocr", "failed", "OCR 识别", legacyOcrMessage),
      task("embedding", "waiting", "生成检索数据"),
      task("index", "waiting", "写入知识库")
    ],
    failures: [
      { key: "upload", retryable: true, label: { zh: "上传资料", en: "upload" }, message: { zh: legacyUploadMessage, en: legacyUploadMessage }, step: "/build/execution" },
      { key: "ocr", retryable: true, label: { zh: "OCR 识别", en: "ocr" }, message: { zh: legacyOcrMessage, en: legacyOcrMessage }, step: "/build/execution" }
    ],
    recovery: [
      { label: { zh: "回到任务页", en: "Back to tasks" }, href: "/build/execution", message: { zh: legacyUploadMessage, en: legacyUploadMessage } }
    ]
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: legacyJob.id, jobs: [legacyJob] }, null, 2) + "\n", "utf8");

  const restored = latestJob({ projectRoot: temp, userDataRoot, enableSystemConverters: false });

  assert.equal(restored.job.status, "waiting");
  for (const key of ["upload", "ocr", "embedding", "index"]) {
    assert.equal(restored.job.tasks.find((item) => item.key === key)?.status, "waiting");
  }
  assert.equal(restored.job.progress.completed, 6);
  assert.equal(restored.job.progress.waiting, 4);
  assert.equal(restored.job.progress.failed, 0);
  assert.deepEqual(restored.job.failures, []);
  assert.deepEqual(restored.job.recovery, []);
});

test("failed jobs retry the failed task before later waiting tasks", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-failed-retry-order-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "教材正文", "utf8");

  const now = new Date().toISOString();
  const task = (key, status, zh, message = `${zh} ${status}`) => ({
    key,
    status,
    label: { zh, en: key },
    message: { zh: message, en: message }
  });
  const job = {
    id: "failed-retry-order-job",
    status: "failed",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 10, completed: 6, waiting: 3, running: 0, blocked: 0, failed: 1, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    },
    artifacts: [],
    tasks: [
      task("scan", "completed", "只读扫描"),
      task("merge", "completed", "整理执行计划"),
      task("pages", "completed", "资料处理准备"),
      task("clean", "completed", "清洗分段"),
      task("retrieval-policy", "completed", "准备问答策略"),
      task("report", "completed", "生成报告"),
      task("upload", "failed", "上传资料", "上传资料 没有完成：临时网络错误"),
      task("ocr", "waiting", "OCR 识别"),
      task("embedding", "waiting", "生成检索数据"),
      task("index", "waiting", "写入知识库")
    ],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const advanced = await advanceLatestJob({
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    sourceArchiveUploader: async () => {
      throw new Error("retry upload marker");
    }
  });

  assert.equal(advanced.job.tasks.find((item) => item.key === "upload")?.status, "failed");
  assert.match(advanced.job.tasks.find((item) => item.key === "upload")?.message.zh || "", /retry upload marker/);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "waiting");
  assert.doesNotMatch(advanced.job.tasks.find((item) => item.key === "ocr")?.message.zh || "", /处理输入清单/);
});

test("long running job steps are visible as running while awaiting external work", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-running-progress-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "教材正文", "utf8");

  let releaseUpload;
  const uploadStarted = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  let uploaderEntered;
  const uploaderCalled = new Promise((resolve) => {
    uploaderEntered = resolve;
  });
  const state = {
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => {
      uploaderEntered();
      await uploadStarted;
      return { ok: true, status: 200, objectKey: item.objectKey };
    }
  };

  const now = new Date().toISOString();
  const task = (key, status, zh) => ({
    key,
    status,
    label: { zh, en: key },
    message: { zh: `${zh} ${status}`, en: `${key} ${status}` }
  });
  const job = {
    id: "running-progress-job",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 4, completed: 0, waiting: 4, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    },
    artifacts: [],
    tasks: [
      task("upload", "waiting", "上传资料"),
      task("ocr", "waiting", "OCR 识别"),
      task("embedding", "waiting", "生成检索数据"),
      task("index", "waiting", "写入知识库")
    ],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const advancing = advanceLatestJob(state);
  await uploaderCalled;
  const running = latestJob(state).job;

  assert.equal(running.status, "running");
  assert.equal(running.progress.running, 1);
  assert.equal(running.tasks.find((item) => item.key === "upload")?.status, "running");
  assert.match(running.tasks.find((item) => item.key === "upload")?.message.zh || "", /正在/);
  assert.ok(running.events.some((item) => item.type === "step-start" && item.taskKey === "upload"));

  releaseUpload();
  const advanced = await advancing;
  assert.equal(advanced.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.ok(advanced.job.events.some((item) => item.type === "step-complete" && item.taskKey === "upload"));
});
test("jobs left running by a stopped service are repaired to resumable waiting", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-stale-running-job-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });

  const now = new Date().toISOString();
  const task = (key, status, zh) => ({
    key,
    status,
    label: { zh, en: key },
    message: { zh: `${zh} ${status}`, en: `${key} ${status}` }
  });
  const job = {
    id: "stale-running-job",
    status: "running",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 3, completed: 1, waiting: 1, running: 1, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    },
    artifacts: [],
    tasks: [
      task("merge", "completed", "整理执行计划"),
      task("upload", "running", "上传资料"),
      task("ocr", "waiting", "OCR 识别")
    ],
    events: [],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const restored = latestJob({ projectRoot: temp, userDataRoot, enableSystemConverters: false }).job;

  assert.equal(restored.status, "waiting");
  assert.equal(restored.progress.completed, 1);
  assert.equal(restored.progress.running, 0);
  assert.equal(restored.progress.waiting, 2);
  assert.equal(restored.pauseRequested, undefined);
  assert.equal(restored.tasks.find((item) => item.key === "merge")?.status, "completed");
  assert.equal(restored.tasks.find((item) => item.key === "upload")?.status, "waiting");
  assert.match(restored.tasks.find((item) => item.key === "upload")?.message.zh || "", /上次执行中断/);
  assert.ok(restored.events.some((item) => item.type === "job-repaired" && item.taskKey === "upload"));
});
test("pause requested during a running step is preserved after the step finishes", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-safe-pause-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "教材正文", "utf8");

  let uploaderEntered = null;
  let releaseUpload = null;
  const uploadStarted = new Promise((resolve) => {
    uploaderEntered = resolve;
  });
  const uploadMayFinish = new Promise((resolve) => {
    releaseUpload = resolve;
  });

  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => {
      uploaderEntered();
      await uploadMayFinish;
      return { ok: true, status: 200, objectKey: item.objectKey };
    }
  };

  const now = new Date().toISOString();
  const task = (key, status, zh) => ({
    key,
    status,
    label: { zh, en: key },
    message: { zh: `${zh} ${status}`, en: `${key} ${status}` }
  });
  const job = {
    id: "safe-pause-job",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 3, completed: 0, waiting: 3, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    },
    artifacts: [],
    tasks: [
      task("upload", "waiting", "上传资料"),
      task("ocr", "waiting", "OCR 识别"),
      task("embedding", "waiting", "生成检索数据")
    ],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const advancing = advanceLatestJob(state);
  await uploadStarted;

  const pause = pauseLatestJob(state);
  assert.equal(pause.ok, true);
  assert.equal(pause.job.status, "pausing");
  assert.equal(pause.job.pauseRequested, true);
  assert.equal(pause.job.tasks.find((item) => item.key === "upload")?.status, "running");

  releaseUpload();
  const advanced = await advancing;

  assert.equal(advanced.ok, false);
  assert.equal(advanced.job.status, "paused");
  assert.equal(advanced.job.pauseRequested, false);
  assert.equal(advanced.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "waiting");
  assert.ok(advanced.job.events.some((item) => item.type === "job-pause-requested"));
  assert.ok(advanced.job.events.some((item) => item.type === "job-paused" && item.taskKey === "upload"));

  const resumed = resumeLatestJob(state);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.job.status, "waiting");
  assert.equal(resumed.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.equal(resumed.job.tasks.find((item) => item.key === "ocr")?.status, "waiting");
});
test("aliyun upload archives originals and writes processing inputs before OCR", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-upload-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 位置\n正文内容。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  const uploadRequests = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    archiveConcurrency: 2,
    fetchImpl: async (url, options = {}) => {
      uploadRequests.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        headers: { get: (name) => name.toLowerCase() === "etag" ? "test-etag" : "" }
      };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const draft = {
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot,
    "aliyun.region": "cn-hangzhou",
    "aliyun.storage.bucket": "knowmesh-source",
    "aliyun.search.bucket": "knowmesh-vector",
    "aliyun.search.index": "textbookv1",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.embedding": "text-embedding-v4"
  };

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let uploaded = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    uploaded = await advanceLatestJob(state);
    const uploadStatus = uploaded.job.tasks.find((item) => item.key === "upload")?.status;
    if (uploadStatus !== "waiting") break;
  }

  assert.equal(uploaded.ok, true);
  assert.equal(uploaded.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.equal(uploaded.job.tasks.find((item) => item.key === "ocr")?.status, "waiting");
  assert.equal(uploadRequests.length, 2);
  assert.ok(uploadRequests.every((item) => item.url.includes("knowmesh-source.oss-cn-hangzhou.aliyuncs.com")));
  assert.ok(uploadRequests.every((item) => item.url.includes("/raw/")));
  assert.ok(uploadRequests.every((item) => item.options.method === "PUT"));
  assert.ok(uploadRequests.every((item) => item.options.headers.authorization.startsWith("OSS LTAI_TEST:")));
  assert.ok(uploadRequests.every((item) => Number(item.options.headers["content-length"]) > 0));

  const archiveManifest = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "archive", "source-archive.manifest.json"), "utf8"));
  assert.equal(archiveManifest.summary.originalFiles, 2);
  assert.equal(archiveManifest.summary.uploadedFiles, 2);
  assert.equal(archiveManifest.archivePolicy.noUploadDownloadLoop, true);
  assert.ok(archiveManifest.files.every((item) => item.status === "uploaded"));

  const processingManifest = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "processing", "processing-input.manifest.json"), "utf8"));
  assert.equal(processingManifest.summary.documents, 2);
  assert.ok(processingManifest.inputs.some((item) => item.sourceType === "text" && item.vectorizeFrom === "cleaned-chunks"));
  assert.ok(processingManifest.inputs.some((item) => item.sourceType === "pdf" && item.processingInput === "page-tasks" && item.ocrInput === "page-image-tasks"));
});


test("aliyun upload retries transient source archive failures", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-upload-retry-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 位置。", "utf8");

  let uploadAttempts = 0;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    archiveRetryDelayMs: 0,
    sourceArchiveUploader: async (item) => {
      uploadAttempts += 1;
      if (uploadAttempts === 1) return { ok: false, status: 503, message: "temporary service unavailable" };
      return { ok: true, status: 200, objectKey: item.objectKey };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const uploadStatus = advanced.job.tasks.find((item) => item.key === "upload")?.status;
    if (uploadStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.equal(uploadAttempts, 2);
});


test("aliyun upload resumes by skipping already archived originals", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-upload-resume-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson-a.txt"), "第一单元 位置。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-b.txt"), "第二单元 小数乘法。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-c.txt"), "第三单元 小数除法。", "utf8");

  const uploadCounts = new Map();
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    archiveConcurrency: 1,
    sourceArchiveUploader: async (item) => {
      uploadCounts.set(item.relativePath, (uploadCounts.get(item.relativePath) || 0) + 1);
      if (item.relativePath === "lesson-b.txt" && uploadCounts.get(item.relativePath) === 1) {
        return { ok: false, status: 403, message: "permission denied", objectKey: item.objectKey };
      }
      return { ok: true, status: 200, objectKey: item.objectKey };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let failed = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    failed = await advanceLatestJob(state);
    const uploadStatus = failed.job.tasks.find((item) => item.key === "upload")?.status;
    if (uploadStatus !== "waiting") break;
  }
  assert.equal(failed.ok, false);
  assert.equal(failed.job.tasks.find((item) => item.key === "upload")?.status, "failed");

  const archiveManifest = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "archive", "source-archive.manifest.json"), "utf8"));
  assert.equal(archiveManifest.summary.uploadedFiles, 2);
  assert.equal(archiveManifest.summary.failedFiles, 1);

  const retried = await advanceLatestJob(state);
  assert.equal(retried.ok, true);
  assert.equal(retried.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.equal(uploadCounts.get("lesson-a.txt"), 1);
  assert.equal(uploadCounts.get("lesson-b.txt"), 2);
  assert.equal(uploadCounts.get("lesson-c.txt"), 1);
  assert.ok(retried.job.events.some((item) => /跳过已归档/.test(item.message.zh)));
});
test("job events persist detailed execution log lines while archiving sources", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-job-log-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson-a.txt"), "第一单元 位置。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-b.txt"), "第二单元 小数乘法。", "utf8");

  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey })
  };

  const now = new Date().toISOString();
  const job = {
    id: "detailed-log-job",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 2, logicalDocuments: 2 },
    progress: { total: 1, completed: 0, waiting: 1, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    },
    artifacts: [],
    tasks: [
      {
        key: "upload",
        status: "waiting",
        label: { zh: "上传资料", en: "upload" },
        message: { zh: "继续上传资料。", en: "Continue upload." }
      }
    ],
    failures: [],
    recovery: []
  };
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const advanced = await advanceLatestJob(state);
  assert.equal(advanced.ok, true);

  const messages = advanced.job.events.map((item) => item.message.zh);
  assert.ok(messages.some((message) => /准备归档 2 个原始文件/.test(message)));
  assert.ok(messages.some((message) => /上传原始文件 1\/2/.test(message)));
  assert.ok(messages.some((message) => /上传原始文件 2\/2/.test(message)));
  assert.ok(messages.some((message) => /处理输入清单/.test(message)));

  const restored = latestJob({ projectRoot: temp, userDataRoot }).job;
  assert.ok(restored.events.some((item) => /上传原始文件 2\/2/.test(item.message.zh)));
});

test("local execution writes a durable checkpoint for every task", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-task-checkpoints-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 小数乘法。", "utf8");

  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data"), enableSystemConverters: false , knowledgeBaseId: migratedK12KnowledgeBaseId };
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const created = await confirmLocalJob(state, {
    mode: "local",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  const completed = await runLatestJob(state);
  assert.equal(completed.ok, true);
  assert.equal(completed.job.status, "completed");

  const executionRoot = path.join(completed.job.summary.workspaceRoot, "artifacts", "execution", "jobs", completed.job.id);
  const eventLog = path.join(executionRoot, "events.jsonl");
  assert.ok(fs.existsSync(eventLog));
  const events = fs.readFileSync(eventLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.some((item) => item.type === "step-start" && item.taskKey === "merge"));
  assert.ok(events.some((item) => item.type === "step-complete" && item.taskKey === "report"));

  for (const task of completed.job.tasks.filter((item) => item.status !== "skipped")) {
    const checkpointPath = path.join(executionRoot, "checkpoints", `${task.key}.checkpoint.json`);
    assert.ok(fs.existsSync(checkpointPath), `${task.key} checkpoint missing`);
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    assert.equal(checkpoint.task.key, task.key);
    assert.equal(checkpoint.task.status, task.status);
    assert.equal(checkpoint.job.id, completed.job.id);
  }
});

test("execution artifacts are isolated by knowledge base, dataset version, and job", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-kb-version-isolation-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceBase = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceBase, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 小数乘法。这里是用于生成知识库的正文。", "utf8");

  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => items.map((item, index) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [index + 0.1, index + 0.2, index + 0.3]
    })),
    vectorBatchWriter: async ({ items, target }) => items.map((item) => ({
      chunk_id: item.chunk_id,
      status: "written",
      remoteId: `${target.index}:${item.chunk_id}`
    }))
  };
  const kb = createKnowledgeBase(state, { name: "Alpha Library", template: "general-docs" });
  await saveAliyunCredentials(state, { accessKeyId: "LTAI_TEST", accessKeySecret: "secret" });
  await saveAliyunModelProvider(state, { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "sk-test" });
  saveAliyunModelQuality(state, { "aliyun.services.embedding": "text-embedding-v4" });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });
  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceBase,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.region": "cn-hangzhou",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "alphav1",
      "aliyun.services.modelQuality.configured": true,
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.organizer": "qwen-plus",
      "aliyun.services.embedding": "text-embedding-v4",
      "aliyun.services.rerank": "qwen3-rerank"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));
  assert.equal(created.job.knowledgeBase.id, kb.id);
  assert.ok(created.job.datasetVersionId);

  const completed = await runLatestJob(state);
  assert.equal(completed.ok, true);
  assert.equal(completed.job.status, "completed");
  const versionRoot = path.join(workspaceBase, "knowledge-bases", kb.id, "versions", completed.job.datasetVersionId);
  assert.equal(completed.job.summary.baseWorkspaceRoot, workspaceBase);
  assert.equal(completed.job.summary.workspaceRoot, versionRoot);
  assert.equal(completed.job.draft["project.workspace"], versionRoot);
  assert.equal(completed.job.draft["project.workspace.base"], workspaceBase);

  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "reports", "search-data.report.json")), true);
  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "reports", "knowledge-write.report.json")), true);
  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "index_records", "index-records.pending.jsonl")), true);
  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "index_records", "index-write.result.jsonl")), true);
  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "execution", "jobs", completed.job.id, "events.jsonl")), true);
  assert.equal(fs.existsSync(path.join(workspaceBase, "artifacts", "execution", "jobs", completed.job.id, "events.jsonl")), false);

  const indexRows = readCatalogRows(state, kb.id, `
    SELECT record_id, chunk_id, provider, index_name, status, vector_id, metadata_json
    FROM index_records
    ORDER BY chunk_id
  `);
  assert.ok(indexRows.length > 0);
  assert.ok(indexRows.every((row) => row.provider === "aliyun-vector"));
  assert.ok(indexRows.every((row) => row.index_name === "alphav1"));
  assert.ok(indexRows.every((row) => row.status === "written"));
  assert.ok(indexRows.every((row) => String(row.vector_id || "").startsWith("alphav1:")));
  const indexMetadata = indexRows.map((row) => JSON.parse(row.metadata_json));
  assert.ok(indexMetadata.every((item) => item.datasetVersionId === completed.job.datasetVersionId));
  assert.ok(indexMetadata.every((item) => item.retry?.stage === "index"));
  assert.ok(indexMetadata.every((item) => item.text));

  const activeManifest = JSON.parse(fs.readFileSync(path.join(versionRoot, "manifests", "active-manifest.json"), "utf8"));
  assert.equal(activeManifest.knowledgeBase.id, kb.id);
  assert.equal(activeManifest.datasetVersionId, completed.job.datasetVersionId);

  const buildRows = readCatalogRows(state, kb.id, `
    SELECT build_id, status, active, summary_json
    FROM build_versions
    ORDER BY updated_at DESC
  `);
  assert.equal(buildRows.length, 1);
  assert.equal(buildRows[0].build_id, completed.job.datasetVersionId);
  assert.equal(buildRows[0].status, "active");
  assert.equal(buildRows[0].active, 1);
  assert.equal(JSON.parse(buildRows[0].summary_json).job.id, completed.job.id);

  const releaseRows = readCatalogRows(state, kb.id, `
    SELECT release_id, build_id, status, manifest_path, summary_json
    FROM release_manifests
    ORDER BY updated_at DESC
  `);
  assert.equal(releaseRows.length, 1);
  assert.equal(releaseRows[0].build_id, completed.job.datasetVersionId);
  assert.equal(releaseRows[0].status, "active");
  assert.equal(path.resolve(releaseRows[0].manifest_path), path.join(versionRoot, "manifests", "active-manifest.json"));
  assert.equal(JSON.parse(releaseRows[0].summary_json).target.index, "alphav1");
});

test("legacy job assets are adopted into a knowledge-base version workspace", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-legacy-kb-version-"));
  const workspaceBase = path.join(temp, "workspace");
  const sourceRoot = path.join(temp, "source");
  const userDataRoot = path.join(temp, "user-data");
  const kbDataRoot = path.join(userDataRoot, "knowledge-bases", "default");
  fs.mkdirSync(path.join(workspaceBase, "artifacts", "ocr"), { recursive: true });
  fs.mkdirSync(kbDataRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceBase, "artifacts", "ocr", "ocr-result.jsonl"), `${JSON.stringify({ taskId: "p1", status: "recognized", text: "第一页" })}\n`, "utf8");
  const now = new Date().toISOString();
  const job = {
    id: "legacy-version-job",
    status: "paused",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "textbook-cn-k12",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot: workspaceBase, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 2, completed: 1, waiting: 1, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: { "project.source": sourceRoot, "project.workspace": workspaceBase },
    artifacts: [{ key: "ocrResult", path: path.join(workspaceBase, "artifacts", "ocr", "ocr-result.jsonl") }],
    tasks: [
      { key: "ocr", status: "waiting", label: { zh: "OCR 识别", en: "OCR" }, message: { zh: "OCR 已暂停。", en: "OCR paused." } }
    ],
    events: [],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(kbDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const restored = latestJob({ projectRoot: temp, userDataRoot });
  assert.equal(restored.ok, true);
  assert.equal(restored.job.knowledgeBase.id, migratedK12KnowledgeBaseId);
  assert.ok(restored.job.datasetVersionId);
  const versionRoot = path.join(workspaceBase, "knowledge-bases", migratedK12KnowledgeBaseId, "versions", restored.job.datasetVersionId);
  assert.equal(restored.job.summary.workspaceRoot, versionRoot);
  assert.equal(restored.job.summary.baseWorkspaceRoot, workspaceBase);
  assert.equal(restored.job.draft["project.workspace"], versionRoot);
  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "ocr", "ocr-result.jsonl")), true);
  assert.equal(restored.job.artifacts[0].path, path.join(versionRoot, "artifacts", "ocr", "ocr-result.jsonl"));
  assert.equal(fs.existsSync(path.join(versionRoot, "artifacts", "execution", "jobs", job.id, "checkpoints", "ocr.checkpoint.json")), true);
});

test("legacy jobs in non-K12 registry paths are cleaned without recovery", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-legacy-kb-owner-"));
  const workspaceBase = path.join(temp, "workspace");
  const sourceRoot = path.join(temp, "source");
  const userDataRoot = path.join(temp, "user-data");
  const wrongRoot = path.join(userDataRoot, "knowledge-bases", "kb-other");
  fs.mkdirSync(path.join(workspaceBase, "artifacts", "ocr"), { recursive: true });
  fs.mkdirSync(wrongRoot, { recursive: true });
  fs.writeFileSync(path.join(workspaceBase, "artifacts", "ocr", "ocr-result.jsonl"), `${JSON.stringify({ taskId: "p1", status: "recognized", text: "第一页" })}\n`, "utf8");
  const now = new Date().toISOString();
  const job = {
    id: "registry-owned-job",
    status: "paused",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "textbook-cn-k12",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot: workspaceBase, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 2, completed: 1, waiting: 1, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: { "project.source": sourceRoot, "project.workspace": workspaceBase },
    artifacts: [{ key: "ocrResult", path: path.join(workspaceBase, "artifacts", "ocr", "ocr-result.jsonl") }],
    tasks: [
      { key: "ocr", status: "waiting", label: { zh: "OCR 识别", en: "OCR" }, message: { zh: "OCR 已暂停。", en: "OCR paused." } }
    ],
    events: [],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "knowledge-bases.json"), JSON.stringify({
    kind: "knowmesh.knowledgeBaseRegistry",
    apiVersion: "v1",
    currentId: "kb-other",
    updatedAt: now,
    items: [
      {
        id: "default",
        name: "K12全科知识库",
        template: "textbook-cn-k12",
        status: "active",
        latestJobId: job.id,
        latestJobStatus: "paused",
        sourceRoot,
        workspaceRoot: workspaceBase,
        createdAt: now,
        updatedAt: now
      },
      {
        id: "kb-other",
        name: "测试",
        template: "textbook-cn-k12",
        status: "configured",
        latestJobId: "",
        latestJobStatus: "",
        sourceRoot,
        workspaceRoot: workspaceBase,
        createdAt: now,
        updatedAt: now
      }
    ]
  }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(wrongRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const restored = latestJob({ projectRoot: temp, userDataRoot });

  assert.equal(restored.ok, false);
  assert.equal(restored.job, null);
  assert.equal(fs.existsSync(path.join(wrongRoot, "jobs-state.json")), false);
  assert.equal(fs.existsSync(catalogDatabasePath({ projectRoot: temp, userDataRoot }, migratedK12KnowledgeBaseId)), true);
  assert.deepEqual(readCatalogRows({ projectRoot: temp, userDataRoot }, migratedK12KnowledgeBaseId, "select job_id from jobs"), []);
});
test("loading an existing job backfills durable journal and task checkpoints", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-backfill-job-records-"));
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  const now = new Date().toISOString();
  const job = {
    id: "legacy-record-job",
    status: "paused",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot: path.join(temp, "source"), workspaceRoot, includedFiles: 1, logicalDocuments: 1 },
    progress: { total: 2, completed: 1, waiting: 1, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: {},
    artifacts: [],
    tasks: [
      { key: "upload", status: "completed", label: { zh: "上传资料", en: "upload" }, message: { zh: "上传资料 已完成。", en: "upload complete." } },
      { key: "ocr", status: "waiting", label: { zh: "OCR 识别", en: "OCR" }, message: { zh: "OCR 已暂停。", en: "OCR paused." } }
    ],
    events: [
      { id: "old-1", timestamp: now, type: "step-complete", taskKey: "upload", status: "completed", label: { zh: "上传资料", en: "upload" }, message: { zh: "上传资料 已完成。", en: "upload complete." } }
    ],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const restored = latestJob({ projectRoot: temp, userDataRoot });
  assert.equal(restored.ok, true);
  const executionRoot = path.join(restored.job.summary.workspaceRoot, "artifacts", "execution", "jobs", job.id);
  const eventLog = path.join(executionRoot, "events.jsonl");
  assert.ok(fs.existsSync(eventLog));
  const durableEvents = fs.readFileSync(eventLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(durableEvents.some((item) => item.type === "step-complete" && item.taskKey === "upload"));
  assert.equal(restored.job.eventSequence, 1);
  const restoredAgain = latestJob({ projectRoot: temp, userDataRoot });
  assert.equal(restoredAgain.job.eventSequence, 1);
  for (const key of ["upload", "ocr"]) {
    const checkpointPath = path.join(executionRoot, "checkpoints", `${key}.checkpoint.json`);
    assert.ok(fs.existsSync(checkpointPath), `${key} checkpoint missing`);
  }
});
test("durable job event journal is not capped by the recent UI event snapshot", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-durable-job-journal-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  for (let index = 1; index <= 105; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${String(index).padStart(3, "0")}.txt`), `第 ${index} 课。`, "utf8");
  }

  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey })
  };
  const now = new Date().toISOString();
  const job = {
    id: "long-journal-job",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    mode: "aliyun",
    template: "general-docs",
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: { sourceRoot, workspaceRoot, includedFiles: 105, logicalDocuments: 105 },
    progress: { total: 1, completed: 0, waiting: 1, running: 0, blocked: 0, failed: 0, skipped: 0, stopped: 0 },
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source"
    },
    artifacts: [],
    tasks: [
      {
        key: "upload",
        status: "waiting",
        label: { zh: "上传资料", en: "upload" },
        message: { zh: "继续上传资料。", en: "Continue upload." }
      }
    ],
    failures: [],
    recovery: []
  };
  fs.writeFileSync(path.join(userDataRoot, "jobs-state.json"), JSON.stringify({ latestJobId: job.id, jobs: [job] }, null, 2) + "\n", "utf8");

  const advanced = await advanceLatestJob(state);
  assert.equal(advanced.ok, true);
  const eventLog = path.join(advanced.job.summary.workspaceRoot, "artifacts", "execution", "jobs", job.id, "events.jsonl");
  assert.ok(fs.existsSync(eventLog));
  const durableEvents = fs.readFileSync(eventLog, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(durableEvents.length > 200);
  assert.ok(durableEvents.length > advanced.job.events.length);
  assert.ok(durableEvents.some((item) => /上传原始文件 1\/105/.test(item.message.zh)));
  assert.ok(durableEvents.some((item) => /上传原始文件 105\/105/.test(item.message.zh)));
});
test("ocr batch recognizer splits oversized batches and keeps result order", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-ocr-split-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  const batchSizes = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    ocrBatchSize: 6,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      const outputArg = args.find((item) => item.startsWith("-sOutputFile="));
      const outputPattern = outputArg.replace("-sOutputFile=", "");
      fs.mkdirSync(path.dirname(outputPattern), { recursive: true });
      for (let page = 1; page <= 6; page += 1) {
        fs.writeFileSync(outputPattern.replace("%04d", String(page).padStart(4, "0")), Buffer.from(`fake png ${page}`));
      }
      return { stdout: "", stderr: "" };
    },
    ocrBatchRecognizer: async ({ items }) => {
      batchSizes.push(items.length);
      if (items.length > 3) {
        const error = new Error("ocr batch too large");
        error.status = 413;
        throw error;
      }
      return items.map((item) => ({
        taskId: item.taskId,
        status: "recognized",
        text: `OCR 文本：${item.pageNumber}`,
        confidence: 0.95
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.deepEqual(batchSizes, [6, 3, 3]);
  assert.ok(advanced.job.events.some((item) => /OCR 批次被限流或过大，已拆成 3 \+ 3 个小批/.test(item.message.zh)));
});

test("aliyun ocr reuses rendered PDF pages when retrying after OCR fails before results are written", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-ocr-page-cache-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  let renderCalls = 0;
  let failOnce = true;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    ocrBatchSize: 2,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      renderCalls += 1;
      const outputArg = args.find((item) => item.startsWith("-sOutputFile="));
      const outputPattern = outputArg.replace("-sOutputFile=", "");
      fs.mkdirSync(path.dirname(outputPattern), { recursive: true });
      for (let page = 1; page <= 2; page += 1) {
        fs.writeFileSync(outputPattern.replace("%04d", String(page).padStart(4, "0")), Buffer.from(`fake png ${page}`));
      }
      return { stdout: "", stderr: "" };
    },
    ocrBatchRecognizer: async ({ items }) => {
      if (failOnce) {
        failOnce = false;
        const error = new Error("temporary OCR validation failure");
        error.status = 400;
        throw error;
      }
      return items.map((item) => ({
        taskId: item.taskId,
        status: "recognized",
        text: `OCR 文本：${item.pageNumber}`,
        confidence: 0.95
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let failed = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    failed = await advanceLatestJob(state);
    const ocrStatus = failed.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }
  assert.equal(failed.ok, false);
  assert.equal(failed.job.tasks.find((item) => item.key === "ocr")?.status, "failed");
  assert.equal(renderCalls, 1);

  for (const manifest of fs.globSync(artifactPath(workspaceRoot, "ocr", "pages", "*", "pages.manifest.json"))) {
    fs.unlinkSync(manifest);
  }

  const completed = await advanceLatestJob(state);
  assert.equal(completed.ok, true);
  assert.equal(completed.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(renderCalls, 1);
  assert.ok(completed.job.events.some((item) => /复用已存在页图/.test(item.message.zh)));
});

test("aliyun ocr runs page and image tasks through the batch recognizer", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-ocr-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册图示.png"), "image placeholder", "utf8");

  const batchCalls = [];
  const renderedPdfPages = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfPageRenderer: async ({ document, outputDir }) => {
      const pages = [1, 2].map((pageNumber) => {
        const filePath = path.join(outputDir, document.version_id + "-page-" + pageNumber + ".png");
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "page " + pageNumber, "utf8");
        return { pageNumber, path: filePath, width: 1200, height: 1600 };
      });
      renderedPdfPages.push({ document_id: document.document_id, pages: pages.length });
      return pages;
    },
    ocrBatchRecognizer: async ({ items, model }) => {
      batchCalls.push({ model, items });
      return items.map((item) => ({
        taskId: item.taskId,
        status: "recognized",
        text: "OCR " + item.document.title + " " + item.pageNumber,
        confidence: 0.97,
        usage: { pages: 1 }
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "waiting");
  assert.equal(advanced.job.executionPlan.stages.find((item) => item.key === "text")?.status, "completed");
  assert.deepEqual(renderedPdfPages.map((item) => item.pages), [2]);
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].model, "qwen-vl-ocr-2025-11-20");
  assert.equal(batchCalls[0].items.length, 3);
  assert.ok(batchCalls[0].items.some((item) => item.inputKind === "pdf-page" && item.pageNumber === 2));
  assert.ok(batchCalls[0].items.some((item) => item.inputKind === "image" && item.pageNumber === 1));

  const ocrResult = fs.readFileSync(artifactPath(workspaceRoot, "ocr", "ocr-result.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ocrResult.length, 3);
  assert.ok(ocrResult.every((item) => item.status === "recognized"));
  assert.ok(ocrResult.every((item) => item.model === "qwen-vl-ocr-2025-11-20"));

  const report = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "ocr-recognition.report.json"), "utf8"));
  assert.equal(report.engine.name, "KnowMesh Core");
  assert.equal(report.template.expertName, "KnowMesh Expert · K12");
  assert.equal(report.summary.totalTasks, 3);
  assert.equal(report.summary.batchCalls, 1);
  assert.equal(report.summary.failedTasks, 0);
  assert.equal(report.batchPolicy.mode, "batch-first");
});


test("aliyun ocr pauses after a batch and resumes without reprocessing completed tasks", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-ocr-pause-resume-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  const batchTaskIds = [];
  let pauseRequested = false;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    ocrBatchSize: 1,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfPageRenderer: async ({ document, outputDir }) => [1, 2, 3].map((pageNumber) => {
      const filePath = path.join(outputDir, document.version_id + "-page-" + pageNumber + ".png");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "page " + pageNumber, "utf8");
      return { pageNumber, path: filePath, width: 1200, height: 1600 };
    }),
    ocrBatchRecognizer: async ({ items, model }) => {
      batchTaskIds.push(items.map((item) => item.taskId));
      if (!pauseRequested) {
        pauseRequested = true;
        const pause = pauseLatestJob(state);
        assert.equal(pause.ok, true);
        assert.equal(pause.job.status, "pausing");
      }
      return items.map((item) => ({
        taskId: item.taskId,
        status: "recognized",
        text: "OCR " + item.pageNumber,
        confidence: 0.97,
        usage: { pages: 1 },
        model
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let paused = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    paused = await advanceLatestJob(state);
    if (paused.job.tasks.find((item) => item.key === "ocr")?.status !== "waiting") break;
  }

  const resultPath = artifactPath(workspaceRoot, "ocr", "ocr-result.jsonl");
  const firstRunResults = fs.readFileSync(resultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(paused.ok, false);
  assert.equal(paused.job.status, "paused");
  assert.equal(paused.job.tasks.find((item) => item.key === "ocr")?.status, "waiting");
  assert.equal(firstRunResults.length, 1);
  assert.equal(batchTaskIds.length, 1);
  assert.ok(paused.job.events.some((item) => item.type === "checkpoint" && item.taskKey === "ocr" && item.detail?.completedItems === 1));

  const resumed = resumeLatestJob(state);
  assert.equal(resumed.ok, true);
  const completed = await advanceLatestJob(state);
  const finalResults = fs.readFileSync(resultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(completed.ok, true);
  assert.equal(completed.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(finalResults.length, 3);
  assert.equal(new Set(finalResults.map((item) => item.taskId)).size, 3);
  assert.equal(batchTaskIds.length, 3);
  assert.ok(completed.job.events.some((item) => /已恢复 OCR 进度：跳过已完成 1 个任务/.test(item.message.zh)));
});
test("aliyun ocr merges split PDF parts before rendering pages", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-split-pdf-ocr-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "数学二年级上册.pdf.1"), Buffer.from("PDF-PART-1"));
  fs.writeFileSync(path.join(sourceRoot, "数学二年级上册.pdf.2"), Buffer.from("PDF-PART-2"));

  const renderInputs = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      const sourcePath = args.at(-1);
      renderInputs.push(sourcePath);
      assert.equal(fs.readFileSync(sourcePath, "utf8"), "PDF-PART-1PDF-PART-2");
      assert.match(sourcePath, /artifacts[\\/]raw[\\/]数学二年级上册\.pdf$/);
      const outputArg = args.find((item) => item.startsWith("-sOutputFile="));
      const outputPattern = outputArg.replace("-sOutputFile=", "");
      const pagePath = outputPattern.replace("%04d", "0001");
      fs.mkdirSync(path.dirname(pagePath), { recursive: true });
      fs.writeFileSync(pagePath, Buffer.from("fake png"));
      return { stdout: "", stderr: "" };
    },
    ocrBatchRecognizer: async ({ items }) => items.map((item) => ({
      taskId: item.taskId,
      status: "recognized",
      text: "合并分卷后的 OCR 文本。",
      confidence: 0.98
    }))
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["二年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(renderInputs.length, 1);
  assert.equal(fs.readFileSync(artifactPath(workspaceRoot, "raw", "数学二年级上册.pdf"), "utf8"), "PDF-PART-1PDF-PART-2");
});
test("aliyun ocr stops split PDF when part numbers are missing", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-split-pdf-missing-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "数学二年级上册.pdf.1"), Buffer.from("PDF-PART-1"));
  fs.writeFileSync(path.join(sourceRoot, "数学二年级上册.pdf.3"), Buffer.from("PDF-PART-3"));

  const renderInputs = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      renderInputs.push(args.at(-1));
      return { stdout: "", stderr: "" };
    },
    ocrBatchRecognizer: async ({ items }) => items.map((item) => ({
      taskId: item.taskId,
      status: "recognized",
      text: "不应该识别到这里。"
    }))
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["二年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, false);
  const ocrTask = advanced.job.tasks.find((item) => item.key === "ocr");
  assert.equal(ocrTask?.status, "failed");
  assert.match(ocrTask?.message.zh || "", /缺少分卷 2/);
  assert.equal(renderInputs.length, 0);
});
test("aliyun ocr uses saved Model Studio provider when no custom recognizer is injected", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-ocr-provider-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  const requests = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      const outputArg = args.find((item) => item.startsWith("-sOutputFile="));
      const outputPattern = outputArg.replace("-sOutputFile=", "");
      const pagePath = outputPattern.replace("%04d", "0001");
      fs.mkdirSync(path.dirname(pagePath), { recursive: true });
      fs.writeFileSync(pagePath, Buffer.from("fake png"));
      return { stdout: "", stderr: "" };
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, authorization: options.headers?.authorization, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: "第一页 OCR 文本：小数除法。" } }],
          usage: { total_tokens: 128 }
        })
      };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  await saveAliyunModelProvider(state, {
    provider: "aliyun-bailian",
    protocol: "openai-compatible",
    region: "cn-beijing",
    workspaceId: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-bailian-secret"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(requests[0].authorization, "Bearer sk-bailian-secret");
  assert.equal(requests[0].body.model, "qwen-vl-ocr-2025-11-20");
  assert.ok(requests[0].body.messages[0].content.some((item) => item.type === "image_url" && item.image_url.url.startsWith("data:image/png;base64,")));

  const ocrResult = fs.readFileSync(artifactPath(workspaceRoot, "ocr", "ocr-result.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(ocrResult.length, 1);
  assert.equal(ocrResult[0].status, "recognized");
  assert.match(ocrResult[0].text, /小数除法/);
});
test("aliyun model provider OCR uses higher default concurrency", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-ocr-concurrency-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  let inflight = 0;
  let maxInflight = 0;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      const outputArg = args.find((item) => item.startsWith("-sOutputFile="));
      const outputPattern = outputArg.replace("-sOutputFile=", "");
      fs.mkdirSync(path.dirname(outputPattern), { recursive: true });
      for (let page = 1; page <= 16; page += 1) {
        fs.writeFileSync(outputPattern.replace("%04d", String(page).padStart(4, "0")), Buffer.from(`fake png ${page}`));
      }
      return { stdout: "", stderr: "" };
    },
    fetchImpl: async (url, options = {}) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 12));
      inflight -= 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: "OCR 文本：小数除法。" } }],
          usage: { total_tokens: 64 }
        })
      };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  await saveAliyunModelProvider(state, {
    provider: "aliyun-bailian",
    protocol: "openai-compatible",
    region: "cn-beijing",
    workspaceId: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-bailian-secret"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.ok(maxInflight >= 8, `expected at least 8 concurrent OCR requests, got ${maxInflight}`);
});

test("custom single OCR adapter is bounded by configured concurrency", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-custom-ocr-concurrency-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "小学数学五年级上册扫描教材.pdf"), "%PDF scanned placeholder", "utf8");

  let inflight = 0;
  let maxInflight = 0;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    ocrBatchSize: 12,
    ocrConcurrency: 3,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    pdfRendererCommand: "fake-gs",
    pdfRendererCommandRunner: async ({ args }) => {
      const outputArg = args.find((item) => item.startsWith("-sOutputFile="));
      const outputPattern = outputArg.replace("-sOutputFile=", "");
      fs.mkdirSync(path.dirname(outputPattern), { recursive: true });
      for (let page = 1; page <= 12; page += 1) {
        fs.writeFileSync(outputPattern.replace("%04d", String(page).padStart(4, "0")), Buffer.from(`fake png ${page}`));
      }
      return { stdout: "", stderr: "" };
    },
    ocrRecognizer: async ({ item }) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 8));
      inflight -= 1;
      return {
        taskId: item.taskId,
        status: "recognized",
        text: "OCR 文本：小数除法。",
        confidence: 0.95
      };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const ocrStatus = advanced.job.tasks.find((item) => item.key === "ocr")?.status;
    if (ocrStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(maxInflight, 3);
});
test("aliyun embedding batches cleaned and OCR chunks into search records", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-embedding-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 位置\n本课学习用数对确定位置, 能在方格纸上描述同学、建筑和图形的位置。第二单元学习小数乘法, 包括小数乘整数、小数乘小数和积的近似数。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "diagram.png"), "image placeholder", "utf8");

  const embeddingCalls = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    ocrBatchRecognizer: async ({ items }) => items.map((item) => ({
      taskId: item.taskId,
      status: "recognized",
      text: "图片页识别文本：几何图说明和例题。",
      confidence: 0.95,
      usage: { pages: 1 }
    })),
    embeddingBatchGenerator: async ({ items, model }) => {
      embeddingCalls.push({ model, items });
      return items.map((item, index) => ({
        chunkId: item.chunk_id,
        status: "embedded",
        embedding: [index + 0.1, index + 0.2, index + 0.3],
        usage: { tokens: item.text.length }
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const embeddingStatus = advanced.job.tasks.find((item) => item.key === "embedding")?.status;
    if (embeddingStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "index")?.status, "waiting");
  assert.equal(embeddingCalls.length, 1);
  assert.equal(embeddingCalls[0].model, "text-embedding-v4");
  assert.ok(embeddingCalls[0].items.some((item) => item.source === "cleaned-chunk"));
  assert.ok(embeddingCalls[0].items.some((item) => item.source === "ocr-page"));

  const records = fs.readFileSync(artifactPath(workspaceRoot, "index_records", "index-records.pending.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, embeddingCalls[0].items.length);
  assert.ok(records.every((item) => item.embedding_model === "text-embedding-v4"));
  assert.ok(records.every((item) => Array.isArray(item.embedding)));
  assert.ok(records.some((item) => item.metadata.source === "ocr-page"));

  const report = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "search-data.report.json"), "utf8"));
  assert.equal(report.engine.name, "KnowMesh Core");
  assert.equal(report.summary.batchCalls, 1);
  assert.equal(report.summary.failedItems, 0);
  assert.equal(report.batchPolicy.mode, "batch-first");
});



test("embedding input builder prefers catalog chunks over stale local chunk jsonl", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-catalog-embedding-inputs-"));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(path.join(artifactRoot, "chunks"), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, "normalized"), { recursive: true });
  writeJsonlForTest(path.join(artifactRoot, "chunks", "local-chunks.jsonl"), [
    {
      chunk_id: "stale-jsonl-chunk",
      document_id: "doc-stale",
      version_id: "ver-stale",
      text: "这是已经过期的 JSONL 片段，不应进入向量化输入。",
      sourceUri: "stale.txt",
      metadata: { title: "stale", sourceType: "text" }
    }
  ]);

  const state = { userDataRoot: path.join(temp, "user-data") };
  const knowledgeBase = createKnowledgeBase(state, { name: "Catalog Inputs", template: "general-docs" });
  const document = {
    document_id: "doc-catalog-input",
    version_id: "ver-catalog-input",
    title: "Catalog 权威资料",
    relativePath: "catalog.txt",
    sourceType: "text",
    text: "这是 catalog.sqlite 中的权威知识片段，应该进入向量化输入。"
  };
  syncCleanArtifactsToCatalog(state, {
    normalized: [document],
    chunks: [{
      chunk_id: "catalog-authoritative-chunk",
      document_id: document.document_id,
      version_id: document.version_id,
      active: false,
      text: document.text,
      sourceUri: document.relativePath,
      sourceParts: [],
      page_start: 1,
      page_end: 1,
      metadata: {
        title: document.title,
        sourceType: document.sourceType,
        relativePath: document.relativePath
      }
    }]
  }, {
    chunksPath: path.join(artifactRoot, "chunks", "local-chunks.jsonl"),
    normalizedPath: path.join(artifactRoot, "normalized", "local-text.normalized.json")
  });

  const result = buildEmbeddingInputs({
    project: { id: knowledgeBase.id },
    workspace: { artifactRoot },
    documents: [document]
  }, {
    template: "general-docs"
  }, { state });

  assert.deepEqual(result.inputs.map((item) => item.chunk_id), ["catalog-authoritative-chunk"]);
  assert.match(result.inputs[0].text, /catalog\.sqlite/);
  assert.equal(result.inventory.summary.excludedArtifacts, 0);
});

test("clean artifact catalog sync preserves review quality state on pages blocks and chunks", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-clean-quality-catalog-"));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(path.join(artifactRoot, "chunks"), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, "normalized"), { recursive: true });
  const state = { userDataRoot: path.join(temp, "user-data") };
  const knowledgeBase = createKnowledgeBase(state, { name: "Clean Quality Catalog", template: "general-docs" });
  const document = {
    document_id: "doc-review-quality",
    version_id: "ver-review-quality",
    title: "待复核资料",
    relativePath: "review.txt",
    sourceType: "text",
    text: "页眉"
  };

  syncCleanArtifactsToCatalog(state, {
    normalized: [document],
    chunks: [{
      chunk_id: "review-quality-chunk",
      document_id: document.document_id,
      version_id: document.version_id,
      text: "页眉",
      sourceUri: document.relativePath,
      page_start: 1,
      page_end: 1,
      metadata: {
        title: document.title,
        sourceType: document.sourceType,
        relativePath: document.relativePath,
        quality: {
          tier: "archive",
          lifecycle: "review",
          writeEnabled: false,
          score: 18,
          reasons: ["内容过短"]
        }
      }
    }]
  }, {
    chunksPath: path.join(artifactRoot, "chunks", "local-chunks.jsonl"),
    normalizedPath: path.join(artifactRoot, "normalized", "local-text.normalized.json")
  });

  const rows = readCatalogRows(state, knowledgeBase.id, `
    SELECT 'page' AS type, quality_state FROM pages WHERE page_id = ?
    UNION ALL
    SELECT 'block' AS type, quality_state FROM blocks WHERE block_id = ?
    UNION ALL
    SELECT 'chunk' AS type, quality_state FROM chunks WHERE chunk_id = ?
    ORDER BY type
  `, ["ver-review-quality:page:0001", "review-quality-chunk", "review-quality-chunk"]);

  assert.deepEqual(rows.map((row) => `${row.type}:${row.quality_state}`), [
    "block:review",
    "chunk:review",
    "page:review"
  ]);
});

test("embedding input builder excludes OCR and chunks outside the current K12 source scope", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-k12-embedding-scope-"));
  const artifactRoot = path.join(temp, "artifacts");
  fs.mkdirSync(path.join(artifactRoot, "chunks"), { recursive: true });
  fs.mkdirSync(path.join(artifactRoot, "ocr"), { recursive: true });

  const included = {
    document_id: "doc-included",
    version_id: "ver-included",
    title: "小学语文一年级上册",
    relativePath: "小学/语文/一年级/小学语文一年级上册.pdf",
    sourceType: "pdf"
  };
  const extra = {
    document_id: "doc-extra",
    version_id: "ver-extra",
    title: "小学语文书法练习指导一年级上册",
    relativePath: "小学/语文·书法练习指导/一年级/小学语文书法练习指导一年级上册.pdf",
    sourceType: "pdf"
  };

  writeJsonlForTest(path.join(artifactRoot, "chunks", "local-chunks.jsonl"), [
    {
      chunk_id: "ver-included_chunk_000001",
      document_id: included.document_id,
      version_id: included.version_id,
      text: "一年级语文正文片段",
      sourceUri: included.relativePath,
      metadata: { title: included.title, sourceType: included.sourceType }
    },
    {
      chunk_id: "ver-extra_chunk_000001",
      document_id: extra.document_id,
      version_id: extra.version_id,
      text: "书法练习指导正文片段",
      sourceUri: extra.relativePath,
      metadata: { title: extra.title, sourceType: extra.sourceType }
    }
  ]);
  writeJsonlForTest(path.join(artifactRoot, "ocr", "ocr-result.jsonl"), [
    {
      document_id: included.document_id,
      version_id: included.version_id,
      relativePath: included.relativePath,
      title: included.title,
      sourceType: included.sourceType,
      page_number: 1,
      status: "recognized",
      text: "一年级语文 OCR 文本"
    },
    {
      document_id: extra.document_id,
      version_id: extra.version_id,
      relativePath: extra.relativePath,
      title: extra.title,
      sourceType: extra.sourceType,
      page_number: 1,
      status: "recognized",
      text: "书法练习指导 OCR 文本"
    }
  ]);

  const result = buildEmbeddingInputs({
    project: { id: "textbook-cn-k12" },
    workspace: { artifactRoot },
    documents: [included]
  }, {
    template: "textbook-cn-k12",
    draft: {
      "metadata.stage": ["小学"],
      "metadata.subject": ["语文"],
      "metadata.grade": ["一年级"],
      "metadata.volume": ["上册"]
    }
  });

  assert.deepEqual(result.inputs.map((item) => item.document_id), [included.document_id, included.document_id]);
  assert.equal(result.inventory.summary.includedDocuments, 1);
  assert.equal(result.inventory.summary.excludedArtifacts, 2);
  assert.ok(result.inventory.excludedArtifacts.every((item) => item.document_id === extra.document_id));
});
test("custom single embedding adapter is bounded by configured concurrency", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-custom-embedding-concurrency-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (let index = 1; index <= 10; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${index}.txt`), `第 ${index} 课 知识点。这里是足够生成片段的正文内容。`, "utf8");
  }

  let inflight = 0;
  let maxInflight = 0;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    embeddingBatchSize: 10,
    embeddingConcurrency: 4,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingGenerator: async ({ item }) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 8));
      inflight -= 1;
      return {
        chunkId: item.chunk_id,
        status: "embedded",
        embedding: [0.1, 0.2, 0.3],
        usage: { tokens: item.text.length }
      };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const embeddingStatus = advanced.job.tasks.find((item) => item.key === "embedding")?.status;
    if (embeddingStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.equal(maxInflight, 4);
});
test("aliyun embedding pauses after a batch and resumes without reprocessing completed chunks", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-embedding-pause-resume-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson-a.txt"), "第一单元 位置。第二单元 小数乘法。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-b.txt"), "第三单元 小数除法。第四单元 可能性。", "utf8");

  const batchChunkIds = [];
  let pauseRequested = false;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    embeddingBatchSize: 1,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items, model }) => {
      batchChunkIds.push(items.map((item) => item.chunk_id));
      if (!pauseRequested) {
        pauseRequested = true;
        const pause = pauseLatestJob(state);
        assert.equal(pause.ok, true);
        assert.equal(pause.job.status, "pausing");
      }
      return items.map((item, index) => ({
        chunkId: item.chunk_id,
        status: "embedded",
        embedding: [index + 0.1, index + 0.2, index + 0.3],
        usage: { tokens: item.text.length },
        model
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let paused = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    paused = await advanceLatestJob(state);
    if (paused.job.tasks.find((item) => item.key === "embedding")?.status !== "waiting") break;
  }

  const recordsPath = path.join(paused.job.summary.workspaceRoot, "artifacts", "index_records", "index-records.pending.jsonl");
  const firstRunRecords = fs.readFileSync(recordsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(paused.ok, false);
  assert.equal(paused.job.status, "paused");
  assert.equal(paused.job.tasks.find((item) => item.key === "embedding")?.status, "waiting");
  assert.equal(firstRunRecords.length, 1);
  assert.equal(batchChunkIds.length, 1);
  assert.ok(paused.job.events.some((item) => item.type === "checkpoint" && item.taskKey === "embedding" && item.detail?.completedItems === 1));

  const resumed = resumeLatestJob(state);
  assert.equal(resumed.ok, true);
  const completed = await advanceLatestJob(state);
  const finalRecords = fs.readFileSync(recordsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(completed.ok, true);
  assert.equal(completed.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.equal(finalRecords.length, 2);
  assert.equal(new Set(finalRecords.map((item) => item.chunk_id)).size, 2);
  assert.equal(batchChunkIds.length, 2);
  assert.ok(completed.job.events.some((item) => /已恢复向量化进度：跳过已完成 1 个片段/.test(item.message.zh)));
});

test("embedding batch adapter splits oversized batches and keeps result order", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-embedding-split-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (let index = 1; index <= 6; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${index}.txt`), `第 ${index} 课 知识点。这里是用于批量向量化的正文内容。`, "utf8");
  }

  const batchSizes = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    embeddingBatchSize: 6,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => {
      batchSizes.push(items.length);
      if (items.length > 3) {
        const error = new Error("batch too large");
        error.status = 413;
        throw error;
      }
      return items.map((item, index) => ({
        chunkId: item.chunk_id,
        status: "embedded",
        embedding: [index + 0.1, index + 0.2, index + 0.3],
        usage: { tokens: item.text.length }
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const embeddingStatus = advanced.job.tasks.find((item) => item.key === "embedding")?.status;
    if (embeddingStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.deepEqual(batchSizes, [6, 3, 3]);
  assert.ok(advanced.job.events.some((item) => /拆成 3 \+ 3 个小批/.test(item.message.zh)));
});
test("aliyun embedding uses saved Model Studio provider with batched retry", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-embedding-provider-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson-a.txt"), "第一单元 位置。第二单元 小数乘法。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-b.txt"), "第三单元 小数除法。第四单元 可能性。", "utf8");

  const requests = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    embeddingRetryDelayMs: 0,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url: String(url),
        method: options.method,
        authorization: options.headers?.authorization || options.headers?.Authorization,
        body: JSON.parse(options.body)
      });
      if (requests.length === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: "too many requests" } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: JSON.parse(options.body).input.map((_, index) => ({
            index,
            embedding: [index + 0.01, index + 0.02, index + 0.03]
          })),
          usage: { total_tokens: 18 }
        })
      };
    }
  };

  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  await saveAliyunModelProvider(state, {
    provider: "aliyun-bailian",
    protocol: "openai-compatible",
    region: "cn-beijing",
    workspaceId: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-bailian-secret"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const embeddingStatus = advanced.job.tasks.find((item) => item.key === "embedding")?.status;
    if (embeddingStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings");
  assert.equal(requests[1].authorization, "Bearer sk-bailian-secret");
  assert.equal(requests[1].body.model, "text-embedding-v4");
  assert.ok(Array.isArray(requests[1].body.input));
  assert.ok(requests[1].body.input.length >= 2);

  const records = fs.readFileSync(artifactPath(workspaceRoot, "index_records", "index-records.pending.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.length, requests[1].body.input.length);
  assert.ok(records.every((item) => item.status === "embedded"));
  assert.ok(records.every((item) => Array.isArray(item.embedding)));

  const report = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "search-data.report.json"), "utf8"));
  assert.equal(report.batchPolicy.mode, "batch-first");
  assert.equal(report.batchPolicy.provider, "aliyun-bailian");
  assert.equal(report.batchPolicy.retry.maxAttempts, 3);
});
test("text-embedding-v4 provider batches stay within the model input limit", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-embedding-model-limit-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (let index = 1; index <= 23; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${index}.txt`), `第 ${index} 课 知识点。这里是用于生成向量化批次的正文内容。`, "utf8");
  }

  const requests = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    fetchImpl: async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requests.push(body.input.length);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: body.input.map((_, index) => ({ index, embedding: [index + 0.1, index + 0.2, index + 0.3] })),
          usage: { total_tokens: 100 }
        })
      };
    }
  };
  await saveAliyunCredentials(state, { accessKeyId: "LTAI_TEST", accessKeySecret: "secret", saveTarget: "secure-local" });
  await saveAliyunModelProvider(state, {
    provider: "aliyun-bailian",
    protocol: "openai-compatible",
    region: "cn-beijing",
    workspaceId: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-bailian-secret"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const embeddingStatus = advanced.job.tasks.find((item) => item.key === "embedding")?.status;
    if (embeddingStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.ok(requests.length >= 3, `expected multiple embedding requests, got ${requests.join(",")}`);
  assert.ok(requests.every((size) => size <= 10), `embedding request exceeded text-embedding-v4 limit: ${requests.join(",")}`);
});

test("embedding provider splits 400 invalid batch-size responses into smaller batches", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-embedding-400-split-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (let index = 1; index <= 24; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${index}.txt`), `第 ${index} 课 知识点。这里是用于测试批次拆分的正文内容。`, "utf8");
  }

  const requests = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    embeddingBatchSize: 24,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    fetchImpl: async (url, options = {}) => {
      const body = JSON.parse(options.body);
      requests.push(body.input.length);
      if (body.input.length > 5) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: "<400> InternalError.Algo.InvalidParameter: Value error, batch size is invalid, it should not be larger than 5.: input.contents" } })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: body.input.map((_, index) => ({ index, embedding: [index + 1, index + 2, index + 3] })),
          usage: { total_tokens: 100 }
        })
      };
    }
  };
  await saveAliyunCredentials(state, { accessKeyId: "LTAI_TEST", accessKeySecret: "secret", saveTarget: "secure-local" });
  await saveAliyunModelProvider(state, {
    provider: "aliyun-bailian",
    protocol: "openai-compatible",
    region: "cn-beijing",
    workspaceId: "",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-bailian-secret"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const embeddingStatus = advanced.job.tasks.find((item) => item.key === "embedding")?.status;
    if (embeddingStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "completed");
  assert.ok(requests.some((size) => size > 5), `expected one provider-rejected probe request, got ${requests.join(",")}`);
  assert.ok(requests.every((size) => size <= 10), `model-aware batch limit was exceeded: ${requests.join(",")}`);
  assert.ok(requests.some((size) => size === 5), `expected split retries at provider limit: ${requests.join(",")}`);
  assert.ok(advanced.job.events.some((item) => /拆成/.test(item.message?.zh || "") && item.taskKey === "embedding"));
});
test("aliyun index writes vector records in batches and activates the manifest", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-index-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 位置\n本课学习用数对确定位置, 能在方格纸上描述同学、建筑和图形的位置。第二单元学习小数乘法, 包括小数乘整数、小数乘小数和积的近似数。", "utf8");

  const writeCalls = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => items.map((item, index) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [index + 1, index + 2, index + 3],
      usage: { tokens: item.text.length }
    })),
    indexRetryDelayMs: 0,
    vectorBatchWriter: async ({ items, target }) => {
      writeCalls.push({ target, items });
      if (writeCalls.length === 1) throw new TypeError("temporary vector write reset");
      return items.map((item) => ({
        chunkId: item.chunk_id,
        status: "written",
        remoteId: target.index + ":" + item.chunk_id
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const indexStatus = advanced.job.tasks.find((item) => item.key === "index")?.status;
    if (indexStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "index")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "report")?.status, "waiting");
  assert.equal(writeCalls.length, 2);
  assert.equal(writeCalls[0].target.bucket, "knowmesh-vector");
  assert.equal(writeCalls[0].target.index, "generalv1");
  assert.ok(writeCalls[0].items.every((item) => item.active === true));

  const resultRecords = fs.readFileSync(artifactPath(workspaceRoot, "index_records", "index-write.result.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(resultRecords.length, writeCalls[0].items.length);
  assert.ok(resultRecords.every((item) => item.status === "written"));

  const activeManifest = JSON.parse(fs.readFileSync(manifestPath(workspaceRoot, "active-manifest.json"), "utf8"));
  assert.equal(activeManifest.status, "active");
  assert.equal(activeManifest.activeVersions.length, 1);

  const report = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "knowledge-write.report.json"), "utf8"));
  assert.equal(report.engine.name, "KnowMesh Core");
  assert.equal(report.batchPolicy.mode, "batch-first");
  assert.equal(report.summary.batchCalls, 1);
  assert.equal(report.summary.failedItems, 0);
});

test("aliyun OSS Vector putVectors uses the canonical V4 signature shape", async () => {
  const timestamp = new Date("2026-06-21T05:20:01.000Z");
  const requests = [];
  const result = await putVectors({
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret"
  }, {
    region: "cn-hangzhou",
    bucket: "knowmesh-vector",
    indexName: "generalv1",
    accountId: "123456789012",
    timestamp,
    items: [{
      key: "chunk-1",
      embedding: [0.1, 0.2, 0.3],
      metadata: { document_id: "doc-1", version_id: "ver-1" }
    }],
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url: String(url),
        method: options.method || "GET",
        headers: Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])),
        body: String(options.body || "")
      });
      return { ok: true, status: 200, headers: new Map([["x-oss-request-id", "vectors-request"]]), text: async () => "" };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://knowmesh-vector-123456789012.cn-hangzhou.oss-vectors.aliyuncs.com/?putVectors");
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.equal(requests[0].headers["x-oss-date"], "20260621T052001Z");
  assert.equal(requests[0].headers["x-oss-content-sha256"], "UNSIGNED-PAYLOAD");
  assert.equal(requests[0].headers.authorization, expectedOssVectorV4Authorization({
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    region: "cn-hangzhou",
    method: "POST",
    canonicalUri: "/acs%3Aossvector%3Acn-hangzhou%3A123456789012%3Aknowmesh-vector/",
    canonicalQuery: "putVectors",
    canonicalHeaders: "content-type:application/json\nx-oss-content-sha256:UNSIGNED-PAYLOAD\nx-oss-date:20260621T052001Z\n",
    signedHeaders: "",
    timestamp
  }));
  assert.equal(requests[0].headers.authorization.includes("AdditionalHeaders=host"), false);
});

test("aliyun OSS Vector queryVectors uses the canonical V4 signature shape", async () => {
  const timestamp = new Date("2026-06-21T05:22:01.000Z");
  const requests = [];
  const result = await queryVectors({
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret"
  }, {
    region: "cn-hangzhou",
    bucket: "knowmesh-vector",
    indexName: "generalv1",
    accountId: "123456789012",
    timestamp,
    vector: [0.1, 0.2, 0.3],
    topK: 3,
    filter: {
      $and: [
        { fgs: { $eq: "primary|g5|math" } },
        { unit: { $eq: "u03" } }
      ]
    },
    returnMetadata: true,
    returnDistance: true,
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url: String(url),
        method: options.method || "GET",
        headers: Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])),
        body: String(options.body || "")
      });
      return {
        ok: true,
        status: 200,
        headers: new Map([["x-oss-request-id", "query-request"]]),
        text: async () => JSON.stringify({
          vectors: [{
            key: "chunk-1",
            distance: 0.12,
            metadata: {
              doc: "doc-1",
              cid: "chunk-1",
              sidecar: "oss://knowmesh-source/knowmesh/kb/kb-k12-all-subjects/versions/build-1/sidecar/chunks/part-0001.jsonl#chunk-1"
            }
          }]
        })
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.vectors[0].key, "chunk-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://knowmesh-vector-123456789012.cn-hangzhou.oss-vectors.aliyuncs.com/?queryVectors");
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.equal(requests[0].headers["x-oss-date"], "20260621T052201Z");
  assert.equal(requests[0].headers.authorization, expectedOssVectorV4Authorization({
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    region: "cn-hangzhou",
    method: "POST",
    canonicalUri: "/acs%3Aossvector%3Acn-hangzhou%3A123456789012%3Aknowmesh-vector/",
    canonicalQuery: "queryVectors",
    canonicalHeaders: "content-type:application/json\nx-oss-content-sha256:UNSIGNED-PAYLOAD\nx-oss-date:20260621T052201Z\n",
    signedHeaders: "",
    timestamp
  }));
  assert.deepEqual(JSON.parse(requests[0].body), {
    indexName: "generalv1",
    queryVector: { float32: [0.1, 0.2, 0.3] },
    topK: 3,
    filter: {
      $and: [
        { fgs: { $eq: "primary|g5|math" } },
        { unit: { $eq: "u03" } }
      ]
    },
    returnMetadata: true,
    returnDistance: true
  });
});

test("aliyun index publishes OSS sidecar metadata and writes compact vector metadata", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-sidecar-contract-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const textbookDir = path.join(sourceRoot, "小学", "数学", "人教版");
  fs.mkdirSync(textbookDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(textbookDir, "义务教育教科书·数学五年级上册.txt"),
    "<h2>第三单元 小数除法</h2> 本单元主要学习小数除法，包括除数是整数的小数除法、一个数除以小数和商的近似数。",
    "utf8"
  );

  const cloudRequests = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    indexBatchSize: 20,
    embeddingBatchGenerator: async ({ items }) => items.map((item, index) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [index + 0.1, index + 0.2, index + 0.3],
      usage: { tokens: item.text.length }
    })),
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      const method = options.method || "GET";
      cloudRequests.push({
        url: target,
        method,
        headers: Object.fromEntries(
          Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
        ),
        body: String(options.body || "")
      });
      if (target.includes("sts.aliyuncs.com")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            IdentityType: "RAMUser",
            AccountId: "123456789012",
            PrincipalId: "mock-principal",
            Arn: "acs:ram::123456789012:user/KnowMesh"
          })
        };
      }
      if (method === "PUT" && target.includes("knowmesh-source.oss-cn-hangzhou.aliyuncs.com/knowmesh/")) {
        return { ok: true, status: 200, headers: new Map([["etag", "\"sidecar-etag\""]]), text: async () => "" };
      }
      if (method === "POST" && target.includes("?putVectorIndex")) {
        return { ok: true, status: 200, headers: new Map([["x-oss-request-id", "index-request"]]), text: async () => "" };
      }
      if (method === "POST" && target.includes("?putVectors")) {
        return { ok: true, status: 200, headers: new Map([["x-oss-request-id", "vectors-request"]]), text: async () => "" };
      }
      throw new Error(`Unexpected cloud request: ${target}`);
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "textbook-cn-k12",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "metadata.stage": ["小学"],
      "metadata.subject": ["数学"],
      "metadata.grade": ["五年级"],
      "metadata.volume": ["上册"],
      "metadata.publisher": "人教版",
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "textbookv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const indexStatus = advanced.job.tasks.find((item) => item.key === "index")?.status;
    if (indexStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "index")?.status, "completed");
  const sidecarUploads = cloudRequests.filter((item) => item.method === "PUT" && item.url.includes("/sidecar/"));
  assert.ok(sidecarUploads.some((item) => /manifest\.json$/.test(item.url)), "sidecar manifest must be uploaded to OSS");
  assert.ok(sidecarUploads.some((item) => /chunks\/part-0001\.jsonl$/.test(item.url)), "sidecar chunks must be uploaded to OSS");

  const vectorRequest = cloudRequests.find((item) => item.url.includes("?putVectors"));
  assert.ok(vectorRequest);
  const vectorBody = JSON.parse(vectorRequest.body);
  const metadata = vectorBody.vectors[0].metadata;
  assert.equal(metadata.kb, migratedK12KnowledgeBaseId);
  assert.match(metadata.ver, /^build-/);
  assert.equal(metadata.doc.startsWith("doc_"), true);
  assert.equal(metadata.cid, vectorBody.vectors[0].key);
  assert.equal(metadata.fgs, "primary|g5|math");
  assert.equal(metadata.pub, "renjiao");
  assert.equal(metadata.vol, "v1");
  assert.equal(metadata.unit, "u03");
  assert.equal(metadata.ctype, "lesson_text");
  assert.match(metadata.sidecar, /^oss:\/\/knowmesh-source\/knowmesh\/kb\/kb-k12-all-subjects\/versions\/build-.*\/sidecar\/chunks\/part-0001\.jsonl#/);
  assert.equal("title" in metadata, false);
  assert.equal("sourceUri" in metadata, false);
  assert.equal("chunk_id" in metadata, false);
  assert.equal("document_id" in metadata, false);

  const report = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "knowledge-write.report.json"), "utf8"));
  assert.equal(report.sidecar.authoritativeStore, "oss-sidecar");
  assert.match(report.sidecar.manifestUri, /^oss:\/\/knowmesh-source\/knowmesh\/kb\/kb-k12-all-subjects\/versions\/build-.*\/sidecar\/manifest\.json$/);
  const sidecarArtifacts = readCatalogRows(state, migratedK12KnowledgeBaseId, `
    SELECT artifact_type, relative_path, content_hash, size_bytes
    FROM artifact_registry
    WHERE owner_type = 'job' AND owner_id = ? AND artifact_type LIKE 'sidecar%'
    ORDER BY artifact_type
  `, [advanced.job.id]);
  assert.deepEqual(sidecarArtifacts.map((item) => item.artifact_type), [
    "sidecarChunks",
    "sidecarCitations",
    "sidecarManifest",
    "sidecarQuality",
    "sidecarTemplateContract"
  ]);
  assert.ok(sidecarArtifacts.every((item) => item.relative_path.startsWith("artifacts/sidecar/")));
  assert.ok(sidecarArtifacts.every((item) => item.content_hash));
  assert.ok(sidecarArtifacts.filter((item) => item.artifact_type !== "sidecarQuality").every((item) => item.size_bytes > 0));
});

test("aliyun OSS Vector index names reject hyphenated values before execution", () => {
  const invalid = validateVectorIndexName("textbook-v1", {
    key: "searchIndex",
    labelZh: "索引名称",
    labelEn: "Index name"
  });
  const valid = validateVectorIndexName("textbookv1");

  assert.equal(invalid.status, "fail");
  assert.equal(invalid.suggestion, "textbookv1");
  assert.match(invalid.message.zh, /只能使用英文字母和数字/);
  assert.equal(valid.status, "pass");
});


test("aliyun index pauses after a batch and resumes without rewriting completed records", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-index-pause-resume-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  const userDataRoot = path.join(temp, "user-data");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(userDataRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson-a.txt"), "第一单元 位置。本课学习用数对确定位置，能在方格纸上描述同学、建筑和图形的位置，并能把生活场景中的方向、距离和坐标表达为可检索的知识点。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-b.txt"), "第三单元 小数除法。本单元学习除数是整数和除数是小数的计算方法，理解商不变规律，掌握循环小数、近似数和解决实际问题的表达方式。", "utf8");

  const writeChunkIds = [];
  let pauseRequested = false;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot,
    enableSystemConverters: false,
    indexBatchSize: 1,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => items.map((item, index) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [index + 0.1, index + 0.2, index + 0.3],
      usage: { tokens: item.text.length }
    })),
    vectorBatchWriter: async ({ items, target }) => {
      writeChunkIds.push(items.map((item) => item.chunk_id));
      if (!pauseRequested) {
        pauseRequested = true;
        const pause = pauseLatestJob(state);
        assert.equal(pause.ok, true);
        assert.equal(pause.job.status, "pausing");
      }
      return items.map((item) => ({
        chunkId: item.chunk_id,
        status: "written",
        remoteId: target.index + ":" + item.chunk_id
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let paused = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    paused = await advanceLatestJob(state);
    if (paused.job.tasks.find((item) => item.key === "index")?.status !== "waiting") break;
  }

  const resultPath = path.join(paused.job.summary.workspaceRoot, "artifacts", "index_records", "index-write.result.jsonl");
  const firstRunResults = fs.readFileSync(resultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(paused.ok, false);
  assert.equal(paused.job.status, "paused");
  assert.equal(paused.job.tasks.find((item) => item.key === "index")?.status, "waiting");
  assert.equal(firstRunResults.length, 1);
  assert.equal(writeChunkIds.length, 1);
  assert.ok(paused.job.events.some((item) => item.type === "checkpoint" && item.taskKey === "index" && item.detail?.completedItems === 1));

  const resumed = resumeLatestJob(state);
  assert.equal(resumed.ok, true);
  const completed = await advanceLatestJob(state);
  const finalResults = fs.readFileSync(resultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  assert.equal(completed.ok, true);
  assert.equal(completed.job.tasks.find((item) => item.key === "index")?.status, "completed");
  assert.equal(finalResults.length, 2);
  assert.equal(new Set(finalResults.map((item) => item.chunk_id)).size, 2);
  assert.equal(writeChunkIds.length, 2);
  assert.ok(completed.job.events.some((item) => /已恢复写入进度：跳过已成功写入 1 条记录/.test(item.message.zh)));
});

test("failed index records are retried instead of being treated as completed", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-index-failed-retry-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 位置。本课学习用数对确定位置，能在方格纸上描述同学、建筑和图形的位置，并能把生活场景中的方向、距离和坐标表达为可检索的知识点。", "utf8");

  const writeAttempts = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    indexBatchSize: 10,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => items.map((item, index) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [index + 0.1, index + 0.2, index + 0.3],
      usage: { tokens: item.text.length }
    })),
    vectorBatchWriter: async ({ items, target }) => {
      writeAttempts.push(items.map((item) => item.chunk_id));
      if (writeAttempts.length === 1) {
        return items.map((item) => ({
          chunkId: item.chunk_id,
          status: "failed",
          providerMessage: "signature mismatch"
        }));
      }
      return items.map((item) => ({
        chunkId: item.chunk_id,
        status: "written",
        remoteId: `${target.index}:${item.chunk_id}`
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let failed = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    failed = await advanceLatestJob(state);
    const indexStatus = failed.job.tasks.find((item) => item.key === "index")?.status;
    if (indexStatus !== "waiting") break;
  }
  const resultPath = path.join(failed.job.summary.workspaceRoot, "artifacts", "index_records", "index-write.result.jsonl");
  const failedRows = fs.readFileSync(resultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(failed.ok, false);
  assert.equal(failed.job.tasks.find((item) => item.key === "index")?.status, "failed");
  assert.ok(failedRows.every((item) => item.status === "failed"));

  const completed = await advanceLatestJob(state);
  const finalRows = fs.readFileSync(resultPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(completed.ok, true);
  assert.equal(completed.job.tasks.find((item) => item.key === "index")?.status, "completed");
  assert.deepEqual(writeAttempts[1], writeAttempts[0]);
  assert.ok(finalRows.every((item) => item.status === "written"));
  assert.equal(finalRows.length, writeAttempts[0].length);
  assert.ok(completed.job.events.some((item) => /已清理上次失败记录/.test(item.message.zh)));
});


test("vector batch writer splits oversized writes and keeps result order", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-index-split-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (let index = 1; index <= 6; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${index}.txt`), `第 ${index} 课 知识点。这里是用于批量写入知识库的正文内容。`, "utf8");
  }

  const batchSizes = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    indexBatchSize: 6,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => items.map((item) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [0.1, 0.2, 0.3],
      usage: { tokens: item.text.length }
    })),
    vectorBatchWriter: async ({ items, target }) => {
      batchSizes.push(items.length);
      if (items.length > 3) {
        const error = new Error("write batch too large");
        error.status = 413;
        throw error;
      }
      return items.map((item) => ({
        chunkId: item.chunk_id,
        status: "written",
        remoteId: `${target.index}:${item.chunk_id}`
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const indexStatus = advanced.job.tasks.find((item) => item.key === "index")?.status;
    if (indexStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "index")?.status, "completed");
  assert.deepEqual(batchSizes, [6, 3, 3]);
  assert.ok(advanced.job.events.some((item) => /写入批次被限流或过大，已拆成 3 \+ 3 条记录/.test(item.message.zh)));
});
test("custom single vector writer is bounded by configured concurrency", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-custom-index-concurrency-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  for (let index = 1; index <= 8; index += 1) {
    fs.writeFileSync(path.join(sourceRoot, `lesson-${index}.txt`), `第 ${index} 课 知识点。这里是用于写入知识库的正文内容。`, "utf8");
  }

  let inflight = 0;
  let maxInflight = 0;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    indexBatchSize: 8,
    indexConcurrency: 2,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async ({ items }) => items.map((item) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [0.1, 0.2, 0.3],
      usage: { tokens: item.text.length }
    })),
    vectorWriter: async ({ item }) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 8));
      inflight -= 1;
      return {
        chunkId: item.chunk_id,
        status: "written",
        remoteId: `local://${item.chunk_id}`
      };
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));
  created.job.mode = "local";

  let advanced = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const indexStatus = advanced.job.tasks.find((item) => item.key === "index")?.status;
    if (indexStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "index")?.status, "completed");
  assert.equal(maxInflight, 2);
});
test("aliyun index writes vectors to OSS Vector with saved credentials", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-vector-api-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "第一单元 位置\n本课学习用数对确定位置, 能在方格纸上描述同学、建筑和图形的位置。第二单元学习小数乘法, 包括小数乘整数、小数乘小数和积的近似数。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "lesson-b.txt"), "第三单元 小数除法。\n第四单元 可能性。", "utf8");

  const cloudRequests = [];
  let putVectorsAttempts = 0;
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    indexBatchSize: 1,
    embeddingBatchGenerator: async ({ items }) => items.map((item, index) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [index + 0.1, index + 0.2, index + 0.3],
      usage: { tokens: item.text.length }
    })),
    indexRetryDelayMs: 0,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      const method = options.method || "GET";
      cloudRequests.push({
        url: target,
        method,
        headers: Object.fromEntries(
          Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
        ),
        body: String(options.body || "")
      });
      if (target.includes("sts.aliyuncs.com")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            IdentityType: "RAMUser",
            AccountId: "123456789012",
            PrincipalId: "mock-principal",
            Arn: "acs:ram::123456789012:user/KnowMesh"
          })
        };
      }
      if (method === "PUT" && target.includes("knowmesh-source.oss-cn-hangzhou.aliyuncs.com/knowmesh/")) {
        return { ok: true, status: 200, headers: new Map([["etag", "\"sidecar-etag\""]]), text: async () => "" };
      }
      if (method === "POST" && target.includes("?putVectorIndex")) {
        return { ok: true, status: 200, headers: new Map([["x-oss-request-id", "index-request"]]), text: async () => "" };
      }
      if (method === "POST" && target.includes("?putVectors")) {
        putVectorsAttempts += 1;
        if (putVectorsAttempts === 1) {
          return {
            ok: false,
            status: 503,
            statusText: "Service Unavailable",
            headers: new Map([["x-oss-request-id", "vectors-retry"]]),
            text: async () => JSON.stringify({ Code: "QpsLimitExceeded", Message: "retry later" })
          };
        }
        return { ok: true, status: 200, headers: new Map([["x-oss-request-id", "vectors-request"]]), text: async () => "" };
      }
      throw new Error(`Unexpected vector API request: ${target}`);
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveAliyunModelQuality(state, {
    "aliyun.services.profile": "recommended",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.organizer": "qwen-plus",
    "aliyun.services.embedding": "text-embedding-v4",
    "aliyun.services.rerank": "qwen3-rerank"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  let advanced = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    advanced = await advanceLatestJob(state);
    const indexStatus = advanced.job.tasks.find((item) => item.key === "index")?.status;
    if (indexStatus !== "waiting") break;
  }

  assert.equal(advanced.ok, true);
  assert.equal(advanced.job.tasks.find((item) => item.key === "index")?.status, "completed");
  const indexRequests = cloudRequests.filter((item) => item.url.includes("?putVectorIndex"));
  const vectorRequests = cloudRequests.filter((item) => item.url.includes("?putVectors"));
  const sidecarRequests = cloudRequests.filter((item) => item.method === "PUT" && item.url.includes("/sidecar/"));
  const vectorsRequest = vectorRequests.at(-1);
  assert.equal(indexRequests.length, 1);
  assert.ok(vectorsRequest);
  assert.ok(vectorRequests.length >= 2);
  assert.ok(sidecarRequests.some((item) => item.url.endsWith("/sidecar/manifest.json")));
  assert.ok(sidecarRequests.some((item) => item.url.endsWith("/sidecar/chunks/part-0001.jsonl")));
  assert.match(vectorsRequest.url, /knowmesh-vector-123456789012\.cn-hangzhou\.oss-vectors\.aliyuncs\.com\/\?putVectors$/);
  assert.equal(vectorsRequest.headers["content-type"], "application/json");
  const vectorBody = JSON.parse(vectorsRequest.body);
  assert.equal(vectorBody.indexName, "generalv1");
  assert.ok(vectorBody.vectors.length >= 1);
  assert.ok(vectorBody.vectors.every((item) => Array.isArray(item.data.float32)));
  assert.ok(vectorBody.vectors.every((item) => item.metadata.doc && item.metadata.ver && item.metadata.cid));
  assert.ok(vectorBody.vectors.every((item) => item.metadata.sidecar && !("document_id" in item.metadata) && !("version_id" in item.metadata)));

  const resultRecords = fs.readFileSync(artifactPath(workspaceRoot, "index_records", "index-write.result.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(resultRecords.every((item) => item.status === "written"));
  assert.ok(resultRecords.every((item) => item.remoteId.startsWith("ossvector://knowmesh-vector/generalv1/")));
});
test("aliyun execution keeps cloud work in the same job instead of creating a second flow", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-aliyun-job-flow-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "lesson.txt"), "教材正文\n第三单元 小数除法。", "utf8");

  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey })
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const draft = {
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot,
    "aliyun.region": "cn-hangzhou",
    "aliyun.storage.bucket": "knowmesh-source",
    "aliyun.search.bucket": "knowmesh-vector",
    "aliyun.search.index": "textbookv1",
    "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
    "aliyun.services.embedding": "text-embedding-v4"
  };

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft
  });

  assert.equal(created.ok, true, JSON.stringify(created.checks));
  assert.equal(created.job.mode, "aliyun");
  assert.equal(created.job.status, "waiting");
  assert.deepEqual(created.job.tasks.map((item) => item.key), [
    "scan",
    "merge",
    "clean",
    "retrieval-policy",
    "upload",
    "ocr",
    "embedding",
    "index",
    "report"
  ]);
  for (const key of ["upload", "ocr", "embedding", "index"]) {
    assert.equal(created.job.tasks.find((item) => item.key === key)?.status, "waiting");
  }
  assert.equal(created.job.progress.total, 9);
  assert.equal(created.job.progress.skipped, 0);

  const advanced = await runLatestJob(state);
  assert.equal(advanced.ok, false);
  assert.equal(advanced.job.id, created.job.id);
  assert.equal(advanced.job.tasks.find((item) => item.key === "merge")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "upload")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "ocr")?.status, "completed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "embedding")?.status, "failed");
  assert.equal(advanced.job.tasks.find((item) => item.key === "report")?.status, "waiting");
  assert.ok(advanced.job.events.some((item) => item.type === "job-action" && /执行剩余步骤/.test(item.message.zh)));
  assert.ok(advanced.job.events.some((item) => item.type === "step-start" && item.taskKey === "merge"));
  assert.match(advanced.job.tasks.find((item) => item.key === "embedding")?.message.zh || "", /生成检索数据/);
});
function writeStoredZip(filePath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(filePath, Buffer.concat([...localParts, centralDirectory, end]));
}
test("knowledge write keeps low-confidence chunks for review instead of activating them", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-quality-lifecycle-"));
  const sourceRoot = path.join(temp, "source");
  const workspaceRoot = path.join(temp, "workspace");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "good.txt"), "第一单元 小数乘法\n本单元学习小数乘整数、小数乘小数、积的近似数和解决实际问题。教材通过例题、练习和单元小结帮助学生理解算理。", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "low.txt"), "1\n页眉\n", "utf8");

  const writtenBatches = [];
  const state = {
    knowledgeBaseId: migratedK12KnowledgeBaseId,
    projectRoot: temp,
    userDataRoot: path.join(temp, "user-data"),
    enableSystemConverters: false,
    sourceArchiveUploader: async (item) => ({ ok: true, status: 200, objectKey: item.objectKey }),
    embeddingBatchGenerator: async (request) => request.items.map((item) => ({
      chunkId: item.chunk_id,
      status: "embedded",
      embedding: [item.text.length, 1, 0]
    })),
    vectorBatchWriter: async (request) => {
      writtenBatches.push(request.items);
      return request.items.map((item) => ({
        chunkId: item.chunk_id,
        status: "written",
        remoteId: `local://${item.chunk_id}`
      }));
    }
  };
  await saveAliyunCredentials(state, {
    accessKeyId: "LTAI_TEST",
    accessKeySecret: "secret",
    saveTarget: "secure-local"
  });
  saveRetrievalStrategy(state, { "retrieval.profile": "balanced" });

  const created = await confirmLocalJob(state, {
    mode: "aliyun",
    template: "general-docs",
    draft: {
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "aliyun.region": "cn-hangzhou",
      "aliyun.storage.bucket": "knowmesh-source",
      "aliyun.search.bucket": "knowmesh-vector",
      "aliyun.search.index": "generalv1",
      "aliyun.services.ocr": "qwen-vl-ocr-2025-11-20",
      "aliyun.services.embedding": "text-embedding-v4"
    }
  });
  assert.equal(created.ok, true, JSON.stringify(created.checks));

  const completed = await runLatestJob(state);
  assert.equal(completed.ok, true);

  const written = writtenBatches.flat();
  assert.equal(written.length, 1);
  assert.ok(written[0].text.includes("小数乘法"));
  assert.equal(written[0].quality.tier, "primary");

  const qualityReport = JSON.parse(fs.readFileSync(artifactPath(workspaceRoot, "reports", "quality-lifecycle.report.json"), "utf8"));
  assert.equal(qualityReport.summary.totalRecords, 2);
  assert.equal(qualityReport.summary.activeRecords, 1);
  assert.equal(qualityReport.summary.reviewRecords, 1);
  assert.equal(qualityReport.knowledgeBase.id, migratedK12KnowledgeBaseId);
  assert.ok(qualityReport.datasetVersionId);

  const reviewQueue = fs.readFileSync(artifactPath(workspaceRoot, "review", "review-queue.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(reviewQueue.length, 1);
  assert.equal(reviewQueue[0].quality.tier, "archive");
  assert.match(reviewQueue[0].quality.reasons.join("\n"), /内容过短/);

  const qualityIssueRows = readCatalogRows(state, completed.job.knowledgeBase.id, `
    SELECT target_type, target_id, severity, status, reason, details_json
    FROM quality_issues
    WHERE details_json LIKE '%"stage":"quality-lifecycle"%'
    ORDER BY issue_id
  `);
  assert.equal(qualityIssueRows.length, 1);
  assert.equal(qualityIssueRows[0].target_type, "chunk");
  assert.equal(qualityIssueRows[0].severity, "archive");
  assert.equal(qualityIssueRows[0].status, "open");
  assert.match(qualityIssueRows[0].reason, /内容过短/);

  const activeManifest = JSON.parse(fs.readFileSync(manifestPath(workspaceRoot, "active-manifest.json"), "utf8"));
  assert.equal(activeManifest.datasetVersionId, qualityReport.datasetVersionId);
  assert.equal(activeManifest.quality.reviewRecords, 1);
});









function writeJsonlForTest(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
}
