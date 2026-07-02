const weakAnswerPattern = /(?:无法确认|不能确认|未找到|来源不足|does not confirm|not enough evidence|no reliable source)/i;
const serializationLeakPattern = /\[object Object\]/;
const noAnswerStatuses = new Set(["out_of_scope", "insufficient_evidence", "no_index", "provider_unavailable", "blocked_by_quality"]);

export function validateQueryCitations(input = {}) {
  const status = normalizeNoAnswerStatus(input.status || "");
  const citations = Array.isArray(input.citations) ? input.citations : [];
  const answer = String(input.answer || "");
  const traceable = citations.length > 0 && citations.every(traceableCitation);
  const supportsAnswer = status !== "out_of_scope" && citations.length > 0 && citations.every((citation) => citationSupportsAnswer(citation, input));
  const outOfScopeLeakage = status === "out_of_scope" && citations.length > 0;
  const weakAnswer = status === "answered" && weakAnswerPattern.test(answer);
  const serializationLeak = serializationLeakPattern.test(answer) || serializationLeakPattern.test(safeStringify(citations));

  const checks = [
    validationCheck(
      "scopeFit",
      input.retrieval?.rejectedCitations > 0 && citations.length ? "review" : status === "out_of_scope" ? "fail" : citations.length ? "pass" : "fail",
      "Scope fit"
    ),
    validationCheck("evidenceFound", citations.length ? "pass" : status === "out_of_scope" ? "skip" : "fail", "Evidence found"),
    validationCheck("citationTraceability", traceable ? "pass" : citations.length ? "fail" : status === "out_of_scope" ? "skip" : "fail", "Citation traceability"),
    validationCheck("citationSupportsAnswer", supportsAnswer ? "pass" : citations.length ? "fail" : status === "out_of_scope" ? "skip" : "fail", "Citation supports answer"),
    validationCheck("noOutOfScopeLeakage", outOfScopeLeakage ? "fail" : "pass", "No out-of-scope leakage"),
    validationCheck("noWeakAnswer", weakAnswer ? "fail" : "pass", "No weak answer"),
    validationCheck("displaySerialization", serializationLeak ? "fail" : "pass", "Display serialization")
  ];

  if (citations.length && !traceable) return { ok: false, status: "insufficient_evidence", checks };
  if (outOfScopeLeakage || weakAnswer || serializationLeak || (citations.length && !supportsAnswer)) {
    return { ok: false, status: "blocked_by_quality", checks };
  }
  if (status === "out_of_scope") return { ok: true, status: "out_of_scope", checks };
  if (!citations.length || !traceable) return { ok: false, status: noAnswerStatuses.has(status) ? status : "insufficient_evidence", checks };
  return { ok: true, status: "citation_valid", checks };
}

export function normalizeNoAnswerStatus(status) {
  const value = String(status || "").trim();
  if (value === "answered") return "answered";
  if (value === "out_of_scope") return "out_of_scope";
  if (value === "no_evidence" || value === "no_answer" || value === "missing" || value === "failed") return "insufficient_evidence";
  if (value === "metadataContractMissing" || value === "index_missing" || value === "vector_missing") return "no_index";
  if (value === "model_unavailable" || value === "provider_missing" || value === "provider_unavailable") return "provider_unavailable";
  if (value === "review_required" || value === "quality_blocked" || value === "blocked_by_quality") return "blocked_by_quality";
  return value || "insufficient_evidence";
}

export function traceableCitation(citation = {}) {
  const hasSource = Boolean(citation.document_id || citation.documentId || citation.sourceUri || citation.title);
  const hasAnchor = citation.pageNumber !== null
    && citation.pageNumber !== undefined
    || Boolean(citation.structureNodeId || citation.structure_node_id || citation.links?.documentHref || citation.metadata?.structurePath || citation.metadata?.anchor);
  return hasSource && hasAnchor;
}

export function citationSupportsAnswer(citation = {}, input = {}) {
  const excerpt = normalizedWords([
    citation.excerpt,
    citation.title,
    citation.sourceUri,
    citation.metadata?.objectTitle,
    citation.metadata?.lessonTitle,
    citation.metadata?.nodeTitle,
    citation.metadata?.structurePath
  ].filter(Boolean).join(" "));
  if (!excerpt.length) return false;
  const answerTerms = meaningfulTerms(`${input.question || ""} ${input.answer || ""}`);
  if (!answerTerms.length) return true;
  return answerTerms.some((term) => excerpt.includes(term));
}

function meaningfulTerms(value) {
  const normalized = normalizedWords(value);
  const words = normalized
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stopWords().has(item));
  const cjk = (String(value || "").match(/\p{Script=Han}{2,}/gu) || [])
    .flatMap((item) => cjkNgrams(item));
  return [...new Set([...words, ...cjk])].slice(0, 32);
}

function cjkNgrams(value) {
  const chars = Array.from(String(value || ""));
  const terms = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      terms.push(chars.slice(index, index + size).join(""));
    }
  }
  return terms;
}

function normalizedWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validationCheck(key, status, label) {
  return {
    key,
    status,
    label: { zh: label, en: label }
  };
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function stopWords() {
  return new Set([
    "the",
    "and",
    "for",
    "that",
    "this",
    "what",
    "where",
    "which",
    "page",
    "policy",
    "described",
    "about",
    "does",
    "say"
  ]);
}
