import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { providerDiagnostics } from "./provider-diagnostics.mjs";
import { startLocalService } from "./server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("provider diagnostics summarize manifests dry-run privacy retryability and next actions", () => {
  const diagnostics = providerDiagnostics({
    defaultSetupDraft: {
      "setup.mode": "local"
    }
  }, {
    setupState: {
      credential: { configured: false },
      modelProvider: { configured: false },
      modelQuality: { configured: false },
      search: { configured: false },
      draft: { "setup.mode": "local" }
    }
  });

  assert.equal(diagnostics.kind, "knowmesh.providerDiagnostics");
  assert.equal(diagnostics.summary.status, "ready");
  assert.equal(diagnostics.summary.adapterManifests, 11);
  assert.equal(diagnostics.summary.externalCallsBeforeExecution, 0);
  assert.equal(diagnostics.dryRun.externalCallsBeforeExecution, 0);
  assert.equal(diagnostics.stateAuthority.providerSelection, "workspace.sqlite");
  assert.equal(diagnostics.stateAuthority.browserStorage, "visual-preferences-only");
  assert.ok(diagnostics.manifestReadiness.validation.ok);
  assert.ok(diagnostics.costPrivacyWarnings.some((item) => item.providerId === "aliyun-model-studio" && item.dataLeavesDevice === true));
  assert.ok(diagnostics.retryability.some((item) => item.adapterId === "dashscope-embedding" && item.checkpointed === true));
  assert.ok(diagnostics.nextActions.every((item) => item.key !== "configureCloudCredential"));
  assert.doesNotMatch(JSON.stringify(diagnostics), /apiKey|accessKeySecret|sk-/i);
});

test("provider diagnostics API is scoped and redacted", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-provider-diagnostics-api-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const kb = createKnowledgeBase({ userDataRoot, projectRoot }, { name: "Provider Diagnostics KB", template: "general-docs" });
    const response = await fetch(`${service.url}/kb/${kb.id}/api/providers/diagnostics`);
    const diagnostics = await response.json();

    assert.equal(response.status, 200);
    assert.equal(diagnostics.kind, "knowmesh.providerDiagnostics");
    assert.equal(diagnostics.knowledgeBase.id, kb.id);
    assert.equal(diagnostics.stateAuthority.providerSelection, "workspace.sqlite");
    assert.ok(Array.isArray(diagnostics.capabilityInventory));
    assert.ok(Array.isArray(diagnostics.dryRun.missing));
    assert.doesNotMatch(JSON.stringify(diagnostics), /apiKey|accessKeySecret|sk-/i);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});
