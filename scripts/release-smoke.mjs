#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { startLocalService } from "../src/local-service/server.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runReleaseSmoke(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const ownsUserDataRoot = !options.userDataRoot;
  const userDataRoot = options.userDataRoot || fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-release-smoke-"));
  const service = await startLocalService({
    projectRoot,
    userDataRoot,
    host: "127.0.0.1",
    port: 0,
    open: false,
    env: options.env
  });
  try {
    const baseEndpoints = [
      "/api/health",
      "/api/knowledge-bases",
      "/api/maintenance/foundation",
      "/api/platform/runtime",
      "/api/providers/capabilities",
      "/api/package/export/preview"
    ];
    const checks = [];
    let knowledgeBaseId = "";
    for (const endpoint of baseEndpoints) {
      const check = await requestCheck(service.url, endpoint);
      checks.push(check);
      if (endpoint === "/api/knowledge-bases") knowledgeBaseId = check.selectedKnowledgeBaseId || "";
      if (endpoint === "/api/knowledge-bases" && !knowledgeBaseId) {
        knowledgeBaseId = await createSmokeKnowledgeBase(service.url);
      }
    }
    if (knowledgeBaseId) {
      checks.push(await requestCheck(service.url, `/kb/${knowledgeBaseId}/api/maintenance/status`));
      checks.push(await requestCheck(service.url, `/kb/${knowledgeBaseId}/api/package/export/preview`));
    }
    const failed = checks.filter((item) => isFailedSmokeCheck(item));
    return {
      ok: failed.length === 0,
      kind: "knowmesh.releaseSmoke",
      apiVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      service: {
        host: "127.0.0.1",
        port: service.port,
        url: service.url
      },
      knowledgeBaseId,
      summary: {
        total: checks.length,
        failed: failed.length,
        passed: checks.length - failed.length
      },
      checks
    };
  } finally {
    await service.close();
    if (ownsUserDataRoot) fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
}

async function createSmokeKnowledgeBase(baseUrl) {
  const response = await fetch(`${baseUrl}/api/knowledge-bases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "kb-release-smoke",
      name: "Release Smoke",
      template: "general-docs"
    })
  });
  const body = await response.json();
  return body.knowledgeBase?.id || "";
}

function isFailedSmokeCheck(check) {
  if (check.status !== 200) return true;
  if (check.failures.length > 0) return true;
  if (check.endpoint === "/api/providers/capabilities") return false;
  return check.ok === false;
}

async function requestCheck(baseUrl, endpoint) {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`);
    const body = await response.json();
    return {
      endpoint,
      status: response.status,
      ok: body.ok !== false,
      kind: body.kind || "",
      selectedKnowledgeBaseId: body.current?.id || body.summary?.currentKnowledgeBase || body.packageManifest?.knowledgeBase?.id || "",
      failures: Array.isArray(body.checks)
        ? body.checks.filter((item) => item.status === "fail" || item.status === "blocked").map((item) => item.key)
        : []
    };
  } catch (error) {
    return {
      endpoint,
      status: 0,
      ok: false,
      kind: "",
      selectedKnowledgeBaseId: "",
      failures: [error instanceof Error ? error.message : String(error)]
    };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runReleaseSmoke({ projectRoot: defaultProjectRoot });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
