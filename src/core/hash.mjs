import crypto from "node:crypto";
import fs from "node:fs";

export function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value) {
  return sha256Text(JSON.stringify(value));
}

export function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function stableId(prefix, ...parts) {
  return `${prefix}_${sha256Text(parts.join("\n")).slice(0, 16)}`;
}
