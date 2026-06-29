import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";

export async function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const config = parse(raw);
  if (!config || typeof config !== "object") {
    throw new Error(`Config file is empty or invalid: ${configPath}`);
  }

  return { config, configPath };
}

export function resolveEnv(value, options = {}) {
  const missing = options.missing || "empty";
  if (Array.isArray(value)) return value.map((item) => resolveEnv(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveEnv(item, options)]));
  }
  if (typeof value !== "string") return value;

  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (token, key) => {
    if (process.env[key] !== undefined) return process.env[key];
    return missing === "preserve" ? token : "";
  });
}

export function redact(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, redact(item, childKey)]));
  }
  if (/KEY|SECRET|TOKEN|PASSWORD/i.test(key) && value) return "[redacted]";
  return value;
}

export function resolveConfigPath(value, configPath) {
  if (!value) return "";
  const expanded = String(value).replace(/\\/g, "/");
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(path.dirname(configPath), expanded);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonFile(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
