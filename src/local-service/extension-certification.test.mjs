import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  extensionCertificationRegistry,
  extensionCertificationSummary,
  validateExtensionCertification,
  validateLifecycleGraduation
} from "./extension-certification.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const currentContractVersion = "2026-07-query-runtime.1";

test("Block N1 extension certification registry follows the current runtime contract", () => {
  const summary = extensionCertificationSummary();

  assert.equal(summary.contractVersion, currentContractVersion);
  assert.ok(summary.experts.some((item) => item.id === "k12" && item.lifecycle.stage === "official"));
  assert.ok(summary.experts.some((item) => item.id === "operations-handbook" && item.lifecycle.stage === "experimental"));

  for (const entry of extensionCertificationRegistry) {
    const validation = validateExtensionCertification(entry);
    assert.equal(validation.ok, true, `${entry.kind}:${entry.id} certification should be valid: ${validation.issues.join(", ")}`);
    assert.equal(entry.supportedContractVersion, currentContractVersion, `${entry.kind}:${entry.id} should use current contract`);
    if (entry.kind === "expert") {
      assert.ok(entry.requiredTests.includes("src/local-service/expert-runtime.test.mjs"), `${entry.id} should require expert runtime boundary tests`);
      assert.ok(entry.requiredTests.includes("src/local-service/expert-evaluation.test.mjs"), `${entry.id} should require expert evaluation contract tests`);
    }
    for (const doc of entry.docs) assert.equal(fs.existsSync(path.join(projectRoot, doc)), true, `${entry.id} missing doc ${doc}`);
    for (const requiredTest of entry.requiredTests) assert.equal(fs.existsSync(path.join(projectRoot, requiredTest)), true, `${entry.id} missing test ${requiredTest}`);
  }
});

test("Block N1 lifecycle graduation rejects direct storage and wildcard permissions", () => {
  const unsafe = {
    kind: "expert",
    id: "unsafe-expert",
    owner: "Example",
    lifecycle: { stage: "community" },
    supportedContractVersion: currentContractVersion,
    docs: ["docs/experts/authoring.en.md"],
    requiredTests: ["src/local-service/expert-registry.test.mjs"],
    securityNotes: ["Uses public APIs only."],
    knownLimitations: [],
    permissions: ["*"],
    capabilities: {
      writer: {
        path: "workspace.sqlite"
      }
    }
  };
  const validation = validateLifecycleGraduation(unsafe);

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("unsafePermissions"));
  assert.ok(validation.issues.includes("internalSQLiteDependency"));
}
);
