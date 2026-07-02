import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("publication decision checklist is linked from final review and docs indexes", () => {
  const zh = read("docs/publication-decision-checklist.zh-CN.md");
  const en = read("docs/publication-decision-checklist.en.md");
  const finalZh = read("docs/final-publication-review.zh-CN.md");
  const finalEn = read("docs/final-publication-review.en.md");
  const docsZh = read("docs/README.md");
  const docsEn = read("docs/README.en.md");
  const releaseOpsZh = read("docs/release-operations.zh-CN.md");
  const releaseOpsEn = read("docs/release-operations.en.md");

  assert.match(zh, /Publication Decision Checklist \/ 发布决策清单/);
  assert.match(en, /Publication Decision Checklist/);

  for (const content of [finalZh, finalEn, docsZh, docsEn, releaseOpsZh, releaseOpsEn]) {
    assert.match(content, /publication-decision-checklist\.(zh-CN|en)\.md/);
  }
});

test("publication decision checklist separates evidence refresh, read-only checks, and human side effects", () => {
  const combined = `${read("docs/publication-decision-checklist.zh-CN.md")}\n${read("docs/publication-decision-checklist.en.md")}`;

  for (const marker of [
    "releaseAllowed=false",
    "publicationDecision=human-review-required",
    "npmPublication=separate-decision",
    "npm run generate:final-publication",
    "gh repo view shineway-tech/KnowMesh",
    "gh repo edit shineway-tech/KnowMesh --visibility public --accept-visibility-change-consequences",
    "gh release create v0.1.0",
    "npm publish --dry-run",
    "npm publish --tag alpha"
  ]) {
    assert.match(combined, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("publication decision checklist defines rollback ownership and Block AA handoff", () => {
  const zh = read("docs/publication-decision-checklist.zh-CN.md");
  const en = read("docs/publication-decision-checklist.en.md");

  assert.match(zh, /Rollback owner|回滚/);
  assert.match(zh, /前 72 小时/);
  assert.match(zh, /Block AA Round AA1/);
  assert.match(zh, /不能用模拟结果代替发布后监控/);

  assert.match(en, /Rollback owner/);
  assert.match(en, /first 72 hours/);
  assert.match(en, /Block AA Round AA1/);
  assert.match(en, /Do not use simulated publication as monitoring success/);
});
