const weakAnswerPattern = /(?:无法确认|不能确认|未找到|来源不足|does not confirm|not enough evidence|no reliable source)/i;
const serializationLeakPattern = /\[object Object\]/;

export function evaluateQueryQualityGates(result = {}) {
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const answer = String(result.answer || "");
  return [
    gate(
      "scopeFit",
      result.retrieval?.rejectedCitations > 0 && citations.length ? "review" : citations.length ? "pass" : "fail",
      "范围匹配",
      "Scope fit",
      citations.length
        ? result.retrieval?.rejectedCitations > 0 ? "部分候选被范围规则拦截，保留的引用需要复核。" : "保留的引用符合本次问题范围。"
        : "没有保留符合范围的引用。",
      citations.length
        ? result.retrieval?.rejectedCitations > 0 ? "Some candidates were blocked by scope rules; kept citations need review." : "Kept citations match the question scope."
        : "No scoped citation was kept."
    ),
    gate(
      "evidenceFound",
      citations.length ? "pass" : "fail",
      "证据存在",
      "Evidence found",
      citations.length ? `找到 ${citations.length} 条可用证据。` : "没有找到可用证据。",
      citations.length ? `${citations.length} evidence item(s) found.` : "No evidence was found."
    ),
    gate(
      "citationTraceability",
      citations.length && citations.every(traceableCitation) ? "pass" : "fail",
      "引用可追溯",
      "Citation traceability",
      citations.length && citations.every(traceableCitation) ? "每条引用都能回到来源、页码或结构锚点。" : "存在缺少来源、页码或结构锚点的引用。",
      citations.length && citations.every(traceableCitation) ? "Every citation traces back to a source, page, or structure anchor." : "At least one citation lacks source, page, or structure anchor."
    ),
    gate(
      "noWeakAnswer",
      result.status === "answered" && weakAnswerPattern.test(answer) ? "fail" : "pass",
      "非弱答案",
      "No weak answer",
      result.status === "answered" && weakAnswerPattern.test(answer) ? "弱答案不能计为成功。" : "答案没有使用无依据的弱成功措辞。",
      result.status === "answered" && weakAnswerPattern.test(answer) ? "Weak answers cannot count as successful." : "The answer does not use weak success wording."
    ),
    gate(
      "displaySerialization",
      serializationLeakPattern.test(answer) || serializationLeakPattern.test(JSON.stringify(citations)) ? "fail" : "pass",
      "展示序列化",
      "Display serialization",
      "回答和引用不能出现 [object Object]。",
      "Answers and citations must not contain [object Object]."
    )
  ];
}

function traceableCitation(citation = {}) {
  return Boolean(
    (citation.document_id || citation.documentId || citation.sourceUri || citation.title)
      && (citation.pageNumber !== null && citation.pageNumber !== undefined || citation.structureNodeId || citation.links?.documentHref)
  );
}

function gate(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}
