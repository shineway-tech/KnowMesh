import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startLocalService } from "../src/local-service/server.mjs";
import { catalogDatabasePath, knowledgeBaseDataRoot } from "../src/local-service/storage.mjs";
import { providerCapabilities } from "../src/local-service/provider-capabilities.mjs";
import { getExpert, listExperts } from "../src/local-service/expert-registry.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractVersion = "2026-07-query-runtime.1";
const betaEndpointPaths = [
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

test("Block J1 public sample flow exposes ownership reset safety and leaves no residual sample state", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-j-sample-"));
  const service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
  try {
    const createResponse = await fetch(`${service.url}/api/public-samples/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sampleId: "general-docs" })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 200);
    assert.equal(created.ok, true);

    const maintenance = await fetchJson(`${service.url}/kb/${created.knowledgeBase.id}/api/maintenance/status`);
    const packagePreview = await fetchJson(`${service.url}/kb/${created.knowledgeBase.id}/api/package/export/preview`);
    const expectedOwnership = {
      publicSample: true,
      sampleId: "general-docs",
      owner: "knowmesh-public-sample-wizard",
      resetAllowed: true,
      cleanupScope: "sample-owned-knowledge-base-only"
    };

    assert.deepEqual(maintenance.maintenance.sampleOwnership, expectedOwnership);
    assert.deepEqual(packagePreview.packageManifest.sampleOwnership, expectedOwnership);
    assert.equal(packagePreview.exportPlan.resetSafety.sampleOwnedOnly, true);
    assert.equal(packagePreview.exportPlan.resetSafety.removesNormalKnowledgeBases, false);
    assert.doesNotMatch(JSON.stringify(maintenance), /weekly review cadence|ACCESS_KEY|sk-/i);
    assert.doesNotMatch(JSON.stringify(packagePreview), /weekly review cadence|ACCESS_KEY|sk-/i);

    const ordinary = await createKnowledgeBase(service.url, {
      id: "ordinary-kb",
      name: "Ordinary KB",
      template: "general-docs"
    });
    const sampleRoot = knowledgeBaseDataRoot({ userDataRoot }, created.knowledgeBase.id);
    assert.equal(fs.existsSync(catalogDatabasePath({ userDataRoot }, created.knowledgeBase.id)), true);
    assert.equal(fs.existsSync(sampleRoot), true);

    const resetResponse = await fetch(`${service.url}/api/public-samples/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ knowledgeBaseId: created.knowledgeBase.id })
    });
    const reset = await resetResponse.json();
    assert.equal(resetResponse.status, 200);
    assert.equal(reset.ok, true);

    const afterReset = await fetchJson(`${service.url}/api/knowledge-bases`);
    assert.equal(afterReset.items.some((item) => item.id === created.knowledgeBase.id), false);
    assert.equal(afterReset.items.some((item) => item.id === ordinary.id), true);
    assert.equal(fs.existsSync(sampleRoot), false);
    assert.equal(fs.existsSync(catalogDatabasePath({ userDataRoot }, created.knowledgeBase.id)), false);
  } finally {
    await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});

test("Block J2 integration SDK contract is versioned and covers success and error response examples", async () => {
  const openApi = readJson("docs/api/openapi.json");
  const endpointManifest = readJson("docs/api/endpoint-manifest.json");
  const nodeExample = await import(pathToFileURL(path.join(projectRoot, "examples", "integrations", "node", "query-runtime-client.mjs")).href);
  const readme = readText("examples/integrations/README.md");

  assert.equal(openApi.info["x-knowmesh-contract-version"], contractVersion);
  assert.equal(endpointManifest.contractVersion, contractVersion);
  assert.deepEqual(endpointManifest.endpoints.map((item) => item.path), betaEndpointPaths);
  assert.deepEqual(Object.values(nodeExample.knowMeshIntegrationEndpoints), betaEndpointPaths);
  assert.equal(nodeExample.knowMeshIntegrationContract.contractVersion, contractVersion);
  assert.equal(nodeExample.knowMeshIntegrationContract.apiVersion, "1.0.0");
  assert.equal(typeof nodeExample.KnowMeshApiError, "function");
  assert.match(readme, /contractVersion/);
  assert.match(readme, /non-2xx|timeout|retryable/i);

  for (const file of [
    "query-result.json",
    "query-refusal.json",
    "query-no-answer.json",
    "validation-error.json",
    "provider-unavailable.json",
    "catalog-search.json",
    "feedback-recorded.json",
    "feedback-summary.json",
    "integration-diagnostics.json",
    "integration-manifest.json",
    "maintenance-status.json",
    "package-export-preview.json",
    "package-import-preview.json",
    "provider-diagnostics.json",
    "version-manifest.json"
  ]) {
    const response = readJson(path.join("examples", "integrations", "expected-responses", file));
    assert.equal(response.contractVersion, contractVersion, `${file} should carry contractVersion`);
    assert.doesNotMatch(JSON.stringify(response), /source text|private textbook|真实教材|AccessKey|sk-/i);
  }
});

test("Block J3 extension lifecycle validation blocks unsafe Expert and provider adapter changes", async () => {
  const lifecycle = await import(pathToFileURL(path.join(projectRoot, "src", "local-service", "extension-lifecycle.mjs")).href);
  const stages = ["official", "certified", "community", "experimental"];

  assert.deepEqual(lifecycle.extensionLifecycleStages, stages);
  for (const summary of listExperts()) {
    assert.ok(stages.includes(summary.lifecycle.stage), `${summary.id} should expose a lifecycle stage`);
    const validation = lifecycle.validateExpertExtension(getExpert(summary.id));
    assert.equal(validation.ok, true, `${summary.id} should pass lifecycle validation: ${validation.issues.join(", ")}`);
  }

  const unsafeExpert = {
    ...getExpert("operations-handbook"),
    lifecycle: { stage: "community" },
    capabilities: {
      directCatalog: {
        kind: "internal-sqlite",
        path: "catalog.sqlite"
      }
    }
  };
  const unsafeExpertValidation = lifecycle.validateExpertExtension(unsafeExpert);
  assert.equal(unsafeExpertValidation.ok, false);
  assert.ok(unsafeExpertValidation.issues.includes("internalSQLiteDependency"));

  const capabilities = providerCapabilities({}, { setupState: { draft: { "setup.mode": "local" } } });
  assert.ok(capabilities.adapterContracts.every((item) => stages.includes(item.lifecycle.stage)));

  const unsafeProvider = {
    ...capabilities.adapterContracts[0],
    requiredMethods: [],
    permissions: ["*"]
  };
  const providerValidation = lifecycle.validateProviderAdapterContract(unsafeProvider);
  assert.equal(providerValidation.ok, false);
  assert.ok(providerValidation.issues.includes("requiredMethods"));
  assert.ok(providerValidation.issues.includes("unsafePermissions"));
});

test("Block J4 public beta docs navigation is link-checked and search-friendly in Chinese and English", () => {
  const docs = [
    "README.md",
    "README.en.md",
    "docs/README.md",
    "docs/README.en.md",
    "CONTRIBUTING.md",
    "ROADMAP.md",
    "ROADMAP.en.md",
    "docs/community-backlog.zh-CN.md",
    "docs/community-backlog.en.md",
    "docs/release-operations.zh-CN.md",
    "docs/release-operations.en.md"
  ];
  const combined = docs.map((file) => readText(file)).join("\n\n");

  for (const phrase of [
    "Knowledge Asset Compiler",
    "本地优先",
    "public samples",
    "公开样例",
    "Integration Examples",
    "Expert Authoring Kit",
    "Provider Adapters",
    "Release Operations",
    "Community Backlog",
    "K12"
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), "i"), `${phrase} should be discoverable`);
  }
  assert.match(combined, /official.*certified.*community.*experimental|official[\s\S]*certified[\s\S]*community[\s\S]*experimental/i);
  assert.match(combined, /public beta|公开 beta|Public Beta/i);
  assertMarkdownLinksResolve(docs);
});

test("Block J5 public beta release evidence requires browser QA notes asset review and beta release notes", async () => {
  const { evaluatePublicBetaReleaseEvidence } = await import(pathToFileURL(path.join(projectRoot, "scripts", "release-gate.mjs")).href);
  const partial = evaluatePublicBetaReleaseEvidence({
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "a".repeat(64) },
    packageBoundary: "pass",
    diffCheck: "pass",
    githubCi: "pass",
    githubCodeql: "pass",
    githubScorecard: "pass"
  });
  assert.equal(partial.releaseAllowed, false);
  assert.ok(partial.missing.includes("browserSampleFlow"));
  assert.ok(partial.missing.includes("betaReleaseNotes"));
  assert.ok(partial.missing.includes("releaseAssetReview"));

  const complete = evaluatePublicBetaReleaseEvidence({
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "a".repeat(64) },
    packageBoundary: "pass",
    diffCheck: "pass",
    githubCi: "pass",
    githubCodeql: "pass",
    githubScorecard: "pass",
    browserSampleFlow: { status: "pass", desktop: true, narrow: true, resetVerified: true },
    betaReleaseNotes: { status: "pass", supportedPaths: true, limitations: true, knownGaps: true, npmPublication: "separate-decision" },
    releaseAssetReview: { status: "pass", noPrivateState: true, noSqlite: true, noSecrets: true }
  });
  assert.equal(complete.releaseStage, "public-beta");
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.npmPublication, "separate-decision");

  const releaseOps = `${readText("docs/release-operations.zh-CN.md")}\n${readText("docs/release-operations.en.md")}`;
  assert.match(releaseOps, /browserSampleFlow/);
  assert.match(releaseOps, /betaReleaseNotes/);
  assert.match(releaseOps, /releaseAssetReview/);
  assert.match(releaseOps, /known gaps|已知缺口/i);
});

async function createKnowledgeBase(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/api/knowledge-bases`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  return body.knowledgeBase;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  assert.equal(response.status, 200, `${url} should return 200`);
  assert.equal(body.ok, true, `${url} should be ok`);
  return body;
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function assertMarkdownLinksResolve(files) {
  for (const file of files) {
    const content = readText(file);
    const baseDir = path.dirname(path.join(projectRoot, file));
    const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const rawHref of links) {
      const href = rawHref.split("#")[0].trim();
      if (!href || /^[a-z]+:/i.test(href) || href.startsWith("mailto:")) continue;
      const target = path.resolve(baseDir, decodeURI(href));
      assert.equal(fs.existsSync(target), true, `${file} links to missing file: ${rawHref}`);
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
