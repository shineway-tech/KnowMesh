import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("Block Z exposes final publication review commands", () => {
  const packageInfo = JSON.parse(read("package.json"));

  assert.equal(packageInfo.scripts["smoke:final-publication"], "node ./scripts/final-publication-review-evidence.mjs");
  assert.equal(packageInfo.scripts["generate:final-publication"], "node ./scripts/final-publication-review-evidence.mjs --out");
});

test("Block Z evaluator requires every final publication review gate", async () => {
  const { finalPublicationChecklist, evaluateFinalPublicationReview } = await import("./final-publication-review-evidence.mjs");

  assert.deepEqual(finalPublicationChecklist.map((item) => item.key), [
    "finalEvidenceRollup",
    "githubRepositoryStateReview",
    "npmPackagePublicationReview",
    "announcementSupportReadiness",
    "humanPublicationDecisionPacket"
  ]);

  const blocked = evaluateFinalPublicationReview({});
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.missing, finalPublicationChecklist.map((item) => item.key));
});

test("Block Z evidence rollup keeps all prior gates public-safe", async () => {
  const { buildFinalEvidenceRollupReport } = await import("./final-publication-review-evidence.mjs");

  const report = buildFinalEvidenceRollupReport({
    communityReleasePacket: {
      ok: true,
      apiReliability: { ok: true, artifactHash: "c".repeat(64), missing: [] },
      communityReleaseEvaluation: { missing: [] }
    }
  });

  assert.equal(report.status, "pass");
  assert.deepEqual(report.stages, [
    "release-candidate",
    "public-launch",
    "stabilization",
    "api-reliability",
    "community-release"
  ]);
  assert.equal(report.artifactHashCaptured, true);
  assert.equal(report.publicSafeEvidence, true);
  assert.equal(report.noPublicationSideEffects, true);
});

test("Block Z builds a human-review-only final publication packet", async () => {
  const { buildFinalPublicationReviewEvidence } = await import("./final-publication-review-evidence.mjs");

  const packet = await buildFinalPublicationReviewEvidence({
    evidenceRollupReview: "pass",
    githubReview: "pass",
    npmReview: "pass",
    announcementReview: "pass",
    decisionReview: "pass"
  });

  assert.equal(packet.ok, true);
  assert.equal(packet.releaseAllowed, false);
  assert.equal(packet.publicationDecision, "human-review-required");
  assert.deepEqual(packet.finalPublicationEvaluation.missing, []);
  assert.equal(packet.evidence.humanPublicationDecisionPacket.nextBlock, "post-publication-monitoring");
});

test("Block Z final publication CLI writes an evidence packet", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-block-z-"));
  const outFile = path.join(tempRoot, "final-publication.json");
  try {
    const result = spawnSync(process.execPath, [
      path.join(projectRoot, "scripts", "final-publication-review-evidence.mjs"),
      "--fixtures",
      "--out",
      outFile
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      shell: false
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packet = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(packet.ok, true);
    assert.equal(packet.kind, "knowmesh.finalPublicationReviewEvidence");
    assert.equal(packet.publicationDecision, "human-review-required");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("Block Z docs and plan list final review gates and post-publication monitoring", () => {
  const plan = read("docs/superpowers/plans/2026-06-30-product-engineering-mainline.md");
  const docsIndex = read("docs/README.md");
  const docsIndexEn = read("docs/README.en.md");
  const finalZh = read("docs/final-publication-review.zh-CN.md");
  const finalEn = read("docs/final-publication-review.en.md");
  const releaseOpsZh = read("docs/release-operations.zh-CN.md");
  const releaseOpsEn = read("docs/release-operations.en.md");

  for (const marker of ["Round Z1", "Round Z2", "Round Z3", "Round Z4", "Round Z5", "Block AA", "Round AA1", "Round AA5"]) {
    assert.match(plan, new RegExp(marker));
  }

  for (const content of [docsIndex, docsIndexEn, finalZh, finalEn]) {
    assert.match(content, /Final Publication Review|最终发布审核/i);
    assert.match(content, /GitHub|repository/i);
    assert.match(content, /npm/i);
    assert.match(content, /announcement|公告/i);
    assert.match(content, /human-review-required|人工审核/i);
  }

  for (const content of [releaseOpsZh, releaseOpsEn]) {
    assert.match(content, /smoke:final-publication/);
    assert.match(content, /generate:final-publication/);
  }
});
