import fs from "node:fs";
import path from "node:path";

import { scanSource, summarizeScan } from "../core/scanner.mjs";
import {
  buildK12SourceScopeGate,
  normalizeScopeKey
} from "../core/document-scope.mjs";
import {
  isMacroEnabledSourceType,
  processingGroupForSourceType,
  supportedSourcePatterns
} from "../core/source-types.mjs";
import { getTemplate } from "../core/templates.mjs";
import { applyDocumentOverridesToManifest } from "./document-inventory.mjs";
import { buildSourcePreparationPlan } from "./execution/parser-provider.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";

const defaultTemplateId = "textbook-cn-k12";

export async function previewScan(state, options = {}) {
  const scan = await buildTemplateScan(state, options);
  const catalog = syncSourceManifestToCatalog(state, scan.manifest, {
    workspaceRoot: scan.workspaceRoot
  });
  const fixes = buildScanFixes(scan);
  const sourcePreparation = buildScanSourcePreparation(scan, state);
  const intakeDiagnostics = buildIntakeDiagnostics(scan, sourcePreparation);
  const sourceWarnings = buildSourceTypeWarnings(scan);
  const warnings = [...scan.manifest.warnings, ...sourceWarnings];
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
      "template",
      "pass",
      "当前模板",
      "Current template",
      `使用 ${scan.template.shortTitle.zh}。`,
      `Using ${scan.template.shortTitle.en}.`
    ),
    check(
      "includedFiles",
      scan.summary.includedFiles > 0 ? "pass" : "warn",
      "纳入文件",
      "Included files",
      scan.summary.includedFiles > 0 ? `已纳入 ${scan.summary.includedFiles} 个文件。` : "没有发现当前模板可处理的文件。",
      scan.summary.includedFiles > 0 ? `${scan.summary.includedFiles} files are included.` : "No files matched the selected template."
    ),
    check(
      "splitPdfGroups",
      scan.summary.splitPdfGroups > 0 ? "pass" : "skip",
      "分卷资料",
      "Split sources",
      scan.summary.splitPdfGroups > 0 ? `发现 ${scan.summary.splitPdfGroups} 组分卷 PDF。` : "没有发现分卷 PDF。",
      scan.summary.splitPdfGroups > 0 ? `${scan.summary.splitPdfGroups} split-PDF group(s) found.` : "No split PDFs were found."
    ),
    check(
      "missingFields",
      scan.missingFields.length ? "warn" : "pass",
      "资料范围",
      "Source scope",
      scan.missingFields.length ? `还有 ${scan.missingFields.length} 个资料范围需要补齐。` : "资料范围已满足。",
      scan.missingFields.length ? `${scan.missingFields.length} source scope field(s) still need values.` : "Source scope is complete."
    ),
    check(
      "readOnly",
      "pass",
      "只读扫描",
      "Read-only scan",
      "本次没有上传、整理、识别或发布知识库。",
      "No upload, organization, recognition, or knowledge-base publication was performed."
    )
  ];

  return {
    ok: checks.every((item) => item.status !== "fail"),
    mode: scan.mode,
    template: scan.template.id,
    catalog,
    checks,
    fixes,
    preview: {
      summary: {
        ...scan.summary,
        fileTypes: summarizeFileTypes(scan.manifest)
      },
      documents: scan.manifest.logicalDocuments.slice(0, 12).map((document) => ({
        title: document.title,
        relativePath: document.relativePath,
        sourceType: document.sourceType,
        mergeRequired: document.merge.required
      })),
      missingFields: scan.missingFields.map((field) => ({
        key: field.key,
        label: field.label
      })),
      processingGroups: summarizeProcessingGroups(scan.manifest),
      warnings: warnings.slice(0, 8).map(localizeWarning),
      issueGroups: buildScanIssueGroups(scan, fixes, sourcePreparation),
      sourcePreparation,
      intakeDiagnostics
    }
  };
}

export async function buildTemplateScan(state, options = {}) {
  const mode = options.mode === "local" ? "local" : "aliyun";
  const draft = options.draft || {};
  const template = getTemplate(options.template || draft.template || defaultTemplateId) || getTemplate(defaultTemplateId);
  const sourceRoot = normalizeUserPath(draft["project.source"]);
  const workspaceRoot = normalizeUserPath(draft["project.workspace"]);
  const sourceExists = isReadableDirectory(sourceRoot);
  const rawManifest = await scanSource(buildScanConfig(template, { sourceRoot, workspaceRoot }), {
    configPath: path.join(state.projectRoot, "knowmesh-web-console.yaml"),
    skipHash: options.hashFiles !== true
  });
  const manifest = applyDocumentOverridesToManifest(state, applyTemplateScopeFilter(rawManifest, template, draft));
  const summary = summarizeScan(manifest);
  if (manifest.scopeFilter) summary.scopeFilter = manifest.scopeFilter;
  const missingFields = missingRequiredFields(template, { draft, sourceRoot, workspaceRoot });

  return {
    mode,
    draft,
    template,
    sourceRoot,
    workspaceRoot,
    sourceExists,
    manifest,
    summary,
    missingFields
  };
}

export function buildScanConfig(template, paths) {
  return {
    project: {
      id: template.id,
      name: template.title.zh
    },
    workspace: {
      root: paths.workspaceRoot,
      artifactRoot: path.join(paths.workspaceRoot, "artifacts"),
      manifests: path.join(paths.workspaceRoot, "manifests")
    },
    source: {
      type: "filesystem",
      root: paths.sourceRoot,
      include: includePatterns(template),
      splitPdf: {
        mergeParts: true
      }
    }
  };
}

export function includePatterns(template) {
  return [...supportedSourcePatterns];
}

export function applyTemplateScopeFilter(manifest, template, draft = {}) {
  const scopeFilter = buildK12SourceScopeGate(template, draft, manifest.logicalDocuments || []);
  if (!scopeFilter.enabled) {
    return {
      ...manifest,
      scopeFilter: publicScopeFilter(scopeFilter)
    };
  }

  const includedDocuments = scopeFilter.included.map((item) => item.document);
  const excludedDocuments = scopeFilter.excluded;
  const includedPaths = new Set(includedDocuments.map((document) => normalizeScopeKey(document.relativePath)));
  const splitPdfGroups = manifest.splitPdfGroups.filter((group) => includedPaths.has(normalizeScopeKey(group.logicalRelativePath)));
  const warnings = manifest.warnings.filter((warning) => {
    if (!warning.logicalRelativePath) return true;
    return includedPaths.has(normalizeScopeKey(warning.logicalRelativePath));
  });
  const includedFiles = includedDocuments.reduce((total, document) => total + Math.max(1, document.sourceParts?.length || 0), 0);
  const excludedFiles = excludedDocuments.reduce((total, item) => total + Math.max(1, item.document.sourceParts?.length || 0), 0);

  return {
    ...manifest,
    files: {
      ...manifest.files,
      included: includedFiles
    },
    splitPdfGroups,
    logicalDocuments: includedDocuments,
    warnings,
    scopeFilter: {
      ...publicScopeFilter(scopeFilter),
      totalDocumentsBeforeScope: manifest.logicalDocuments.length,
      includedDocuments: includedDocuments.length,
      excludedDocuments: excludedDocuments.length,
      excludedFiles,
      excluded: excludedDocuments.map(formatScopeExcludedDocument)
    }
  };
}

function publicScopeFilter(scopeFilter = {}) {
  const { included: _included, excluded: _excluded, ...publicFilter } = scopeFilter;
  return publicFilter;
}

function formatScopeExcludedDocument({ document, decision }) {
  return {
    status: "excluded",
    reason: decision.reason || "outside_current_scope",
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    relativePath: document.relativePath,
    sourceType: document.sourceType,
    source_fingerprint: document.source_fingerprint,
    metadata: decision.metadata,
    sourceParts: Array.isArray(document.sourceParts) ? document.sourceParts.map((part) => ({
      relativePath: part.relativePath || "",
      size: part.size || 0,
      sha256: part.sha256 || ""
    })) : []
  };
}
export function missingRequiredFields(template, context) {
  return template.requiredFields.filter((field) => {
    if (!field.required) return false;
    if (field.key === "source.root") return !context.sourceRoot;
    if (field.key === "workspace.root") return !context.workspaceRoot;
    return draftValueMissing(context.draft[field.key]);
  });
}

function draftValueMissing(value) {
  if (Array.isArray(value)) return value.length === 0;
  return !String(value || "").trim();
}

export function summarizeFileTypes(manifest) {
  const counts = new Map();
  for (const document of manifest.logicalDocuments) {
    counts.set(document.sourceType, (counts.get(document.sourceType) || 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

export function summarizeProcessingGroups(manifest) {
  const groups = new Map();
  for (const document of manifest.logicalDocuments) {
    const key = processingGroupForSourceType(document.sourceType);
    if (!groups.has(key)) groups.set(key, new Map());
    const typeCounts = groups.get(key);
    typeCounts.set(document.sourceType, (typeCounts.get(document.sourceType) || 0) + 1);
  }

  return [
    processingGroup("direct", "可直接处理", "Direct", "会直接提取可读文字、表格或页面结构。", "Readable text, tables, or page structure can be extracted directly.", groups),
    processingGroup("autoConvert", "将自动转换", "Auto Convert", "老 Office 和 WPS 格式会先转换为可处理格式，原文件会保留。", "Legacy Office and WPS sources are converted first while originals are kept.", groups),
    processingGroup("ocr", "需要文字识别", "OCR Needed", "图片和扫描页会进入文字识别流程。", "Images and scanned pages go through OCR.", groups),
    processingGroup("unsupported", "暂不处理", "Not Processed", "这些文件不会进入本次知识库。", "These files will not enter this knowledge base run.", groups)
  ].filter((group) => group.count > 0);
}

function processingGroup(key, zhLabel, enLabel, zhMessage, enMessage, groups) {
  const typeCounts = groups.get(key) || new Map();
  return {
    key,
    count: [...typeCounts.values()].reduce((total, count) => total + count, 0),
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage },
    types: [...typeCounts.entries()].map(([type, count]) => ({ type, count }))
  };
}

function buildSourceTypeWarnings(scan) {
  const warnings = [];
  const macroCount = scan.manifest.logicalDocuments.filter((document) => isMacroEnabledSourceType(document.sourceType)).length;
  if (macroCount > 0) {
    warnings.push({
      code: "macro_office_disabled",
      count: macroCount,
      message: `${macroCount} macro-enabled Office source(s) will be read without executing macros.`
    });
  }
  const supportedFiles = scan.manifest.files.supported ?? scan.summary.includedFiles ?? 0;
  const skipped = Math.max(0, (scan.summary.scannedFiles || 0) - supportedFiles);
  if (skipped > 0) {
    warnings.push({
      code: "unsupported_files_skipped",
      count: skipped,
      message: `${skipped} file(s) do not match the supported source formats.`
    });
  }
  return warnings;
}

function buildScanSourcePreparation(scan, state = {}) {
  const documents = [
    ...(scan.manifest.logicalDocuments || []).map((document) => ({
      relativePath: document.relativePath || "",
      sourceType: document.sourceType || "",
      extractionState: document.extractionState || ""
    })),
    ...(scan.manifest.unsupportedFiles || []).map((file) => ({
      relativePath: file.relativePath || "",
      sourceType: file.sourceType || "file",
      extractionState: "unsupported"
    }))
  ];
  return buildSourcePreparationPlan(documents, {
    mode: scan.mode,
    localOcrConfigured: localOcrConfigured(state),
    converterAvailable: compatibilityConverterAvailable(state)
  });
}

function buildIntakeDiagnostics(scan, sourcePreparation) {
  const reviewQueue = sourcePreparation.documents
    .filter((document) => document.review?.status === "review" || ["blocked", "dryRunRequired"].includes(document.status))
    .map(intakeReviewItem);
  const rejectedFiles = (scan.manifest.unsupportedFiles || []).map((file) => ({
    relativePath: file.relativePath || "",
    sourceType: file.sourceType || "file",
    reason: file.reason || "unsupported_source_type",
    size: Number(file.size || 0)
  }));
  const unsafeSourceClasses = sourcePreparation.documents
    .filter((document) => document.macroPolicy?.macroCapable)
    .map((document) => ({
      relativePath: document.relativePath,
      sourceType: document.sourceType,
      macroPolicy: document.macroPolicy,
      review: document.review || { status: "", reason: "" }
    }));

  return {
    kind: "knowmesh.localDocumentIntakeDiagnostics",
    apiVersion: "1.0.0",
    status: reviewQueue.length || rejectedFiles.length || unsafeSourceClasses.length ? "review" : "pass",
    mode: scan.mode,
    summary: {
      totalSourceFiles: Number(scan.manifest.files?.scanned || 0),
      supportedFiles: Number(scan.manifest.files?.supported || 0),
      rejectedFiles: rejectedFiles.length,
      reviewRequired: reviewQueue.length,
      directText: sourcePreparation.summary.directText,
      office: sourcePreparation.summary.office,
      autoConvert: sourcePreparation.summary.autoConvert,
      ocr: sourcePreparation.summary.ocr,
      unsupported: sourcePreparation.summary.unsupported,
      plannedExternalCalls: sourcePreparation.summary.plannedExternalCalls,
      externalCallsBeforeExecution: sourcePreparation.summary.externalCallsBeforeExecution
    },
    adapterBoundaries: sourcePreparation.adapters.map((adapter) => ({
      id: adapter.id,
      kind: adapter.kind,
      status: adapter.status,
      storageBoundary: adapter.storageBoundary,
      externalCallsBeforeExecution: adapter.externalCallsBeforeExecution
    })),
    reviewQueue,
    rejectedFiles,
    unsafeSourceClasses,
    externalCallsBeforeExecution: sourcePreparation.summary.externalCallsBeforeExecution,
    plannedExternalCalls: sourcePreparation.summary.plannedExternalCalls,
    privacy: {
      redacted: true,
      excludes: ["sourceContent", "documentText", "localAbsolutePaths", "credentials"]
    }
  };
}

function intakeReviewItem(document) {
  return {
    relativePath: document.relativePath,
    sourceType: document.sourceType,
    category: document.category,
    adapterId: document.adapterId,
    status: document.status,
    review: document.review || { status: "", reason: "" },
    userFixableErrors: document.userFixableErrors || [],
    nextAction: document.nextAction || null,
    externalCallsBeforeExecution: Number(document.externalCallsBeforeExecution || 0)
  };
}

function localOcrConfigured(state = {}) {
  return Boolean(state.localOcrRecognizer || state.localOcrCommand || process.env.KNOWMESH_LOCAL_OCR_COMMAND);
}

function compatibilityConverterAvailable(state = {}) {
  if (state.converterAvailable !== undefined) return Boolean(state.converterAvailable);
  if (Array.isArray(state.compatibilityConverters) && state.compatibilityConverters.some((item) => item?.command)) return true;
  if (state.enableSystemConverters === false) return false;
  return commandExistsOnPath(["soffice", "libreoffice"]);
}

function commandExistsOnPath(commands) {
  const pathEntries = String(process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathEntries) {
    for (const command of commands) {
      for (const extension of extensions) {
        const candidate = path.join(dir, `${command}${extension}`);
        if (fs.existsSync(candidate)) return true;
      }
    }
  }
  return false;
}

export function localizeWarning(warning) {
  if (warning.code === "split_pdf_missing_part") {
    return {
      code: warning.code,
      message: {
        zh: `${warning.logicalRelativePath} 缺少分卷文件，请检查文件是否完整。`,
        en: `${warning.logicalRelativePath} is missing one or more split parts.`
      }
    };
  }
  if (warning.code === "split_pdf_and_full_pdf_both_present") {
    return {
      code: warning.code,
      message: {
        zh: `${warning.logicalRelativePath} 同时存在完整 PDF 和分卷文件，需要确认使用哪一份。`,
        en: `${warning.logicalRelativePath} has both a full PDF and split parts; review which source to use.`
      }
    };
  }
  if (warning.code === "macro_office_disabled") {
    return {
      code: warning.code,
      message: {
        zh: `${warning.count || 0} 个含宏 Office 文件会被读取，但不会执行宏。`,
        en: `${warning.count || 0} macro-enabled Office file(s) will be read without executing macros.`
      }
    };
  }
  if (warning.code === "unsupported_files_skipped") {
    return {
      code: warning.code,
      message: {
        zh: `${warning.count || 0} 个文件不属于当前支持的资料格式，本次不会处理。`,
        en: `${warning.count || 0} file(s) do not match the supported source formats and will be skipped.`
      }
    };
  }
  return {
    code: warning.code || "scan_warning",
    message: {
      zh: warning.message || "扫描时发现需要确认的项目。",
      en: warning.message || "The scan found an item that needs review."
    }
  };
}

function buildScanFixes(scan) {
  const fixes = [];
  if (!scan.sourceRoot) {
    fixes.push(fix("sourceFolder", "/setup/project", "选择资料目录。", "Choose a source folder."));
  } else if (!scan.sourceExists) {
    fixes.push(fix("sourceFolder", "/setup/project", "重新选择可读取的资料目录。", "Choose a readable source folder."));
  }

  if (scan.summary.includedFiles === 0 && scan.sourceExists) {
    fixes.push(fix("includedFiles", "/setup/project", "检查资料目录或换一个更合适的模板。", "Check the source folder or choose a better template."));
  }

  const missing = scan.missingFields.filter((field) => !["source.root"].includes(field.key));
  if (missing.length) {
    const zhNames = missing.slice(0, 3).map((field) => field.label.zh).join("、");
    const enNames = missing.slice(0, 3).map((field) => field.label.en).join(", ");
    fixes.push(fix("missingFields", "/setup/project", `补齐资料范围：${zhNames}。`, `Fill source scope: ${enNames}.`));
  }

  return fixes;
}

function buildScanIssueGroups(scan, fixes, sourcePreparation = { documents: [] }) {
  const warnings = [...scan.manifest.warnings, ...buildSourceTypeWarnings(scan)].slice(0, 8).map(localizeWarning);
  const blockerItems = fixes.map((item) => ({
    key: item.key,
    status: "fail",
    label: item.label,
    message: item.message,
    href: item.step,
    action: { zh: "去处理", en: "Fix" }
  }));

  if (!blockerItems.length) {
    blockerItems.push(issueItem(
      "ready",
      "pass",
      "关键条件",
      "Blocking checks",
      "资料目录、工作目录和资料范围已满足。",
      "Source folder, work folder, and source scope are ready."
    ));
  }

  const reviewItems = warnings.map((warning) => issueItem(
    warning.code,
    "warn",
    "需要确认",
    "Review",
    warning.message.zh,
    warning.message.en
  ));
  for (const item of sourcePreparationReviewItems(sourcePreparation).slice(0, 8)) {
    reviewItems.push(item);
  }

  if (scan.summary.splitPdfGroups > 0) {
    reviewItems.push(issueItem(
      "splitPdfGroups",
      "pass",
      "分卷资料",
      "Split sources",
      `发现 ${scan.summary.splitPdfGroups} 组分卷 PDF，后续会按同一本资料合并处理。`,
      `${scan.summary.splitPdfGroups} split-PDF group(s) will be merged as source documents.`
    ));
  }

  if (scan.summary.scopeFilter?.enabled && scan.summary.scopeFilter.excludedDocuments > 0) {
    reviewItems.push(issueItem(
      "scopeFilter",
      "pass",
      "范围外资料",
      "Out of scope",
      `已按你选择的资料范围排除 ${scan.summary.scopeFilter.excludedDocuments} 份资料。`,
      `${scan.summary.scopeFilter.excludedDocuments} source document(s) outside the selected scope were excluded.`
    ));
  }

  if (!reviewItems.length) {
    reviewItems.push(issueItem(
      "noWarnings",
      "pass",
      "资料完整性",
      "Source integrity",
      "暂时没有发现分卷缺失、重复来源或需要人工确认的问题。",
      "No missing split parts, duplicate sources, or manual-review issues were found."
    ));
  }

  const readyItems = [
    issueItem(
      "readOnly",
      "pass",
      "只读扫描",
      "Read-only scan",
      "本次没有上传、整理、识别或写入知识库。",
      "No upload, organization, recognition, or knowledge-base write was performed."
    ),
    issueItem(
      "scope",
      scan.summary.includedFiles > 0 ? "pass" : "warn",
      "资料范围",
      "Source scope",
      scopeReadyMessage(scan.summary, "zh"),
      scopeReadyMessage(scan.summary, "en")
    )
  ];

  return [
    issueGroup(
      "blockers",
      fixes.length ? "fail" : "pass",
      "必须先处理",
      "Must Fix",
      "这些问题不处理，不能进入开始前确认。",
      "These must be resolved before run preview.",
      blockerItems
    ),
    issueGroup(
      "review",
      warnings.length ? "warn" : "pass",
      "建议检查",
      "Review",
      "不会立刻阻塞，但建议在执行前确认。",
      "Not immediately blocking, but review before running.",
      reviewItems
    ),
    issueGroup(
      "ready",
      "pass",
      "可以继续观察",
      "Ready Notes",
      "这些项目说明扫描边界和安全状态。",
      "These notes explain scan scope and safety.",
      readyItems
    )
  ];
}

function sourcePreparationReviewItems(sourcePreparation) {
  return (sourcePreparation.documents || [])
    .filter((document) => document.review?.status === "review" || ["blocked", "dryRunRequired"].includes(document.status))
    .map((document) => issueItem(
      `intake:${document.relativePath}`,
      "warn",
      "摄取诊断",
      "Intake",
      intakeReviewMessage(document, "zh"),
      intakeReviewMessage(document, "en")
    ));
}

function intakeReviewMessage(document, lang) {
  const pathLabel = document.relativePath || document.sourceType || "source";
  if (document.review?.reason) return `${pathLabel}: ${document.review.reason}`;
  if (document.status === "dryRunRequired") {
    return lang === "zh" ? `${pathLabel}: 需要先完成 dry-run。` : `${pathLabel}: dry-run is required before execution.`;
  }
  return lang === "zh" ? `${pathLabel}: 需要人工确认。` : `${pathLabel}: review is required.`;
}

function scopeReadyMessage(summary, lang) {
  const included = summary.includedFiles || 0;
  const scopeFilter = summary.scopeFilter;
  if (scopeFilter?.enabled) {
    if (lang === "zh") return `当前范围会纳入 ${included} 个文件，范围外排除 ${scopeFilter.excludedDocuments || 0} 份资料。`;
    return `${included} file(s) are included; ${scopeFilter.excludedDocuments || 0} document(s) are outside the selected scope.`;
  }
  if (included > 0) {
    if (lang === "zh") return `当前模板会纳入 ${included} 个文件。`;
    return `${included} file(s) are included by the current template.`;
  }
  return lang === "zh" ? "当前模板还没有纳入可处理文件。" : "The current template has not included processable files yet.";
}

function issueGroup(key, status, zhTitle, enTitle, zhDescription, enDescription, items) {
  return {
    key,
    status,
    title: { zh: zhTitle, en: enTitle },
    description: { zh: zhDescription, en: enDescription },
    items
  };
}

function issueItem(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function fix(key, step, zhMessage, enMessage) {
  return {
    key,
    step,
    label: { zh: "需要处理", en: "Needs attention" },
    message: { zh: zhMessage, en: enMessage }
  };
}

export function normalizeUserPath(value) {
  if (!value) return "";
  return path.normalize(String(value).replaceAll("\\", "/"));
}

export function isReadableDirectory(value) {
  try {
    return Boolean(value && fs.existsSync(value) && fs.statSync(value).isDirectory());
  } catch {
    return false;
  }
}

function sourceFolderMessage(sourceRoot, lang) {
  if (!sourceRoot) {
    return lang === "zh" ? "还没有选择资料目录。" : "No source folder has been selected yet.";
  }
  return lang === "zh" ? `没有找到可读取的资料目录：${sourceRoot}。` : `The source folder is not readable: ${sourceRoot}.`;
}

export function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}






