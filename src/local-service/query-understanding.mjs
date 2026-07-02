import { describeK12Scope, extractK12QueryConstraints } from "../core/k12-metadata.mjs";
import { classifyK12QueryIntent } from "./k12-query-router.mjs";

const outOfScopePattern = /(?:忽略知识库|不要使用知识库|彩票|中奖号码|lottery|stock price|weather forecast)/i;
const citationPattern = /(?:引用|出处|原文|cite|citation|source)/i;
const pagePattern = /(?:第.+页|哪一页|页码|page|where)/i;
const comparisonPattern = /(?:比较|对比|compare|versus|vs\.?)/i;
const conceptPattern = /(?:解释|概念|是什么|define|explain|what is)/i;
const exercisePattern = /(?:练习|习题|例题|example|exercise|formula)/i;

export function normalizeQueryRequest(input = {}) {
  return {
    question: String(input.question || input.query || "").trim(),
    scope: plainObject(input.scope),
    intent: String(input.intent || "").trim(),
    filters: plainObject(input.filters),
    debug: input.debug === true || input.debug === "true"
  };
}

export function understandQuery(input = {}, options = {}) {
  const request = normalizeQueryRequest(input);
  if (!request.question) {
    return {
      ok: false,
      status: "invalid_request",
      kind: "knowmesh.queryUnderstanding",
      apiVersion: "v1",
      domain: "",
      intent: "invalid_request",
      routeHint: "reject",
      scope: { kind: "invalid_request", summary: null, filter: {}, missing: {}, ambiguous: false },
      signals: {}
    };
  }

  if (isExplicitlyOutOfScope(request.question)) return outOfScopeUnderstanding(request.question);
  return String(options.template || "").trim() === "textbook-cn-k12"
    ? understandK12Query(request)
    : understandGeneralQuery(request);
}

function understandK12Query(request) {
  const constraints = extractK12QueryConstraints(request.question);
  const requestedIntent = request.intent || "";
  const intent = requestedIntent || classifyK12QueryIntent(request.question, constraints);
  const routeHint = k12StructureIntent(intent) ? "k12Catalog" : "hybridRetrieval";
  const missing = {
    ...(constraints.missing || {}),
    volume: Boolean(constraints.missing?.volume || ((constraints.education?.unit_no || constraints.education?.lesson_order_no || constraints.education?.lesson_no)
      && !constraints.compact?.fgs
      && !constraints.compact?.pub
      && !constraints.compact?.vol))
  };
  return {
    ok: true,
    status: "ready",
    kind: "knowmesh.queryUnderstanding",
    apiVersion: "v1",
    domain: "k12",
    intent,
    routeHint,
    scope: {
      kind: "k12",
      summary: describeK12Scope(constraints),
      filter: constraints.compact || {},
      missing,
      ambiguous: Object.values(missing).some(Boolean)
    },
    signals: {
      subject: constraints.education?.subject || "",
      grade: constraints.education?.grade || "",
      volume: constraints.education?.volume || "",
      publisher: constraints.education?.publisher || "",
      unit: constraints.education?.unit_no ? `第${toChineseNumber(constraints.education.unit_no)}单元` : "",
      lesson: constraints.education?.lesson_order_no
        ? `第${toChineseNumber(constraints.education.lesson_order_no)}课`
        : constraints.education?.lesson_no ? `第${toChineseNumber(constraints.education.lesson_no)}课` : ""
    }
  };
}

function understandGeneralQuery(request) {
  const signals = generalSignals(request.question);
  const requestedIntent = request.intent || "";
  const intent = requestedIntent || classifyGeneralIntent(signals);
  return {
    ok: true,
    status: "ready",
    kind: "knowmesh.queryUnderstanding",
    apiVersion: "v1",
    domain: "general",
    intent,
    routeHint: signals.lookup || signals.page || signals.citation ? "structureCatalog" : "hybridRetrieval",
    scope: {
      kind: "general",
      summary: { zh: "按当前知识库检索", en: "Search within the current knowledge base" },
      filter: plainObject(request.scope),
      missing: {},
      ambiguous: false
    },
    signals
  };
}

function classifyGeneralIntent(signals = {}) {
  if (signals.citation) return "citation_lookup";
  if (signals.comparison) return "comparison";
  if (signals.exercise) return "exercise_example_lookup";
  if (signals.lookup || signals.page) return "structure_lookup";
  if (signals.concept) return "concept_explanation";
  return "general_answer";
}

function generalSignals(question) {
  const text = String(question || "");
  const citation = citationPattern.test(text);
  const page = pagePattern.test(text);
  const lookup = citation || page || /(?:目录|章节|\bsection\b|\bchapter\b|\btoc\b|table of contents)/i.test(text);
  return {
    citation,
    comparison: comparisonPattern.test(text),
    concept: !lookup && conceptPattern.test(text),
    exercise: exercisePattern.test(text),
    lookup,
    page
  };
}

function outOfScopeUnderstanding(question) {
  return {
    ok: false,
    status: "out_of_scope",
    kind: "knowmesh.queryUnderstanding",
    apiVersion: "v1",
    domain: "general",
    intent: "out_of_scope",
    routeHint: "reject",
    scope: {
      kind: "out_of_scope",
      summary: {
        zh: "问题明确要求离开当前知识库范围。",
        en: "The question explicitly asks to leave the current knowledge-base scope."
      },
      filter: {},
      missing: {},
      ambiguous: false
    },
    signals: {
      outOfScope: true,
      question: String(question || "").slice(0, 160)
    }
  };
}

function isExplicitlyOutOfScope(question) {
  return outOfScopePattern.test(String(question || ""));
}

function k12StructureIntent(intent) {
  return new Set([
    "first_lesson_lookup",
    "toc_lookup",
    "unit_lookup",
    "page_lookup",
    "vocabulary_lookup",
    "exercise_example_lookup"
  ]).has(intent);
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value));
}

function toChineseNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number >= 1 && number <= 9) return digits[number];
  if (number === 10) return "十";
  if (number > 10 && number < 20) return `十${digits[number - 10]}`;
  if (number > 20 && number < 100) {
    const tens = Math.trunc(number / 10);
    const ones = number % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(number);
}
