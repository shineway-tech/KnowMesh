import assert from "node:assert/strict";
import test from "node:test";

import { getTemplate, listTemplates } from "./templates.mjs";

test("all built-in templates define commercial processing policies", () => {
  for (const template of listTemplates()) {
    assert.equal(template.archivePolicy?.strategy, "archive-originals");
    assert.equal(template.processingInputPolicy?.textLike?.vectorizeFrom, "cleaned-chunks");
    assert.equal(template.processingInputPolicy?.scannedPdf?.ocrInput, "page-image-tasks");
    assert.equal(template.processingInputPolicy?.mixedPdf?.splitByPage, true);
    assert.equal(template.processingInputPolicy?.image?.ocrInput, "original-image");
    assert.equal(template.citationPolicy?.required, true);
    assert.equal(template.coreName, "KnowMesh Core");
    assert.equal(template.aliyunMetadataContract?.authoritativeStore, "oss-sidecar");
    assert.equal(template.aliyunMetadataContract?.vectorMetadataMode, "compact-filter-fields");
    assert.ok(template.aliyunMetadataContract?.vectorMetadataFields.includes("sidecar"));
    assert.ok(template.metadataContract?.requiredForSearch?.length > 0);
    assert.ok(template.metadataContract?.requiredForCitation?.includes("excerpt"));
    assert.ok(template.updatePolicy?.zh);
    assert.ok(template.migrationPolicy?.zh);
  }
});

test("general template is the fallback template for any knowledge base", () => {
  const template = getTemplate("general-docs");

  assert.equal(template.version, "1.2.0");
  assert.equal(template.templateRole, "fallback");
  assert.equal(template.extendsTemplate, null);
  assert.equal(template.expertId, null);
  assert.equal(template.expertName, null);
  assert.equal(template.domainProcessingPolicy?.unitOfMeaning, "business-section");
  assert.equal(template.domainProcessingPolicy?.versionHandling, "active-version-with-history");
  assert.equal(template.modalityPolicy?.table?.action, "structure-or-review");
  assert.equal(template.modalityPolicy?.workflow?.keepStepsTogether, true);
  assert.ok(template.metadataFields.includes("section"));
});

test("K12 template extends the fallback with textbook semantics", () => {
  const template = getTemplate("textbook-cn-k12");

  assert.equal(template.version, "1.2.0");
  assert.equal(template.templateRole, "industry-extension");
  assert.equal(template.extendsTemplate, "general-docs");
  assert.equal(template.expertId, "k12");
  assert.equal(template.expertName, "KnowMesh Expert · K12");
  assert.equal(template.domainProcessingPolicy?.unitOfMeaning, "teaching-unit");
  assert.equal(template.domainProcessingPolicy?.tocHandling, "chapter-structure");
  assert.equal(template.modalityPolicy?.formula?.action, "structure-or-review");
  assert.equal(template.modalityPolicy?.figure?.bindTo, "nearest-knowledge-point");
  assert.equal(template.modalityPolicy?.exercise?.keepTogether, true);
  assert.deepEqual(template.metadataContract?.requiredForSearch?.slice(0, 3), ["stage", "subject", "grade"]);
  assert.ok(template.metadataContract?.queryFilters.some((item) => item.zh === "单元"));
  assert.ok(template.metadataFields.includes("knowledge_point"));
  assert.ok(template.metadataFields.includes("lesson_order_no"));
  assert.ok(template.metadataFields.includes("lesson_title"));
  assert.ok(template.metadataFields.includes("content_type"));
  assert.ok(template.metadataContract?.requiredForSearch?.includes("lesson_order_no"));
  assert.ok(template.metadataContract?.optionalButRecommended?.includes("lesson_title"));
  assert.ok(template.qualityGates.some((item) => /目录/.test(item.zh)));
});
