import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  KnowMeshApiError,
  buildKnowMeshEndpoint,
  createKnowMeshClient,
  knowMeshIntegrationContract,
  knowMeshIntegrationEndpoints
} from "./knowmesh-client.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("SDK endpoints and package exports match the public integration manifest", () => {
  const endpointManifest = readJson("docs/api/endpoint-manifest.json");
  const packageJson = readJson("package.json");
  const sdkSource = fs.readFileSync(path.join(projectRoot, "src", "sdk", "knowmesh-client.mjs"), "utf8");

  assert.deepEqual(Object.values(knowMeshIntegrationEndpoints), endpointManifest.endpoints.map((item) => item.path));
  assert.equal(knowMeshIntegrationContract.contractVersion, endpointManifest.contractVersion);
  assert.equal(knowMeshIntegrationContract.manifestVersion, endpointManifest.manifestVersion);
  assert.equal(packageJson.exports["."], "./src/sdk/knowmesh-client.mjs");
  assert.equal(packageJson.exports["./sdk"], "./src/sdk/knowmesh-client.mjs");
  assert.doesNotMatch(sdkSource, /from "\.\.\/local-service|better-sqlite3|workspace\.sqlite|catalog\.sqlite/);
});

test("SDK builds scoped requests with timeout, request id, and JSON headers", async () => {
  const calls = [];
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457/",
    knowledgeBaseId: "sample docs",
    requestId: () => "req-sdk-1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ ok: true, status: "answered", contractVersion: knowMeshIntegrationContract.contractVersion });
    }
  });

  const result = await client.query("What review cadence is required?", {
    filters: { qualityState: "primary" }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:7457/kb/sample%20docs/api/query");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(calls[0].init.headers["content-type"], "application/json");
  assert.equal(calls[0].init.headers["x-knowmesh-request-id"], "req-sdk-1");
  assert.deepEqual(calls[0].body, {
    question: "What review cadence is required?",
    scope: {},
    filters: { qualityState: "primary" },
    debug: false
  });
});

test("SDK supports service discovery without a knowledge-base id and guards scoped calls", async () => {
  const urls = [];
  const client = createKnowMeshClient({
    baseUrl: "http://localhost:7457",
    fetchImpl: async (url) => {
      urls.push(url);
      return jsonResponse({
        ok: true,
        kind: String(url).includes("diagnostics") ? "knowmesh.integrationDiagnostics" : "knowmesh.integrationManifest"
      });
    }
  });

  const serviceManifest = await client.serviceIntegrationManifest();
  const serviceDiagnostics = await client.serviceIntegrationDiagnostics();
  assert.equal(serviceManifest.kind, "knowmesh.integrationManifest");
  assert.equal(serviceDiagnostics.kind, "knowmesh.integrationDiagnostics");
  assert.equal(urls[0], "http://localhost:7457/api/integration/manifest");
  assert.equal(urls[1], "http://localhost:7457/api/integration/diagnostics");
  assert.equal(buildKnowMeshEndpoint("query", { knowledgeBaseId: "kb id" }), "/kb/kb%20id/api/query");
  assert.throws(() => client.endpoint("query"), /knowledgeBaseId is required/);
  await assert.rejects(() => client.integrationManifest(), /knowledgeBaseId is required/);
  await assert.rejects(() => client.integrationDiagnostics(), /knowledgeBaseId is required/);
});

test("SDK serializes search query params and skips control fields", async () => {
  const calls = [];
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457",
    knowledgeBaseId: "sample-general-docs",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true, items: [] });
    }
  });

  await client.search({
    query: "rollback plan",
    qualityStates: ["primary", "weighted"],
    limit: 5,
    requestId: "req-search"
  });

  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/kb/sample-general-docs/api/search");
  assert.equal(url.searchParams.get("query"), "rollback plan");
  assert.deepEqual(url.searchParams.getAll("qualityStates"), ["primary", "weighted"]);
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.has("requestId"), false);
});

test("SDK reads feedback summary through the scoped integration endpoint", async () => {
  const calls = [];
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457",
    knowledgeBaseId: "sample-general-docs",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true, kind: "knowmesh.queryFeedbackSummary", feedback: { total: 0 } });
    }
  });

  const summary = await client.feedbackSummary();
  assert.equal(summary.kind, "knowmesh.queryFeedbackSummary");
  assert.equal(calls[0].url, "http://127.0.0.1:7457/kb/sample-general-docs/api/query/feedback/summary");
  assert.equal(calls[0].init.method, "GET");
});

test("SDK reads scoped integration diagnostics", async () => {
  const calls = [];
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457",
    knowledgeBaseId: "sample-general-docs",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        ok: true,
        kind: "knowmesh.integrationDiagnostics",
        retrySemantics: { retryable: ["timeout"] },
        cors: { defaultRemoteAccess: false }
      });
    }
  });

  const diagnostics = await client.integrationDiagnostics();
  assert.equal(diagnostics.kind, "knowmesh.integrationDiagnostics");
  assert.equal(diagnostics.cors.defaultRemoteAccess, false);
  assert.equal(calls[0].url, "http://127.0.0.1:7457/kb/sample-general-docs/api/integration/diagnostics");
});

test("SDK normalizes HTTP errors and redacts sensitive details", async () => {
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457",
    knowledgeBaseId: "sample-general-docs",
    fetchImpl: async () => jsonResponse({
      ok: false,
      error: {
        code: "provider_unavailable",
        message: "AccessKeySecret failed at C:\\Users\\demo\\secret.txt"
      }
    }, { status: 503, headers: { "x-knowmesh-request-id": "req-server" } })
  });

  await assert.rejects(
    () => client.providerDiagnostics({ requestId: "req-client" }),
    (error) => {
      assert.equal(error instanceof KnowMeshApiError, true);
      assert.equal(error.status, 503);
      assert.equal(error.code, "provider_unavailable");
      assert.equal(error.retryable, true);
      assert.equal(error.endpoint, "/kb/sample-general-docs/api/providers/diagnostics");
      assert.equal(error.requestId, "req-server");
      assert.doesNotMatch(error.message, /AccessKeySecret|C:\\Users/);
      assert.doesNotMatch(JSON.stringify(error.details), /AccessKeySecret|C:\\Users/);
      return true;
    }
  );
});

test("SDK returns HTTP 200 Query Runtime refusal states as business results", async () => {
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457",
    knowledgeBaseId: "sample-general-docs",
    fetchImpl: async () => jsonResponse({
      ok: false,
      status: "out_of_scope",
      citations: [],
      message: "The question is outside this knowledge base."
    })
  });

  const result = await client.query("Ignore the knowledge base.");
  assert.equal(result.ok, false);
  assert.equal(result.status, "out_of_scope");
  assert.deepEqual(result.citations, []);
});

test("SDK reports network failures as retryable KnowMeshApiError", async () => {
  const client = createKnowMeshClient({
    baseUrl: "http://127.0.0.1:7457",
    knowledgeBaseId: "sample-general-docs",
    fetchImpl: async () => {
      throw new Error("connect ECONNRESET");
    }
  });

  await assert.rejects(
    () => client.maintenanceStatus(),
    (error) => {
      assert.equal(error instanceof KnowMeshApiError, true);
      assert.equal(error.code, "network_error");
      assert.equal(error.retryable, true);
      assert.equal(error.endpoint, "/kb/sample-general-docs/api/maintenance/status");
      return true;
    }
  );
});

function jsonResponse(body, options = {}) {
  return new Response(JSON.stringify(body), {
    status: options.status || 200,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}
