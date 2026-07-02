import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localExecutorPath = path.join(projectRoot, "src/local-service/local-executor.mjs");

const expectedBoundaries = [
  "source-archive.mjs",
  "parser-provider.mjs",
  "ocr-provider.mjs",
  "embedding-provider.mjs",
  "vector-writer.mjs",
  "build-version-publisher.mjs"
];

test("local executor delegates build stages through focused execution boundary modules", () => {
  const localExecutor = fs.readFileSync(localExecutorPath, "utf8");

  for (const file of expectedBoundaries) {
    const modulePath = path.join(projectRoot, "src/local-service/execution", file);
    assert.ok(fs.existsSync(modulePath), `${file} should exist under src/local-service/execution`);
    assert.match(localExecutor, new RegExp(`\\.\\/execution\\/${file.replace(".", "\\.")}`));
  }

  assert.doesNotMatch(localExecutor, /async function writeSourceArchive\(/);
  assert.doesNotMatch(localExecutor, /async function writeOcrRecognition\(/);
  assert.doesNotMatch(localExecutor, /async function writeSearchData\(/);
  assert.doesNotMatch(localExecutor, /async function writeKnowledgeBase\(/);
});

