import { listKnowledgeBases } from "./knowledge-bases.mjs";
import { normalizeNoAnswerStatus } from "./query-citation-validator.mjs";
import { queryRouteContractSummary } from "./query-route-contract.mjs";

export const queryRuntimeVersion = "1.0.0";

export function shapeQueryResponse(state, result = {}, request = {}) {
  const finishedAt = Number(request.finishedAt || Date.now());
  const startedAt = Number(request.startedAt || finishedAt);
  const knowledgeBase = listKnowledgeBases(state).current || null;
  const answerRun = result.answerRun || null;
  const first = Array.isArray(answerRun?.results) ? answerRun.results[0] : null;
  const source = answerRun?.source || null;
  const citations = Array.isArray(first?.citations) ? first.citations : [];
  const ok = Boolean(result.ok && first?.status === "answered");
  const status = publicStatus(result, first, ok);
  const answerStatus = first ? publicAnswerStatus(first.status || status) : status;
  const answerText = ok ? safeDisplayText(first?.answer || "") : "";

  return {
    ok,
    status,
    kind: "knowmesh.queryResult",
    apiVersion: queryRuntimeVersion,
    knowledgeBase: publicKnowledgeBase(knowledgeBase),
    runtime: {
      name: "KnowMesh Query Runtime",
      version: queryRuntimeVersion,
      source: publicRuntimeSource(source),
      model: answerRun?.model || null
    },
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - startedAt)
    },
    request: {
      question: request.question || ""
    },
    query: first
      ? {
          understanding: first.understanding || null,
          plan: first.queryPlan || null,
          retrieval: first.retrieval || null,
          evidencePack: first.evidencePack || null,
          quality: first.quality || null
        }
      : null,
    answer: first
      ? {
          status: answerStatus,
          text: answerText,
          message: first.message || null,
          reliable: ok
        }
      : {
          status,
          text: "",
          message: result.message || publicErrorMessage(result.error),
          reliable: false
        },
    citations: citations.map((citation) => publicCitation(citation, knowledgeBase?.id || "")),
    feedback: {
      endpoint: scopedKnowledgeBasePath(knowledgeBase?.id || "", "/api/query/feedback"),
      actions: first?.feedbackActions || []
    },
    maintenance: result.maintenance || null,
    error: result.error || null,
    checks: Array.isArray(result.checks) ? result.checks : [],
    fixes: Array.isArray(result.fixes) ? result.fixes : []
  };
}

export function buildQueryRuntimeContract(state) {
  const knowledgeBase = listKnowledgeBases(state).current || null;
  const knowledgeBasePath = (value) => scopedKnowledgeBasePath(knowledgeBase?.id || "", value);
  return {
    ok: true,
    kind: "knowmesh.queryContract",
    apiVersion: queryRuntimeVersion,
    knowledgeBase: publicKnowledgeBase(knowledgeBase, { includeStatus: true }),
    runtime: {
      name: "KnowMesh Query Runtime",
      version: queryRuntimeVersion,
      mode: "local-api"
    },
    endpoints: {
      query: endpoint("POST", knowledgeBasePath("/api/query"), true),
      feedback: endpoint("POST", knowledgeBasePath("/api/query/feedback"), true),
      feedbackSummary: endpoint("GET", knowledgeBasePath("/api/query/feedback/summary")),
      feedbackResolve: endpoint("POST", knowledgeBasePath("/api/query/feedback/resolve"), true),
      plan: endpoint("POST", knowledgeBasePath("/api/query/plan"), true),
      diagnostics: endpoint("GET", knowledgeBasePath("/api/maintenance/status"))
    },
    routePlanner: {
      version: "v1",
      contract: queryRouteContractSummary(),
      domains: ["k12", "general"],
      routes: ["k12Catalog", "structureCatalog", "hybridRetrieval"],
      evidenceSources: ["structure_nodes", "knowledge_objects", "object_relations", "citations", "chunks", "index_records", "aliyun_vector"],
      qualityGates: [
        "scopeFit",
        "evidenceFound",
        "citationTraceability",
        "citationSupportsAnswer",
        "noOutOfScopeLeakage",
        "noWeakAnswer",
        "displaySerialization"
      ]
    },
    request: {
      required: ["question"],
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: {
          question: { type: "string", minLength: 1 },
          scope: { type: "object", additionalProperties: true },
          intent: { type: "string" },
          filters: { type: "object", additionalProperties: true },
          debug: { type: "boolean", default: false }
        }
      },
      properties: {
        question: "User question in natural language.",
        scope: "Optional caller-provided scope hints.",
        intent: "Optional caller-provided intent hint.",
        filters: "Optional catalog search filters such as documentId or page range.",
        debug: "Optional diagnostics flag; defaults to false."
      },
      example: {
        question: "五年级统编版语文第三单元第一课是什么？",
        debug: false
      }
    },
    response: {
      fields: ["ok", "status", "answer", "citations", "checks", "feedback", "maintenance"],
      success: ["ok", "status", "answer.text", "citations", "feedback.endpoint"],
      statusValues: ["answered", "out_of_scope", "insufficient_evidence", "no_index", "provider_unavailable", "blocked_by_quality", "invalid_request", "runtime_error"],
      citationFields: ["title", "sourceUri", "pageNumber", "excerpt", "metadata.education", "links.document", "links.diagnostics"],
      schema: {
        type: "object",
        required: ["ok", "status", "answer", "citations", "checks", "feedback", "maintenance"],
        properties: {
          ok: { type: "boolean" },
          status: { type: "string" },
          answer: { type: "object" },
          citations: { type: "array" },
          checks: { type: "array" },
          feedback: { type: "object" },
          maintenance: { type: ["object", "null"] }
        }
      }
    },
    feedback: feedbackContract(knowledgeBasePath),
    examples: examplesContract(knowledgeBasePath),
    integrationNotes: {
      zh: [
        "优先调用 Query Runtime, 不要直接绕过到向量 Bucket。",
        "只有 ok=true 且 status=answered 时才展示 answer.text。",
        "每个答案都应展示引用来源、页码或原文片段。",
        "把用户反馈提交到 feedback endpoint；引用不对和回答漏点会进入问答反馈页待复核。"
      ],
      en: [
        "Call Query Runtime first instead of bypassing directly to the vector bucket.",
        "Only show answer.text when ok=true and status=answered.",
        "Show citation source, page, or excerpt for each answer.",
        "Submit feedback to the feedback endpoint; wrong citations and missed points enter Answer Feedback review."
      ]
    },
    openapi: {
      operationId: "queryKnowledgeBase",
      method: "post",
      path: knowledgeBasePath("/api/query"),
      requestBody: "application/json",
      response: "application/json"
    }
  };
}

function feedbackContract(knowledgeBasePath) {
  return {
    actions: [
      { key: "useful", label: { zh: "有帮助", en: "Useful" }, needsReview: false },
      { key: "wrong_citation", label: { zh: "引用不对", en: "Wrong citation" }, needsReview: true },
      { key: "missed_point", label: { zh: "回答漏点", en: "Missed point" }, needsReview: true }
    ],
    review: {
      reviewActions: ["wrong_citation", "missed_point"],
      positiveActions: ["useful"],
      summaryEndpoint: knowledgeBasePath("/api/query/feedback/summary"),
      resolveEndpoint: knowledgeBasePath("/api/query/feedback/resolve"),
      semantics: {
        zh: "有帮助反馈只作为正向信号记录；引用不对和回答漏点会进入当前知识库问答反馈页待复核。",
        en: "Useful feedback is recorded as a positive signal; wrong citation and missed point feedback enter the current knowledge base's Answer Feedback review list."
      }
    },
    request: feedbackRequestExample(knowledgeBasePath)
  };
}

function examplesContract(knowledgeBasePath) {
  return {
    flow: [
      flowStep("query", "调用 Query Runtime", "Call Query Runtime", "把用户问题发送到当前知识库接口。", "Send the user's question to the current knowledge-base endpoint."),
      flowStep("render", "只展示可靠答案", "Render reliable answers only", "只有 ok=true 且 status=answered 时展示 answer.text。", "Show answer.text only when ok=true and status=answered."),
      flowStep("cite", "展示引用来源", "Show source citations", "展示来源文件、页码和原文片段, 让用户能核对答案。", "Show the source file, page, and excerpt so users can verify the answer."),
      flowStep("feedback", "提交使用反馈", "Submit feedback", "有帮助只记录正向信号；引用不对和回答漏点进入问答反馈待复核。", "Useful feedback is positive only; wrong citations and missed points enter Answer Feedback review.")
    ],
    query: {
      endpoint: knowledgeBasePath("/api/query"),
      request: { question: "五年级统编版语文第三单元第一课是什么？", debug: false },
      successHandling: {
        condition: "ok === true && status === 'answered'",
        render: ["answer.text", "citations[].title", "citations[].pageNumber", "citations[].excerpt"]
      },
      fallbackHandling: {
        condition: "ok !== true",
        render: ["answer.message", "error.message", "status"],
        userAction: { zh: "提示用户换问法、补充资料或查看问答反馈与诊断。", en: "Ask the user to rephrase, add sources, or review Answer Feedback and diagnostics." }
      }
    },
    feedback: {
      endpoint: knowledgeBasePath("/api/query/feedback"),
      positive: { action: "useful", needsReview: false },
      needsReview: [
        { action: "wrong_citation", needsReview: true },
        { action: "missed_point", needsReview: true }
      ],
      request: feedbackRequestExample(knowledgeBasePath)
    },
    plan: {
      endpoint: knowledgeBasePath("/api/query/plan"),
      request: { question: "五年级统编版语文第三单元第一课是什么？" },
      successHandling: {
        render: ["domain", "intent", "route.key", "route.evidenceSources", "qualityGates"]
      }
    }
  };
}

function publicStatus(result = {}, first = null, ok = false) {
  if (ok) return "answered";
  if (result.status) return normalizeNoAnswerStatus(result.status);
  if (first?.status) return publicAnswerStatus(first.status);
  if (result.error?.code) return normalizeNoAnswerStatus(result.error.code);
  return "insufficient_evidence";
}

function publicAnswerStatus(status) {
  return status === "answered" ? "answered" : normalizeNoAnswerStatus(status);
}

function publicKnowledgeBase(knowledgeBase, options = {}) {
  return knowledgeBase
    ? {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        template: knowledgeBase.template,
        ...(options.includeStatus ? { status: knowledgeBase.status } : {})
      }
    : null;
}

function publicRuntimeSource(source = {}) {
  if (!source) return null;
  return {
    kind: source.kind || "",
    label: source.label || null,
    target: source.target || null,
    sidecar: source.sidecar || null
  };
}

function publicCitation(citation = {}, knowledgeBaseId = "") {
  const links = citation.links || {};
  return {
    id: citation.chunk_id || "",
    documentId: citation.document_id || "",
    versionId: citation.version_id || "",
    title: citation.title || "",
    sourceUri: citation.sourceUri || "",
    pageNumber: citation.pageNumber ?? null,
    excerpt: safeDisplayText(citation.excerpt || ""),
    metadata: {
      education: citation.education || citation.metadata?.education || null,
      contentType: citation.contentType || citation.metadata?.contentType || "",
      lessonTitle: citation.lessonTitle || citation.metadata?.lessonTitle || "",
      lessonOrder: citation.lessonOrder || citation.metadata?.lessonOrder || null
    },
    trustReasons: citation.trustReasons || [],
    links: {
      document: scopedKnowledgeBasePath(knowledgeBaseId, links.documentHref || "/maintain/documents"),
      diagnostics: scopedKnowledgeBasePath(knowledgeBaseId, links.diagnosticsHref || "/maintain/diagnostics")
    }
  };
}

function endpoint(method, endpointPath, withJson = false) {
  return {
    method,
    path: endpointPath,
    ...(withJson ? { contentType: "application/json" } : {})
  };
}

function feedbackRequestExample(knowledgeBasePath) {
  return {
    action: "wrong_citation",
    question: "五年级统编版语文第三单元第一课是什么？",
    answerStatus: "answered",
    citationIds: ["citation-id-from-query-response"],
    citationRefs: [{
      id: "citation-id-from-query-response",
      title: "义务教育教科书·语文五年级上册",
      pageNumber: 24,
      documentHref: knowledgeBasePath("/maintain/document?documentId=source-document-id")
    }]
  };
}

function flowStep(key, zhTitle, enTitle, zhDescription, enDescription) {
  return {
    key,
    title: { zh: zhTitle, en: enTitle },
    description: { zh: zhDescription, en: enDescription }
  };
}

function publicErrorMessage(error = null) {
  if (!error) return null;
  if (typeof error.message === "string") return safeDisplayText(error.message);
  if (error.message?.zh || error.message?.en) return safeDisplayText(error.message.zh || error.message.en);
  return null;
}

function safeDisplayText(value) {
  return String(value || "").replace(/\[object Object\]/g, "").trim();
}

function scopedKnowledgeBasePath(knowledgeBaseId, value = "") {
  const endpointPath = String(value || "").trim();
  if (!endpointPath) return "";
  if (endpointPath.startsWith("http://") || endpointPath.startsWith("https://") || endpointPath.startsWith("/kb/")) return endpointPath;
  const clean = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  return knowledgeBaseId ? `/kb/${encodeURIComponent(knowledgeBaseId)}${clean}` : clean;
}
