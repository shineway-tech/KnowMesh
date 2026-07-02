import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { integrationDiagnostics, integrationRetrySemantics } from "./integration-diagnostics.mjs";
import { startLocalService } from "./server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("integration diagnostics defines stable retry and non-retry semantics", () => {
  assert.deepEqual(integrationRetrySemantics.retryable, [
    "local_service_unavailable",
    "timeout",
    "network_error",
    "http_408",
    "http_429",
    "http_5xx",
    "provider_unavailable"
  ]);
  assert.ok(integrationRetrySemantics.nonRetryable.includes("out_of_scope"));
  assert.ok(integrationRetrySemantics.nonRetryable.includes("insufficient_evidence"));
  assert.ok(integrationRetrySemantics.maintenanceRequired.includes("blocked_by_quality"));
});

test("unscoped integration diagnostics is safe before knowledge-base selection", () => {
  const diagnostics = integrationDiagnostics({}, { scoped: false });

  assert.equal(diagnostics.kind, "knowmesh.integrationDiagnostics");
  assert.equal(diagnostics.knowledgeBase.scoped, false);
  assert.equal(diagnostics.knowledgeBase.selected, false);
  assert.equal(diagnostics.readiness.api, "ready");
  assert.equal(diagnostics.readiness.knowledgeBase, "required");
  assert.equal(diagnostics.readiness.queryRuntime.status, "blocked");
  assert.equal(diagnostics.readiness.queryRuntime.reason, "knowledge_base_required");
  assert.equal(diagnostics.cors.defaultBindHost, "127.0.0.1");
  assert.equal(diagnostics.cors.defaultRemoteAccess, false);
  assert.equal(diagnostics.nextActions[0].key, "selectKnowledgeBase");
  assertRedacted(diagnostics);
});

test("integration diagnostics API reports scoped readiness without private payloads", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-integration-diagnostics-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });

  try {
    const unscoped = await fetchJson(`${service.url}/api/integration/diagnostics`);
    assert.equal(unscoped.kind, "knowmesh.integrationDiagnostics");
    assert.equal(unscoped.knowledgeBase.scoped, false);
    assert.equal(unscoped.readiness.knowledgeBase, "required");

    const createResponse = await fetch(`${service.url}/api/public-samples/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleId: "general-docs" })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 200);
    assert.equal(created.ok, true);

    const scoped = await fetchJson(`${service.url}/kb/${created.knowledgeBase.id}/api/integration/diagnostics`);
    assert.equal(scoped.kind, "knowmesh.integrationDiagnostics");
    assert.equal(scoped.knowledgeBase.id, "sample-general-docs");
    assert.equal(scoped.knowledgeBase.selected, true);
    assert.equal(scoped.readiness.api, "ready");
    assert.equal(scoped.readiness.endpointManifest.status, "ready");
    assert.equal(scoped.readiness.queryRuntime.answerPolicy, "citation_ready_evidence_only");
    assert.equal(scoped.readiness.provider.externalCallsBeforeExecution, 0);
    assert.equal(scoped.cors.defaultRemoteAccess, false);
    assert.ok(scoped.retrySemantics.retryable.includes("provider_unavailable"));
    assert.ok(scoped.retrySemantics.nonRetryable.includes("out_of_scope"));
    assert.ok(scoped.nextActions.some((item) => item.key === "callScopedApis"));
    assertRedacted(scoped);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  assert.equal(response.status, 200, `${url} should return 200`);
  return body;
}

function assertRedacted(payload) {
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /[A-Z]:\\|\/Users\/|\\Users\\|AccessKey|sk-|weekly review cadence|private textbook|真实教材/i);
  assert.doesNotMatch(text, /"(?:sourceContent|documentText|queryText|answerText|rawProviderResponses)"\s*:\s*[{["]/i);
}
