import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createKnowledgeBase } from "./knowledge-bases.mjs";
import { listArtifactsForOwner, recordArtifact } from "./artifact-registry.mjs";

test("artifact registry stores workspace-relative paths, hashes, sizes, and metadata", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-artifacts-"));
  const workspaceRoot = path.join(temp, "workspace");
  const state = { projectRoot: temp, userDataRoot: path.join(temp, "user-data") };
  createKnowledgeBase(state, { name: "产物登记测试", template: "general-docs" });

  const reportPath = path.join(workspaceRoot, "artifacts", "reports", "pipeline-plan.report.json");
  const content = JSON.stringify({ ok: true, generatedAt: "2026-06-29T00:00:00.000Z" });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content, "utf8");

  const stored = recordArtifact(state, {
    ownerType: "job",
    ownerId: "job-1",
    artifactType: "pipelineReport",
    path: reportPath,
    baseRoot: workspaceRoot,
    metadata: { taskKey: "merge" }
  });
  const records = listArtifactsForOwner(state, { ownerType: "job", ownerId: "job-1" });

  assert.equal(stored.relativePath, "artifacts/reports/pipeline-plan.report.json");
  assert.equal(records.length, 1);
  assert.equal(records[0].artifactType, "pipelineReport");
  assert.equal(records[0].relativePath, "artifacts/reports/pipeline-plan.report.json");
  assert.equal(records[0].sizeBytes, Buffer.byteLength(content));
  assert.equal(records[0].contentHash, crypto.createHash("sha256").update(content).digest("hex"));
  assert.deepEqual(records[0].metadata, { taskKey: "merge" });
});
