import fs from "node:fs";
import path from "node:path";

import { readAliyunModelProvider } from "../setup-store.mjs";

export function aliyunModelStudioProviderDescriptor({ configured = false } = {}) {
  return {
    id: "aliyun-model-studio",
    type: "cloud-model",
    configured,
    status: configured ? "pass" : "setupRequired",
    label: {
      zh: "阿里百炼模型服务",
      en: "Alibaba Cloud Model Studio"
    },
    message: configured
      ? {
          zh: "模型连接与模型方案已配置。",
          en: "Model connection and model profile are configured."
        }
      : {
          zh: "需要配置模型连接并保存模型方案。",
          en: "Configure the model connection and save the model profile."
        },
    capabilities: [
      capability("documentOcr", "OCR / 文档识别", "OCR / document recognition", ["chat/completions"]),
      capability("contentOrganization", "内容整理", "Content organization", ["chat/completions"]),
      capability("embedding", "向量化", "Embedding", ["embeddings"]),
      capability("rerank", "重排", "Rerank", ["rerank"]),
      capability("chatAnswer", "回答生成", "Answer generation", ["chat/completions"])
    ],
    setupRequirements: [
      requirement("modelProvider", "保存并测试百炼模型连接", "Save and test the Model Studio connection", true),
      requirement("modelQuality", "保存 OCR、整理、向量化和重排模型方案", "Save OCR, organization, embedding, and rerank model profile", true)
    ],
    privacyBoundary: privacy({ dataLeavesDevice: true, storesSource: false, storesVectors: false }),
    cost: cost(["model_calls", "input_tokens", "output_tokens", "ocr_pages"]),
    batch: batch({ supported: true, mode: "provider-batch-first", fallback: "split-and-retry" }),
    retry: retry({ transientOnly: true, checkpointed: true }),
    permissions: ["dashscope:Generation", "dashscope:Embeddings", "dashscope:MultiModalConversation"],
    userFixableErrors: [
      fix("modelCredentialMissing", "在模型服务页保存百炼 API Key。", "Save the Model Studio API Key in the model service step."),
      fix("modelNotFound", "检查所选模型是否在当前地域和账号可用。", "Check whether the selected model is available in the chosen region and account."),
      fix("permissionDenied", "给 KnowMesh 专用 RAM 用户补充 DashScope/百炼调用权限。", "Grant DashScope/Model Studio permissions to the dedicated KnowMesh RAM user.")
    ]
  };
}

export function createAliyunModelStudioAdapter(state = {}, options = {}) {
  const fetchImpl = options.fetchImpl || state.fetchImpl || globalThis.fetch;
  const retry = options.retry || defaultRetryPolicy();
  return {
    id: "aliyun-model-studio",
    async runtimeInfo() {
      const modelProvider = await readAliyunModelProvider(state);
      if (modelProvider?.provider && modelProvider?.protocol === "openai-compatible") {
        return {
          available: Boolean(modelProvider.apiKey),
          provider: modelProvider.provider,
          protocol: modelProvider.protocol,
          retry
        };
      }
      return { available: false, provider: "", protocol: "", retry };
    },
    async recognizeOcrBatch(request) {
      const modelProvider = await readAliyunModelProvider(state);
      if (!modelProvider?.apiKey || modelProvider.protocol !== "openai-compatible") return null;
      if (!request.model) throw new Error("还没有选择 OCR 模型，请先回到模型与质量方案确认。");
      assertFetch(fetchImpl, "OCR");
      const endpoint = joinUrl(modelProvider.baseUrl, "chat/completions");
      const concurrency = request.batchPolicy?.concurrency ?? clampInteger(state.ocrConcurrency ?? process.env.KNOWMESH_OCR_CONCURRENCY ?? 8, 1, 12);
      return mapWithConcurrency(request.items, concurrency, async (item) => {
        try {
          return await retryExternalProviderCall(async () => {
            const response = await fetchWithTimeout(fetchImpl, endpoint, {
              method: "POST",
              headers: {
                authorization: `Bearer ${modelProvider.apiKey}`,
                "content-type": "application/json",
                accept: "application/json"
              },
              body: JSON.stringify(buildOcrChatPayload(request, item))
            }, state.ocrTimeoutMs || state.cloudTimeoutMs || 120000);
            const text = await safeResponseText(response);
            if (!response.ok) throw providerHttpError("模型服务", response.status, text);
            const data = parseJsonObject(text);
            const content = extractOcrResponseText(data);
            return {
              taskId: item.taskId,
              status: content ? "recognized" : "failed",
              text: content,
              confidence: null,
              usage: data.usage || null,
              providerMessage: content ? "" : "模型服务没有返回 OCR 文本。"
            };
          }, retry);
        } catch (error) {
          return {
            taskId: item.taskId,
            status: "failed",
            text: "",
            confidence: null,
            usage: null,
            providerMessage: safeProviderMessage(error)
          };
        }
      });
    },
    async generateEmbeddingBatch(request) {
      const modelProvider = await readAliyunModelProvider(state);
      if (!modelProvider?.apiKey || modelProvider.protocol !== "openai-compatible") return null;
      assertFetch(fetchImpl, "向量化");
      const endpoint = joinUrl(modelProvider.baseUrl, "embeddings");
      const payload = {
        model: request.model,
        input: request.items.map((item) => String(item.text || ""))
      };
      const data = await retryExternalProviderCall(async () => {
        const response = await fetchWithTimeout(fetchImpl, endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${modelProvider.apiKey}`,
            "content-type": "application/json",
            accept: "application/json"
          },
          body: JSON.stringify(payload)
        }, state.embeddingTimeoutMs || state.cloudTimeoutMs || 60000);
        const text = await safeResponseText(response);
        if (!response.ok) throw providerHttpError("模型服务", response.status, text);
        return parseJsonObject(text);
      }, retry);
      const rows = Array.isArray(data.data) ? data.data : [];
      const byIndex = new Map(rows.map((row, index) => [Number.isInteger(row?.index) ? row.index : index, row]));
      return request.items.map((item, index) => {
        const row = byIndex.get(index) || rows[index] || {};
        return {
          chunkId: item.chunk_id,
          status: Array.isArray(row.embedding) ? "embedded" : "failed",
          embedding: Array.isArray(row.embedding) ? row.embedding : null,
          usage: data.usage || null,
          providerMessage: Array.isArray(row.embedding) ? "" : "模型服务没有返回对应的向量结果。"
        };
      });
    }
  };
}

export function providerHttpError(label, status, text) {
  const data = parseJsonObject(text);
  const message = data?.error?.message || data?.message || data?.Message || text || `${label}请求失败。`;
  const error = new Error(`${label}返回 ${status}: ${message}`);
  error.status = status;
  error.retryable = isRetryableStatus(status);
  error.providerBody = text;
  error.providerMessage = message;
  return error;
}

export function isRetryableStatus(status) {
  const code = Number(status);
  return code === 408 || code === 429 || (code >= 500 && code <= 599);
}

export function isBatchSizeInvalidError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status !== 400) return false;
  const text = String(error.providerMessage || error.providerBody || error.message || "");
  return /batch\s*size/i.test(text) && /(invalid|larger than|too large|input\.contents)/i.test(text);
}

export async function retryExternalProviderCall(operation, policy = defaultRetryPolicy()) {
  let lastError = null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts || !isRetryableProviderError(error)) throw error;
      await sleep(retryDelayMs(policy, attempt));
    }
  }
  throw lastError || new Error("外部供应商调用失败。");
}

export function isRetryableProviderError(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return false;
}

function buildOcrChatPayload(request, item) {
  return {
    model: request.model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: imageDataUrlForTask(item) },
            min_pixels: 32 * 32 * 3,
            max_pixels: 32 * 32 * 8192
          },
          {
            type: "text",
            text: ocrPromptForTask(request)
          }
        ]
      }
    ]
  };
}

function imageDataUrlForTask(item) {
  const filePath = item.inputPath || "";
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`OCR 输入文件不存在：${item.relativePath || item.taskId}`);
  const bytes = fs.readFileSync(filePath);
  const maxBytes = 25 * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error(`OCR 输入图片过大，请降低 PDF 拆页清晰度或拆分资料：${item.relativePath || item.taskId}`);
  return `data:${mimeTypeForImagePath(filePath)};base64,${bytes.toString("base64")}`;
}

function mimeTypeForImagePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function ocrPromptForTask(request) {
  const isK12 = request.template?.id === "textbook-cn-k12" || request.template?.expertName === "KnowMesh Expert · K12";
  if (isK12) {
    return [
      "请只输出这页教材中真实可见的内容。",
      "保留章节标题、知识点、例题、题号、选项、答案解析、表格、公式和图文对应关系。",
      "过滤页眉、页脚、水印、下载站提示、网址、重复页码和无关装饰。",
      "公式尽量用 LaTeX 或结构化文本表达，无法确认的字符用 [?] 标记。",
      "不要补写图片中没有的内容，也不要总结。"
    ].join("\n");
  }
  return [
    "请只输出图片中真实可见的文字内容。",
    "保留标题、段落、列表、表格和公式结构。",
    "过滤页眉、页脚、水印、网址和重复页码等噪声。",
    "无法确认的字符用 [?] 标记，不要编造或总结。"
  ].join("\n");
}

function extractOcrResponseText(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content ?? data?.output_text ?? data?.text ?? "";
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return String(content || "").trim();
}

function assertFetch(fetchImpl, stage) {
  if (typeof fetchImpl !== "function") throw new Error(`当前运行环境没有可用的网络请求能力，不能调用${stage}模型。`);
}

function safeProviderMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function capability(key, zh, en, operations) {
  return { key, label: { zh, en }, operations };
}

function requirement(key, zh, en, required) {
  return { key, required, label: { zh, en } };
}

function fix(key, zh, en) {
  return { key, message: { zh, en } };
}

function privacy(values) {
  return { redacted: true, ...values };
}

function cost(units) {
  return {
    units,
    estimateTiming: {
      zh: "正式执行前按页数、片段数或调用规模展示风险。",
      en: "Risk is shown before execution based on pages, chunks, or call scale."
    }
  };
}

function batch(values) {
  return values;
}

function retry(values) {
  return {
    networkOnly: true,
    ...values
  };
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs = 10000) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  return fetchImpl(url, { ...options, ...(controller ? { signal: controller.signal } : {}) })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
    });
}

async function safeResponseText(response) {
  if (typeof response?.text === "function") return response.text();
  if (typeof response?.json === "function") return JSON.stringify(await response.json());
  return "";
}

function parseJsonObject(text) {
  try {
    const data = JSON.parse(text || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function joinUrl(baseUrl, segment) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(segment || "").replace(/^\/+/, "")}`;
}

function defaultRetryPolicy() {
  return { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 5000 };
}

function retryDelayMs(policy, attempt) {
  if (!policy.baseDelayMs) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runWorker));
  return results;
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.trunc(number), max));
}
