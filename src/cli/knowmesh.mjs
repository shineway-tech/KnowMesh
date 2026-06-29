#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPipelinePlan, writePipelinePlan } from "../core/plan.mjs";
import { loadConfig, redact, resolveEnv, writeJsonFile } from "../core/config.mjs";
import { loadEnv } from "../core/env.mjs";
import { scanSource, summarizeScan } from "../core/scanner.mjs";
import { startLocalService } from "../local-service/server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultConfigPath = path.join(projectRoot, "examples/local-demo/kb.yaml");
const defaultWebPort = 7457;

loadEnv(path.join(projectRoot, ".env"));

const { command, options } = parseArgs(process.argv.slice(2));

try {
  if (command === "help" || options.help) {
    printUsage();
  } else if (command === "start") {
    await start(options);
  } else if (command === "doctor") {
    await doctor(options);
  } else if (command === "config") {
    await printConfig(options);
  } else if (command === "scan") {
    await scan(options);
  } else if (command === "plan") {
    await plan(options);
  } else if (["upload", "ocr", "embed", "index", "delete"].includes(command)) {
    console.error(`Command "${command}" is intentionally disabled.`);
    console.error("Remote calls, uploads, deletes, OCR, embedding, and indexing require Web Console confirmation gates.");
    process.exit(2);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function start(options) {
  const service = await startLocalService({
    projectRoot,
    host: options.host || "127.0.0.1",
    port: options.port ? Number(options.port) : defaultWebPort,
    open: !options["no-open"]
  });

  console.log(`KnowMesh Web Console: ${service.url}`);
  if (service.portChanged) console.log(`Requested port ${service.requestedPort} was busy; using ${service.port}.`);
  console.log("Press Ctrl+C to stop.");

  const stop = async () => {
    await service.close();
    process.exit(0);
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await new Promise(() => {});
}

async function doctor(options) {
  const { config, configPath } = await loadConfig(getConfigPath(options));
  const resolved = resolveEnv(config);
  const requireCloud = Boolean(options.cloud);
  const scan = await scanSource(resolved, { configPath, skipHash: true });
  const checks = [];

  checks.push(checkValue("project.id", resolved?.project?.id));
  checks.push(checkValue("project.name", resolved?.project?.name));
  checks.push(checkDir("source.root", scan.source.root));
  checks.push(checkValue("source.include", Array.isArray(resolved?.source?.include) ? resolved.source.include.join(", ") : ""));
  checks.push(checkValue("source.splitPdf.mergeParts", String(resolved?.source?.splitPdf?.mergeParts)));
  checks.push(checkWritableParent("workspace.root", scan.workspace.root));
  checks.push(checkWritableParent("workspace.artifactRoot", scan.workspace.artifactRoot));
  checks.push(checkValue("models.ocr.provider", resolved?.models?.ocr?.provider));
  checks.push(checkValue("models.embedding.provider", resolved?.models?.embedding?.provider));
  checks.push(checkValue("vector.provider", resolved?.vector?.provider));

  if (requireCloud) {
    checks.push(checkValue("storage.bucket", resolved?.storage?.bucket));
    checks.push(checkValue("storage.region", resolved?.storage?.region));
    checks.push(checkValue("vector.bucket", resolved?.vector?.bucket));
    checks.push(checkValue("vector.index", resolved?.vector?.index));
    checks.push(checkSecret("QWEN_API_KEY", process.env.QWEN_API_KEY));
  } else {
    checks.push(skipCheck("cloud credentials", "not required in local doctor mode"));
  }

  checks.push({
    name: "scan.preview",
    status: scan.files.included > 0 ? "pass" : "fail",
    message: `${scan.files.included} source file(s), ${scan.logicalDocuments.length} logical document(s), ${scan.splitPdfGroups.length} split group(s)`
  });

  printChecks(checks);
  if (scan.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of scan.warnings) console.log(`- ${warning.message}`);
  }

  const failed = checks.filter((item) => item.status === "fail");
  if (failed.length) {
    console.log(`\n${failed.length} check(s) need attention. No remote calls were made.`);
    process.exitCode = 1;
  } else {
    console.log("\nKnowMesh local checks passed. No remote calls were made.");
  }
}

async function printConfig(options) {
  const { config } = await loadConfig(getConfigPath(options));
  console.log(JSON.stringify(redact(resolveEnv(config)), null, 2));
}

async function scan(options) {
  const { config, configPath } = await loadConfig(getConfigPath(options));
  const resolved = resolveEnv(config);
  const manifest = await scanSource(resolved, { configPath });
  printScanSummary(manifest);

  if (options.write) {
    const outputPath = options.out
      ? path.resolve(options.out)
      : path.join(manifest.workspace.manifests, "source-scan.manifest.json");
    writeJsonFile(outputPath, manifest);
    console.log(`\nWrote source scan manifest: ${outputPath}`);
  } else {
    console.log("\nPreview only. Add --write to save the manifest locally.");
  }
}

async function plan(options) {
  const { config, configPath } = await loadConfig(getConfigPath(options));
  const resolved = resolveEnv(config);
  const scanManifest = await scanSource(resolved, { configPath });
  const pipelinePlan = buildPipelinePlan(resolved, scanManifest, { configPath });

  printScanSummary(scanManifest);
  console.log(`\nPipeline plan: ${pipelinePlan.documents.length} document version(s), ${pipelinePlan.gates.length} safety gate(s).`);
  for (const gate of pipelinePlan.gates) {
    console.log(`- ${gate.step}: ${gate.status} (${gate.reason})`);
  }

  if (options.write) {
    const outputs = writePipelinePlan(pipelinePlan);
    console.log("\nWrote local plan artifacts:");
    for (const file of outputs) console.log(`- ${file}`);
  } else {
    console.log("\nPreview only. Add --write to save manifests and reports locally.");
  }
}

function getConfigPath(options) {
  return path.resolve(projectRoot, options.config || defaultConfigPath);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
  const rest = command === "help" ? argv : argv.slice(1);
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (["write", "cloud", "help", "no-open"].includes(key)) {
      options[key] = true;
    } else {
      options[key] = rest[index + 1];
      index += 1;
    }
  }

  return { command, options };
}

function checkValue(name, value) {
  return {
    name,
    status: value && value !== "undefined" ? "pass" : "fail",
    message: value ? String(value) : "(empty)"
  };
}

function checkDir(name, dir) {
  return {
    name,
    status: dir && scanPathExists(dir, "dir") ? "pass" : "fail",
    message: dir || "(empty)"
  };
}

function checkWritableParent(name, dir) {
  return {
    name,
    status: scanPathExists(dir, "dir") || Boolean(findExistingAncestor(path.dirname(dir))) ? "pass" : "fail",
    message: dir
  };
}

function checkSecret(name, value) {
  return {
    name,
    status: value ? "pass" : "fail",
    message: value ? "[configured]" : "(empty)"
  };
}

function skipCheck(name, message) {
  return { name, status: "skip", message };
}

function scanPathExists(file, type) {
  try {
    const stat = path && file ? (awaitStat(file)) : null;
    if (!stat) return false;
    return type === "dir" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

function findExistingAncestor(start) {
  let current = start;
  while (current && current !== path.dirname(current)) {
    if (scanPathExists(current, "dir")) return current;
    current = path.dirname(current);
  }
  return scanPathExists(current, "dir") ? current : "";
}

function awaitStat(file) {
  return globalThis.KNOWMESH_TEST_STAT?.(file) || statSync(file);
}

function statSync(file) {
  return fs.existsSync(file) ? fs.statSync(file) : null;
}

function printChecks(checks) {
  const width = Math.max(...checks.map((item) => item.name.length), 12);
  for (const item of checks) {
    const mark = item.status.toUpperCase().padEnd(4);
    console.log(`${mark} ${item.name.padEnd(width)} ${item.message}`);
  }
}

function printScanSummary(manifest) {
  const summary = summarizeScan(manifest);
  console.log(`Source root: ${summary.sourceRoot}`);
  console.log(`Files: ${summary.includedFiles} included of ${summary.scannedFiles} scanned`);
  console.log(`Logical documents: ${summary.logicalDocuments}`);
  console.log(`Split PDF groups: ${summary.splitPdfGroups}`);
  if (summary.warnings) console.log(`Warnings: ${summary.warnings}`);
}

function printUsage() {
  console.log(`KnowMesh / 知络

Usage:
  knowmesh start  [--host 127.0.0.1] [--port 7457] [--no-open]
  knowmesh doctor [--config path] [--cloud]
  knowmesh config [--config path]
  knowmesh scan   [--config path] [--write] [--out path]
  knowmesh plan   [--config path] [--write]

Local-first examples:
  npm start
  npm run doctor
  npm run demo:plan

Safety:
  Current commands are local-only. Upload, OCR, embedding, indexing, and delete commands are disabled.`);
}
