import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { writeJsonFile } from "../core/config.mjs";
import {
  compactFromAnyMetadata,
  describeK12Scope,
  extractK12QueryConstraints,
  metadataMatchesK12Constraints as k12MetadataMatches,
  vectorFilterForK12Constraints
} from "../core/k12-metadata.mjs";
import { getRetrievalMethods } from "../core/retrieval-strategy-catalog.mjs";
import { getTemplate } from "../core/templates.mjs";
import { getObject, queryVectors } from "./aliyun.mjs";
import { readCatalogIndexChunks } from "./index-records.mjs";
import { latestJob } from "./jobs.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { queryRouteAnswerPolicy, queryRouteContractVersion } from "./query-route-contract.mjs";
import { planQueryRoute } from "./query-route-planner.mjs";
import { evaluateQueryQualityGates } from "./query-quality-gates.mjs";
import { retrieveQueryEvidence } from "./query-evidence.mjs";
import { searchCatalog } from "./catalog-search.mjs";
import { buildPublicSampleAnswer, isPublicSampleKnowledgeBase } from "./public-samples.mjs";
import { readAliyunCredentials, readAliyunModelProvider, readSetupState } from "./setup-store.mjs";
import { openCatalogDatabase } from "./storage.mjs";

const defaultTemplateId = "textbook-cn-k12";
const retrievalMethods = getRetrievalMethods();

export function previewValidation(state, options = {}) {
  const template = getTemplate(options.template || options.draft?.template || defaultTemplateId) || getTemplate(defaultTemplateId);
  const setupState = readSetupState(state);
  const strategy = buildValidationStrategy(setupState);
  const job = latestJobFromState(state);
  const adHocQuestion = String(options.question || options.draft?.["ask.question"] || "").trim();
  const includeTemplateQuestions = options.includeTemplateQuestions === true || options.draft?.["ask.includeTemplateQuestions"] === true;
  const templateQuestions = includeTemplateQuestions
    ? template.evaluationQuestions.map((question, index) => validationQuestion(`template-${index + 1}`, "template", question))
    : [];
  const adHocQuestions = adHocQuestion
    ? [validationQuestion("adhoc-1", "adHoc", { zh: adHocQuestion, en: adHocQuestion })]
    : [];
  const questions = [...adHocQuestions, ...templateQuestions];
  const strategyReady = Boolean(strategy.configured);
  const jobComplete = job?.status === "completed";
  const writeComplete = jobReadyForValidation(job);
  const validationSource = resolveValidationSource(state, job);
  const metadataContractMissing = validationSource?.kind === "metadataContractMissing";
  const knowledgeBaseReady = writeComplete && Boolean(validationSource) && !metadataContractMissing;
  const hasQuestions = questions.length > 0;
  const ready = knowledgeBaseReady && strategyReady && hasQuestions;

  return {
    ok: ready,
    checks: [
      check(
        "questions",
        hasQuestions ? "pass" : "fail",
        "验证问题",
        "Validation question",
        hasQuestions ? `本次会验证 ${questions.length} 个问题。` : "先输入一个问题，或开启模板抽样问题。",
        hasQuestions ? `${questions.length} question(s) will be checked.` : "Enter a question or enable template sample questions."
      ),
      check(
        "retrievalStrategy",
        strategyReady ? "pass" : "fail",
        "问答策略",
        "Answer strategy",
        strategyReady ? `当前使用${strategy.label.zh}。` : "还没有保存问答效果策略。",
        strategyReady ? `${strategy.label.en} is active.` : "Save the answer strategy first."
      ),
      check(
        metadataContractMissing ? "metadataContract" : "job",
        knowledgeBaseReady ? "pass" : metadataContractMissing ? "fail" : "warn",
        "知识库可提问",
        "Knowledge-base query source",
        knowledgeBaseReady
          ? validationSource.kind === "aliyunVector"
            ? "最近任务已写入 OSS 向量 Bucket，Query Runtime 会使用云端检索结果。"
            : "最近任务已完成写入，并找到可诊断的本地索引片段。"
          : metadataContractMissing
            ? "这份阿里云知识库缺少 OSS Sidecar 元数据契约，需要先升级后再提问测试。"
          : writeComplete
            ? "最近任务已写入，但没有找到可用于提问的知识库入口。请重新生成检索数据。"
            : jobComplete
              ? "最近任务还没有完成写入知识库。需要先执行到写入完成，再提问测试。"
              : "最近任务还没有完成，当前只能检查提问条件。",
        knowledgeBaseReady
          ? validationSource.kind === "aliyunVector"
            ? "The latest job wrote to OSS Vector Bucket, and Query Runtime will use cloud retrieval."
            : "The latest job finished writing and has a local diagnostic source."
          : metadataContractMissing
            ? "This Aliyun knowledge base is missing the OSS Sidecar metadata contract. Upgrade it before asking questions."
          : writeComplete
            ? "The latest job was written, but no queryable knowledge-base entry was found. Regenerate search data."
            : jobComplete
              ? "The latest job has not completed the knowledge-base write yet. Finish the write step before asking questions."
              : "The latest job is not complete; KnowMesh can only check query readiness."
      ),
      check(
        "boundary",
        "warn",
        "提问边界",
        "Query boundary",
        "未 OCR、未向量化、未写入知识库的内容不会参与回答。",
        "Content without OCR, embedding, or write-in is not used for answers."
      )
    ],
    fixes: [
      ...(!hasQuestions ? [{
        key: "questionMissing",
        step: "/use/ask",
        label: { zh: "输入问题", en: "Enter question" },
        message: { zh: "先输入想验证的问题，或勾选模板抽样问题。", en: "Enter a question or enable template sample questions." }
      }] : []),
      ...(!strategyReady ? [{
        key: "retrievalStrategyMissing",
        step: "/setup/retrieval",
        label: { zh: "需要处理", en: "Needs attention" },
        message: { zh: "先保存问答效果策略。", en: "Save the answer strategy first." }
      }] : []),
      ...(!knowledgeBaseReady ? [{
        key: metadataContractMissing ? "metadataContractUpgrade" : writeComplete ? "validationSourceMissing" : "jobNotComplete",
        step: metadataContractMissing ? "/maintain/diagnostics" : "/build/execution",
        label: { zh: "需要处理", en: "Needs attention" },
        message: {
          zh: metadataContractMissing
            ? "在维护页升级元数据契约：复用已生成的索引记录，发布 OSS Sidecar 并补写向量 Metadata，不重跑 OCR 或向量化。"
            : writeComplete ? "重新执行生成检索数据，恢复本地可验证片段。" : jobComplete ? "先完成上传、OCR、向量化和写入后再验证。" : "先完成或推进最近的任务。",
          en: metadataContractMissing
            ? "Upgrade the metadata contract from Maintenance: reuse existing index records, publish OSS Sidecar, and rewrite vector metadata without rerunning OCR or embeddings."
            : writeComplete ? "Regenerate search data to restore local validation excerpts." : jobComplete ? "Finish upload, OCR, embedding, and write steps before validation." : "Complete or advance the latest job first."
        }
      }] : [])
    ],
    validationPreview: {
      template: {
        id: template.id,
        title: template.title
      },
      strategy,
      summary: {
        totalQuestions: questions.length,
        templateQuestions: templateQuestions.length,
        adHocQuestions: adHocQuestions.length,
        includeTemplateQuestions,
        ready
      },
      rules: [
        rule("citation", "必须有引用", "Citation required", "每个答案都要能回到资料、页码或标题和原文片段。", "Each answer must trace back to source, page or heading, and excerpt."),
        rule("traceable", "来源可追溯", "Traceable source", "引用缺失、页码缺失或来源不可追溯时不能标记通过。", "Missing citations, missing pages, or untraceable sources cannot pass."),
        rule("boundary", "只验证知识库片段", "Knowledge-base chunks only", "当前只做抽检，真正验收仍要看更多问题和引用覆盖。", "This is a sampling check; final acceptance still needs broader questions and citation coverage.")
      ],
      queryPlans: questions.map((question) => buildQuestionPlan(question, strategy, template)),
      questions: questions.map((question) => ({
        ...question,
        queryPlan: buildQuestionPlan(question, strategy, template),
        status: ready ? "waiting" : "blocked",
        citationStatus: ready ? "pending" : "blocked",
        message: ready
          ? { zh: "等待执行知识库抽检。", en: "Waiting for knowledge-base sampling." }
          : { zh: "先满足问题、策略和知识库片段条件后再验证。", en: "Complete question, strategy, and knowledge-base chunk requirements first." }
      }))
    }
  };
}

export async function runValidation(state, options = {}) {
  const preview = previewValidation(state, options);
  const job = latestJobFromState(state);
  if (!preview.ok || !preview.validationPreview.strategy.configured || !job || job.status !== "completed") return preview;

  const source = resolveValidationSource(state, job);
  if (!source) {
    return {
      ...preview,
      ok: false,
      checks: [
        ...preview.checks,
        check(
          "validationSource",
          "fail",
          "可验证片段",
          "Validation source",
          "没有找到可验证的本地知识片段，请重新执行生成检索数据。",
          "No local validation source was found. Regenerate search data first."
        )
      ],
      fixes: [{
        key: "missingValidationSource",
        step: "/build/execution",
        label: { zh: "重新执行", en: "Run again" },
        message: { zh: "回到任务页重新执行生成检索数据。", en: "Return to tasks and regenerate search data." }
      }],
      validationRun: buildValidationRun(preview, [], [], source)
    };
  }

  const { results, scanned } = source.kind === "aliyunVector"
    ? await validateQuestionsFromAliyunVector(state, preview, source)
    : await validateQuestionsFromSource(preview, source);
  const reportPath = source.reportPath || queryEvidenceReportPath(source.path);
  const run = buildValidationRun(preview, results, [
    artifact("queryEvidenceReport", "检索证据报告", "Query evidence report", reportPath, "记录问题、命中片段、引用状态和失败原因。", "Records questions, matched excerpts, citation status, and failure reasons.")
  ], source);
  writeJsonFile(reportPath, {
    kind: "knowmesh.queryEvidenceReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      status: job.status,
      mode: job.mode,
      template: job.template
    },
    source: {
      kind: source.kind,
      path: source.path,
      target: source.target || null,
      sidecar: source.sidecar || null
    },
    strategy: preview.validationPreview.strategy,
    validationRun: run
  });

  return {
    ok: true,
    checks: [
      check(
        "job",
        "pass",
        "知识库任务",
        "Knowledge-base job",
        source.kind === "aliyunVector" ? "最近任务已完成，正在通过 OSS 向量 Bucket 验证。" : "最近任务已完成，正在基于本地产物诊断。",
        source.kind === "aliyunVector" ? "The latest job is complete; validation uses OSS Vector Bucket." : "The latest job is complete; validation uses local diagnostics."
      ),
      check(
        "validationSource",
        "pass",
        "可验证片段",
        "Validation source",
        source.kind === "aliyunVector" ? `已查询 ${scanned} 个云端命中。` : `已扫描 ${scanned} 个本地索引片段。`,
        source.kind === "aliyunVector" ? `${scanned} cloud hit(s) were queried.` : `${scanned} local index chunk(s) were scanned.`
      ),
      check(
        "report",
        "pass",
        "验证报告",
        "Validation report",
        "已生成问答验证报告。",
        "The Q&A validation report was created."
      )
    ],
    fixes: [],
    validationPreview: preview.validationPreview,
    validationRun: run
  };
}

export async function answerQuestion(state, options = {}) {
  const refusalRouteAnswer = answerRefusalRoute(state, options);
  if (refusalRouteAnswer) return refusalRouteAnswer;

  const catalogRouteAnswer = await answerK12CatalogRoute(state, options);
  if (catalogRouteAnswer) return catalogRouteAnswer;
  const structureRouteAnswer = await answerStructureCatalogRoute(state, options);
  if (structureRouteAnswer) return structureRouteAnswer;

  const validation = await runValidation(state, {
    ...options,
    includeTemplateQuestions: options.includeTemplateQuestions === true
  });
  if (!validation.ok || !validation.validationRun) return validation;

  const modelProvider = await readAliyunModelProvider(state);
  const setupState = readSetupState(state);
  const model = setupState.modelQuality?.organizer || setupState.draft?.["aliyun.services.organizer"] || "qwen-plus";
  const results = [];
  for (const result of validation.validationRun.results || []) {
    results.push(await answerValidationResult(state, result, {
      modelProvider,
      model,
      strategy: validation.validationRun.strategy
    }));
  }

  const answerRun = buildAnswerRun(validation.validationRun, results, {
    modelProvider,
    model
  });
  const reportPath = queryRuntimeReportPath(validation.validationRun.artifacts?.[0]?.path || validation.validationRun.source?.path || "");
  if (reportPath) {
    writeJsonFile(reportPath, {
      kind: "knowmesh.queryRuntimeReport",
      apiVersion: "v1",
      generatedAt: new Date().toISOString(),
      validationSource: validation.validationRun.source,
      answerRun
    });
    answerRun.artifacts.push(artifact(
      "queryRuntimeReport",
      "查询运行报告",
      "Query runtime report",
      reportPath,
      "记录问题、答案、引用和模型调用状态。",
      "Records the question, answer, citations, and model call status."
    ));
  }

  const hasCitableSources = answerRun.summary.withCitations > 0;
  const failed = answerRun.summary.failed > 0 || answerRun.summary.noEvidence > 0 || answerRun.summary.modelUnavailable > 0;
  return {
    ok: !failed,
    checks: [
      check(
        "sources",
        hasCitableSources ? "pass" : "fail",
        "可引用来源",
        "Citable sources",
        hasCitableSources ? "已找到可追溯来源，答案会附带引用。" : "没有找到可追溯来源，暂不生成答案。",
        hasCitableSources ? "Traceable sources were found and will be cited." : "No traceable source was found, so no answer is generated."
      ),
      check(
        "model",
        answerRun.summary.modelUnavailable > 0 ? "fail" : hasCitableSources ? "pass" : "warn",
        "模型服务",
        "Model service",
        answerRun.summary.modelUnavailable > 0
          ? "还没有可用的模型服务，当前只能展示来源。"
          : hasCitableSources
            ? `已使用 ${model} 基于引用生成答案。`
            : "还没有可引用来源，所以没有调用模型生成答案。",
        answerRun.summary.modelUnavailable > 0
          ? "No usable model service is configured, so only sources can be shown."
          : hasCitableSources
            ? `${model} generated the answer from citations.`
            : "No citable source was found, so the model was not asked to generate an answer."
      ),
      check(
        "answer",
        failed ? "fail" : "pass",
        "回答生成",
        "Answer generation",
        failed ? "问题还不能形成可靠答案，请查看缺失信息和引用。" : "已生成可追溯答案。",
        failed ? "The question cannot yet produce a reliable answer. Review missing information and citations." : "A traceable answer was generated."
      )
    ],
    fixes: failed ? answerRun.results.flatMap((item) => item.fixes || []) : [],
    validationPreview: validation.validationPreview,
    validationRun: validation.validationRun,
    answerRun
  };
}

function answerRefusalRoute(state, options = {}) {
  const question = String(options.question || options.query || options.draft?.["ask.question"] || "").trim();
  if (!question) return null;
  const routePlan = planQueryRoute(state, { question, template: options.template });
  if (routePlan.route?.key !== "reject") return null;

  const setupState = readSetupState(state);
  const strategy = buildValidationStrategy(setupState);
  const queryPlan = buildRefusalQueryPlan(routePlan, question, strategy);
  const result = validationResultFromRefusalRoute(routePlan, queryPlan);
  const validationRun = buildRefusalValidationRun(routePlan, result, queryPlan, strategy);
  const answerRun = buildAnswerRun(validationRun, [result], {
    modelProvider: null,
    model: ""
  });
  return {
    ok: false,
    status: routePlan.status || "out_of_scope",
    checks: refusalRouteChecks(routePlan),
    fixes: [],
    validationPreview: buildRefusalValidationPreview(routePlan, queryPlan, strategy),
    validationRun,
    answerRun
  };
}

function buildRefusalQueryPlan(routePlan = {}, question = "", strategy = {}) {
  return {
    questionKey: "adhoc-1",
    methods: ["scopeCheck", "refusal"],
    original: question,
    normalized: normalizeQuestion(question),
    scope: routePlan.scope?.summary || routePlan.understanding?.scope?.summary || { zh: "超出当前知识库范围", en: "Outside the current knowledge-base scope" },
    missingScope: {},
    queries: [],
    subQuestions: [],
    hypothetical: "",
    stepBack: "",
    filter: null,
    rerank: false,
    citationRequired: true,
    noAnswerPolicy: strategy.noAnswer || "refuse_without_sources",
    route: {
      intent: routePlan.intent || "out_of_scope",
      source: "none",
      tableOrder: []
    },
    contract: routePlan.contract || null
  };
}

function validationResultFromRefusalRoute(routePlan = {}, queryPlan = {}) {
  const status = routePlan.status || "out_of_scope";
  return {
    key: "adhoc-1",
    source: "adHoc",
    question: queryPlan.original || "",
    queryPlan,
    scope: queryPlan.scope,
    rejectedMatches: [],
    status,
    answerStatus: status,
    citationStatus: "skipped",
    confidence: 1,
    message: routePlan.understanding?.scope?.summary || { zh: "问题超出当前知识库范围，已拒绝回答。", en: "The question is outside the current knowledge-base scope and was refused." },
    answerPreview: {
      zh: "问题超出当前知识库范围，KnowMesh 不会检索或生成答案。",
      en: "The question is outside the current knowledge-base scope, so KnowMesh does not retrieve or answer."
    },
    retrieval: {
      source: "none",
      route: routePlan.intent || "out_of_scope",
      scanned: 0,
      acceptedCitations: 0,
      rejectedCitations: 0,
      refusal: routePlan.contract?.refusal || null
    },
    understanding: routePlan.understanding || null,
    feedbackActions: queryFeedbackActions(),
    citations: [],
    evidencePack: evidencePackFromCitations(routePlan.route?.key || "reject", [])
  };
}

function buildRefusalValidationRun(routePlan = {}, result = {}, queryPlan = {}, strategy = {}) {
  const current = routePlan.knowledgeBase || {};
  return {
    template: current.template ? { id: current.template, title: current.name || "" } : { id: "general-docs", title: "" },
    strategy,
    source: {
      kind: "queryRoute",
      path: "catalog://query-route-contract",
      label: { zh: "查询范围路由", en: "Query scope route" }
    },
    summary: {
      totalQuestions: 1,
      templateQuestions: 0,
      adHocQuestions: 1,
      passed: 0,
      failed: 1,
      citationPass: 0,
      citationMissing: 0,
      reviewRequired: 0
    },
    rules: [
      rule("scope", "范围先行", "Scope first", "越界问题在检索前拒答。", "Out-of-scope questions are refused before retrieval."),
      rule("citation", "无引用泄漏", "No citation leakage", "拒答结果不能携带无关引用。", "Refusals must not carry unrelated citations."),
      rule("noWeakAnswer", "不生成弱答案", "No weak answer", "证据不足时不把泛泛解释标记为成功。", "Weak unsupported responses are not counted as successful answers.")
    ],
    queryPlans: [queryPlan],
    results: [result],
    artifacts: [],
    route: routePlan.route || null
  };
}

function buildRefusalValidationPreview(routePlan = {}, queryPlan = {}, strategy = {}) {
  return {
    template: routePlan.knowledgeBase?.template ? { id: routePlan.knowledgeBase.template, title: routePlan.knowledgeBase.name || "" } : { id: "general-docs", title: "" },
    strategy,
    summary: {
      totalQuestions: 1,
      templateQuestions: 0,
      adHocQuestions: 1,
      includeTemplateQuestions: false,
      ready: false
    },
    rules: [
      rule("scope", "范围先行", "Scope first", "越界问题在检索前拒答。", "Out-of-scope questions are refused before retrieval.")
    ],
    queryPlans: [queryPlan],
    questions: [{
      key: "adhoc-1",
      source: "adHoc",
      question: queryPlan.original || "",
      queryPlan,
      status: "blocked",
      citationStatus: "skipped",
      message: routePlan.understanding?.scope?.summary || null
    }]
  };
}

function refusalRouteChecks(routePlan = {}) {
  return [
    check(
      "queryRoute",
      "fail",
      "查询范围",
      "Query scope",
      "问题超出当前知识库范围，已在检索前拒绝。",
      "The question is outside the current knowledge-base scope and was refused before retrieval."
    ),
    check(
      "citations",
      "pass",
      "引用边界",
      "Citation boundary",
      "拒答结果没有携带无关引用。",
      "The refusal did not include unrelated citations."
    ),
    check(
      "answer",
      "fail",
      "回答生成",
      "Answer generation",
      routePlan.contract?.refusal?.status === "out_of_scope" ? "越界问题不会生成答案。" : "当前问题没有足够证据生成答案。",
      routePlan.contract?.refusal?.status === "out_of_scope" ? "Out-of-scope questions do not generate answers." : "The question does not have enough evidence to generate an answer."
    )
  ];
}

async function answerK12CatalogRoute(state, options = {}) {
  if (!isK12QueryContext(state, options)) return null;
  const question = String(options.question || options.query || options.draft?.["ask.question"] || "").trim();
  if (!question) return null;
  const routeResult = await retrieveQueryEvidence(state, { question, template: defaultTemplateId });
  if (!shouldUseK12CatalogRoute(routeResult)) return null;

  const setupState = readSetupState(state);
  const strategy = buildValidationStrategy(setupState);
  const template = getTemplate(defaultTemplateId);
  const constraints = extractK12QueryConstraints(question);
  const queryPlan = buildK12CatalogQueryPlan(routeResult, strategy, template, constraints);
  const initialResult = validationResultFromK12CatalogRoute(routeResult, queryPlan, constraints);
  const validationRun = buildK12CatalogValidationRun(routeResult, initialResult, queryPlan, strategy, template);
  const modelProvider = routeResult.status === "evidence_found" ? await readAliyunModelProvider(state) : null;
  const model = setupState.modelQuality?.organizer || setupState.draft?.["aliyun.services.organizer"] || "qwen-plus";
  const answeredResult = routeResult.status === "evidence_found"
    ? await answerValidationResult(state, initialResult, { modelProvider, model, strategy })
    : initialResult;
  const answerRun = buildAnswerRun(validationRun, [answeredResult], {
    modelProvider,
    model
  });
  const ok = routeResult.status === "evidence_found" && answeredResult.status === "answered";
  return {
    ok,
    status: ok ? "answered" : routeResult.status === "out_of_scope" ? "out_of_scope" : answeredResult.status || "no_answer",
    checks: k12CatalogRouteChecks(routeResult, answeredResult),
    fixes: ok ? [] : answeredResult.fixes || [],
    validationPreview: buildK12CatalogValidationPreview(routeResult, queryPlan, strategy, template),
    validationRun: {
      ...validationRun,
      results: [initialResult]
    },
    answerRun
  };
}

function isK12QueryContext(state, options = {}) {
  const current = listKnowledgeBases(state).current;
  const templateId = String(
    options.template
      || options.draft?.["project.template"]
      || options.draft?.template
      || current?.template
      || ""
  ).trim();
  return templateId === defaultTemplateId;
}

function shouldUseK12CatalogRoute(routeResult = {}) {
  if (routeResult.status === "out_of_scope") return true;
  const intent = routeResult.route?.intent || "";
  if (routeResult.status === "evidence_found" && intent !== "hybrid") return true;
  return routeResult.status === "no_evidence" && new Set([
    "first_lesson_lookup",
    "toc_lookup",
    "unit_lookup",
    "page_lookup",
    "vocabulary_lookup"
  ]).has(intent);
}

function buildK12CatalogQueryPlan(routeResult = {}, strategy = {}, template = {}, constraints = {}) {
  const question = routeResult.query?.question || "";
  return {
    questionKey: "adhoc-1",
    methods: ["domainScope", "structureLookup", "domainObjectLookup", "citation"],
    original: question,
    normalized: normalizeQuestion(question),
    scope: routeResult.query?.scope || describeK12Scope(constraints),
    missingScope: constraints.missing,
    queries: [question],
    subQuestions: [],
    hypothetical: "",
    stepBack: "",
    filter: {
      zh: "先按 K12 教材范围和结构对象过滤。",
      en: "Filter by K12 textbook scope and structured objects first."
    },
    rerank: false,
    citationRequired: true,
    noAnswerPolicy: "refuse_without_sources",
    route: {
      intent: routeResult.route?.intent || "",
      source: "catalog",
      tableOrder: routeResult.route?.tableOrder || []
    },
    template: {
      id: template.id || defaultTemplateId,
      title: template.title || null
    },
    strategyProfile: strategy.profile || ""
  };
}

function validationResultFromK12CatalogRoute(routeResult = {}, queryPlan = {}, constraints = {}) {
  const passed = routeResult.status === "evidence_found";
  const outOfScope = routeResult.status === "out_of_scope";
  const citations = (routeResult.citations || []).map((citation) => enrichK12CatalogCitation(citation, constraints));
  return {
    key: "adhoc-1",
    source: "adHoc",
    question: routeResult.query?.question || queryPlan.original || "",
    queryPlan,
    scope: routeResult.query?.scope || describeK12Scope(constraints),
    rejectedMatches: [],
    status: passed ? "passed" : "failed",
    answerStatus: passed ? "evidence_found" : routeResult.status || "no_evidence",
    citationStatus: passed ? "pass" : "missing",
    confidence: passed ? 0.93 : 0,
    message: routeResult.message || (passed
      ? { zh: "已找到符合问题范围的 K12 结构证据。", en: "K12 structure evidence was found." }
      : { zh: "没有找到可引用来源，KnowMesh 不会编造答案。", en: "No citable source was found, so KnowMesh will not invent an answer." }),
    answerPreview: passed
      ? { zh: "当前已验证结构来源可用，正式回答会基于这些来源生成。", en: "Structured sources are verified and can be used to generate the final answer." }
      : outOfScope
        ? { zh: "问题超出当前知识库教材范围，已拒绝回答。", en: "The question is outside the current textbook scope and was refused." }
        : { zh: "缺少 K12 结构证据，暂不生成回答。", en: "No K12 structure evidence is available, so no answer is generated." },
    retrieval: {
      source: "k12Catalog",
      route: routeResult.route?.intent || "",
      tableOrder: routeResult.route?.tableOrder || [],
      scanned: routeResult.retrieval?.scanned || 0,
      acceptedCitations: citations.length,
      rejectedCitations: routeResult.retrieval?.rejected || 0,
      ownedScopes: routeResult.retrieval?.ownedScopes ?? null
    },
    understanding: buildQuestionUnderstanding(constraints, queryPlan),
    feedbackActions: queryFeedbackActions(),
    citations,
    evidencePack: routeResult.evidencePack || evidencePackFromCitations("k12Catalog", citations)
  };
}

function enrichK12CatalogCitation(citation = {}, constraints = {}) {
  const education = citation.metadata?.education || null;
  const enriched = {
    ...citation,
    chunk_id: citation.chunk_id || citation.citationId || citation.id || "",
    document_id: citation.document_id || "",
    version_id: citation.version_id || "",
    title: citation.title || "",
    sourceUri: citation.sourceUri || "",
    pageNumber: citation.pageNumber ?? null,
    education,
    contentType: citation.metadata?.contentType || citation.contentType || "",
    lessonTitle: citation.metadata?.lessonTitle || education?.lesson_title || "",
    lessonOrder: citation.metadata?.lessonOrder || education?.lesson_order_no || null,
    excerpt: citation.excerpt || ""
  };
  return {
    ...enriched,
    trustReasons: catalogCitationTrustReasons(enriched, constraints),
    links: citationLinks(enriched)
  };
}

function catalogCitationTrustReasons(citation = {}, constraints = {}) {
  const reasons = citationTrustReasons(citation, constraints)
    .filter((reason) => reason.key !== "sidecarTrace");
  if (citation.sourceUri || citation.structureNodeId || citation.metadata?.structurePath) {
    reasons.unshift(check(
      "catalogTrace",
      "pass",
      "Catalog 来源可追溯",
      "Catalog source trace",
      "引用来自当前知识库 catalog 的结构或对象锚点。",
      "The citation comes from a structure or object anchor in the current knowledge-base catalog."
    ));
  }
  return reasons.slice(0, 5);
}

function buildK12CatalogValidationRun(routeResult = {}, result = {}, queryPlan = {}, strategy = {}, template = {}) {
  const passed = result.status === "passed" ? 1 : 0;
  const failed = passed ? 0 : 1;
  return {
    template: {
      id: template.id || defaultTemplateId,
      title: template.title || { zh: "K12 教材知识库", en: "K12 Textbook Knowledge Base" }
    },
    strategy,
    source: {
      kind: "k12Catalog",
      path: "catalog://k12-query-router",
      label: { zh: "K12 结构与对象目录", en: "K12 structure and object catalog" }
    },
    summary: {
      totalQuestions: 1,
      templateQuestions: 0,
      adHocQuestions: 1,
      passed,
      failed,
      citationPass: passed,
      citationMissing: failed,
      reviewRequired: failed
    },
    rules: [
      rule("scope", "范围先行", "Scope first", "K12 问题先按教材范围判断，越界先拒绝。", "K12 questions are scoped first; out-of-scope questions are refused before retrieval."),
      rule("structure", "结构优先", "Structure first", "目录、课文、词语、公式和练习先查 catalog 结构对象。", "TOC, lessons, vocabulary, formulas, and exercises use catalog structures first."),
      rule("citation", "必须有引用", "Citation required", "回答必须回到资料、页码或结构锚点。", "Answers must trace back to source, page, or structure anchor.")
    ],
    queryPlans: [queryPlan],
    results: [result],
    artifacts: [],
    route: routeResult.route || null
  };
}

function buildK12CatalogValidationPreview(routeResult = {}, queryPlan = {}, strategy = {}, template = {}) {
  return {
    template: {
      id: template.id || defaultTemplateId,
      title: template.title || null
    },
    strategy,
    summary: {
      totalQuestions: 1,
      templateQuestions: 0,
      adHocQuestions: 1,
      includeTemplateQuestions: false,
      ready: routeResult.status === "evidence_found"
    },
    rules: [
      rule("scope", "范围先行", "Scope first", "K12 问题先按教材范围判断，越界先拒绝。", "K12 questions are scoped first; out-of-scope questions are refused before retrieval."),
      rule("structure", "结构优先", "Structure first", "先查 K12 结构对象，再按需要回落到普通检索。", "K12 structured objects are checked before general retrieval.")
    ],
    queryPlans: [queryPlan],
    questions: [{
      key: "adhoc-1",
      source: "adHoc",
      question: routeResult.query?.question || "",
      queryPlan,
      status: routeResult.status === "evidence_found" ? "passed" : "blocked",
      citationStatus: routeResult.status === "evidence_found" ? "pass" : "missing",
      message: routeResult.message || null
    }]
  };
}

function k12CatalogRouteChecks(routeResult = {}, answeredResult = {}) {
  return [
    check(
      "queryRoute",
      routeResult.status === "out_of_scope" ? "fail" : "pass",
      "K12 查询路由",
      "K12 query route",
      routeResult.status === "out_of_scope"
        ? "问题超出当前 K12 知识库范围，已拒绝检索。"
        : `已选择 ${routeResult.route?.intent || "catalog"} 路由。`,
      routeResult.status === "out_of_scope"
        ? "The question is outside the current K12 knowledge-base scope and retrieval was refused."
        : `${routeResult.route?.intent || "catalog"} route was selected.`
    ),
    check(
      "catalogEvidence",
      routeResult.status === "evidence_found" ? "pass" : "fail",
      "Catalog 证据",
      "Catalog evidence",
      routeResult.status === "evidence_found"
        ? `已找到 ${routeResult.citations?.length || 0} 条结构化引用。`
        : "没有找到可用于回答的结构化引用。",
      routeResult.status === "evidence_found"
        ? `${routeResult.citations?.length || 0} structured citation(s) found.`
        : "No structured citation was found for answering."
    ),
    check(
      "answer",
      answeredResult.status === "answered" ? "pass" : answeredResult.status === "model_unavailable" ? "warn" : "fail",
      "回答生成",
      "Answer generation",
      answeredResult.status === "answered"
        ? "已基于结构化引用生成答案。"
        : answeredResult.status === "model_unavailable"
          ? "已有结构化引用，但还需要配置模型服务。"
          : "本次没有生成回答。",
      answeredResult.status === "answered"
        ? "The answer was generated from structured citations."
        : answeredResult.status === "model_unavailable"
          ? "Structured citations were found, but model service still needs configuration."
          : "No answer was generated."
    )
  ];
}

async function answerStructureCatalogRoute(state, options = {}) {
  if (isK12QueryContext(state, options)) return null;
  const question = String(options.question || options.query || options.draft?.["ask.question"] || "").trim();
  if (!question) return null;
  const routePlan = planQueryRoute(state, { question, template: options.template });
  if (routePlan.route?.key !== "structureCatalog") return null;
  const routeResult = await retrieveQueryEvidence(state, { question, template: options.template || "general-docs" });
  if (routeResult.status !== "evidence_found" || routeResult.retrieval?.source !== "structureCatalog") return null;

  const setupState = readSetupState(state);
  const strategy = buildValidationStrategy(setupState);
  const queryPlan = buildStructureCatalogQueryPlan(routePlan, routeResult, question);
  const initialResult = validationResultFromStructureCatalogRoute(routeResult, queryPlan);
  const validationRun = buildStructureCatalogValidationRun(routePlan, routeResult, initialResult, queryPlan, strategy);
  const modelProvider = await readAliyunModelProvider(state);
  const model = setupState.modelQuality?.organizer || setupState.draft?.["aliyun.services.organizer"] || "qwen-plus";
  const answeredResult = await answerValidationResult(state, initialResult, { modelProvider, model, strategy });
  const answerRun = buildAnswerRun(validationRun, [answeredResult], {
    modelProvider,
    model
  });
  const ok = answeredResult.status === "answered";
  return {
    ok,
    status: ok ? "answered" : answeredResult.status || "no_answer",
    checks: structureCatalogRouteChecks(routeResult, answeredResult),
    fixes: ok ? [] : answeredResult.fixes || [],
    validationRun,
    answerRun
  };
}

function buildStructureCatalogQueryPlan(routePlan = {}, routeResult = {}, question = "") {
  return {
    questionKey: "adhoc-1",
    methods: ["structureLookup", "citation"],
    original: question,
    normalized: normalizeQuestion(question),
    scope: routePlan.scope?.summary || { zh: "按当前知识库检索", en: "Search within the current knowledge base" },
    missingScope: {},
    queries: [question],
    subQuestions: [],
    hypothetical: "",
    stepBack: "",
    filter: null,
    rerank: false,
    citationRequired: true,
    noAnswerPolicy: "refuse_without_sources",
    route: {
      intent: routeResult.route?.intent || routePlan.intent || "",
      source: "structureCatalog",
      tableOrder: routeResult.route?.tableOrder || []
    }
  };
}

function validationResultFromStructureCatalogRoute(routeResult = {}, queryPlan = {}) {
  const citations = (routeResult.citations || []).map(enrichStructureCatalogCitation);
  return {
    key: "adhoc-1",
    source: "adHoc",
    question: queryPlan.original || "",
    queryPlan,
    scope: queryPlan.scope,
    rejectedMatches: [],
    status: "passed",
    answerStatus: "evidence_found",
    citationStatus: "pass",
    confidence: 0.9,
    message: routeResult.message || { zh: "已找到结构化引用。", en: "Structured citation found." },
    answerPreview: {
      zh: "当前已验证结构来源可用，正式回答会基于这些来源生成。",
      en: "Structured sources are verified and can be used to generate the final answer."
    },
    retrieval: {
      source: "structureCatalog",
      route: routeResult.route?.intent || "structure_lookup",
      tableOrder: routeResult.route?.tableOrder || [],
      scanned: routeResult.retrieval?.scanned || 0,
      acceptedCitations: citations.length,
      rejectedCitations: routeResult.retrieval?.rejected || 0
    },
    understanding: {
      kind: "general",
      summary: queryPlan.scope,
      items: [],
      ambiguities: [],
      filter: {}
    },
    feedbackActions: queryFeedbackActions(),
    citations,
    evidencePack: routeResult.evidencePack || evidencePackFromCitations("structureCatalog", citations)
  };
}

function enrichStructureCatalogCitation(citation = {}) {
  const enriched = {
    ...citation,
    chunk_id: citation.chunk_id || citation.citationId || citation.id || "",
    document_id: citation.document_id || "",
    version_id: citation.version_id || "",
    title: citation.title || "",
    sourceUri: citation.sourceUri || "",
    pageNumber: citation.pageNumber ?? null,
    education: null,
    contentType: citation.metadata?.contentType || citation.contentType || "",
    lessonTitle: "",
    lessonOrder: null,
    excerpt: citation.excerpt || ""
  };
  return {
    ...enriched,
    trustReasons: catalogCitationTrustReasons(enriched, {}),
    links: citationLinks(enriched)
  };
}

function buildStructureCatalogValidationRun(routePlan = {}, routeResult = {}, result = {}, queryPlan = {}, strategy = {}) {
  return {
    template: routePlan.knowledgeBase?.template ? { id: routePlan.knowledgeBase.template, title: routePlan.knowledgeBase.name || "" } : { id: "general-docs", title: "" },
    strategy,
    source: {
      kind: "structureCatalog",
      path: "catalog://structure_nodes",
      label: { zh: "结构目录", en: "Structure catalog" }
    },
    summary: {
      totalQuestions: 1,
      templateQuestions: 0,
      adHocQuestions: 1,
      passed: 1,
      failed: 0,
      citationPass: 1,
      citationMissing: 0,
      reviewRequired: 0
    },
    rules: [
      rule("structure", "结构优先", "Structure first", "章节、页码和对象定位先查 catalog 结构。", "Section, page, and object lookups use catalog structures first."),
      rule("citation", "必须有引用", "Citation required", "回答必须回到资料、页码或结构锚点。", "Answers must trace back to source, page, or structure anchor.")
    ],
    queryPlans: [queryPlan],
    results: [result],
    artifacts: [],
    route: routeResult.route || null
  };
}

function structureCatalogRouteChecks(routeResult = {}, answeredResult = {}) {
  return [
    check(
      "queryRoute",
      "pass",
      "结构查询路由",
      "Structure query route",
      "已选择 catalog 结构查询路由。",
      "Catalog structure query route was selected."
    ),
    check(
      "catalogEvidence",
      routeResult.citations?.length ? "pass" : "fail",
      "Catalog 证据",
      "Catalog evidence",
      routeResult.citations?.length ? `已找到 ${routeResult.citations.length} 条结构化引用。` : "没有找到结构化引用。",
      routeResult.citations?.length ? `${routeResult.citations.length} structured citation(s) found.` : "No structured citation was found."
    ),
    check(
      "answer",
      answeredResult.status === "answered" ? "pass" : answeredResult.status === "model_unavailable" ? "warn" : "fail",
      "回答生成",
      "Answer generation",
      answeredResult.status === "answered"
        ? "已基于结构化引用生成答案。"
        : answeredResult.status === "model_unavailable"
          ? "已有结构化引用，但还需要配置模型服务。"
          : "本次没有生成回答。",
      answeredResult.status === "answered"
        ? "The answer was generated from structured citations."
        : answeredResult.status === "model_unavailable"
          ? "Structured citations were found, but model service still needs configuration."
          : "No answer was generated."
    )
  ];
}

async function answerValidationResult(state, result, options = {}) {
  const citations = Array.isArray(result.citations) ? result.citations : [];
  if (!citations.length) {
    return {
      ...result,
      status: "no_evidence",
      answer: "",
      message: { zh: "没有找到可引用来源，KnowMesh 不会编造答案。", en: "No citable source was found, so KnowMesh will not invent an answer." },
      missingInfo: [{ zh: "需要先补齐相关资料、元数据或索引。", en: "Add the relevant source, metadata, or index first." }],
      fixes: [{
        key: "missingEvidence",
        step: "/maintain/documents",
        label: { zh: "检查资料", en: "Check documents" },
        message: { zh: "确认这份资料已经进入当前知识库，并重新生成检索数据。", en: "Confirm the source is included in this knowledge base and regenerate search data." }
      }]
    };
  }

  const modelProvider = options.modelProvider;
  if (isPublicSampleKnowledgeBase(state)) {
    const answer = buildPublicSampleAnswer(result);
    if (answer) {
      return {
        ...result,
        status: "answered",
        answer,
        message: { zh: "已基于公开样例引用生成本地答案。", en: "Local answer generated from public sample citations." },
        missingInfo: [],
        fixes: []
      };
    }
  }

  if (!modelProvider?.apiKey || modelProvider.protocol !== "openai-compatible") {
    return {
      ...result,
      status: "model_unavailable",
      answer: "",
      message: { zh: "已找到来源，但还没有可用的模型服务生成答案。", en: "Sources were found, but no usable model service is available to generate an answer." },
      missingInfo: [{ zh: "请先配置并保存阿里百炼模型服务。", en: "Configure and save Model Studio first." }],
      fixes: [{
        key: "modelProviderMissing",
        step: "/setup/aliyun/services",
        label: { zh: "配置模型服务", en: "Configure model service" },
        message: { zh: "保存阿里百炼 API Key 后再生成答案。", en: "Save the Model Studio API Key before generating answers." }
      }]
    };
  }

  try {
    const answer = await generateAnswerFromModel(state, {
      provider: modelProvider,
      model: options.model,
      question: localizedText(result.question),
      scope: localizedText(result.scope),
      citations,
      strategy: options.strategy
    });
    return {
      ...result,
      status: "answered",
      answer,
      message: { zh: "已基于引用生成答案。", en: "Answer generated from citations." },
      missingInfo: [],
      fixes: []
    };
  } catch (error) {
    return {
      ...result,
      status: "model_failed",
      answer: "",
      message: {
        zh: `模型服务没有完成回答生成：${error instanceof Error ? error.message : String(error)}`,
        en: `The model service did not finish answer generation: ${error instanceof Error ? error.message : String(error)}`
      },
      missingInfo: [{ zh: "请检查模型服务配置、额度或网络状态。", en: "Check model service settings, quota, or network status." }],
      fixes: [{
        key: "modelGenerationFailed",
        step: "/setup/aliyun/services",
        label: { zh: "检查模型服务", en: "Check model service" },
        message: { zh: "确认模型服务可用后重新生成答案。", en: "Confirm the model service is usable, then generate the answer again." }
      }]
    };
  }
}

async function generateAnswerFromModel(state, request = {}) {
  const baseUrl = String(request.provider?.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("模型 Base URL 为空。");
  const response = await (state.fetchImpl || fetch)(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${request.provider.apiKey}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      model: request.model || "qwen-plus",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: [
            "你是 KnowMesh 的可信问答生成器。",
            "只能使用用户提供的来源片段回答，不能引入外部知识，不能猜测。",
            "如果来源不足，请明确说明无法确认。",
            "回答要简洁，并在关键结论后标注引用编号，例如 [1]。"
          ].join("\n")
        },
        {
          role: "user",
          content: buildAnswerPrompt(request)
        }
      ]
    })
  });
  const text = await safeResponseText(response);
  if (!response.ok) {
    const data = safeJsonParse(text);
    throw new Error(data?.error?.message || data?.message || text || `模型服务返回 ${response.status}`);
  }
  const data = safeJsonParse(text);
  const answer = data?.choices?.[0]?.message?.content
    || data?.output?.text
    || data?.output?.choices?.[0]?.message?.content
    || "";
  if (!String(answer).trim()) throw new Error("模型服务没有返回答案文本。");
  return String(answer).trim();
}

function buildAnswerPrompt(request = {}) {
  const citations = (request.citations || []).map((citation, index) => {
    const page = citation.pageNumber ? `页码：${citation.pageNumber}` : "页码：未记录";
    const metadataLines = [
      citation.lessonTitle ? `课文：${citation.lessonTitle}` : "",
      citation.lessonOrder ? `单元内课次：${citation.lessonOrder}` : "",
      citation.contentType ? `内容类型：${citation.contentType}` : ""
    ].filter(Boolean);
    return [
      `[${index + 1}] ${citation.title || citation.sourceUri || citation.document_id || "未命名来源"}`,
      page,
      ...metadataLines,
      `位置：${citation.sourceUri || citation.chunk_id || "未记录"}`,
      `片段：${citation.excerpt || ""}`
    ].join("\n");
  }).join("\n\n");
  return [
    `问题：${request.question || ""}`,
    request.scope ? `识别范围：${request.scope}` : "",
    `引用要求：${localizedText(request.strategy?.citation) || "答案必须可追溯到来源。"}`,
    "",
    "可用来源：",
    citations,
    "",
    "请直接回答问题。若上下册都可能相关，请分别说明；如果来源不足，请说清楚缺什么。"
  ].filter((line) => line !== "").join("\n");
}

function buildAnswerRun(validationRun, results, options = {}) {
  const enrichedResults = results.map((item) => ({
    ...item,
    quality: buildAnswerQuality(item)
  }));
  const answered = enrichedResults.filter((item) => item.status === "answered").length;
  const noEvidence = enrichedResults.filter((item) => item.status === "no_evidence").length;
  const modelUnavailable = enrichedResults.filter((item) => item.status === "model_unavailable").length;
  const failed = enrichedResults.filter((item) => item.status === "model_failed").length;
  const withCitations = enrichedResults.filter((item) => Array.isArray(item.citations) && item.citations.length > 0).length;
  const summary = {
    totalQuestions: enrichedResults.length,
    answered,
    noEvidence,
    modelUnavailable,
    failed,
    withCitations
  };
  return {
    template: validationRun.template,
    strategy: validationRun.strategy,
    source: validationRun.source,
    model: {
      provider: options.modelProvider?.provider || "",
      protocol: options.modelProvider?.protocol || "",
      model: options.model || "qwen-plus"
    },
    summary,
    userReport: buildAnswerUserReport(enrichedResults, summary),
    results: enrichedResults,
    artifacts: []
  };
}

function buildAnswerQuality(result = {}) {
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const retrieval = result.retrieval || {};
  const baseChecks = [
    check(
      "citationTrace",
      citations.length ? "pass" : "fail",
      "引用可追溯",
      "Traceable citations",
      citations.length ? `已连接 ${citations.length} 条可追溯来源。` : "没有可追溯来源，不能生成可靠答案。",
      citations.length ? `${citations.length} traceable source(s) are attached.` : "No traceable source is attached, so the answer is not reliable."
    ),
    check(
      "scopeFit",
      result.status === "answered" || citations.length ? "pass" : "fail",
      "范围匹配",
      "Scope fit",
      result.status === "answered"
        ? "检索结果符合本次问题识别出的范围。"
        : retrieval.rejectedCitations
          ? "有部分候选片段被范围或引用规则拦截。"
          : "还没有找到符合范围的片段。",
      result.status === "answered"
        ? "The retrieved result matches the understood scope."
        : retrieval.rejectedCitations
          ? "Some candidates were blocked by scope or citation rules."
          : "No matching scoped snippet was found."
    ),
    check(
      "answerGenerated",
      result.status === "answered" ? "pass" : result.status === "model_unavailable" ? "warn" : "fail",
      "答案生成",
      "Answer generation",
      result.status === "answered"
        ? "已基于引用生成答案。"
        : result.status === "model_unavailable"
          ? "已有来源，但还需要配置模型服务。"
          : "答案还没有生成。",
      result.status === "answered"
        ? "The answer was generated from citations."
        : result.status === "model_unavailable"
          ? "Sources were found, but model service is still required."
          : "No answer was generated yet."
      )
  ];
  const existingKeys = new Set(baseChecks.map((item) => item.key));
  const checks = [
    ...baseChecks,
    ...evaluateQueryQualityGates(result).filter((item) => !existingKeys.has(item.key))
  ];
  const failed = checks.filter((item) => item.status === "fail").length;
  const warnings = checks.filter((item) => item.status === "warn").length;
  const passed = checks.filter((item) => item.status === "pass").length;
  return {
    status: failed ? "needs_attention" : warnings ? "review" : "ready",
    score: Math.round((passed / Math.max(checks.length, 1)) * 100),
    checks,
    nextActions: failed
      ? [{
          key: "reviewDocuments",
          href: "/maintain/documents",
          label: { zh: "检查资料", en: "Review documents" },
          message: { zh: "确认资料范围、元数据和索引是否完整。", en: "Check source scope, metadata, and index completeness." }
        }]
      : [{
          key: "reviewSources",
          href: "/maintain/documents",
          label: { zh: "查看引用资料", en: "Review cited sources" },
          message: { zh: "可以从引用跳到资料管理继续维护。", en: "Open cited sources in document management for maintenance." }
        }]
  };
}

function buildAnswerUserReport(results = [], summary = {}) {
  const needsAttention = Number(summary.noEvidence || 0) + Number(summary.modelUnavailable || 0) + Number(summary.failed || 0);
  const ready = needsAttention === 0 && Number(summary.answered || 0) > 0;
  const citations = results.reduce((count, item) => count + (Array.isArray(item.citations) ? item.citations.length : 0), 0);
  const retrievalSources = new Set(results.map((item) => item.retrieval?.source).filter(Boolean));
  const usesK12Catalog = retrievalSources.has("k12Catalog");
  const usesAliyunVector = retrievalSources.has("aliyunVector");
  return {
    status: ready ? "ready" : "needs_attention",
    title: ready
      ? { zh: "问答结果可用", en: "Answer ready" }
      : { zh: "问答结果需要处理", en: "Answer needs attention" },
    summary: ready
      ? { zh: "答案已基于云端检索和 OSS Sidecar 引用生成。", en: "The answer was generated from cloud retrieval and OSS Sidecar citations." }
      : { zh: "仍有问题缺少来源、模型或可靠答案。", en: "Some questions still lack sources, model access, or reliable answers." },
    bullets: [
      check(
        "sourceCoverage",
        citations ? "pass" : "fail",
        "来源覆盖",
        "Source coverage",
        citations ? `已找到 ${citations} 条可引用来源。` : "没有可引用来源。",
        citations ? `${citations} citable source(s) found.` : "No citable source was found."
      ),
      check(
        "retrievalRoute",
        retrievalSources.size ? "pass" : "warn",
        "检索路径",
        "Retrieval route",
        usesK12Catalog
          ? "已使用 K12 结构与对象目录返回候选引用。"
          : usesAliyunVector
            ? "已使用阿里云向量 Bucket 返回的候选片段。"
            : "当前结果来自本地 catalog 或索引片段。",
        usesK12Catalog
          ? "Candidates came from the K12 structure and object catalog."
          : usesAliyunVector
            ? "Candidates came from Aliyun Vector Bucket."
            : "The result came from local catalog or index records."
      ),
      check(
        "documentManagement",
        results.some((item) => (item.citations || []).some((citation) => citation.links?.documentHref)) ? "pass" : "warn",
        "资料入口",
        "Source links",
        "引用已连接到资料管理，后续可以定位、排除或更新原资料。",
        "Citations are linked to document management for locate, exclude, or update workflows."
      )
    ],
    nextActions: ready
      ? [
          { key: "askMore", href: "/use/ask", label: { zh: "继续提问", en: "Ask another question" }, message: { zh: "继续用当前知识库验证问题。", en: "Keep validating questions with this knowledge base." } },
          { key: "reviewSources", href: "/maintain/documents", label: { zh: "查看引用资料", en: "Review cited sources" }, message: { zh: "检查引用对应的原始资料和资料状态。", en: "Review cited source files and source status." } }
        ]
      : [
          { key: "reviewDocuments", href: "/maintain/documents", label: { zh: "检查资料", en: "Review documents" }, message: { zh: "补齐资料范围、元数据或索引后再验证。", en: "Fix source scope, metadata, or indexing before validating again." } },
          { key: "maintenance", href: "/maintain/diagnostics", label: { zh: "维护诊断", en: "Maintenance diagnostics" }, message: { zh: "检查契约、索引和服务状态。", en: "Check contracts, indexes, and service status." } }
        ]
  };
}

function latestJobFromState(state) {
  return latestJob(state).job || null;
}

function jobReadyForValidation(job) {
  if (!job || job.status !== "completed") return false;
  const tasks = Array.isArray(job.tasks) ? job.tasks : [];
  if (!tasks.length || tasks.some((item) => item.status === "skipped")) return false;
  return tasks.some((item) => item.key === "index" && item.status === "completed");
}

function resolveValidationSource(state, job) {
  if (!job) return null;
  const artifactPath = (key) => (job.artifacts || []).find((item) => item.key === key && item.path)?.path || "";
  const workspaceRoot = String(job.summary?.workspaceRoot || "").trim();
  const activeManifest = readActiveCatalogManifest(state)
    || readActiveManifest(artifactPath("activeManifest") || (workspaceRoot ? path.join(workspaceRoot, "manifests", "active-manifest.json") : ""));
  if (job.mode === "aliyun" && activeManifest?.target?.provider === "aliyun-vector" && activeManifest?.sidecar?.authoritativeStore === "oss-sidecar") {
    return {
      kind: "aliyunVector",
      path: activeManifest.path,
      label: { zh: "OSS 向量 Bucket", en: "OSS Vector Bucket" },
      target: activeManifest.target,
      sidecar: activeManifest.sidecar,
      reportPath: workspaceRoot ? path.join(workspaceRoot, "artifacts", "reports", "query-evidence.report.json") : ""
    };
  }
  if (job.mode === "aliyun" && activeManifest?.target?.provider === "aliyun-vector") {
    return {
      kind: "metadataContractMissing",
      path: activeManifest.path,
      label: { zh: "缺少 OSS Sidecar", en: "Missing OSS Sidecar" },
      target: activeManifest.target,
      reportPath: workspaceRoot ? path.join(workspaceRoot, "artifacts", "reports", "query-evidence.report.json") : ""
    };
  }
  const catalogSearchProbe = searchCatalog(state, { limit: 1, purpose: "queryEvidence" });
  if (catalogSearchProbe.ok && catalogSearchProbe.total > 0) {
    return {
      kind: "catalogSearch",
      path: "catalog://search",
      label: { zh: "Catalog 证据搜索", en: "Catalog evidence search" },
      state,
      knowledgeBaseId: currentKnowledgeBaseId(state),
      catalogTotal: catalogSearchProbe.total,
      reportPath: workspaceRoot ? path.join(workspaceRoot, "artifacts", "reports", "query-evidence.report.json") : ""
    };
  }
  const candidates = [
    sourceCandidate("localChunks", artifactPath("localChunks"), "本地分段", "Local chunks"),
    sourceCandidate("localChunks", workspaceRoot ? path.join(workspaceRoot, "artifacts", "chunks", "local-chunks.jsonl") : "", "本地分段", "Local chunks"),
    sourceCandidate("pendingIndexRecords", artifactPath("pendingIndexRecords"), "待写入索引记录", "Pending index records"),
    sourceCandidate("pendingIndexRecords", workspaceRoot ? path.join(workspaceRoot, "artifacts", "index_records", "index-records.pending.jsonl") : "", "待写入索引记录", "Pending index records")
  ];
  const fileSource = candidates.find((item) => fileHasContent(item.path));
  if (fileSource) return fileSource;
  const catalogChunks = readCatalogIndexChunks(state);
  if (!catalogChunks.length) return null;
  return {
    kind: "catalogIndexRecords",
    path: "catalog://index_records",
    label: { zh: "Catalog 索引记录", en: "Catalog index records" },
    chunks: catalogChunks,
    reportPath: workspaceRoot ? path.join(workspaceRoot, "artifacts", "reports", "query-evidence.report.json") : ""
  };
}

function readActiveManifest(file) {
  if (!fileHasContent(file)) return null;
  const data = safeJsonParse(fs.readFileSync(file, "utf8"));
  if (!data) return null;
  return { ...data, path: file };
}

function readActiveCatalogManifest(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return null;
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const row = db.prepare(`
      SELECT
        b.build_id,
        b.status AS build_status,
        b.active,
        b.summary_json AS build_summary_json,
        r.status AS release_status,
        r.manifest_path,
        r.summary_json AS release_summary_json
      FROM build_versions b
      LEFT JOIN release_manifests r ON r.release_id = (
        SELECT release_id
        FROM release_manifests
        WHERE build_id = b.build_id
        ORDER BY
          CASE status
            WHEN 'active' THEN 0
            WHEN 'published' THEN 1
            WHEN 'ready' THEN 2
            WHEN 'draft' THEN 3
            ELSE 4
          END ASC,
          updated_at DESC,
          release_id ASC
        LIMIT 1
      )
      WHERE b.active = 1 OR b.status = 'active'
      ORDER BY b.active DESC, b.updated_at DESC, b.build_id ASC
      LIMIT 1
    `).get();
    if (!row) return null;
    const buildSummary = safeJsonParse(row.build_summary_json) || {};
    const releaseSummary = safeJsonParse(row.release_summary_json) || {};
    const target = releaseSummary.target || buildSummary.target || null;
    if (!target) return null;
    return {
      kind: "knowmesh.activeManifest",
      status: row.release_status || row.build_status || "active",
      datasetVersionId: releaseSummary.datasetVersionId || buildSummary.datasetVersionId || row.build_id || "",
      target,
      sidecar: releaseSummary.sidecar || buildSummary.sidecar || null,
      quality: releaseSummary.quality || buildSummary.quality || null,
      path: row.manifest_path || `catalog://build_versions/${row.build_id}`
    };
  } finally {
    db.close();
  }
}

function sourceCandidate(kind, file, zh, en) {
  return {
    kind,
    path: String(file || ""),
    label: { zh, en }
  };
}

function publicVectorTarget(target = {}) {
  return {
    provider: target.provider || "",
    region: target.region || "",
    bucket: target.bucket || "",
    index: target.index || ""
  };
}

function publicSidecarContract(sidecar = {}) {
  return {
    authoritativeStore: sidecar.authoritativeStore || "",
    region: sidecar.region || "",
    bucket: sidecar.bucket || "",
    manifestUri: sidecar.manifestUri || ""
  };
}

function compactVectorFilter(filter) {
  const output = {};
  const conditions = Array.isArray(filter?.$and) ? filter.$and : filter ? [filter] : [];
  for (const condition of conditions) {
    const [key, value] = Object.entries(condition || {})[0] || [];
    if (!key) continue;
    const exact = value && typeof value === "object" && "$eq" in value ? value.$eq : value;
    if (exact !== undefined && exact !== null && exact !== "") output[key] = exact;
  }
  return output;
}

async function validateQuestionsFromAliyunVector(state, preview, source) {
  const credentials = await readAliyunCredentials(state);
  const modelProvider = await readAliyunModelProvider(state);
  const setupState = readSetupState(state);
  const trackers = preview.validationPreview.questions.map((question) => {
    const queryPlan = question.queryPlan || buildQuestionPlan(question, preview.validationPreview.strategy, preview.validationPreview.template);
    const questionText = localizedText(question.question);
    const searchableText = [
      questionText,
      ...(queryPlan.queries || []),
      ...(queryPlan.subQuestions || []),
      queryPlan.hypothetical || "",
      queryPlan.stepBack || ""
    ].join(" ");
    const terms = tokenize(searchableText);
    const constraints = extractK12QueryConstraints(questionText);
    return {
      question,
      queryPlan,
      terms,
      constraints,
      matches: [],
      rejected: [],
      retrieval: {
        source: "aliyunVector",
        target: publicVectorTarget(source.target || {}),
        sidecarStore: source.sidecar?.authoritativeStore || "",
        sidecarBucket: source.sidecar?.bucket || "",
        filter: {},
        cloudMatches: 0
      }
    };
  });
  let scanned = 0;

  if (!credentials?.accessKeyId || !credentials?.accessKeySecret || !modelProvider?.apiKey) {
    return {
      scanned,
      results: trackers.map((tracker) => ({
        ...validationResultFromMatches(tracker),
        message: { zh: "缺少阿里云或百炼配置，无法执行云端验证。", en: "Aliyun or Model Studio configuration is missing, so cloud validation cannot run." }
      }))
    };
  }

  const sidecarCache = new Map();
  for (const tracker of trackers) {
    const embedding = await embedValidationQuestion(modelProvider, localizedText(tracker.question.question), {
      fetchImpl: state.fetchImpl,
      model: setupState.modelQuality?.embedding || setupState.draft?.["aliyun.services.embedding"] || "text-embedding-v4"
    });
    if (!embedding.length) continue;
    const filter = vectorFilterForK12Constraints(tracker.constraints);
    tracker.retrieval.filter = compactVectorFilter(filter);
    const query = await queryVectors(credentials, {
      region: source.target.region,
      bucket: source.target.bucket,
      indexName: source.target.index,
      accountId: source.target.accountId,
      vector: embedding,
      topK: 10,
      filter,
      returnMetadata: true,
      returnDistance: true,
      fetchImpl: state.fetchImpl
    });
    if (!query.ok) continue;
    tracker.retrieval.cloudMatches += query.vectors.length;
    scanned += query.vectors.length;
    for (const vector of query.vectors) {
      if (!k12MetadataMatches(vector.metadata, tracker.constraints)) {
        pushRejectedMatch(tracker, vector, "vector_metadata_mismatch");
        continue;
      }
      const chunk = await resolveSidecarChunk(credentials, vector.metadata?.sidecar, {
        fetchImpl: state.fetchImpl,
        defaultRegion: source.sidecar?.region || source.target.region,
        cache: sidecarCache
      });
      if (!chunk) {
        pushRejectedMatch(tracker, vector, "sidecar_missing");
        continue;
      }
      if (!k12MetadataMatches(chunk.metadata, tracker.constraints)) {
        pushRejectedMatch(tracker, { ...vector, chunk }, "sidecar_scope_mismatch");
        continue;
      }
      const score = scoreChunk(chunk, tracker) + Math.max(1, 10 - Number(vector.distance || 0));
      if (score > 0) pushTopMatch(tracker.matches, { chunk, score });
    }
  }

  return {
    scanned,
    results: trackers.map((tracker) => validationResultFromMatches(tracker))
  };
}

async function embedValidationQuestion(modelProvider, question, options = {}) {
  const baseUrl = String(modelProvider.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) return [];
  const response = await (options.fetchImpl || fetch)(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${modelProvider.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || "text-embedding-v4",
      input: [question]
    })
  });
  const data = safeJsonParse(await response.text());
  if (!response.ok) return [];
  const embedding = data?.data?.[0]?.embedding || data?.output?.embeddings?.[0]?.embedding || data?.embeddings?.[0];
  return Array.isArray(embedding) ? embedding : [];
}

async function resolveSidecarChunk(credentials, sidecarUri, options = {}) {
  const parsed = parseOssUriWithFragment(sidecarUri);
  if (!parsed) return null;
  const cacheKey = `${parsed.bucket}/${parsed.objectKey}`;
  let records = options.cache?.get(cacheKey);
  if (!records) {
    const result = await getObject(credentials, {
      bucket: parsed.bucket,
      region: options.defaultRegion || "cn-hangzhou",
      objectKey: parsed.objectKey,
      fetchImpl: options.fetchImpl
    });
    if (!result.ok) return null;
    records = String(result.text || "")
      .split(/\r?\n/g)
      .map((line) => safeJsonParse(line.trim()))
      .filter(Boolean);
    options.cache?.set(cacheKey, records);
  }
  const chunkId = decodeURIComponent(parsed.fragment || "");
  const record = records.find((item) => String(item.chunk_id || item.id || "") === chunkId);
  if (!record) return null;
  return parseValidationChunk(JSON.stringify(record));
}

function fileHasContent(file) {
  try {
    return Boolean(file) && fs.existsSync(file) && fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

async function validateQuestionsFromSource(preview, source) {
  const trackers = preview.validationPreview.questions.map((question) => {
    const queryPlan = question.queryPlan || buildQuestionPlan(question, preview.validationPreview.strategy, preview.validationPreview.template);
    const questionText = localizedText(question.question);
    const searchableText = [
      localizedText(question.question),
      ...(queryPlan.queries || []),
      ...(queryPlan.subQuestions || []),
      queryPlan.hypothetical || "",
      queryPlan.stepBack || ""
    ].join(" ");
    const terms = tokenize(searchableText);
    const constraints = extractK12QueryConstraints(questionText);
    return { question, queryPlan, terms, constraints, matches: [], rejected: [] };
  });
  let scanned = 0;

  if (source?.kind === "catalogSearch") {
    return validateQuestionsFromCatalogSearch(trackers, source);
  }

  for await (const chunk of readValidationChunks(source)) {
    scanned += 1;
    for (const tracker of trackers) {
      const score = scoreChunk(chunk, tracker);
      if (score > 0) pushTopMatch(tracker.matches, { chunk, score });
    }
  }

  return {
    scanned,
    results: trackers.map((tracker) => validationResultFromMatches(tracker))
  };
}

function validateQuestionsFromCatalogSearch(trackers, source) {
  let scanned = 0;
  for (const tracker of trackers) {
    const result = searchCatalog(source.state, {
      knowledgeBaseId: source.knowledgeBaseId,
      query: catalogSearchTextForTracker(tracker),
      purpose: "queryEvidence",
      limit: 24
    });
    const items = Array.isArray(result.items) ? result.items : [];
    tracker.retrieval = {
      source: "catalogSearch",
      catalogMatches: Number(result.total || 0),
      scanned: items.length
    };
    scanned += items.length;
    for (const item of items) {
      const chunk = catalogSearchItemToValidationChunk(item);
      if (!chunk) continue;
      const score = scoreChunk(chunk, tracker);
      if (score > 0) pushTopMatch(tracker.matches, { chunk, score });
    }
  }
  return {
    scanned,
    results: trackers.map((tracker) => validationResultFromMatches(tracker))
  };
}

function catalogSearchTextForTracker(tracker) {
  const queryPlan = tracker.queryPlan || {};
  return [
    queryPlan.normalized || queryPlan.original || localizedText(tracker.question?.question),
    ...(queryPlan.queries || []),
    ...(queryPlan.subQuestions || []),
    queryPlan.hypothetical || "",
    queryPlan.stepBack || ""
  ].map((item) => String(item || "").trim()).filter(Boolean).join(" ");
}

function catalogSearchItemToValidationChunk(item = {}) {
  const excerpt = String(item.excerpt || "").trim();
  if (!excerpt) return null;
  const citation = item.citation || {};
  const source = item.source || {};
  const metadata = item.metadata || {};
  const pageNumber = citation.pageNumber ?? item.pageNumber ?? metadata.pageStart ?? null;
  const sourceUri = citation.sourceUri || source.uri || metadata.sourceUri || source.relativePath || "";
  return {
    chunk_id: item.chunkId || "",
    document_id: item.documentId || "",
    version_id: metadata.versionId || "",
    text: excerpt,
    sourceUri,
    sourceParts: [],
    metadata: {
      ...metadata,
      title: item.title || citation.sourceLabel || "",
      sourceUri,
      sourceType: source.type || metadata.sourceType || "",
      pageNumber,
      contentType: metadata.contentType || ""
    }
  };
}

async function* readValidationChunks(source) {
  if (source?.kind === "catalogChunks" || source?.kind === "catalogIndexRecords") {
    for (const chunk of Array.isArray(source.chunks) ? source.chunks : []) {
      if (chunk) yield chunk;
    }
    return;
  }
  if (!source?.path || !fs.existsSync(source.path)) return;
  const input = fs.createReadStream(source.path, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const chunk = parseValidationChunk(line);
      if (chunk) yield chunk;
    }
  } finally {
    lines.close();
  }
}

function parseValidationChunk(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const record = safeJsonParse(trimmed);
  if (!record || record.active === false || record.quality?.writeEnabled === false) return null;
  const text = String(record.text || "").trim();
  if (!text) return null;
  delete record.embedding;
  const metadata = record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  return {
    chunk_id: record.chunk_id || record.id || "",
    document_id: record.document_id || "",
    version_id: record.version_id || record.datasetVersionId || "",
    text,
    sourceUri: record.sourceUri || metadata.sourceUri || "",
    sourceParts: Array.isArray(record.sourceParts) ? record.sourceParts : [],
    metadata: {
      ...metadata,
      sourceUri: record.sourceUri || metadata.sourceUri || "",
      title: metadata.title || record.title || "",
      pageNumber: metadata.pageNumber ?? record.page_start ?? record.pageStart ?? null
    }
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pushTopMatch(matches, match) {
  if (matches.some((item) => item.chunk.chunk_id && item.chunk.chunk_id === match.chunk.chunk_id)) return;
  matches.push(match);
  matches.sort((left, right) => right.score - left.score);
  if (matches.length > 8) matches.length = 8;
}

function pushRejectedMatch(tracker, item, reason) {
  tracker.rejected.push({
    reason,
    key: item.key || item.chunk?.chunk_id || "",
    metadata: item.metadata || item.chunk?.metadata || {},
    sourceUri: item.chunk?.sourceUri || item.metadata?.sourceUri || "",
    title: item.chunk?.metadata?.title || item.metadata?.title || ""
  });
  if (tracker.rejected.length > 8) tracker.rejected.length = 8;
}

function validationResultFromMatches(tracker) {
  const matches = preferredEvidenceMatches(tracker);
  const passed = matches.length > 0;
  const rejected = tracker.rejected || [];
  const blockedByScope = !passed && rejected.length > 0;
  const citations = matches.map(({ chunk }) => citationFromChunk(chunk, tracker.terms, tracker.constraints));
  return {
    key: tracker.question.key,
    source: tracker.question.source,
    question: tracker.question.question,
    queryPlan: tracker.queryPlan,
    scope: describeK12Scope(tracker.constraints),
    rejectedMatches: rejected,
    status: passed ? "passed" : "failed",
    answerStatus: passed ? "evidence_found" : "no_evidence",
    citationStatus: passed ? "pass" : "missing",
    confidence: passed ? Math.min(0.95, 0.58 + matches[0].score * 0.08) : 0,
    message: passed
      ? { zh: "已找到符合问题范围的可引用来源。", en: "A citable source within the requested scope was found." }
      : blockedByScope
        ? { zh: "检索到的候选来源与问题范围不一致，已拦截，暂不生成答案。", en: "Candidate sources did not match the requested scope, so they were blocked and no answer is generated." }
        : { zh: "没有找到足够匹配的知识库片段，不能通过。", en: "No sufficiently matching excerpt was found, so this cannot pass." },
    answerPreview: passed
      ? {
          zh: "当前已验证来源可用，正式回答会基于这些来源生成。",
          en: "The sources are verified and can be used to generate the final answer."
        }
      : {
          zh: "缺少引用证据，暂不生成回答。",
          en: "No cited evidence is available, so no answer is generated."
        },
    retrieval: tracker.retrieval
      ? {
          ...tracker.retrieval,
          acceptedCitations: matches.length,
          rejectedCitations: rejected.length
        }
      : null,
    understanding: buildQuestionUnderstanding(tracker.constraints, tracker.queryPlan),
    feedbackActions: queryFeedbackActions(),
    citations,
    evidencePack: evidencePackFromCitations("catalogSearch", citations)
  };
}

function evidencePackFromCitations(routeKey, citations = []) {
  return {
    version: queryRouteContractVersion,
    answerPolicy: queryRouteAnswerPolicy,
    routeKey,
    source: routeKey,
    status: citations.length ? "ready" : "empty",
    items: citations.map((citation) => ({
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
    }))
  };
}

function buildQuestionUnderstanding(constraints = {}, queryPlan = {}) {
  const compact = constraints.compact || {};
  const education = constraints.education || {};
  const [stageCode, gradeCode, subjectCode] = String(compact.fgs || "").split("|");
  const missingVolume = Boolean(constraints.missing?.volume);
  const items = [
    understandingItem("stage", "学段", "Stage", education.stage || stageLabel(stageCode)),
    understandingItem("grade", "年级", "Grade", education.grade || gradeLabel(gradeCode)),
    understandingItem("subject", "学科", "Subject", education.subject || subjectLabel(subjectCode)),
    understandingItem("publisher", "版本", "Edition", education.publisher || publisherLabel(compact.pub)),
    understandingItem(
      "volume",
      "册别",
      "Volume",
      education.volume || volumeLabel(compact.vol) || (missingVolume ? "未指定，将同时查看上册和下册" : "")
    ),
    understandingItem("unit", "单元", "Unit", education.unit_no ? `第${education.unit_no}单元` : unitLabel(compact.unit)),
    understandingItem("lesson", "课次", "Lesson", education.lesson_order_no ? `第${education.lesson_order_no}课` : "")
  ].filter(Boolean);

  const ambiguities = [
    missingVolume
      ? check(
          "volume",
          "warn",
          "册别未指定",
          "Volume not specified",
          "会同时查看上册和下册，避免漏掉符合条件的课文。",
          "Both volumes will be checked so matching lessons are not missed."
        )
      : null
  ].filter(Boolean);

  return {
    kind: "k12",
    summary: queryPlan.scope || describeK12Scope(constraints),
    items,
    ambiguities,
    filter: compact
  };
}

function understandingItem(key, zhLabel, enLabel, value) {
  const text = String(value || "").trim();
  if (!text) return null;
  return {
    key,
    label: { zh: zhLabel, en: enLabel },
    value: { zh: text, en: text }
  };
}

function stageLabel(value = "") {
  return { primary: "小学", junior: "初中", senior: "高中" }[value] || "";
}

function gradeLabel(value = "") {
  const labels = {
    g1: "一年级",
    g2: "二年级",
    g3: "三年级",
    g4: "四年级",
    g5: "五年级",
    g6: "六年级",
    g7: "七年级",
    g8: "八年级",
    g9: "九年级",
    g10: "高一",
    g11: "高二",
    g12: "高三"
  };
  return labels[value] || "";
}

function subjectLabel(value = "") {
  const labels = {
    chinese: "语文",
    math: "数学",
    english: "英语",
    physics: "物理",
    chemistry: "化学",
    biology: "生物",
    history: "历史",
    geography: "地理",
    politics: "道德与法治",
    science: "科学"
  };
  return labels[value] || "";
}

function publisherLabel(value = "") {
  const labels = {
    tongbian: "统编版",
    renjiao: "人教版",
    pep: "人教版",
    waiyan: "外研社版",
    beishida: "北师大版",
    sujiao: "苏教版"
  };
  return labels[value] || "";
}

function volumeLabel(value = "") {
  return { v1: "上册", v2: "下册", all: "全册" }[value] || "";
}

function unitLabel(value = "") {
  const match = String(value || "").match(/^u0?(\d+)$/);
  return match ? `第${Number(match[1])}单元` : "";
}

function queryFeedbackActions() {
  return [
    {
      key: "useful",
      label: { zh: "回答有帮助", en: "Helpful" },
      message: { zh: "记录这次回答可用，后续可用于验收样例。", en: "Record this answer as useful for future acceptance checks." }
    },
    {
      key: "wrong_citation",
      label: { zh: "引用不对", en: "Wrong citation" },
      message: { zh: "记录引用问题，后续可从资料管理检查来源。", en: "Record a citation issue for source maintenance." }
    },
    {
      key: "missed_point",
      label: { zh: "遗漏知识点", en: "Missing point" },
      message: { zh: "记录答案遗漏，后续可补充资料或调整模板策略。", en: "Record missing knowledge so sources or template strategy can be improved." }
    }
  ];
}

function preferredEvidenceMatches(tracker) {
  const matches = Array.isArray(tracker.matches) ? [...tracker.matches] : [];
  if (!matches.length) return matches;
  const lessonOrder = Number(tracker.constraints?.education?.lesson_order_no || 0) || null;
  if (lessonOrder) {
    const lessonAnchors = matches.filter(({ chunk }) => lessonAnchorScore(chunk, tracker.constraints) > 0);
    if (lessonAnchors.length) return lessonAnchors.slice(0, 2);
  }
  return matches.slice(0, 2);
}

function buildValidationRun(preview, results, artifacts, source) {
  const passed = results.filter((item) => item.status === "passed").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const citationPass = results.filter((item) => item.citationStatus === "pass").length;
  const citationMissing = results.filter((item) => item.citationStatus === "missing").length;

  return {
    template: preview.validationPreview.template,
    strategy: preview.validationPreview.strategy,
    source: {
      kind: source?.kind || "",
      path: source?.path || "",
      label: source?.label || null,
      ...(source?.target ? { target: publicVectorTarget(source.target) } : {}),
      ...(source?.sidecar ? { sidecar: publicSidecarContract(source.sidecar) } : {})
    },
    summary: {
      totalQuestions: results.length || preview.validationPreview.summary.totalQuestions,
      templateQuestions: preview.validationPreview.summary.templateQuestions,
      adHocQuestions: preview.validationPreview.summary.adHocQuestions,
      passed,
      failed,
      citationPass,
      citationMissing,
      reviewRequired: failed
    },
    rules: preview.validationPreview.rules,
    queryPlans: preview.validationPreview.queryPlans,
    results,
    artifacts
  };
}

function buildValidationStrategy(setupState) {
  const saved = setupState.retrievalStrategy || {};
  const methods = Array.isArray(saved.methods) ? saved.methods : [];
  return {
    configured: Boolean(saved.configured),
    profile: saved.profile || "",
    label: saved.profileLabel || { zh: "未配置", en: "Not configured" },
    methods,
    methodLabels: methods.map((method) => ({
      key: method,
      label: retrievalMethods[method]?.label || { zh: method, en: method },
      body: retrievalMethods[method]?.body || { zh: "", en: "" }
    })),
    config: saved.config || {},
    noAnswer: noAnswerMessage(saved.config?.noAnswerPolicy),
    citation: saved.config?.citationPolicy === "strict"
      ? {
          zh: "答案必须能回到来源、页码或原文片段。",
          en: "Answers must trace back to source, page, or excerpt."
        }
      : {
          zh: "引用要求还没有确认。",
          en: "Citation requirements are not confirmed yet."
        }
  };
}

function buildQuestionPlan(question, strategy = {}, template = {}) {
  const original = localizedText(question.question);
  const normalized = normalizeQuestion(original);
  const constraints = extractK12QueryConstraints(original);
  const methods = new Set(strategy.methods || []);
  const config = strategy.config || {};
  const templateTitle = localizedText(template.title);
  const queryCount = Math.max(1, Number(config.multiQueryCount || 1));
  const queries = buildQueryVariants(normalized, {
    queryCount: methods.has("multiQuery") ? queryCount : 1,
    templateTitle
  });
  const subQuestions = methods.has("decompose") ? splitQuestion(normalized) : [];
  const hypothetical = methods.has("hyde")
    ? `可能相关片段会说明“${normalized}”的定义、条件、步骤或出处。`
    : "";
  const stepBack = methods.has("stepBack")
    ? `如果直接找不到，先检索“${broaderQuestion(normalized, templateTitle)}”。`
    : "";

  return {
    questionKey: question.key,
    methods: [...methods],
    original,
    normalized,
    scope: describeK12Scope(constraints),
    missingScope: constraints.missing,
    queries,
    subQuestions,
    hypothetical,
    stepBack,
    filter: methods.has("metadataFilter")
      ? {
          zh: "优先按已选资料范围过滤。",
          en: "Filter by selected source scope first."
        }
      : null,
    rerank: methods.has("rerank") || config.rerank === true,
    citationRequired: config.citationPolicy === "strict",
    noAnswerPolicy: config.noAnswerPolicy || ""
  };
}

function buildQueryVariants(question, { queryCount, templateTitle }) {
  const variants = [
    question,
    `${question} 来源 页码 原文`,
    templateTitle ? `${question} ${templateTitle}` : `${question} 章节 位置`,
    `${question} 相关概念 条件 步骤`,
    `${question} 答案依据 引用`
  ];
  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))].slice(0, queryCount);
}

function splitQuestion(question) {
  const parts = question
    .split(/(?:以及|并且|同时|和|、|，|,|；|;|\?|\？)/g)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return [...new Set(parts)].slice(0, 4);
}

function normalizeQuestion(value) {
  return String(value || "")
    .replace(/[？?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function broaderQuestion(question, templateTitle) {
  const compact = question.replace(/第[一二三四五六七八九十\d]+[章节课]/g, "").trim();
  return compact && compact !== question ? compact : `${templateTitle || "当前资料"}中的相关背景`;
}

function noAnswerMessage(policy) {
  if (policy === "refuse_without_sources") {
    return {
      zh: "没有可靠来源时直接提示找不到，不生成答案。",
      en: "If reliable sources are missing, KnowMesh says so and does not answer."
    };
  }
  return {
    zh: "只有找到来源时才生成可用答案。",
    en: "Usable answers are produced only when sources are found."
  };
}

function scoreChunk(chunk, tracker) {
  const terms = tracker.terms || [];
  const metadata = chunk.metadata || {};
  const text = normalizedText(chunk.text);
  const sourceText = normalizedText([
    chunk.sourceUri,
    chunk.metadata?.title,
    ...(Array.isArray(chunk.sourceParts) ? chunk.sourceParts.map((item) => item.relativePath || item.objectKey || "") : [])
  ].join(" "));
  const searchable = `${sourceText} ${text}`;
  if (!terms.length || !searchable.trim()) return 0;
  if (!constraintGroupsMatch(searchable, tracker.constraints)) return 0;

  const unitScore = metadataUnitSignalScore(metadata, tracker.constraints) || unitSignalScore(text, tracker.constraints?.unitNumber);
  if (tracker.constraints?.unitNumber && unitScore <= 0) return 0;

  let sourceScore = 0;
  let bodyScore = 0;
  let score = 0;
  for (const term of terms) {
    if (sourceText.includes(term)) sourceScore += Math.max(5, Math.min(14, term.length * 1.8));
    if (text.includes(term)) bodyScore += Math.max(1, Math.min(8, term.length / 2));
  }
  score = Math.min(20, sourceScore)
    + bodyScore
    + unitScore
    + lessonAnchorScore(chunk, tracker.constraints)
    + contentTypeScore(chunk.metadata);
  return score >= minimumEvidenceScore(tracker) ? score : 0;
}

function lessonAnchorScore(chunk, constraints = {}) {
  const expected = Number(constraints.education?.lesson_order_no || 0) || null;
  if (!expected) return 0;
  const metadata = chunk.metadata || {};
  const education = metadata.education && typeof metadata.education === "object" ? metadata.education : {};
  const lessonOrder = Number(education.lesson_order_no || metadata.lesson_order_no || metadata.lessonOrderNumber || 0) || null;
  if (lessonOrder === expected) return 96;
  if (lessonOrder && lessonOrder !== expected) return -48;
  return 0;
}

function contentTypeScore(metadata = {}) {
  const contentType = String(metadata.content_type || metadata.contentType || metadata.ctype || metadata.education?.content_type || "");
  if (contentType === "toc_entry" || contentType === "lesson_anchor") return 28;
  if (contentType === "unit_intro") return -10;
  if (contentType === "cover" || contentType === "copyright" || contentType === "metadata_only") return -32;
  return 0;
}

function metadataUnitSignalScore(metadata, constraints = {}) {
  const expected = constraints.compact?.unit || "";
  if (!expected) return 0;
  const compact = compactFromAnyMetadata(metadata);
  return compact.unit === expected ? 36 : 0;
}

function citationFromChunk(chunk, terms, constraints = {}) {
  const education = chunk.metadata?.education || null;
  const citation = {
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    version_id: chunk.version_id,
    title: chunk.metadata?.title || "",
    sourceUri: chunk.sourceUri || "",
    pageNumber: chunk.metadata?.pageNumber ?? null,
    education,
    contentType: chunk.metadata?.content_type || chunk.metadata?.contentType || "",
    lessonTitle: education?.lesson_title || chunk.metadata?.lesson_title || "",
    lessonOrder: education?.lesson_order_no || chunk.metadata?.lesson_order_no || null,
    excerpt: excerptForTerms(chunk.text || "", terms),
    sourceParts: Array.isArray(chunk.sourceParts) ? chunk.sourceParts.slice(0, 3) : []
  };
  return {
    ...citation,
    trustReasons: citationTrustReasons(citation, constraints),
    links: citationLinks(citation)
  };
}

function citationTrustReasons(citation = {}, constraints = {}) {
  const compact = constraints.compact || {};
  const education = citation.education || {};
  const reasons = [];
  if (citation.sourceUri || citation.sourceParts?.length) {
    reasons.push(check(
      "sidecarTrace",
      "pass",
      "来源可追溯",
      "Traceable source",
      "引用来自 OSS Sidecar，保留了原文件、页码或片段位置。",
      "The citation comes from OSS Sidecar with original source, page, or snippet location."
    ));
  }
  if (education.stage || education.grade || education.subject || compact.fgs) {
    reasons.push(check(
      "scope",
      "pass",
      "范围匹配",
      "Scope matched",
      [
        education.stage,
        education.grade,
        education.subject
      ].filter(Boolean).join(" / ") || compact.fgs,
      [
        education.stage,
        education.grade,
        education.subject
      ].filter(Boolean).join(" / ") || compact.fgs
    ));
  }
  if (education.volume || compact.vol) {
    reasons.push(check(
      "volume",
      "pass",
      "册别匹配",
      "Volume matched",
      education.volume || volumeLabel(compact.vol),
      education.volume || volumeLabel(compact.vol)
    ));
  } else if (constraints.missing?.volume) {
    reasons.push(check(
      "volume",
      "warn",
      "册别未限定",
      "Volume open",
      "问题没有指定上册或下册，本次会保留上下册命中。",
      "The question did not specify a volume, so both volumes are kept."
    ));
  }
  if (education.unit_no || compact.unit) {
    reasons.push(check(
      "unit",
      "pass",
      "单元匹配",
      "Unit matched",
      education.unit_no ? `第${education.unit_no}单元` : unitLabel(compact.unit),
      education.unit_no ? `Unit ${education.unit_no}` : unitLabel(compact.unit)
    ));
  }
  if (education.lesson_order_no || citation.lessonTitle || citation.lessonOrder) {
    reasons.push(check(
      "lesson",
      "pass",
      "课次命中",
      "Lesson matched",
      [citation.lessonOrder ? `第${citation.lessonOrder}课` : "", citation.lessonTitle].filter(Boolean).join(" · "),
      [citation.lessonOrder ? `Lesson ${citation.lessonOrder}` : "", citation.lessonTitle].filter(Boolean).join(" · ")
    ));
  }
  return reasons.slice(0, 5);
}

function citationLinks(citation = {}) {
  const query = citationDocumentQuery(citation);
  const documentId = String(citation.document_id || "").trim();
  return {
    documentQuery: query,
    documentHref: documentId
      ? `/maintain/document?documentId=${encodeURIComponent(documentId)}`
      : query ? `/maintain/documents?query=${encodeURIComponent(query)}` : "/maintain/documents",
    diagnosticsHref: "/maintain/diagnostics",
    label: { zh: "查看资料", en: "Review source" },
    message: {
      zh: documentId ? "打开这条引用对应的资料全文。" : "在资料管理中定位这条引用对应的原始资料。",
      en: documentId ? "Open the source document behind this citation." : "Locate the original document behind this citation in document management."
    }
  };
}

function citationDocumentQuery(citation = {}) {
  const title = String(citation.title || "").trim();
  if (title) return title;
  const source = String(citation.sourceUri || citation.document_id || "").trim();
  if (!source) return "";
  const uriPath = source.replace(/^oss:\/\/[^/]+\//, "").split("#")[0];
  const basename = path.basename(uriPath);
  return decodeURIComponentSafe(basename || uriPath);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function excerptForTerms(text, terms) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (compact.length <= 220) return compact;
  const lower = compact.toLowerCase();
  const firstTerm = terms.find((term) => lower.includes(term));
  const index = firstTerm ? lower.indexOf(firstTerm) : 0;
  const start = Math.max(0, index - 70);
  const end = Math.min(compact.length, index + 150);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}

function tokenize(value) {
  const text = normalizedText(value);
  const latin = text.match(/[a-z0-9][a-z0-9_.-]{1,}/g) || [];
  const cjkPhrases = text.match(/\p{Script=Han}{2,}/gu) || [];
  const cjkTerms = cjkPhrases.flatMap((phrase) => phrase.length <= 4 ? [phrase] : cjkNgrams(phrase));
  return [...new Set([...latin, ...cjkTerms].filter((term) => term.length >= 2 && !stopWords().has(term)))];
}

function cjkNgrams(value) {
  const chars = Array.from(value);
  const terms = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= chars.length - size; index += 1) {
      terms.push(chars.slice(index, index + size).join(""));
    }
  }
  return terms;
}

function constraintGroupsMatch(searchable, groups = []) {
  return (groups.groups || groups || []).every((group) => group.terms.some((term) => searchable.includes(term)));
}

function parseOssUriWithFragment(value) {
  const text = String(value || "").trim();
  const match = text.match(/^oss:\/\/([^/]+)\/([^#]+)(?:#(.+))?$/);
  if (!match) return null;
  return {
    bucket: match[1],
    objectKey: match[2],
    fragment: match[3] || ""
  };
}

function minimumEvidenceScore(tracker) {
  const constraintCount = Array.isArray(tracker.constraints?.groups) ? tracker.constraints.groups.length : 0;
  if (tracker.constraints?.unitNumber) return 24;
  return constraintCount >= 3 ? 18 : 8;
}

function unitSignalScore(text, unitNumber) {
  if (!unitNumber) return 0;
  const escaped = String(unitNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`(?:<h\\d[^>]*>\\s*|\\\\section\\*?\\{\\s*)${escaped}[\\.、\\s　-]+[\\p{Script=Han}a-z]`, "iu");
  const loosePattern = new RegExp(`第\\s*${escaped}\\s*(?:单元|章|课|节)|第${arabicToChinese(unitNumber)}(?:单元|章|课|节)`, "iu");
  if (headingPattern.test(text)) return 40;
  if (loosePattern.test(text)) return 32;
  return 0;
}

function arabicToChinese(value) {
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value <= 9) return digits[value] || String(value);
  if (value === 10) return "十";
  if (value < 20) return `十${digits[value - 10]}`;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${digits[tens]}十${digits[ones]}`;
}

function localizedText(value) {
  if (typeof value === "string") return value;
  const zh = String(value?.zh || "").trim();
  const en = String(value?.en || "").trim();
  if (zh && en && zh !== en) return `${zh} ${en}`;
  return zh || en;
}

function normalizedText(value) {
  return String(value || "").toLowerCase();
}

function queryEvidenceReportPath(sourcePath) {
  return path.join(path.dirname(path.dirname(sourcePath)), "reports", "query-evidence.report.json");
}

function queryRuntimeReportPath(sourcePath) {
  if (!sourcePath) return "";
  const parent = path.dirname(sourcePath);
  if (path.basename(parent) === "manifests") return path.join(path.dirname(parent), "artifacts", "reports", "query-runtime.report.json");
  return path.join(path.dirname(path.dirname(sourcePath)), "reports", "query-runtime.report.json");
}

async function safeResponseText(response) {
  if (typeof response?.text === "function") return response.text();
  if (typeof response?.json === "function") return JSON.stringify(await response.json());
  return "";
}

function artifact(key, zhLabel, enLabel, file, zhMessage, enMessage) {
  return {
    key,
    status: "created",
    path: file,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function stopWords() {
  return new Set([
    "the",
    "this",
    "that",
    "what",
    "which",
    "when",
    "where",
    "with",
    "from",
    "about",
    "资料",
    "问题",
    "什么",
    "如何",
    "是否"
  ]);
}

function validationQuestion(key, source, question) {
  return {
    key,
    source,
    question
  };
}

function rule(key, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}
