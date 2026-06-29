const extensionToSourceType = new Map([
  [".pdf", "pdf"],
  [".doc", "doc"],
  [".docx", "docx"],
  [".docm", "docm"],
  [".xls", "xls"],
  [".xlsx", "xlsx"],
  [".xlsm", "xlsm"],
  [".ppt", "ppt"],
  [".pptx", "pptx"],
  [".pptm", "pptm"],
  [".rtf", "rtf"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".csv", "csv"],
  [".tsv", "tsv"],
  [".png", "image"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".webp", "image"],
  [".bmp", "image"],
  [".tif", "image"],
  [".tiff", "image"],
  [".wps", "wps"],
  [".et", "et"],
  [".dps", "dps"]
]);

const autoConvertTypes = new Set(["doc", "xls", "ppt", "wps", "et", "dps"]);
const ocrTypes = new Set(["image"]);

export const supportedSourcePatterns = [
  "**/*.pdf",
  "**/*.pdf.*",
  ...[...extensionToSourceType.keys()]
    .filter((extension) => extension !== ".pdf")
    .map((extension) => `**/*${extension}`)
];

export function detectSourceType(relativePath) {
  const lower = String(relativePath || "").toLowerCase();
  if (/\.pdf\.\d+$/.test(lower)) return "pdf";
  for (const [extension, type] of extensionToSourceType.entries()) {
    if (lower.endsWith(extension)) return type;
  }
  return "file";
}

export function processingGroupForSourceType(sourceType) {
  if (autoConvertTypes.has(sourceType)) return "autoConvert";
  if (ocrTypes.has(sourceType)) return "ocr";
  if (sourceType === "file") return "unsupported";
  return "direct";
}

export function isMacroEnabledSourceType(sourceType) {
  return sourceType === "docm" || sourceType === "xlsm" || sourceType === "pptm";
}
