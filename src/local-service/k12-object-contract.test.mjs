import assert from "node:assert/strict";
import test from "node:test";

import {
  k12ExpertSchema,
  k12ObjectTypes,
  k12RelationTypes,
  normalizeK12ObjectType,
  normalizeK12RelationType,
  requireK12ObjectType,
  requireK12RelationType
} from "./k12-object-contract.mjs";

const expectedObjectTypes = [
  "book",
  "unit",
  "lesson",
  "section",
  "column",
  "text",
  "vocabulary",
  "knowledge_point",
  "formula",
  "table",
  "figure",
  "example",
  "exercise",
  "answer_explanation",
  "experiment",
  "activity",
  "citation_anchor"
];

test("K12 schema carries the current-design object vocabulary", () => {
  const schema = k12ExpertSchema();

  assert.equal(schema.id, "knowmesh.experts.k12.schema");
  assert.equal(schema.templateId, "textbook-cn-k12");
  assert.deepEqual(schema.objectTypes.map((item) => item.id), expectedObjectTypes);
  assert.deepEqual(k12ObjectTypes, expectedObjectTypes);
  assert.ok(k12RelationTypes.includes("lesson_to_vocabulary"));
  assert.ok(k12RelationTypes.includes("formula_to_exercise"));
  assert.ok(k12RelationTypes.includes("object_to_citation_anchor"));
});

test("K12 object and relation contract normalizes extracted catalog rows", () => {
  assert.equal(normalizeK12ObjectType("lesson_text"), "text");
  assert.equal(normalizeK12ObjectType("vocabulary_table"), "vocabulary");
  assert.equal(normalizeK12ObjectType("exercise"), "exercise");
  assert.equal(normalizeK12RelationType("belongs_to_lesson"), "lesson_to_vocabulary");
  assert.equal(normalizeK12RelationType("supports_exercise"), "formula_to_exercise");
  assert.equal(normalizeK12RelationType("lesson_to_exercise"), "lesson_to_exercise");

  assert.equal(requireK12ObjectType("lesson_text"), "text");
  assert.equal(requireK12RelationType("supports_exercise"), "formula_to_exercise");
  assert.throws(() => requireK12ObjectType("worksheet_blob"), /Unknown K12 object type/);
  assert.throws(() => requireK12RelationType("loosely_related"), /Unknown K12 relation type/);
});
