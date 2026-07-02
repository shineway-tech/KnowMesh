import fs from "node:fs";

const directTextTypes = ["text", "markdown", "csv", "tsv", "rtf"];
const modernOfficeTypes = ["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"];
const legacyOfficeTypes = ["doc", "xls", "ppt", "wps", "et", "dps"];

export function localParserProviderDescriptor() {
  return {
    id: "local-parser",
    type: "local-parser",
    configured: true,
    status: "pass",
    label: {
      zh: "本地解析器",
      en: "Local Parser"
    },
    message: {
      zh: "文本、Markdown、CSV/TSV、RTF 和新版 Office 可在本机解析；旧 Office/WPS 需要转换器。",
      en: "Text, Markdown, CSV/TSV, RTF, and modern Office files can be parsed locally; legacy Office/WPS needs a converter."
    },
    capabilities: [
      capability("localParsing", "本地正文解析", "Local text parsing", directTextTypes.concat(modernOfficeTypes)),
      capability("compatibilityConversion", "旧格式兼容转换", "Legacy format conversion", legacyOfficeTypes)
    ],
    setupRequirements: [
      requirement("nodeRuntime", "Node 24+ 本地运行时", "Node.js 24+ local runtime", true),
      requirement("legacyConverter", "旧 Office/WPS 文件需要 LibreOffice 或 WPS 转换器", "LibreOffice or WPS converter is needed for legacy Office/WPS files", false)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    cost: cost(["local_cpu", "local_disk"]),
    batch: batch({ supported: true, mode: "file-queue", fallback: "review-required" }),
    retry: retry({ transientOnly: false, checkpointed: true }),
    permissions: [],
    userFixableErrors: [
      fix("legacyConverterMissing", "安装 LibreOffice / WPS，或先手动另存为新版 Office 格式。", "Install LibreOffice / WPS, or save files as modern Office formats first."),
      fix("fileUnreadable", "确认文件未损坏，或导出为 PDF/Markdown/TXT 后重试。", "Confirm the file is not corrupted, or export it as PDF/Markdown/TXT and retry.")
    ]
  };
}

export function localParserAdapterPilotContract() {
  return {
    id: "local-parser",
    providerId: "local-parser",
    adapter: "parser",
    interfaceVersion: "1.0.0",
    status: "pass",
    lifecycle: {
      stage: "certified",
      since: "0.1.0-alpha",
      graduation: "Graduates to official when browser smoke, parser fixtures, diagnostics, and package boundary evidence are all release-gated."
    },
    requiredMethods: [
      "scanSources",
      "readTextLikeSource",
      "readModernOfficeSource",
      "checkpointExtractionResult"
    ],
    permissions: [],
    externalCallsBeforeExecution: 0,
    catalogWriteBoundary: "catalog-writer-api",
    diagnostics: {
      redacted: true,
      exposes: ["sourceTypes", "converterAvailability", "userFixableErrors"]
    },
    userFixableErrors: [
      "legacyConverterMissing",
      "fileUnreadable"
    ],
    docs: [
      "docs/providers.zh-CN.md",
      "docs/providers.en.md"
    ],
    tests: [
      "src/local-service/provider-capabilities.test.mjs",
      "src/local-service/execution/parser-provider.test.mjs"
    ]
  };
}

export function inspectLocalParserAdapterDependencies(state = {}, context = {}) {
  const env = context.env || process.env;
  const platform = context.platform || process.platform;
  const customConverters = Array.isArray(state.compatibilityConverters)
    ? state.compatibilityConverters.filter((item) => item?.command)
    : [];
  const systemEnabled = state.enableSystemConverters !== false;
  const converterCommand = customConverters[0]?.command || (systemEnabled ? findCommandOnPath(["soffice", "libreoffice"], { env, platform }) : "");
  const legacyStatus = converterCommand ? "pass" : "missing";
  const adapters = [
    adapter("directText", "Direct text reader", "pass", directTextTypes, "Built-in parser for text-like sources."),
    adapter("modernOffice", "Modern Office reader", "pass", modernOfficeTypes, "Built-in OpenXML text reader; macros are never executed."),
    adapter("legacyOffice", "Legacy Office/WPS converter", legacyStatus, legacyOfficeTypes, converterCommand || "LibreOffice/WPS converter not found.")
  ];
  return {
    status: adapters.some((item) => item.status === "pass") ? "pass" : "warn",
    adapters,
    message: legacyStatus === "pass"
      ? label("本地解析器和兼容转换器可用。", "Local parser and compatibility converter are available.")
      : label("本地解析器可用；旧 Office/WPS 转换器未找到。", "Local parser is available; legacy Office/WPS converter was not found.")
  };
}

function adapter(key, labelText, status, sourceTypes, message) {
  return {
    key,
    label: labelText,
    status,
    sourceTypes,
    message
  };
}

function capability(key, zh, en, operations) {
  return { key, label: { zh, en }, operations };
}

function requirement(key, zh, en, required) {
  return { key, required, label: { zh, en } };
}

function fix(key, zh, en) {
  return { key, message: { zh, en } };
}

function privacy(values) {
  return { redacted: true, ...values };
}

function cost(units) {
  return {
    units,
    estimateTiming: {
      zh: "执行前按文件数量和大小展示风险。",
      en: "Risk is shown before execution based on file count and size."
    }
  };
}

function batch(values) {
  return values;
}

function retry(values) {
  return {
    networkOnly: false,
    ...values
  };
}

function label(zh, en) {
  return { zh, en };
}

function findCommandOnPath(commands, { env, platform }) {
  const pathValue = env.PATH || env.Path || "";
  const separators = platform === "win32" ? [";", ":"] : [":"];
  const paths = pathValue.split(new RegExp(`[${separators.map(escapeRegExp).join("")}]`)).filter(Boolean);
  const extensions = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of paths) {
    for (const command of commands) {
      for (const ext of extensions) {
        const candidate = `${dir.replace(/[\\/]$/, "")}/${command}${ext}`;
        try {
          if (platform === "win32" || process.platform === "win32") {
            const normalized = candidate.replace(/\//g, "\\");
            if (existsFile(normalized)) return normalized;
          } else if (existsFile(candidate)) {
            return candidate;
          }
        } catch {}
      }
    }
  }
  return "";
}

function existsFile(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
