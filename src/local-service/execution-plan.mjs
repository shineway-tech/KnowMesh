import { buildSourcePreparationPlan } from "./execution/parser-provider.mjs";

export function buildVisibleExecutionPlan(scan, actions, blockers = []) {
  const handling = sourceHandlingCounts(scan);
  const cloud = scan.mode === "aliyun";
  const blocked = blockers.length > 0;
  const stages = [
    scanStage(scan, blocked),
    textStage(scan, handling, actionStatus(actions, "ocr"), cloud),
    cleanStage(scan, actionStatus(actions, "clean")),
    chunkStage(scan),
    citationStage(scan),
    embeddingStage(scan, actionStatus(actions, "embedding"), cloud),
    indexStage(scan, actionStatus(actions, "index"), cloud),
    validationStage(scan, blocked)
  ];

  return {
    summary: summarizeStages(stages),
    stages
  };
}

function scanStage(scan, blocked) {
  return stage("scan", 1, "资料扫描", "Source scan", blocked ? "blocked" : "completed", blocked ? "blocked" : "passed", [
    round("scan-folder", 1, "读取资料目录", "Read source folder", scan.sourceExists ? "completed" : "blocked", scan.sourceExists ? "passed" : "blocked", scan.sourceExists ? "资料目录可以读取。" : "资料目录不可读取。", scan.sourceExists ? "Source folder is readable." : "Source folder is not readable.", [
      metric("纳入文件", "Files", scan.summary.includedFiles)
    ]),
    round("scan-documents", 2, "识别资料和分卷", "Detect sources and split files", scan.summary.includedFiles > 0 ? "completed" : "blocked", scan.summary.includedFiles > 0 ? "passed" : "blocked", `识别 ${scan.summary.logicalDocuments} 份资料, ${scan.summary.splitPdfGroups} 组分卷。`, `${scan.summary.logicalDocuments} source(s), ${scan.summary.splitPdfGroups} split group(s) detected.`, [
      metric("资料", "Sources", scan.summary.logicalDocuments),
      metric("分卷", "Split groups", scan.summary.splitPdfGroups)
    ]),
    round("scan-template", 3, "检查资料范围", "Check source scope", scan.missingFields.length ? "blocked" : "completed", scan.missingFields.length ? "blocked" : "passed", scan.missingFields.length ? `还有 ${scan.missingFields.length} 个资料范围需要补齐。` : "资料范围已满足。", scan.missingFields.length ? `${scan.missingFields.length} source-scope item(s) still need values.` : "Source scope is ready.", [
      metric("缺失项", "Missing", scan.missingFields.length)
    ])
  ], "先确认资料范围、文件类型和缺失信息。", "Confirm source scope, file types, and missing information first.");
}

function textStage(scan, handling, ocrStatus, cloud) {
  const cloudStatus = cloud ? normalizeActionStatus(ocrStatus) : "skipped";
  const cloudValidation = cloudStatus === "blocked" ? "blocked" : cloudStatus === "skipped" ? "not_needed" : "pending";
  return stage("text", 2, "文字读取与识别", "Text extraction and recognition", cloudStatus === "blocked" ? "blocked" : "waiting", cloudStatus === "blocked" ? "blocked" : "pending", [
    round("text-detect", 1, "判断处理方式", "Decide handling method", "waiting", "pending", "先判断哪些文件能直接读取文字，哪些是扫描版 PDF 或图片页。", "First decide which files already contain readable text and which are scanned PDFs or image pages.", [
      metric("可直接读取", "Readable", handling.directText),
      metric("需转换/结构化", "Convert/structured", handling.autoConvert + handling.office),
      metric("需识别", "Recognition", handling.ocr)
    ]),
    round("text-local", 2, "本地提取文字", "Extract text locally", "waiting", "pending", "能直接读取文字的文件会先在本机处理，不上传资料。", "Files with readable text are processed locally first without uploading sources.", [
      metric("可直接读取", "Readable", handling.directText)
    ]),
    round("text-ocr", 3, "识别扫描页", "Recognize scanned pages", cloudStatus, cloudValidation, cloud ? "扫描版 PDF 和图片页需要 OCR。正式执行前会先显示文件、页数、模型和费用，再由你确认。" : "本地模式暂不做云端 OCR，扫描版 PDF 和图片页会进入待处理清单。", cloud ? "Scanned PDFs and image pages need OCR. Before running, KnowMesh shows files, pages, model, and cost for your confirmation." : "Local mode does not run cloud OCR; scanned PDFs and image pages go to a to-do list.", [
      metric("资料", "Sources", handling.ocr || 0)
    ]),
    round("text-review", 4, "低置信度复核", "Low-confidence review", cloudStatus === "blocked" ? "blocked" : "waiting", cloudStatus === "blocked" ? "blocked" : "needs_review", "OCR 后如果页面不清楚、空白或文字异常，会列入复核清单。", "After OCR, unclear pages, blanks, or unusual text go to a review list.", [
      metric("复核项", "Review items", "执行后统计")
    ])
  ], "先把不同格式资料变成可整理的文字；扫描页会在执行前单独确认。", "Turn mixed sources into text that can be organized; scanned pages are confirmed separately before running.");
}

function cleanStage(scan, cleanStatus) {
  const status = normalizeActionStatus(cleanStatus);
  return stage("clean", 3, "清洗", "Cleaning", status, status === "blocked" ? "blocked" : "pending", [
    round("clean-noise", 1, "过滤页眉页脚和噪声", "Remove headers, footers, and noise", status, validationForStatus(status), "按模板过滤页眉、页脚、水印、网址、广告导航和识别噪声。", "Template rules remove headers, footers, watermarks, URLs, ad/navigation text, and recognition noise.", [
      metric("资料", "Sources", scan.summary.logicalDocuments)
    ]),
    round("clean-metadata", 2, "保留元数据", "Keep metadata", status, validationForStatus(status), "封面、目录、版权、版本和来源路径进入元数据或报告, 不混进正文。", "Cover, table of contents, copyright, version, and source paths go to metadata or reports, not body text.", [
      metric("资料范围", "Source scope", scan.template.metadataFields.length)
    ]),
    round("clean-sample", 3, "抽检清洗结果", "Sample cleaning result", status, status === "skipped" ? "not_needed" : "pending", "检查是否误删正文、是否还残留网址、水印或重复页脚。", "Check for over-removal and remaining URLs, watermarks, or repeated footers.", [
      metric("校验", "Checks", 3)
    ])
  ], "先清掉不该进入检索库的噪声, 再保留可追溯信息。", "Remove noise before search while keeping traceable metadata.");
}

function chunkStage(scan) {
  const status = scan.summary.logicalDocuments > 0 ? "waiting" : "blocked";
  const validation = status === "blocked" ? "blocked" : "pending";
  return stage("chunk", 4, "分片", "Chunking", status, validation, [
    round("chunk-structure", 1, "按章节和标题分片", "Split by headings and sections", status, validation, "优先按标题、章节、列表、页码和段落边界分片。", "Prefer headings, sections, lists, page boundaries, and paragraph boundaries.", [
      metric("资料", "Sources", scan.summary.logicalDocuments)
    ]),
    round("chunk-length", 2, "按语义长度补齐", "Balance semantic length", status, validation, "过长片段继续拆分, 过短片段按上下文合并。", "Long chunks are split again; short chunks are merged with nearby context.", [
      metric("片段", "Chunks", "执行后统计")
    ]),
    round("chunk-quality", 3, "检查重复和异常片段", "Check duplicates and unusual chunks", status, validation, "检查过短、过长、重复、空片段和疑似提示注入内容。", "Check short, long, duplicate, empty, and suspected prompt-injection chunks.", [
      metric("校验", "Checks", 5)
    ])
  ], "把清洗后的长文切成可检索、可引用的小段。", "Turn cleaned text into searchable and citable chunks.");
}

function citationStage(scan) {
  const status = scan.summary.logicalDocuments > 0 ? "waiting" : "blocked";
  const validation = status === "blocked" ? "blocked" : "pending";
  return stage("citation", 5, "引用与元数据", "Citations and metadata", status, validation, [
    round("citation-source", 1, "绑定来源文件", "Bind source files", status, validation, "每个片段记录来源文件、资料标题和相对路径。", "Each chunk keeps source file, source title, and relative path.", [
      metric("资料", "Sources", scan.summary.logicalDocuments)
    ]),
    round("citation-page", 2, "绑定页码或位置", "Bind page or position", status, validation, "PDF 和图片识别后尽量保留页码, 文本和表格保留标题或位置。", "PDF and image recognition keep pages where possible; text and tables keep headings or positions.", [
      metric("PDF", "PDF", scan.manifest.logicalDocuments.filter((document) => document.sourceType.includes("pdf")).length)
    ]),
    round("citation-check", 3, "检查引用可追溯", "Check citation traceability", status, validation, "校验回答引用能回到原始资料、页面或标题。", "Verify that answer citations can trace back to source, page, or heading.", [
      metric("校验", "Checks", 3)
    ])
  ], "保证后续问答不是只给答案, 而是能回到原始资料。", "Ensure answers can trace back to source material.");
}

function embeddingStage(scan, embeddingStatus, cloud) {
  const status = cloud ? normalizeActionStatus(embeddingStatus) : "skipped";
  const validation = status === "blocked" ? "blocked" : status === "skipped" ? "not_needed" : "pending";
  return stage("embedding", 6, "生成检索数据", "Create search data", status, validation, [
    round("embedding-scope", 1, "查看处理数量", "Review item count", status, validation, cloud ? "正式执行前会显示预计处理的知识片段数量。": "本地模式不生成云端检索数据。", cloud ? "Before running, KnowMesh shows how many knowledge chunks will be processed." : "Local mode does not create cloud search data.", [
      metric("片段", "Chunks", "执行后统计")
    ]),
    round("embedding-run", 2, "生成检索数据", "Create search data", status, validation, cloud ? "知识片段会生成用于搜索匹配的数据；正式执行前会显示模型和费用预估。": "未启用云端模型调用。", cloud ? "Knowledge chunks become data used for search matching; model and cost estimate are shown before running." : "Cloud model calls are not enabled.", [
      metric("使用模型", "Model", cloud ? "执行前确认" : "未启用")
    ]),
    round("embedding-check", 3, "抽检处理结果", "Sample result", status, validation, "检查空片段、重复片段和异常长度片段是否被排除。", "Check that empty, duplicate, and unusually sized chunks are excluded.", [
      metric("校验", "Checks", 3)
    ])
  ], "让知识片段可以被相似问题搜索到；本地模式默认跳过。", "Make chunks searchable by similar questions; skipped by default in local mode.");
}

function indexStage(scan, indexStatus, cloud) {
  const status = cloud ? normalizeActionStatus(indexStatus) : "skipped";
  const validation = status === "blocked" ? "blocked" : status === "skipped" ? "not_needed" : "pending";
  return stage("index", 7, "写入知识库", "Write knowledge base", status, validation, [
    round("index-target", 1, "查看写入位置", "Review write target", status, validation, cloud ? "正式执行前会显示要写入的 Bucket 和索引名称。": "本地模式不写入云端知识库。", cloud ? "Before running, KnowMesh shows the bucket and index that will be written." : "Local mode does not write cloud knowledge base.", [
      metric("写入位置", "Target", cloud ? "执行前确认" : "未启用")
    ]),
    round("index-write", 2, "写入知识片段", "Write chunks", status, validation, cloud ? "正式写入前会说明影响范围和出错后的回退方式。": "跳过云端写入。", cloud ? "Before writing, KnowMesh explains the affected scope and rollback path." : "Cloud write is skipped.", [
      metric("片段", "Chunks", "执行后统计")
    ]),
    round("index-verify", 3, "检索抽测", "Search smoke test", status, validation, "写入后用模板问题抽测能否检索到正确来源。", "After writing, template questions smoke-test source retrieval.", [
      metric("问题", "Questions", scan.template.evaluationQuestions.length)
    ])
  ], "把检索数据和知识片段写入指定知识库；执行前会再次确认。", "Write search data and chunks into the selected knowledge base; confirm again before running.");
}

function validationStage(scan, blocked) {
  const status = blocked ? "blocked" : "waiting";
  const validation = blocked ? "blocked" : "pending";
  return stage("validation", 8, "校验与报告", "Validation and report", status, validation, [
    round("validation-rules", 1, "执行模板验收问题", "Run template validation questions", status, validation, "用模板内置问题检查回答、引用和来源片段。", "Use template questions to check answers, citations, and source snippets.", [
      metric("问题", "Questions", scan.template.evaluationQuestions.length)
    ]),
    round("citation-integrity", 2, "检查引用完整性", "Check citation completeness", status, validation, "引用缺失、页码缺失或来源不可追溯时不能标记通过。", "Missing citations, missing pages, or untraceable sources cannot pass.", [
      metric("校验", "Checks", 3)
    ]),
    round("validation-report", 3, "生成执行报告", "Generate run report", status, validation, "报告记录处理范围、跳过项、失败项、校验结果和下一步建议。", "The report records scope, skipped items, failures, validation results, and next suggestions.", [
      metric("报告", "Report", 1)
    ])
  ], "最后确认知识库是否可用, 并给出可读报告。", "Confirm the knowledge base is usable and produce a readable report.");
}

function actionStatus(actions, key) {
  return actions.find((action) => action.key === key)?.status || "skip";
}

function normalizeActionStatus(status) {
  if (status === "done") return "completed";
  if (status === "planned") return "waiting";
  if (status === "skip") return "skipped";
  if (status === "blocked") return "blocked";
  return status || "waiting";
}

function validationForStatus(status) {
  if (status === "completed") return "passed";
  if (status === "skipped") return "not_needed";
  if (status === "blocked") return "blocked";
  return "pending";
}

function stage(key, order, zhLabel, enLabel, status, validationStatus, rounds, zhMessage, enMessage) {
  return {
    key,
    order,
    status,
    validationStatus,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage },
    roundCount: rounds.length,
    rounds
  };
}

function round(key, order, zhLabel, enLabel, status, validationStatus, zhMessage, enMessage, metrics = []) {
  return {
    key,
    order,
    status,
    validationStatus,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage },
    metrics
  };
}

function metric(zhLabel, enLabel, value) {
  return {
    label: { zh: zhLabel, en: enLabel },
    value
  };
}

function sourceHandlingCounts(scan) {
  const preparation = buildSourcePreparationPlan(scan.manifest.logicalDocuments, { mode: scan.mode });
  return {
    directText: preparation.summary.directText,
    office: preparation.summary.office,
    autoConvert: preparation.summary.autoConvert,
    ocr: preparation.summary.ocr
  };
}

function summarizeStages(stages) {
  const rounds = stages.flatMap((item) => item.rounds);
  return {
    totalStages: stages.length,
    totalRounds: rounds.length,
    completedRounds: rounds.filter((item) => item.status === "completed").length,
    waitingRounds: rounds.filter((item) => item.status === "waiting").length,
    blockedRounds: rounds.filter((item) => item.status === "blocked").length,
    skippedRounds: rounds.filter((item) => item.status === "skipped").length,
    passedChecks: rounds.filter((item) => item.validationStatus === "passed").length,
    pendingChecks: rounds.filter((item) => item.validationStatus === "pending" || item.validationStatus === "needs_review").length
  };
}
