import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { providerCapabilities } from "./provider-capabilities.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("provider capabilities summarize configured model and vector providers without leaking keys", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: true, accessKeyId: "LTAI****ABCD" },
      modelProvider: {
        configured: true,
        provider: "aliyun-bailian",
        protocol: "openai-compatible",
        region: "cn-beijing",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-****cret"
      },
      modelQuality: {
        configured: true,
        profile: "recommended",
        ocr: "qwen-vl-ocr-2025-11-20",
        organizer: "qwen-plus",
        embedding: "text-embedding-v4",
        rerank: "qwen3-rerank"
      },
      search: {
        configured: true,
        provider: "aliyun-vector",
        bucket: "knowmesh-vector",
        index: "k12_textbook_v1",
        embedding: "text-embedding-v4"
      },
      draft: {
        "aliyun.storage.bucket": "knowmesh-source",
        "aliyun.search.bucket": "knowmesh-vector",
        "aliyun.search.index": "k12_textbook_v1"
      }
    },
    draft: {
      "aliyun.model.apiKey": "sk-raw-secret"
    }
  });

  assert.equal(capabilities.kind, "knowmesh.providerCapabilities");
  assert.equal(capabilities.summary.status, "ready");
  assert.ok(capabilities.providers.length >= 7);
  assert.ok(capabilities.providers.every((item) => item.setupRequirements && item.privacyBoundary && item.cost && item.batch && item.retry));
  assert.ok(capabilities.providers.some((item) => item.id === "local-parser" && item.configured === true));
  assert.ok(capabilities.providers.some((item) => item.id === "local-ocr" && item.status === "setupRequired"));
  assert.ok(capabilities.providers.some((item) => item.id === "local-vector" && item.status === "disabled"));
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-model-studio").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-storage").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-vector").configured, true);
  assert.ok(capabilities.capabilities.some((item) => item.key === "localParsing" && item.providerId === "local-parser"));
  assert.ok(capabilities.capabilities.some((item) => item.key === "documentOcr" && item.providerId === "aliyun-model-studio"));
  assert.ok(capabilities.capabilities.some((item) => item.key === "vectorSearch" && item.providerId === "aliyun-oss-vector"));
  assert.equal(capabilities.modelSelections.embedding.modelId, "text-embedding-v4");
  assert.ok(capabilities.permissionBundles.some((item) => item.providerId === "aliyun-oss-vector" && item.actions.includes("oss:ListVectorBuckets")));
  assert.ok(capabilities.costPrivacyCards.some((item) => item.providerId === "aliyun-model-studio" && item.cost.units.includes("model_calls")));
  assert.doesNotMatch(JSON.stringify(capabilities), /sk-raw-secret|sk-\*\*\*\*cret|apiKey|accessKeySecret/i);
});

test("provider capabilities expose adapter contracts dry-run calls and secret policy", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: true, accessKeyId: "LTAI****ABCD", accessKeySecret: "raw-secret" },
      modelProvider: { configured: true, provider: "aliyun-bailian", protocol: "openai-compatible" },
      modelQuality: {
        configured: true,
        ocr: "qwen-vl-ocr-2025-11-20",
        organizer: "qwen-plus",
        embedding: "text-embedding-v4",
        rerank: "qwen3-rerank"
      },
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

  assert.deepEqual(capabilities.adapterContracts.map((item) => item.id), [
    "parser",
    "ocr",
    "chat",
    "embedding",
    "rerank",
    "vector",
    "object-store"
  ]);
  assert.ok(capabilities.adapterContracts.every((item) => item.interfaceVersion === "1.0.0" && item.requiredMethods.length > 0));
  assert.equal(capabilities.dryRun.kind, "knowmesh.providerDryRun");
  assert.equal(capabilities.dryRun.summary.externalCallsBeforeExecution > 0, true);
  assert.ok(capabilities.dryRun.externalCalls.some((item) => item.adapter === "chat" && item.providerId === "aliyun-model-studio"));
  assert.ok(capabilities.dryRun.missing.some((item) => item.adapter === "ocr" || item.adapter === "vector") === false);
  assert.deepEqual(capabilities.sensitiveDataPolicy.excludedFrom, ["sqlite", "diagnostics", "packagePreviews", "logs", "publicSamples", "sidecars"]);
  assert.doesNotMatch(JSON.stringify(capabilities), /raw-secret|accessKeySecret|apiKey/i);
});

test("provider capabilities expose user-fixable actions when cloud providers are not configured", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: false },
      modelProvider: { configured: false },
      modelQuality: { configured: false },
      search: { configured: false },
      draft: {}
    }
  });

  assert.equal(capabilities.summary.status, "attention");
  assert.equal(capabilities.providers.find((item) => item.id === "local-catalog").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-model-studio").configured, false);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-vector").configured, false);
  assert.ok(capabilities.guidedActions.some((item) => item.key === "configureModelProvider" && item.href === "/setup/aliyun/services"));
  assert.ok(capabilities.guidedActions.some((item) => item.key === "configureVectorSearch" && item.href === "/setup/aliyun/search"));
  assert.ok(capabilities.costPrivacyCards.every((item) => item.privacy.redacted === true));
  assert.ok(capabilities.dryRun.missing.some((item) => item.adapter === "chat"));
  assert.equal(capabilities.dryRun.summary.externalCallsBeforeExecution, 0);
});

test("provider capabilities treat explicit local-only setup as ready without cloud credentials", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: false },
      modelProvider: { configured: false },
      modelQuality: { configured: false },
      search: { configured: false },
      draft: {
        "setup.mode": "local"
      }
    }
  });

  assert.equal(capabilities.summary.status, "ready");
  assert.equal(capabilities.ok, true);
  assert.equal(capabilities.providers.find((item) => item.id === "local-catalog").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "local-parser").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "local-ocr").status, "setupRequired");
  assert.equal(capabilities.providers.find((item) => item.id === "local-vector").status, "disabled");
  assert.ok(capabilities.guidedActions.every((item) => !item.key.startsWith("configureCloud")));
  assert.ok(capabilities.capabilities.some((item) => item.key === "catalogSearch" && item.status === "available"));
  assert.ok(capabilities.capabilities.some((item) => item.key === "localVectorSearch" && item.status === "disabled"));
  assert.equal(capabilities.dryRun.summary.externalCallsBeforeExecution, 0);
  assert.ok(capabilities.dryRun.configured.some((item) => item.adapter === "parser" && item.boundary === "local"));
});

test("provider capabilities expose the local vector sidecar contract and certification", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: false },
      modelProvider: { configured: false },
      modelQuality: { configured: false },
      search: { configured: false },
      draft: {
        "setup.mode": "local"
      }
    }
  });

  assert.equal(capabilities.localVectorSidecarContract.kind, "knowmesh.localVectorSidecarContract");
  assert.equal(capabilities.localVectorSidecarContract.authority, "catalog.sqlite");
  assert.deepEqual(capabilities.localVectorSidecarContract.requiredFields, [
    "provider",
    "dimensions",
    "expectedDimensions",
    "chunkId",
    "chunkTextHash",
    "checksum",
    "status",
    "uri"
  ]);
  assert.equal(capabilities.localVectorSidecarContract.invalidVectorFallback, "catalog-search");
  assert.ok(capabilities.extensionCertification.providers.some((item) => item.id === "local-vector" && item.lifecycle.stage === "certified"));
  assert.equal(capabilities.expertRuntime.kind, "knowmesh.expertRuntimeDiagnostics");
  assert.ok(capabilities.expertRuntime.experts.some((item) => item.id === "k12" && item.writeBoundary === "catalog-writer-api"));
  assert.ok(capabilities.expertRuntime.experts.some((item) => item.id === "operations-handbook" && item.routeRules.length === 3));
  assert.ok(capabilities.expertRuntime.experts.every((item) => item.directStorageAccess === false));
  assert.doesNotMatch(JSON.stringify(capabilities.localVectorSidecarContract), /private|secret|documentText/i);
  assert.doesNotMatch(JSON.stringify(capabilities.expertRuntime), /catalog\.sqlite|workspace\.sqlite|source text|private|secret/i);
});

test("provider capabilities expose partially configured Aliyun providers as user-fixable", () => {
  const capabilities = providerCapabilities({}, {
    setupState: {
      credential: { configured: true, accessKeySecret: "should-not-leak" },
      modelProvider: { configured: false },
      modelQuality: { configured: false },
      search: { configured: false },
      draft: {
        "setup.mode": "aliyun",
        "aliyun.storage.confirmed": true,
        "aliyun.storage.bucket": "knowmesh-source"
      }
    }
  });

  assert.equal(capabilities.summary.status, "attention");
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-storage").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-model-studio").configured, false);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-vector").configured, false);
  assert.ok(capabilities.guidedActions.some((item) => item.key === "configureModelProvider"));
  assert.ok(capabilities.guidedActions.some((item) => item.key === "configureVectorSearch"));
  assert.ok(capabilities.providers.find((item) => item.id === "aliyun-model-studio").userFixableErrors.some((item) => /API Key|模型服务/.test(item.message.zh + item.message.en)));
  assert.doesNotMatch(JSON.stringify(capabilities), /should-not-leak|accessKeySecret/i);
});

test("provider adapter contribution docs cover local aliyun and future adapters", () => {
  const zh = fs.readFileSync(path.join(projectRoot, "docs", "providers.zh-CN.md"), "utf8");
  const en = fs.readFileSync(path.join(projectRoot, "docs", "providers.en.md"), "utf8");

  for (const content of [zh, en]) {
    assert.match(content, /adapterContracts/);
    assert.match(content, /dryRun/);
    assert.match(content, /parser|解析/i);
    assert.match(content, /object-store|对象存储/i);
    assert.match(content, /local-only|本地模式/i);
    assert.match(content, /Aliyun|阿里云/);
    assert.match(content, /future adapter|未来适配器/i);
    assert.doesNotMatch(content, /AccessKey Secret|sk-/i);
  }
});
