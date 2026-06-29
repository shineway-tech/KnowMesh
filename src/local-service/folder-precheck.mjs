import fs from "node:fs";
import path from "node:path";

import { matchesAnyGlob, toPosix } from "../core/glob.mjs";
import { parseSplitPdfPart } from "../core/scanner.mjs";
import { detectSourceType } from "../core/source-types.mjs";
import { getTemplate } from "../core/templates.mjs";
import { includePatterns, normalizeUserPath } from "./scan-preview.mjs";

const defaultTemplateId = "textbook-cn-k12";
const maxPreviewFiles = 2000;
const largeFileBytes = 100 * 1024 * 1024;

export function isFolderPrecheckTarget(value) {
  return value === "source" || value === "workspace";
}

export function precheckLocalFolder(state, options = {}) {
  const target = String(options.target || "");
  const targetPath = normalizeUserPath(options.path);
  if (!isFolderPrecheckTarget(target)) {
    return { ok: false, target, error: "Unsupported folder target." };
  }
  if (target === "workspace") return precheckWorkspaceFolder(targetPath);
  return precheckSourceFolder(state, { ...options, path: targetPath });
}

function precheckSourceFolder(state, options) {
  const sourceRoot = options.path;
  const template = getTemplate(options.template || defaultTemplateId) || getTemplate(defaultTemplateId);
  const checks = [];

  if (!sourceRoot) {
    checks.push(check("sourcePath", "fail", "资料目录", "Source folder", "还没有选择资料目录。", "No source folder has been selected yet."));
    return sourceResult(false, sourceRoot, checks);
  }

  if (!fs.existsSync(sourceRoot)) {
    checks.push(check("sourcePath", "fail", "资料目录", "Source folder", `没有找到 ${sourceRoot}。`, `${sourceRoot} was not found.`));
    return sourceResult(false, sourceRoot, checks);
  }

  if (!fs.statSync(sourceRoot).isDirectory()) {
    checks.push(check("sourcePath", "fail", "资料目录", "Source folder", "资料目录必须是一个文件夹。", "The source path must be a folder."));
    return sourceResult(false, sourceRoot, checks);
  }

  const preview = collectSourcePreview(sourceRoot, template);
  checks.push(check("sourcePath", "pass", "资料目录", "Source folder", "资料目录可以读取。", "The source folder is readable."));
  checks.push(check(
    "matchedFiles",
    preview.summary.matchedFiles > 0 ? "pass" : "warn",
    "可处理文件",
    "Processable files",
    preview.summary.matchedFiles > 0 ? `当前模板可处理 ${preview.summary.matchedFiles} 个文件。` : "没有发现当前模板可处理的文件。",
    preview.summary.matchedFiles > 0 ? `${preview.summary.matchedFiles} file(s) match the selected template.` : "No files match the selected template."
  ));
  checks.push(check(
    "largeFiles",
    preview.summary.largeFiles > 0 ? "warn" : "pass",
    "大文件",
    "Large files",
    preview.summary.largeFiles > 0 ? `发现 ${preview.summary.largeFiles} 个超过 100MB 的文件，后续处理可能较慢。` : "没有发现超过 100MB 的大文件。",
    preview.summary.largeFiles > 0 ? `${preview.summary.largeFiles} file(s) are over 100MB, so later processing may be slower.` : "No files over 100MB were found."
  ));
  checks.push(check("readOnly", "pass", "只读预检", "Read-only precheck", "本次只读取文件名、大小和类型。", "Only names, sizes, and types were read."));

  return {
    ok: checks.every((item) => item.status !== "fail"),
    target: "source",
    path: sourceRoot,
    checks,
    preview
  };
}

function precheckWorkspaceFolder(workspacePath) {
  const checks = [];
  if (!workspacePath) {
    checks.push(check("workspacePath", "fail", "工作目录", "Work folder", "还没有选择工作目录。", "No work folder has been selected yet."));
    return workspaceResult(false, workspacePath, checks);
  }

  const ancestor = findExistingAncestor(workspacePath);
  if (!ancestor) {
    checks.push(check("workspaceParent", "fail", "上级目录", "Parent folder", "没有找到可用的上级目录。", "No usable parent folder was found."));
    return workspaceResult(false, workspacePath, checks);
  }

  try {
    const probe = path.join(ancestor, `.knowmesh-precheck-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe, { force: true });
    checks.push(check("workspaceParent", "pass", "上级目录", "Parent folder", "工作目录位置可用。", "The work-folder location is usable."));
    checks.push(check("workspaceWritable", "pass", "写入权限", "Write access", "可以写入中间结果和报告。", "Intermediate data and reports can be written here."));
  } catch {
    checks.push(check("workspaceWritable", "fail", "写入权限", "Write access", "工作目录位置不可写。", "The work-folder location is not writable."));
  }

  return workspaceResult(checks.every((item) => item.status !== "fail"), workspacePath, checks, ancestor);
}

function collectSourcePreview(sourceRoot, template) {
  const include = includePatterns(template);
  const files = walkFilesLimited(sourceRoot, maxPreviewFiles);
  const matchedFiles = [];
  const fileTypes = new Map();
  const splitGroups = new Set();
  let largeFiles = 0;

  for (const file of files.items) {
    const relativePath = toPosix(path.relative(sourceRoot, file.path));
    const matches = matchesAnyGlob(relativePath, include);
    const type = detectSourceType(relativePath);
    fileTypes.set(type, (fileTypes.get(type) || 0) + 1);
    if (matches) {
      matchedFiles.push({
        relativePath,
        type,
        size: file.size
      });
      if (file.size >= largeFileBytes) largeFiles += 1;
      const split = parseSplitPdfPart(relativePath);
      if (split) splitGroups.add(split.logicalRelativePath.toLowerCase());
    }
  }

  return {
    summary: {
      sourceRoot,
      totalFiles: files.items.length,
      matchedFiles: matchedFiles.length,
      splitPdfGroups: splitGroups.size,
      largeFiles,
      truncated: files.truncated
    },
    fileTypes: [...fileTypes.entries()].map(([type, count]) => ({ type, count })),
    sampleFiles: matchedFiles.slice(0, 6)
  };
}

function walkFilesLimited(root, limit) {
  const output = [];
  const stack = [root];
  let truncated = false;

  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = fs.statSync(fullPath);
        } catch {
          continue;
        }
        output.push({ path: fullPath, size: stat.size });
        if (output.length >= limit) {
          truncated = true;
          stack.length = 0;
          break;
        }
      }
    }
  }

  return { items: output, truncated };
}

function findExistingAncestor(start) {
  let current = path.resolve(start || process.cwd());
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current) && fs.statSync(current).isDirectory()) return current;
    current = path.dirname(current);
  }
  return fs.existsSync(current) && fs.statSync(current).isDirectory() ? current : "";
}

function sourceResult(ok, sourceRoot, checks) {
  return {
    ok,
    target: "source",
    path: sourceRoot,
    checks,
    preview: {
      summary: {
        sourceRoot,
        totalFiles: 0,
        matchedFiles: 0,
        splitPdfGroups: 0,
        largeFiles: 0,
        truncated: false
      },
      fileTypes: [],
      sampleFiles: []
    }
  };
}

function workspaceResult(ok, workspacePath, checks, ancestor = "") {
  return {
    ok,
    target: "workspace",
    path: workspacePath,
    checks,
    preview: {
      summary: {
        workspaceRoot: workspacePath,
        parentFolder: ancestor
      }
    }
  };
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}
