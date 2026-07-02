import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  expertRouteRulesForKnowledgeBase,
  expertRuntimeBoundaryForExpert,
  expertRuntimeContract,
  expertRuntimeDiagnostics,
  validateExpertRuntimeBoundary
} from "./expert-runtime.mjs";
import { createKnowledgeBase } from "./knowledge-bases.mjs";

test("expert runtime contract exposes narrow public hooks only", () => {
  const contract = expertRuntimeContract();

  assert.equal(contract.kind, "knowmesh.expertRuntimeContract");
  assert.equal(contract.version, "2026-07-expert-sdk.1");
  assert.equal(contract.queryRuntimeContractVersion, "2026-07-query-runtime.1");
  assert.deepEqual(contract.publicHooks.map((item) => item.key), [
    "sourceScope.decide",
    "classification.hintPageBlocks",
    "catalogWriter.writeStructureNodes",
    "catalogWriter.writeKnowledgeObjects",
    "queryRoutes.registerRules",
    "evaluation.registerCases"
  ]);
  assert.equal(contract.writeBoundary, "catalog-writer-api");
  assert.equal(contract.directStorageAccess, false);
  assert.doesNotMatch(JSON.stringify(contract), /catalog\.sqlite|workspace\.sqlite|source text|private/i);
});

test("expert runtime boundary rejects direct storage mutation and unsafe permissions", () => {
  const k12 = expertRuntimeBoundaryForExpert("k12");
  assert.equal(k12.expertId, "k12");
  assert.equal(k12.writeBoundary, "catalog-writer-api");
  assert.equal(k12.directStorageAccess, false);
  assert.deepEqual(k12.publicHooks.map((item) => item.key), [
    "sourceScope.decide",
    "classification.hintPageBlocks",
    "catalogWriter.writeStructureNodes",
    "catalogWriter.writeKnowledgeObjects",
    "queryRoutes.registerRules",
    "evaluation.registerCases"
  ]);
  assert.equal(validateExpertRuntimeBoundary("k12").ok, true);
  assert.doesNotMatch(JSON.stringify(k12), /catalog\.sqlite|workspace\.sqlite|E:\\|C:\\|source text/i);

  const unsafe = validateExpertRuntimeBoundary({
    id: "unsafe",
    templateId: "unsafe-template",
    permissions: ["sqlite:write"],
    capabilities: {
      writer: {
        kind: "module",
        module: "./direct-catalog-writer.mjs",
        internalStorage: "catalog.sqlite"
      }
    },
    queryRouteRules: [{ key: "unsafe", evidencePolicy: "prompt_context" }]
  });
  assert.equal(unsafe.ok, false);
  assert.ok(unsafe.issues.includes("unsafePermissions"));
  assert.ok(unsafe.issues.includes("directStorageAccess"));
  assert.ok(unsafe.issues.includes("unsupportedEvidencePolicy"));
});

test("expert route rules resolve from the selected knowledge base without private paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-expert-runtime-rules-"));
  const state = { projectRoot: root, userDataRoot: path.join(root, "user-data"), enableSystemConverters: false };
  const kb = createKnowledgeBase(state, { id: "kb-ops", name: "Operations", template: "operations-handbook" });

  const rules = expertRouteRulesForKnowledgeBase(state, kb);

  assert.equal(rules.expert.id, "operations-handbook");
  assert.deepEqual(rules.rules.map((item) => item.key), [
    "policyScopeLookup",
    "workflowStepLookup",
    "noAnswerWithoutEvidence"
  ]);
  assert.ok(rules.rules.every((item) => item.answerPolicy === "citation_ready_evidence_only"));
  assert.ok(rules.rules.every((item) => item.evidencePolicy === "citation_ready_evidence_only" || item.evidencePolicy === "no_weak_answer"));
  assert.doesNotMatch(JSON.stringify(rules), /catalog\.sqlite|workspace\.sqlite|source text|private/i);
});

test("expert runtime diagnostics summarize capabilities and limitations safely", () => {
  const diagnostics = expertRuntimeDiagnostics();

  assert.equal(diagnostics.kind, "knowmesh.expertRuntimeDiagnostics");
  assert.equal(diagnostics.redacted, true);
  assert.ok(diagnostics.experts.some((item) => item.id === "k12" && item.lifecycle.stage === "official"));
  assert.ok(diagnostics.experts.some((item) => item.id === "operations-handbook" && item.lifecycle.stage === "experimental"));
  assert.ok(diagnostics.experts.every((item) => item.writeBoundary === "catalog-writer-api"));
  assert.ok(diagnostics.experts.every((item) => item.directStorageAccess === false));
  assert.ok(diagnostics.experts.every((item) => Array.isArray(item.routeRules)));
  assert.doesNotMatch(JSON.stringify(diagnostics), /catalog\.sqlite|workspace\.sqlite|source text|apiKey|secret|C:\\|E:\\/i);
});
