export function buildTextRecognitionPlan(project, documents, options = {}) {
  const items = documents
    .filter((document) => needsTextRecognition(document.sourceType))
    .map((document) => recognitionItem(document));
  const workOrders = items.map((item) => ({
    work_id: `${item.version_id}_text_recognition_000001`,
    document_id: item.document_id,
    version_id: item.version_id,
    title: item.title,
    relativePath: item.relativePath,
    sourceType: item.sourceType,
    action: "recognize_text",
    status: "waiting_for_confirmation",
    input: {
      sourceUri: item.sourceUri,
      sourceParts: item.sourceParts
    },
    output: {
      path: item.plannedOutput
    },
    confirmation: {
      required: true,
      reason: "文字识别会读取文件内容，真正执行前需要确认范围、模型和费用风险。"
    }
  }));

  return {
    report: {
      kind: "knowmesh.textRecognitionPlan",
      apiVersion: "v1",
      generatedAt: options.generatedAt || new Date().toISOString(),
      project,
      summary: {
        totalDocuments: items.length,
        pdfDocuments: items.filter((item) => item.sourceType.includes("pdf")).length,
        imageDocuments: items.filter((item) => item.sourceType === "image").length,
        modelCallsEnabled: false,
        confirmationRequired: items.length > 0
      },
      items
    },
    workOrders
  };
}

function recognitionItem(document) {
  return {
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    relativePath: document.relativePath,
    sourceType: document.sourceType,
    sourceUri: document.sourceUri,
    sourceParts: document.sourceParts,
    status: "blocked_until_text_recognition_confirmation",
    recognitionType: document.sourceType === "image" ? "image" : "document_pages",
    pageEstimate: document.sourceType === "image" ? 1 : "unknown",
    plannedOutput: document.artifacts.ocr,
    safety: {
      uploadRequired: true,
      modelCallRequired: true,
      enabledInThisTask: false
    }
  };
}

function needsTextRecognition(sourceType) {
  return sourceType === "image" || String(sourceType || "").includes("pdf");
}
