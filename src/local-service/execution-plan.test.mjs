import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildVisibleExecutionPlan } from "./execution-plan.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("visible execution plan derives source handling from parser provider preparation plan", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src", "local-service", "execution-plan.mjs"), "utf8");
  assert.match(source, /buildSourcePreparationPlan/);
  assert.doesNotMatch(source, /processingGroupForSourceType/);

  const plan = buildVisibleExecutionPlan(scan([
    document("notes.md", "markdown"),
    document("macro.docm", "docm"),
    document("legacy.wps", "wps"),
    document("scan.pdf", "pdf"),
    document("photo.png", "image")
  ], { mode: "local" }), []);

  const textDetect = plan.stages.find((stage) => stage.key === "text").rounds.find((round) => round.key === "text-detect");
  assert.deepEqual(textDetect.metrics.map((item) => item.value), [1, 2, 2]);
});

function scan(documents, options = {}) {
  return {
    mode: options.mode || "local",
    sourceExists: true,
    missingFields: [],
    summary: {
      includedFiles: documents.length,
      logicalDocuments: documents.length,
      splitPdfGroups: 0
    },
    manifest: {
      logicalDocuments: documents
    },
    template: {
      metadataFields: [],
      evaluationQuestions: []
    }
  };
}

function document(relativePath, sourceType) {
  return {
    relativePath,
    sourceType
  };
}
