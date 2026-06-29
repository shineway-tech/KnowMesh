#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privatePathPattern = /(^|\/)(node_modules|workspace|knowledge-bases|\.github|\.tmp|\.runtime|secrets|artifacts|logs|tmp|output|test-results)(\/|$)/;
const privateFilePattern = /(^|\/)\.env$|\.test\.mjs$|\.sqlite(?:-shm|-wal)?$|\.tgz$|\.log$|\.tmp$/;

export function findForbiddenInstalledPaths(packageRoot) {
  const found = [];
  const stack = [packageRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = normalizePackagePath(path.relative(packageRoot, absolute));
      if (privatePathPattern.test(relative) || privateFilePattern.test(relative)) {
        found.push(relative);
        continue;
      }
      if (entry.isDirectory()) stack.push(absolute);
    }
  }
  return found.sort();
}

export function buildReleaseArtifactChecks({ packageInfo, binPath, forbiddenPaths, cliResult }) {
  return [
    check("packageName", packageInfo.name === "knowmesh", packageInfo.name || "(missing)"),
    check("packageVersion", Boolean(packageInfo.version), packageInfo.version || "(missing)"),
    check("nodeEngine", packageInfo.engines?.node === ">=24", packageInfo.engines?.node || "(missing)"),
    check("binMetadata", packageInfo.bin?.knowmesh === "./src/cli/knowmesh.mjs", packageInfo.bin?.knowmesh || "(missing)"),
    check("binLinked", fs.existsSync(binPath), normalizePackagePath(binPath)),
    check(
      "cliHelp",
      cliResult.status === 0 && /KnowMesh/.test(cliResult.stdout) && /knowmesh start/.test(cliResult.stdout),
      cliResult.status === 0 ? "help output ok" : trimForMessage(cliResult.stderr || cliResult.stdout)
    ),
    check(
      "noPrivateState",
      forbiddenPaths.length === 0,
      forbiddenPaths.length ? forbiddenPaths.slice(0, 10).join(", ") : "no private paths"
    )
  ];
}

export function runReleaseArtifactVerification(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const tempRoot = options.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-release-artifact-"));
  const ownsTempRoot = !options.tempRoot;
  try {
    const pack = packProject(projectRoot, tempRoot);
    const consumerRoot = path.join(tempRoot, "consumer");
    fs.mkdirSync(consumerRoot, { recursive: true });
    fs.writeFileSync(path.join(consumerRoot, "package.json"), JSON.stringify({ private: true }, null, 2), "utf8");

    const install = runNpm(["install", "--omit=dev", "--no-audit", "--no-fund", pack.tarball], consumerRoot);
    if (install.status !== 0) {
      return resultFromChecks(pack, [
        check("consumerInstall", false, trimForMessage(install.stderr || install.stdout))
      ]);
    }

    const packageRoot = path.join(consumerRoot, "node_modules", "knowmesh");
    const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    const binPath = path.join(consumerRoot, "node_modules", ".bin", process.platform === "win32" ? "knowmesh.cmd" : "knowmesh");
    const cliEntry = path.join(packageRoot, packageInfo.bin?.knowmesh || "./src/cli/knowmesh.mjs");
    const cliResult = runNodeCli(cliEntry, ["help"], consumerRoot);
    const checks = [
      check("consumerInstall", true, "npm install from tarball completed"),
      ...buildReleaseArtifactChecks({
        packageInfo,
        binPath,
        forbiddenPaths: findForbiddenInstalledPaths(packageRoot),
        cliResult
      })
    ];
    return resultFromChecks(pack, checks);
  } finally {
    if (ownsTempRoot && !options.keepTemp) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function packProject(projectRoot, tempRoot) {
  const pack = runNpm(["pack", "--pack-destination", tempRoot, "--json"], projectRoot);
  if (pack.status !== 0) throw new Error(trimForMessage(pack.error?.message || pack.stderr || pack.stdout || "npm pack failed."));
  const metadata = JSON.parse(pack.stdout)[0];
  const tarball = path.join(tempRoot, metadata.filename);
  return {
    filename: metadata.filename,
    tarball,
    size: metadata.size || fs.statSync(tarball).size,
    unpackedSize: metadata.unpackedSize || 0,
    files: metadata.entryCount || (Array.isArray(metadata.files) ? metadata.files.length : 0),
    sha256: sha256File(tarball)
  };
}

function resultFromChecks(pack, checks) {
  return {
    ok: checks.every((item) => item.status === "pass"),
    kind: "knowmesh.releaseArtifact",
    package: {
      filename: pack.filename,
      size: pack.size,
      unpackedSize: pack.unpackedSize,
      files: pack.files,
      sha256: pack.sha256
    },
    checks
  };
}

function runNpm(args, cwd) {
  const env = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_fund: "false"
  };
  const npmCli = resolveNpmCli();
  if (npmCli) {
    return spawnSync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: "utf8",
      shell: false,
      env
    });
  }
  return spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env
  });
}

function runNodeCli(entryPath, args, cwd) {
  return spawnSync(process.execPath, [entryPath, ...args], {
    cwd,
    encoding: "utf8",
    shell: false
  });
}

function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js") : ""
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function check(key, passed, message) {
  return {
    key,
    status: passed ? "pass" : "fail",
    message
  };
}

function trimForMessage(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function normalizePackagePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runReleaseArtifactVerification();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
