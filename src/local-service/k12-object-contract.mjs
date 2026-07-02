import fs from "node:fs";

const schemaUrl = new URL("../experts/k12/schema.json", import.meta.url);
const schema = JSON.parse(fs.readFileSync(schemaUrl, "utf8"));
const objectAliasMap = schema.aliases?.objectTypes || {};
const relationAliasMap = schema.aliases?.relationTypes || {};

export const k12ObjectTypes = schema.objectTypes.map((item) => item.id);
export const k12RelationTypes = schema.relationTypes.map((item) => item.id);

const objectTypeSet = new Set(k12ObjectTypes);
const relationTypeSet = new Set(k12RelationTypes);

export function k12ExpertSchema() {
  return JSON.parse(JSON.stringify(schema));
}

export function normalizeK12ObjectType(value) {
  const key = normalizeTypeKey(value);
  if (!key) return "";
  const canonical = objectAliasMap[key] || key;
  return objectTypeSet.has(canonical) ? canonical : "";
}

export function requireK12ObjectType(value) {
  const canonical = normalizeK12ObjectType(value);
  if (!canonical) throw new Error(`Unknown K12 object type: ${String(value || "")}`);
  return canonical;
}

export function normalizeK12RelationType(value) {
  const key = normalizeTypeKey(value);
  if (!key) return "";
  const canonical = relationAliasMap[key] || key;
  return relationTypeSet.has(canonical) ? canonical : "";
}

export function requireK12RelationType(value) {
  const canonical = normalizeK12RelationType(value);
  if (!canonical) throw new Error(`Unknown K12 relation type: ${String(value || "")}`);
  return canonical;
}

function normalizeTypeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}
