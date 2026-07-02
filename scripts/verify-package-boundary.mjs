#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const privatePathPattern = /(^|\/)(node_modules|workspace|knowledge-bases|\.tmp|\.runtime|secrets|artifacts|logs|tmp|output|exports|test-results|private)(\/|$)/;
const privateFilePattern = /(^|\/)\.env$|\.test\.mjs$|\.sqlite(?:-shm|-wal)?$|\.tgz$|\.log$|\.tmp$/;

export function evaluatePackageFiles(paths) {
  const normalized = paths.map(normalizePackagePath);
  const rejected = normalized.filter((item) => privatePathPattern.test(item) || privateFilePattern.test(item));
  return {
    ok: rejected.length === 0,
    total: normalized.length,
    rejected
  };
}

export function normalizePackagePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function readPackageDryRun(projectRoot = defaultProjectRoot()) {
  const result = process.platform === "win32"
    ? spawnSync("npm.cmd pack --dry-run --json", {
      cwd: projectRoot,
      encoding: "utf8",
      shell: true
    })
    : spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false
    });
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr || result.stdout || "npm pack dry-run failed.");
  }
  const pack = JSON.parse(result.stdout)[0];
  const files = Array.isArray(pack?.files) ? pack.files.map((item) => item.path) : [];
  return {
    name: pack?.name || "",
    version: pack?.version || "",
    size: pack?.size || 0,
    unpackedSize: pack?.unpackedSize || 0,
    files
  };
}

function defaultProjectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pack = readPackageDryRun(defaultProjectRoot());
  const boundary = evaluatePackageFiles(pack.files);
  const result = {
    ok: boundary.ok,
    kind: "knowmesh.packageBoundary",
    package: {
      name: pack.name,
      version: pack.version,
      files: boundary.total,
      size: pack.size,
      unpackedSize: pack.unpackedSize
    },
    rejected: boundary.rejected
  };
  console.log(JSON.stringify(result, null, 2));
  if (!boundary.ok) process.exitCode = 1;
}
