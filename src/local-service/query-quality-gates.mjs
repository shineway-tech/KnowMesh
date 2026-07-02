import { validateQueryCitations } from "./query-citation-validator.mjs";

const messages = {
  scopeFit: {
    pass: ["保留的引用符合本次问题范围。", "Kept citations match the question scope."],
    review: ["部分候选被范围规则拦截，保留的引用需要复核。", "Some candidates were blocked by scope rules; kept citations need review."],
    fail: ["没有保留符合范围的引用。", "No scoped citation was kept."],
    skip: ["拒答不需要引用范围匹配。", "Refusals do not need citation scope matching."]
  },
  evidenceFound: {
    pass: ["找到可用证据。", "Evidence was found."],
    fail: ["没有找到可用证据。", "No evidence was found."],
    skip: ["拒答不应该携带证据。", "Refusals should not carry evidence."]
  },
  citationTraceability: {
    pass: ["每条引用都能回到来源、页码或结构锚点。", "Every citation traces back to a source, page, or structure anchor."],
    fail: ["存在缺少来源、页码或结构锚点的引用。", "At least one citation lacks source, page, or structure anchor."],
    skip: ["拒答不需要引用追溯。", "Refusals do not need citation traceability."]
  },
  citationSupportsAnswer: {
    pass: ["引用内容支持答案。", "Citations support the answer."],
    fail: ["引用内容不足以支持答案。", "Citations do not sufficiently support the answer."],
    skip: ["拒答不应携带答案引用。", "Refusals should not carry answer citations."]
  },
  noOutOfScopeLeakage: {
    pass: ["越界问题没有返回无关引用。", "Out-of-scope questions did not return unrelated citations."],
    fail: ["越界拒答不能返回无关引用。", "Out-of-scope refusals must not return unrelated citations."]
  },
  noWeakAnswer: {
    pass: ["答案没有使用无依据的弱成功措辞。", "The answer does not use weak success wording."],
    fail: ["弱答案不能计为成功。", "Weak answers cannot count as successful."]
  },
  displaySerialization: {
    pass: ["回答和引用没有展示序列化泄漏。", "The answer and citations do not leak display serialization."],
    fail: ["回答和引用不能出现 [object Object]。", "Answers and citations must not contain [object Object]."]
  }
};

export function evaluateQueryQualityGates(result = {}) {
  const validation = validateQueryCitations(result);
  return validation.checks.map((item) => ({
    ...item,
    message: messageFor(item.key, item.status)
  }));
}

function messageFor(key, status) {
  const [zh, en] = messages[key]?.[status] || messages[key]?.fail || ["质量门未通过。", "Quality gate did not pass."];
  return { zh, en };
}
