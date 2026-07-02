import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePackageFiles } from "./verify-package-boundary.mjs";

test("package boundary rejects runtime state, secrets, sqlite files, and tests", () => {
  const result = evaluatePackageFiles([
    "README.md",
    "src/cli/knowmesh.mjs",
    "src/local-service/server.test.mjs",
    "workspace/workspace.sqlite",
    "knowledge-bases/kb-k12-all-subjects/catalog.sqlite",
    ".runtime/service.out.log",
    ".env",
    "artifacts/build/report.json",
    "exports/final-publication-review-evidence.json",
    "examples/textbook-cn-k12/private/source.pdf",
    "fixtures/private/k12/math-book.pdf"
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected, [
    "src/local-service/server.test.mjs",
    "workspace/workspace.sqlite",
    "knowledge-bases/kb-k12-all-subjects/catalog.sqlite",
    ".runtime/service.out.log",
    ".env",
    "artifacts/build/report.json",
    "exports/final-publication-review-evidence.json",
    "examples/textbook-cn-k12/private/source.pdf",
    "fixtures/private/k12/math-book.pdf"
  ]);
});

test("package boundary allows public source, docs, schemas, and examples", () => {
  const result = evaluatePackageFiles([
    "README.md",
    "LICENSE",
    "docs/current-design.md",
    "schemas/kb.schema.json",
    "src/sdk/knowmesh-client.mjs",
    "examples/local-demo/documents/science-note.md",
    "examples/public-samples/general-docs/source/operations-handbook.md",
    "scripts/release-smoke.mjs",
    "src/local-service/server.mjs"
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.rejected, []);
});
