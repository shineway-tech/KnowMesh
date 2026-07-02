import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { evaluatePublicBetaReleaseEvidence } from "./release-gate.mjs";
import { providerCapabilities } from "../src/local-service/provider-capabilities.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Block K1 browser sample smoke is repeatable and cleans all temporary state", async () => {
  const { runBrowserSampleSmoke } = await import(pathToFileURL(path.join(projectRoot, "scripts", "browser-sample-smoke.mjs")).href);

  const result = await runBrowserSampleSmoke({
    projectRoot,
    viewports: [
      { name: "desktop", width: 1280, height: 820 },
      { name: "narrow", width: 390, height: 844 }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, "knowmesh.browserSampleSmoke");
  assert.deepEqual(result.evidence.browserSampleFlow, {
    status: "pass",
    desktop: true,
    narrow: true,
    resetVerified: true
  });
  assert.equal(result.evidence.externalCalls.total, 0);
  assert.equal(result.evidence.cleanup.sampleStillRegistered, false);
  assert.equal(result.evidence.cleanup.userDataRootRemoved, true);
  assert.equal(fs.existsSync(result.evidence.cleanup.userDataRoot), false);
  assert.deepEqual(result.viewports.map((item) => [item.name, item.status]), [
    ["desktop", "pass"],
    ["narrow", "pass"]
  ]);
  for (const key of ["createSample", "queryRuntime", "feedback", "maintenanceStatus", "packagePreview", "versionManifest", "evidenceSearch", "resetCleanup"]) {
    assert.equal(result.checks.find((item) => item.key === key)?.status, "pass", `${key} should pass`);
  }
});

test("Block K2 release evidence generator reviews assets and produces public-beta evidence", async () => {
  const { generateReleaseEvidence, reviewReleaseAssets } = await import(pathToFileURL(path.join(projectRoot, "scripts", "generate-release-evidence.mjs")).href);

  const unsafe = reviewReleaseAssets([
    "workspace/workspace.sqlite",
    "knowledge-bases/kb/catalog.sqlite",
    ".env",
    "logs/service.log",
    "output/playwright/page.yml"
  ]);
  const safe = reviewReleaseAssets([
    "README.md",
    "docs/release-operations.zh-CN.md",
    "assets/social/knowmesh-social-preview.png"
  ]);
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.rejected.some((item) => item.reason === "sqlite"));
  assert.ok(unsafe.rejected.some((item) => item.reason === "secret"));
  assert.ok(unsafe.rejected.some((item) => item.reason === "private-state"));
  assert.ok(unsafe.rejected.some((item) => item.reason === "generated-test-artifact"));
  assert.equal(safe.ok, true);

  const generated = generateReleaseEvidence({
    localGates: {
      npmTest: { ok: true },
      releaseSmoke: { ok: true },
      artifactSmoke: { ok: true, package: { sha256: "a".repeat(64) } },
      packageBoundary: { ok: true },
      diffCheck: { ok: true }
    },
    github: {
      githubCi: "pass",
      githubCodeql: "pass",
      githubScorecard: "pass"
    },
    browserSampleSmoke: {
      ok: true,
      evidence: {
        browserSampleFlow: { status: "pass", desktop: true, narrow: true, resetVerified: true }
      }
    },
    betaReleaseNotes: { supportedPaths: true, limitations: true, knownGaps: true },
    assetPaths: ["README.md", "docs/release-operations.en.md"]
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.evidence.npmPublication, "separate-decision");
  assert.equal(generated.evidence.artifactSmoke.sha256, "a".repeat(64));
  assert.deepEqual(generated.evidence.releaseAssetReview, {
    status: "pass",
    noPrivateState: true,
    noSqlite: true,
    noSecrets: true
  });
  assert.equal(evaluatePublicBetaReleaseEvidence(generated.evidence).releaseAllowed, true);
});

test("Block K3 extension certification registry gates lifecycle graduation safely", async () => {
  const certification = await import(pathToFileURL(path.join(projectRoot, "src", "local-service", "extension-certification.mjs")).href);
  const summary = certification.extensionCertificationSummary();

  assert.ok(summary.experts.some((item) => item.id === "k12" && item.lifecycle.stage === "official"));
  assert.ok(summary.providers.some((item) => item.id === "local-parser" && item.lifecycle.stage === "certified"));
  assert.doesNotMatch(JSON.stringify(summary), /[A-Z]:\\|ACCESS_KEY|SECRET|sk-|source text|真实教材/i);

  const k12 = certification.findExtensionCertification("expert", "k12");
  assert.equal(k12.owner, "KnowMesh Core");
  assert.ok(k12.requiredTests.includes("src/local-service/k12-expert-readiness.test.mjs"));
  assert.ok(k12.docs.some((item) => item.endsWith("docs/experts/k12.zh-CN.md")));

  const unsafe = certification.validateLifecycleGraduation({
    id: "unsafe-provider",
    kind: "provider",
    lifecycle: { stage: "certified" },
    owner: "Example",
    supportedContractVersion: "2026-06-public-beta.1",
    docs: ["docs/providers.en.md"],
    requiredTests: ["src/local-service/provider-capabilities.test.mjs"],
    securityNotes: ["No secrets."],
    knownLimitations: ["Pilot."],
    permissions: ["*"],
    adapterContract: { path: "catalog.sqlite" }
  });
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.issues.includes("unsafePermissions"));
  assert.ok(unsafe.issues.includes("internalSQLiteDependency"));
});

test("Block K4 local parser adapter pilot is explicit and visible in provider capabilities", async () => {
  const { localParserAdapterPilotContract } = await import(pathToFileURL(path.join(projectRoot, "src", "local-service", "providers", "local-parser.mjs")).href);
  const pilot = localParserAdapterPilotContract();
  const capabilities = providerCapabilities({}, { setupState: { draft: { "setup.mode": "local" } } });

  assert.equal(pilot.id, "local-parser");
  assert.equal(pilot.providerId, "local-parser");
  assert.equal(pilot.lifecycle.stage, "certified");
  assert.deepEqual(pilot.permissions, []);
  assert.equal(pilot.catalogWriteBoundary, "catalog-writer-api");
  assert.ok(pilot.requiredMethods.includes("readTextLikeSource"));
  assert.ok(pilot.requiredMethods.includes("checkpointExtractionResult"));
  assert.doesNotMatch(JSON.stringify(pilot), /catalog\.sqlite|workspace\.sqlite|\*|ACCESS_KEY|SECRET/i);

  const exposed = capabilities.adapterPilotContracts.find((item) => item.id === "local-parser");
  assert.equal(exposed.status, "pass");
  assert.equal(exposed.lifecycle.stage, "certified");
  assert.equal(exposed.externalCallsBeforeExecution, 0);
});

test("Block K5 beta feedback operations are documented and linked to backlog release notes", () => {
  const docs = [
    "docs/beta-feedback-operations.zh-CN.md",
    "docs/beta-feedback-operations.en.md",
    "docs/community-backlog.zh-CN.md",
    "docs/community-backlog.en.md",
    "docs/release-operations.zh-CN.md",
    "docs/release-operations.en.md",
    "ROADMAP.md",
    "ROADMAP.en.md"
  ];
  const combined = docs.map(readText).join("\n\n");

  for (const phrase of [
    "Beta Feedback Operations",
    "beta feedback",
    "known-gap",
    "release-note carryover",
    "Query Runtime",
    "public samples",
    "Provider",
    "Expert",
    "no private",
    "triage:intake",
    "triage:confirmed",
    "triage:queued",
    "triage:release-note",
    "triage:closed"
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(phrase), "i"), `${phrase} should be documented`);
  }
  assert.doesNotMatch(combined, /ACCESS_KEY|SECRET|sk-|C:\\Users|E:\\KnowMesh\\workspace|真实教材正文/i);
  assertMarkdownLinksResolve(docs);
});

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assertMarkdownLinksResolve(files) {
  for (const file of files) {
    const content = readText(file);
    const baseDir = path.dirname(path.join(projectRoot, file));
    const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const rawHref of links) {
      const href = rawHref.split("#")[0].trim();
      if (!href || /^[a-z]+:/i.test(href) || href.startsWith("mailto:")) continue;
      const target = path.resolve(baseDir, decodeURI(href));
      assert.equal(fs.existsSync(target), true, `${file} links to missing file: ${rawHref}`);
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
