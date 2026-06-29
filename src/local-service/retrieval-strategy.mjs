import { getRetrievalProfile, getRetrievalProfiles } from "../core/retrieval-strategy-catalog.mjs";

export function previewRetrievalStrategy(draft = {}) {
  const requestedProfile = String(draft["retrieval.profile"] || "");
  const knownProfiles = new Set(getRetrievalProfiles().map((item) => item.id));
  const validProfile = !requestedProfile || knownProfiles.has(requestedProfile);
  const profile = getRetrievalProfile(requestedProfile);
  const methodLabels = profile.methods.map((method) => methodLabel(method).zh).filter(Boolean);
  const enMethodLabels = profile.methods.map((method) => methodLabel(method).en).filter(Boolean);

  const checks = [
    check(
      "retrievalProfile",
      validProfile ? "pass" : "fail",
      "问答策略",
      "Answer strategy",
      validProfile ? `已选择${profile.label.zh}。` : "请选择一个问答策略。",
      validProfile ? `${profile.label.en} is selected.` : "Choose an answer strategy."
    ),
    check(
      "citationPolicy",
      profile.config?.citationPolicy === "strict" ? "pass" : "fail",
      "引用要求",
      "Citation requirement",
      profile.config?.citationPolicy === "strict" ? "回答必须带来源或原文片段。" : "需要启用引用要求。",
      profile.config?.citationPolicy === "strict" ? "Answers must include sources or snippets." : "Enable citation requirements."
    ),
    check(
      "noAnswerPolicy",
      profile.config?.noAnswerPolicy ? "pass" : "fail",
      "无答案处理",
      "No-answer behavior",
      profile.config?.noAnswerPolicy ? "找不到可靠来源时会提示，而不是编答案。" : "需要配置找不到来源时的处理方式。",
      profile.config?.noAnswerPolicy ? "When no reliable source is found, KnowMesh says so instead of inventing an answer." : "Configure behavior for missing sources."
    )
  ];

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    retrievalStrategy: {
      configured: false,
      profile: profile.id,
      profileLabel: profile.label,
      methods: profile.methods,
      config: profile.config
    },
    confirmation: {
      title: { zh: "问答策略确认", en: "Answer Strategy Confirmation" },
      summary: [
        confirmLine("问答策略", "Answer strategy", profile.label.zh, profile.label.en),
        confirmLine("适合场景", "Best for", profile.fit.zh, profile.fit.en),
        confirmLine("会使用", "Uses", methodLabels.join("、"), enMethodLabels.join(", "))
      ],
      impacts: [
        confirmLine("会影响什么", "Impact", "后续检索、重排、引用校验和无答案处理会按这套策略执行", "Later retrieval, rerank, citation checks, and no-answer handling follow this strategy"),
        confirmLine("不会做什么", "What will not happen", "现在不会读取资料、不会调用模型、不会产生费用", "No source reading, model call, or cost happens now"),
        confirmLine("下一步", "Next step", "继续选择资料目录和资料范围", "Continue to source folder and source scope")
      ],
      executionEnabled: false
    }
  };
}

function methodLabel(method) {
  const labels = {
    normalize: { zh: "问题改写", en: "question rewrite" },
    multiQuery: { zh: "多角度检索", en: "multi-query search" },
    decompose: { zh: "复杂问题拆分", en: "question decomposition" },
    hyde: { zh: "假设片段辅助", en: "hypothetical passage" },
    stepBack: { zh: "背景扩展", en: "background expansion" },
    hybrid: { zh: "混合检索", en: "hybrid search" },
    metadataFilter: { zh: "资料范围过滤", en: "source-scope filter" },
    rerank: { zh: "候选重排", en: "rerank" },
    citation: { zh: "引用校验", en: "citation check" },
    noAnswer: { zh: "无答案保护", en: "no-answer guard" }
  };
  return labels[method] || { zh: method, en: method };
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function confirmLine(zhLabel, enLabel, zhValue, enValue) {
  return {
    label: { zh: zhLabel, en: enLabel },
    value: { zh: zhValue, en: enValue }
  };
}
