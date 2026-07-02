import fs from "node:fs";
import path from "node:path";

import { getTemplate } from "../core/templates.mjs";
import { latestJob } from "./jobs.mjs";
import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { readMetadataContractUpgradeState, upgradeAliyunMetadataContract } from "./local-executor.mjs";
import { platformRuntimeInventory } from "./platform-runtime.mjs";
import { providerCapabilities } from "./provider-capabilities.mjs";
import { providerDiagnostics } from "./provider-diagnostics.mjs";
import { publicSampleOwnershipSummary } from "./public-samples.mjs";
import { openCatalogDatabase } from "./storage.mjs";

const metadataContractUpgradeRuns = new Map();

export function maintenanceStatus(state) {
  const latest = latestJob(state);
  const version = state.packageInfo?.version || "0.0.0";
  const endpoint = state.port ? `${state.host}:${state.port}` : state.host;
  const jobStatus = latest.job?.status || "none";
  const updateChannel = process.env.KNOWMESH_UPDATE_CHANNEL || "";
  const metadataContract = metadataContractStatus(latest.job);
  const qualityIssues = readQualityIssueSummary(state);
  const platformRuntime = platformRuntimeInventory(state);
  const providers = providerCapabilities(state);
  const providerDiagnosticSummary = providerDiagnostics(state, { capabilities: providers });
  const providerCapabilitySummary = publicProviderCapabilitySummary(providers);
  const sampleOwnership = publicSampleOwnershipSummary(state);
  const diagnostics = buildDiagnostics(endpoint, version, jobStatus, updateChannel, latest.job, metadataContract, qualityIssues, platformRuntime, providers);
  const updateGate = buildUpdateGate(updateChannel);
  const checks = [
    check("service", "pass", "本地服务", "Local service", "本地服务正在运行。", "The local service is running."),
    check("version", "pass", "当前版本", "Current version", `KnowMesh v${version}`, `KnowMesh v${version}`),
    platformRuntimeCheck(platformRuntime),
    providerCapabilitiesCheck(providers),
    check(
      "latestJob",
      latest.job ? jobStatusForCheck(jobStatus) : "warn",
      "最近任务",
      "Latest job",
      latest.job ? jobStatusMessageZh(jobStatus) : "还没有创建任务。",
      latest.job ? jobStatusMessageEn(jobStatus) : "No job has been created yet."
    ),
    check(
      "qualityIssues",
      qualityIssues.open > 0 ? "warn" : "pass",
      "质量复核",
      "Quality review",
      qualityIssues.open > 0 ? `还有 ${qualityIssues.open} 个质量问题待处理。` : "没有待处理的质量问题。",
      qualityIssues.open > 0 ? `${qualityIssues.open} quality issue(s) need review.` : "No quality issue needs review."
    ),
    check(
      "updates",
      updateChannel ? "pass" : "warn",
      "更新通道",
      "Update channel",
      updateChannel ? `已配置 ${updateChannel}。` : "暂未配置更新通道，本页不会自动联网下载。",
      updateChannel ? `${updateChannel} is configured.` : "No update channel is configured. This page does not download updates automatically."
    )
  ];
  if (metadataContract) checks.push(metadataContract.check);

  return {
    ok: checks.every((item) => item.status !== "fail"),
    checks,
    maintenance: {
      summary: {
        version,
        endpoint,
        latestJobStatus: jobStatus,
        latestJobLabel: { zh: jobStatusLabelZh(jobStatus), en: jobStatusLabelEn(jobStatus) },
        updateChannel: updateChannel || "manual",
        updateChannelLabel: updateChannel ? { zh: updateChannel, en: updateChannel } : { zh: "手动", en: "Manual" }
      },
      qualityIssues,
      platformRuntime,
      providerCapabilities: providerCapabilitySummary,
      providerDiagnostics: providerDiagnosticSummary,
      sampleOwnership,
      templateContract: buildTemplateContractSummary(latest.job),
      diagnostics,
      updateGate,
      ...(metadataContract?.progress ? { metadataContractProgress: metadataContract.progress } : {})
    }
  };
}

function publicProviderCapabilitySummary(providers = {}) {
  return {
    ok: providers.ok === true,
    kind: providers.kind || "knowmesh.providerCapabilities",
    apiVersion: providers.apiVersion || "1.0.0",
    generatedAt: providers.generatedAt || new Date().toISOString(),
    phase: providers.phase || "",
    summary: providers.summary || {},
    providers: providers.providers || [],
    capabilities: providers.capabilities || [],
    costPrivacyCards: providers.costPrivacyCards || [],
    guidedActions: providers.guidedActions || [],
    adapterContracts: providers.adapterContracts || [],
    providerAdapterManifestSummary: providers.providerAdapterManifestSummary || null,
    dryRun: providers.dryRun || null,
    sensitiveDataPolicy: providers.sensitiveDataPolicy || null
  };
}

export function previewKnowMeshUpdate(state) {
  const version = state.packageInfo?.version || "0.0.0";
  const updateChannel = process.env.KNOWMESH_UPDATE_CHANNEL || "";
  return {
    ok: true,
    executionEnabled: false,
    checks: [
      check("currentVersion", "pass", "当前版本", "Current version", `KnowMesh v${version}`, `KnowMesh v${version}`),
      check(
        "updateChannel",
        updateChannel ? "pass" : "warn",
        "更新通道",
        "Update channel",
        updateChannel ? `将从 ${updateChannel} 检查。` : "暂未配置更新通道，只展示确认信息。",
        updateChannel ? `Updates will be checked from ${updateChannel}.` : "No update channel is configured; only confirmation is shown."
      ),
      check("updateExecution", "blocked", "更新执行", "Update execution", "当前不会下载、安装或重启服务。", "Nothing is downloaded, installed, or restarted.")
    ],
    confirmation: {
      executionEnabled: false,
      title: { zh: "更新确认", en: "Update confirmation" },
      summary: [
        confirmationItem("当前版本", "Current version", `v${version}`, `v${version}`),
        confirmationItem("更新通道", "Update channel", updateChannel || "手动", updateChannel || "Manual"),
        confirmationItem("执行状态", "Execution", "仅预览", "Preview only")
      ],
      impacts: [
        confirmationItem("本地资料", "Local sources", "不会修改", "Not changed"),
        confirmationItem("知识库版本", "Knowledge-base versions", "不会切换", "Not switched"),
        confirmationItem("服务重启", "Service restart", "不会重启", "No restart")
      ]
    }
  };
}

export async function upgradeMetadataContract(state) {
  const latest = latestJob(state);
  if (!latest.job) {
    return {
      ok: false,
      error: {
        code: "NO_JOB",
        message: { zh: "还没有可升级的知识库任务。", en: "No knowledge-base job is available for upgrade." }
      }
    };
  }
  const runKey = metadataContractRunKey(latest.job);
  const existingRun = metadataContractUpgradeRuns.get(runKey);
  if (!existingRun) {
    const run = upgradeAliyunMetadataContract(state, latest.job)
      .catch((error) => error)
      .finally(() => metadataContractUpgradeRuns.delete(runKey));
    metadataContractUpgradeRuns.set(runKey, run);
  }
  const status = maintenanceStatus(state);
  return {
    ok: true,
    accepted: true,
    checks: status.checks,
    maintenance: status.maintenance,
    upgrade: readMetadataContractUpgradeState(latest.job) || null
  };
}

function metadataContractRunKey(job) {
  return String(job?.summary?.workspaceRoot || job?.id || "metadata-contract");
}

function metadataContractAction(labelZh = "升级契约", labelEn = "Upgrade Contract", disabled = false) {
  return {
    key: "upgrade-metadata-contract",
    endpoint: "/api/maintenance/metadata-contract/upgrade",
    label: { zh: labelZh, en: labelEn },
    loading: { zh: "正在升级元数据契约...", en: "Upgrading metadata contract..." },
    disabled,
    confirmTitle: { zh: "升级云端元数据契约", en: "Upgrade Cloud Metadata Contract" },
    confirmLabel: { zh: "升级契约", en: "Upgrade Contract" },
    confirmBody: {
      zh: "KnowMesh 会复用已生成的向量记录，补齐云端引用信息、目录锚点、页码片段和模板契约，发布 OSS Sidecar，并补写向量 Metadata。不会重跑 OCR 或向量化，不会删除原始资料，也不会重建知识库。完成后可重新验证问答引用。",
      en: "KnowMesh will reuse generated vector records, fill cloud citation fields, TOC anchors, page excerpts, and template contract, publish OSS Sidecar, and rewrite vector metadata. It will not rerun OCR or embeddings, delete source files, or rebuild the knowledge base. After completion, you can validate answer citations again."
    }
  };
}

function buildTemplateContractSummary(job) {
  const template = getTemplate(job?.template || "general-docs");
  if (!template) return null;
  return {
    id: template.id,
    version: template.version || "0.0.0",
    title: template.title,
    expertName: template.expertName || template.coreName || "",
    summary: template.aliyunMetadataContract?.summary || template.summary,
    capabilities: [
      templateCapability(
        "metadata",
        "教材元数据",
        "Textbook metadata",
        "学段、学科、年级、册别、单元、课序、页码和来源文件都会作为检索约束。",
        "Stage, subject, grade, volume, unit, lesson order, page, and source file are used as retrieval constraints."
      ),
      templateCapability(
        "sidecar",
        "OSS Sidecar",
        "OSS Sidecar",
        "完整引用、原文片段、质量信息和模板契约保存在 OSS Sidecar，向量 Bucket 只保留筛选字段和指针。",
        "Full citations, excerpts, quality details, and template contract live in OSS Sidecar; the vector bucket keeps compact filters and pointers."
      ),
      templateCapability(
        "expert",
        template.expertName || "KnowMesh Expert",
        template.expertName || "KnowMesh Expert",
        "模板策略会增强目录、题目、公式、图表和章节结构，不把行业规则写死在主流程里。",
        "Template strategy strengthens TOC, exercises, formulas, diagrams, and section structure without hard-coding industry rules into the main pipeline."
      )
    ],
    gates: [
      templateCapability(
        "citation",
        "引用必须回源",
        "Citations must trace back",
        "答案必须能回到原始文件、页码或章节和原文片段。",
        "Answers must trace back to source file, page or section, and excerpt."
      ),
      templateCapability(
        "quality",
        "低置信度不直接写入",
        "Low confidence is held back",
        "缺少页码、来源或范围不匹配的片段会进入待处理，不会悄悄污染知识库。",
        "Chunks missing page, source, or matching scope enter review instead of silently polluting the knowledge base."
      )
    ]
  };
}

function templateCapability(key, labelZh, labelEn, messageZh, messageEn) {
  return {
    key,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn }
  };
}

function buildDiagnostics(endpoint, version, jobStatus, updateChannel, job, metadataContract, qualityIssues = emptyQualityIssueSummary(), platformRuntime = null, providers = null) {
  const qualityIssueDiagnostic = qualityIssues.open > 0
    ? diagnostic(
        "qualityIssues",
        "warn",
        "质量复核",
        "Quality review",
        `还有 ${qualityIssues.open} 个质量问题待处理。`,
        `${qualityIssues.open} quality issue(s) need review.`,
        qualityIssues.byTargetType?.query > 0 ? "/maintain/feedback" : "/maintain/documents"
      )
    : diagnostic(
        "qualityIssues",
        "pass",
        "质量复核",
        "Quality review",
        "没有待处理的质量问题。",
        "No quality issue needs review.",
        "/maintain/diagnostics"
      );
  return [
    diagnostic("service", "pass", "本地服务", "Local service", "本地页面和 API 正常响应。", "Local pages and APIs are responding.", "/maintain/diagnostics"),
    diagnostic("version", "pass", "当前版本", "Current version", `当前是 v${version}。`, `Current version is v${version}.`, "/maintain/diagnostics"),
    platformRuntimeDiagnostic(platformRuntime),
    providerCapabilitiesDiagnostic(providers),
    diagnostic(
      "latestJob",
      job ? jobStatusForCheck(jobStatus) : "warn",
      "最近任务",
      "Latest job",
      job ? jobStatusMessageZh(jobStatus) : "还没有创建任务。",
      job ? jobStatusMessageEn(jobStatus) : "No job has been created yet.",
      "/build/execution"
    ),
    diagnostic(
      "updates",
      updateChannel ? "pass" : "warn",
      "更新通道",
      "Update channel",
      updateChannel ? `更新通道为 ${updateChannel}。` : "未配置更新通道, 更新执行保持关闭。",
      updateChannel ? `Update channel is ${updateChannel}.` : "No update channel is configured; update execution stays off.",
      "/maintain/diagnostics"
    ),
    qualityIssueDiagnostic,
    ...(metadataContract ? [metadataContract.diagnostic] : [])
  ];
}

function providerCapabilitiesCheck(providers) {
  const actionCount = providers?.summary?.actionCount || 0;
  return check(
    "providerCapabilities",
    actionCount > 0 ? "warn" : "pass",
    "供应商能力",
    "Provider capabilities",
    actionCount > 0 ? `还有 ${actionCount} 项供应商配置或能力边界需要确认。` : "供应商能力、成本和隐私边界已形成可读契约。",
    actionCount > 0 ? `${actionCount} provider setup or capability-boundary item(s) need review.` : "Provider capabilities, cost, and privacy boundaries are available as a readable contract."
  );
}

function providerCapabilitiesDiagnostic(providers) {
  const actionCount = providers?.summary?.actionCount || 0;
  return diagnostic(
    "providerCapabilities",
    actionCount > 0 ? "warn" : "pass",
    "供应商能力",
    "Provider capabilities",
    actionCount > 0 ? `有 ${actionCount} 项供应商配置建议；模型、OSS 和向量检索的成本/隐私边界已集中展示。` : "模型、OSS 和向量检索的能力、成本与隐私边界已集中展示。",
    actionCount > 0 ? `${actionCount} provider setup suggestion(s); model, OSS, and vector cost/privacy boundaries are centralized.` : "Model, OSS, and vector capability, cost, and privacy boundaries are centralized.",
    "/maintain/diagnostics"
  );
}

function platformRuntimeCheck(platformRuntime) {
  const counts = platformRuntime?.summary?.checks || {};
  const status = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  return check(
    "platformRuntime",
    status,
    "平台运行时",
    "Platform runtime",
    status === "pass"
      ? "启动器、Node 运行时和本机依赖检查通过。"
      : `平台层有 ${counts.fail || 0} 个错误、${counts.warn || 0} 个提醒需要处理。`,
    status === "pass"
      ? "Launchers, Node runtime, and local dependencies passed."
      : `Platform layer has ${counts.fail || 0} failure(s) and ${counts.warn || 0} warning(s) to review.`
  );
}

function platformRuntimeDiagnostic(platformRuntime) {
  const counts = platformRuntime?.summary?.checks || {};
  const status = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  return diagnostic(
    "platformRuntime",
    status,
    "平台运行时",
    "Platform runtime",
    status === "pass"
      ? "启动器、私有运行时、打开文件夹能力和本机依赖检查通过。"
      : `平台层需要处理 ${platformRuntime?.summary?.actionCount || 0} 项：启动器、运行时或本机依赖可能影响普通用户启动和资料处理。`,
    status === "pass"
      ? "Launchers, private runtime, folder opening, and local dependencies passed."
      : `${platformRuntime?.summary?.actionCount || 0} platform action(s) need review: launchers, runtime, or local dependencies may affect startup and source handling.`,
    "/maintain/diagnostics"
  );
}

function readQualityIssueSummary(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return emptyQualityIssueSummary();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const rows = db.prepare(`
      SELECT status, severity, target_type, count(*) AS count
      FROM quality_issues
      GROUP BY status, severity, target_type
    `).all();
    const summary = emptyQualityIssueSummary();
    for (const row of rows) {
      const count = Number(row.count || 0);
      summary.total += count;
      if (row.status === "open") summary.open += count;
      if (row.status === "resolved") summary.resolved += count;
      const severity = String(row.severity || "review");
      const targetType = String(row.target_type || "unknown");
      summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + count;
      summary.byTargetType[targetType] = (summary.byTargetType[targetType] || 0) + count;
    }
    summary.status = summary.open > 0 ? "review" : "clear";
    return summary;
  } finally {
    db.close();
  }
}

function emptyQualityIssueSummary() {
  return {
    status: "clear",
    total: 0,
    open: 0,
    resolved: 0,
    bySeverity: {},
    byTargetType: {}
  };
}

function metadataContractStatus(job) {
  if (!job || job.status !== "completed") return null;
  const activeManifest = readActiveManifestForJob(job);
  if (activeManifest?.target?.provider !== "aliyun-vector") return null;
  const progress = readMetadataContractUpgradeState(job);
  if (activeManifest.sidecar?.authoritativeStore === "oss-sidecar") {
    return {
      progress,
      check: check(
        "metadataContract",
        "pass",
        "云端元数据契约",
        "Cloud metadata contract",
        "OSS 向量 Bucket 已关联 OSS Sidecar，可用于真实云端验证。",
        "OSS Vector Bucket is linked to OSS Sidecar and can be validated through cloud retrieval."
      ),
      diagnostic: diagnostic(
        "metadataContract",
        "pass",
        "云端元数据契约",
        "Cloud metadata contract",
        "完整引用、页码、质量和模板契约已保存在 OSS Sidecar。",
        "Full citations, pages, quality, and template contract are stored in OSS Sidecar.",
        "/use/ask"
      )
    };
  }
  if (progress?.status === "running") {
    const completed = Number(progress.completed || 0);
    const total = Number(progress.total || 0);
    const progressTextZh = total ? `已处理 ${completed}/${total} 条，刷新后会继续显示当前进度。` : "正在准备升级，刷新后会继续显示当前进度。";
    const progressTextEn = total ? `${completed}/${total} processed. Progress is kept after refresh.` : "Preparing upgrade. Progress is kept after refresh.";
    return {
      progress,
      check: check(
        "metadataContract",
        "warn",
        "云端元数据契约",
        "Cloud metadata contract",
        `正在升级元数据契约，${progressTextZh}`,
        `Metadata contract is upgrading. ${progressTextEn}`
      ),
      diagnostic: diagnostic(
        "metadataContract",
        "working",
        "云端元数据契约",
        "Cloud metadata contract",
        localizedProgressMessage(progress, progressTextZh, progressTextEn).zh,
        localizedProgressMessage(progress, progressTextZh, progressTextEn).en,
        "/maintain/diagnostics",
        metadataContractAction("升级中", "Upgrading", true)
      )
    };
  }
  if (progress?.status === "failed") {
    const message = progress.message || {};
    return {
      progress,
      check: check(
        "metadataContract",
        "fail",
        "云端元数据契约",
        "Cloud metadata contract",
        message.zh || "上次升级没有完成，需要重试。",
        message.en || "The previous upgrade did not complete and needs retrying."
      ),
      diagnostic: diagnostic(
        "metadataContract",
        "fail",
        "云端元数据契约",
        "Cloud metadata contract",
        message.zh || "上次升级没有完成。重试会从已完成的片段后继续，不会重跑 OCR 或向量化。",
        message.en || "The previous upgrade did not complete. Retry resumes after completed chunks without rerunning OCR or embeddings.",
        "/maintain/diagnostics",
        metadataContractAction("重试升级", "Retry Upgrade")
      )
    };
  }
  return {
    progress,
    check: check(
      "metadataContract",
      "fail",
      "云端元数据契约",
      "Cloud metadata contract",
      "当前阿里云知识库缺少 OSS Sidecar，不能按云端检索结果验证。",
      "The current Aliyun knowledge base is missing OSS Sidecar and cannot be validated through cloud retrieval."
    ),
    diagnostic: diagnostic(
      "metadataContract",
      "fail",
      "云端元数据契约",
      "Cloud metadata contract",
      "需要升级元数据契约：复用已生成索引记录，发布 OSS Sidecar 并补写向量 Metadata，不重跑 OCR 或向量化。",
      "Upgrade the metadata contract: reuse existing index records, publish OSS Sidecar, and rewrite vector metadata without rerunning OCR or embeddings.",
      "/maintain/diagnostics",
      metadataContractAction()
    )
  };
}

function localizedProgressMessage(progress, fallbackZh, fallbackEn) {
  const message = progress?.message || {};
  return {
    zh: message.zh || fallbackZh,
    en: message.en || fallbackEn
  };
}

function readActiveManifestForJob(job) {
  const artifactPath = (key) => (job.artifacts || []).find((item) => item.key === key && item.path)?.path || "";
  const workspaceRoot = String(job.summary?.workspaceRoot || "").trim();
  const candidates = [
    artifactPath("activeManifest"),
    workspaceRoot ? path.join(workspaceRoot, "manifests", "active-manifest.json") : ""
  ].filter(Boolean);
  for (const file of candidates) {
    const manifest = readJsonFile(file);
    if (manifest) return manifest;
  }
  return null;
}

function readJsonFile(file) {
  try {
    if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function buildUpdateGate(updateChannel) {
  return {
    executionEnabled: false,
    label: { zh: "更新门禁", en: "Update gate" },
    message: {
      zh: updateChannel ? "可以检查更新信息, 但下载、安装和重启必须再次确认。" : "未配置更新通道, 当前只提供安全预览。",
      en: updateChannel ? "Update information can be checked, but download, install, and restart need confirmation." : "No update channel is configured, so only a safe preview is available."
    },
    steps: [
      updateGateStep("check", "pass", "检查当前版本", "Check current version", "当前版本已记录。", "Current version is recorded."),
      updateGateStep("preview", "blocked", "查看更新影响", "Review update impact", "先展示版本、来源和影响, 不直接执行。", "Version, source, and impact are shown before execution."),
      updateGateStep("execute", "blocked", "执行更新", "Run update", "下载、安装、重启仍关闭。", "Download, install, and restart remain disabled.")
    ]
  };
}

function diagnostic(key, status, labelZh, labelEn, messageZh, messageEn, href, action = null) {
  return {
    key,
    status,
    href,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn },
    ...(action ? { action } : {})
  };
}

function updateGateStep(key, status, labelZh, labelEn, messageZh, messageEn) {
  return {
    key,
    status,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn }
  };
}

function confirmationItem(labelZh, labelEn, valueZh, valueEn) {
  return {
    label: { zh: labelZh, en: labelEn },
    value: { zh: valueZh, en: valueEn }
  };
}

function check(key, status, labelZh, labelEn, messageZh, messageEn) {
  return {
    key,
    status,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn }
  };
}

function jobStatusForCheck(status) {
  if (status === "blocked" || status === "failed") return "fail";
  if (status === "completed") return "pass";
  return "warn";
}

function jobStatusLabelZh(status) {
  return {
    none: "暂无任务",
    waiting: "等待中",
    running: "运行中",
    completed: "已完成",
    blocked: "已阻塞",
    failed: "失败"
  }[status] || status;
}

function jobStatusLabelEn(status) {
  return {
    none: "No job",
    waiting: "Waiting",
    running: "Running",
    completed: "Complete",
    blocked: "Blocked",
    failed: "Failed"
  }[status] || status;
}

function jobStatusMessageZh(status) {
  return {
    waiting: "任务已创建，等待继续推进。",
    running: "任务正在推进，可以查看当前步骤。",
    completed: "最近任务已经完成。",
    blocked: "最近任务有阻塞项，需要先处理。",
    failed: "最近任务失败，需要查看原因后重试。"
  }[status] || "最近任务状态已记录。";
}

function jobStatusMessageEn(status) {
  return {
    waiting: "The job is created and waiting to continue.",
    running: "The job is advancing; review the current step.",
    completed: "The latest job is complete.",
    blocked: "The latest job has blockers to fix first.",
    failed: "The latest job failed; review the cause and retry."
  }[status] || "Latest job status is recorded.";
}
