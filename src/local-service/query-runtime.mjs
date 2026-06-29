import { listKnowledgeBases } from "./knowledge-bases.mjs";
import { answerQuestion } from "./query-engine.mjs";
import { recordQueryMaintenanceIssue } from "./query-maintenance-issues.mjs";

const runtimeVersion = "1.0.0";

export async function queryKnowledgeBase(state, input = {}) {
  const startedAt = Date.now();
  const question = String(input.question || input.query || "").trim();
  if (!question) {
    return buildPublicQueryResult(state, emptyQuestionResult(), { question, startedAt });
  }

  try {
    const result = await answerQuestion(state, {
      template: input.template,
      draft: input.draft || {},
      question,
      includeTemplateQuestions: false
    });
    return finalizePublicQueryResult(state, result, { question, startedAt });
  } catch (error) {
    return finalizePublicQueryResult(state, runtimeErrorResult(error), { question, startedAt });
  }
}

export function queryRuntimeContract(state) {
  const knowledgeBase = listKnowledgeBases(state).current || null;
  const knowledgeBasePath = (path) => scopedKnowledgeBasePath(knowledgeBase?.id || "", path);
  return {
    ok: true,
    kind: "knowmesh.queryContract",
    apiVersion: runtimeVersion,
    knowledgeBase: knowledgeBase
      ? {
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          template: knowledgeBase.template,
          status: knowledgeBase.status
        }
      : null,
    runtime: {
      name: "KnowMesh Query Runtime",
      version: runtimeVersion,
      mode: "local-api"
    },
    endpoints: {
      query: {
        method: "POST",
        path: knowledgeBasePath("/api/query"),
        contentType: "application/json"
      },
      feedback: {
        method: "POST",
        path: knowledgeBasePath("/api/query/feedback"),
        contentType: "application/json"
      },
      feedbackSummary: {
        method: "GET",
        path: knowledgeBasePath("/api/query/feedback/summary")
      },
      feedbackResolve: {
        method: "POST",
        path: knowledgeBasePath("/api/query/feedback/resolve"),
        contentType: "application/json"
      },
      plan: {
        method: "POST",
        path: knowledgeBasePath("/api/query/plan"),
        contentType: "application/json"
      },
      diagnostics: {
        method: "GET",
        path: knowledgeBasePath("/api/maintenance/status")
      }
    },
    routePlanner: {
      version: "v1",
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
      properties: {
        question: "User question in natural language.",
        query: "Alias of question.",
        draft: "Optional setup overrides for advanced internal use.",
        template: "Optional template id override."
      },
      example: {
        question: "五年级统编版语文第三单元第一课是什么？"
      }
    },
    response: {
      success: ["ok", "status", "answer.text", "citations", "feedback.endpoint"],
      statusValues: ["answered", "no_answer", "invalid_request", "runtime_error"],
      citationFields: ["title", "sourceUri", "pageNumber", "excerpt", "metadata.education", "links.document", "links.diagnostics"]
    },
    feedback: {
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
      request: {
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
      }
    },
    examples: {
      flow: [
        {
          key: "query",
          title: { zh: "调用 Query Runtime", en: "Call Query Runtime" },
          description: {
            zh: "把用户问题发送到当前知识库接口。",
            en: "Send the user's question to the current knowledge-base endpoint."
          }
        },
        {
          key: "render",
          title: { zh: "只展示可靠答案", en: "Render reliable answers only" },
          description: {
            zh: "只有 ok=true 且 status=answered 时展示 answer.text。",
            en: "Show answer.text only when ok=true and status=answered."
          }
        },
        {
          key: "cite",
          title: { zh: "展示引用来源", en: "Show source citations" },
          description: {
            zh: "展示来源文件、页码和原文片段, 让用户能核对答案。",
            en: "Show the source file, page, and excerpt so users can verify the answer."
          }
        },
        {
          key: "feedback",
          title: { zh: "提交使用反馈", en: "Submit feedback" },
          description: {
            zh: "有帮助只记录正向信号；引用不对和回答漏点进入问答反馈待复核。",
            en: "Useful feedback is positive only; wrong citations and missed points enter Answer Feedback review."
          }
        }
      ],
      query: {
        endpoint: knowledgeBasePath("/api/query"),
        request: {
          question: "五年级统编版语文第三单元第一课是什么？"
        },
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
        positive: {
          action: "useful",
          needsReview: false
        },
        needsReview: [
          { action: "wrong_citation", needsReview: true },
          { action: "missed_point", needsReview: true }
        ],
        request: {
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
        }
      },
      plan: {
        endpoint: knowledgeBasePath("/api/query/plan"),
        request: {
          question: "五年级统编版语文第三单元第一课是什么？"
        },
        successHandling: {
          render: ["domain", "intent", "route.key", "route.evidenceSources", "qualityGates"]
        }
      }
    },
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
    }
  };
}

function buildPublicQueryResult(state, result = {}, request = {}) {
  const finishedAt = Date.now();
  const knowledgeBase = listKnowledgeBases(state).current || null;
  const answerRun = result.answerRun || null;
  const first = Array.isArray(answerRun?.results) ? answerRun.results[0] : null;
  const source = answerRun?.source || null;
  const citations = Array.isArray(first?.citations) ? first.citations : [];
  const ok = Boolean(result.ok && first?.status === "answered");
  const status = publicStatus(result, first, ok);

  return {
    ok,
    status,
    kind: "knowmesh.queryResult",
    apiVersion: runtimeVersion,
    knowledgeBase: knowledgeBase
      ? {
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          template: knowledgeBase.template,
          status: knowledgeBase.status
        }
      : null,
    runtime: {
      name: "KnowMesh Query Runtime",
      version: runtimeVersion,
      source: publicRuntimeSource(source),
      model: answerRun?.model || null
    },
    timing: {
      startedAt: new Date(request.startedAt || finishedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - (request.startedAt || finishedAt))
    },
    request: {
      question: request.question || ""
    },
    query: first
      ? {
          understanding: first.understanding || null,
          plan: first.queryPlan || null,
          retrieval: first.retrieval || null,
          quality: first.quality || null
        }
      : null,
    answer: first
      ? {
          status: first.status || status,
          text: first.answer || "",
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
    error: result.error || null,
    checks: Array.isArray(result.checks) ? result.checks : [],
    fixes: Array.isArray(result.fixes) ? result.fixes : []
  };
}

function finalizePublicQueryResult(state, result = {}, request = {}) {
  const publicResult = buildPublicQueryResult(state, result, request);
  try {
    const maintenance = recordQueryMaintenanceIssue(state, publicResult);
    if (maintenance) publicResult.maintenance = maintenance;
  } catch {
    // Query answers should not fail because the maintenance queue cannot be updated.
  }
  return publicResult;
}

function publicStatus(result = {}, first = null, ok = false) {
  if (ok) return "answered";
  if (result.status) return result.status;
  if (first?.status) return first.status === "answered" ? "answered" : first.status;
  if (result.error?.code) return result.error.code;
  return "no_answer";
}

function publicErrorMessage(error = null) {
  if (!error) return null;
  if (typeof error.message === "string") return error.message;
  if (error.message?.zh || error.message?.en) return error.message.zh || error.message.en;
  return null;
}

function emptyQuestionResult() {
  return {
    ok: false,
    status: "invalid_request",
    message: "请输入要查询的问题。",
    error: {
      code: "missing_question",
      message: {
        zh: "请输入要查询的问题。",
        en: "Enter a question before calling the query endpoint."
      }
    },
    checks: [
      {
        key: "question",
        status: "fail",
        label: "查询问题",
        detail: "问题不能为空。"
      }
    ],
    fixes: []
  };
}

function runtimeErrorResult(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return {
    ok: false,
    status: "runtime_error",
    message,
    error: {
      code: "runtime_error",
      message: {
        zh: message || "查询运行时遇到异常。",
        en: message || "The query runtime failed."
      }
    },
    checks: [
      {
        key: "queryRuntime",
        status: "fail",
        label: "Query Runtime",
        detail: message || "查询运行时遇到异常。"
      }
    ],
    fixes: []
  };
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
    excerpt: citation.excerpt || "",
    metadata: {
      education: citation.education || null,
      contentType: citation.contentType || "",
      lessonTitle: citation.lessonTitle || "",
      lessonOrder: citation.lessonOrder || null
    },
    trustReasons: citation.trustReasons || [],
    links: {
      document: scopedKnowledgeBasePath(knowledgeBaseId, links.documentHref || "/maintain/documents"),
      diagnostics: scopedKnowledgeBasePath(knowledgeBaseId, links.diagnosticsHref || "/maintain/diagnostics")
    }
  };
}

function scopedKnowledgeBasePath(knowledgeBaseId, value = "") {
  const path = String(value || "").trim();
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("/kb/")) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return knowledgeBaseId ? `/kb/${encodeURIComponent(knowledgeBaseId)}${clean}` : clean;
}
