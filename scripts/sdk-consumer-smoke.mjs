#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privatePathPattern = /(^|\/)(node_modules|workspace|knowledge-bases|\.github|\.tmp|\.runtime|secrets|artifacts|logs|tmp|output|test-results|private)(\/|$)|(^|\/)fixtures\/private(\/|$)/;
const privateFilePattern = /(^|\/)\.env$|\.test\.mjs$|\.sqlite(?:-shm|-wal)?$|\.tgz$|\.log$|\.tmp$/;
const sdkInternalDependencyPattern = /from\s+["'][^"']*local-service|better-sqlite3|node:fs|node:path|workspace\.sqlite|catalog\.sqlite|src\/local-service/i;

export const sdkConsumerTemplate = String.raw`
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  KnowMeshApiError,
  buildKnowMeshEndpoint,
  createKnowMeshClient,
  knowMeshIntegrationContract,
  knowMeshIntegrationEndpoints
} from "knowmesh";
import { createKnowMeshClient as createKnowMeshClientFromSubpath } from "knowmesh/sdk";

const rootUrl = import.meta.resolve("knowmesh");
const subpathUrl = import.meta.resolve("knowmesh/sdk");
const sdkPath = fileURLToPath(rootUrl);
const packageRoot = path.resolve(path.dirname(sdkPath), "..", "..");
const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const sdkSource = fs.readFileSync(sdkPath, "utf8");

assert.equal(rootUrl, subpathUrl);
assert.equal(packageInfo.name, "knowmesh");
assert.equal(packageInfo.exports["."], "./src/sdk/knowmesh-client.mjs");
assert.equal(packageInfo.exports["./sdk"], "./src/sdk/knowmesh-client.mjs");
assert.equal(createKnowMeshClientFromSubpath, createKnowMeshClient);
assert.equal(knowMeshIntegrationContract.answerPolicy, "citation_ready_evidence_only");
assert.equal(knowMeshIntegrationContract.queryEvidenceField, "query.evidencePack");
assert.deepEqual(Object.values(knowMeshIntegrationEndpoints), [
  "/api/integration/manifest",
  "/kb/{knowledgeBaseId}/api/integration/manifest",
  "/api/integration/diagnostics",
  "/kb/{knowledgeBaseId}/api/integration/diagnostics",
  "/kb/{knowledgeBaseId}/api/query",
  "/kb/{knowledgeBaseId}/api/search",
  "/kb/{knowledgeBaseId}/api/query/feedback",
  "/kb/{knowledgeBaseId}/api/query/feedback/summary",
  "/kb/{knowledgeBaseId}/api/providers/diagnostics",
  "/kb/{knowledgeBaseId}/api/package/export/preview",
  "/kb/{knowledgeBaseId}/api/package/import/preview",
  "/kb/{knowledgeBaseId}/api/maintenance/status",
  "/kb/{knowledgeBaseId}/api/version/manifest"
]);
assert.equal(buildKnowMeshEndpoint("query", { knowledgeBaseId: "sample docs" }), "/kb/sample%20docs/api/query");
assert.doesNotMatch(sdkSource, /from\s+["'][^"']*local-service|better-sqlite3|node:fs|node:path|workspace\.sqlite|catalog\.sqlite|src\/local-service/i);

const calls = [];
const client = createKnowMeshClient({
  baseUrl: "http://127.0.0.1:7457/",
  knowledgeBaseId: "sample docs",
  requestId: () => "req-consumer-smoke",
  requestTimeoutMs: 5000,
  fetchImpl: async (url, init = {}) => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({
      pathname: parsed.pathname,
      search: parsed.search,
      method: init.method || "GET",
      headers: init.headers || {},
      body
    });
    return route(parsed, init, body);
  }
});

await client.serviceIntegrationManifest();
await client.integrationManifest();
await client.serviceIntegrationDiagnostics();
await client.integrationDiagnostics();
const answer = await client.query("What review cadence is required?", { filters: { qualityState: "primary" } });
await client.search({ query: "rollback plan", qualityStates: ["primary"], limit: 3 });
await client.feedback({ queryId: "query-1", rating: "useful", note: "Evidence matched the source." });
await client.feedbackSummary();
await client.packageExportPreview();
await client.packageImportPreview({ packageVersion: "2026-07-query-runtime.1" });
await client.maintenanceStatus();
await client.versionManifest();
await assert.rejects(
  () => client.providerDiagnostics(),
  (error) => {
    assert.equal(error instanceof KnowMeshApiError, true);
    assert.equal(error.code, "provider_unavailable");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /AccessKey|C:\\Users|secret\.txt/i);
    assert.doesNotMatch(JSON.stringify(error.details), /AccessKey|C:\\Users|secret\.txt/i);
    return true;
  }
);

const queryCall = calls.find((item) => item.pathname.endsWith("/api/query"));
const searchCall = calls.find((item) => item.pathname.endsWith("/api/search"));
assert.equal(answer.status, "answered");
assert.equal(queryCall.method, "POST");
assert.equal(queryCall.headers.accept, "application/json");
assert.equal(queryCall.headers["content-type"], "application/json");
assert.equal(queryCall.headers["x-knowmesh-request-id"], "req-consumer-smoke");
assert.equal(queryCall.body.question, "What review cadence is required?");
assert.equal(searchCall.search, "?query=rollback+plan&qualityStates=primary&limit=3");
assert.equal(calls.length, 13);

console.log(JSON.stringify({
  ok: true,
  packageName: packageInfo.name,
  packageVersion: packageInfo.version,
  rootAndSubpathResolveSameFile: rootUrl === subpathUrl,
  endpointCount: Object.keys(knowMeshIntegrationEndpoints).length,
  coveredMethods: Array.from(new Set(calls.map((item) => item.method))).sort(),
  coveredPaths: calls.map((item) => item.pathname)
}, null, 2));

function route(parsed, init, body) {
  const pathname = parsed.pathname;
  if (pathname === "/api/integration/manifest" || pathname.endsWith("/api/integration/manifest")) {
    return jsonResponse({
      ok: true,
      kind: "knowmesh.integrationManifest",
      contractVersion: knowMeshIntegrationContract.contractVersion,
      endpoints: knowMeshIntegrationEndpoints
    });
  }
  if (pathname === "/api/integration/diagnostics" || pathname.endsWith("/api/integration/diagnostics")) {
    return jsonResponse({
      ok: true,
      kind: "knowmesh.integrationDiagnostics",
      retrySemantics: { retryable: ["timeout", "network_error", "http_429"] },
      cors: { defaultRemoteAccess: false }
    });
  }
  if (pathname.endsWith("/api/query")) {
    assert.equal(init.method, "POST");
    assert.equal(body.question, "What review cadence is required?");
    return jsonResponse({
      ok: true,
      status: "answered",
      contractVersion: knowMeshIntegrationContract.contractVersion,
      query: { id: "query-1", evidencePack: [{ documentId: "doc-1", citation: "demo.md#L1" }] }
    });
  }
  if (pathname.endsWith("/api/search")) return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, items: [] });
  if (pathname.endsWith("/api/query/feedback")) {
    assert.equal(init.method, "POST");
    assert.equal(body.rating, "useful");
    return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, feedback: { id: "feedback-1" } });
  }
  if (pathname.endsWith("/api/query/feedback/summary")) return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, feedback: { total: 1 } });
  if (pathname.endsWith("/api/package/export/preview")) return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, package: { mode: "preview" } });
  if (pathname.endsWith("/api/package/import/preview")) {
    assert.equal(init.method, "POST");
    assert.equal(body.manifest.packageVersion, "2026-07-query-runtime.1");
    return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, importPlan: { mode: "preview" } });
  }
  if (pathname.endsWith("/api/maintenance/status")) return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, state: "ready" });
  if (pathname.endsWith("/api/version/manifest")) return jsonResponse({ ok: true, contractVersion: knowMeshIntegrationContract.contractVersion, versions: [] });
  if (pathname.endsWith("/api/providers/diagnostics")) {
    return jsonResponse({
      ok: false,
      error: {
        code: "provider_unavailable",
        message: "AccessKeySecret failed at C:\\Users\\demo\\secret.txt"
      }
    }, { status: 503, headers: { "x-knowmesh-request-id": "req-server" } });
  }
  return jsonResponse({ ok: false, error: { code: "not_found", message: pathname } }, { status: 404 });
}

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status || 200,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
}
`;

export function findForbiddenInstalledConsumerPaths(packageRoot) {
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

export function buildSdkConsumerChecks({ packageInfo, forbiddenPaths, consumerRun, consumerResult, sdkSource }) {
  const consumerOk = consumerRun.status === 0 && consumerResult?.ok === true;
  return [
    check("packageName", packageInfo.name === "knowmesh", packageInfo.name || "(missing)"),
    check("packageExportsRoot", packageInfo.exports?.["."] === "./src/sdk/knowmesh-client.mjs", packageInfo.exports?.["."] || "(missing)"),
    check("packageExportsSubpath", packageInfo.exports?.["./sdk"] === "./src/sdk/knowmesh-client.mjs", packageInfo.exports?.["./sdk"] || "(missing)"),
    check("consumerImports", consumerOk && consumerResult.rootAndSubpathResolveSameFile === true, consumerOk ? "root and subpath imports resolved" : trimForMessage(consumerRun.stderr || consumerRun.stdout)),
    check("consumerEndpointCoverage", consumerOk && consumerResult.endpointCount === 13, consumerOk ? `${consumerResult.endpointCount} endpoints covered` : "consumer did not complete"),
    check("consumerInjectedFetch", consumerOk && consumerResult.coveredMethods?.includes("GET") && consumerResult.coveredMethods?.includes("POST"), consumerOk ? `methods: ${consumerResult.coveredMethods.join(", ")}` : "consumer did not complete"),
    check("noSdkInternalImports", !sdkInternalDependencyPattern.test(sdkSource), "SDK has no local-service, SQLite, or fs/path dependency"),
    check(
      "noPrivatePackageFiles",
      forbiddenPaths.length === 0,
      forbiddenPaths.length ? forbiddenPaths.slice(0, 10).join(", ") : "installed package has no private runtime state"
    )
  ];
}

export function runSdkConsumerSmoke(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const tempRoot = options.tempRoot || fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-sdk-consumer-"));
  const ownsTempRoot = !options.tempRoot;
  try {
    const pack = packProject(projectRoot, tempRoot);
    const consumerRoot = path.join(tempRoot, "consumer");
    fs.mkdirSync(consumerRoot, { recursive: true });
    fs.writeFileSync(path.join(consumerRoot, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2), "utf8");

    const install = runNpm(["install", "--omit=dev", "--no-audit", "--no-fund", pack.tarball], consumerRoot);
    if (install.status !== 0) {
      return resultFromChecks(pack, [
        check("consumerInstall", false, trimForMessage(install.stderr || install.stdout))
      ]);
    }

    const consumerScript = path.join(consumerRoot, "consumer-smoke.mjs");
    fs.writeFileSync(consumerScript, sdkConsumerTemplate, "utf8");
    const consumerRun = spawnSync(process.execPath, [consumerScript], {
      cwd: consumerRoot,
      encoding: "utf8",
      shell: false
    });
    const consumerResult = parseConsumerOutput(consumerRun.stdout);
    const packageRoot = path.join(consumerRoot, "node_modules", "knowmesh");
    const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    const sdkSource = fs.readFileSync(path.join(packageRoot, "src", "sdk", "knowmesh-client.mjs"), "utf8");
    const checks = [
      check("consumerInstall", true, "npm install from tarball completed"),
      ...buildSdkConsumerChecks({
        packageInfo,
        forbiddenPaths: findForbiddenInstalledConsumerPaths(packageRoot),
        consumerRun,
        consumerResult,
        sdkSource
      })
    ];
    return {
      ...resultFromChecks(pack, checks),
      consumer: consumerResult && consumerResult.ok ? {
        packageName: consumerResult.packageName,
        packageVersion: consumerResult.packageVersion,
        endpointCount: consumerResult.endpointCount,
        coveredMethods: consumerResult.coveredMethods,
        coveredPaths: consumerResult.coveredPaths
      } : {
        stderr: trimForMessage(consumerRun.stderr),
        stdout: trimForMessage(consumerRun.stdout)
      }
    };
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
    kind: "knowmesh.sdkConsumerSmoke",
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

function parseConsumerOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
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

function parseCliArgs(argv) {
  return {
    keepTemp: argv.includes("--keep-temp")
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runSdkConsumerSmoke(parseCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
