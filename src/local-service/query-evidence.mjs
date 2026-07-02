import { searchCatalog } from "./catalog-search.mjs";
import { routeK12QueryFromCatalog } from "./k12-query-router.mjs";
import { queryRouteAnswerPolicy, queryRouteContractVersion } from "./query-route-contract.mjs";
import { planQueryRoute } from "./query-route-planner.mjs";
import { routeStructureQueryFromCatalog } from "./query-structure-route.mjs";
import { normalizeQueryRequest } from "./query-understanding.mjs";

export async function retrieveQueryEvidence(state, input = {}) {
  const request = normalizeQueryRequest(input);
  const routePlan = planQueryRoute(state, {
    ...request,
    knowledgeBaseId: input.knowledgeBaseId,
    template: input.template
  });

  if (routePlan.route?.key === "reject") return refusalEvidence(routePlan, request);

  if (routePlan.route?.key === "k12Catalog") {
    const k12 = routeK12QueryFromCatalog(state, {
      question: request.question,
      knowledgeBaseId: input.knowledgeBaseId
    });
    if (k12.status === "evidence_found" || k12.status === "out_of_scope" || shouldStopAfterK12Catalog(k12)) {
      return routeEvidence(routePlan, k12, "k12Catalog");
    }
  }

  if (routePlan.route?.key === "structureCatalog") {
    const structure = routeStructureQueryFromCatalog(state, {
      question: request.question,
      knowledgeBaseId: input.knowledgeBaseId
    });
    if (structure.status === "evidence_found") return routeEvidence(routePlan, structure, "structureCatalog");
  }

  const catalog = retrieveCatalogSearchEvidence(state, request, routePlan, input);
  if (catalog.status === "evidence_found") return catalog;

  const vector = await retrieveVectorEvidence(input, routePlan);
  if (vector.status === "evidence_found") return vector;

  return {
    ...catalog,
    retrieval: {
      ...catalog.retrieval,
      vector: vector.retrieval?.vector || vector.vector || { status: "not_configured" }
    }
  };
}

function retrieveCatalogSearchEvidence(state, request, routePlan, input = {}) {
  const filters = request.filters || {};
  const result = searchCatalog(state, {
    ...filters,
    knowledgeBaseId: input.knowledgeBaseId,
    query: request.question,
    purpose: "queryEvidence",
    limit: input.limit || 12
  });
  const citations = (result.items || []).map(catalogItemToCitation).filter(Boolean);
  return {
    ok: citations.length > 0,
    status: citations.length ? "evidence_found" : "insufficient_evidence",
    kind: "knowmesh.queryEvidence",
    apiVersion: "v1",
    route: routeForEvidence(routePlan, routePlan.route || { key: "hybridRetrieval" }),
    understanding: routePlan.understanding || null,
    query: {
      question: request.question,
      filters
    },
    retrieval: {
      source: "catalogSearch",
      scanned: result.items?.length || 0,
      accepted: citations.length,
      rejected: Math.max(0, Number(result.total || 0) - citations.length),
      catalogTotal: Number(result.total || 0),
      vector: vectorStatus(input.vector)
    },
    citations,
    evidencePack: evidencePackFromCatalogItems(routePlan, result.items || []),
    checks: [
      evidenceCheck("catalogSearch", citations.length ? "pass" : "fail", citations.length
        ? "Catalog search returned citation-ready evidence."
        : "Catalog search did not return citation-ready evidence.")
    ],
    message: citations.length
      ? { zh: "已从 catalog 搜索找到可引用证据。", en: "Citation-ready evidence was found in catalog search." }
      : { zh: "没有找到足够证据，暂不生成答案。", en: "No sufficient evidence was found, so no answer is generated." }
  };
}

async function retrieveVectorEvidence(input = {}, routePlan = {}) {
  const vector = vectorStatus(input.vector);
  if (vector.status !== "ready") {
    return {
      ok: false,
      status: "provider_unavailable",
      kind: "knowmesh.queryEvidence",
      apiVersion: "v1",
      route: routeForEvidence(routePlan, routePlan.route || { key: "hybridRetrieval" }),
      retrieval: { source: "vector", scanned: 0, accepted: 0, rejected: 0, vector },
      citations: [],
      evidencePack: evidencePackFromCitations(routePlan, [], "vector"),
      checks: [evidenceCheck("vectorSidecar", "fail", "Vector retrieval is unavailable without a valid sidecar contract.")]
    };
  }
  if (typeof input.vectorRetriever !== "function") {
    return {
      ok: false,
      status: "provider_unavailable",
      kind: "knowmesh.queryEvidence",
      apiVersion: "v1",
      route: routeForEvidence(routePlan, routePlan.route || { key: "hybridRetrieval" }),
      retrieval: { source: "vector", scanned: 0, accepted: 0, rejected: 0, vector: { ...vector, status: "retriever_missing" } },
      citations: [],
      evidencePack: evidencePackFromCitations(routePlan, [], "vector"),
      checks: [evidenceCheck("vectorRetriever", "fail", "No vector retriever is configured.")]
    };
  }
  const result = await input.vectorRetriever({
    question: input.question || input.query || "",
    routePlan,
    vector: input.vector
  });
  const citations = (result.candidates || result.citations || []).map(vectorCandidateToCitation).filter(Boolean);
  return {
    ok: citations.length > 0,
    status: citations.length ? "evidence_found" : "insufficient_evidence",
    kind: "knowmesh.queryEvidence",
    apiVersion: "v1",
    route: routeForEvidence(routePlan, routePlan.route || { key: "hybridRetrieval" }),
    retrieval: {
      source: "vector",
      scanned: result.candidates?.length || result.citations?.length || 0,
      accepted: citations.length,
      rejected: 0,
      vector
    },
    citations,
    evidencePack: evidencePackFromCitations(routePlan, citations, "vector"),
    checks: [evidenceCheck("vectorEvidence", citations.length ? "pass" : "fail", citations.length
      ? "Vector sidecar returned citation-ready candidates."
      : "Vector sidecar returned no citation-ready candidates.")]
  };
}

function routeEvidence(routePlan, routeResult = {}, source) {
  return {
    ok: routeResult.status === "evidence_found",
    status: routeResult.status === "no_evidence" ? "insufficient_evidence" : routeResult.status,
    kind: "knowmesh.queryEvidence",
    apiVersion: "v1",
    route: routeForEvidence(routePlan, {
      ...(routePlan.route || {}),
      intent: routeResult.route?.intent || routePlan.intent || "",
      tableOrder: routeResult.route?.tableOrder || routePlan.route?.tableOrder || [],
      source
    }),
    understanding: routePlan.understanding || null,
    query: routeResult.query || null,
    retrieval: {
      source,
      scanned: routeResult.retrieval?.scanned || 0,
      accepted: routeResult.retrieval?.accepted || routeResult.citations?.length || 0,
      rejected: routeResult.retrieval?.rejected || 0,
      tableOrder: routeResult.route?.tableOrder || [],
      ownedScopes: routeResult.retrieval?.ownedScopes ?? null
    },
    citations: routeResult.citations || [],
    evidencePack: evidencePackFromCitations(routePlan, routeResult.citations || [], source),
    checks: routeResult.checks || [],
    message: routeResult.message || null
  };
}

function refusalEvidence(routePlan = {}, request = {}) {
  return {
    ok: false,
    status: routePlan.status || "out_of_scope",
    kind: "knowmesh.queryEvidence",
    apiVersion: "v1",
    route: routeForEvidence(routePlan, routePlan.route || { key: "reject" }),
    understanding: routePlan.understanding || null,
    query: { question: request.question },
    retrieval: { source: "none", scanned: 0, accepted: 0, rejected: 0 },
    citations: [],
    evidencePack: evidencePackFromCitations(routePlan, [], "none"),
    checks: [
      evidenceCheck("scope", "fail", "The question is outside the current knowledge-base scope.")
    ],
    message: {
      zh: "问题超出当前知识库范围，已在检索前拒绝。",
      en: "The question is outside the current knowledge-base scope and was refused before retrieval."
    }
  };
}

function evidencePackFromCatalogItems(routePlan = {}, items = []) {
  return evidencePack(routePlan, items.map((item) => ({
    chunkId: item.chunkId || "",
    citationId: item.citation?.citationId || item.chunkId || "",
    documentId: item.documentId || "",
    documentStatus: item.metadata?.documentStatus || item.rankingSignals?.documentStatus || "",
    qualityState: item.qualityState || "",
    structureNodeId: item.structureNodeId || "",
    structurePath: item.metadata?.structurePath || "",
    rankingSignals: item.rankingSignals || {},
    sourceAnchor: {
      sourceUri: item.citation?.sourceUri || item.source?.uri || item.metadata?.sourceUri || "",
      relativePath: item.citation?.relativePath || item.source?.relativePath || item.metadata?.relativePath || "",
      pageNumber: item.citation?.pageNumber ?? item.pageNumber ?? null,
      anchor: item.citation?.anchor || ""
    },
    links: item.links || {}
  })));
}

function evidencePackFromCitations(routePlan = {}, citations = [], source = "") {
  return evidencePack(routePlan, citations.map((citation) => ({
    chunkId: citation.chunk_id || citation.id || "",
    citationId: citation.citationId || citation.id || citation.chunk_id || "",
    documentId: citation.document_id || citation.documentId || "",
    documentStatus: citation.metadata?.documentStatus || "",
    qualityState: citation.metadata?.qualityState || "",
    structureNodeId: citation.structureNodeId || citation.structure_node_id || citation.metadata?.structureNodeId || "",
    structurePath: citation.metadata?.structurePath || "",
    rankingSignals: citation.rankingSignals || {},
    sourceAnchor: {
      sourceUri: citation.sourceUri || citation.metadata?.sourceUri || "",
      relativePath: citation.metadata?.relativePath || "",
      pageNumber: citation.pageNumber ?? citation.metadata?.pageNumber ?? null,
      anchor: citation.anchor || citation.metadata?.anchor || ""
    },
    links: citation.links || {}
  })), source);
}

function evidencePack(routePlan = {}, items = [], source = "") {
  return {
    version: queryRouteContractVersion,
    answerPolicy: queryRouteAnswerPolicy,
    routeKey: routePlan.route?.key || "",
    source: source || routePlan.route?.source || "",
    expert: evidencePackExpert(routePlan.expert),
    status: items.length ? "ready" : "empty",
    items
  };
}

function routeForEvidence(routePlan = {}, route = {}) {
  return {
    ...route,
    expert: routePlan.expert || null
  };
}

function evidencePackExpert(expert) {
  if (!expert) return null;
  return {
    id: expert.id || "",
    templateId: expert.templateId || "",
    lifecycle: expert.lifecycle ? { ...expert.lifecycle } : null,
    writeBoundary: expert.writeBoundary || "catalog-writer-api",
    directStorageAccess: expert.directStorageAccess === true,
    routeRules: Array.isArray(expert.routeRules) ? expert.routeRules.map((item) => ({ ...item })) : []
  };
}

function catalogItemToCitation(item = {}) {
  const citation = item.citation || {};
  const metadata = item.metadata || {};
  const source = item.source || {};
  const sourceUri = citation.sourceUri || source.uri || metadata.sourceUri || source.relativePath || "";
  const pageNumber = citation.pageNumber ?? item.pageNumber ?? metadata.pageStart ?? null;
  if (!item.documentId || !sourceUri && !item.title) return null;
  return {
    id: citation.citationId || item.chunkId || "",
    citationId: citation.citationId || "",
    chunk_id: item.chunkId || citation.citationId || "",
    document_id: item.documentId || "",
    version_id: metadata.versionId || "",
    title: item.title || citation.sourceLabel || "",
    sourceUri,
    pageNumber,
    excerpt: item.excerpt || "",
    contentType: metadata.contentType || "",
    structureNodeId: item.structureNodeId || "",
    metadata: {
      ...metadata,
      sourceType: source.type || metadata.sourceType || "",
      sourceUri,
      pageNumber
    },
    links: item.links || {}
  };
}

function vectorCandidateToCitation(candidate = {}) {
  const metadata = candidate.metadata || {};
  const sourceUri = candidate.sourceUri || metadata.sourceUri || metadata.relativePath || "";
  const pageNumber = candidate.pageNumber ?? metadata.pageNumber ?? metadata.page_start ?? metadata.pageStart ?? null;
  if (!sourceUri || pageNumber === null || pageNumber === undefined) return null;
  return {
    id: candidate.id || candidate.chunk_id || "",
    chunk_id: candidate.chunk_id || candidate.id || "",
    document_id: candidate.document_id || metadata.documentId || "",
    title: candidate.title || metadata.title || "",
    sourceUri,
    pageNumber,
    excerpt: candidate.excerpt || candidate.text || "",
    metadata
  };
}

function vectorStatus(vector = {}) {
  if (!vector || typeof vector !== "object" || !vector.provider) return { status: "not_configured" };
  if (vector.sidecarReady === false || vector.sidecar?.authoritativeStore !== undefined && vector.sidecar.authoritativeStore !== "oss-sidecar") {
    return {
      provider: vector.provider,
      status: "blocked_by_sidecar_contract"
    };
  }
  if (vector.sidecarReady === true || vector.sidecar?.authoritativeStore === "oss-sidecar") {
    return {
      provider: vector.provider,
      status: "ready"
    };
  }
  return {
    provider: vector.provider,
    status: "not_configured"
  };
}

function shouldStopAfterK12Catalog(result = {}) {
  return result.status === "no_evidence" && new Set([
    "first_lesson_lookup",
    "toc_lookup",
    "unit_lookup",
    "page_lookup",
    "vocabulary_lookup",
    "exercise_example_lookup"
  ]).has(result.route?.intent || "");
}

function evidenceCheck(key, status, message) {
  return {
    key,
    status,
    label: { zh: key, en: key },
    message: { zh: message, en: message }
  };
}
