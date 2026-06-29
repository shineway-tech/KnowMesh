const pricingUrl = "https://help.aliyun.com/zh/model-studio/model-pricing";

export const aliyunModelDocs = [
  "https://help.aliyun.com/zh/model-studio/qwen-vl-ocr",
  "https://help.aliyun.com/zh/model-studio/embedding-rerank-model/",
  "https://help.aliyun.com/zh/model-studio/text-rerank-api",
  "https://help.aliyun.com/zh/model-studio/qwen-api-reference/"
];

export const aliyunModelSlots = [
  {
    key: "ocr",
    draftKey: "aliyun.services.ocr",
    label: { zh: "OCR / 文档识别", en: "OCR / document recognition" },
    purpose: {
      zh: "把扫描页、图片页、表格和公式先识别成可整理内容。",
      en: "Turns scanned pages, image pages, tables, and formulas into content that can be organized."
    }
  },
  {
    key: "organizer",
    draftKey: "aliyun.services.organizer",
    label: { zh: "内容整理模型", en: "Organization model" },
    purpose: {
      zh: "整理章节、题目、表格、页码和来源信息，让后续问答能追溯。",
      en: "Organizes chapters, exercises, tables, page numbers, and source traceability for later Q&A."
    }
  },
  {
    key: "embedding",
    draftKey: "aliyun.services.embedding",
    label: { zh: "向量化模型", en: "Embedding model" },
    purpose: {
      zh: "把清洗后的知识片段写成可检索表示，决定索引维度和召回质量。",
      en: "Converts cleaned chunks into searchable representations and determines index dimensions and recall quality."
    }
  },
  {
    key: "rerank",
    draftKey: "aliyun.services.rerank",
    label: { zh: "重排模型", en: "Rerank model" },
    purpose: {
      zh: "在向量召回后重新排序候选片段，提高问答命中；会增加少量延迟和模型调用费用。",
      en: "Reorders recalled chunks after vector search to improve answer hits; adds some latency and model-call cost."
    }
  }
];

const catalog = {
  ocr: [
    {
      id: "qwen-vl-ocr-2025-11-20",
      label: { zh: "qwen-vl-ocr-2025-11-20", en: "qwen-vl-ocr-2025-11-20" },
      status: "recommended",
      fit: {
        zh: "推荐用于 K12 教材、扫描 PDF、表格和公式页。",
        en: "Recommended for K12 textbooks, scanned PDFs, tables, and formula pages."
      },
      impact: {
        zh: "识别质量优先；真正执行 OCR 前会先展示页数、范围和费用风险。",
        en: "Prioritizes recognition quality; page count, scope, and cost risk are shown before OCR runs."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/qwen-vl-ocr",
      pricingUrl
    },
    {
      id: "qwen3-vl-plus",
      label: { zh: "Qwen3-VL Plus", en: "Qwen3-VL Plus" },
      status: "available",
      fit: {
        zh: "适合复杂图片、图文混排和需要视觉理解的页面。",
        en: "For complex images, mixed text-image pages, and visual understanding."
      },
      impact: {
        zh: "质量更强，通常成本和耗时更高；用于 OCR 补充场景。",
        en: "Higher quality with usually higher cost and latency; use as an OCR supplement."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/vision",
      pricingUrl
    },
    {
      id: "qwen3-vl-flash",
      label: { zh: "Qwen3-VL Flash", en: "Qwen3-VL Flash" },
      status: "available",
      fit: {
        zh: "适合先试跑或对响应速度敏感的图像理解。",
        en: "For trial runs or speed-sensitive visual understanding."
      },
      impact: {
        zh: "速度和成本更友好，复杂扫描页可再切回质量优先模型。",
        en: "More speed and cost friendly; switch back to quality-first models for complex scans."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/vision",
      pricingUrl
    }
  ],
  organizer: [
    {
      id: "qwen-plus",
      label: { zh: "qwen-plus", en: "qwen-plus" },
      status: "recommended",
      fit: {
        zh: "推荐用于多数教材、制度、报告和普通文档整理。",
        en: "Recommended for most textbooks, policies, reports, and general documents."
      },
      impact: {
        zh: "质量和成本平衡，适合默认使用。",
        en: "Balances quality and cost, suitable as the default."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/qwen-api-reference/",
      pricingUrl
    },
    {
      id: "qwen-max",
      label: { zh: "qwen-max", en: "qwen-max" },
      status: "available",
      fit: {
        zh: "适合结构复杂、跨章节关系多、需要更强推理的资料。",
        en: "For complex structures, cross-chapter relations, and stronger reasoning needs."
      },
      impact: {
        zh: "整理质量更强，成本通常更高。",
        en: "Stronger organization quality with usually higher cost."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/qwen-api-reference/",
      pricingUrl
    },
    {
      id: "qwen-turbo",
      label: { zh: "qwen-turbo", en: "qwen-turbo" },
      status: "available",
      fit: {
        zh: "适合少量资料试跑、快速验证模板效果。",
        en: "For small trial runs and quick template validation."
      },
      impact: {
        zh: "成本更低，复杂教材整理质量可能不如推荐配置。",
        en: "Lower cost; complex textbook organization may be weaker than the recommended setup."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/qwen-api-reference/",
      pricingUrl
    }
  ],
  embedding: [
    {
      id: "text-embedding-v4",
      label: { zh: "text-embedding-v4", en: "text-embedding-v4" },
      status: "recommended",
      fit: {
        zh: "推荐用于纯文本教材、制度、报告和 RAG 知识库。",
        en: "Recommended for text-first textbooks, policies, reports, and RAG knowledge bases."
      },
      impact: {
        zh: "默认维度平衡质量和成本；索引会按它的输出维度准备。",
        en: "Default dimensions balance quality and cost; the index follows this model's output dimension."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/embedding-rerank-model/",
      batchSizeLimit: 10,
      pricingUrl
    },
    {
      id: "qwen3-vl-embedding",
      label: { zh: "qwen3-vl-embedding", en: "qwen3-vl-embedding" },
      status: "available",
      fit: {
        zh: "适合图文混合检索，保留图片、图表和文字的综合语义。",
        en: "For mixed image-text retrieval with combined semantics."
      },
      impact: {
        zh: "质量更适合多模态资料，索引和调用方式需要按多模态配置。",
        en: "Better for multimodal sources; index and calls must be configured for multimodal use."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/embedding-rerank-model/",
      batchSizeLimit: 20,
      pricingUrl
    },
    {
      id: "tongyi-embedding-vision-flash-2026-03-06",
      label: { zh: "通义视觉向量 Flash", en: "Tongyi vision embedding flash" },
      status: "available",
      fit: {
        zh: "适合低成本跨模态试跑和图片检索验证。",
        en: "For lower-cost cross-modal trial runs and image retrieval validation."
      },
      impact: {
        zh: "更适合试跑，复杂图文知识库可切换到质量更强的模型。",
        en: "Better for trials; switch to stronger models for complex image-text knowledge bases."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/embedding-rerank-model/",
      batchSizeLimit: 20,
      pricingUrl
    }
  ],
  rerank: [
    {
      id: "qwen3-rerank",
      label: { zh: "qwen3-rerank", en: "qwen3-rerank" },
      status: "recommended",
      fit: {
        zh: "推荐用于 K12 教材、制度、报告等文本知识库。",
        en: "Recommended for text knowledge bases such as K12 textbooks, policies, and reports."
      },
      impact: {
        zh: "向量召回后重新排序候选片段，提高问答命中；会增加少量延迟和模型调用费用。",
        en: "Reranks recalled chunks to improve answer hits; adds some latency and model-call cost."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/text-rerank-api",
      pricingUrl
    },
    {
      id: "qwen3-vl-rerank",
      label: { zh: "qwen3-vl-rerank", en: "qwen3-vl-rerank" },
      status: "available",
      fit: {
        zh: "适合图片、表格截图、扫描页也参与检索的知识库。",
        en: "For knowledge bases where images, table screenshots, or scanned pages take part in retrieval."
      },
      impact: {
        zh: "多模态重排质量更适配图文混合资料，接入方式可能不同于 OpenAI 兼容接口。",
        en: "Better for mixed image-text sources; access may differ from the OpenAI-compatible endpoint."
      },
      docUrl: "https://help.aliyun.com/zh/model-studio/rerank",
      pricingUrl
    }
  ]
};

const migrationTargets = {
  "gte-rerank": { slot: "rerank", to: "qwen3-rerank", reason: { zh: "旧重排模型不再作为推荐项。", en: "The old rerank model is no longer recommended." } },
  "gte-rerank-v2": { slot: "rerank", to: "qwen3-rerank", reason: { zh: "旧重排模型不再作为推荐项。", en: "The old rerank model is no longer recommended." } },
  "text-embedding-v3": { slot: "embedding", to: "text-embedding-v4", reason: { zh: "新建知识库推荐使用当前文本向量模型。", en: "New knowledge bases should use the current text embedding model." } }
};

export function getAliyunModelCatalog() {
  return cloneCatalog(catalog);
}

export function getAliyunModelSlots() {
  return aliyunModelSlots.map((slot) => ({ ...slot, label: { ...slot.label }, purpose: { ...slot.purpose } }));
}

export function findAliyunModel(slotKey, modelId) {
  return catalog[slotKey]?.find((item) => item.id === modelId) || null;
}

export function aliyunEmbeddingBatchLimit(model) {
  const normalized = String(model || "").trim().toLowerCase();
  const item = catalog.embedding.find((entry) => entry.id.toLowerCase() === normalized);
  if (Number.isFinite(item?.batchSizeLimit) && item.batchSizeLimit > 0) return item.batchSizeLimit;
  if (normalized === "text-embedding-v2") return 25;
  if (normalized.startsWith("text-embedding")) return 10;
  if (normalized.includes("embedding-vision") || normalized.includes("vl-embedding") || normalized.includes("multimodal-embedding")) return 20;
  return 10;
}
export function recommendedAliyunModel(slotKey) {
  return catalog[slotKey]?.find((item) => item.status === "recommended") || catalog[slotKey]?.[0] || null;
}

export async function refreshAliyunModelCatalog(current = {}, options = {}) {
  const docs = await fetchOfficialDocs(options.fetchImpl);
  const nextCatalog = cloneCatalog(catalog);
  const combinedDocs = docs.pages.join("\n");
  for (const items of Object.values(nextCatalog)) {
    for (const item of items) {
      item.verified = combinedDocs.includes(item.id);
    }
  }
  const migrations = collectMigrations(current);
  return {
    ok: true,
    source: docs.ok ? "official-docs" : "built-in",
    checkedAt: new Date().toISOString(),
    officialDocs: aliyunModelDocs,
    catalog: nextCatalog,
    migrations,
    message: docs.ok
      ? { zh: "已根据百炼官方文档刷新当前推荐模型。", en: "Refreshed current recommendations from Alibaba Cloud Model Studio docs." }
      : { zh: "暂时无法读取官方文档，已使用本地内置推荐列表。", en: "Official docs are unavailable; using the built-in recommendation list." }
  };
}

export function collectMigrations(current = {}) {
  const values = Object.entries(current || {});
  return values.flatMap(([draftKey, value]) => {
    const migration = migrationTargets[String(value || "")];
    if (!migration) return [];
    return [{
      field: draftKey,
      from: String(value),
      to: migration.to,
      slot: migration.slot,
      reason: { ...migration.reason }
    }];
  });
}

async function fetchOfficialDocs(fetchImpl) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== "function") return { ok: false, pages: [] };
  try {
    const pages = [];
    for (const url of aliyunModelDocs) {
      const response = await fetchWithTimeout(fetcher, url, 6000);
      if (!response?.ok && !(response?.status >= 200 && response?.status < 300)) return { ok: false, pages };
      pages.push(await response.text());
    }
    return { ok: true, pages };
  } catch {
    return { ok: false, pages: [] };
  }
}

async function fetchWithTimeout(fetcher, url, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetcher(url, controller ? { signal: controller.signal } : {});
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cloneCatalog(source) {
  return Object.fromEntries(
    Object.entries(source).map(([key, items]) => [
      key,
      items.map((item) => ({
        ...item,
        label: { ...item.label },
        fit: { ...item.fit },
        impact: { ...item.impact }
      }))
    ])
  );
}




