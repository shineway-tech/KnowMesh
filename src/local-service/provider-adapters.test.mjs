import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  builtinProviderAdapterManifests,
  providerAdapterManifestContract,
  providerAdapterManifestSummary,
  validateProviderAdapterManifest,
  validateProviderAdapterRegistry
} from "./provider-adapters.mjs";
import { providerCapabilities } from "./provider-capabilities.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("provider adapter manifest contract lists stable auditable fields", () => {
  const contract = providerAdapterManifestContract();

  assert.equal(contract.kind, "knowmesh.providerAdapterManifestContract");
  assert.equal(contract.contractVersion, "1.0.0");
  assert.deepEqual(contract.requiredFields, [
    "id",
    "kind",
    "lifecycle",
    "capabilities",
    "execution",
    "permissions",
    "secretRequirements",
    "privacyBoundary",
    "costHints",
    "batchLimits",
    "retryPolicy",
    "checkpointPolicy",
    "storageBoundary",
    "docs",
    "fixtures",
    "requiredTests"
  ]);
  assert.ok(contract.adapterKinds.includes("parser"));
  assert.ok(contract.adapterKinds.includes("embedding"));
  assert.ok(contract.adapterKinds.includes("vector-store"));
  assert.ok(contract.executionModes.includes("external"));
  assert.ok(contract.lifecycleStages.includes("experimental"));
});

test("built-in provider adapter manifests cover local cloud and fallback adapters", () => {
  const manifests = builtinProviderAdapterManifests();
  const ids = manifests.map((item) => item.id);

  assert.deepEqual(ids, [
    "local-catalog",
    "local-parser",
    "local-ocr",
    "local-vector-sidecar",
    "aliyun-oss",
    "dashscope-ocr",
    "aliyun-oss-vector",
    "dashscope-embedding",
    "dashscope-rerank",
    "no-rerank-fallback",
    "no-provider-fallback"
  ]);
  assert.equal(validateProviderAdapterRegistry(manifests).ok, true);
  assert.ok(manifests.every((item) => item.docs.length > 0 && item.requiredTests.length > 0));
  assert.ok(manifests.every((item) => item.storageBoundary.directCatalogSqlite === false));
  assert.ok(manifests.filter((item) => item.execution.mode === "external").every((item) => item.execution.dryRunSupported === true));
  assert.ok(manifests.some((item) => item.id === "local-parser" && item.privacyBoundary.dataLeavesDevice === false));
  assert.ok(manifests.some((item) => item.id === "dashscope-embedding" && item.secretRequirements.some((secret) => secret.key === "DASHSCOPE_API_KEY")));
  assert.doesNotMatch(JSON.stringify(manifests), /catalog\.sqlite|workspace\.sqlite|sk-|AccessKey Secret/i);

  const summary = providerAdapterManifestSummary(manifests);
  assert.equal(summary.total, 11);
  assert.equal(summary.external, 5);
  assert.equal(summary.localFirst, 6);
  assert.equal(summary.validation.ok, true);
});

test("provider adapter manifest validation rejects unsafe adapter contracts", () => {
  const invalid = {
    ...builtinProviderAdapterManifests()[0],
    id: "unsafe-wildcard",
    lifecycle: { stage: "official", since: "0.5.0" },
    execution: {
      mode: "external",
      externalCallsBeforeDryRun: true,
      dryRunSupported: false,
      requiresExplicitUserAction: false
    },
    permissions: ["oss:*", "*"],
    storageBoundary: {
      writesCatalog: true,
      directCatalogSqlite: true,
      method: "write catalog.sqlite directly"
    },
    docs: [],
    fixtures: ["fixtures/private/source.pdf"],
    requiredTests: []
  };

  const result = validateProviderAdapterManifest(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((item) => item.code).sort(), [
    "direct_catalog_sqlite",
    "external_dry_run_missing",
    "implicit_external_call",
    "missing_docs",
    "missing_required_tests",
    "private_fixture",
    "unsafe_lifecycle_graduation",
    "wildcard_permission"
  ]);
});

test("provider capabilities expose adapter manifests and validation without leaking secrets", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: true, accessKeySecret: "should-not-leak" },
      modelProvider: { configured: true, provider: "aliyun-bailian", protocol: "openai-compatible", apiKey: "sk-should-not-leak" },
      modelQuality: { configured: true, embedding: "text-embedding-v4", organizer: "qwen-plus", ocr: "qwen-vl-ocr-2025-11-20", rerank: "qwen3-rerank" },
      search: { configured: true, provider: "aliyun-vector", bucket: "vector-bucket", index: "active-index" },
      draft: {
        "setup.mode": "aliyun",
        "aliyun.storage.confirmed": true,
        "aliyun.storage.bucket": "source-bucket",
        "aliyun.search.bucket": "vector-bucket",
        "aliyun.search.index": "active-index"
      }
    }
  });

  assert.equal(capabilities.providerAdapterManifestContract.kind, "knowmesh.providerAdapterManifestContract");
  assert.deepEqual(capabilities.providerAdapterManifests.map((item) => item.id), [
    "local-catalog",
    "local-parser",
    "local-ocr",
    "local-vector-sidecar",
    "aliyun-oss",
    "dashscope-ocr",
    "aliyun-oss-vector",
    "dashscope-embedding",
    "dashscope-rerank",
    "no-rerank-fallback",
    "no-provider-fallback"
  ]);
  assert.equal(capabilities.providerAdapterManifestSummary.validation.ok, true);
  assert.ok(capabilities.providerAdapterManifests.every((item) => item.storageBoundary.directCatalogSqlite === false));
  assert.doesNotMatch(JSON.stringify(capabilities), /should-not-leak|sk-should-not-leak|apiKey|accessKeySecret/i);
});

test("provider adapter docs describe manifest validation and built-in adapters", () => {
  const zh = fs.readFileSync(path.join(projectRoot, "docs", "providers.zh-CN.md"), "utf8");
  const en = fs.readFileSync(path.join(projectRoot, "docs", "providers.en.md"), "utf8");

  for (const content of [zh, en]) {
    assert.match(content, /providerAdapterManifests/);
    assert.match(content, /validateProviderAdapterManifest/);
    assert.match(content, /local-vector-sidecar/);
    assert.match(content, /local-ocr/);
    assert.match(content, /dashscope-ocr/);
    assert.match(content, /dashscope-embedding/);
    assert.match(content, /dashscope-rerank/);
    assert.match(content, /no-rerank-fallback/);
    assert.match(content, /no-provider-fallback/);
    assert.match(content, /wildcard|通配/);
    assert.doesNotMatch(content, /AccessKey Secret|sk-/i);
  }
});
