import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

test("community backlog gives labels and safe contributor lanes", () => {
  const zh = read("docs/community-backlog.zh-CN.md");
  const en = read("docs/community-backlog.en.md");
  const goodFirstZh = read("docs/good-first-issues.zh-CN.md");
  const goodFirstEn = read("docs/good-first-issues.en.md");

  for (const content of [zh, en, goodFirstZh, goodFirstEn]) {
    assert.match(content, /good first issue/);
    assert.match(content, /help wanted/);
    assert.match(content, /area:expert/);
    assert.match(content, /area:provider/);
    assert.match(content, /area:integration/);
    assert.match(content, /sample request|样例请求/i);
    assert.match(content, /no private|不要提交私有|无私有/i);
  }
});

test("community issue templates cover expert provider and sample requests", () => {
  const templates = [
    ".github/ISSUE_TEMPLATE/expert_request.yml",
    ".github/ISSUE_TEMPLATE/provider_adapter.yml",
    ".github/ISSUE_TEMPLATE/sample_request.yml"
  ];
  for (const file of templates) {
    assert.equal(exists(file), true, `${file} should exist`);
    const content = read(file);
    assert.match(content, /labels:/);
    assert.match(content, /current-design|Current Design|当前设计/i);
    assert.match(content, /public sample|公开样例|no private/i);
  }
});

test("release operations checklist maps local github and npm evidence", () => {
  const zh = read("docs/release-operations.zh-CN.md");
  const en = read("docs/release-operations.en.md");

  for (const content of [zh, en]) {
    assert.match(content, /npm test/);
    assert.match(content, /smoke:release/);
    assert.match(content, /smoke:artifact/);
    assert.match(content, /verify:package-boundary/);
    assert.match(content, /githubCi/);
    assert.match(content, /githubCodeql/);
    assert.match(content, /githubScorecard/);
    assert.match(content, /npmPublication.*separate-decision|npm 发布.*单独决策/i);
    assert.match(content, /release-gate/);
  }
});

test("roadmap exposes adoption extension and integration milestones", () => {
  const zh = read("ROADMAP.md");
  const en = read("ROADMAP.en.md");

  for (const content of [zh, en]) {
    assert.match(content, /Adoption Loop|采用闭环/i);
    assert.match(content, /Extension Foundation|扩展基础/i);
    assert.match(content, /Expert SDK/);
    assert.match(content, /Provider Adapters/);
    assert.match(content, /Integration SDK|集成示例/i);
  }
});
