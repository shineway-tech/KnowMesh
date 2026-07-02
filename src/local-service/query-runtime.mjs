import { shapeQueryResponse, buildQueryRuntimeContract } from "./query-answer-contract.mjs";
import { answerQuestion } from "./query-engine.mjs";
import { recordQueryMaintenanceIssue } from "./query-maintenance-issues.mjs";

export { buildQueryRuntimeContract as queryRuntimeContract };

export async function queryKnowledgeBase(state, input = {}) {
  const startedAt = Date.now();
  const question = String(input.question || input.query || "").trim();
  if (!question) {
    return shapeQueryResponse(state, emptyQuestionResult(), { question, startedAt });
  }

  try {
    const result = await answerQuestion(state, {
      template: input.template,
      draft: input.draft || {},
      question,
      scope: input.scope || {},
      intent: input.intent || "",
      filters: input.filters || {},
      debug: input.debug === true,
      includeTemplateQuestions: false
    });
    return finalizePublicQueryResult(state, result, { question, startedAt });
  } catch (error) {
    return finalizePublicQueryResult(state, runtimeErrorResult(error), { question, startedAt });
  }
}

function finalizePublicQueryResult(state, result = {}, request = {}) {
  const publicResult = shapeQueryResponse(state, result, request);
  try {
    const maintenance = recordQueryMaintenanceIssue(state, publicResult);
    if (maintenance) publicResult.maintenance = maintenance;
  } catch {
    // Query answers should not fail because the maintenance queue cannot be updated.
  }
  return publicResult;
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
