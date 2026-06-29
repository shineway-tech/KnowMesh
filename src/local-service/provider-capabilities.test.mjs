import assert from "node:assert/strict";
import test from "node:test";

import { providerCapabilities } from "./provider-capabilities.mjs";

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
  assert.ok(capabilities.providers.length >= 4);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-model-studio").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-storage").configured, true);
  assert.equal(capabilities.providers.find((item) => item.id === "aliyun-oss-vector").configured, true);
  assert.ok(capabilities.capabilities.some((item) => item.key === "documentOcr" && item.providerId === "aliyun-model-studio"));
  assert.ok(capabilities.capabilities.some((item) => item.key === "vectorSearch" && item.providerId === "aliyun-oss-vector"));
  assert.equal(capabilities.modelSelections.embedding.modelId, "text-embedding-v4");
  assert.ok(capabilities.permissionBundles.some((item) => item.providerId === "aliyun-oss-vector" && item.actions.includes("oss:ListVectorBuckets")));
  assert.ok(capabilities.costPrivacyCards.some((item) => item.providerId === "aliyun-model-studio" && item.cost.units.includes("model_calls")));
  assert.doesNotMatch(JSON.stringify(capabilities), /sk-raw-secret|sk-\*\*\*\*cret|apiKey|secret/i);
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
});
