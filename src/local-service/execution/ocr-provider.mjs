export function buildOcrAdapterPreflight(document = {}, options = {}) {
  const mode = String(options.mode || "local").trim() || "local";
  const sourceType = String(document.sourceType || "");
  if (!ocrSourceTypeRequiresRecognition(sourceType)) {
    return {
      adapterId: "no-provider-fallback",
      adapterKind: "fallback",
      status: "notRequired",
      model: "",
      externalCallsBeforeExecution: 0,
      dryRun: dryRun({ required: false, plannedExternalCall: false }),
      userFixableErrors: [],
      nextAction: label("不需要 OCR。", "OCR is not required.")
    };
  }

  if (mode === "aliyun") {
    return cloudOcrPreflight(options);
  }

  return localOcrPreflight(options);
}

export function ocrSourceTypeRequiresRecognition(sourceType) {
  const normalized = String(sourceType || "");
  return normalized === "image" || normalized.includes("pdf");
}

export async function runOcrRecognitionStage(context, job, log, implementation) {
  assertStageImplementation(implementation, "OCR provider");
  return implementation(context, job, log);
}

function localOcrPreflight(options = {}) {
  const configured = Boolean(options.localOcrConfigured || options.localOcrCommand || options.localOcrRecognizer);
  return {
    adapterId: "local-ocr",
    adapterKind: "ocr",
    status: configured ? "ready" : "review",
    model: configured ? String(options.localOcrModel || "local-ocr") : "",
    externalCallsBeforeExecution: 0,
    dryRun: dryRun({ required: false, plannedExternalCall: false }),
    userFixableErrors: configured
      ? []
      : [
          userFixableError("localOcrMissing", "安装本地 OCR 引擎，或切换到已配置的云 OCR provider。", "Install a local OCR engine, or switch to a configured cloud OCR provider.")
        ],
    nextAction: configured
      ? label("使用本地 OCR 识别扫描页。", "Run OCR locally for scanned pages.")
      : label("安装本地 OCR，或把扫描件保留为待复核项。", "Install local OCR, or keep scanned sources in the review queue.")
  };
}

function cloudOcrPreflight(options = {}) {
  const configured = Boolean(options.cloudOcrConfigured || (options.modelProviderConfigured && options.modelQualityConfigured));
  const model = String(options.selectedOcrModel || options.ocrModel || "");
  if (!configured) {
    return {
      adapterId: "dashscope-ocr",
      adapterKind: "ocr",
      status: "blocked",
      model,
      externalCallsBeforeExecution: 0,
      dryRun: dryRun({
        required: true,
        plannedExternalCall: false,
        sendsSourceContent: true,
        writesRemoteState: false
      }),
      userFixableErrors: [
        userFixableError("modelCredentialMissing", "先保存并测试模型服务凭证。", "Save and test the model provider credential first."),
        userFixableError("ocrModelMissing", "先选择 OCR 模型方案。", "Choose an OCR model profile first.")
      ],
      nextAction: label("先完成模型服务配置，再做 OCR dry-run。", "Configure the model provider before running the OCR dry-run.")
    };
  }
  return {
    adapterId: "dashscope-ocr",
    adapterKind: "ocr",
    status: "dryRunRequired",
    model,
    externalCallsBeforeExecution: 0,
    dryRun: dryRun({
      required: true,
      plannedExternalCall: true,
      sendsSourceContent: true,
      writesRemoteState: false
    }),
    userFixableErrors: [],
    nextAction: label("先查看 OCR dry-run 的页数、模型和费用，再确认执行。", "Review the OCR dry-run for pages, model, and cost before execution.")
  };
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

function assertStageImplementation(implementation, label) {
  if (typeof implementation !== "function") {
    throw new TypeError(`Missing ${label} execution implementation.`);
  }
}
