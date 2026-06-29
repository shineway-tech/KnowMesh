import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runReleaseSmoke } from "../../scripts/release-smoke.mjs";

test("release smoke checks critical APIs without leaking sensitive text", async () => {
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-release-smoke-"));
  try {
    const result = await runReleaseSmoke({
      projectRoot: process.cwd(),
      userDataRoot,
      env: {
        ALIBABA_CLOUD_ACCESS_KEY_SECRET: "release-smoke-secret"
      }
    });
    const serialized = JSON.stringify(result);

    assert.equal(result.ok, true);
    assert.equal(result.summary.failed, 0);
    assert.ok(result.summary.total >= 6);
    assert.ok(result.checks.some((item) => item.endpoint === "/api/health" && item.status === 200));
    assert.ok(result.checks.some((item) => item.endpoint === "/api/maintenance/foundation" && item.status === 200));
    assert.ok(result.checks.some((item) => item.endpoint === "/api/platform/runtime" && item.status === 200));
    assert.ok(result.checks.some((item) => item.endpoint === "/api/providers/capabilities" && item.status === 200));
    assert.ok(result.checks.some((item) => item.endpoint === "/api/package/export/preview" && item.status === 200));
    assert.doesNotMatch(serialized, /release-smoke-secret|accessKeySecret|apiKey/i);
  } finally {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  }
});
