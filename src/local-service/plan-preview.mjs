import path from "node:path";

import { findAliyunModel } from "../core/aliyun-model-catalog.mjs";
import { buildPipelinePlan } from "../core/plan.mjs";
import { getRetrievalProfile } from "../core/retrieval-strategy-catalog.mjs";
import { buildVisibleExecutionPlan } from "./execution-plan.mjs";
import { buildTemplateScan, check } from "./scan-preview.mjs";
import { readSetupState } from "./setup-store.mjs";

export async function previewExecutionPlan(state, options = {}) {
  const scan = await buildTemplateScan(state, options);
  const setupState = readSetupState(state);
  const config = buildPlanConfig(scan, setupState);
  const plan = buildPipelinePlan(config, scan.manifest);
  const checks = buildChecks(scan, setupState);
  const blockers = buildBlockers(scan, setupState);
  const actions = buildActions(scan, plan);
  const executionPlan = buildVisibleExecutionPlan(scan, actions, blockers);
  const cloudConfirmation = buildCloudConfirmation(scan, setupState, actions);

  const result = {
    ok: checks.every((item) => item.status !== "fail"),
    mode: scan.mode,
    template: scan.template.id,
    checks,
    planPreview: {
      summary: {
        sourceRoot: scan.summary.sourceRoot,
        workspaceRoot: scan.workspaceRoot,
        includedFiles: scan.summary.includedFiles,
        logicalDocuments: scan.summary.logicalDocuments,
        splitPdfGroups: scan.summary.splitPdfGroups,
        retrievalProfile: setupState.retrievalStrategy?.profileLabel || null,
        localActions: actions.filter((item) => item.kind === "local" && item.status !== "skip").length,
        cloudActions: actions.filter((item) => item.kind === "cloud" && item.status !== "skip").length,
        blockedActions: actions.filter((item) => item.status === "blocked").length,
        blockers: blockers.length
      },
      canConfirmLocalJob: scan.mode === "local" && blockers.length === 0,
      blockers,
      actions,
      cloudConfirmation,
      executionPlan,
      documents: plan.documents.slice(0, 8).map((document) => ({
        title: document.title,
        relativePath: document.relativePath,
        sourceType: document.sourceType,
        steps: summarizeDocumentSteps(document)
      })),
      gates: buildGates(scan)
    }
  };
  Object.defineProperty(result, "sourceManifest", {
    value: scan.manifest,
    enumerable: false
  });
  return result;
}

function buildCloudConfirmation(scan, setupState, actions) {
  if (scan.mode !== "aliyun") return null;
  const draft = scan.draft || {};
  const credentialReady = Boolean(setupState.credential?.configured);
  const storageReady = Boolean(draft["aliyun.storage.bucket"]);
  const searchReady = Boolean(draft["aliyun.search.bucket"] && draft["aliyun.search.index"]);
  const servicesReady = hasSmartServices(draft);
  const retrievalReady = Boolean(setupState.retrievalStrategy?.configured);
  const steps = [
    cloudStep(
      "credential",
      credentialReady ? "pass" : "fail",
      "保存凭证",
      "Save credential",
      credentialReady ? "本机已保存阿里云凭证。" : "先测试并保存阿里云凭证。",
      credentialReady ? "Aliyun credential is saved locally." : "Test and save the Aliyun credential first.",
      "/setup/aliyun/credential",
      false
    ),
    cloudStep(
      "storage",
      storageReady ? "pass" : "fail",
      "资料保存空间",
      "Source storage",
      storageReady ? "已填写保存空间，创建动作仍需单独确认。" : "先填写或选择保存空间。",
      storageReady ? "The storage bucket is filled; creation still requires confirmation." : "Fill or choose the storage bucket first.",
      "/setup/aliyun/storage",
      false
    ),
    cloudStep(
      "search",
      searchReady ? "pass" : "fail",
      "知识检索位置",
      "Knowledge search",
      searchReady ? "已填写知识检索保存空间和索引名称。" : "先填写知识检索保存空间和索引名称。",
      searchReady ? "Search bucket and index are filled." : "Fill the search bucket and index first.",
      "/setup/aliyun/search",
      false
    ),
    cloudStep(
      "services",
      servicesReady ? "pass" : "fail",
      "智能服务",
      "Smart services",
      servicesReady ? "已选择 OCR 和检索数据生成模型。" : "先选择 OCR 和检索数据生成模型。",
      servicesReady ? "OCR and search-data models are selected." : "Choose OCR and search-data models first.",
      "/setup/aliyun/services",
      false
    ),
    cloudStep(
      "answer-strategy",
      retrievalReady ? "pass" : "fail",
      "问答策略",
      "Answer strategy",
      retrievalReady ? "问答效果策略已保存。" : "先保存问答效果策略。",
      retrievalReady ? "Answer strategy is saved." : "Save the answer strategy first.",
      "/setup/retrieval",
      false
    ),
    cloudActionStep(actions, "upload", "cloud-upload", "上传前确认", "Confirm upload"),
    cloudActionStep(actions, "ocr", "cloud-ocr", "OCR 前确认", "Confirm OCR"),
    cloudActionStep(actions, "embedding", "cloud-embedding", "生成检索数据前确认", "Confirm search data"),
    cloudActionStep(actions, "index", "cloud-index", "写入前确认", "Confirm write")
  ];
  const readySteps = steps.filter((item) => item.status === "pass").length;
  const blockedSteps = steps.filter((item) => item.status === "fail" || item.status === "blocked").length;
  const confirmationRequired = steps.filter((item) => item.confirmationRequired).length;
  return {
    executionEnabled: false,
    title: { zh: "正式执行前会确认", en: "Confirmed Before Running" },
    message: {
      zh: "当前只检查准备情况。上传、OCR、生成检索数据和写入知识库，会在真正执行时再让你确认。",
      en: "This only checks readiness. Upload, OCR, search-data creation, and knowledge-base writes are confirmed again when you actually run."
    },
    summary: {
      totalSteps: steps.length,
      readySteps,
      blockedSteps,
      confirmationRequired
    },
    steps
  };
}

function cloudActionStep(actions, actionKey, stepKey, zhLabel, enLabel) {
  const actionItem = actions.find((item) => item.key === actionKey) || {};
  return cloudStep(
    stepKey,
    "confirm_later",
    zhLabel,
    enLabel,
    actionItem.message?.zh || "执行前需要再次确认。",
    actionItem.message?.en || "This must be confirmed again before execution.",
    "",
    true
  );
}

function cloudStep(key, status, zhLabel, enLabel, zhMessage, enMessage, href, confirmationRequired) {
  const actionLabel = confirmationRequired
    ? { zh: "执行时确认", en: "Before Run" }
    : status === "pass"
      ? { zh: "查看", en: "View" }
      : { zh: "去配置", en: "Configure" };
  return {
    key,
    status,
    href,
    confirmationRequired,
    actionLabel,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

export function buildPlanConfig(scan, setupState = {}) {
  const draft = scan.draft;
  const cloud = scan.mode === "aliyun";
  const ocrModel = draft["aliyun.services.ocr"] || "qwen-vl-ocr-2025-11-20";
  const embeddingModel = draft["aliyun.services.embedding"] || "text-embedding-v4";
  const validOcrModel = findAliyunModel("ocr", ocrModel);
  const validEmbeddingModel = findAliyunModel("embedding", embeddingModel);
  const retrievalProfile = getRetrievalProfile(setupState.retrievalStrategy?.profile || draft["retrieval.profile"]);

  return {
    project: {
      id: scan.template.id,
      name: scan.template.title.zh
    },
    workspace: {
      root: scan.workspaceRoot,
      artifactRoot: path.join(scan.workspaceRoot, "artifacts"),
      manifests: path.join(scan.workspaceRoot, "manifests")
    },
    source: {
      type: "filesystem",
      root: scan.sourceRoot
    },
    storage: {
      provider: cloud ? "aliyun-oss" : "",
      region: draft["aliyun.region"] || "",
      bucket: draft["aliyun.storage.bucket"] || ""
    },
    models: {
      ocr: {
        provider: cloud && validOcrModel ? "aliyun" : "",
        model: cloud && validOcrModel ? ocrModel : ""
      },
      embedding: {
        provider: cloud && validEmbeddingModel ? "aliyun" : "",
        model: cloud && validEmbeddingModel ? embeddingModel : ""
      }
    },
    vector: {
      provider: cloud ? "aliyun-vector" : "",
      bucket: draft["aliyun.search.bucket"] || "",
      index: draft["aliyun.search.index"] || ""
    },
    retrieval: {
      profile: retrievalProfile.id,
      label: retrievalProfile.label,
      methods: retrievalProfile.methods,
      config: retrievalProfile.config
    }
  };
}

function buildChecks(scan, setupState) {
  const checks = [
    check(
      "sourceFolder",
      scan.sourceExists ? "pass" : "fail",
      "资料目录",
      "Source folder",
      scan.sourceExists ? "资料目录可以读取。" : sourceFolderMessage(scan.sourceRoot, "zh"),
      scan.sourceExists ? "The source folder is readable." : sourceFolderMessage(scan.sourceRoot, "en")
    ),
    check(
      "includedFiles",
      scan.summary.includedFiles > 0 ? "pass" : "fail",
      "可处理文件",
      "Processable files",
      scan.summary.includedFiles > 0 ? `这次会处理 ${scan.summary.includedFiles} 个文件。` : "没有找到当前模板可处理的文件。",
      scan.summary.includedFiles > 0 ? `${scan.summary.includedFiles} files will be processed.` : "No files match the selected template."
    ),
    check(
      "sourceScope",
      scan.missingFields.length ? "fail" : "pass",
      "资料范围",
      "Source scope",
      scan.missingFields.length ? `还有 ${scan.missingFields.length} 个资料范围需要补齐。` : "资料范围已满足。",
      scan.missingFields.length ? `${scan.missingFields.length} source scope field(s) still need values.` : "Source scope is complete."
    )
  ];

  if (scan.mode === "aliyun") {
    checks.push(checkCloudCredential(setupState));
    checks.push(checkRequiredDraft(scan.draft["aliyun.storage.bucket"], "cloudStorage", "资料保存空间", "Storage space", "/setup/aliyun/storage"));
    checks.push(checkRequiredDraft(scan.draft["aliyun.search.bucket"] && scan.draft["aliyun.search.index"], "cloudSearch", "知识检索位置", "Knowledge search", "/setup/aliyun/search"));
    checks.push(checkRequiredDraft(hasSmartServices(scan.draft), "cloudServices", "智能服务", "Smart services", "/setup/aliyun/services"));
  } else {
    checks.push(check("cloudSkipped", "skip", "云端动作", "Cloud actions", "本地模式不会上传、调用模型或写入云端检索库。", "Local mode will not upload, call models, or write cloud search."));
  }

  checks.push(check("runConfirmations", "pass", "执行保护", "Run confirmations", "上传、OCR、生成检索数据和写入知识库会等到正式执行时再确认。", "Upload, OCR, search-data creation, and knowledge-base writes are confirmed again when the real run starts."));
  checks.push(check(
    "retrievalStrategy",
    setupState.retrievalStrategy?.configured ? "pass" : "fail",
    "问答策略",
    "Answer strategy",
    setupState.retrievalStrategy?.configured ? `已使用${setupState.retrievalStrategy.profileLabel?.zh || "已保存策略"}。` : "还没有保存问答效果策略。",
    setupState.retrievalStrategy?.configured ? `${setupState.retrievalStrategy.profileLabel?.en || "Saved strategy"} is used.` : "The answer strategy is not saved yet."
  ));
  return checks;
}

function buildBlockers(scan, setupState) {
  const blockers = [];
  if (!scan.sourceExists) blockers.push(blocker("sourceFolder", "/setup/project", "资料目录不可读取。", "Source folder is not readable."));
  if (scan.summary.includedFiles === 0) blockers.push(blocker("includedFiles", "/setup/project", "没有可处理文件，请检查资料目录或模板。", "No processable files were found. Check the source folder or template."));
  if (scan.missingFields.length) {
    const names = scan.missingFields.slice(0, 3).map((field) => field.label.zh).join("、");
    const enNames = scan.missingFields.slice(0, 3).map((field) => field.label.en).join(", ");
    blockers.push(blocker("sourceScope", "/setup/project", `补齐资料范围：${names}。`, `Fill source scope: ${enNames}.`));
  }

  if (scan.mode === "aliyun") {
    if (!setupState.credential?.configured) blockers.push(blocker("cloudCredential", "/setup/aliyun/credential", "先测试并保存阿里云凭证。", "Test and save the Aliyun credential first."));
    if (!scan.draft["aliyun.storage.bucket"]) blockers.push(blocker("cloudStorage", "/setup/aliyun/storage", "先确认资料保存空间。", "Confirm the storage space first."));
    if (!scan.draft["aliyun.search.bucket"] || !scan.draft["aliyun.search.index"]) blockers.push(blocker("cloudSearch", "/setup/aliyun/search", "先确认知识检索位置和索引名称。", "Confirm the search location and index name first."));
    if (!hasSmartServices(scan.draft)) blockers.push(blocker("cloudServices", "/setup/aliyun/services", "先配置 OCR 和检索数据模型。", "Configure OCR and search-data models first."));
  }
  if (!setupState.retrievalStrategy?.configured) {
    blockers.push(blocker("retrievalStrategy", "/setup/retrieval", "先保存问答效果策略。", "Save the answer strategy first."));
  }

  return blockers;
}

function buildActions(scan) {
  const preparationCount = scan.manifest.logicalDocuments.filter((document) => !["text", "markdown", "csv", "tsv", "rtf"].includes(document.sourceType)).length;
  const cloud = scan.mode === "aliyun";
  return [
    action("scan", "local", "done", "只读扫描", "Read-only scan", `已识别 ${scan.summary.logicalDocuments} 份资料。`, `${scan.summary.logicalDocuments} source document(s) identified.`),
    action("merge", "local", "planned", "整理执行计划", "Prepare run plan", scan.summary.splitPdfGroups > 0 ? `会保存执行计划，并整理 ${scan.summary.splitPdfGroups} 组分卷 PDF。` : "会保存本次扫描清单、资料计划和待确认版本。", scan.summary.splitPdfGroups > 0 ? `The run plan is saved and ${scan.summary.splitPdfGroups} split-PDF group(s) are prepared.` : "The source scan, document plan, and proposed version are saved."),
    action("pages", "local", preparationCount > 0 ? "planned" : "skip", "资料处理准备", "Source preparation", preparationCount > 0 ? `会为 ${preparationCount} 份资料准备格式转换、表格读取或 OCR。` : "没有需要转换或 OCR 的资料。", preparationCount > 0 ? `${preparationCount} source document(s) need conversion, table extraction, or OCR.` : "No source conversion or OCR is needed."),
    action("clean", "local", scan.summary.logicalDocuments > 0 ? "planned" : "skip", "清洗分段", "Clean and split", "会按模板过滤页眉、页脚、水印、网址和噪声，再生成知识片段。", "Template rules remove headers, footers, watermarks, URLs, and noise before chunking."),
    action("retrieval-policy", "local", scan.summary.logicalDocuments > 0 ? "planned" : "skip", "准备问答策略", "Prepare answer strategy", "会按已保存策略准备问题改写、混合检索、重排和引用校验。", "The saved strategy prepares query rewrite, hybrid search, rerank, and citation checks."),
    action("upload", "cloud", cloud ? "planned" : "skip", "上传资料", "Upload sources", cloud ? "把本次资料上传到已选择的保存空间。" : "本地模式跳过上传。", cloud ? "Upload this run's sources to the selected storage space." : "Local mode skips upload."),
    action("ocr", "cloud", cloud ? "planned" : "skip", "OCR 识别", "OCR", cloud ? "识别扫描版 PDF 或图片页，生成可整理文本。" : "本地模式不调用云端 OCR。", cloud ? "Recognize scanned PDFs or image pages and produce usable text." : "Local mode does not call cloud OCR."),
    action("embedding", "cloud", cloud ? "planned" : "skip", "生成检索数据", "Create search data", cloud ? "把知识片段生成向量等检索数据。" : "本地模式不生成云端检索数据。", cloud ? "Create vector and search data for the knowledge chunks." : "Local mode does not create cloud search data."),
    action("index", "cloud", cloud ? "planned" : "skip", "写入知识库", "Write knowledge base", cloud ? "写入已选择的知识库索引，供问答检索使用。" : "本地模式跳过云端知识库写入。", cloud ? "Write into the selected knowledge-base index for retrieval." : "Local mode skips cloud knowledge-base writes.")
  ];
}

function buildGates(scan) {
  if (scan.mode !== "aliyun") {
    return [
      {
        label: { zh: "本地执行", en: "Local run" },
        message: { zh: "只生成本机工作目录内容，不触发云端费用。", en: "Only local workspace content is produced; no cloud cost is triggered." }
      }
    ];
  }
  return [
    { label: { zh: "上传前确认", en: "Confirm before upload" }, message: { zh: "显示资料数量、保存空间和影响范围。", en: "Shows source count, storage space, and affected scope." } },
    { label: { zh: "OCR 和生成检索数据前确认", en: "Confirm before OCR and search data" }, message: { zh: "显示扫描页数量、使用模型、处理数量和费用预估。", en: "Shows scanned-page count, models, item count, and cost estimate." } },
    { label: { zh: "写入前确认", en: "Confirm before search writes" }, message: { zh: "查看过滤报告后，再确认写入位置和回退方式。", en: "After the filter report, confirm write target and rollback path." } }
  ];
}

function summarizeDocumentSteps(document) {
  return document.pipeline.filter((step) => step.status !== "not_required").map((step) => step.step);
}

function checkCloudCredential(setupState) {
  return check(
    "cloudCredential",
    setupState.credential?.configured ? "pass" : "fail",
    "阿里云凭证",
    "Aliyun credential",
    setupState.credential?.configured ? "本机凭证已保存。" : "还没有测试并保存本机阿里云凭证。",
    setupState.credential?.configured ? "Local credential is saved." : "The local Aliyun credential has not been tested and saved."
  );
}

function checkRequiredDraft(value, key, zhLabel, enLabel) {
  return check(
    key,
    value ? "pass" : "fail",
    zhLabel,
    enLabel,
    value ? "已填写。" : "还需要补齐。",
    value ? "Configured." : "This still needs a value."
  );
}

function hasSmartServices(draft) {
  const ocr = draft["aliyun.services.ocr"];
  const embedding = draft["aliyun.services.embedding"];
  return Boolean(findAliyunModel("ocr", ocr) && findAliyunModel("embedding", embedding));
}

function sourceFolderMessage(sourceRoot, lang) {
  if (!sourceRoot) {
    return lang === "zh" ? "还没有选择资料目录。" : "No source folder has been selected yet.";
  }
  return lang === "zh" ? `没有找到可读取的资料目录：${sourceRoot}。` : `The source folder is not readable: ${sourceRoot}.`;
}

function blocker(key, step, zhMessage, enMessage) {
  return {
    key,
    step,
    label: { zh: "需要处理", en: "Needs attention" },
    message: { zh: zhMessage, en: enMessage }
  };
}

function action(key, kind, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    kind,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

