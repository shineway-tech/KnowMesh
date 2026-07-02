import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  integrationBoundary,
  integrationContractVersion,
  integrationEndpoints,
  integrationManifest
} from "./integration-manifest.mjs";
import { startLocalService } from "./server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("integration manifest is versioned, bounded, and API-only", () => {
  const manifest = integrationManifest({}, { scoped: false });

  assert.equal(manifest.ok, true);
  assert.equal(manifest.kind, "knowmesh.integrationManifest");
  assert.equal(manifest.contractVersion, integrationContractVersion);
  assert.equal(manifest.manifestVersion, "2026-07-integration-manifest.1");
  assert.equal(manifest.knowledgeBase.scoped, false);
  assert.equal(manifest.knowledgeBase.id, "");
  assert.deepEqual(manifest.integrationBoundary, integrationBoundary);
  assert.equal(manifest.integrationBoundary.mode, "http-api-only");
  assert.equal(manifest.endpoints.length, integrationEndpoints.length);
  assert.deepEqual(manifest.endpoints.map((item) => item.path), integrationEndpoints.map((item) => item.path));
  assert.ok(manifest.retryPolicy.retryable.includes("provider_unavailable"));
  assert.ok(manifest.privacy.excludes.includes("rawProviderResponses"));

  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /[A-Z]:\\|\/Users\/|\\Users\\|AccessKey|sk-|weekly review cadence|private textbook|真实教材/i);
  assert.doesNotMatch(serialized, /sourceContent.+weekly|documentText.+lesson/i);
});

test("endpoint manifest and OpenAPI stay aligned with runtime integration endpoints", () => {
  const endpointManifest = readJson("docs/api/endpoint-manifest.json");
  const openApi = readJson("docs/api/openapi.json");

  assert.equal(endpointManifest.kind, "knowmesh.endpointManifest");
  assert.equal(endpointManifest.contractVersion, integrationContractVersion);
  assert.equal(endpointManifest.manifestVersion, "2026-07-integration-manifest.1");
  assert.deepEqual(endpointManifest.integrationBoundary, integrationBoundary);
  assert.deepEqual(endpointManifest.endpoints.map((item) => item.key), integrationEndpoints.map((item) => item.key));

  for (const expected of integrationEndpoints) {
    const documented = endpointManifest.endpoints.find((item) => item.key === expected.key);
    assert.ok(documented, `${expected.key} should exist in endpoint manifest`);
    assert.equal(documented.method, expected.method);
    assert.equal(documented.path, expected.path);
    assert.deepEqual(documented.pathParams, expected.pathParams);
    assert.equal(documented.responseKind, expected.responseKind);
    assert.deepEqual(documented.statusCases, expected.statusCases);
    assert.equal(Boolean(openApi.paths[expected.path]), true, `${expected.path} should exist in OpenAPI`);
    assert.equal(Boolean(openApi.paths[expected.path][expected.method.toLowerCase()]), true, `${expected.method} ${expected.path} should exist in OpenAPI`);
  }
}
);

test("integration manifest API supports unscoped and scoped discovery without private state", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-integration-manifest-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });

  try {
    const unscoped = await fetchJson(`${service.url}/api/integration/manifest`);
    assert.equal(unscoped.kind, "knowmesh.integrationManifest");
    assert.equal(unscoped.knowledgeBase.scoped, false);
    assert.equal(unscoped.knowledgeBase.id, "");
    assert.equal(unscoped.endpoints.find((item) => item.key === "query").scopedPath, "/kb/{knowledgeBaseId}/api/query");

    const createResponse = await fetch(`${service.url}/api/knowledge-bases`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "integration-test-kb", name: "Integration Test KB", template: "general-docs" })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 200);
    assert.equal(created.ok, true);

    const unscopedAfterCreate = await fetchJson(`${service.url}/api/integration/manifest`);
    assert.equal(unscopedAfterCreate.knowledgeBase.scoped, false);
    assert.equal(unscopedAfterCreate.knowledgeBase.id, "");

    const scoped = await fetchJson(`${service.url}/kb/${created.knowledgeBase.id}/api/integration/manifest`);
    assert.equal(scoped.knowledgeBase.scoped, true);
    assert.equal(scoped.knowledgeBase.id, created.knowledgeBase.id);
    assert.equal(scoped.endpoints.find((item) => item.key === "query").scopedPath, "/kb/integration-test-kb/api/query");
    assert.equal(scoped.endpoints.find((item) => item.key === "integrationManifest").scopedPath, "/api/integration/manifest");
    assert.doesNotMatch(JSON.stringify(scoped), /[A-Z]:\\|\/Users\/|\\Users\\|AccessKey|sk-|weekly review cadence|private textbook|真实教材/i);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  assert.equal(response.status, 200, `${url} should return 200`);
  return body;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}
