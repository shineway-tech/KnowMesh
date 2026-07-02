import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluateReleaseGate, evaluateReleaseGateEvidenceFile, releaseGateChecklist } from "./release-gate.mjs";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "release-gate.mjs");

test("release gate checklist requires local, artifact, package, and GitHub security gates", () => {
  const keys = releaseGateChecklist.map((item) => item.key);
  const commands = releaseGateChecklist.map((item) => item.command).join("\n");

  assert.deepEqual(keys, [
    "npmTest",
    "releaseSmoke",
    "artifactSmoke",
    "packageBoundary",
    "diffCheck",
    "githubCi",
    "githubCodeql",
    "githubScorecard"
  ]);
  assert.match(commands, /npm test/);
  assert.match(commands, /npm run smoke:release/);
  assert.match(commands, /npm run smoke:artifact/);
  assert.match(commands, /npm run verify:package-boundary/);
  assert.match(commands, /git diff --check/);
  assert.match(commands, /gh run list --workflow CI/);
  assert.match(commands, /gh run list --workflow CodeQL/);
  assert.match(commands, /gh run list --workflow Scorecard/);
  assert.doesNotMatch(commands, /npm publish/);
});

test("release gate blocks release until every required gate has passing evidence", () => {
  const partial = evaluateReleaseGate({
    npmTest: "pass",
    releaseSmoke: "pass",
    artifactSmoke: { status: "pass", sha256: "abc123" },
    packageBoundary: "pass"
  });
  const complete = evaluateReleaseGate(Object.fromEntries(
    releaseGateChecklist.map((item) => [item.key, item.key === "artifactSmoke" ? { status: "pass", sha256: "abc123" } : "pass"])
  ));

  assert.equal(partial.ok, false);
  assert.ok(partial.missing.includes("githubCi"));
  assert.ok(partial.missing.includes("githubCodeql"));
  assert.ok(partial.missing.includes("githubScorecard"));
  assert.equal(complete.ok, true);
  assert.equal(complete.releaseAllowed, true);
  assert.equal(complete.npmPublication, "separate-decision");
});

test("release gate can evaluate a local evidence JSON file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-release-gate-evidence-test-"));
  const evidencePath = path.join(tempDir, "evidence.json");
  try {
    fs.writeFileSync(evidencePath, JSON.stringify({
      npmTest: "pass",
      releaseSmoke: "pass",
      artifactSmoke: { status: "pass", sha256: "abc123" },
      packageBoundary: "pass",
      diffCheck: "pass",
      githubCi: "pass",
      githubCodeql: "pass",
      githubScorecard: "pass"
    }), "utf8");

    const result = evaluateReleaseGateEvidenceFile(evidencePath);

    assert.equal(result.ok, true);
    assert.equal(result.releaseAllowed, true);
    assert.equal(result.gates.find((item) => item.key === "artifactSmoke").evidence, "sha256:abc123");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("release gate CLI exits non-zero until complete evidence is supplied", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-release-gate-cli-test-"));
  const evidencePath = path.join(tempDir, "evidence.json");
  try {
    const blocked = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stdout, /"releaseAllowed": false/);

    fs.writeFileSync(evidencePath, JSON.stringify({
      npmTest: "pass",
      releaseSmoke: "pass",
      artifactSmoke: { status: "pass", sha256: "abc123" },
      packageBoundary: "pass",
      diffCheck: "pass",
      githubCi: "pass",
      githubCodeql: "pass",
      githubScorecard: "pass"
    }), "utf8");
    const allowed = spawnSync(process.execPath, [scriptPath, "--evidence", evidencePath], { encoding: "utf8" });

    assert.equal(allowed.status, 0);
    assert.match(allowed.stdout, /"releaseAllowed": true/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
