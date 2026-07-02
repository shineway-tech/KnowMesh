import { isMacroEnabledSourceType, processingGroupForSourceType } from "../../core/source-types.mjs";
import { buildOcrAdapterPreflight } from "./ocr-provider.mjs";

const directTextTypes = new Set(["text", "markdown", "csv", "tsv", "rtf"]);
const officeTypes = new Set(["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"]);
const legacyOfficeTypes = new Set(["doc", "xls", "ppt"]);
const wpsTypes = new Set(["wps", "et", "dps"]);

export function buildSourcePreparationPlan(documents = [], options = {}) {
  const prepared = documents.map((document) => sourcePreparationDecision(document, options));
  return {
    kind: "knowmesh.sourcePreparationPlan",
    apiVersion: "1.0.0",
    mode: String(options.mode || "local"),
    summary: summarizeSourcePreparation(prepared),
    adapters: sourcePreparationAdapters(prepared),
    documents: prepared
  };
}

export function classifyParserInput(document = {}, conversion = null) {
  const category = sourcePreparationCategory(document);
  const macroDisabled = isMacroEnabledSourceType(document.sourceType);
  const reviewReason = sourceReviewReason(document, conversion);
  return {
    sourceType: String(document.sourceType || ""),
    relativePath: String(document.relativePath || ""),
    category,
    macroDisabled,
    conversion: category === "autoConvert" ? compatibilityConversionFor(document.sourceType) : null,
    review: shouldReviewDuringClassification(category, conversion, document)
      ? createParserReview(reviewReason)
      : { status: "", reason: "" }
  };
}

export function sourcePreparationCategory(document = {}) {
  const sourceType = String(document.sourceType || "");
  if (directTextTypes.has(sourceType)) return "directText";
  if (officeTypes.has(sourceType)) return "office";
  if (processingGroupForSourceType(sourceType) === "autoConvert") return "autoConvert";
  if (sourceType === "image" || sourceType.includes("pdf")) return "ocr";
  return "unsupported";
}

export function sourceReviewReason(document = {}, conversion = null) {
  const category = sourcePreparationCategory(document);
  if (category === "directText") return "";
  if (category === "office") return "本机未能读取这个 Office 文件，需要确认文件未损坏或先转换为可读取格式。";
  if (category === "autoConvert") {
    if (conversion?.status === "converter_missing") return "本机没有找到可用的兼容转换器，需要先安装 LibreOffice 或可用转换工具。";
    if (conversion?.status === "conversion_failed") return "兼容转换没有成功，需要查看转换报告后重试或先手动另存为新版 Office 格式。";
    if (conversion?.status === "converted") return "兼容转换已完成，但转换后的文件没有读出正文，需要检查文件内容。";
    return "需要先完成兼容转换，再按转换后的内容生成正文分段。";
  }
  if (category === "ocr") return "需要先完成页面整理或文字识别，再生成正文分段。";
  return "当前文件类型暂未生成正文分段。";
}

function shouldReviewDuringClassification(category, conversion, document = {}) {
  if (category === "unsupported") return true;
  if (category === "autoConvert") return Boolean(conversion && conversion.status !== "converted");
  if (category === "office") return conversion?.status === "read_failed";
  if (category === "ocr") return document.extractionState === "needs_review";
  return false;
}

export function compatibilityConversionFor(sourceType) {
  const normalized = String(sourceType || "");
  return {
    required: true,
    sourceType: normalized,
    outputPreference: legacyOfficeTypes.has(normalized)
      ? modernOfficeTarget(normalized)
      : wpsTypes.has(normalized)
        ? modernWpsTarget(normalized)
        : "readable-document",
    candidateTools: [
      {
        name: "LibreOffice",
        commands: ["soffice", "libreoffice"],
        suitableFor: legacyOfficeTypes.has(normalized) ? [normalized] : []
      },
      {
        name: "WPS Office",
        commands: ["wps", "wpp", "et"],
        suitableFor: wpsTypes.has(normalized) ? [normalized] : []
      }
    ].filter((tool) => tool.suitableFor.length > 0)
  };
}

export function createParserReview(reason, patch = {}) {
  return {
    status: "review",
    reason,
    ...patch
  };
}

function sourcePreparationDecision(document = {}, options = {}) {
  const classification = classifyParserInput(document);
  const base = {
    sourceType: classification.sourceType,
    relativePath: classification.relativePath,
    category: classification.category,
    macroPolicy: macroPolicyFor(document.sourceType),
    persistentTruth: persistentTruth(),
    externalCallsBeforeExecution: 0
  };

  if (classification.category === "ocr") {
    const preflight = buildOcrAdapterPreflight(document, options);
    return {
      ...base,
      adapterId: preflight.adapterId,
      adapterKind: preflight.adapterKind,
      status: preflight.status,
      review: preflight.status === "review" || preflight.status === "blocked"
        ? createParserReview(sourceReviewReason(document), { source: "ocr-preflight" })
        : { status: "", reason: "" },
      dryRun: preflight.dryRun,
      model: preflight.model,
      externalCallsBeforeExecution: preflight.externalCallsBeforeExecution,
      userFixableErrors: preflight.userFixableErrors,
      nextAction: preflight.nextAction
    };
  }

  if (classification.category === "unsupported") {
    return {
      ...base,
      adapterId: "no-provider-fallback",
      adapterKind: "fallback",
      status: "review",
      review: createParserReview(sourceReviewReason(document), { source: "parser-preflight" }),
      dryRun: dryRun({ required: false }),
      userFixableErrors: [
        userFixableError("unsupportedSourceType", "转换为 PDF、Markdown、TXT 或新版 Office 后重试。", "Convert the source to PDF, Markdown, TXT, or modern Office and retry.")
      ],
      nextAction: label("先转换为支持的资料格式。", "Convert to a supported source format first.")
    };
  }

  if (classification.category === "autoConvert") {
    const conversion = options.converterAvailable
      ? { status: "ready" }
      : { status: "converter_missing" };
    return {
      ...base,
      adapterId: "local-parser",
      adapterKind: "parser",
      status: options.converterAvailable ? "ready" : "review",
      conversion: classification.conversion,
      review: options.converterAvailable
        ? { status: "", reason: "" }
        : createParserReview(sourceReviewReason(document, conversion), { source: "parser-preflight" }),
      dryRun: dryRun({ required: false }),
      userFixableErrors: options.converterAvailable
        ? []
        : [
            userFixableError("legacyConverterMissing", "安装 LibreOffice / WPS，或先手动另存为新版 Office 格式。", "Install LibreOffice / WPS, or save the source as a modern Office file first.")
          ],
      nextAction: options.converterAvailable
        ? label("先做本地兼容转换。", "Run local compatibility conversion first.")
        : label("先安装兼容转换器或手动另存。", "Install a compatibility converter or save the file manually.")
    };
  }

  return {
    ...base,
    adapterId: "local-parser",
    adapterKind: "parser",
    status: "ready",
    review: classification.review,
    dryRun: dryRun({ required: false }),
    userFixableErrors: [],
    nextAction: classification.category === "office"
      ? label("在本机读取 Office 内容，宏永不执行。", "Read locally as Office content; macros are never executed.")
      : label("在本机直接读取正文。", "Read the text locally.")
  };
}

function summarizeSourcePreparation(documents) {
  return {
    total: documents.length,
    directText: countCategory(documents, "directText"),
    office: countCategory(documents, "office"),
    autoConvert: countCategory(documents, "autoConvert"),
    ocr: countCategory(documents, "ocr"),
    unsupported: countCategory(documents, "unsupported"),
    reviewRequired: documents.filter((item) => item.review?.status === "review").length,
    blocked: documents.filter((item) => item.status === "blocked").length,
    dryRunRequired: documents.filter((item) => item.status === "dryRunRequired").length,
    plannedExternalCalls: documents.filter((item) => item.dryRun?.plannedExternalCall).length,
    externalCallsBeforeExecution: documents.reduce((sum, item) => sum + Number(item.externalCallsBeforeExecution || 0), 0)
  };
}

function sourcePreparationAdapters(documents) {
  const adapters = new Map();
  adapters.set("local-parser", {
    id: "local-parser",
    kind: "parser",
    status: documents.some((item) => item.adapterId === "local-parser" && item.status === "review") ? "review" : "pass",
    storageBoundary: "core-extraction-writer-api",
    externalCallsBeforeExecution: 0
  });
  for (const document of documents) {
    if (document.adapterId === "local-ocr") {
      adapters.set("local-ocr", {
        id: "local-ocr",
        kind: "ocr",
        status: document.status === "ready" ? "pass" : "review",
        storageBoundary: "core-ocr-writer-api",
        externalCallsBeforeExecution: 0
      });
    }
    if (document.adapterId === "dashscope-ocr") {
      adapters.set("dashscope-ocr", {
        id: "dashscope-ocr",
        kind: "ocr",
        status: document.status,
        storageBoundary: "core-ocr-writer-api",
        externalCallsBeforeExecution: 0
      });
    }
    if (document.adapterId === "no-provider-fallback") {
      adapters.set("no-provider-fallback", {
        id: "no-provider-fallback",
        kind: "fallback",
        status: "review",
        storageBoundary: "none",
        externalCallsBeforeExecution: 0
      });
    }
  }
  return [...adapters.values()];
}

function macroPolicyFor(sourceType) {
  const macroCapable = isMacroEnabledSourceType(sourceType);
  return {
    macroCapable,
    neverExecute: macroCapable,
    reason: macroCapable
      ? "Macro-capable Office files are parsed as documents only; embedded macros are never executed."
      : ""
  };
}

function persistentTruth() {
  return {
    catalog: "catalog-writer-api",
    artifacts: "workspace-artifacts",
    directStorageMutation: false
  };
}

function countCategory(documents, category) {
  return documents.filter((item) => item.category === category).length;
}

function dryRun(values = {}) {
  return {
    required: false,
    plannedExternalCall: false,
    sendsSourceContent: false,
    writesRemoteState: false,
    ...values
  };
}

function userFixableError(key, zh, en) {
  return {
    key,
    message: { zh, en }
  };
}

function label(zh, en) {
  return { zh, en };
}

function modernOfficeTarget(sourceType) {
  if (sourceType === "doc") return "docx";
  if (sourceType === "xls") return "xlsx";
  if (sourceType === "ppt") return "pptx";
  return "docx";
}

function modernWpsTarget(sourceType) {
  if (sourceType === "wps") return "docx";
  if (sourceType === "et") return "xlsx";
  if (sourceType === "dps") return "pptx";
  return "docx";
}
