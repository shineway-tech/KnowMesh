#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const integrationPrivacyAuditRoots = [
  "docs/integrations.zh-CN.md",
  "docs/integrations.en.md",
  "examples/integrations",
  "src/sdk/knowmesh-client.mjs"
];

const textExtensions = new Set([".md", ".mjs", ".http", ".json"]);
const allowContextPattern = /do not|don't|never|no direct|not read|not log|not expose|not treat|forbidden|internal state|integration boundary|state authority|stateAuthority|privacy|redact|redacted|mask|exclude|不要|不读取|不记录|不暴露|不把|不能|默认不|禁止|边界|内部状态|状态权威|脱敏|排除/i;

const rules = [
  {
    key: "sqliteDirectRead",
    description: "Integration recipes must not read workspace.sqlite or catalog.sqlite directly.",
    pattern: /(workspace\.sqlite|catalog\.sqlite).*(better-sqlite3|sqlite3|new\s+Database|readFileSync|createReadStream|open\s*\()|(better-sqlite3|sqlite3|new\s+Database|readFileSync|createReadStream|open\s*\().*(workspace\.sqlite|catalog\.sqlite)/i,
    allowContext: true
  },
  {
    key: "sqliteAuthorityMention",
    description: "SQLite files may only be mentioned as internal state authority or forbidden direct reads.",
    pattern: /workspace\.sqlite|catalog\.sqlite/i,
    allowContext: true
  },
  {
    key: "internalAssetRead",
    description: "Integration recipes must not read artifacts, sidecars, or browser storage as APIs.",
    pattern: /(readFileSync|createReadStream|fs\.|path\.join|localStorage|sessionStorage|indexedDB|getItem).*(artifact|artifacts|sidecar|browser storage|localStorage|sessionStorage|indexedDB)|(artifact|artifacts|sidecar|browser storage|localStorage|sessionStorage|indexedDB).*(readFileSync|createReadStream|fs\.|path\.join|localStorage|sessionStorage|indexedDB|getItem)/i,
    allowContext: true
  },
  {
    key: "credentialLogging",
    description: "Integration recipes must not log credentials or raw provider responses.",
    pattern: /(console\.(log|warn|error)|logger\.(info|warn|error|debug)).*(apiKey|accessKey|AccessKey|secret|token|Bearer|sk-[A-Za-z0-9]|rawProvider|providerResponse)|(rawProviderResponses|sourceContent|documentText)\s*:/i,
    allowContext: true
  },
  {
    key: "localAbsolutePath",
    description: "Docs, examples, and fixtures must not expose local absolute paths.",
    pattern: /[A-Z]:\\[A-Za-z0-9_. -]+|\/Users\/[A-Za-z0-9_.-]+|\\Users\\[A-Za-z0-9_.-]+/i,
    allowContext: false
  },
  {
    key: "broadCors",
    description: "Integration docs must not instruct broad CORS or remote binding by default.",
    pattern: /Access-Control-Allow-Origin\s*:\s*\*|cors[^.\n]*\*|0\.0\.0\.0/i,
    allowContext: true
  },
  {
    key: "privateContent",
    description: "Integration assets must not include private document text or private textbook material.",
    pattern: /private textbook|真实教材|source text|document text|sourceContent|documentText|rawProviderResponses/i,
    allowContext: true
  }
];

export function evaluateIntegrationPrivacy(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const files = options.files || readAuditFiles(projectRoot, options.paths || integrationPrivacyAuditRoots);
  const findings = [];
  for (const file of files) {
    findings.push(...scanFile(file));
  }
  const checks = rules.map((rule) => {
    const count = findings.filter((finding) => finding.rule === rule.key).length;
    return {
      key: rule.key,
      status: count === 0 ? "pass" : "fail",
      message: count === 0 ? rule.description : `${count} finding(s): ${rule.description}`
    };
  });
  return {
    ok: findings.length === 0,
    kind: "knowmesh.integrationPrivacyAudit",
    scanned: files.map((file) => file.path).sort(),
    summary: {
      files: files.length,
      findings: findings.length
    },
    checks,
    findings
  };
}

export function scanFile(file) {
  const lines = String(file.content || "").split(/\r?\n/);
  const findings = [];
  for (const [index, line] of lines.entries()) {
    const context = [
      lines[index - 1] || "",
      line,
      lines[index + 1] || ""
    ].join(" ");
    for (const rule of rules) {
      if (!rule.pattern.test(line)) continue;
      if (rule.allowContext && allowContextPattern.test(context)) continue;
      findings.push({
        file: file.path,
        line: index + 1,
        rule: rule.key,
        message: rule.description,
        excerpt: trimExcerpt(line)
      });
    }
  }
  return findings;
}

function readAuditFiles(projectRoot, roots) {
  const files = [];
  for (const root of roots) {
    const absolute = path.resolve(projectRoot, root);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      for (const file of walkFiles(absolute)) {
        if (!textExtensions.has(path.extname(file))) continue;
        files.push({
          path: normalizePath(path.relative(projectRoot, file)),
          content: fs.readFileSync(file, "utf8")
        });
      }
    } else if (textExtensions.has(path.extname(absolute))) {
      files.push({
        path: normalizePath(path.relative(projectRoot, absolute)),
        content: fs.readFileSync(absolute, "utf8")
      });
    }
  }
  return files;
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files;
}

function trimExcerpt(line) {
  return String(line || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateIntegrationPrivacy();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
