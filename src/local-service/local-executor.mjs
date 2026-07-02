import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { aliyunEmbeddingBatchLimit } from "../core/aliyun-model-catalog.mjs";
import { convertCompatibleSource } from "../core/compatibility-converter.mjs";
import { buildK12SourceScopeGate, k12ScopeDecision, k12TemplateId, normalizeScopeKey } from "../core/document-scope.mjs";
import { compactK12FilterFields, extractK12EducationMetadata } from "../core/k12-metadata.mjs";
import { k12ContentTypeForRecord } from "../core/k12-page-classifier.mjs";
import { getTemplate } from "../core/templates.mjs";
import { readOfficeText } from "../core/office-text.mjs";
import { buildPipelinePlan, writePipelinePlan } from "../core/plan.mjs";
import { readRtfText } from "../core/rtf-text.mjs";
import { isMacroEnabledSourceType, processingGroupForSourceType } from "../core/source-types.mjs";
import { buildTextRecognitionPlan } from "../core/text-recognition-plan.mjs";
import { putObject } from "./aliyun.mjs";
import { ensureDir, writeJsonFile } from "../core/config.mjs";
import { buildPlanConfig } from "./plan-preview.mjs";
import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { readCatalogChunks, syncCleanArtifactsToCatalog, syncOcrResultsToCatalog } from "./content-catalog.mjs";
import { buildDocumentInventory } from "./document-inventory.mjs";
import { syncIndexWriteResultsToCatalog, syncPendingIndexRecordsToCatalog } from "./index-records.mjs";
import { extractK12ChineseObjectsFromCatalog } from "./k12-chinese-object-extractor.mjs";
import { runK12CatalogEvaluation, seedK12EvaluationCases } from "./k12-evaluation-runner.mjs";
import { extractK12MathObjectsFromCatalog } from "./k12-math-object-extractor.mjs";
import { extractK12ObjectsFromCatalog } from "./k12-object-extractor.mjs";
import { syncK12TocEntriesToCatalog } from "./k12-toc-builder.mjs";
import { syncK12UnitLessonRangesToCatalog } from "./k12-page-range-builder.mjs";
import { buildQualityLifecycle, buildQualityLifecycleReport } from "./quality-lifecycle.mjs";
import { syncCleanReviewToQualityIssues, syncQualityLifecycleIssuesToCatalog } from "./quality-issues.mjs";
import { buildTemplateScan } from "./scan-preview.mjs";
import { readAliyunCredentials, readAliyunModelProvider, readSetupState } from "./setup-store.mjs";
import { filterScanForTargetedRerun } from "./targeted-rerun.mjs";
import { publishBuildVersion, runBuildVersionPublishStage } from "./execution/build-version-publisher.mjs";
import { writeArtifactCheckpoint } from "./execution/checkpoints.mjs";
import { runEmbeddingStage } from "./execution/embedding-provider.mjs";
import { runOcrRecognitionStage } from "./execution/ocr-provider.mjs";
import { compatibilityConversionFor, sourcePreparationCategory, sourceReviewReason } from "./execution/parser-provider.mjs";
import { runSourceArchiveStage } from "./execution/source-archive.mjs";
import { runVectorWriteStage } from "./execution/vector-writer.mjs";
import { createAliyunModelStudioAdapter } from "./providers/aliyun-model-studio.mjs";
import { createAliyunOssVectorAdapter } from "./providers/aliyun-oss-vector.mjs";

export async function executeLocalTask(state, job, task, options = {}) {
  const logger = taskLogger(options.log, task);
  const snapshot = await buildSnapshot(state, job);
  if (task.key === "merge") return writePlanningArtifacts(snapshot, logger);
  if (task.key === "pages") return writePagePreparation(snapshot, logger);
  if (task.key === "clean") return writeCleanChunks(snapshot, logger);
  if (task.key === "retrieval-policy") return writeRetrievalPolicy(snapshot, logger);
  if (task.key === "upload") return runSourceArchiveStage(snapshot, job, logger, executeSourceArchiveImplementation);
  if (task.key === "ocr") return runOcrRecognitionStage(snapshot, job, logger, executeOcrRecognitionImplementation);
  if (task.key === "embedding") return runEmbeddingStage(snapshot, job, logger, executeEmbeddingImplementation);
  if (task.key === "index") return runVectorWriteStage(snapshot, job, logger, executeVectorWriteImplementation);
  if (task.key === "report") return writeRunReport(job, snapshot, logger);
  throw new Error(`${task.label?.zh || task.key} 当前缺少可执行配置，请先检查本步骤需要的服务或处理方式。`);
}

export function metadataContractUpgradePathsForJob(job) {
  const activeManifestPath = activeManifestPathForJob(job);
  const workspaceRoot = workspaceRootForJob(job, activeManifestPath);
  const artifactRoot = workspaceRoot ? path.join(workspaceRoot, "artifacts") : "";
  const indexRoot = artifactRoot ? path.join(artifactRoot, "index_records") : "";
  return {
    activeManifestPath,
    workspaceRoot,
    artifactRoot,
    resultPath: indexRoot ? path.join(indexRoot, "metadata-contract-upgrade.result.jsonl") : "",
    progressPath: indexRoot ? path.join(indexRoot, "metadata-contract-upgrade.progress.json") : "",
    lockPath: indexRoot ? path.join(indexRoot, "metadata-contract-upgrade.lock") : ""
  };
}

export function readMetadataContractUpgradeState(job) {
  const { progressPath } = metadataContractUpgradePathsForJob(job);
  if (!progressPath) return null;
  const state = readJsonFile(progressPath, null);
  return state && typeof state === "object" ? state : null;
}

function writeMetadataContractUpgradeState(job, patch = {}) {
  const { progressPath } = metadataContractUpgradePathsForJob(job);
  if (!progressPath) return null;
  const previous = readJsonFile(progressPath, null) || {};
  const next = {
    ...previous,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  writeJsonFile(progressPath, next);
  return next;
}

function acquireMetadataContractUpgradeLock(job) {
  const { lockPath } = metadataContractUpgradePathsForJob(job);
  if (!lockPath) return null;
  ensureDir(path.dirname(lockPath));
  let fd = null;
  try {
    fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString()
    }));
    return () => {
      try {
        if (fd !== null) fs.closeSync(fd);
      } finally {
        fd = null;
        fs.rmSync(lockPath, { force: true });
      }
    };
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    if (error?.code === "EEXIST") return null;
    throw error;
  }
}

export async function upgradeAliyunMetadataContract(state, job, options = {}) {
  if (!job) throw new Error("没有可升级的知识库任务。");
  const paths = metadataContractUpgradePathsForJob(job);
  const activeManifestPath = paths.activeManifestPath;
  const activeManifest = readJsonFile(activeManifestPath, null);
  if (!activeManifest) throw new Error("没有找到当前知识库的已激活版本清单。");
  if (activeManifest.target?.provider !== "aliyun-vector") throw new Error("当前知识库不是阿里云向量 Bucket，不需要升级云端元数据契约。");
  if (activeManifest.sidecar?.authoritativeStore === "oss-sidecar") {
    writeMetadataContractUpgradeState(job, {
      status: "completed",
      phase: "done",
      completed: Number(activeManifest.sidecar?.chunks || 0),
      total: Number(activeManifest.sidecar?.chunks || 0),
      message: {
        zh: "云端元数据契约已完成。",
        en: "Cloud metadata contract is complete."
      },
      activeManifestPath
    });
    return {
      ok: true,
      alreadyUpgraded: true,
      summary: {
        records: Number(activeManifest.sidecar?.chunks || 0),
        sidecar: activeManifest.sidecar,
        activeManifestPath
      },
      logs: []
    };
  }

  const releaseLock = acquireMetadataContractUpgradeLock(job);
  if (!releaseLock) {
    const runningState = readMetadataContractUpgradeState(job);
    return {
      ok: true,
      running: true,
      summary: {
        ...(runningState || {}),
        activeManifestPath
      },
      logs: []
    };
  }

  const pendingPath = pendingIndexRecordsPathForJob(job);
  const logs = [];
  const log = (zh, en = zh, detail = {}, status = "running", type = "maintenance") => {
    logs.push({
      type,
      status,
      message: { zh, en },
      detail
    });
  };

  try {
    writeMetadataContractUpgradeState(job, {
      status: "running",
      phase: "preparing",
      startedAt: new Date().toISOString(),
      completed: 0,
      total: null,
      activeManifestPath,
      resultPath: paths.resultPath,
      message: {
        zh: "正在准备云端元数据契约升级。",
        en: "Preparing cloud metadata contract upgrade."
      }
    });

    const allRecords = readJsonlFile(pendingPath).filter((item) => item?.status !== "failed" && Array.isArray(item?.embedding));
    const records = allRecords.filter((item) => item?.quality?.writeEnabled !== false);
    if (!allRecords.length) throw new Error("没有找到可复用的向量记录，不能无损升级元数据契约。");
    if (!records.length) throw new Error("没有达到写入标准的向量记录，不能升级为已激活知识库。");

    const setupDraft = readSetupState(state).draft || {};
    const datasetVersionId = String(activeManifest.datasetVersionId || job.datasetVersionId || records.find((item) => item.datasetVersionId)?.datasetVersionId || records.find((item) => item.version_id)?.version_id || "").trim();
    const upgradeJob = {
      ...job,
      datasetVersionId,
      draft: {
        ...setupDraft,
        ...(job.draft || {})
      }
    };
    const target = activeManifest.target || vectorTarget(upgradeJob);
    const template = getTemplate(job.template) || { id: job.template, version: "" };
    const workspaceRoot = workspaceRootForJob(job, activeManifestPath);
    const artifactRoot = path.join(workspaceRoot, "artifacts");
    const plan = {
      project: {
        id: currentKnowledgeBaseId(state),
        name: setupDraft["project.name"] || currentKnowledgeBaseId(state)
      },
      workspace: {
        artifactRoot,
        manifests: path.dirname(activeManifestPath)
      },
      proposedActiveManifest: {
        ...activeManifest,
        activeVersions: activeManifest.activeVersions || []
      }
    };

    writeMetadataContractUpgradeState(job, {
      status: "running",
      phase: "sidecar",
      completed: 0,
      total: records.length,
      message: {
        zh: `正在发布 OSS Sidecar：共 ${records.length} 条知识片段。`,
        en: `Publishing OSS Sidecar for ${records.length} knowledge chunk(s).`
      }
    });
    const sidecar = await publishAliyunSidecar({ plan, template, state, job: upgradeJob, target, records }, log);
    const sidecarByChunkId = new Map((sidecar?.chunks || []).map((item) => [item.chunk_id, item]));
    const batchSize = Math.max(1, Math.min(Number(options.batchSize || state.metadataContractUpgradeBatchSize || state.indexBatchSize || 100), 500));
    const resultPath = paths.resultPath || path.join(artifactRoot, "index_records", "metadata-contract-upgrade.result.jsonl");
    ensureDir(path.dirname(resultPath));
    if (!fs.existsSync(resultPath)) writeJsonl(resultPath, []);

    const existing = uniqueRecordsByKey(readJsonlFile(resultPath).filter((item) => item?.status === "written"), "chunk_id");
    const completedChunkIds = new Set(existing.map((item) => item.chunk_id).filter(Boolean));
    const writable = records.map((item) => ({
      ...item,
      active: true,
      datasetVersionId,
      sidecarUri: sidecarByChunkId.get(item.chunk_id)?.sidecarUri || "",
      sidecarContract: sidecarByChunkId.get(item.chunk_id)?.vectorMetadata || null
    })).filter((item) => !completedChunkIds.has(item.chunk_id));
    const batches = chunkArray(writable, batchSize);
    const results = [...existing];
    writeMetadataContractUpgradeState(job, {
      status: "running",
      phase: "vectors",
      completed: results.length,
      total: records.length,
      batch: 0,
      totalBatches: batches.length,
      message: {
        zh: `正在补写向量 Metadata：已完成 ${results.length}/${records.length}。`,
        en: `Rewriting vector metadata: ${results.length}/${records.length} complete.`
      }
    });

    for (const [batchIndex, batch] of batches.entries()) {
      const batchNumber = batchIndex + 1;
      log(
        `升级元数据契约批次 ${batchNumber}/${batches.length}：补写 ${batch.length} 条向量 Metadata。`,
        `Metadata contract upgrade batch ${batchNumber}/${batches.length}: rewriting metadata for ${batch.length} vector record(s).`,
        progressDetail({ action: "升级元数据契约", batch: batchNumber, totalBatches: batches.length, items: batch.length, completed: results.length, total: records.length, next: "本批完成后会写入升级进度。" })
      );
      writeMetadataContractUpgradeState(job, {
        status: "running",
        phase: "vectors",
        batch: batchNumber,
        totalBatches: batches.length,
        completed: results.length,
        total: records.length,
        message: {
          zh: `正在补写向量 Metadata：批次 ${batchNumber}/${batches.length}。`,
          en: `Rewriting vector metadata: batch ${batchNumber}/${batches.length}.`
        }
      });
      const batchResults = await writeVectorBatchWithRecovery(state, {
        items: batch,
        target,
        template,
        job: upgradeJob,
        batchPolicy: { mode: "metadata-contract-upgrade", batchSize, ensureIndex: false }
      }, log);
      const normalized = batch.map((item, index) => normalizeIndexWriteResult(item, batchResults[index], target));
      appendJsonl(resultPath, normalized);
      results.push(...normalized);
      const failed = normalized.filter((item) => item.status === "failed");
      if (failed.length) {
        throw new Error("元数据契约升级失败：" + (failed[0].providerMessage || failed[0].chunk_id));
      }
      writeMetadataContractUpgradeState(job, {
        status: "running",
        phase: "vectors",
        batch: batchNumber,
        totalBatches: batches.length,
        completed: results.length,
        total: records.length,
        message: {
          zh: `已补写 ${results.length}/${records.length} 条向量 Metadata。`,
          en: `Rewritten ${results.length}/${records.length} vector metadata record(s).`
        }
      });
    }

    const sidecarSummary = sidecarManifestSummary(sidecar);
    const updatedManifest = {
      ...activeManifest,
      generatedAt: activeManifest.generatedAt || new Date().toISOString(),
      metadataContractUpgradedAt: new Date().toISOString(),
      sidecar: sidecarSummary
    };
    writeJsonFile(activeManifestPath, updatedManifest);
    writeMetadataContractUpgradeState(job, {
      status: "completed",
      phase: "done",
      completed: results.filter((item) => item.status === "written").length,
      total: records.length,
      resultPath,
      activeManifestPath,
      sidecar: sidecarSummary,
      message: {
        zh: "云端元数据契约升级完成，可以重新验证问答引用。",
        en: "Cloud metadata contract upgrade is complete. Answer citations can be validated again."
      }
    });
    return {
      ok: true,
      alreadyUpgraded: false,
      summary: {
        records: results.filter((item) => item.status === "written").length,
        sidecar: sidecarSummary,
        target,
        resultPath,
        activeManifestPath
      },
      logs
    };
  } catch (error) {
    writeMetadataContractUpgradeState(job, {
      status: "failed",
      phase: "failed",
      error: error instanceof Error ? error.message : String(error),
      message: {
        zh: error instanceof Error ? error.message : String(error),
        en: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  } finally {
    releaseLock();
  }
}

function taskLogger(log, task) {
  return (zh, en = zh, detail = {}, status = "running", type = "task-detail") => {
    if (typeof log !== "function") return;
    log({
      type,
      taskKey: task?.key || "",
      status,
      label: task?.label || { zh: "任务进度", en: "Job progress" },
      message: { zh, en },
      detail
    });
  };
}

export async function testLocalTask(state, job, task) {
  const snapshot = await buildSnapshot(state, job);
  const expectedArtifacts = expectedArtifactsForTask(snapshot, job, task);
  const filterPreview = task.key === "clean" ? buildFilterPreview(await buildCleanArtifacts(snapshot)) : null;
  const reportPath = path.join(snapshot.plan.workspace.artifactRoot, "reports", "tests", `${task.key}.test-report.json`);
  const report = {
    kind: "knowmesh.localTaskTestReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      status: job.status,
      mode: job.mode,
      template: job.template
    },
    task: {
      key: task.key,
      label: task.label,
      status: task.status
    },
    checks: [
      check("taskAvailable", "pass", "任务可测试", "Task can be tested", "可以先测试本步骤，不推进正式进度。", "This step can be tested without advancing the job."),
      check("workspace", "pass", "工作目录", "Work folder", "测试报告会写入本机工作目录。", "The test report is written to the local work folder."),
      check("cloudSafe", "pass", "云端动作", "Cloud actions", "本次测试不会上传、调用模型或写入知识库。", "This test does not upload, call models, or write a knowledge base.")
    ],
    expectedArtifacts,
    ...(filterPreview ? { filterPreview } : {})
  };
  writeJsonFile(reportPath, report);
  return {
    checks: report.checks,
    expectedArtifacts,
    ...(filterPreview ? { filterPreview } : {}),
    artifacts: [
      artifact("testReport", "测试报告", "Test report", reportPath, "记录本步骤测试结果和正式执行预计产物。", "Records this step test result and expected full-run artifacts.")
    ]
  };
}

async function buildSnapshot(state, job) {
  const rawScan = await buildTemplateScan(state, {
    mode: job.mode,
    template: job.template,
    draft: job.draft || {}
  });
  const scan = filterScanForTargetedRerun(rawScan, job.targetedRerun?.rerunScope || null);
  const setupState = readSetupState(state);
  const config = buildPlanConfig(scan, setupState);
  const plan = buildPipelinePlan(config, scan.manifest);
  return { scan, plan, template: scan.template, state, job };
}

function activeManifestPathForJob(job) {
  const artifactPath = artifactPathForJob(job, "activeManifest");
  if (artifactPath) return artifactPath;
  const workspaceRoot = String(job?.summary?.workspaceRoot || "").trim();
  return workspaceRoot ? path.join(workspaceRoot, "manifests", "active-manifest.json") : "";
}

function pendingIndexRecordsPathForJob(job) {
  const artifactPath = artifactPathForJob(job, "pendingIndexRecords");
  if (artifactPath) return artifactPath;
  const workspaceRoot = String(job?.summary?.workspaceRoot || "").trim();
  return workspaceRoot ? path.join(workspaceRoot, "artifacts", "index_records", "index-records.pending.jsonl") : "";
}

function workspaceRootForJob(job, activeManifestPath) {
  const workspaceRoot = String(job?.summary?.workspaceRoot || "").trim();
  if (workspaceRoot) return workspaceRoot;
  return activeManifestPath ? path.dirname(path.dirname(activeManifestPath)) : "";
}

function artifactPathForJob(job, key) {
  return (job?.artifacts || []).find((item) => item.key === key && item.path)?.path || "";
}

function cloudTaskUnavailableMessage(task) {
  const labels = {
    index: "写入知识库当前缺少可用的写入连接。请先检查向量 Bucket、索引名称和阿里云凭证后重试。"
  };
  return labels[task.key] || `${task.label?.zh || task.key} 当前缺少可执行配置，请先检查本步骤需要的服务或处理方式。`;
}

async function executeSourceArchiveImplementation({ plan, template, state }, job, log) {
  const archivePath = path.join(plan.workspace.artifactRoot, "archive", "source-archive.manifest.json");
  const processingPath = path.join(plan.workspace.artifactRoot, "processing", "processing-input.manifest.json");
  const files = sourceArchiveFiles(plan, job);
  const previousArchive = readJsonFile(archivePath, null);
  const restoredUploads = new Map((previousArchive?.files || [])
    .filter((item) => item?.status === "uploaded")
    .map((item) => [archiveResumeKey(item), item]));
  const concurrency = Math.max(1, Math.min(Number(state.archiveConcurrency || 4), 12));
  if (restoredUploads.size) {
    log(
      `已恢复来源归档：发现 ${restoredUploads.size} 个已上传文件，重试时会跳过它们。`,
      `Source archive restored: ${restoredUploads.size} uploaded file(s) will be skipped during retry.`,
      progressDetail({ action: "恢复来源归档", completed: restoredUploads.size, total: files.length, remaining: Math.max(0, files.length - restoredUploads.size), next: "只补传未完成或失败的文件。" }),
      "running"
    );
  }
  log(`准备归档 ${files.length} 个原始文件，并发数 ${concurrency}。`, `Preparing to archive ${files.length} original file(s) with concurrency ${concurrency}.`, { files: files.length, concurrency });
  const uploader = await archiveUploaderFor(state);
  const retry = retryPolicyFor(state, "archive");
  const uploaded = await mapWithConcurrency(files, concurrency, async (file, index) => {
    const restored = restoredUploads.get(archiveResumeKey(file));
    if (restored) {
      log(
        `跳过已归档原始文件 ${index + 1}/${files.length}：${file.relativePath}`,
        `Skipped archived original file ${index + 1}/${files.length}: ${file.relativePath}`,
        { index: index + 1, total: files.length, relativePath: file.relativePath, status: "uploaded", restored: true },
        "completed"
      );
      return {
        ...file,
        status: "uploaded",
        upload: sanitizeUploadResult(restored.upload || restored),
        restored: true
      };
    }

    log(`上传原始文件 ${index + 1}/${files.length}：${file.relativePath}`, `Uploading original file ${index + 1}/${files.length}: ${file.relativePath}`, { index: index + 1, total: files.length, relativePath: file.relativePath, objectKey: file.objectKey });
    let result;
    try {
      result = await retryExternalCall(async () => retryableCloudResult(await uploader(file)), retry);
    } catch (error) {
      result = { ok: false, status: error?.status || 0, message: error instanceof Error ? error.message : String(error) };
    }
    const ok = result?.ok !== false;
    log(`${ok ? "已上传" : "上传失败"}原始文件 ${index + 1}/${files.length}：${file.relativePath}`, `${ok ? "Uploaded" : "Failed to upload"} original file ${index + 1}/${files.length}: ${file.relativePath}`, { index: index + 1, total: files.length, relativePath: file.relativePath, status: ok ? "uploaded" : "failed" }, ok ? "completed" : "failed");
    return {
      ...file,
      status: ok ? "uploaded" : "failed",
      upload: sanitizeUploadResult(result)
    };
  });
  const failed = uploaded.filter((item) => item.status === "failed");
  const archiveManifest = {
    kind: "knowmesh.sourceArchiveManifest",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    job: { id: job.id, mode: job.mode, template: job.template },
    target: archiveTarget(job),
    archivePolicy: template?.archivePolicy || null,
    summary: {
      originalFiles: uploaded.length,
      uploadedFiles: uploaded.filter((item) => item.status === "uploaded").length,
      failedFiles: failed.length,
      totalBytes: uploaded.reduce((sum, item) => sum + Number(item.size || 0), 0),
      concurrency
    },
    files: uploaded
  };
  const processingManifest = buildProcessingInputManifest(plan, template, uploaded, job);
  log(`处理输入清单已生成：${processingManifest.summary.directText} 份可直接读取，${processingManifest.summary.pageTasks} 份需要页级 OCR，${processingManifest.summary.imageOcr} 份图片待识别。`, `Processing input manifest is ready: ${processingManifest.summary.directText} directly readable, ${processingManifest.summary.pageTasks} page OCR, ${processingManifest.summary.imageOcr} image OCR.`, processingManifest.summary, "completed");

  writeJsonFile(archivePath, archiveManifest);
  writeJsonFile(processingPath, processingManifest);
  if (failed.length) {
    const first = failed[0];
    throw new Error("来源归档失败：" + (first.upload?.message || first.relativePath || first.objectKey));
  }
  return {
    artifacts: [
      artifact("sourceArchiveManifest", "来源归档清单", "Source archive manifest", archivePath, "记录原始文件归档位置、大小、状态和回滚依据。", "Records original archive location, size, status, and rollback basis."),
      artifact("processingInputManifest", "处理输入清单", "Processing input manifest", processingPath, "记录后续本机抽取、页级 OCR、清洗分片和向量化将使用的输入。", "Records inputs for extraction, page OCR, cleaning, chunking, and embedding.")
    ]
  };
}

async function executeOcrRecognitionImplementation({ plan, template, state }, job, log) {
  const processingPath = path.join(plan.workspace.artifactRoot, "processing", "processing-input.manifest.json");
  const reportPath = path.join(plan.workspace.artifactRoot, "reports", "ocr-recognition.report.json");
  const resultPath = path.join(plan.workspace.artifactRoot, "ocr", "ocr-result.jsonl");
  const processingManifest = readJsonFile(processingPath, null);
  if (!processingManifest?.inputs) throw new Error("没有找到处理输入清单，请先完成上传资料。");

  const tasks = await buildOcrTasks({ plan, template, state, job, processingManifest, log });
  const model = String(job.draft?.["aliyun.services.ocr"] || "");
  const batchSize = Math.max(1, Math.min(Number(state.ocrBatchSize || 64), 500));
  const concurrency = ocrConcurrencyFor(state);
  const existing = uniqueRecordsByKey(readJsonlFile(resultPath), "taskId");
  const completedTaskIds = new Set(existing.map((item) => item.taskId).filter(Boolean));
  const pendingTasks = tasks.filter((task) => !completedTaskIds.has(task.taskId));
  const recognized = [...existing];
  const restoredBatchCalls = existing.length ? Math.ceil(existing.length / batchSize) : 0;
  let batchCalls = 0;

  if (existing.length) {
    log(
      `已恢复 OCR 进度：跳过已完成 ${existing.length} 个任务，继续处理剩余 ${pendingTasks.length} 个任务。`,
      `OCR progress restored: skipped ${existing.length} completed task(s), continuing with ${pendingTasks.length} remaining task(s).`,
      progressDetail({ action: "恢复 OCR 进度", completed: existing.length, total: tasks.length, remaining: pendingTasks.length, next: pendingTasks.length ? "继续处理未完成 OCR 任务。" : "没有剩余 OCR 任务。" }),
      "running"
    );
  }

  log(
    `OCR 待处理 ${tasks.length} 个页级/图片任务，剩余 ${pendingTasks.length} 个；批量大小 ${batchSize}，并发 ${concurrency}，模型 ${model || "未配置"}。`,
    `OCR has ${tasks.length} page/image task(s), ${pendingTasks.length} remaining; batch size ${batchSize}, concurrency ${concurrency}, model ${model || "not configured"}.`,
    progressDetail({ action: "准备 OCR", completed: recognized.length, total: tasks.length, remaining: pendingTasks.length, batchSize, concurrency, model })
  );

  const batches = chunkArray(pendingTasks, batchSize);
  for (const [batchIndex, batch] of batches.entries()) {
    if (!batch.length) continue;
    const absoluteBatch = restoredBatchCalls + batchIndex + 1;
    const totalBatches = restoredBatchCalls + batches.length;
    log(
      `OCR 批次 ${absoluteBatch}/${totalBatches}：正在识别 ${batch.length} 个页级/图片任务，并发 ${concurrency}，累计 ${recognized.length}/${tasks.length}。`,
      `OCR batch ${absoluteBatch}/${totalBatches}: recognizing ${batch.length} page/image task(s) with concurrency ${concurrency}, ${recognized.length}/${tasks.length} completed so far.`,
      progressDetail({ action: "正在 OCR 识别", batch: absoluteBatch, totalBatches, items: batch.length, completed: recognized.length, total: tasks.length, remaining: Math.max(0, tasks.length - recognized.length), batchSize, concurrency, model, next: "本批完成后会写入本地进度。" })
    );
    const batchResults = await recognizeOcrBatchWithRecovery(state, {
      items: batch,
      model,
      provider: "aliyun",
      template,
      job,
      batchPolicy: { mode: "batch-first", batchSize, concurrency }
    }, log);
    batchCalls += 1;
    const normalized = batch.map((task, index) => normalizeOcrResult(task, batchResults[index], model));
    appendJsonl(resultPath, normalized);
    syncOcrResultsToCatalog(state, normalized, { plan, job, resultPath });
    syncK12ExpertStructureFromCatalog(state, { plan, job });
    recognized.push(...normalized);
    writePerDocumentOcrResults(plan.documents, recognized);
    const successCount = normalized.filter((item) => item.status === "recognized").length;
    const failed = normalized.filter((item) => item.status === "failed");
    const batchCheckpoint = progressDetail({ action: "OCR 批次完成", batch: absoluteBatch, totalBatches, succeeded: successCount, failed: failed.length, completed: recognized.length, total: tasks.length, remaining: Math.max(0, tasks.length - recognized.length), completedItems: recognized.length, failedItems: failed.length, retryItems: 0, next: failed.length ? "先处理失败项。" : "自动进入下一批。" });
    writeArtifactCheckpoint({ plan, job, stage: "ocr", checkpoint: batchCheckpoint, files: { resultPath, reportPath } });
    log(
      `OCR 批次 ${absoluteBatch}/${totalBatches} 完成：本批 ${successCount}/${normalized.length} 成功，累计 ${recognized.length}/${tasks.length}。`,
      `OCR batch ${absoluteBatch}/${totalBatches} complete: ${successCount}/${normalized.length} succeeded, ${recognized.length}/${tasks.length} total.`,
      batchCheckpoint,
      failed.length ? "failed" : "completed"
    );

    if (failed.length) {
      const report = buildOcrReport({ plan, template, job, tasks, recognized, batchSize, batchCalls: restoredBatchCalls + batchCalls });
      writeJsonFile(reportPath, report);
      throw new Error("OCR 识别失败：" + (failed[0].providerMessage || failed[0].title || failed[0].taskId));
    }

    if (isPauseRequested(job) && recognized.length < tasks.length) {
      const checkpoint = progressDetail({
        action: "OCR 已暂停",
        step: "ocr",
        batch: absoluteBatch,
        totalBatches,
        completed: recognized.length,
        total: tasks.length,
        remaining: Math.max(0, tasks.length - recognized.length),
        completedItems: recognized.length,
        failedItems: recognized.filter((item) => item.status === "failed").length,
        retryItems: 0,
        next: "恢复任务后会从剩余 OCR 页继续，不会重跑已完成页。"
      });
      writeArtifactCheckpoint({ plan, job, stage: "ocr", checkpoint, files: { resultPath, reportPath } });
      const report = buildOcrReport({ plan, template, job, tasks, recognized, batchSize, batchCalls: restoredBatchCalls + batchCalls });
      writeJsonFile(reportPath, { ...report, partial: true, checkpoint });
      log(
        `已暂停 OCR：当前已完成 ${recognized.length}/${tasks.length} 个任务，恢复后继续剩余 ${Math.max(0, tasks.length - recognized.length)} 个。`,
        `OCR paused: ${recognized.length}/${tasks.length} task(s) completed; resume continues with ${Math.max(0, tasks.length - recognized.length)} remaining.`,
        checkpoint,
        "paused",
        "checkpoint"
      );
      return {
        paused: true,
        checkpoint,
        artifacts: [
          artifact("ocrRecognitionReport", "OCR 识别报告", "OCR recognition report", reportPath, "记录 OCR 页任务、批量调用次数、失败项和模型信息。", "Records OCR page tasks, batch calls, failures, and model information."),
          artifact("ocrResult", "OCR 识别结果", "OCR result", resultPath, "保存页级和图片级识别结果，供后续清洗分段使用。", "Stores page-level and image-level OCR output for later cleaning and chunking.")
        ]
      };
    }
  }

  const finalRecords = uniqueRecordsByKey(recognized, "taskId");
  const report = buildOcrReport({ plan, template, job, tasks, recognized: finalRecords, batchSize, batchCalls: restoredBatchCalls + batchCalls });
  writeJsonl(resultPath, finalRecords);
  syncOcrResultsToCatalog(state, finalRecords, { plan, job, resultPath });
  syncK12ExpertStructureFromCatalog(state, { plan, job });
  writePerDocumentOcrResults(plan.documents, finalRecords);
  writeJsonFile(reportPath, report);

  log(`OCR 识别完成：${finalRecords.filter((item) => item.status === "recognized").length}/${finalRecords.length} 个任务成功，调用 ${restoredBatchCalls + batchCalls} 个批次。`, `OCR complete: ${finalRecords.filter((item) => item.status === "recognized").length}/${finalRecords.length} task(s) succeeded across ${restoredBatchCalls + batchCalls} batch(es).`, progressDetail({ action: "OCR 完成", succeeded: finalRecords.filter((item) => item.status === "recognized").length, total: finalRecords.length, batchCalls: restoredBatchCalls + batchCalls, next: "继续生成检索数据。" }), "completed");
  const failed = finalRecords.filter((item) => item.status === "failed");
  if (failed.length) {
    throw new Error("OCR 识别失败：" + (failed[0].providerMessage || failed[0].title || failed[0].taskId));
  }

  return {
    artifacts: [
      artifact("ocrRecognitionReport", "OCR 识别报告", "OCR recognition report", reportPath, "记录 OCR 页任务、批量调用次数、失败项和模型信息。", "Records OCR page tasks, batch calls, failures, and model information."),
      artifact("ocrResult", "OCR 识别结果", "OCR result", resultPath, "保存页级和图片级识别结果，供后续清洗分段使用。", "Stores page-level and image-level OCR output for later cleaning and chunking.")
    ]
  };
}
async function buildOcrTasks({ plan, template, state, job, processingManifest, log }) {
  const documentsByVersion = new Map(plan.documents.map((document) => [document.version_id, document]));
  const tasks = [];
  for (const input of processingManifest.inputs || []) {
    const document = documentsByVersion.get(input.version_id);
    if (!document) continue;
    if (input.processingInput === "page-tasks") {
      log?.(`准备拆分 PDF：${input.relativePath || document.relativePath}`, `Preparing PDF pages: ${input.relativePath || document.relativePath}`, { relativePath: input.relativePath || document.relativePath, document_id: document.document_id });
      const pages = await renderPdfPages(state, { plan, template, job, document, input, log });
      log?.(`已生成 OCR 页任务 ${pages.length} 页：${input.relativePath || document.relativePath}`, `Prepared ${pages.length} OCR page task(s): ${input.relativePath || document.relativePath}`, { relativePath: input.relativePath || document.relativePath, pages: pages.length, document_id: document.document_id }, "completed");
      for (const page of pages) {
        tasks.push(ocrTask(document, input, {
          taskId: document.version_id + ":page:" + page.pageNumber,
          inputKind: "pdf-page",
          pageNumber: Number(page.pageNumber || 1),
          inputPath: page.path || page.filePath || "",
          width: page.width || null,
          height: page.height || null
        }));
      }
    }
    if (input.processingInput === "image-ocr") {
      tasks.push(ocrTask(document, input, {
        taskId: document.version_id + ":image:1",
        inputKind: "image",
        pageNumber: 1,
        inputPath: sourcePathForDocument(document),
        width: null,
        height: null
      }));
    }
  }
  return tasks;
}

async function renderPdfPages(state, context) {
  const outputDir = path.join(context.plan.workspace.artifactRoot, "ocr", "pages", context.document.version_id);
  ensureDir(outputDir);
  const sourcePath = sourcePathForDocument(context.document, { log: context.log });
  const cachedPages = readRenderedPdfPagesCache(outputDir, sourcePath);
  if (cachedPages.length) {
    context.log?.(
      `复用已拆页 PDF：${context.input.relativePath || context.document.relativePath}，共 ${cachedPages.length} 页。`,
      `Reusing rendered PDF pages: ${context.input.relativePath || context.document.relativePath} (${cachedPages.length} page(s)).`,
      { relativePath: context.input.relativePath || context.document.relativePath, pages: cachedPages.length, document_id: context.document.document_id },
      "completed",
      "checkpoint"
    );
    return cachedPages;
  }

  const inferredPages = inferRenderedPdfPages(outputDir);
  if (inferredPages.length) {
    writeRenderedPdfPagesCache(outputDir, { document: context.document, sourcePath, pages: inferredPages });
    context.log?.(
      `复用已存在页图：${context.input.relativePath || context.document.relativePath}，共 ${inferredPages.length} 页。`,
      `Reusing existing rendered page images: ${context.input.relativePath || context.document.relativePath} (${inferredPages.length} page(s)).`,
      { relativePath: context.input.relativePath || context.document.relativePath, pages: inferredPages.length, document_id: context.document.document_id },
      "completed",
      "checkpoint"
    );
    return inferredPages;
  }

  const renderer = typeof state.pdfPageRenderer === "function" ? state.pdfPageRenderer : ghostscriptPdfPageRenderer(state);
  const pages = normalizeRenderedPdfPages(await renderer({ ...context, sourcePath, outputDir }));
  if (!pages.length) throw new Error("PDF 拆页没有返回页任务列表。");
  writeRenderedPdfPagesCache(outputDir, { document: context.document, sourcePath, pages });
  return pages;
}

function ghostscriptPdfPageRenderer(state = {}) {
  return async ({ document, outputDir, sourcePath }) => {
    const inputPath = sourcePath || sourcePathForDocument(document);
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error(`PDF 源文件不存在，无法拆页：${document.relativePath || document.title}`);
    const command = resolveGhostscriptCommand(state);
    if (!command) throw new Error("扫描版 PDF 需要 Ghostscript 才能拆成页图。请安装 Ghostscript，或把 gs/gswin64c 加入 PATH 后重试。");

    const dpi = clampInteger(state.pdfRenderDpi || 180, 96, 300);
    const outputPattern = path.join(outputDir, "page-%04d.png");
    const args = [
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=png16m",
      `-r${dpi}`,
      "-dTextAlphaBits=4",
      "-dGraphicsAlphaBits=4",
      `-sOutputFile=${outputPattern}`,
      inputPath
    ];
    await runPdfRendererCommand(state, command, args);
    const pages = fs.readdirSync(outputDir)
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => pageNumberFromRenderedName(a) - pageNumberFromRenderedName(b))
      .map((name) => ({
        pageNumber: pageNumberFromRenderedName(name),
        path: path.join(outputDir, name),
        width: null,
        height: null
      }));
    if (!pages.length) throw new Error(`PDF 拆页没有生成页图片：${document.relativePath || document.title}`);
    return pages;
  };
}

function pageNumberFromRenderedName(name) {
  const match = String(name || "").match(/page-(\d+)\.png$/i);
  return match ? Number(match[1]) : 1;
}

function renderedPagesManifestPath(outputDir) {
  return path.join(outputDir, "pages.manifest.json");
}

function readRenderedPdfPagesCache(outputDir, sourcePath) {
  const manifest = readJsonFileIfExists(renderedPagesManifestPath(outputDir));
  if (!manifest || manifest.kind !== "knowmesh.renderedPdfPages") return [];
  if (!sameSourceFingerprint(manifest.source, sourcePath)) return [];
  return normalizeRenderedPdfPages(manifest.pages).filter((page) => fs.existsSync(page.path));
}

function inferRenderedPdfPages(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  const pages = fs.readdirSync(outputDir)
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .sort((a, b) => pageNumberFromRenderedName(a) - pageNumberFromRenderedName(b))
    .map((name) => ({
      pageNumber: pageNumberFromRenderedName(name),
      path: path.join(outputDir, name),
      width: null,
      height: null
    }))
    .filter((page) => fs.existsSync(page.path) && fs.statSync(page.path).size > 0);
  if (!pages.length) return [];
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index].pageNumber !== index + 1) return [];
  }
  return pages;
}

function writeRenderedPdfPagesCache(outputDir, { document, sourcePath, pages }) {
  const normalizedPages = normalizeRenderedPdfPages(pages);
  if (!normalizedPages.length) return;
  writeJsonFile(renderedPagesManifestPath(outputDir), {
    kind: "knowmesh.renderedPdfPages",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    source: sourceFingerprint(sourcePath),
    document: {
      document_id: document.document_id,
      version_id: document.version_id,
      relativePath: document.relativePath || ""
    },
    pages: normalizedPages.map((page) => ({
      pageNumber: page.pageNumber,
      path: page.path,
      width: page.width ?? null,
      height: page.height ?? null
    }))
  });
}

function normalizeRenderedPdfPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page) => page && (page.path || page.filePath))
    .map((page, index) => ({
      pageNumber: Number(page.pageNumber || index + 1),
      path: page.path || page.filePath,
      width: page.width ?? null,
      height: page.height ?? null
    }))
    .filter((page) => page.path);
}

function sourceFingerprint(sourcePath) {
  const resolvedPath = sourcePath ? path.resolve(sourcePath) : "";
  if (!sourcePath || !fs.existsSync(sourcePath)) return { path: resolvedPath, size: null, mtimeMs: null };
  const stat = fs.statSync(sourcePath);
  return { path: resolvedPath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) };
}

function sameSourceFingerprint(cached, sourcePath) {
  if (!cached?.path) return false;
  const current = sourceFingerprint(sourcePath);
  if (cached.path !== current.path) return false;
  if (cached.size !== null && cached.size !== current.size) return false;
  if (cached.mtimeMs !== null && current.mtimeMs !== null && Math.abs(cached.mtimeMs - current.mtimeMs) > 2) return false;
  return true;
}

function readJsonFileIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveGhostscriptCommand(state = {}) {
  if (state.pdfRendererCommand) return state.pdfRendererCommand;
  if (process.env.KNOWMESH_GHOSTSCRIPT_PATH) return process.env.KNOWMESH_GHOSTSCRIPT_PATH;
  const names = process.platform === "win32" ? ["gswin64c.exe", "gswin32c.exe", "gs.exe"] : ["gs"];
  const fromPath = findExecutableOnPath(names);
  if (fromPath) return fromPath;
  if (process.platform === "win32") return findWindowsGhostscript(names);
  return "";
}

function findExecutableOnPath(names) {
  const paths = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

function findWindowsGhostscript(names) {
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const root of roots) {
    const gsRoot = path.join(root, "gs");
    if (!fs.existsSync(gsRoot)) continue;
    const versions = fs.readdirSync(gsRoot).sort().reverse();
    for (const version of versions) {
      for (const name of names) {
        const candidate = path.join(gsRoot, version, "bin", name);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return "";
}

function runPdfRendererCommand(state, command, args) {
  if (typeof state.pdfRendererCommandRunner === "function") return state.pdfRendererCommandRunner({ command, args });
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`PDF 拆页失败：Ghostscript 返回 ${code}。${stderr || stdout}`));
    });
  });
}

function ocrTask(document, input, task) {
  return {
    ...task,
    document,
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    sourceType: document.sourceType,
    relativePath: document.relativePath,
    sourceArchive: input.sourceArchive || []
  };
}

function sourcePathForDocument(document, options = {}) {
  if (document?.sourceType === "split-pdf") return materializeSplitPdfDocument(document, options.log);
  return document.sourceParts?.[0]?.path || document.sourcePath || "";
}

function materializeSplitPdfDocument(document, log) {
  const targetPath = document.artifacts?.raw || document.merge?.outputPath || document.sourcePath || "";
  if (!targetPath) throw new Error(`分卷 PDF 缺少合并输出路径：${document.relativePath || document.title}`);
  const parts = [...(Array.isArray(document.sourceParts) ? document.sourceParts : [])]
    .filter((part) => part?.path)
    .sort((a, b) => Number(a.partNumber || 0) - Number(b.partNumber || 0));
  if (!parts.length) throw new Error(`分卷 PDF 没有找到源分卷：${document.relativePath || document.title}`);
  const partNumbers = new Set(parts.map((part) => Number(part.partNumber || 0)).filter((number) => number > 0));
  const maxPartNumber = Math.max(...partNumbers);
  const missingParts = [];
  for (let partNumber = 1; partNumber <= maxPartNumber; partNumber += 1) {
    if (!partNumbers.has(partNumber)) missingParts.push(partNumber);
  }
  if (missingParts.length) throw new Error(`分卷 PDF 缺少分卷 ${missingParts.join(", ")}：${document.relativePath || document.title}`);

  const newestPartTime = Math.max(...parts.map((part) => fs.existsSync(part.path) ? fs.statSync(part.path).mtimeMs : 0));
  if (fs.existsSync(targetPath)) {
    const targetStat = fs.statSync(targetPath);
    if (targetStat.size > 0 && targetStat.mtimeMs >= newestPartTime) return targetPath;
  }

  for (const part of parts) {
    if (!fs.existsSync(part.path)) throw new Error(`分卷 PDF 缺少源文件：${part.relativePath || part.path}`);
  }

  ensureDir(path.dirname(targetPath));
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  log?.(`正在合并分卷 PDF：${document.relativePath}（${parts.length} 个分卷）。`, `Merging split PDF: ${document.relativePath} (${parts.length} part(s)).`, { relativePath: document.relativePath, parts: parts.length, outputPath: targetPath });
  mergeFiles(parts.map((part) => part.path), tempPath);
  fs.renameSync(tempPath, targetPath);
  log?.(`分卷 PDF 已合并：${document.relativePath}。`, `Split PDF merged: ${document.relativePath}.`, { relativePath: document.relativePath, parts: parts.length, outputPath: targetPath, size: fs.statSync(targetPath).size }, "completed");
  return targetPath;
}

function mergeFiles(inputPaths, outputPath) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let outputFd = null;
  try {
    outputFd = fs.openSync(outputPath, "w");
    for (const inputPath of inputPaths) {
      const inputFd = fs.openSync(inputPath, "r");
      try {
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(inputFd, buffer, 0, buffer.length, null)) > 0) {
          fs.writeSync(outputFd, buffer, 0, bytesRead);
        }
      } finally {
        fs.closeSync(inputFd);
      }
    }
  } catch (error) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
    throw error;
  } finally {
    if (outputFd !== null) fs.closeSync(outputFd);
  }
}

async function recognizeOcrBatchWithRecovery(state, request, log, depth = 0) {
  try {
    return await recognizeOcrBatch(state, request);
  } catch (error) {
    if (!shouldSplitBatchError(error) || request.items.length <= 1) throw error;
    const midpoint = Math.ceil(request.items.length / 2);
    const left = request.items.slice(0, midpoint);
    const right = request.items.slice(midpoint);
    log?.(
      `OCR 批次被限流或过大，已拆成 ${left.length} + ${right.length} 个小批重试。`,
      `OCR batch was throttled or too large; split into ${left.length} + ${right.length} smaller batches.`,
      progressDetail({ action: "拆分 OCR 批次", items: request.items.length, retry: depth + 1, next: "小批次会继续按页保留进度和引用。" }),
      "running",
      "checkpoint"
    );
    const batchPolicy = { ...(request.batchPolicy || {}), splitFrom: request.items.length };
    const leftResults = await recognizeOcrBatchWithRecovery(state, { ...request, items: left, batchPolicy }, log, depth + 1);
    const rightResults = await recognizeOcrBatchWithRecovery(state, { ...request, items: right, batchPolicy }, log, depth + 1);
    return [...leftResults, ...rightResults];
  }
}
async function recognizeOcrBatch(state, request) {
  if (typeof state.ocrBatchRecognizer === "function") {
    const result = await state.ocrBatchRecognizer(request);
    return Array.isArray(result) ? result : result?.results || [];
  }

  const providerResults = await modelProviderOcrBatch(state, request);
  if (providerResults) return providerResults;

  if (typeof state.ocrRecognizer === "function") {
    const concurrency = request.batchPolicy?.concurrency ?? ocrConcurrencyFor(state);
    return mapWithConcurrency(request.items, concurrency, (item) => state.ocrRecognizer({ ...request, item }));
  }
  throw new Error("OCR 识别当前缺少可用的模型连接。请先在模型服务页保存并测试 OCR 模型。");
}

async function modelProviderOcrBatch(state, request) {
  const adapter = createAliyunModelStudioAdapter(state, { retry: retryPolicyFor(state, "ocr") });
  return adapter.recognizeOcrBatch(request);
}

function buildOcrChatPayload(request, item) {
  return {
    model: request.model,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: imageDataUrlForTask(item) },
            min_pixels: 32 * 32 * 3,
            max_pixels: 32 * 32 * 8192
          },
          {
            type: "text",
            text: ocrPromptForTask(request)
          }
        ]
      }
    ]
  };
}

function imageDataUrlForTask(item) {
  const filePath = item.inputPath || "";
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`OCR 输入文件不存在：${item.relativePath || item.taskId}`);
  const bytes = fs.readFileSync(filePath);
  const maxBytes = 25 * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error(`OCR 输入图片过大，请降低 PDF 拆页清晰度或拆分资料：${item.relativePath || item.taskId}`);
  return `data:${mimeTypeForImagePath(filePath)};base64,${bytes.toString("base64")}`;
}

function mimeTypeForImagePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function ocrPromptForTask(request) {
  const isK12 = request.template?.id === "textbook-cn-k12" || request.template?.expertName === "KnowMesh Expert · K12";
  if (isK12) {
    return [
      "请只输出这页教材中真实可见的内容。",
      "保留章节标题、知识点、例题、题号、选项、答案解析、表格、公式和图文对应关系。",
      "过滤页眉、页脚、水印、下载站提示、网址、重复页码和无关装饰。",
      "公式尽量用 LaTeX 或结构化文本表达，无法确认的字符用 [?] 标记。",
      "不要补写图片中没有的内容，也不要总结。"
    ].join("\n");
  }
  return [
    "请只输出图片中真实可见的文字内容。",
    "保留标题、段落、列表、表格和公式结构。",
    "过滤页眉、页脚、水印、网址和重复页码等噪声。",
    "无法确认的字符用 [?] 标记，不要编造或总结。"
  ].join("\n");
}

function extractOcrResponseText(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content ?? data?.output_text ?? data?.text ?? "";
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return String(content || "").trim();
}

function normalizeOcrResult(task, result = {}, model) {
  const status = result.status || (result.text ? "recognized" : "failed");
  return {
    taskId: task.taskId,
    document_id: task.document_id,
    version_id: task.version_id,
    title: task.title,
    sourceType: task.sourceType,
    relativePath: task.relativePath,
    inputKind: task.inputKind,
    inputPath: task.inputPath,
    page_number: task.pageNumber,
    status,
    text: result.text || "",
    confidence: result.confidence ?? null,
    model,
    usage: result.usage || null,
    providerMessage: result.providerMessage || result.message || "",
    sourceArchive: task.sourceArchive || []
  };
}

function buildOcrReport({ plan, template, job, tasks, recognized, batchSize, batchCalls }) {
  const failed = recognized.filter((item) => item.status === "failed");
  return {
    kind: "knowmesh.ocrRecognitionReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    engine: {
      name: template?.coreName || "KnowMesh Core",
      stage: "ocr"
    },
    template: {
      id: template?.id || job.template,
      role: template?.templateRole || "",
      extendsTemplate: template?.extendsTemplate || null,
      expertName: template?.expertName || null
    },
    project: plan.project,
    job: { id: job.id, mode: job.mode, template: job.template },
    batchPolicy: {
      mode: "batch-first",
      batchSize,
      fallback: "single-item-adapter-only-when-batch-adapter-is-missing"
    },
    summary: {
      documents: new Set(tasks.map((item) => item.version_id)).size,
      totalTasks: tasks.length,
      recognizedTasks: recognized.filter((item) => item.status === "recognized").length,
      failedTasks: failed.length,
      pdfPageTasks: tasks.filter((item) => item.inputKind === "pdf-page").length,
      imageTasks: tasks.filter((item) => item.inputKind === "image").length,
      batchCalls
    },
    failures: failed.map((item) => ({ taskId: item.taskId, title: item.title, page_number: item.page_number, message: item.providerMessage }))
  };
}

function writePerDocumentOcrResults(documents, records) {
  const byVersion = new Map();
  for (const record of records) {
    if (!byVersion.has(record.version_id)) byVersion.set(record.version_id, []);
    byVersion.get(record.version_id).push(record);
  }
  for (const document of documents) {
    const documentRecords = byVersion.get(document.version_id);
    if (documentRecords?.length) writeJsonl(document.artifacts.ocr, documentRecords);
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function isPauseRequested(job) {
  return job?.pauseRequested === true || job?.status === "pausing";
}

function progressDetail(detail = {}) {
  const completed = Number(detail.completed ?? detail.completedItems ?? 0);
  const total = Number(detail.total ?? detail.totalItems ?? 0);
  const remaining = Number(detail.remaining ?? (total ? Math.max(0, total - completed) : 0));
  return {
    action: detail.action || "任务处理中",
    progress: {
      batch: detail.batch ?? null,
      totalBatches: detail.totalBatches ?? null,
      items: detail.items ?? null,
      completed,
      total,
      remaining,
      percent: total ? Math.round((completed / total) * 100) : null
    },
    result: {
      succeeded: Number(detail.succeeded ?? 0),
      failed: Number(detail.failed ?? detail.failedItems ?? 0),
      skipped: Number(detail.skipped ?? 0),
      retry: Number(detail.retry ?? detail.retryItems ?? 0)
    },
    next: detail.next || "自动继续下一步。",
    ...detail
  };
}

function uniqueRecordsByKey(records, key) {
  const map = new Map();
  for (const record of records || []) {
    const value = record?.[key];
    if (!value || map.has(value)) continue;
    map.set(value, record);
  }
  return [...map.values()];
}

function appendJsonl(file, records) {
  writeJsonl(file, records, { append: true });
}

async function executeEmbeddingImplementation({ plan, template, state }, job, log) {
  const reportPath = path.join(plan.workspace.artifactRoot, "reports", "search-data.report.json");
  const qualityReportPath = path.join(plan.workspace.artifactRoot, "reports", "quality-lifecycle.report.json");
  const reviewQueuePath = path.join(plan.workspace.artifactRoot, "review", "review-queue.jsonl");
  const recordsPath = path.join(plan.workspace.artifactRoot, "index_records", "index-records.pending.jsonl");
  const documentInventoryPath = path.join(plan.workspace.manifests, "document-inventory.json");
  const embeddingInputPlan = buildEmbeddingInputs(plan, job, { state });
  const inputs = embeddingInputPlan.inputs;
  writeJsonFile(documentInventoryPath, embeddingInputPlan.inventory);
  if (!inputs.length) throw new Error("没有可用于生成检索数据的知识片段，请先完成清洗分段或 OCR 识别。");

  const model = String(job.draft?.["aliyun.services.embedding"] || "");
  const runtime = await embeddingRuntimeInfo(state);
  const batchSize = embeddingBatchSizeFor(state, model, runtime);
  const existing = uniqueRecordsByKey(readJsonlFile(recordsPath).filter((item) => (item?.status === "embedded" || item?.status === "failed") && embeddingInputPlan.allowedChunkIds.has(item.chunk_id)), "chunk_id");
  const completedChunkIds = new Set(existing.map((item) => item.chunk_id).filter(Boolean));
  const pendingInputs = inputs.filter((input) => !completedChunkIds.has(input.chunk_id));
  const records = [...existing];
  const restoredBatchCalls = existing.length ? Math.ceil(existing.length / batchSize) : 0;
  let batchCalls = 0;

  if (existing.length) {
    log(
      `已恢复向量化进度：跳过已完成 ${existing.length} 个片段，继续处理剩余 ${pendingInputs.length} 个片段。`,
      `Embedding progress restored: skipped ${existing.length} completed chunk(s), continuing with ${pendingInputs.length} remaining chunk(s).`,
      progressDetail({ action: "恢复向量化进度", completed: existing.length, total: inputs.length, remaining: pendingInputs.length, next: pendingInputs.length ? "继续处理未完成片段。" : "没有剩余片段。" })
    );
  }

  log(
    `准备生成检索数据：${inputs.length} 个片段，剩余 ${pendingInputs.length} 个等待向量化。`,
    `Preparing search data: ${inputs.length} chunk(s), ${pendingInputs.length} remaining for embedding.`,
    progressDetail({ action: "准备向量化", completed: records.length, total: inputs.length, remaining: pendingInputs.length, batchSize, model })
  );

  const batches = chunkArray(pendingInputs, batchSize);
  for (const [batchIndex, batch] of batches.entries()) {
    const absoluteBatch = restoredBatchCalls + batchIndex + 1;
    const totalBatches = restoredBatchCalls + batches.length;
    log(
      `向量化批次 ${absoluteBatch}/${totalBatches}：正在处理 ${batch.length} 个片段，累计 ${records.length}/${inputs.length}。`,
      `Embedding batch ${absoluteBatch}/${totalBatches}: processing ${batch.length} chunk(s), ${records.length}/${inputs.length} completed so far.`,
      progressDetail({ action: "正在向量化", batch: absoluteBatch, totalBatches, items: batch.length, completed: records.length, total: inputs.length, remaining: Math.max(0, inputs.length - records.length), model, next: "本批完成后会写入本地进度。" })
    );
    const batchResults = await generateEmbeddingBatchWithRecovery(state, {
      items: batch,
      model,
      provider: "aliyun",
      template,
      job,
      batchPolicy: { mode: "batch-first", batchSize }
    }, log);
    batchCalls += 1;
    const normalized = batch.map((item, index) => normalizeIndexRecord(item, batchResults[index], model));
    appendJsonl(recordsPath, normalized);
    syncPendingIndexRecordsToCatalog(state, normalized, {
      plan,
      job,
      model,
      provider: runtime.provider || "aliyun",
      retry: runtime.retry || retryPolicyFor(state, "embedding"),
      batch: absoluteBatch,
      totalBatches,
      batchSize
    });
    records.push(...normalized);
    const embedded = normalized.filter((item) => item.status === "embedded").length;
    const failed = normalized.filter((item) => item.status === "failed");
    const batchCheckpoint = progressDetail({ action: "向量化批次完成", batch: absoluteBatch, totalBatches, succeeded: embedded, failed: failed.length, completed: records.length, total: inputs.length, remaining: Math.max(0, inputs.length - records.length), completedItems: records.length, failedItems: failed.length, retryItems: 0, next: failed.length ? "先处理失败项。" : "自动进入下一批。" });
    writeArtifactCheckpoint({ plan, job, stage: "embedding", checkpoint: batchCheckpoint, files: { recordsPath, reportPath, qualityReportPath, reviewQueuePath, documentInventoryPath } });
    log(
      `向量化批次 ${absoluteBatch}/${totalBatches} 完成：本批 ${embedded}/${normalized.length} 成功，累计 ${records.length}/${inputs.length}。`,
      `Embedding batch ${absoluteBatch}/${totalBatches} complete: ${embedded}/${normalized.length} embedded, ${records.length}/${inputs.length} total.`,
      batchCheckpoint,
      failed.length ? "failed" : "completed"
    );

    if (failed.length) {
      const lifecycle = buildQualityLifecycle(records, { plan, job, knowledgeBase: knowledgeBaseInfo(state), datasetVersionId: job.datasetVersionId });
      writeJsonl(recordsPath, lifecycle.records);
      syncPendingIndexRecordsToCatalog(state, lifecycle.records, {
        plan,
        job,
        model,
        provider: runtime.provider || "aliyun",
        retry: runtime.retry || retryPolicyFor(state, "embedding"),
        batch: absoluteBatch,
        totalBatches,
        batchSize
      });
      syncQualityLifecycleIssuesToCatalog(state, lifecycle, { plan, job });
      writeJsonl(reviewQueuePath, reviewQueueOutputRecords(lifecycle.reviewRecords));
      writeJsonFile(qualityReportPath, buildQualityLifecycleReport(lifecycle, { plan, job, knowledgeBase: knowledgeBaseInfo(state) }));
      writeJsonFile(reportPath, buildSearchDataReport({ plan, template, job, inputs, records: lifecycle.records, batchSize, batchCalls: restoredBatchCalls + batchCalls, runtime, lifecycle }));
      throw new Error("生成检索数据失败：" + (failed[0].providerMessage || failed[0].chunk_id));
    }

    if (isPauseRequested(job) && records.length < inputs.length) {
      const lifecycle = buildQualityLifecycle(records, { plan, job, knowledgeBase: knowledgeBaseInfo(state), datasetVersionId: job.datasetVersionId });
      const checkpoint = progressDetail({
        action: "向量化已暂停",
        step: "embedding",
        batch: absoluteBatch,
        totalBatches,
        completed: records.length,
        total: inputs.length,
        remaining: Math.max(0, inputs.length - records.length),
        completedItems: records.length,
        failedItems: records.filter((item) => item.status === "failed").length,
        retryItems: 0,
        next: "恢复任务后会从剩余片段继续，不会重跑已完成片段。"
      });
      writeArtifactCheckpoint({ plan, job, stage: "embedding", checkpoint, files: { recordsPath, reportPath, qualityReportPath, reviewQueuePath, documentInventoryPath } });
      writeJsonl(recordsPath, lifecycle.records);
      syncPendingIndexRecordsToCatalog(state, lifecycle.records, {
        plan,
        job,
        model,
        provider: runtime.provider || "aliyun",
        retry: runtime.retry || retryPolicyFor(state, "embedding"),
        batch: absoluteBatch,
        totalBatches,
        batchSize
      });
      syncQualityLifecycleIssuesToCatalog(state, lifecycle, { plan, job });
      writeJsonl(reviewQueuePath, reviewQueueOutputRecords(lifecycle.reviewRecords));
      writeJsonFile(qualityReportPath, buildQualityLifecycleReport(lifecycle, { plan, job, knowledgeBase: knowledgeBaseInfo(state) }));
      writeJsonFile(reportPath, { ...buildSearchDataReport({ plan, template, job, inputs, records: lifecycle.records, batchSize, batchCalls: restoredBatchCalls + batchCalls, runtime, lifecycle }), partial: true, checkpoint });
      log(
        `已暂停向量化：当前已完成 ${records.length}/${inputs.length} 个片段，恢复后继续剩余 ${Math.max(0, inputs.length - records.length)} 个。`,
        `Embedding paused: ${records.length}/${inputs.length} chunk(s) completed; resume continues with ${Math.max(0, inputs.length - records.length)} remaining.`,
        checkpoint,
        "paused",
        "checkpoint"
      );
      return {
        paused: true,
        checkpoint,
        artifacts: [
          artifact("searchDataReport", "检索数据报告", "Search data report", reportPath, "记录分片数量、批量向量化次数、模型和失败项。", "Records chunk count, embedding batches, model, and failures."),
          artifact("qualityLifecycleReport", "质量分层报告", "Quality lifecycle report", qualityReportPath, "记录哪些片段进入当前知识库, 哪些需要用户复核。", "Records which chunks become active and which need review."),
          artifact("reviewQueue", "待确认队列", "Review queue", reviewQueuePath, "保存低置信度或疑似噪声片段, 不默认写入知识库。", "Stores low-confidence or noisy chunks without activating them by default."),
          artifact("pendingIndexRecords", "待写入索引记录", "Pending index records", recordsPath, "保存已生成向量但尚未写入知识库的记录。", "Stores vectorized records that are not written to the knowledge base yet."),
          artifact("documentInventory", "资料范围清单", "Document inventory", documentInventoryPath, "记录当前知识库纳入和排除的资料。", "Records source documents included in and excluded from this knowledge base.")
        ]
      };
    }
  }

  const finalRecords = uniqueRecordsByKey(records, "chunk_id");
  const lifecycle = buildQualityLifecycle(finalRecords, { plan, job, knowledgeBase: knowledgeBaseInfo(state), datasetVersionId: job.datasetVersionId });
  const report = buildSearchDataReport({ plan, template, job, inputs, records: lifecycle.records, batchSize, batchCalls: restoredBatchCalls + batchCalls, runtime, lifecycle });
  const qualityReport = buildQualityLifecycleReport(lifecycle, { plan, job, knowledgeBase: knowledgeBaseInfo(state) });
  writeJsonl(recordsPath, lifecycle.records);
  syncPendingIndexRecordsToCatalog(state, lifecycle.records, {
    plan,
    job,
    model,
    provider: runtime.provider || "aliyun",
    retry: runtime.retry || retryPolicyFor(state, "embedding"),
    batch: restoredBatchCalls + batchCalls,
    totalBatches: restoredBatchCalls + batchCalls,
    batchSize
  });
  syncQualityLifecycleIssuesToCatalog(state, lifecycle, { plan, job });
  writeJsonl(reviewQueuePath, reviewQueueOutputRecords(lifecycle.reviewRecords));
  writeJsonFile(qualityReportPath, qualityReport);
  writeJsonFile(reportPath, report);

  log(`检索数据已生成：${finalRecords.filter((item) => item.status === "embedded").length}/${finalRecords.length} 个片段完成向量化，${lifecycle.activeRecords.length} 个可写入，${lifecycle.reviewRecords.length} 个待确认。`, `Search data ready: ${finalRecords.filter((item) => item.status === "embedded").length}/${finalRecords.length} chunk(s) embedded, ${lifecycle.activeRecords.length} writable, ${lifecycle.reviewRecords.length} for review.`, progressDetail({ action: "向量化完成", succeeded: finalRecords.filter((item) => item.status === "embedded").length, total: finalRecords.length, active: lifecycle.activeRecords.length, review: lifecycle.reviewRecords.length, batchCalls: restoredBatchCalls + batchCalls, next: "继续写入知识库。" }), "completed");
  const failed = finalRecords.filter((item) => item.status === "failed");
  if (failed.length) throw new Error("生成检索数据失败：" + (failed[0].providerMessage || failed[0].chunk_id));

  return {
    artifacts: [
      artifact("searchDataReport", "检索数据报告", "Search data report", reportPath, "记录分片数量、批量向量化次数、模型和失败项。", "Records chunk count, embedding batches, model, and failures."),
      artifact("qualityLifecycleReport", "质量分层报告", "Quality lifecycle report", qualityReportPath, "记录哪些片段进入当前知识库, 哪些需要用户复核。", "Records which chunks become active and which need review."),
      artifact("reviewQueue", "待确认队列", "Review queue", reviewQueuePath, "保存低置信度或疑似噪声片段, 不默认写入知识库。", "Stores low-confidence or noisy chunks without activating them by default."),
      artifact("pendingIndexRecords", "待写入索引记录", "Pending index records", recordsPath, "保存已生成向量但尚未写入知识库的记录。", "Stores vectorized records that are not written to the knowledge base yet."),
      artifact("documentInventory", "资料范围清单", "Document inventory", documentInventoryPath, "记录当前知识库纳入和排除的资料。", "Records source documents included in and excluded from this knowledge base.")
    ]
  };
}
export function buildEmbeddingInputs(plan, job = {}, options = {}) {
  const localChunksPath = path.join(plan.workspace.artifactRoot, "chunks", "local-chunks.jsonl");
  const ocrResultPath = path.join(plan.workspace.artifactRoot, "ocr", "ocr-result.jsonl");
  const scope = buildInputScope(plan, job);
  const inputs = [];
  const excludedArtifacts = [];
  const catalogChunks = options.state ? readCatalogChunks(options.state, { includeWriteDisabled: true }) : [];

  if (catalogChunks.length) {
    for (const chunk of catalogChunks) {
      const source = chunk.metadata?.source || "catalog-chunk";
      const decision = inputScopeDecision(chunk, scope, source);
      if (!decision.included) {
        excludedArtifacts.push(excludedArtifact(chunk, source, decision.reason));
        continue;
      }
      inputs.push(embeddingInputFromCatalogChunk(chunk, source));
    }
  } else {
    for (const chunk of readJsonlFile(localChunksPath)) {
      if (!chunk?.text) continue;
      const decision = inputScopeDecision(chunk, scope, "cleaned-chunk");
      if (!decision.included) {
        excludedArtifacts.push(excludedArtifact(chunk, "cleaned-chunk", decision.reason));
        continue;
      }
      inputs.push({
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        version_id: chunk.version_id,
        active: false,
        text: chunk.text,
        source: "cleaned-chunk",
        sourceUri: chunk.sourceUri || "",
        sourceParts: chunk.sourceParts || [],
        page_start: chunk.page_start || null,
        page_end: chunk.page_end || null,
        metadata: { ...(chunk.metadata || {}), source: "cleaned-chunk" }
      });
    }
    for (const page of readJsonlFile(ocrResultPath)) {
      if (page?.status !== "recognized" || !page.text) continue;
      const decision = inputScopeDecision(page, scope, "ocr-page");
      if (!decision.included) {
        excludedArtifacts.push(excludedArtifact(page, "ocr-page", decision.reason));
        continue;
      }
      splitText(page.text, 1000).forEach((text, index) => {
        inputs.push({
          chunk_id: page.version_id + "_ocr_" + String(page.page_number || 1).padStart(4, "0") + "_" + String(index + 1).padStart(3, "0"),
          document_id: page.document_id,
          version_id: page.version_id,
          active: false,
          text,
          source: "ocr-page",
          sourceUri: page.relativePath || "",
          sourceParts: page.sourceArchive || [],
          page_start: page.page_number || null,
          page_end: page.page_number || null,
          metadata: {
            title: page.title,
            sourceType: page.sourceType,
            source: "ocr-page",
            inputKind: page.inputKind,
            confidence: page.confidence
          }
        });
      });
    }
  }

  return {
    inputs,
    allowedChunkIds: new Set(inputs.map((item) => item.chunk_id)),
    inventory: buildDocumentInventory(plan, job, { scope, inputs, excludedArtifacts })
  };
}

function embeddingInputFromCatalogChunk(chunk, source) {
  return {
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    version_id: chunk.version_id,
    active: false,
    text: chunk.text,
    source,
    sourceUri: chunk.sourceUri || chunk.metadata?.sourceUri || "",
    sourceParts: chunk.sourceParts || [],
    page_start: chunk.page_start ?? null,
    page_end: chunk.page_end ?? null,
    metadata: { ...(chunk.metadata || {}), source }
  };
}

function buildInputScope(plan, job = {}) {
  const documents = Array.isArray(plan.documents) ? plan.documents : [];
  const byDocumentId = new Map(documents.map((document) => [document.document_id, document]));
  const byVersionId = new Map(documents.map((document) => [document.version_id, document]));
  const pathKeys = new Set(documents.map((document) => normalizeScopeKey(document.relativePath)).filter(Boolean));
  const gate = buildK12SourceScopeGate({ id: job.template || plan.project?.id || "" }, job.draft || {}, documents);
  return {
    enabled: gate.enabled,
    selected: gate.selected,
    gate: {
      status: gate.status,
      totalDocuments: gate.totalDocumentsBeforeScope,
      includedDocuments: gate.includedDocuments,
      excludedDocuments: gate.excludedDocuments
    },
    documents,
    byDocumentId,
    byVersionId,
    pathKeys
  };
}

function inputScopeDecision(item, scope, source) {
  const relativePath = item.relativePath || item.sourceUri || item.metadata?.relativePath || "";
  if (item.document_id && scope.byDocumentId.has(item.document_id)) return { included: true, reason: "current_document" };
  if (item.version_id && scope.byVersionId.has(item.version_id)) return { included: true, reason: "current_version" };
  if (relativePath && scope.pathKeys.has(normalizeScopeKey(relativePath))) return { included: true, reason: "current_path" };
  if (!scope.enabled) return { included: true, reason: "scope_not_enabled" };
  if (relativePath) {
    const decision = k12ScopeDecision({ relativePath, title: item.title || item.metadata?.title || "" }, scope.selected);
    if (!decision.included) {
      return { included: false, reason: decision.reason || "outside_current_scope" };
    }
    return { included: true, reason: "matched_scope" };
  }
  return { included: false, reason: source === "ocr-page" ? "ocr_artifact_not_in_current_scope" : "chunk_not_in_current_scope" };
}

function excludedArtifact(item, source, reason) {
  return {
    source,
    reason,
    document_id: item.document_id || "",
    version_id: item.version_id || "",
    chunk_id: item.chunk_id || "",
    relativePath: item.relativePath || item.sourceUri || item.metadata?.relativePath || "",
    title: item.title || item.metadata?.title || "",
    page_number: item.page_number || null
  };
}

function embeddingBatchSizeFor(state, model, runtime = {}) {
  const configured = Number(state?.embeddingBatchSize || 0);
  const requested = Number.isFinite(configured) && configured > 0 ? configured : 0;
  if (runtime?.provider === "custom-batch") return Math.max(1, Math.min(requested || 96, 500));
  const limit = embeddingBatchLimitForModel(model);
  return Math.max(1, Math.min(requested || limit, limit));
}

function embeddingBatchLimitForModel(model = "") {
  return aliyunEmbeddingBatchLimit(model);
}

async function generateEmbeddingBatchWithRecovery(state, request, log, depth = 0) {
  try {
    return await generateEmbeddingBatch(state, request);
  } catch (error) {
    if (!shouldSplitBatchError(error) || request.items.length <= 1) throw error;
    const midpoint = Math.ceil(request.items.length / 2);
    const left = request.items.slice(0, midpoint);
    const right = request.items.slice(midpoint);
    log?.(
      `向量化批次被限流或过大，已拆成 ${left.length} + ${right.length} 个小批重试。`,
      `Embedding batch was throttled or too large; split into ${left.length} + ${right.length} smaller batches.`,
      progressDetail({ action: "拆分向量化批次", items: request.items.length, retry: depth + 1, next: "小批次会继续使用批量接口，不会退回逐条硬跑。" }),
      "running",
      "checkpoint"
    );
    const batchPolicy = { ...(request.batchPolicy || {}), splitFrom: request.items.length };
    const leftResults = await generateEmbeddingBatchWithRecovery(state, { ...request, items: left, batchPolicy }, log, depth + 1);
    const rightResults = await generateEmbeddingBatchWithRecovery(state, { ...request, items: right, batchPolicy }, log, depth + 1);
    return [...leftResults, ...rightResults];
  }
}
async function generateEmbeddingBatch(state, request) {
  if (typeof state.embeddingBatchGenerator === "function") {
    const result = await retryExternalCall(() => state.embeddingBatchGenerator(request), retryPolicyFor(state, "embedding"));
    return Array.isArray(result) ? result : result?.results || [];
  }

  const providerResults = await modelProviderEmbeddingBatch(state, request);
  if (providerResults) return providerResults;

  if (typeof state.embeddingGenerator === "function") {
    const concurrency = request.batchPolicy?.concurrency ?? embeddingConcurrencyFor(state);
    const retry = retryPolicyFor(state, "embedding");
    return mapWithConcurrency(request.items, concurrency, (item) => retryExternalCall(
      () => state.embeddingGenerator({ ...request, item }),
      retry
    ));
  }
  throw new Error("生成检索数据当前缺少可用的向量化模型连接。请先在模型与质量方案页确认向量化模型。");
}

async function embeddingRuntimeInfo(state) {
  const retry = retryPolicyFor(state, "embedding");
  if (typeof state.embeddingBatchGenerator === "function") return { provider: "custom-batch", retry };
  const runtime = await createAliyunModelStudioAdapter(state, { retry }).runtimeInfo();
  if (runtime.provider && runtime.protocol === "openai-compatible") {
    return { provider: runtime.provider, protocol: runtime.protocol, retry };
  }
  if (typeof state.embeddingGenerator === "function") return { provider: "custom-single", retry };
  return { provider: "", retry };
}

async function modelProviderEmbeddingBatch(state, request) {
  const adapter = createAliyunModelStudioAdapter(state, { retry: retryPolicyFor(state, "embedding") });
  return adapter.generateEmbeddingBatch(request);
}

function normalizeIndexRecord(item, result = {}, model) {
  const status = result.status || (Array.isArray(result.embedding) ? "embedded" : "failed");
  return {
    chunk_id: item.chunk_id,
    document_id: item.document_id,
    version_id: item.version_id,
    active: item.active === true,
    text: item.text,
    embedding_model: model,
    embedding: Array.isArray(result.embedding) ? result.embedding : null,
    sourceUri: item.sourceUri || "",
    sourceParts: item.sourceParts || [],
    page_start: item.page_start,
    page_end: item.page_end,
    metadata: item.metadata || {},
    datasetVersionId: item.datasetVersionId || "",
    quality: item.quality || null,
    status,
    usage: result.usage || null,
    providerMessage: result.providerMessage || result.message || ""
  };
}

function buildSearchDataReport({ plan, template, job, inputs, records, batchSize, batchCalls, runtime = {}, lifecycle = null }) {
  const failed = records.filter((item) => item.status === "failed");
  return {
    kind: "knowmesh.searchDataReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    engine: {
      name: template?.coreName || "KnowMesh Core",
      stage: "embedding"
    },
    template: {
      id: template?.id || job.template,
      role: template?.templateRole || "",
      extendsTemplate: template?.extendsTemplate || null,
      expertName: template?.expertName || null
    },
    project: plan.project,
    job: { id: job.id, mode: job.mode, template: job.template },
    batchPolicy: {
      mode: "batch-first",
      batchSize,
      provider: runtime.provider || "",
      retry: runtime.retry || retryPolicyFor(null, "embedding"),
      fallback: "single-item-adapter-only-when-batch-adapter-is-missing"
    },
    summary: {
      totalItems: inputs.length,
      embeddedItems: records.filter((item) => item.status === "embedded").length,
      failedItems: failed.length,
      cleanedChunks: inputs.filter((item) => item.source === "cleaned-chunk").length,
      ocrChunks: inputs.filter((item) => item.source === "ocr-page").length,
      batchCalls,
      ...(lifecycle ? {
        activeRecords: lifecycle.summary.activeRecords,
        reviewRecords: lifecycle.summary.reviewRecords,
        archiveRecords: lifecycle.summary.archiveRecords
      } : {})
    },
    failures: failed.map((item) => ({ chunk_id: item.chunk_id, message: item.providerMessage }))
  };
}

function reviewQueueOutputRecords(records) {
  return (records || []).map((record) => ({
    chunk_id: record.chunk_id,
    document_id: record.document_id,
    version_id: record.version_id,
    text: record.text,
    sourceUri: record.sourceUri || "",
    page_start: record.page_start || null,
    page_end: record.page_end || null,
    metadata: record.metadata || {},
    quality: record.quality || null,
    status: record.status || ""
  }));
}

async function executeVectorWriteImplementation({ plan, template, state }, job, log) {
  const pendingPath = path.join(plan.workspace.artifactRoot, "index_records", "index-records.pending.jsonl");
  const resultPath = path.join(plan.workspace.artifactRoot, "index_records", "index-write.result.jsonl");
  const reportPath = path.join(plan.workspace.artifactRoot, "reports", "knowledge-write.report.json");
  const draftManifestPath = path.join(plan.workspace.manifests, "draft-active-manifest.json");
  const activeManifestPath = path.join(plan.workspace.manifests, "active-manifest.json");
  const allPending = readJsonlFile(pendingPath).filter((item) => item?.status !== "failed" && item?.embedding);
  const writable = allPending.filter((item) => item?.quality?.writeEnabled !== false);
  if (!allPending.length) throw new Error("没有可写入知识库的检索数据，请先完成生成检索数据。");
  if (!writable.length) throw new Error("没有达到写入标准的检索数据，低置信度内容已保存在待确认队列。");

  const target = vectorTarget(job);
  const sidecar = shouldPublishAliyunSidecar(state, target)
    ? await publishAliyunSidecar({ plan, template, state, job, target, records: writable }, log)
    : null;
  const sidecarByChunkId = new Map((sidecar?.chunks || []).map((item) => [item.chunk_id, item]));
  const batchSize = Math.max(1, Math.min(Number(state.indexBatchSize || 100), 500));
  const priorResults = readJsonlFile(resultPath);
  const priorFailed = priorResults.filter((item) => item?.status === "failed");
  const existing = uniqueRecordsByKey(priorResults.filter((item) => item?.status === "written"), "chunk_id");
  if (priorFailed.length) {
    writeJsonl(resultPath, existing);
  }
  const completedChunkIds = new Set(existing.map((item) => item.chunk_id).filter(Boolean));
  const pending = writable.filter((item) => !completedChunkIds.has(item.chunk_id));
  const results = [...existing];
  const restoredBatchCalls = existing.length ? Math.ceil(existing.length / batchSize) : 0;
  let batchCalls = 0;

  if (existing.length) {
    log(
      `已恢复写入进度：跳过已成功写入 ${existing.length} 条记录，继续写入剩余 ${pending.length} 条记录。`,
      `Knowledge-base write progress restored: skipped ${existing.length} written record(s), continuing with ${pending.length} remaining record(s).`,
      progressDetail({ action: "恢复写入进度", completed: existing.length, total: writable.length, remaining: pending.length, failed: priorFailed.length, next: pending.length ? "继续写入未完成记录。" : "没有剩余写入记录。" })
    );
  }
  if (priorFailed.length) {
    log(
      `已清理上次失败记录 ${priorFailed.length} 条：这些记录会重新写入，不会被当作已完成。`,
      `Cleaned ${priorFailed.length} failed record(s) from the previous attempt; they will be retried instead of treated as complete.`,
      progressDetail({ action: "清理失败断点", failed: priorFailed.length, completed: existing.length, total: writable.length, remaining: pending.length, next: "失败项会随本次重试重新写入。" }),
      "running",
      "checkpoint"
    );
  }

  log(
    `准备写入知识库：${writable.length} 条检索记录，剩余 ${pending.length} 条等待写入。`,
    `Preparing knowledge-base write: ${writable.length} search record(s), ${pending.length} remaining.`,
    progressDetail({ action: "准备写入知识库", completed: results.length, total: writable.length, remaining: pending.length, batchSize, target })
  );

  const batches = chunkArray(pending.map((item) => ({
    ...item,
    active: true,
    sidecarUri: sidecarByChunkId.get(item.chunk_id)?.sidecarUri || "",
    sidecarContract: sidecarByChunkId.get(item.chunk_id)?.vectorMetadata || null
  })), batchSize);
  for (const [batchIndex, batch] of batches.entries()) {
    const absoluteBatch = restoredBatchCalls + batchIndex + 1;
    const totalBatches = restoredBatchCalls + batches.length;
    log(
      `写入知识库批次 ${absoluteBatch}/${totalBatches}：正在写入 ${batch.length} 条记录，累计 ${results.length}/${writable.length}。`,
      `Knowledge-base write batch ${absoluteBatch}/${totalBatches}: writing ${batch.length} record(s), ${results.length}/${writable.length} completed so far.`,
      progressDetail({ action: "正在写入知识库", batch: absoluteBatch, totalBatches, items: batch.length, completed: results.length, total: writable.length, remaining: Math.max(0, writable.length - results.length), target, next: "本批完成后会写入本地进度。" })
    );
    const batchResults = await writeVectorBatchWithRecovery(state, {
      items: batch,
      target,
      template,
      job,
      batchPolicy: { mode: "batch-first", batchSize, ensureIndex: restoredBatchCalls + batchCalls === 0 }
    }, log);
    batchCalls += 1;
    const normalized = batch.map((item, index) => normalizeIndexWriteResult(item, batchResults[index], target));
    appendJsonl(resultPath, normalized);
    syncIndexWriteResultsToCatalog(state, normalized, {
      plan,
      job,
      target,
      retry: retryPolicyFor(state, "index"),
      batch: absoluteBatch,
      totalBatches,
      batchSize
    });
    const writtenRows = normalized.filter((item) => item.status === "written");
    results.push(...writtenRows);
    const written = writtenRows.length;
    const failed = normalized.filter((item) => item.status === "failed");
    const batchCheckpoint = progressDetail({ action: "写入批次完成", batch: absoluteBatch, totalBatches, succeeded: written, failed: failed.length, completed: results.length, total: writable.length, remaining: Math.max(0, writable.length - results.length), completedItems: results.length, failedItems: failed.length, retryItems: 0, target, next: failed.length ? "先处理失败项。" : "自动进入下一批。" });
    writeArtifactCheckpoint({ plan, job, stage: "index", checkpoint: batchCheckpoint, files: { resultPath, reportPath, activeManifestPath } });
    log(
      failed.length
        ? `写入知识库批次 ${absoluteBatch}/${totalBatches} 未通过：本批 ${written}/${normalized.length} 成功，失败 ${failed.length} 条，累计成功 ${results.length}/${writable.length}。`
        : `写入知识库批次 ${absoluteBatch}/${totalBatches} 完成：本批 ${written}/${normalized.length} 成功，累计成功 ${results.length}/${writable.length}。`,
      failed.length
        ? `Knowledge-base write batch ${absoluteBatch}/${totalBatches} failed: ${written}/${normalized.length} written, ${failed.length} failed, ${results.length}/${writable.length} written total.`
        : `Knowledge-base write batch ${absoluteBatch}/${totalBatches} complete: ${written}/${normalized.length} written, ${results.length}/${writable.length} written total.`,
      batchCheckpoint,
      failed.length ? "failed" : "completed"
    );

    if (failed.length) {
      const lifecycleSummary = summarizeQualityRecords(allPending);
      const datasetVersionId = allPending.find((item) => item.datasetVersionId)?.datasetVersionId || "";
      writeJsonFile(reportPath, buildKnowledgeWriteReport({ plan, template, job, target, pending: writable, results: [...results, ...failed], batchSize, batchCalls: restoredBatchCalls + batchCalls, lifecycleSummary, datasetVersionId, sidecar }));
      throw new Error("写入知识库失败：" + (failed[0].providerMessage || failed[0].chunk_id));
    }

    if (isPauseRequested(job) && results.length < writable.length) {
      const lifecycleSummary = summarizeQualityRecords(allPending);
      const datasetVersionId = allPending.find((item) => item.datasetVersionId)?.datasetVersionId || "";
      const checkpoint = progressDetail({
        action: "写入知识库已暂停",
        step: "index",
        batch: absoluteBatch,
        totalBatches,
        completed: results.length,
        total: writable.length,
        remaining: Math.max(0, writable.length - results.length),
        completedItems: results.length,
        failedItems: results.filter((item) => item.status === "failed").length,
        retryItems: 0,
        target,
        next: "恢复任务后会从剩余记录继续，不会重复写入已完成记录。"
      });
      writeArtifactCheckpoint({ plan, job, stage: "index", checkpoint, files: { resultPath, reportPath, activeManifestPath } });
      syncIndexWriteResultsToCatalog(state, results, {
        plan,
        job,
        target,
        retry: retryPolicyFor(state, "index"),
        batch: absoluteBatch,
        totalBatches,
        batchSize
      });
      writeJsonFile(reportPath, { ...buildKnowledgeWriteReport({ plan, template, job, target, pending: writable, results, batchSize, batchCalls: restoredBatchCalls + batchCalls, lifecycleSummary, datasetVersionId, sidecar }), partial: true, checkpoint });
      log(
        `已暂停写入知识库：当前已完成 ${results.length}/${writable.length} 条记录，恢复后继续剩余 ${Math.max(0, writable.length - results.length)} 条。`,
        `Knowledge-base write paused: ${results.length}/${writable.length} record(s) completed; resume continues with ${Math.max(0, writable.length - results.length)} remaining.`,
        checkpoint,
        "paused",
        "checkpoint"
      );
      return {
        paused: true,
        checkpoint,
        artifacts: [
          ...(sidecar?.artifacts || []),
          artifact("knowledgeWriteReport", "知识库写入报告", "Knowledge write report", reportPath, "记录批量写入结果、知识库位置、失败项和回滚依据。", "Records batch write result, knowledge-base target, failures, and rollback basis."),
          artifact("indexWriteResult", "写入结果", "Index write result", resultPath, "保存每条检索记录的写入状态和远端 ID。", "Stores each search record write status and remote ID.")
        ]
      };
    }
  }

  const finalResults = uniqueRecordsByKey(results, "chunk_id");
  const lifecycleSummary = summarizeQualityRecords(allPending);
  const datasetVersionId = allPending.find((item) => item.datasetVersionId)?.datasetVersionId || "";
  const report = buildKnowledgeWriteReport({ plan, template, job, target, pending: writable, results: finalResults, batchSize, batchCalls: restoredBatchCalls + batchCalls, lifecycleSummary, datasetVersionId, sidecar });
  const activeManifest = buildActiveManifest(plan, job, target, { lifecycleSummary, datasetVersionId, knowledgeBase: knowledgeBaseInfo(state), sidecar });
  writeJsonl(resultPath, finalResults);
  syncIndexWriteResultsToCatalog(state, finalResults, {
    plan,
    job,
    target,
    retry: retryPolicyFor(state, "index"),
    batch: restoredBatchCalls + batchCalls,
    totalBatches: restoredBatchCalls + batchCalls,
    batchSize
  });
  await runBuildVersionPublishStage({
    draftManifestPath,
    activeManifestPath,
    manifest: activeManifest,
    qualityGates: { requireActiveRecords: true, allowReviewRecords: true }
  }, job, log, executeBuildVersionPublishImplementation);
  writeJsonFile(reportPath, report);

  log(`知识库写入完成：${finalResults.filter((item) => item.status === "written").length}/${finalResults.length} 条记录已激活，调用 ${restoredBatchCalls + batchCalls} 个批次。`, `Knowledge-base write complete: ${finalResults.filter((item) => item.status === "written").length}/${finalResults.length} record(s) activated across ${restoredBatchCalls + batchCalls} batch(es).`, progressDetail({ action: "知识库写入完成", succeeded: finalResults.filter((item) => item.status === "written").length, total: finalResults.length, batchCalls: restoredBatchCalls + batchCalls, target, next: "生成执行摘要。" }), "completed");
  const failed = finalResults.filter((item) => item.status === "failed");
  if (failed.length) throw new Error("写入知识库失败：" + (failed[0].providerMessage || failed[0].chunk_id));

  return {
    artifacts: [
      ...(sidecar?.artifacts || []),
      artifact("knowledgeWriteReport", "知识库写入报告", "Knowledge write report", reportPath, "记录批量写入结果、知识库位置、失败项和回滚依据。", "Records batch write result, knowledge-base target, failures, and rollback basis."),
      artifact("indexWriteResult", "写入结果", "Index write result", resultPath, "保存每条检索记录的写入状态和远端 ID。", "Stores each search record write status and remote ID."),
      artifact("draftActiveManifest", "待发布版本清单", "Draft active manifest", draftManifestPath, "记录发布前通过质量门检查的版本草稿。", "Records the version draft checked before activation."),
      artifact("activeManifest", "已激活版本清单", "Active manifest", activeManifestPath, "记录当前已生效的资料版本和写入位置。", "Records active source versions and write target.")
    ]
  };
}

async function executeBuildVersionPublishImplementation(context, job, log) {
  const result = publishBuildVersion(context);
  log?.(
    "版本清单已通过质量门并激活。",
    "Version manifest passed quality gates and was activated.",
    { draftManifestPath: result.draftManifestPath, activeManifestPath: result.activeManifestPath, datasetVersionId: job.datasetVersionId || "" },
    "completed"
  );
  return result;
}

function shouldPublishAliyunSidecar(state, target) {
  if (target.provider !== "aliyun-vector") return false;
  if (typeof state.vectorBatchWriter === "function" || typeof state.vectorWriter === "function") return false;
  return true;
}
function vectorTarget(job) {
  const draft = job.draft || {};
  return {
    provider: job.mode === "aliyun" ? "aliyun-vector" : "local",
    region: String(draft["aliyun.search.region"] || draft["aliyun.region"] || "cn-hangzhou"),
    bucket: String(draft["aliyun.search.bucket"] || ""),
    index: String(draft["aliyun.search.index"] || "")
  };
}

async function writeVectorBatchWithRecovery(state, request, log, depth = 0) {
  try {
    return await writeVectorBatch(state, request);
  } catch (error) {
    if (!shouldSplitBatchError(error) || request.items.length <= 1) throw error;
    const midpoint = Math.ceil(request.items.length / 2);
    const left = request.items.slice(0, midpoint);
    const right = request.items.slice(midpoint);
    log?.(
      `写入批次被限流或过大，已拆成 ${left.length} + ${right.length} 条记录重试。`,
      `Knowledge write batch was throttled or too large; split into ${left.length} + ${right.length} smaller write batches.`,
      progressDetail({ action: "拆分写入批次", items: request.items.length, retry: depth + 1, next: "小批次会继续按顺序写入，已完成记录会落盘后跳过。" }),
      "running",
      "checkpoint"
    );
    const batchPolicy = { ...(request.batchPolicy || {}), splitFrom: request.items.length };
    const leftResults = await writeVectorBatchWithRecovery(state, { ...request, items: left, batchPolicy }, log, depth + 1);
    const rightResults = await writeVectorBatchWithRecovery(state, { ...request, items: right, batchPolicy: { ...batchPolicy, ensureIndex: false } }, log, depth + 1);
    return [...leftResults, ...rightResults];
  }
}
async function writeVectorBatch(state, request) {
  const retry = retryPolicyFor(state, "index");
  if (typeof state.vectorBatchWriter === "function") {
    const result = await retryExternalCall(() => state.vectorBatchWriter(request), retry);
    return Array.isArray(result) ? result : result?.results || [];
  }

  const aliyunResult = await aliyunVectorBatchWrite(state, request, retry);
  if (aliyunResult) return aliyunResult;

  if (typeof state.vectorWriter === "function") {
    const concurrency = request.batchPolicy?.concurrency ?? indexConcurrencyFor(state);
    return mapWithConcurrency(request.items, concurrency, (item) => retryExternalCall(
      () => state.vectorWriter({ ...request, item }),
      retry
    ));
  }
  throw new Error("写入知识库当前缺少可用的向量 Bucket 写入连接。请先检查阿里云凭证、向量 Bucket 和索引配置。");
}

async function aliyunVectorBatchWrite(state, request, retry) {
  const adapter = createAliyunOssVectorAdapter(state, { retry, metadataForItem: vectorMetadataForItem });
  return adapter.writeBatch(request);
}

function vectorMetadataForItem(item) {
  const contract = item.sidecarContract || compactVectorContract(item);
  const metadata = {
    kb: contract.kb,
    ver: contract.ver,
    doc: contract.doc,
    cid: contract.cid,
    fgs: contract.fgs,
    pub: contract.pub,
    vol: contract.vol,
    unit: contract.unit,
    lesson: contract.lesson,
    ctype: contract.ctype,
    q: contract.q,
    sidecar: item.sidecarUri || contract.sidecar || ""
  };
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== "" && value !== null && value !== undefined));
}

function normalizeIndexWriteResult(item, result = {}, target) {
  const status = result.status || (result.remoteId ? "written" : "failed");
  return {
    chunk_id: item.chunk_id,
    document_id: item.document_id,
    version_id: item.version_id,
    datasetVersionId: item.datasetVersionId || "",
    quality: item.quality || null,
    active: item.active === true,
    status,
    target,
    remoteId: result.remoteId || "",
    sidecarUri: item.sidecarUri || "",
    providerMessage: result.providerMessage || result.message || ""
  };
}

function buildActiveManifest(plan, job, target, options = {}) {
  return {
    ...plan.proposedActiveManifest,
    generatedAt: new Date().toISOString(),
    status: "active",
    activatedAt: new Date().toISOString(),
    datasetVersionId: options.datasetVersionId || "",
    knowledgeBase: options.knowledgeBase || null,
    job: { id: job.id, mode: job.mode, template: job.template },
    target,
    sidecar: options.sidecar ? sidecarManifestSummary(options.sidecar) : null,
    quality: options.lifecycleSummary || summarizeQualityRecords([]),
    activeVersions: plan.proposedActiveManifest.activeVersions.map((item) => ({
      ...item,
      lifecycle: "active"
    })),
    rollback: {
      previousManifest: null,
      reason: "first-activation"
    }
  };
}

function buildKnowledgeWriteReport({ plan, template, job, target, pending, results, batchSize, batchCalls, lifecycleSummary = null, datasetVersionId = "", sidecar = null }) {
  const failed = results.filter((item) => item.status === "failed");
  return {
    kind: "knowmesh.knowledgeWriteReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    engine: {
      name: template?.coreName || "KnowMesh Core",
      stage: "index"
    },
    template: {
      id: template?.id || job.template,
      role: template?.templateRole || "",
      extendsTemplate: template?.extendsTemplate || null,
      expertName: template?.expertName || null
    },
    project: plan.project,
    job: { id: job.id, mode: job.mode, template: job.template },
    target,
    datasetVersionId,
    sidecar: sidecar ? sidecarManifestSummary(sidecar) : null,
    quality: lifecycleSummary,
    batchPolicy: {
      mode: "batch-first",
      batchSize,
      fallback: "single-item-adapter-only-when-batch-adapter-is-missing"
    },
    summary: {
      totalItems: pending.length,
      writtenItems: results.filter((item) => item.status === "written").length,
      failedItems: failed.length,
      activeVersions: plan.proposedActiveManifest.activeVersions.length,
      reviewRecords: lifecycleSummary?.reviewRecords || 0,
      archiveRecords: lifecycleSummary?.archiveRecords || 0,
      batchCalls
    },
    failures: failed.map((item) => ({ chunk_id: item.chunk_id, message: item.providerMessage }))
  };
}

function knowledgeBaseInfo(state) {
  return { id: currentKnowledgeBaseId(state) };
}

function summarizeQualityRecords(records) {
  return {
    totalRecords: records.length,
    activeRecords: records.filter((item) => item.quality?.writeEnabled !== false).length,
    primaryRecords: records.filter((item) => item.quality?.tier === "primary").length,
    weightedRecords: records.filter((item) => item.quality?.tier === "weighted").length,
    reviewRecords: records.filter((item) => item.quality?.writeEnabled === false).length,
    archiveRecords: records.filter((item) => item.quality?.tier === "archive").length
  };
}

async function publishAliyunSidecar({ plan, template, state, job, target, records }, log) {
  const storage = sidecarTarget(job);
  if (!storage.bucket) throw new Error("阿里云模式需要先配置资料 OSS Bucket，才能保存 Metadata Sidecar。");
  const datasetVersionId = String(job.datasetVersionId || records.find((item) => item.datasetVersionId)?.datasetVersionId || "").trim();
  if (!datasetVersionId) throw new Error("缺少知识库版本 ID，不能发布 Metadata Sidecar。");
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const baseObjectKey = `knowmesh/kb/${knowledgeBaseId}/versions/${datasetVersionId}/sidecar`;
  const sidecarRoot = path.join(plan.workspace.artifactRoot, "sidecar");
  const chunksDir = path.join(sidecarRoot, "chunks");
  const citationsDir = path.join(sidecarRoot, "citations");
  const templatesDir = path.join(sidecarRoot, "templates");
  const qualityDir = path.join(sidecarRoot, "quality");
  ensureDir(chunksDir);
  ensureDir(citationsDir);
  ensureDir(templatesDir);
  ensureDir(qualityDir);

  const chunkObjectKey = `${baseObjectKey}/chunks/part-0001.jsonl`;
  const chunkUriBase = `oss://${storage.bucket}/${chunkObjectKey}`;
  const chunks = records.map((record) => sidecarChunkRecord(record, {
    knowledgeBaseId,
    datasetVersionId,
    template,
    chunkUriBase
  }));
  const citations = chunks.map((record) => citationSidecarRecord(record));
  const reviewRequired = chunks.filter((record) => record.quality?.writeEnabled === false || record.quality?.tier === "review");
  const templateContract = templateSidecarContract(template);
  const manifest = {
    kind: "knowmesh.aliyunSidecarManifest",
    apiVersion: "0.2.0",
    generatedAt: new Date().toISOString(),
    knowledgeBaseId,
    datasetVersionId,
    mode: "aliyun",
    authoritativeStore: "oss-sidecar",
    storage: {
      bucket: storage.bucket,
      region: storage.region,
      prefix: baseObjectKey
    },
    vectorTarget: target,
    template: {
      id: template?.id || job.template,
      version: template?.version || "",
      expertName: template?.expertName || null
    },
    files: {
      chunks: [{ objectKey: chunkObjectKey, count: chunks.length }],
      citations: `${baseObjectKey}/citations/citation-map.jsonl`,
      quality: `${baseObjectKey}/quality/review-required.jsonl`,
      templateContract: `${baseObjectKey}/templates/template-contract.json`
    },
    summary: {
      chunks: chunks.length,
      citations: citations.length,
      reviewRequired: reviewRequired.length
    }
  };

  const localFiles = [
    {
      key: "manifest",
      localPath: path.join(sidecarRoot, "manifest.json"),
      objectKey: `${baseObjectKey}/manifest.json`,
      contentType: "application/json",
      write: () => writeJsonFile(path.join(sidecarRoot, "manifest.json"), manifest)
    },
    {
      key: "chunks",
      localPath: path.join(chunksDir, "part-0001.jsonl"),
      objectKey: chunkObjectKey,
      contentType: "application/jsonl",
      write: () => writeJsonl(path.join(chunksDir, "part-0001.jsonl"), chunks)
    },
    {
      key: "citations",
      localPath: path.join(citationsDir, "citation-map.jsonl"),
      objectKey: `${baseObjectKey}/citations/citation-map.jsonl`,
      contentType: "application/jsonl",
      write: () => writeJsonl(path.join(citationsDir, "citation-map.jsonl"), citations)
    },
    {
      key: "quality",
      localPath: path.join(qualityDir, "review-required.jsonl"),
      objectKey: `${baseObjectKey}/quality/review-required.jsonl`,
      contentType: "application/jsonl",
      write: () => writeJsonl(path.join(qualityDir, "review-required.jsonl"), reviewRequired)
    },
    {
      key: "templateContract",
      localPath: path.join(templatesDir, "template-contract.json"),
      objectKey: `${baseObjectKey}/templates/template-contract.json`,
      contentType: "application/json",
      write: () => writeJsonFile(path.join(templatesDir, "template-contract.json"), templateContract)
    }
  ];
  for (const file of localFiles) file.write();

  const uploader = await sidecarUploaderFor(state);
  const uploaded = [];
  for (const file of localFiles) {
    const result = await retryExternalCall(async () => retryableCloudResult(await uploader({
      bucket: storage.bucket,
      region: storage.region,
      filePath: file.localPath,
      objectKey: file.objectKey,
      contentType: file.contentType
    })), retryPolicyFor(state, "archive"));
    if (!result?.ok) throw new Error(`Metadata Sidecar 上传失败：${result?.error?.message || file.objectKey}`);
    uploaded.push({
      key: file.key,
      objectKey: file.objectKey,
      uri: `oss://${storage.bucket}/${file.objectKey}`,
      etag: result.etag || ""
    });
  }

  log?.(
    `已发布 Metadata Sidecar：${chunks.length} 个片段的完整引用信息已保存到 OSS。`,
    `Metadata sidecar published: full citation metadata for ${chunks.length} chunk(s) is stored in OSS.`,
    progressDetail({ action: "发布 Metadata Sidecar", completed: chunks.length, total: chunks.length, sidecar: `oss://${storage.bucket}/${baseObjectKey}/manifest.json`, next: "继续写入向量索引。" }),
    "completed",
    "checkpoint"
  );

  return {
    authoritativeStore: "oss-sidecar",
    bucket: storage.bucket,
    region: storage.region,
    prefix: baseObjectKey,
    manifestUri: `oss://${storage.bucket}/${baseObjectKey}/manifest.json`,
    localRoot: sidecarRoot,
    uploaded,
    artifacts: localFiles.map(sidecarArtifact),
    chunks
  };
}

function sidecarArtifact(file) {
  const labels = {
    manifest: ["Metadata Sidecar 清单", "Metadata sidecar manifest", "记录 Sidecar 发布位置、文件清单和统计。", "Records sidecar publish location, file list, and summary."],
    chunks: ["Sidecar 片段", "Sidecar chunks", "保存可追溯的完整片段文本和元数据。", "Stores traceable full chunk text and metadata."],
    citations: ["Sidecar 引用", "Sidecar citations", "保存片段到来源页码和摘录的引用映射。", "Stores citation mappings from chunks to sources."],
    quality: ["Sidecar 质量队列", "Sidecar quality queue", "保存需要复核的 Sidecar 质量记录。", "Stores sidecar quality records that need review."],
    templateContract: ["Sidecar 模板契约", "Sidecar template contract", "保存本次发布使用的模板契约。", "Stores the template contract used by this publish."]
  };
  const key = `sidecar${file.key.slice(0, 1).toUpperCase()}${file.key.slice(1)}`;
  const [zhLabel, enLabel, zhMessage, enMessage] = labels[file.key] || labels.manifest;
  return artifact(key, zhLabel, enLabel, file.localPath, zhMessage, enMessage);
}

function sidecarTarget(job) {
  const draft = job.draft || {};
  return {
    region: String(draft["aliyun.storage.region"] || draft["aliyun.region"] || "cn-hangzhou"),
    bucket: String(draft["aliyun.storage.bucket"] || "")
  };
}

async function sidecarUploaderFor(state) {
  if (typeof state.sidecarUploader === "function") return state.sidecarUploader;
  const credentials = await readAliyunCredentials(state);
  if (!credentials?.accessKeyId || !credentials?.accessKeySecret) throw new Error("没有找到本机阿里云凭证，不能上传 Metadata Sidecar。");
  return (item) => putObject(credentials, {
    bucket: item.bucket,
    region: item.region,
    filePath: item.filePath,
    objectKey: item.objectKey,
    contentType: item.contentType,
    fetchImpl: state.fetchImpl,
    timeoutMs: state.archiveTimeoutMs || state.cloudTimeoutMs || 60000
  });
}

function sidecarChunkRecord(record, context) {
  const contract = compactVectorContract(record, context);
  const education = extractK12EducationMetadata(record);
  return {
    kind: "knowmesh.sidecarChunk",
    apiVersion: "0.2.0",
    knowledgeBaseId: context.knowledgeBaseId,
    datasetVersionId: context.datasetVersionId,
    chunk_id: record.chunk_id,
    document_id: record.document_id,
    version_id: record.version_id,
    sidecarUri: `${context.chunkUriBase}#${encodeURIComponent(record.chunk_id)}`,
    vectorMetadata: contract,
    text: record.text || "",
    sourceUri: record.sourceUri || "",
    sourceParts: record.sourceParts || [],
    page_start: record.page_start ?? null,
    page_end: record.page_end ?? null,
    metadata: {
      ...(record.metadata || {}),
      education
    },
    quality: record.quality || null,
    citation: {
      sourceUri: record.sourceUri || "",
      page_start: record.page_start ?? null,
      page_end: record.page_end ?? null,
      excerpt: excerptForSidecar(record.text)
    },
    embedding: {
      model: record.embedding_model || "",
      status: record.status || ""
    }
  };
}

function compactVectorContract(record, context = {}) {
  const education = extractK12EducationMetadata(record);
  const filters = compactK12FilterFields({
    ...record,
    metadata: {
      ...(record.metadata || {}),
      education
    }
  });
  const datasetVersionId = String(context.datasetVersionId || record.datasetVersionId || "").trim();
  return {
    kb: context.knowledgeBaseId || "",
    ver: datasetVersionId,
    doc: record.document_id || "",
    cid: record.chunk_id || "",
    fgs: filters.fgs,
    pub: filters.pub,
    vol: filters.vol,
    unit: filters.unit,
    lesson: filters.lesson,
    ctype: contentTypeForRecord(record, education),
    q: record.quality?.tier || (record.quality?.writeEnabled === false ? "review" : "pass"),
    sidecar: record.sidecarUri || ""
  };
}

function citationSidecarRecord(record) {
  return {
    chunk_id: record.chunk_id,
    document_id: record.document_id,
    version_id: record.version_id,
    sidecarUri: record.sidecarUri,
    sourceUri: record.sourceUri,
    page_start: record.page_start,
    page_end: record.page_end,
    excerpt: record.citation?.excerpt || "",
    metadata: record.metadata || {}
  };
}

function templateSidecarContract(template = {}) {
  return {
    kind: "knowmesh.templateContract",
    apiVersion: "0.2.0",
    id: template.id || "",
    version: template.version || "",
    role: template.templateRole || "",
    extendsTemplate: template.extendsTemplate || null,
    coreName: template.coreName || "KnowMesh Core",
    expertName: template.expertName || null,
    metadataFields: template.metadataFields || [],
    archivePolicy: template.archivePolicy || null,
    processingInputPolicy: template.processingInputPolicy || null,
    citationPolicy: template.citationPolicy || null,
    vectorFilterPolicy: template.vectorFilterPolicy || null,
    chunkingPolicy: template.chunkingPolicy || null,
    qualityGates: template.qualityGates || [],
    acceptanceCriteria: template.acceptanceCriteria || [],
    evaluationQuestions: template.evaluationQuestions || []
  };
}

function sidecarManifestSummary(sidecar) {
  return {
    authoritativeStore: sidecar.authoritativeStore,
    bucket: sidecar.bucket,
    region: sidecar.region,
    prefix: sidecar.prefix,
    manifestUri: sidecar.manifestUri,
    chunks: sidecar.chunks?.length || 0,
    uploaded: (sidecar.uploaded || []).map((item) => ({ key: item.key, uri: item.uri }))
  };
}

function contentTypeForRecord(record = {}, education = {}) {
  const metadata = record.metadata || {};
  if (metadata.ctype) return metadata.ctype;
  return k12ContentTypeForRecord(record, education);
}

export function syncK12ExpertStructureFromCatalog(state, context = {}) {
  if (!isK12ExecutionContext(context)) return null;
  const toc = syncK12TocEntriesToCatalog(state);
  const ranges = syncK12UnitLessonRangesToCatalog(state);
  const objects = extractK12ObjectsFromCatalog(state);
  const chinese = extractK12ChineseObjectsFromCatalog(state);
  const math = extractK12MathObjectsFromCatalog(state);
  const evaluationSeed = seedK12EvaluationCases(state);
  const evaluation = runK12CatalogEvaluation(state);
  return { toc, ranges, objects, chinese, math, evaluationSeed, evaluation };
}

function isK12ExecutionContext(context = {}) {
  return context.job?.template === k12TemplateId
    || context.plan?.project?.id === k12TemplateId
    || context.plan?.project?.template === k12TemplateId;
}

function excerptForSidecar(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  return compact.length <= 360 ? compact : `${compact.slice(0, 340)}...`;
}
function sourceArchiveFiles(plan, job) {
  const target = archiveTarget(job);
  const seen = new Set();
  const files = [];
  for (const document of plan.documents) {
    const parts = Array.isArray(document.sourceParts) && document.sourceParts.length ? document.sourceParts : [{ path: document.sourcePath, relativePath: document.relativePath, uri: document.sourceUri, size: 0, sha256: document.source_fingerprint }];
    for (const part of parts) {
      const sourcePath = part.path || document.sourcePath;
      if (!sourcePath || seen.has(sourcePath)) continue;
      seen.add(sourcePath);
      const stat = fs.existsSync(sourcePath) ? fs.statSync(sourcePath) : null;
      const relativePath = toPosix(part.relativePath || document.relativePath || path.basename(sourcePath));
      files.push({
        document_id: document.document_id,
        version_id: document.version_id,
        title: document.title,
        sourceType: document.sourceType,
        sourcePath,
        sourceUri: part.uri || document.sourceUri,
        relativePath,
        partNumber: part.partNumber || null,
        size: Number(part.size || stat?.size || 0),
        sha256: part.sha256 || document.source_fingerprint || "",
        bucket: target.bucket,
        region: target.region,
        objectKey: archiveObjectKey(plan.project.id, job.id, relativePath)
      });
    }
  }
  return files;
}

function archiveTarget(job) {
  const draft = job.draft || {};
  return {
    provider: job.mode === "aliyun" ? "aliyun-oss" : "local",
    region: String(draft["aliyun.region"] || draft["aliyun.storage.region"] || "cn-hangzhou"),
    bucket: String(draft["aliyun.storage.bucket"] || "")
  };
}

function archiveObjectKey(projectId, jobId, relativePath) {
  return ["knowmesh", safeObjectPart(projectId), safeObjectPart(jobId), "raw", toPosix(relativePath)].filter(Boolean).join("/");
}

function archiveResumeKey(file = {}) {
  return [toPosix(file.relativePath || ""), Number(file.size || 0), file.sha256 || ""].join("|");
}

function buildProcessingInputManifest(plan, template, archiveFiles, job) {
  const inputs = plan.documents.map((document) => processingInputForDocument(document, template, archiveFiles));
  return {
    kind: "knowmesh.processingInputManifest",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    job: { id: job.id, mode: job.mode, template: job.template },
    template: {
      id: template?.id || job.template,
      role: template?.templateRole || "",
      extendsTemplate: template?.extendsTemplate || null
    },
    summary: {
      documents: inputs.length,
      directText: inputs.filter((item) => item.processingInput === "local-text").length,
      structuredOffice: inputs.filter((item) => item.processingInput === "local-structured-text").length,
      compatibleConversion: inputs.filter((item) => item.processingInput === "converted-local-text").length,
      pageTasks: inputs.filter((item) => item.processingInput === "page-tasks").length,
      imageOcr: inputs.filter((item) => item.processingInput === "image-ocr").length
    },
    inputs
    };
}

function processingInputForDocument(document, template, archiveFiles) {
  const policy = template?.processingInputPolicy || {};
  const category = sourcePreparationCategory(document);
  const archived = archiveFiles.filter((item) => item.version_id === document.version_id).map((item) => ({ objectKey: item.objectKey, relativePath: item.relativePath, status: item.status, size: item.size }));
  const base = {
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    sourceType: document.sourceType,
    relativePath: document.relativePath,
    sourceArchive: archived
  };
  if (category === "directText") return { ...base, processingInput: "local-text", vectorizeFrom: policy.textLike?.vectorizeFrom || "cleaned-chunks" };
  if (category === "office") return { ...base, processingInput: "local-structured-text", macroPolicy: policy.office?.macroPolicy || "never-execute", vectorizeFrom: policy.office?.vectorizeFrom || "cleaned-chunks" };
  if (category === "autoConvert") return { ...base, processingInput: "converted-local-text", fallback: policy.legacyOffice?.fallback || "review-required", vectorizeFrom: policy.legacyOffice?.vectorizeFrom || "cleaned-chunks" };
  if (document.sourceType === "image") return { ...base, processingInput: "image-ocr", ocrInput: policy.image?.ocrInput || "original-image", vectorizeFrom: policy.image?.vectorizeFrom || "ocr-cleaned-chunks" };
  if (String(document.sourceType || "").includes("pdf")) return { ...base, processingInput: "page-tasks", splitByPage: true, ocrInput: policy.scannedPdf?.ocrInput || "page-image-tasks", vectorizeFrom: policy.mixedPdf?.vectorizeFrom || "merged-cleaned-chunks" };
  return { ...base, processingInput: "review-required", vectorizeFrom: "none" };
}

async function archiveUploaderFor(state) {
  if (typeof state.sourceArchiveUploader === "function") return state.sourceArchiveUploader;
  const credentials = await readAliyunCredentials(state);
  if (!credentials?.accessKeyId || !credentials?.accessKeySecret) throw new Error("没有找到本机阿里云凭证，不能归档来源文件。");
  return (item) => putObject(credentials, {
    bucket: item.bucket,
    region: item.region,
    objectKey: item.objectKey,
    filePath: item.sourcePath,
    fetchImpl: state.fetchImpl,
    timeoutMs: state.cloudTimeoutMs || 30000
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runWorker));
  return results;
}

function ocrConcurrencyFor(state = {}) {
  return clampInteger(state?.ocrConcurrency ?? process.env.KNOWMESH_OCR_CONCURRENCY ?? 8, 1, 12);
}

function embeddingConcurrencyFor(state = {}) {
  return clampInteger(state?.embeddingConcurrency ?? process.env.KNOWMESH_EMBEDDING_CONCURRENCY ?? 8, 1, 16);
}

function indexConcurrencyFor(state = {}) {
  return clampInteger(state?.indexConcurrency ?? process.env.KNOWMESH_INDEX_CONCURRENCY ?? 8, 1, 16);
}
function retryPolicyFor(state, stage) {
  const prefix = stage === "embedding" ? "embedding" : stage === "archive" ? "archive" : stage === "index" ? "index" : stage === "ocr" ? "ocr" : "cloud";
  const maxAttempts = clampInteger(state?.[`${prefix}RetryAttempts`] ?? state?.cloudRetryAttempts ?? 3, 1, 8);
  const baseDelayMs = clampInteger(state?.[`${prefix}RetryDelayMs`] ?? state?.cloudRetryDelayMs ?? 300, 0, 30000);
  const maxDelayMs = clampInteger(state?.[`${prefix}RetryMaxDelayMs`] ?? state?.cloudRetryMaxDelayMs ?? 5000, baseDelayMs, 60000);
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

async function retryExternalCall(operation, policy) {
  const retry = policy || retryPolicyFor(null, "cloud");
  let lastError = null;
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retry.maxAttempts || !isRetryableError(error)) throw error;
      await sleep(retryDelayMs(retry, attempt));
    }
  }
  throw lastError || new Error("外部调用失败。");
}

function retryDelayMs(policy, attempt) {
  if (!policy.baseDelayMs) return 0;
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
}

function isRetryableError(error) {
  if (!error) return false;
  if (error.retryable === true) return true;
  if (error.name === "AbortError") return true;
  if (error instanceof TypeError) return true;
  return false;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  return fetchImpl(url, { ...options, ...(controller ? { signal: controller.signal } : {}) })
    .finally(() => {
      if (timeout) clearTimeout(timeout);
    });
}

async function safeResponseText(response) {
  if (typeof response?.text === "function") return response.text();
  if (typeof response?.json === "function") return JSON.stringify(await response.json());
  return "";
}

function modelProviderHttpError(status, text) {
  const data = parseJsonObject(text);
  const message = data?.error?.message || data?.message || data?.Message || text || "模型服务请求失败。";
  const error = new Error(`模型服务返回 ${status}: ${message}`);
  error.status = status;
  error.retryable = isRetryableStatus(status);
  error.providerBody = text;
  error.providerMessage = message;
  return error;
}

function retryableCloudResult(result) {
  if (!result || result.ok !== false || !isRetryableStatus(result.status)) return result;
  const message = result.error?.message || result.message || `外部服务返回 ${result.status}`;
  const error = new Error(message);
  error.status = result.status;
  error.retryable = true;
  throw error;
}

function isRetryableStatus(status) {
  const code = Number(status);
  return code === 408 || code === 429 || (code >= 500 && code <= 599);
}

function shouldSplitBatchError(error) {
  if (!error) return false;
  const status = Number(error.status || error.statusCode || 0);
  return error.retryable === true
    || status === 413
    || isBatchSizeInvalidError(error)
    || isRetryableStatus(status)
    || error.name === "AbortError"
    || error instanceof TypeError;
}

function isBatchSizeInvalidError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status !== 400) return false;
  const text = String(error.providerMessage || error.providerBody || error.message || "");
  return /batch\s*size/i.test(text) && /(invalid|larger than|too large|input\.contents)/i.test(text);
}

function parseJsonObject(text) {
  try {
    const data = JSON.parse(text || "{}");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function joinUrl(baseUrl, segment) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(segment || "").replace(/^\/+/, "")}`;
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(Math.trunc(number), max));
}

function sanitizeUploadResult(result = {}) {
  if (!result || typeof result !== "object") return { ok: false, message: String(result || "unknown upload result") };
  return {
    ok: result.ok !== false,
    status: result.status || 0,
    objectKey: result.objectKey || "",
    etag: result.etag || "",
    message: result.error?.message || result.message || ""
  };
}

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeObjectPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || shortHash(String(value || "knowmesh"));
}

function shortHash(value) {
  return crypto.createHash("sha1").update(value, "utf8").digest("hex").slice(0, 12);
}
function expectedArtifactsForTask({ plan }, job, task) {
  if (task.key === "merge") return planningArtifacts(plan);
  if (task.key === "pages") {
    return [
      artifactPath("pagePreparationReport", "资料处理准备报告", "Source preparation report", path.join(plan.workspace.artifactRoot, "reports", "page-preparation.report.json")),
      artifactPath("textRecognitionPlan", "文字识别计划报告", "Text recognition plan", path.join(plan.workspace.artifactRoot, "reports", "text-recognition-plan.report.json")),
      artifactPath("textRecognitionWorkOrder", "文字识别待确认工作单", "Text recognition work order", path.join(plan.workspace.artifactRoot, "ocr", "text-recognition.work-order.jsonl"))
    ];
  }
  if (task.key === "clean") {
    return [
      artifactPath("normalizedText", "清洗正文", "Clean text", path.join(plan.workspace.artifactRoot, "normalized", "local-text.normalized.json")),
      artifactPath("localChunks", "本地分段", "Local chunks", path.join(plan.workspace.artifactRoot, "chunks", "local-chunks.jsonl")),
      artifactPath("conversionReport", "兼容转换报告", "Compatibility conversion report", path.join(plan.workspace.artifactRoot, "reports", "compatibility-conversion.report.json")),
      artifactPath("filterReport", "过滤报告", "Filter report", path.join(plan.workspace.artifactRoot, "reports", "filter-report.json"))
    ];
  }
  if (task.key === "retrieval-policy") {
    return [
      artifactPath("retrievalPolicyReport", "问答策略报告", "Answer strategy report", path.join(plan.workspace.artifactRoot, "reports", "retrieval-policy.report.json"))
    ];
  }
  if (task.key === "upload") {
    return [
      artifactPath("sourceArchiveManifest", "来源归档清单", "Source archive manifest", path.join(plan.workspace.artifactRoot, "archive", "source-archive.manifest.json")),
      artifactPath("processingInputManifest", "处理输入清单", "Processing input manifest", path.join(plan.workspace.artifactRoot, "processing", "processing-input.manifest.json"))
    ];
  }
  if (task.key === "ocr") {
    return [
      artifactPath("ocrRecognitionReport", "OCR 识别报告", "OCR recognition report", path.join(plan.workspace.artifactRoot, "reports", "ocr-recognition.report.json")),
      artifactPath("ocrResult", "OCR 识别结果", "OCR result", path.join(plan.workspace.artifactRoot, "ocr", "ocr-result.jsonl"))
    ];
  }
  if (task.key === "embedding") {
    return [
      artifactPath("searchDataReport", "检索数据报告", "Search data report", path.join(plan.workspace.artifactRoot, "reports", "search-data.report.json")),
      artifactPath("pendingIndexRecords", "待写入索引记录", "Pending index records", path.join(plan.workspace.artifactRoot, "index_records", "index-records.pending.jsonl"))
    ];
  }
  if (task.key === "index") {
    return [
      artifactPath("knowledgeWriteReport", "知识库写入报告", "Knowledge write report", path.join(plan.workspace.artifactRoot, "reports", "knowledge-write.report.json")),
      artifactPath("indexWriteResult", "写入结果", "Index write result", path.join(plan.workspace.artifactRoot, "index_records", "index-write.result.jsonl")),
      artifactPath("activeManifest", "已激活版本清单", "Active manifest", path.join(plan.workspace.manifests, "active-manifest.json"))
    ];
  }
  if (task.key === "report") {
    return [
      artifactPath("localRunReport", "知识库任务报告", "Run report", path.join(plan.workspace.artifactRoot, "reports", "local-run.report.json"))
    ];
  }
  return [];
}

function writePlanningArtifacts({ plan, scan }, log) {
  log(`正在整理 ${plan.documents.length} 份资料的执行计划。`, `Preparing the run plan for ${plan.documents.length} document(s).`, { documents: plan.documents.length });
  const outputs = writePipelinePlan(plan);
  const documentInventoryPath = path.join(plan.workspace.manifests, "document-inventory.json");
  const scopeFilter = scan?.manifest?.scopeFilter || null;
  const excludedDocuments = Array.isArray(scopeFilter?.excluded) ? scopeFilter.excluded : [];
  writeJsonFile(documentInventoryPath, buildDocumentInventory(plan, {}, { scope: scopeFilter, excludedDocuments }));
  log(`执行计划已写入 ${outputs.length + 1} 个本地产物。`, `Run plan wrote ${outputs.length + 1} local artifact(s).`, { artifacts: outputs.length + 1 }, "completed");
  return {
    artifacts: [
      artifact("sourceScan", "资料扫描清单", "Source scan", outputs[0], "记录本次纳入的资料、分卷和来源路径。", "Records included sources, split parts, and source paths."),
      artifact("documentManifest", "资料计划清单", "Document plan", outputs[1], "记录每份资料的版本、来源和后续本地产物路径。", "Records each source version, source path, and local artifact path."),
      artifact("proposedActiveManifest", "待确认版本清单", "Proposed version", outputs[2], "只是待确认版本, 不会激活知识库。", "Only a proposed version; it does not activate a knowledge base."),
      artifact("pipelineReport", "执行计划报告", "Run plan report", outputs[3], "记录本地动作和仍被门禁拦住的云端动作。", "Records the planned actions and produced local artifacts."),
      artifact("documentInventory", "资料范围清单", "Document inventory", documentInventoryPath, "记录当前知识库纳入和排除的资料。", "Records source documents included in and excluded from this knowledge base.")
    ]
  };
}

function planningArtifacts(plan) {
  return [
    artifactPath("sourceScan", "资料扫描清单", "Source scan", path.join(plan.workspace.manifests, "source-scan.manifest.json")),
    artifactPath("documentManifest", "资料计划清单", "Document plan", path.join(plan.workspace.manifests, "document-manifest.planned.json")),
    artifactPath("proposedActiveManifest", "待确认版本清单", "Proposed version", path.join(plan.workspace.manifests, "active-manifest.proposed.json")),
    artifactPath("pipelineReport", "执行计划报告", "Run plan report", path.join(plan.workspace.artifactRoot, "reports", "pipeline-plan.report.json")),
    artifactPath("documentInventory", "资料范围清单", "Document inventory", path.join(plan.workspace.manifests, "document-inventory.json"))
  ];
}

function writePagePreparation({ plan }, log) {
  const reportPath = path.join(plan.workspace.artifactRoot, "reports", "page-preparation.report.json");
  const recognitionPlanPath = path.join(plan.workspace.artifactRoot, "reports", "text-recognition-plan.report.json");
  const recognitionWorkOrderPath = path.join(plan.workspace.artifactRoot, "ocr", "text-recognition.work-order.jsonl");
  const queues = buildSourcePreparationQueues(plan.documents);
  log(`资料准备队列已生成：${queues.directTextQueue.length} 份可直接读取，${queues.officeQueue.length} 份 Office，${queues.autoConvertQueue.length} 份需兼容转换，${queues.ocrQueue.length} 份需 OCR。`, `Source queues are ready: ${queues.directTextQueue.length} direct text, ${queues.officeQueue.length} Office, ${queues.autoConvertQueue.length} conversion, ${queues.ocrQueue.length} OCR.`, { directText: queues.directTextQueue.length, office: queues.officeQueue.length, autoConvert: queues.autoConvertQueue.length, ocr: queues.ocrQueue.length }, "completed");
  const recognition = buildTextRecognitionPlan(plan.project, plan.documents);
  writeJsonFile(reportPath, {
    kind: "knowmesh.sourcePreparationReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    summary: {
      totalDocuments: plan.documents.length,
      directTextDocuments: queues.directTextQueue.length,
      officeDocuments: queues.officeQueue.length,
      autoConvertDocuments: queues.autoConvertQueue.length,
      ocrDocuments: queues.ocrQueue.length
    },
    directTextQueue: queues.directTextQueue,
    officeQueue: queues.officeQueue,
    autoConvertQueue: queues.autoConvertQueue,
    ocrQueue: queues.ocrQueue
  });
  writeJsonFile(recognitionPlanPath, recognition.report);
  writeJsonl(recognitionWorkOrderPath, recognition.workOrders);
  return {
    artifacts: [
      artifact("pagePreparationReport", "资料处理准备报告", "Source preparation report", reportPath, "列出本地可抽取、可结构化读取、需转换和需识别的资料。", "Lists sources that can be extracted locally, read structurally, converted, or recognized."),
      artifact("textRecognitionPlan", "文字识别计划报告", "Text recognition plan", recognitionPlanPath, "列出 PDF 和图片的识别范围，当前不会调用模型。", "Lists PDF and image recognition scope; no model call is made now."),
      artifact("textRecognitionWorkOrder", "文字识别待确认工作单", "Text recognition work order", recognitionWorkOrderPath, "保存后续确认识别时使用的本机工作单。", "Stores the local work order for later confirmed recognition.")
    ]
  };
}

function buildSourcePreparationQueues(documents) {
  const directTextQueue = [];
  const officeQueue = [];
  const autoConvertQueue = [];
  const ocrQueue = [];

  for (const document of documents) {
    const entry = sourcePreparationEntry(document);
    const category = sourcePreparationCategory(document);
    if (category === "directText") directTextQueue.push({ ...entry, status: "ready_for_local_text_extraction" });
    if (category === "office") officeQueue.push({ ...entry, status: "ready_for_structured_extraction" });
    if (category === "autoConvert") {
      autoConvertQueue.push({
        ...entry,
        status: "waiting_for_compatible_conversion",
        compatibilityConversion: compatibilityConversionFor(document.sourceType)
      });
    }
    if (category === "ocr") ocrQueue.push({ ...entry, status: "waiting_for_text_recognition", pageArtifact: document.artifacts.ocr });
  }

  return {
    directTextQueue,
    officeQueue,
    autoConvertQueue,
    ocrQueue
  };
}

function sourcePreparationEntry(document) {
  return {
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    relativePath: document.relativePath,
    sourceType: document.sourceType,
    sourceUri: document.sourceUri,
    sourceParts: document.sourceParts,
    macroDisabled: isMacroEnabledSourceType(document.sourceType) || undefined
  };
}

function writeRetrievalPolicy({ plan }, log) {
  const reportPath = path.join(plan.workspace.artifactRoot, "reports", "retrieval-policy.report.json");
  const methods = plan.retrieval?.methods || [];
  log(`正在确认问答策略：${methods.length ? methods.join("、") : "使用默认策略"}。`, `Confirming answer strategy: ${methods.length ? methods.join(", ") : "default strategy"}.`, { methods });
  writeJsonFile(reportPath, {
    kind: "knowmesh.retrievalPolicyReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    retrieval: plan.retrieval || null,
    usage: {
      queryRewrite: Boolean(plan.retrieval?.methods?.includes("queryRewrite")),
      multiQuery: Boolean(plan.retrieval?.methods?.includes("multiQuery")),
      hybridSearch: Boolean(plan.retrieval?.methods?.includes("hybridSearch")),
      rerank: Boolean(plan.retrieval?.methods?.includes("rerank")),
      citationCheck: Boolean(plan.retrieval?.methods?.includes("citationCheck"))
    }
  });
  return {
    artifacts: [
      artifact("retrievalPolicyReport", "问答策略报告", "Answer strategy report", reportPath, "记录本次知识库将使用的问题改写、混合检索、重排和引用校验策略。", "Records the query rewrite, hybrid search, rerank, and citation-check strategy for this knowledge base.")
    ]
  };
}

async function writeCleanChunks({ plan, state, job }, log) {
  const normalizedPath = path.join(plan.workspace.artifactRoot, "normalized", "local-text.normalized.json");
  const chunksPath = path.join(plan.workspace.artifactRoot, "chunks", "local-chunks.jsonl");
  const conversionReportPath = path.join(plan.workspace.artifactRoot, "reports", "compatibility-conversion.report.json");
  const filterReportPath = path.join(plan.workspace.artifactRoot, "reports", "filter-report.json");
  const clean = await buildCleanArtifacts({ plan, state, log });

  writeJsonFile(normalizedPath, {
    kind: "knowmesh.normalizedLocalText",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    documents: clean.normalized
  });
  writeJsonl(chunksPath, clean.chunks);
  syncCleanArtifactsToCatalog(state, clean, { plan, chunksPath, normalizedPath });
  syncK12ExpertStructureFromCatalog(state, { plan, job });
  syncCleanReviewToQualityIssues(state, clean.review, { plan, job });
  writeJsonFile(conversionReportPath, {
    kind: "knowmesh.compatibilityConversionReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    summary: clean.conversionSummary,
    records: clean.conversionRecords
  });
  log(`清洗分段完成：${clean.summary.normalizedDocuments} 份资料生成 ${clean.summary.chunks} 个片段，${clean.summary.reviewRequired} 项需要复核。`, `Cleaning and chunking complete: ${clean.summary.normalizedDocuments} document(s), ${clean.summary.chunks} chunk(s), ${clean.summary.reviewRequired} review item(s).`, clean.summary, "completed");
  writeJsonFile(filterReportPath, {
    kind: "knowmesh.filterReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    project: plan.project,
    summary: clean.summary,
    ruleGroups: clean.ruleGroups,
    records: clean.records,
    review: clean.review
  });

  return {
    artifacts: [
      artifact("normalizedText", "清洗正文", "Clean text", normalizedPath, "保存可本机读取资料的清洗结果。", "Stores cleaned content from locally readable sources."),
      artifact("localChunks", "本地分段", "Local chunks", chunksPath, "保存可检查的本地知识片段草稿。", "Stores reviewable local knowledge chunks."),
      artifact("conversionReport", "兼容转换报告", "Compatibility conversion report", conversionReportPath, "记录老格式资料的转换结果和待处理原因。", "Records conversion results and reasons for legacy sources."),
      artifact("filterReport", "过滤报告", "Filter report", filterReportPath, "记录已清洗内容和需要人工确认的资料。", "Records cleaned content and sources that need review.")
    ]
  };
}

async function buildCleanArtifacts({ plan, state, log }) {
  const emit = typeof log === "function" ? log : () => {};
  const normalized = [];
  const chunks = [];
  const records = [];
  const review = [];
  const conversionRecords = [];

  emit(`开始读取和清洗 ${plan.documents.length} 份本地资料。`, `Reading and cleaning ${plan.documents.length} local document(s).`, { documents: plan.documents.length });
  for (const [documentIndex, document] of plan.documents.entries()) {
    emit(`读取资料 ${documentIndex + 1}/${plan.documents.length}：${document.relativePath || document.title}`, `Reading source ${documentIndex + 1}/${plan.documents.length}: ${document.relativePath || document.title}`, { index: documentIndex + 1, total: plan.documents.length, relativePath: document.relativePath, sourceType: document.sourceType });
    const text = await readLocalText(document, { plan, state, conversionRecords });
    if (!text) {
      const conversion = conversionRecords.find((item) => item.version_id === document.version_id);
      review.push({
        document_id: document.document_id,
        version_id: document.version_id,
        title: document.title,
        sourceType: document.sourceType,
        action: "review_required",
        reason: sourceReviewReason(document, conversion)
      });
      emit(`资料 ${documentIndex + 1}/${plan.documents.length} 暂无可抽取文本：${document.relativePath || document.title}`, `Source ${documentIndex + 1}/${plan.documents.length} has no extractable text: ${document.relativePath || document.title}`, { index: documentIndex + 1, relativePath: document.relativePath, sourceType: document.sourceType }, "blocked");
      continue;
    }

    const cleaned = cleanDocumentText(text, document);
    const clean = cleaned.text;
    records.push(...cleaned.records);
    review.push(...cleaned.review);
    normalized.push({
      document_id: document.document_id,
      version_id: document.version_id,
      title: document.title,
      relativePath: document.relativePath,
      sourceType: document.sourceType,
      filterRecords: cleaned.records.length,
      text: clean
    });
    const parts = splitText(clean);
    emit(`资料 ${documentIndex + 1}/${plan.documents.length} 已清洗：${clean.length} 字，生成 ${parts.length} 个片段。`, `Source ${documentIndex + 1}/${plan.documents.length} cleaned: ${clean.length} characters, ${parts.length} chunk(s).`, { index: documentIndex + 1, characters: clean.length, chunks: parts.length }, "completed");
    const education = extractK12EducationMetadata({
      sourceUri: document.sourceUri || document.relativePath || "",
      sourceParts: document.sourceParts,
      metadata: {
        title: document.title,
        relativePath: document.relativePath,
        sourceUri: document.sourceUri
      }
    });
    parts.forEach((chunkText, chunkIndex) => {
      chunks.push({
        chunk_id: `${document.version_id}_chunk_${String(chunkIndex + 1).padStart(6, "0")}`,
        document_id: document.document_id,
        version_id: document.version_id,
        active: false,
        text: chunkText,
        sourceUri: document.sourceUri,
        sourceParts: document.sourceParts,
        metadata: {
          title: document.title,
          project_id: plan.project.id,
          sourceType: document.sourceType,
          relativePath: document.relativePath,
          education
        }
      });
    });
  }

  const summary = {
    normalizedDocuments: normalized.length,
    chunks: chunks.length,
    filteredItems: records.length,
    removedItems: records.filter((item) => item.action === "remove").length,
    metadataOnlyItems: records.filter((item) => item.action === "metadata_only").length,
    reviewRequired: review.length
  };

  return {
    normalized,
    chunks,
    records,
    review,
    summary,
    conversionRecords,
    conversionSummary: summarizeConversions(conversionRecords),
    ruleGroups: buildRuleGroups(records)
  };
}
function buildFilterPreview(clean) {
  return {
    summary: clean.summary,
    ruleGroups: clean.ruleGroups,
    records: clean.records.slice(0, 8).map((item) => ({
      document_id: item.document_id,
      version_id: item.version_id,
      line_number: item.line_number,
      rule_id: item.rule_id,
      action: item.action,
      original_text: item.original_text,
      reason: item.reason,
      confidence: item.confidence,
      review_required: item.review_required
    }))
  };
}

async function writeRunReport(job, { plan, state }, log) {
  const reportPath = path.join(plan.workspace.artifactRoot, "reports", "local-run.report.json");
  log(`正在生成任务报告：汇总 ${job.artifacts?.length || 0} 个本地产物。`, `Generating run report with ${job.artifacts?.length || 0} local artifact(s).`, { artifacts: job.artifacts?.length || 0 });
  writeJsonFile(reportPath, {
    kind: "knowmesh.localRunReport",
    apiVersion: "v1",
    generatedAt: new Date().toISOString(),
    job: {
      id: job.id,
      status: job.status,
      mode: job.mode,
      template: job.template,
      summary: job.summary,
      progress: job.progress
    },
    artifacts: job.artifacts || [],
    gates: plan.gates
  });
  const artifacts = [
    artifact("localRunReport", "知识库任务报告", "Local run report", reportPath, "汇总本次执行结果和可追溯产物。", "Summarizes this run and its traceable artifacts.")
  ];
  const localVersionArtifacts = await publishLocalCatalogVersionIfNeeded({ state, job, plan, log });
  artifacts.push(...localVersionArtifacts);
  log(`任务报告已生成：${reportPath}`, `Run report generated: ${reportPath}`, { reportPath }, "completed");
  return {
    artifacts
  };
}

async function publishLocalCatalogVersionIfNeeded({ state, job, plan, log }) {
  if (job.mode !== "local") return [];
  if (artifactPathForJob(job, "activeManifest")) return [];
  const chunks = readCatalogChunks(state, { includeInactive: true });
  const publishableChunks = chunks.filter((item) => item?.quality?.writeEnabled !== false);
  if (!publishableChunks.length) {
    log?.(
      "本地 catalog 暂无可发布片段，版本发布保持草稿状态。",
      "The local catalog has no publishable chunks; version publish remains draft.",
      { chunks: 0 },
      "warn"
    );
    return [];
  }

  const draftManifestPath = path.join(plan.workspace.manifests, "draft-active-manifest.json");
  const activeManifestPath = path.join(plan.workspace.manifests, "active-manifest.json");
  const activeManifest = buildLocalCatalogActiveManifest(plan, job, publishableChunks);
  await runBuildVersionPublishStage({
    draftManifestPath,
    activeManifestPath,
    manifest: activeManifest,
    qualityGates: { requireActiveRecords: true, allowReviewRecords: true }
  }, job, log, executeBuildVersionPublishImplementation);
  return [
    artifact("draftActiveManifest", "待发布版本清单", "Draft active manifest", draftManifestPath, "记录本地 catalog 发布前通过质量门检查的版本草稿。", "Records the local catalog version draft checked before activation."),
    artifact("activeManifest", "已激活版本清单", "Active manifest", activeManifestPath, "记录当前已生效的本地 catalog 版本。", "Records the active local catalog version.")
  ];
}

function buildLocalCatalogActiveManifest(plan, job, chunks = []) {
  const reviewRecords = chunks.filter((item) => item?.quality?.tier === "review").length;
  const activeRecords = chunks.length - reviewRecords;
  return {
    ...plan.proposedActiveManifest,
    generatedAt: new Date().toISOString(),
    status: "active",
    activatedAt: new Date().toISOString(),
    datasetVersionId: job.datasetVersionId || "",
    knowledgeBase: { id: job.knowledgeBaseId || job.knowledgeBase?.id || "" },
    job: { id: job.id, mode: job.mode, template: job.template },
    target: {
      provider: "local",
      store: "catalog.sqlite"
    },
    sidecar: {
      status: "ready",
      authoritativeStore: "catalog.sqlite",
      chunks: activeRecords
    },
    quality: {
      activeRecords,
      primaryRecords: activeRecords,
      reviewRecords,
      totalRecords: chunks.length
    },
    activeVersions: plan.proposedActiveManifest.activeVersions.map((item) => ({
      ...item,
      lifecycle: "active"
    })),
    rollback: {
      enabled: true,
      reason: "local-catalog-publish"
    }
  };
}

async function readLocalText(document, context = {}) {
  const sourcePath = document.sourceParts?.[0]?.path || document.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) return "";
  if (sourcePreparationCategory(document) === "autoConvert") {
    const conversion = await convertCompatibleSource(document, context);
    context.conversionRecords?.push(conversion);
    if (conversion.status !== "converted" || !conversion.outputPath) return "";
    return readOfficeText(conversion.outputPath, conversion.outputType);
  }
  if (["docx", "docm", "xlsx", "xlsm", "pptx", "pptm"].includes(document.sourceType)) {
    return readOfficeText(sourcePath, document.sourceType);
  }
  if (document.sourceType === "rtf") return readRtfText(sourcePath);
  if (!["text", "markdown", "csv", "tsv"].includes(document.sourceType)) return "";
  const text = fs.readFileSync(sourcePath, "utf8");
  if (document.sourceType === "csv") return delimitedTextToReadable(text, ",", document);
  if (document.sourceType === "tsv") return delimitedTextToReadable(text, "\t", document);
  return text;
}

function summarizeConversions(records) {
  return {
    totalDocuments: records.length,
    convertedDocuments: records.filter((item) => item.status === "converted").length,
    missingConverters: records.filter((item) => item.status === "converter_missing").length,
    failedDocuments: records.filter((item) => item.status === "conversion_failed").length
  };
}

function delimitedTextToReadable(text, delimiter, document) {
  const rows = parseDelimitedRows(text, delimiter).filter((row) => row.some((cell) => cell.trim()));
  if (!rows.length) return "";
  const lines = [`表格文件: ${document.title}`];
  rows.forEach((row, index) => {
    lines.push(`第 ${index + 1} 行: ${row.map((cell) => cell.trim()).join(" | ")}`);
  });
  return lines.join("\n");
}

function parseDelimitedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!quoted && char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}

function cleanDocumentText(text, document) {
  const records = [];
  const review = [];
  const cleanLines = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, index) => {
    let working = line;
    if (containsSensitiveCredential(working)) {
      const record = filterRecord(document, {
        lineNumber: index + 1,
        ruleId: "possible_secret",
        action: "review",
        originalText: redactSensitiveText(working),
        normalizedText: "",
        reasonZh: "疑似访问密钥、Token 或密码，默认不进入正文分段。",
        reasonEn: "Possible access key, token, or password; excluded from body chunks by default.",
        confidence: 0.92,
        reviewRequired: true
      });
      records.push(record);
      review.push(record);
      return;
    }

    if (isIsolatedPageNumber(working)) {
      records.push(filterRecord(document, {
        lineNumber: index + 1,
        ruleId: "isolated_page_number",
        action: "remove",
        originalText: working.trim(),
        normalizedText: "",
        reasonZh: "孤立页码不进入检索正文。",
        reasonEn: "Isolated page numbers are not kept in searchable body text.",
        confidence: 0.96,
        reviewRequired: false
      }));
      return;
    }

    const urls = findExternalUrls(working);
    if (urls.length) {
      for (const url of urls) {
        records.push(filterRecord(document, {
          lineNumber: index + 1,
          ruleId: "external_url",
          action: "metadata_only",
          originalText: url,
          normalizedText: "",
          reasonZh: "外部链接只进入过滤报告和元数据，不进入正文分段。",
          reasonEn: "External links go to the filter report and metadata, not body chunks.",
          confidence: 0.98,
          reviewRequired: false
        }));
      }
      working = working.replace(externalUrlPattern(), " ");
    }

    cleanLines.push(working);
  });

  return {
    text: normalizeCleanText(cleanLines.join("\n")),
    records,
    review
  };
}

function normalizeCleanText(text) {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findExternalUrls(text) {
  return [...text.matchAll(externalUrlPattern())].map((match) => match[0]);
}

function externalUrlPattern() {
  return /(?:https?:\/\/|www\.)[^\s)]+/gi;
}

function isIsolatedPageNumber(text) {
  return /^\s*(?:第\s*)?\d{1,4}\s*(?:页)?\s*$/i.test(text);
}

function containsSensitiveCredential(text) {
  return /\b(?:access[_ -]?key(?:_secret)?|api[_ -]?key|secret|token|password)\b\s*[:=]/i.test(text);
}

function redactSensitiveText(text) {
  return text.replace(/([:=]\s*).+$/, "$1[redacted]");
}

function filterRecord(document, options) {
  return {
    document_id: document.document_id,
    version_id: document.version_id,
    page_number: null,
    line_number: options.lineNumber,
    rule_id: options.ruleId,
    action: options.action,
    original_text: options.originalText,
    normalized_text: options.normalizedText,
    reason: {
      zh: options.reasonZh,
      en: options.reasonEn
    },
    confidence: options.confidence,
    review_required: options.reviewRequired
  };
}

function buildRuleGroups(records) {
  const groups = [
    ["remove", "删除", "Removed", "remove"],
    ["metadataOnly", "转为元数据", "Metadata only", "metadata_only"],
    ["review", "待确认", "Review", "review"]
  ];
  return groups.map(([key, zh, en, action]) => ({
    key,
    action,
    count: records.filter((item) => item.action === action).length,
    label: { zh, en }
  }));
}

function splitText(text, size = 1200) {
  if (!text) return [];
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    const value = text.slice(index, index + size).trim();
    if (value) chunks.push(value);
  }
  return chunks;
}

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonlFile(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const records = [];
    const handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(1024 * 1024);
    const decoder = new StringDecoder("utf8");
    let carry = "";
    try {
      while (true) {
        const bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
        if (!bytes) break;
        const text = carry + decoder.write(buffer.subarray(0, bytes));
        const lines = text.split(/\r?\n/);
        carry = lines.pop() || "";
        for (const line of lines) {
          if (line) records.push(JSON.parse(line));
        }
      }
      carry += decoder.end();
      if (carry.trim()) records.push(JSON.parse(carry));
      return records;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return [];
  }
}

function writeJsonl(file, records, options = {}) {
  ensureDir(path.dirname(file));
  const handle = fs.openSync(file, options.append ? "a" : "w");
  const maxBufferLength = 1024 * 1024;
  let buffer = "";
  try {
    for (const record of records || []) {
      if (!record) continue;
      const line = `${JSON.stringify(record)}\n`;
      if (buffer.length && buffer.length + line.length > maxBufferLength) {
        fs.writeSync(handle, buffer, null, "utf8");
        buffer = "";
      }
      if (line.length > maxBufferLength) {
        fs.writeSync(handle, line, null, "utf8");
      } else {
        buffer += line;
      }
    }
    if (buffer) fs.writeSync(handle, buffer, null, "utf8");
  } finally {
    fs.closeSync(handle);
  }
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

function artifactPath(key, zhLabel, enLabel, file) {
  return {
    key,
    path: file,
    label: { zh: zhLabel, en: enLabel }
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














