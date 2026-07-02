import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  expertManifestAuthoringContract,
  expertCapabilityKeys,
  getExpert,
  listExperts,
  publicExpertSummary,
  resolveExpertForKnowledgeBase,
  resolveExpertForTemplate,
  validateExpertAuthoringManifest,
  validateExpertManifest
} from "./expert-registry.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("expert registry exposes K12 as a lazy template extension", () => {
  const expert = resolveExpertForTemplate("textbook-cn-k12");

  assert.equal(expert.id, "k12");
  assert.equal(expert.templateId, "textbook-cn-k12");
  assert.deepEqual(expertCapabilityKeys(expert), [
    "schema",
    "sourceScopeGate",
    "pageClassifier",
    "structureBuilder",
    "objectExtractor",
    "queryRouter",
    "evaluationSet"
  ]);

  assert.deepEqual(publicExpertSummary(expert), {
    id: "k12",
    templateId: "textbook-cn-k12",
    name: "KnowMesh Expert · K12",
    status: "alpha",
    lifecycle: {
      stage: "official",
      since: "0.1.0-alpha",
      graduation: "K12 is the first official Expert scenario maintained with Core."
    },
    manifestVersion: "1.0.0",
    capabilities: [
      "schema",
      "sourceScopeGate",
      "pageClassifier",
      "structureBuilder",
      "objectExtractor",
      "queryRouter",
      "evaluationSet"
    ],
    supportedSourceTypes: ["pdf", "office", "wps", "markdown", "text", "image"],
    gates: ["sourceScope", "structureCompleteness", "citationCoverage", "outOfScopeRefusal", "displaySerialization"]
  });
});

test("general template does not resolve or load K12 expert processors", () => {
  assert.equal(resolveExpertForTemplate("general-docs"), null);
  assert.equal(resolveExpertForKnowledgeBase({ id: "kb-general", template: "general-docs" }), null);
  assert.equal(resolveExpertForKnowledgeBase({ id: "kb-k12", template: "textbook-cn-k12" }).id, "k12");

  const summaries = listExperts();
  assert.equal(summaries.length, 2);
  assert.deepEqual(summaries.map((item) => item.id), ["k12", "operations-handbook"]);
  assert.equal(JSON.stringify(summaries).includes("general-docs"), false);
});

test("expert manifests use the stable authoring contract", () => {
  for (const summary of listExperts()) {
    const expert = getExpert(summary.id);
    const validation = validateExpertManifest(expert);
    assert.equal(validation.ok, true, `${summary.id} manifest should be valid: ${validation.issues.join(", ")}`);
    assert.equal(expert.manifestVersion, "1.0.0");
    assert.equal(typeof expert.title.zh, "string");
    assert.equal(Array.isArray(expert.supportedSourceTypes), true);
    assert.equal(Array.isArray(expert.setupFields), true);
    assert.equal(Array.isArray(expert.extraction.objects), true);
    assert.equal(Array.isArray(expert.extraction.relations), true);
    assert.equal(Array.isArray(expert.gates), true);
    assert.equal(Array.isArray(expert.queryRoutes), true);
    assert.ok(["official", "certified", "community", "experimental"].includes(expert.lifecycle.stage));
  }

  const k12 = getExpert("k12");
  assert.ok(k12.setupFields.some((field) => field.key === "metadata.stage"));
  assert.ok(k12.extraction.objects.includes("unit"));
  assert.ok(k12.queryRoutes.includes("structureLookup"));

  const handbook = resolveExpertForTemplate("operations-handbook");
  assert.equal(handbook.id, "operations-handbook");
  assert.ok(handbook.extraction.objects.includes("policy"));
  assert.ok(handbook.queryRoutes.includes("workflowStepLookup"));
});

test("expert authoring kit is documented in Chinese and English", () => {
  const zh = fs.readFileSync(path.join(projectRoot, "docs", "experts", "authoring.zh-CN.md"), "utf8");
  const en = fs.readFileSync(path.join(projectRoot, "docs", "experts", "authoring.en.md"), "utf8");

  for (const content of [zh, en]) {
    assert.match(content, /manifestVersion/);
    assert.match(content, /supportedSourceTypes/);
    assert.match(content, /setupFields/);
    assert.match(content, /sourceScope/);
    assert.match(content, /queryRoutes/);
    assert.match(content, /queryRouteRules/);
    assert.match(content, /qualityGates/);
    assert.match(content, /evaluationCases/);
    assert.match(content, /migrations/);
    assert.match(content, /requiredTests/);
    assert.match(content, /permissions/);
    assert.match(content, /public Core interfaces|公开 Core 接口/);
    assert.doesNotMatch(content, /private textbook|真实教材|AccessKey Secret/i);
  }
});

test("Block N1 expert authoring contract validates safety-critical extension fields", () => {
  const contract = expertManifestAuthoringContract();

  assert.equal(contract.version, "2026-07-expert-sdk.1");
  assert.deepEqual(contract.requiredFields, [
    "id",
    "templateId",
    "manifestVersion",
    "supportedContractVersion",
    "lifecycle",
    "title",
    "supportedSourceTypes",
    "setupFields",
    "sourceScope",
    "extraction.objects",
    "extraction.relations",
    "queryRouteRules",
    "qualityGates",
    "evaluationCases",
    "migrations",
    "capabilities",
    "docs",
    "requiredTests",
    "permissions"
  ]);
  assert.ok(contract.forbiddenPatterns.includes("direct-sqlite"));
  assert.ok(contract.forbiddenPatterns.includes("private-fixture"));

  for (const summary of listExperts()) {
    const expert = getExpert(summary.id);
    const validation = validateExpertAuthoringManifest(expert);
    assert.equal(validation.ok, true, `${summary.id} should pass N1 authoring validation: ${validation.issues.join(", ")}`);
  }

  const unsafe = {
    ...getExpert("operations-handbook"),
    id: "unsafe-expert",
    supportedContractVersion: "",
    sourceScope: {},
    queryRouteRules: [],
    qualityGates: [],
    evaluationCases: [],
    migrations: "direct",
    docs: [],
    requiredTests: [],
    permissions: ["*"],
    fixtures: ["C:/Users/Wilson/private/source.pdf"],
    capabilities: {
      writer: {
        kind: "module",
        module: "./direct-catalog-sqlite-writer.mjs",
        path: "catalog.sqlite"
      }
    },
    mutatesCoreTables: true
  };
  const validation = validateExpertAuthoringManifest(unsafe);

  assert.equal(validation.ok, false);
  assert.ok(validation.issues.includes("supportedContractVersion"));
  assert.ok(validation.issues.includes("sourceScope"));
  assert.ok(validation.issues.includes("queryRouteRules"));
  assert.ok(validation.issues.includes("qualityGates"));
  assert.ok(validation.issues.includes("evaluationCases"));
  assert.ok(validation.issues.includes("migrations"));
  assert.ok(validation.issues.includes("docs"));
  assert.ok(validation.issues.includes("requiredTests"));
  assert.ok(validation.issues.includes("unsafePermissions"));
  assert.ok(validation.issues.includes("internalSQLiteDependency"));
  assert.ok(validation.issues.includes("coreTableMutation"));
  assert.ok(validation.issues.includes("privateFixture"));
});
