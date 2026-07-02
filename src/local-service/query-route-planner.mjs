import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { expertRouteRulesForKnowledgeBase } from "./expert-runtime.mjs";
import { buildQueryRouteContract } from "./query-route-contract.mjs";
import { normalizeQueryRequest, understandQuery } from "./query-understanding.mjs";

export function planQueryRoute(state, input = {}) {
  const request = normalizeQueryRequest(input);
  const question = request.question;
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(input.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || null;
  const template = String(input.template || knowledgeBase?.template || "general-docs");
  const expertRuntime = expertRouteRulesForKnowledgeBase(state, knowledgeBase || { template });
  if (!question) return emptyPlan(knowledgeBase, "invalid_request", expertRuntime);
  const understanding = understandQuery(request, { template });
  if (understanding.status === "out_of_scope") return refusalPlan({ knowledgeBase, understanding, expertRuntime });
  return understanding.domain === "k12"
    ? k12RoutePlan({ understanding, knowledgeBase, expertRuntime })
    : generalRoutePlan({ understanding, knowledgeBase, expertRuntime });
}

function k12RoutePlan({ understanding, knowledgeBase, expertRuntime }) {
  const intent = understanding.intent;
  const structureIntent = new Set([
    "first_lesson_lookup",
    "toc_lookup",
    "unit_lookup",
    "page_lookup",
    "vocabulary_lookup",
    "exercise_example_lookup"
  ]).has(intent);
  return attachRouteContract({
    ok: true,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    domain: "k12",
    intent,
    understanding,
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: understanding.scope,
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
    expert: expertRuntime.expert,
    qualityGates: standardQualityGates({ scopeRequired: true }),
    diagnostics: {
      planner: "query-route-planner",
      version: "v1",
      expertRuntime: expertRuntime.diagnostics,
      providerInternalsExposed: false
    }
  });
}

function generalRoutePlan({ understanding, knowledgeBase, expertRuntime }) {
  const intent = understanding.intent;
  const structureIntent = understanding.routeHint === "structureCatalog";
  return attachRouteContract({
    ok: true,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    domain: "general",
    intent,
    understanding,
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: understanding.scope,
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
    expert: expertRuntime.expert,
    qualityGates: standardQualityGates({ scopeRequired: false }),
    diagnostics: {
      planner: "query-route-planner",
      version: "v1",
      expertRuntime: expertRuntime.diagnostics,
      providerInternalsExposed: false
    }
  });
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

function refusalPlan({ knowledgeBase, understanding, expertRuntime }) {
  return attachRouteContract({
    ok: false,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    status: understanding.status,
    domain: understanding.domain || "general",
    intent: understanding.intent,
    understanding,
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: understanding.scope,
    route: {
      key: "reject",
      label: { zh: "检索前拒答", en: "Pre-retrieval refusal" },
      priority: [],
      evidenceSources: [],
      fallback: "none"
    },
    expert: expertRuntime.expert,
    qualityGates: standardQualityGates({ scopeRequired: true }),
    diagnostics: {
      planner: "query-route-planner",
      version: "v1",
      expertRuntime: expertRuntime.diagnostics,
      providerInternalsExposed: false
    }
  }, { refusalReason: understanding.status || "out_of_scope" });
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

function emptyPlan(knowledgeBase, status, expertRuntime = { expert: null, diagnostics: { status: "not_applicable" } }) {
  return attachRouteContract({
    ok: false,
    kind: "knowmesh.queryRoutePlan",
    apiVersion: "v1",
    status,
    domain: "",
    intent: "",
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    scope: null,
    route: null,
    expert: expertRuntime.expert,
    qualityGates: []
  }, { refusalReason: status });
}

function attachRouteContract(plan, options = {}) {
  return {
    ...plan,
    contract: buildQueryRouteContract(plan, options)
  };
}
