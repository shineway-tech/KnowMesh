const retrievalProfiles = [
  {
    id: "balanced",
    label: { zh: "稳健推荐", en: "Balanced" },
    badge: { zh: "推荐", en: "Recommended" },
    fit: { zh: "适合正式知识库默认使用", en: "Good default for production knowledge bases" },
    body: {
      zh: "先把问题改写得更清楚，再同时用语义和关键词找资料，最后用重排和引用校验减少答非所问。",
      en: "Clarifies the question, searches by meaning and keywords, then reranks and checks citations to reduce misses."
    },
    methods: ["normalize", "multiQuery", "hybrid", "rerank", "citation"],
    config: {
      queryRewrite: "normalize",
      multiQueryCount: 3,
      subQuery: "auto",
      hyde: "off",
      stepBack: "conditional",
      hybridSearch: true,
      rerank: true,
      citationPolicy: "strict",
      noAnswerPolicy: "answer_with_sources_only"
    }
  },
  {
    id: "coverage",
    label: { zh: "覆盖优先", en: "Coverage first" },
    badge: { zh: "召回", en: "Recall" },
    fit: { zh: "适合问法不固定或资料口径复杂", en: "For varied wording or complex sources" },
    body: {
      zh: "会生成多个问法，并在需要时先生成假设片段辅助检索，尽量把可能相关的资料都找出来。",
      en: "Generates several query angles and can use a hypothetical passage to find more potentially relevant sources."
    },
    methods: ["normalize", "multiQuery", "decompose", "hyde", "stepBack", "hybrid", "rerank", "citation"],
    config: {
      queryRewrite: "normalize_and_expand",
      multiQueryCount: 5,
      subQuery: "auto",
      hyde: "conditional",
      stepBack: "conditional",
      hybridSearch: true,
      rerank: true,
      citationPolicy: "strict",
      noAnswerPolicy: "answer_with_sources_only"
    }
  },
  {
    id: "precision",
    label: { zh: "精确引用", en: "Precise citations" },
    badge: { zh: "严谨", en: "Strict" },
    fit: { zh: "适合教材、制度、合规和可追溯回答", en: "For textbooks, policies, compliance, and traceability" },
    body: {
      zh: "优先使用资料范围和元数据过滤，答案必须能回到原文、页码或来源片段，找不到就明确提示。",
      en: "Uses metadata filters first and requires answers to point back to source text, pages, or snippets."
    },
    methods: ["normalize", "metadataFilter", "hybrid", "rerank", "citation", "noAnswer"],
    config: {
      queryRewrite: "normalize",
      multiQueryCount: 2,
      subQuery: "manual_when_complex",
      hyde: "off",
      stepBack: "off",
      hybridSearch: true,
      rerank: true,
      citationPolicy: "strict",
      noAnswerPolicy: "refuse_without_sources"
    }
  },
  {
    id: "low-cost",
    label: { zh: "低成本试跑", en: "Lower-cost trial" },
    badge: { zh: "试跑", en: "Trial" },
    fit: { zh: "适合先用少量资料验证效果", en: "For validating a small sample first" },
    body: {
      zh: "保留基础改写、混合检索和引用要求，减少额外改写轮次和模型调用，适合先看效果。",
      en: "Keeps basic rewrite, hybrid search, and citations while reducing extra rewrite rounds and model calls."
    },
    methods: ["normalize", "hybrid", "citation"],
    config: {
      queryRewrite: "normalize",
      multiQueryCount: 1,
      subQuery: "off",
      hyde: "off",
      stepBack: "off",
      hybridSearch: true,
      rerank: "optional",
      citationPolicy: "strict",
      noAnswerPolicy: "answer_with_sources_only"
    }
  }
];

const retrievalMethods = {
  normalize: {
    label: { zh: "问题改写", en: "Question rewrite" },
    body: { zh: "把口语问题整理成更清楚的检索问题。", en: "Turns casual wording into a clearer search query." }
  },
  multiQuery: {
    label: { zh: "多角度检索", en: "Multi-query search" },
    body: { zh: "从不同问法并行检索，减少漏找。", en: "Searches several phrasings to reduce misses." }
  },
  decompose: {
    label: { zh: "复杂问题拆分", en: "Question decomposition" },
    body: { zh: "把复合问题拆成小问题分别找资料。", en: "Splits compound questions into smaller searches." }
  },
  hyde: {
    label: { zh: "假设片段辅助", en: "Hypothetical passage" },
    body: { zh: "问法和资料用词差异大时，先生成可能片段再检索。", en: "Uses a possible passage when query and source wording differ." }
  },
  stepBack: {
    label: { zh: "背景扩展", en: "Background expansion" },
    body: { zh: "具体问题找不到时，先查上层背景再回答。", en: "Looks up broader background when a specific query is too narrow." }
  },
  hybrid: {
    label: { zh: "混合检索", en: "Hybrid search" },
    body: { zh: "同时用关键词和语义向量找资料。", en: "Combines keyword and vector search." }
  },
  metadataFilter: {
    label: { zh: "资料范围过滤", en: "Source-scope filter" },
    body: { zh: "按学段、学科、年级、版本等范围先过滤。", en: "Filters by stage, subject, grade, version, and similar metadata first." }
  },
  rerank: {
    label: { zh: "候选重排", en: "Rerank candidates" },
    body: { zh: "把最可能回答问题的片段排到前面。", en: "Moves the most relevant snippets to the top." }
  },
  citation: {
    label: { zh: "引用校验", en: "Citation check" },
    body: { zh: "回答必须带来源、页码或原文片段。", en: "Answers must include source, page, or text snippets." }
  },
  noAnswer: {
    label: { zh: "找不到就说明", en: "No-answer policy" },
    body: { zh: "没有可靠来源时不编答案。", en: "Does not invent an answer when sources are missing." }
  }
};

export function getRetrievalProfiles() {
  return retrievalProfiles.map((profile) => structuredClone(profile));
}

export function getRetrievalProfile(id) {
  return getRetrievalProfiles().find((profile) => profile.id === id) || getDefaultRetrievalProfile();
}

export function getDefaultRetrievalProfileId() {
  return "balanced";
}

export function getDefaultRetrievalProfile() {
  return getRetrievalProfiles().find((profile) => profile.id === getDefaultRetrievalProfileId());
}

export function getRetrievalMethods() {
  return structuredClone(retrievalMethods);
}
