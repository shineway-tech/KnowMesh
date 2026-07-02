import fs from "node:fs";

const ocrCommands = ["paddleocr", "paddleocr.exe", "tesseract"];

export function localOcrProviderDescriptor(options = {}) {
  const configured = Boolean(options.localOcrConfigured);
  return {
    id: "local-ocr",
    type: "local-ocr",
    configured,
    status: configured ? "pass" : "setupRequired",
    label: {
      zh: "本地 OCR / 版面识别",
      en: "Local OCR / Layout"
    },
    message: configured
      ? {
          zh: "本地 OCR 适配器已配置，扫描件可在本机识别。",
          en: "A local OCR adapter is configured, so scanned sources can be recognized locally."
        }
      : {
          zh: "本地 OCR 适配器尚未配置；扫描 PDF 和图片会进入待确认识别队列。",
          en: "No local OCR adapter is configured; scanned PDFs and images enter the recognition work queue."
        },
    capabilities: [
      capability("localOcr", "本地 OCR", "Local OCR", ["image", "pdf-page"]),
      capability("localLayout", "本地版面识别", "Local layout recognition", ["table", "formula", "layout"])
    ],
    setupRequirements: [
      requirement("localOcrEngine", "安装 PaddleOCR / PP-Structure 或兼容 OCR 命令", "Install PaddleOCR / PP-Structure or a compatible OCR command", false),
      requirement("explicitEnable", "显式配置后才会调用本地 OCR", "Local OCR is called only after explicit configuration", true)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: false, storesSource: false, storesVectors: false }),
    cost: cost(["local_cpu", "local_disk", "optional_gpu"]),
    batch: batch({ supported: true, mode: "page-queue", fallback: "review-required" }),
    retry: retry({ transientOnly: false, checkpointed: true }),
    permissions: [],
    userFixableErrors: [
      fix("localOcrMissing", "安装 OCR 引擎，或改用阿里百炼 OCR provider。", "Install an OCR engine, or use the Aliyun Model Studio OCR provider."),
      fix("ocrInputMissing", "先完成 PDF 拆页或图片归档，再重试 OCR。", "Render PDF pages or archive images before retrying OCR.")
    ]
  };
}

export function inspectLocalOcrAdapterDependencies(state = {}, context = {}) {
  const env = context.env || process.env;
  const platform = context.platform || process.platform;
  const explicitCommand = state.localOcrCommand || env.KNOWMESH_LOCAL_OCR_COMMAND || "";
  const resolvedCommand = explicitCommand || findCommandOnPath(ocrCommands, { env, platform });
  const recognizerConfigured = typeof state.localOcrRecognizer === "function";
  const status = recognizerConfigured || resolvedCommand ? "pass" : "warn";
  return {
    status,
    command: resolvedCommand,
    adapters: [
      {
        key: "paddleOcr",
        label: "PaddleOCR / PP-Structure",
        status: resolvedCommand || recognizerConfigured ? "pass" : "missing",
        command: resolvedCommand,
        message: resolvedCommand || recognizerConfigured
          ? "Local OCR command or injected recognizer is available."
          : "Local OCR command was not found; KnowMesh will not call external OCR silently."
      }
    ],
    message: status === "pass"
      ? label("本地 OCR 适配器可用。", "Local OCR adapter is available.")
      : label("未找到本地 OCR；扫描件会进入待确认队列，不会静默调用外部工具。", "Local OCR was not found; scanned sources enter a review queue and no external tool is called silently.")
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
      zh: "执行前按页数、图片数量和 OCR 范围展示风险。",
      en: "Risk is shown before execution based on pages, images, and OCR scope."
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
  const separator = platform === "win32" ? /[;:]/ : /:/;
  const paths = pathValue.split(separator).filter(Boolean);
  const extensions = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of paths) {
    for (const command of commands) {
      for (const ext of extensions) {
        const candidate = `${dir.replace(/[\\/]$/, "")}/${command}${ext}`;
        const normalized = platform === "win32" ? candidate.replace(/\//g, "\\") : candidate;
        if (fs.existsSync(normalized)) return normalized;
      }
    }
  }
  return "";
}
