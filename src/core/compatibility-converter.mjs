import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const conversionTargets = new Map([
  ["doc", "docx"],
  ["wps", "docx"],
  ["xls", "xlsx"],
  ["et", "xlsx"],
  ["ppt", "pptx"],
  ["dps", "pptx"]
]);

export function conversionTargetForSourceType(sourceType) {
  return conversionTargets.get(sourceType) || "";
}

export async function convertCompatibleSource(document, context = {}) {
  const targetType = conversionTargetForSourceType(document.sourceType);
  const sourcePath = document.sourceParts?.[0]?.path || document.sourcePath;
  if (!targetType || !sourcePath || !fs.existsSync(sourcePath)) {
    return conversionRecord(document, {
      status: "not_convertible",
      message: "当前文件类型不需要兼容转换。"
    });
  }

  const outputDir = path.join(context.plan.workspace.artifactRoot, "converted", document.version_id);
  const converters = listConverters(context).filter((converter) => converterSupports(converter, document.sourceType));
  const attempts = [];
  for (const converter of converters) {
    const args = buildConverterArgs(converter, sourcePath, outputDir, targetType);
    const startedAt = new Date().toISOString();
    const result = await runConverter(converter.command, args, { cwd: path.dirname(sourcePath) });
    attempts.push({
      converter: converter.name,
      command: converter.command,
      status: result.ok ? "completed" : "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      message: result.ok ? "转换命令已完成。" : result.message
    });
    if (!result.ok) continue;

    const outputPath = findConvertedOutput(outputDir, sourcePath, targetType);
    if (outputPath) {
      return conversionRecord(document, {
        status: "converted",
        converter: converter.name,
        outputPath,
        outputType: targetType,
        attempts
      });
    }
  }

  return conversionRecord(document, {
    status: attempts.length ? "conversion_failed" : "converter_missing",
    outputType: targetType,
    attempts,
    message: attempts.length
      ? "兼容转换没有生成可读取文件。"
      : "本机没有找到可用的兼容转换器。"
  });
}

function listConverters(context) {
  const custom = Array.isArray(context.state?.compatibilityConverters) ? context.state.compatibilityConverters : [];
  const system = context.state?.enableSystemConverters === false ? [] : systemConverters();
  return [...custom, ...system].map(normalizeConverter).filter((converter) => converter.command);
}

function normalizeConverter(converter) {
  return {
    name: converter.name || converter.command || "Converter",
    command: converter.command,
    args: Array.isArray(converter.args) ? converter.args : [],
    sourceTypes: Array.isArray(converter.sourceTypes) ? converter.sourceTypes : [],
    buildArgs: converter.buildArgs
  };
}

function systemConverters() {
  const sourceTypes = [...conversionTargets.keys()];
  return [
    { name: "LibreOffice", command: "soffice", sourceTypes },
    { name: "LibreOffice", command: "libreoffice", sourceTypes }
  ];
}

function converterSupports(converter, sourceType) {
  return !converter.sourceTypes.length || converter.sourceTypes.includes(sourceType);
}

function buildConverterArgs(converter, sourcePath, outputDir, targetType) {
  if (typeof converter.buildArgs === "function") return converter.buildArgs({ sourcePath, outputDir, targetType });
  return [
    ...converter.args,
    "--headless",
    "--convert-to",
    targetType,
    "--outdir",
    outputDir,
    sourcePath
  ];
}

function runConverter(command, args, options = {}) {
  return new Promise((resolve) => {
    fs.mkdirSync(args[args.indexOf("--outdir") + 1] || options.cwd || process.cwd(), { recursive: true });
    execFile(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      timeout: 120000
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          message: [error.message, stderr, stdout].filter(Boolean).join("\n").trim()
        });
        return;
      }
      resolve({ ok: true, message: stdout || stderr || "" });
    });
  });
}

function findConvertedOutput(outputDir, sourcePath, targetType) {
  if (!fs.existsSync(outputDir)) return "";
  const expected = path.join(outputDir, `${path.basename(sourcePath, path.extname(sourcePath))}.${targetType}`);
  if (fs.existsSync(expected)) return expected;
  const found = fs.readdirSync(outputDir)
    .map((name) => path.join(outputDir, name))
    .find((file) => file.toLowerCase().endsWith(`.${targetType.toLowerCase()}`));
  return found || "";
}

function conversionRecord(document, options = {}) {
  return {
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    relativePath: document.relativePath,
    sourceType: document.sourceType,
    status: options.status,
    converter: options.converter || "",
    outputType: options.outputType || conversionTargetForSourceType(document.sourceType),
    outputPath: options.outputPath || "",
    message: options.message || "",
    attempts: options.attempts || []
  };
}
