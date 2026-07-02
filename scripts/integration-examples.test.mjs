import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(projectRoot, "examples", "integrations");
const openApi = JSON.parse(fs.readFileSync(path.join(projectRoot, "docs", "api", "openapi.json"), "utf8"));

const requiredPaths = [
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
];

test("integration examples cover the same endpoint list as OpenAPI", async () => {
  const nodeExample = await import(pathToFileURL(path.join(examplesRoot, "node", "query-runtime-client.mjs")).href);
  const sdk = await import(pathToFileURL(path.join(projectRoot, "src", "sdk", "knowmesh-client.mjs")).href);
  const httpExample = fs.readFileSync(path.join(examplesRoot, "http", "query-runtime.http"), "utf8");
  const readme = fs.readFileSync(path.join(examplesRoot, "README.md"), "utf8");

  assert.deepEqual(Object.values(nodeExample.knowMeshIntegrationEndpoints), requiredPaths);
  assert.deepEqual(Object.values(sdk.knowMeshIntegrationEndpoints), requiredPaths);
  assert.equal(nodeExample.knowMeshIntegrationContract.queryRouteContractVersion, "2026-07-query-runtime.1");
  assert.equal(sdk.knowMeshIntegrationContract.contractVersion, "2026-07-query-runtime.1");
  assert.equal(nodeExample.knowMeshIntegrationContract.answerPolicy, "citation_ready_evidence_only");
  assert.equal(sdk.knowMeshIntegrationContract.answerPolicy, "citation_ready_evidence_only");
  for (const endpoint of requiredPaths) {
    assert.ok(openApi.paths[endpoint], `${endpoint} should exist in OpenAPI`);
    assert.match(httpExample, new RegExp(endpoint.replace("{knowledgeBaseId}", "\\{\\{knowledgeBaseId\\}\\}").replaceAll("/", "\\/")));
    assert.match(readme, new RegExp(endpoint.replace("{knowledgeBaseId}", ":knowledgeBaseId").replaceAll("/", "\\/")));
  }
});

test("integration examples stay API-first and package-safe", () => {
  const files = [
    "README.md",
    "node/query-runtime-client.mjs",
    "http/query-runtime.http",
    ...fs.readdirSync(path.join(examplesRoot, "expected-responses"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => `expected-responses/${file}`)
  ];
  for (const file of files) {
    assert.equal(fs.existsSync(path.join(examplesRoot, file)), true, `${file} should exist`);
  }

  const combined = files.map((file) => fs.readFileSync(path.join(examplesRoot, file), "utf8")).join("\n");
  assert.match(combined, /Query Runtime/);
  assert.match(combined, /query\.evidencePack/);
  assert.match(combined, /citation_ready_evidence_only/);
  assert.match(combined, /out_of_scope/);
  assert.match(combined, /blocked_by_quality/);
  assert.match(combined, /feedback/);
  assert.match(combined, /feedback\/summary/);
  assert.match(combined, /integration\/manifest/);
  assert.match(combined, /integration\/diagnostics/);
  assert.match(combined, /providers\/diagnostics/);
  assert.match(combined, /package\/export\/preview/);
  assert.match(combined, /package\/import\/preview/);
  assert.match(combined, /maintenance\/status/);
  assert.match(combined, /version\/manifest/);
  assert.match(combined, /Do not read internal SQLite|不要读取内部 SQLite/);
  assert.doesNotMatch(combined, /catalog\.sqlite|workspace\.sqlite|source text|private textbook|AccessKey|sk-/i);
});

test("integration expected responses are versioned and cover app-facing workflows", () => {
  const responseFiles = fs.readdirSync(path.join(examplesRoot, "expected-responses"))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const required = [
    "catalog-search.json",
    "feedback-recorded.json",
    "feedback-summary.json",
    "integration-diagnostics.json",
    "integration-manifest.json",
    "maintenance-status.json",
    "package-export-preview.json",
    "package-import-preview.json",
    "provider-diagnostics.json",
    "provider-unavailable.json",
    "query-no-answer.json",
    "query-refusal.json",
    "query-result.json",
    "validation-error.json",
    "version-manifest.json"
  ];

  assert.deepEqual(responseFiles, required);
  for (const file of responseFiles) {
    const fixture = JSON.parse(fs.readFileSync(path.join(examplesRoot, "expected-responses", file), "utf8"));
    assert.equal(fixture.contractVersion, "2026-07-query-runtime.1", `${file} should carry contractVersion`);
    assert.doesNotMatch(JSON.stringify(fixture), /catalog\.sqlite|workspace\.sqlite|private textbook|AccessKey|sk-|[A-Z]:\\/i);
  }
});
