import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveConfigPath } from "./config.mjs";
import { matchesAnyGlob, toPosix } from "./glob.mjs";
import { sha256File, sha256Json, stableId } from "./hash.mjs";
import { detectSourceType } from "./source-types.mjs";

export async function scanSource(config, options = {}) {
  const now = options.now || new Date().toISOString();
  const configPath = options.configPath || process.cwd();
  const sourceRoot = resolveConfigPath(config?.source?.root, configPath);
  const workspace = buildWorkspace(config, configPath);
  const include = config?.source?.include?.length ? config.source.include : ["**/*"];
  const warnings = [];
  const files = fs.existsSync(sourceRoot) ? walkFiles(sourceRoot) : [];
  const fileEntries = files.map((file) => buildFileEntry(file, sourceRoot, { skipHash: options.skipHash }));
  const entries = fileEntries.filter((entry) => matchesAnyGlob(entry.relativePath, include));
  const unsupportedFiles = fileEntries
    .filter((entry) => !matchesAnyGlob(entry.relativePath, include))
    .map((entry) => ({
      relativePath: entry.relativePath,
      size: entry.size,
      mtime: entry.mtime,
      sourceType: detectSourceType(entry.relativePath),
      reason: "unsupported_source_type"
    }));

  const splitPdfEnabled = config?.source?.splitPdf?.mergeParts !== false;
  const splitGroups = new Map();
  const standalone = [];

  for (const entry of entries) {
    const split = splitPdfEnabled ? parseSplitPdfPart(entry.relativePath) : null;
    if (split) {
      const key = split.logicalRelativePath.toLowerCase();
      if (!splitGroups.has(key)) {
        splitGroups.set(key, {
          logicalRelativePath: split.logicalRelativePath,
          parts: []
        });
      }
      splitGroups.get(key).parts.push({ ...entry, partNumber: split.partNumber });
    } else {
      standalone.push(entry);
    }
  }

  const logicalDocuments = [];

  for (const group of [...splitGroups.values()].sort((a, b) => a.logicalRelativePath.localeCompare(b.logicalRelativePath))) {
    group.parts.sort((a, b) => a.partNumber - b.partNumber);
    const expected = Array.from({ length: group.parts.at(-1).partNumber }, (_, index) => index + 1);
    const actual = new Set(group.parts.map((part) => part.partNumber));
    const missingParts = expected.filter((partNumber) => !actual.has(partNumber));
    if (missingParts.length) {
      warnings.push({
        code: "split_pdf_missing_part",
        logicalRelativePath: group.logicalRelativePath,
        message: `Split PDF ${group.logicalRelativePath} is missing part(s): ${missingParts.join(", ")}`
      });
    }

    logicalDocuments.push(buildLogicalDocument({
      config,
      sourceRoot,
      workspace,
      relativePath: group.logicalRelativePath,
      sourceType: "split-pdf",
      fingerprint: sourceFingerprint(group.parts),
      sourceParts: group.parts.map((part) => toSourcePart(part)),
      mergeRequired: true
    }));
  }

  for (const entry of standalone.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const splitTwin = splitGroups.has(entry.relativePath.toLowerCase());
    if (splitTwin) {
      warnings.push({
        code: "split_pdf_and_full_pdf_both_present",
        logicalRelativePath: entry.relativePath,
        message: `Both ${entry.relativePath} and split parts are present; keeping both as separate scan inputs for review.`
      });
    }

    logicalDocuments.push(buildLogicalDocument({
      config,
      sourceRoot,
      workspace,
      relativePath: entry.relativePath,
      sourceType: detectSourceType(entry.relativePath),
      fingerprint: entry.sha256 || stableId("fingerprint", entry.relativePath, String(entry.size)),
      sourceParts: [toSourcePart(entry)],
      mergeRequired: false
    }));
  }

  return {
    kind: "knowmesh.sourceScanManifest",
    apiVersion: "v1",
    generatedAt: now,
    project: {
      id: config?.project?.id || "unknown",
      name: config?.project?.name || ""
    },
    source: {
      type: config?.source?.type || "filesystem",
      root: sourceRoot,
      include
    },
    workspace,
    files: {
      scanned: files.length,
      supported: entries.length,
      unsupported: unsupportedFiles.length,
      included: entries.length
    },
    splitPdfGroups: [...splitGroups.values()].map((group) => ({
      logicalRelativePath: group.logicalRelativePath,
      partCount: group.parts.length,
      sourceParts: group.parts.sort((a, b) => a.partNumber - b.partNumber).map((part) => toSourcePart(part))
    })),
    logicalDocuments,
    unsupportedFiles,
    warnings
  };
}

export function summarizeScan(manifest) {
  return {
    sourceRoot: manifest.source.root,
    scannedFiles: manifest.files.scanned,
    includedFiles: manifest.files.included,
    logicalDocuments: manifest.logicalDocuments.length,
    splitPdfGroups: manifest.splitPdfGroups.length,
    warnings: manifest.warnings.length
  };
}

export function parseSplitPdfPart(relativePath) {
  const normalized = toPosix(relativePath);
  const match = normalized.match(/^(.*\.pdf)\.(\d+)$/i);
  if (!match) return null;
  return {
    logicalRelativePath: match[1],
    partNumber: Number(match[2])
  };
}

function buildWorkspace(config, configPath) {
  const root = resolveConfigPath(config?.workspace?.root || "./workspace", configPath);
  const artifactRoot = resolveConfigPath(config?.workspace?.artifactRoot || `${root}/artifacts`, configPath);
  const manifests = resolveConfigPath(config?.workspace?.manifests || `${root}/manifests`, configPath);
  return { root, artifactRoot, manifests };
}

function walkFiles(root) {
  const output = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile()) output.push(fullPath);
    }
  }

  return output;
}

function buildFileEntry(file, sourceRoot, options = {}) {
  const stat = fs.statSync(file);
  return {
    path: file,
    uri: pathToFileURL(file).href,
    relativePath: toPosix(path.relative(sourceRoot, file)),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    sha256: options.skipHash ? "" : sha256File(file)
  };
}

function buildLogicalDocument({ config, sourceRoot, workspace, relativePath, sourceType, fingerprint, sourceParts, mergeRequired }) {
  const projectId = config?.project?.id || "unknown";
  const title = inferTitle(relativePath);
  const documentId = stableId("doc", projectId, relativePath.toLowerCase());
  const versionId = stableId("ver", documentId, fingerprint);
  const sourcePath = path.join(sourceRoot, relativePath);
  const mergedPath = path.join(workspace.artifactRoot, "raw", relativePath);

  return {
    document_id: documentId,
    version_id: versionId,
    title,
    sourceType,
    sourceUri: pathToFileURL(sourcePath).href,
    sourcePath,
    relativePath,
    source_fingerprint: fingerprint,
    sourceParts,
    merge: {
      required: mergeRequired,
      outputPath: mergeRequired ? mergedPath : sourcePath,
      status: mergeRequired ? "planned" : "not_required"
    },
    active: false,
    lifecycle: "planned"
  };
}

function sourceFingerprint(parts) {
  return sha256Json(parts.map((part) => ({
    partNumber: part.partNumber,
    relativePath: part.relativePath,
    size: part.size,
    sha256: part.sha256
  })));
}

function toSourcePart(entry) {
  const result = {
    path: entry.path,
    uri: entry.uri,
    relativePath: entry.relativePath,
    size: entry.size,
    sha256: entry.sha256
  };
  if (entry.partNumber) result.partNumber = entry.partNumber;
  return result;
}

function inferTitle(relativePath) {
  return path.basename(relativePath).replace(/\.pdf$/i, "").replace(/\.[^.]+$/i, "");
}
