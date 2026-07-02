import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

function git(args) {
  return execFileSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

test("public README gives a complete launch-candidate story in Chinese and English", () => {
  const zh = read("README.md");
  const en = read("README.en.md");

  for (const content of [zh, en]) {
    assert.match(content, /Knowledge Asset Compiler|知识资产/);
    assert.match(content, /local-first|本地优先/i);
    assert.match(content, /auditable|可审计/i);
    assert.match(content, /traceable citations|可追溯/);
    assert.match(content, /SQLite|catalog\.sqlite|workspace\.sqlite/);
    assert.match(content, /Query Runtime/);
    assert.match(content, /0\.1\.0-alpha|alpha/i);
    assert.match(content, /K12/);
    assert.match(content, /Public Launch Candidate|公开发布候选|launch candidate/i);
    assert.match(content, /examples\/public-samples/);
    assert.match(content, /assets\/social\/knowmesh-social-preview\.png/);
    assert.match(content, /GitHub topics|Repository topics|仓库 Topics|GitHub Topics/i);
  }

  assert.match(zh, /\[English\]\(README\.en\.md\)/);
  assert.match(en, /\[中文\]\(README\.md\)/);
});

test("public sample and governance files are present and discoverable", () => {
  const requiredFiles = [
    "examples/public-samples/README.md",
    "examples/public-samples/general-docs/source/operations-handbook.md",
    "examples/public-samples/operations-handbook/source/incident-operations-handbook.md",
    "examples/public-samples/k12-synthetic/source/math-grade5-unit3.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/docs.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CODE_OF_CONDUCT.md",
    "docs/release-candidate.zh-CN.md",
    "docs/release-candidate.en.md"
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(exists(relativePath), true, `${relativePath} should exist`);
  }

  const sampleReadme = read("examples/public-samples/README.md");
  assert.match(sampleReadme, /credential-free|无密钥/i);
  assert.match(sampleReadme, /no upload|不上传/i);
  assert.match(sampleReadme, /operations-handbook|Operations Handbook/i);
  assert.match(sampleReadme, /synthetic K12|合成 K12/i);
  assert.match(sampleReadme, /Query Runtime/);

  const releaseZh = read("docs/release-candidate.zh-CN.md");
  const releaseEn = read("docs/release-candidate.en.md");
  for (const content of [releaseZh, releaseEn]) {
    assert.match(content, /npm test/);
    assert.match(content, /smoke:release/);
    assert.match(content, /smoke:artifact/);
    assert.match(content, /verify:package-boundary/);
    assert.match(content, /githubCi/);
    assert.match(content, /githubCodeql/);
    assert.match(content, /githubScorecard/);
    assert.match(content, /npmPublication.*separate-decision|npm 发布.*单独决策/i);
  }
});

test("public sample source fixtures are tracked by git", (t) => {
  try {
    git(["rev-parse", "--is-inside-work-tree"]);
  } catch {
    t.skip("git metadata is not available");
    return;
  }

  const requiredSourceFixtures = [
    "examples/public-samples/general-docs/source/operations-handbook.md",
    "examples/public-samples/operations-handbook/source/incident-operations-handbook.md",
    "examples/public-samples/k12-synthetic/source/math-grade5-unit3.md"
  ];

  const gitignore = read(".gitignore");
  assert.match(gitignore, /^!examples\/public-samples\/\*\*\/source\/$/m);
  assert.match(gitignore, /^!examples\/public-samples\/\*\*\/source\/\*\*$/m);

  for (const relativePath of requiredSourceFixtures) {
    assert.equal(exists(relativePath), true, `${relativePath} should exist`);
    assert.equal(git(["ls-files", "--error-unmatch", relativePath]), relativePath);
  }
});

test("public package and package-boundary policy keep launch-only assets safe", () => {
  const npmignore = read(".npmignore");
  const packageJson = JSON.parse(read("package.json"));
  const docsIndex = read("docs/README.md");
  const docsIndexEn = read("docs/README.en.md");

  assert.match(npmignore, /^\.github\/$/m);
  assert.match(npmignore, /\*\*\/fixtures\/private\//);
  assert.match(npmignore, /\*\*\/workspace\//);
  assert.match(npmignore, /\*\.sqlite/);
  assert.ok(packageJson.keywords.includes("auditable-ai"));
  assert.ok(packageJson.keywords.includes("retrieval-augmented-generation"));
  assert.ok(packageJson.keywords.includes("document-intelligence"));
  assert.match(docsIndex, /公开样例|Public Samples|release candidate|发布候选/i);
  assert.match(docsIndexEn, /Public Samples|Release Candidate/i);
});
