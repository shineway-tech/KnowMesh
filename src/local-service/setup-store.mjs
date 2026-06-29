import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRetrievalProfile } from "../core/retrieval-strategy-catalog.mjs";
import { suggestVectorIndexName } from "./aliyun.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases, touchKnowledgeBase } from "./knowledge-bases.mjs";
import { catalogDatabasePath, nowIso, openCatalogDatabase, parseJson, stableJson, userDataRoot } from "./storage.mjs";

const credentialFile = "aliyun-credential.json";
const modelProviderFile = "aliyun-model-provider.json";
const envBlockStart = "# KNOWMESH_ALIYUN_BEGIN";
const envBlockEnd = "# KNOWMESH_ALIYUN_END";
const aliyunEnvironmentVariables = [
  "ALIBABA_CLOUD_ACCESS_KEY_ID",
  "ALIBABA_CLOUD_ACCESS_KEY_SECRET",
  "ALIYUN_OSS_ACCESS_KEY_ID",
  "ALIYUN_OSS_ACCESS_KEY_SECRET"
];

const modelQualityProfiles = {
  recommended: { zh: "推荐配置", en: "Recommended" },
  "high-quality": { zh: "高质量配置", en: "High quality" },
  "low-cost": { zh: "低成本配置", en: "Lower cost" }
};

const sensitiveDraftKeys = new Set([
  "aliyun.credential.accessKeySecret",
  "aliyun.credential.securityToken",
  "aliyun.model.apiKey"
]);

export function credentialPath(state) {
  return path.join(userDataRoot(state), "secrets", credentialFile);
}

export function modelProviderPath(state) {
  return path.join(userDataRoot(state), "secrets", modelProviderFile);
}

export function credentialLocations(state) {
  const secureLocal = credentialPath(state);
  const envFile = envPath(state);
  return {
    secureLocal,
    secureLocalDir: path.dirname(secureLocal),
    envFile,
    envFileDir: path.dirname(envFile),
    environmentVariables: [...aliyunEnvironmentVariables],
    security: credentialSecurityInfo()
  };
}

export function modelProviderLocations(state) {
  const secureLocal = modelProviderPath(state);
  return {
    secureLocal,
    secureLocalDir: path.dirname(secureLocal),
    security: credentialSecurityInfo()
  };
}

export function readSetupState(state) {
  const data = readSetupRecord(state);
  return {
    draft: sanitizeDraft(data.draft || {}),
    updatedAt: data.updatedAt || null,
    credential: summarizeCredential(state),
    modelProvider: summarizeModelProvider(state),
    modelQuality: summarizeModelQuality(state, data.draft || {}),
    retrievalStrategy: summarizeRetrievalStrategy(state, data.draft || {}),
    search: summarizeSearch(state, data.draft || {})
  };
}

export function saveSetupDraft(state, draft) {
  const current = readSetupRecord(state);
  const nextDraft = {
    ...(current.draft || {}),
    ...sanitizeDraft(draft || {})
  };
  const updatedAt = nowIso();
  writeSetupRecord(state, nextDraft, updatedAt);
  const knowledgeBasePatch = {};
  const displayName = String(nextDraft["project.name"] || nextDraft["project.title"] || "").trim();
  const template = String(nextDraft["project.template"] || nextDraft.template || "").trim();
  const mode = String(nextDraft["setup.mode"] || "").trim();
  const sourceRoot = String(nextDraft["project.source"] || "").trim();
  const workspaceRoot = String(nextDraft["project.workspace.base"] || nextDraft["project.workspace"] || "").trim();
  if (displayName) knowledgeBasePatch.name = displayName;
  if (template) knowledgeBasePatch.template = template;
  if (mode) knowledgeBasePatch.mode = mode;
  if (sourceRoot) knowledgeBasePatch.sourceRoot = sourceRoot;
  if (workspaceRoot) knowledgeBasePatch.workspaceRoot = workspaceRoot;
  knowledgeBasePatch.setupSummary = summarizeSetupDraft(nextDraft);
  if (Object.keys(knowledgeBasePatch).length) touchKnowledgeBase(state, knowledgeBasePatch);
  return readSetupState(state);
}

export async function saveAliyunCredentials(state, input = {}) {
  const accessKeyId = String(input.accessKeyId || "").trim();
  const accessKeySecret = String(input.accessKeySecret || "");
  const saveTarget = String(input.saveTarget || "secure-local");

  if (!accessKeyId) throw new Error("AccessKey ID is required.");
  if (!accessKeySecret) throw new Error("AccessKey Secret is required.");

  const protectedSecret = await protectSecret(accessKeySecret);
  const data = {
    provider: "aliyun",
    accessKeyId,
    saveTarget,
    secret: protectedSecret,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  writeJson(credentialPath(state), data, { mode: 0o600 });
  if (saveTarget === "env-file") writeManagedEnvBlock(state, accessKeyId, accessKeySecret);
  saveSetupDraft(state, {
    "aliyun.credential.accessKeyId": accessKeyId,
    "aliyun.credential.saveTarget": saveTarget,
    "aliyun.credential.accessKeySecret.configured": true
  });

  return summarizeCredential(state);
}

export async function readAliyunCredentials(state) {
  const envCredential = readEnvCredential(state);
  const file = credentialPath(state);

  if (fs.existsSync(file)) {
    const data = readJson(file, {});
    const secret = data.secret ? await unprotectSecret(data.secret) : "";
    return {
      accessKeyId: data.accessKeyId || envCredential.accessKeyId,
      accessKeySecret: secret || envCredential.accessKeySecret,
      saveTarget: data.saveTarget || "secure-local",
      source: data.saveTarget === "env-file" ? "env-file" : "secure-local"
    };
  }

  if (envCredential.accessKeyId && envCredential.accessKeySecret) {
    return {
      ...envCredential,
      saveTarget: "existing-env",
      source: "existing-env"
    };
  }

  return null;
}

export async function saveAliyunModelProvider(state, input = {}) {
  const provider = String(input.provider || "aliyun-bailian").trim();
  const protocol = String(input.protocol || "openai-compatible").trim();
  const region = String(input.region || "cn-beijing").trim();
  const workspaceId = String(input.workspaceId || "").trim();
  const baseUrl = String(input.baseUrl || "").trim();
  const apiKey = String(input.apiKey || "");

  if (!provider) throw new Error("Model provider is required.");
  if (!protocol) throw new Error("Model protocol is required.");
  if (!baseUrl) throw new Error("Model Base URL is required.");
  if (!apiKey) throw new Error("Model Studio API Key is required.");

  const protectedApiKey = await protectSecret(apiKey);
  const data = {
    provider,
    protocol,
    region,
    workspaceId,
    baseUrl,
    apiKey: protectedApiKey,
    apiKeyMask: maskSecret(apiKey),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  writeJson(modelProviderPath(state), data, { mode: 0o600 });
  saveSetupDraft(state, {
    "aliyun.model.provider": provider,
    "aliyun.model.protocol": protocol,
    "aliyun.model.region": region,
    "aliyun.model.workspaceId": workspaceId,
    "aliyun.model.baseUrl": baseUrl,
    "aliyun.model.apiKey.configured": true
  });

  return summarizeModelProvider(state);
}

export async function readAliyunModelProvider(state) {
  const file = modelProviderPath(state);
  if (!fs.existsSync(file)) return null;
  const data = readJson(file, {});
  const apiKey = data.apiKey ? await unprotectSecret(data.apiKey) : "";
  if (!apiKey) return null;
  return {
    provider: data.provider || "aliyun-bailian",
    protocol: data.protocol || "openai-compatible",
    region: data.region || "cn-beijing",
    workspaceId: data.workspaceId || "",
    baseUrl: data.baseUrl || "",
    apiKey,
    source: modelProviderPath(state)
  };
}

export function saveAliyunModelQuality(state, draft = {}) {
  const profile = String(draft["aliyun.services.profile"] || "recommended").trim();
  const modelQuality = {
    configured: true,
    profile,
    profileLabel: modelQualityProfiles[profile] || { zh: profile, en: profile },
    ocr: String(draft["aliyun.services.ocr"] || "qwen-vl-ocr-2025-11-20").trim(),
    organizer: String(draft["aliyun.services.organizer"] || "qwen-plus").trim(),
    embedding: String(draft["aliyun.services.embedding"] || "text-embedding-v4").trim(),
    rerank: String(draft["aliyun.services.rerank"] || "qwen3-rerank").trim(),
    updatedAt: new Date().toISOString()
  };

  saveSetupDraft(state, {
    "aliyun.services.profile": modelQuality.profile,
    "aliyun.services.ocr": modelQuality.ocr,
    "aliyun.services.organizer": modelQuality.organizer,
    "aliyun.services.embedding": modelQuality.embedding,
    "aliyun.services.rerank": modelQuality.rerank,
    "aliyun.services.modelQuality.configured": true,
    "aliyun.services.modelQuality.updatedAt": modelQuality.updatedAt
  });

  return modelQuality;
}

export function saveAliyunSearch(state, draft = {}) {
  const preparedDraft = prepareAliyunSearchDraft(state, draft);
  const search = {
    configured: true,
    action: String(preparedDraft["aliyun.search.action"] || "create").trim(),
    bucket: String(preparedDraft["aliyun.search.bucket"] || "").trim(),
    index: String(preparedDraft["aliyun.search.index"] || "").trim(),
    embedding: String(preparedDraft["aliyun.services.embedding"] || "text-embedding-v4").trim(),
    updatedAt: new Date().toISOString()
  };

  saveSetupDraft(state, {
    "aliyun.search.action": search.action,
    "aliyun.search.bucket": search.bucket,
    "aliyun.search.index": search.index,
    "aliyun.search.embedding": search.embedding,
    "aliyun.search.configured": true,
    "aliyun.search.updatedAt": search.updatedAt
  });

  return search;
}

export function prepareAliyunSearchDraft(state, draft = {}) {
  const prepared = { ...draft };
  const rawIndex = String(prepared["aliyun.search.index"] || "").trim();
  prepared["aliyun.search.index"] = rawIndex
    ? suggestVectorIndexName(rawIndex)
    : defaultAliyunSearchIndexName(state);
  return prepared;
}

function defaultAliyunSearchIndexName(state) {
  const current = listKnowledgeBases(state).current;
  return suggestVectorIndexName(current?.id || current?.name || "index1");
}

export function saveRetrievalStrategy(state, draft = {}) {
  const profile = getRetrievalProfile(String(draft["retrieval.profile"] || ""));
  const retrievalStrategy = {
    configured: true,
    profile: profile.id,
    profileLabel: profile.label,
    methods: profile.methods,
    config: profile.config,
    updatedAt: new Date().toISOString()
  };

  saveSetupDraft(state, {
    "retrieval.profile": retrievalStrategy.profile,
    "retrieval.strategy.configured": true,
    "retrieval.strategy.updatedAt": retrievalStrategy.updatedAt
  });

  return retrievalStrategy;
}

export function clearAliyunModelProvider(state) {
  removeFile(modelProviderPath(state));
  const current = readSetupRecord(state);
  const draft = { ...(current.draft || {}) };
  delete draft["aliyun.model.apiKey.configured"];
  writeSetupRecord(state, sanitizeDraft(draft), nowIso());
  return readSetupState(state);
}

export function readAliyunEnvironmentCredentials(state) {
  const envCredential = readEnvCredential(state);
  if (!envCredential.accessKeyId || !envCredential.accessKeySecret) return null;
  return {
    ...envCredential,
    saveTarget: "existing-env"
  };
}

export function clearAliyunCredentials(state) {
  removeFile(credentialPath(state));
  removeManagedEnvBlock(state);
  const current = readSetupRecord(state);
  const draft = { ...(current.draft || {}) };
  delete draft["aliyun.credential.accessKeySecret.configured"];
  writeSetupRecord(state, sanitizeDraft(draft), nowIso());
  return readSetupState(state);
}

export function maskAccessKeyId(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}****`;
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function summarizeCredential(state) {
  const file = credentialPath(state);
  const envCredential = readEnvCredential(state);
  const locations = credentialLocations(state);
  if (fs.existsSync(file)) {
    const data = readJson(file, {});
    return {
      configured: Boolean(data.accessKeyId && data.secret),
      accessKeyId: maskAccessKeyId(data.accessKeyId),
      saveTarget: data.saveTarget || "secure-local",
      source: data.saveTarget === "env-file" ? envPath(state) : credentialPath(state),
      updatedAt: data.updatedAt || data.createdAt || null,
      locations
    };
  }
  if (envCredential.accessKeyId && envCredential.accessKeySecret) {
    return {
      configured: true,
      accessKeyId: maskAccessKeyId(envCredential.accessKeyId),
      saveTarget: "existing-env",
      source: envCredential.source,
      updatedAt: null,
      locations
    };
  }
  return {
    configured: false,
    accessKeyId: "",
    saveTarget: "",
    source: "",
    updatedAt: null,
    locations
  };
}

function summarizeModelProvider(state) {
  const file = modelProviderPath(state);
  const locations = modelProviderLocations(state);
  if (!fs.existsSync(file)) {
    return {
      configured: false,
      provider: "",
      protocol: "",
      region: "",
      workspaceId: "",
      baseUrl: "",
      apiKey: "",
      source: "",
      updatedAt: null,
      locations
    };
  }
  const data = readJson(file, {});
  return {
    configured: Boolean(data.provider && data.baseUrl && data.apiKey),
    provider: data.provider || "aliyun-bailian",
    protocol: data.protocol || "openai-compatible",
    region: data.region || "cn-beijing",
    workspaceId: data.workspaceId || "",
    baseUrl: data.baseUrl || "",
    apiKey: data.apiKeyMask || (data.apiKey?.method === "plain" ? maskSecret(data.apiKey?.value || "") : "****"),
    source: file,
    updatedAt: data.updatedAt || data.createdAt || null,
    locations
  };
}

function summarizeModelQuality(state, draft) {
  const configured = draft["aliyun.services.modelQuality.configured"] === true;
  const profile = String(draft["aliyun.services.profile"] || "recommended");
  return {
    configured,
    profile: configured ? profile : "",
    profileLabel: configured ? (modelQualityProfiles[profile] || { zh: profile, en: profile }) : { zh: "", en: "" },
    ocr: configured ? String(draft["aliyun.services.ocr"] || "") : "",
    organizer: configured ? String(draft["aliyun.services.organizer"] || "") : "",
    embedding: configured ? String(draft["aliyun.services.embedding"] || "") : "",
    rerank: configured ? String(draft["aliyun.services.rerank"] || "") : "",
    updatedAt: configured ? draft["aliyun.services.modelQuality.updatedAt"] || null : null,
    source: configured ? catalogDatabasePath(state, currentKnowledgeBaseId(state)) : ""
  };
}

function summarizeSearch(state, draft) {
  const configured = draft["aliyun.search.configured"] === true;
  return {
    configured,
    action: configured ? String(draft["aliyun.search.action"] || "create") : "",
    bucket: configured ? String(draft["aliyun.search.bucket"] || "") : "",
    index: configured ? String(draft["aliyun.search.index"] || "") : "",
    embedding: configured ? String(draft["aliyun.search.embedding"] || draft["aliyun.services.embedding"] || "") : "",
    updatedAt: configured ? draft["aliyun.search.updatedAt"] || null : null,
    source: configured ? catalogDatabasePath(state, currentKnowledgeBaseId(state)) : ""
  };
}

function summarizeRetrievalStrategy(state, draft) {
  const configured = draft["retrieval.strategy.configured"] === true;
  const profile = getRetrievalProfile(String(draft["retrieval.profile"] || ""));
  return {
    configured,
    profile: configured ? profile.id : "",
    profileLabel: configured ? profile.label : { zh: "", en: "" },
    methods: configured ? profile.methods : [],
    config: configured ? profile.config : {},
    updatedAt: configured ? draft["retrieval.strategy.updatedAt"] || null : null,
    source: configured ? catalogDatabasePath(state, currentKnowledgeBaseId(state)) : ""
  };
}

function maskSecret(value) {
  const text = String(value || "");
  if (!text) return "****";
  if (text.length <= 8) return "****";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function sanitizeDraft(draft) {
  const output = {};
  for (const [key, value] of Object.entries(draft || {})) {
    if (sensitiveDraftKeys.has(key)) continue;
    if (Array.isArray(value)) {
      output[key] = value
        .map((item) => (typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? String(item) : ""))
        .filter(Boolean);
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output[key] = value;
    }
  }
  return output;
}

function envPath(state) {
  return path.join(state.projectRoot, ".env");
}

function readSetupRecord(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return { draft: {}, updatedAt: null };
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const row = db.prepare("SELECT draft_json, updated_at FROM setup_state WHERE id = 1").get();
    return {
      draft: sanitizeDraft(parseJson(row?.draft_json, {})),
      updatedAt: row?.updated_at || null
    };
  } finally {
    db.close();
  }
}

function writeSetupRecord(state, draft, updatedAt) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    db.prepare(`
      INSERT INTO setup_state (id, draft_json, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at
    `).run(stableJson(sanitizeDraft(draft)), updatedAt || nowIso());
  } finally {
    db.close();
  }
}

function summarizeSetupDraft(draft = {}) {
  return {
    configured: Object.keys(draft || {}).length > 0,
    mode: String(draft["setup.mode"] || ""),
    template: String(draft["project.template"] || draft.template || ""),
    sourceRoot: String(draft["project.source"] || ""),
    workspaceRoot: String(draft["project.workspace.base"] || draft["project.workspace"] || "")
  };
}

function credentialSecurityInfo() {
  if (process.platform === "win32") {
    return {
      method: "windows-dpapi",
      label: { zh: "Windows 用户加密", en: "Windows user encryption" }
    };
  }
  return {
    method: "file-permissions",
    label: { zh: "本机文件权限保护", en: "Local file-permission protection" }
  };
}

function readEnvCredential(state) {
  const fileValues = readEnvFile(envPath(state));
  const accessKeyId =
    process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ||
    process.env.ALIYUN_OSS_ACCESS_KEY_ID ||
    fileValues.ALIBABA_CLOUD_ACCESS_KEY_ID ||
    fileValues.ALIYUN_OSS_ACCESS_KEY_ID ||
    "";
  const accessKeySecret =
    process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET ||
    fileValues.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
    fileValues.ALIYUN_OSS_ACCESS_KEY_SECRET ||
    "";

  return {
    accessKeyId,
    accessKeySecret,
    source: accessKeyId && process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ? "environment" : envPath(state)
  };
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    values[match[1].trim()] = unquote(match[2].trim());
  }
  return values;
}

function writeManagedEnvBlock(state, accessKeyId, accessKeySecret) {
  const file = envPath(state);
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const block = [
    envBlockStart,
    `ALIBABA_CLOUD_ACCESS_KEY_ID=${quoteEnv(accessKeyId)}`,
    `ALIBABA_CLOUD_ACCESS_KEY_SECRET=${quoteEnv(accessKeySecret)}`,
    `ALIYUN_OSS_ACCESS_KEY_ID=${quoteEnv(accessKeyId)}`,
    `ALIYUN_OSS_ACCESS_KEY_SECRET=${quoteEnv(accessKeySecret)}`,
    envBlockEnd
  ].join(os.EOL);
  const withoutBlock = stripManagedEnvBlock(current).trimEnd();
  const next = `${withoutBlock ? `${withoutBlock}${os.EOL}${os.EOL}` : ""}${block}${os.EOL}`;
  fs.writeFileSync(file, next, { encoding: "utf8", mode: 0o600 });
}

function removeManagedEnvBlock(state) {
  const file = envPath(state);
  if (!fs.existsSync(file)) return;
  const next = stripManagedEnvBlock(fs.readFileSync(file, "utf8")).trimEnd();
  fs.writeFileSync(file, next ? `${next}${os.EOL}` : "", "utf8");
}

function stripManagedEnvBlock(value) {
  const lines = String(value || "").split(/\r?\n/);
  const kept = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.trim() === envBlockStart) {
      inBlock = true;
      continue;
    }
    if (line.trim() === envBlockEnd) {
      inBlock = false;
      continue;
    }
    if (!inBlock) kept.push(line);
  }
  return kept.join(os.EOL);
}

function quoteEnv(value) {
  return JSON.stringify(String(value));
}

function unquote(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

async function protectSecret(value) {
  if (process.platform !== "win32") return { method: "plain", value };
  const encrypted = await runPowerShell(
    "Add-Type -AssemblyName System.Security; $raw = [Console]::In.ReadToEnd(); $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw); $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($protected)",
    value
  );
  return { method: "windows-dpapi", value: encrypted.trim() };
}

async function unprotectSecret(secret) {
  if (!secret || typeof secret !== "object") return "";
  if (secret.method === "plain") return String(secret.value || "");
  if (secret.method !== "windows-dpapi") return "";
  if (process.platform !== "win32") throw new Error("This credential can only be opened by the Windows user who saved it.");
  const command = "Add-Type -AssemblyName System.Security; $raw = [Console]::In.ReadToEnd(); $protected = [Convert]::FromBase64String($raw); $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); [System.Text.Encoding]::UTF8.GetString($bytes)";
  return (await runPowerShell(command, secret.value)).trim();
}

function runPowerShell(command, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
    });
    child.stdin.end(stdin);
  });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data, options = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: "utf8",
    mode: options.mode
  });
}

function removeFile(file) {
  try {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    // Clearing credentials should be best-effort and reported through state.
  }
}
