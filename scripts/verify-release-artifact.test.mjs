import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildReleaseArtifactChecks, findForbiddenInstalledPaths } from "./verify-release-artifact.mjs";

test("release artifact scan rejects private runtime state and test files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-artifact-scan-"));
  fs.mkdirSync(path.join(temp, "src"), { recursive: true });
  fs.mkdirSync(path.join(temp, "workspace"), { recursive: true });
  fs.mkdirSync(path.join(temp, "knowledge-bases", "kb"), { recursive: true });
  fs.writeFileSync(path.join(temp, "src", "cli.mjs"), "", "utf8");
  fs.writeFileSync(path.join(temp, "src", "cli.test.mjs"), "", "utf8");
  fs.writeFileSync(path.join(temp, ".env"), "", "utf8");
  fs.writeFileSync(path.join(temp, "workspace", "workspace.sqlite"), "", "utf8");

  assert.deepEqual(findForbiddenInstalledPaths(temp), [
    ".env",
    "knowledge-bases",
    "src/cli.test.mjs",
    "workspace"
  ]);
});

test("release artifact checks require package metadata bin link CLI help and clean paths", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-artifact-checks-"));
  const binPath = path.join(temp, "knowmesh");
  fs.writeFileSync(binPath, "", "utf8");

  const checks = buildReleaseArtifactChecks({
    packageInfo: {
      name: "knowmesh",
      version: "0.1.0",
      engines: { node: ">=24" },
      bin: { knowmesh: "./src/cli/knowmesh.mjs" }
    },
    binPath,
    forbiddenPaths: [],
    cliResult: {
      status: 0,
      stdout: "KnowMesh / 知络\nUsage:\n  knowmesh start\n",
      stderr: ""
    }
  });

  assert.equal(checks.every((item) => item.status === "pass"), true);
});
