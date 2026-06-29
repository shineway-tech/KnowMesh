import { describeK12Scope, extractK12QueryConstraints } from "../core/k12-metadata.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { classifyK12QueryIntent } from "./k12-query-router.mjs";

export function planQueryRoute(state, input = {}) {
  const question = String(input.question || input.query || "").trim();
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(input.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || null;
  const template = String(input.template || knowledgeBase?.template || "general-docs");
  if (!question) return emptyPlan(knowledgeBase, "invalid_request");
  return template === "textbook-cn-k12"
    ? k12RoutePlan({ question, knowledgeBase })
    : generalRoutePlan({ question, knowledgeBase });
}

function k12RoutePlan({ question, knowledgeBase }) {
  const constraints = extractK12QueryConstraints(question);
  const intent = classifyK12QueryIntent(question, constraints);
  const structureIntent = new Set([
    "first_lesson_lookup",
    "toc_lookup",
    "unit_lookup",
    "page_lookup",
    "vocabulary_lookup",
    "exercise_example_lookup"
  ]).has(intent);
  return {
    ok: true,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    domain: "k12",
    intent,
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: {
      kind: "k12",
      summary: describeK12Scope(constraints),
      filter: constraints.compact || {},
      missing: constraints.missing || {}
    },
    route: {
      key: structureIntent ? "k12Catalog" : "hybridRetrieval",
      label: structureIntent
        ? { zh: "K12 结构与对象目录", en: "K12 structure and object catalog" }
        : { zh: "混合检索", en: "Hybrid retrieval" },
      priority: structureIntent ? ["structure", "domain_object", "citation"] : ["structure", "vector", "chunk", "citation"],
      evidenceSources: structureIntent
        ? ["structure_nodes", "knowledge_objects", "object_relations", "citations"]
        : ["structure_nodes", "knowledge_objects", "chunks", "index_records", "aliyun_vector"],
      fallback: structureIntent ? "none_for_structure_questions" : "no_answer_without_sources"
    },
    qualityGates: standardQualityGates({ scopeRequired: true }),
    diagnostics: {
      planner: "query-route-planner",
      version: "v1",
      providerInternalsExposed: false
    }
  };
}

function generalRoutePlan({ question, knowledgeBase }) {
  const intent = classifyGeneralIntent(question);
  const structureIntent = intent === "structure_lookup";
  return {
    ok: true,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    domain: "general",
    intent,
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: {
      kind: "general",
      summary: { zh: "按当前知识库检索", en: "Search within the current knowledge base" },
      filter: {},
      missing: {}
    },
    route: {
      key: structureIntent ? "structureCatalog" : "hybridRetrieval",
      label: structureIntent
        ? { zh: "结构目录", en: "Structure catalog" }
        : { zh: "混合检索", en: "Hybrid retrieval" },
      priority: structureIntent ? ["structure", "citation"] : ["structure", "chunk", "vector", "citation"],
      evidenceSources: structureIntent
        ? ["structure_nodes", "citations", "source_documents"]
        : ["structure_nodes", "chunks", "index_records", "aliyun_vector"],
      fallback: structureIntent ? "hybridRetrieval" : "no_answer_without_sources"
    },
    qualityGates: standardQualityGates({ scopeRequired: false }),
    diagnostics: {
      planner: "query-route-planner",
      version: "v1",
      providerInternalsExposed: false
    }
  };
}

function classifyGeneralIntent(question) {
  const text = String(question || "");
  if (/第.+页|page|章节|目录|哪一页/.test(text)) return "structure_lookup";
  return "general_answer";
}

function standardQualityGates({ scopeRequired }) {
  return [
    gate("scopeFit", scopeRequired, "Scope fit"),
    gate("evidenceFound", true, "Evidence found"),
    gate("citationTraceability", true, "Citation traceability"),
    gate("citationSupportsAnswer", true, "Citation supports answer"),
    gate("noOutOfScopeLeakage", true, "No out-of-scope leakage"),
    gate("noWeakAnswer", true, "No weak answer counted as success"),
    gate("displaySerialization", true, "Display serialization")
  ];
}

function gate(key, required, label) {
  return {
    key,
    required,
    label: { zh: label, en: label }
  };
}

function publicKnowledgeBase(knowledgeBase) {
  return knowledgeBase
    ? {
        id: knowledgeBase.id || "",
        name: knowledgeBase.name || knowledgeBase.id || "",
        template: knowledgeBase.template || ""
      }
    : null;
}

function emptyPlan(knowledgeBase, status) {
  return {
    ok: false,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    status,
    domain: "",
    intent: "",
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: null,
    route: null,
    qualityGates: []
  };
}
