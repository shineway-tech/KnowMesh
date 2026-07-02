import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { executeLocalTask, testLocalTask } from "./local-executor.mjs";
import { syncJobArtifactsToCatalog } from "./artifact-registry.mjs";
import { publishBuildVersionToCatalog } from "./execution/build-version-publisher.mjs";
import { syncK12EvaluationForJob } from "./k12-evaluation-runner.mjs";
import { previewExecutionPlan } from "./plan-preview.mjs";
import { previewTargetedRerun, targetedRerunWorkspaceRoot } from "./targeted-rerun.mjs";
import { currentKnowledgeBaseId, knowledgeBaseDataRoot, knowledgeBaseIdForJob, touchKnowledgeBaseById } from "./knowledge-bases.mjs";
import { syncSourceManifestToCatalog } from "./source-catalog.mjs";
import { nowIso, openCatalogDatabase, parseJson, stableJson } from "./storage.mjs";

const cloudTaskKeys = new Set(["upload", "ocr", "embedding", "index"]);
const activeJobIds = new Set();

export async function confirmLocalJob(state, options = {}) {
  const preview = await previewExecutionPlan(state, options);
  const mode = options.mode === "local" ? "local" : "aliyun";
  const blockers = [...(preview.planPreview?.blockers || [])];

  const blocked = blockers.length > 0 || !preview.ok;
  const job = blocked
    ? buildBlockedJob(state, preview, blockers)
    : buildJob(state, preview, options);

  if (!blocked) {
    syncSourceManifestToCatalog(state, preview.sourceManifest, {
      workspaceRoot: job.summary?.workspaceRoot || ""
    });
  }
  saveJob(state, job);
  return {
    ok: !blocked,
    executionEnabled: !blocked,
    checks: preview.checks,
    job
  };
}

export function confirmTargetedRerunJob(state, input = {}) {
  const preview = previewTargetedRerun(state, input);
  const blocked = !preview.ok || !preview.summary?.canConfirm;
  if (blocked) {
    return {
      ok: false,
      kind: "knowmesh.targetedRerunConfirm",
      executionEnabled: false,
      checks: preview.checks || [],
      preview,
      job: null
    };
  }
  const job = buildTargetedRerunJob(state, preview, input);
  saveJob(state, job);
  return {
    ok: true,
    kind: "knowmesh.targetedRerunConfirm",
    executionEnabled: true,
    checks: preview.checks || [],
    preview,
    job
  };
}

export function latestJob(state) {
  const jobs = jobStore(state);
  const job = state.latestJobId ? jobs.get(state.latestJobId) : null;
  if (job) {
    normalizeJobProgress(state, job);
    return { ok: true, job };
  }
  return {
    ok: false,
    checks: [
      {
        key: "latestJob",
        status: "warn",
        label: { zh: "最近任务", en: "Latest job" },
        message: { zh: "还没有创建任务。", en: "No job has been created yet." }
      }
    ],
    job: null
  };
}

export async function advanceLatestJob(state) {
  const jobs = jobStore(state);
  const job = state.latestJobId ? jobs.get(state.latestJobId) : null;
  if (!job) return latestJob(state);
  normalizeJobProgress(state, job);

  if (job.status === "blocked") {
    return {
      ok: false,
      checks: [jobCheck("jobBlocked", "fail", "任务被阻止", "Job blocked", "先处理阻塞项后再继续。", "Fix blockers before continuing.")],
      job
    };
  }

  if (job.status === "paused") {
    return {
      ok: false,
      checks: [jobCheck("jobPaused", "warn", "任务已暂停", "Job paused", "任务已暂停，恢复后才能继续推进。", "The job is paused. Resume it before advancing.")],
      job
    };
  }

  if (job.status === "pausing") {
    return {
      ok: false,
      checks: [jobCheck("jobPausing", "warn", "正在暂停", "Pausing", "正在等待当前步骤结束后暂停。", "KnowMesh is waiting for the current step to finish before pausing.")],
      job
    };
  }

  if (job.status === "running") {
    return {
      ok: false,
      checks: [jobCheck("jobRunning", "warn", "任务正在执行", "Job running", "当前步骤正在执行，请查看实时回显。", "The current step is running. Watch the live log.")],
      job
    };
  }

  if (job.status === "stopped") {
    return {
      ok: false,
      checks: [jobCheck("jobStopped", "fail", "任务已终止", "Job stopped", "任务已终止，不能继续推进。", "The job has been stopped and cannot continue.")],
      job
    };
  }

  if (job.status === "completed") {
    return {
      ok: true,
      checks: [jobCheck("jobCompleted", "pass", "任务已完成", "Job complete", "知识库生成任务已经完成。", "The knowledge-base build job is complete.")],
      job
    };
  }

  const nextTask = nextExecutableTask(job);
  if (!nextTask) {
    const blockedTasks = job.tasks.filter((item) => item.status === "blocked");
    if (blockedTasks.length) {
      job.status = "blocked";
      job.updatedAt = new Date().toISOString();
      job.progress = summarizeTasks(job.tasks);
      job.nextAction = {
        label: { zh: "查看执行前确认", en: "Review confirmations" },
        href: "/build/execution#confirm"
      };
      persistJobStore(state);
      return {
        ok: false,
        checks: [jobCheck("confirmationRequired", "warn", "等待执行前确认", "Confirmation required", "任务里仍有步骤需要处理。", "The job still has steps to process.")],
        job
      };
    }
    job.status = "completed";
    job.updatedAt = new Date().toISOString();
    job.progress = summarizeTasks(job.tasks);
    job.executionPlan = advanceExecutionPlan(job.executionPlan, "report", true);
    persistJobStore(state);
    return {
      ok: true,
      checks: [jobCheck("jobCompleted", "pass", "任务已完成", "Job complete", "没有剩余待处理步骤。", "No steps remain.")],
      job
    };
  }

  markTaskRunning(state, job, nextTask);

  let execution;
  try {
    execution = await executeLocalTask(state, job, nextTask, { log: createJobLogger(state, job, nextTask) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    nextTask.status = "failed";
    nextTask.message = {
      zh: `${nextTask.label.zh} 没有完成：${message}`,
      en: `${nextTask.label.en} did not complete: ${message}`
    };
    job.status = "failed";
    job.updatedAt = new Date().toISOString();
    job.progress = summarizeTasks(job.tasks);
    appendJobEvent(state, job, {
      type: "step-failed",
      taskKey: nextTask.key,
      status: "failed",
      label: nextTask.label,
      message: nextTask.message
    });
    job.failures = [
      ...(job.failures || []).filter((item) => item.key !== nextTask.key),
      {
        key: nextTask.key,
        retryable: true,
        label: nextTask.label,
        message: nextTask.message,
        step: "/build/execution"
      }
    ];
    job.recovery = [
      ...(job.recovery || []).filter((item) => item.key !== nextTask.key),
      {
        key: nextTask.key,
        label: { zh: "回到任务页", en: "Back to tasks" },
        href: "/build/execution",
        message: nextTask.message
      }
    ];
    activeJobIds.delete(job.id);
    persistJobStore(state);
    return {
      ok: false,
      checks: [jobCheck("advanceFailed", "fail", "推进失败", "Advance failed", nextTask.message.zh, nextTask.message.en)],
      job
    };
  }

  if (execution?.paused) {
    const artifacts = Array.isArray(execution.artifacts) ? execution.artifacts : [];
    const checkpoint = execution.checkpoint && typeof execution.checkpoint === "object" ? execution.checkpoint : null;
    nextTask.status = "waiting";
    nextTask.message = {
      zh: `${nextTask.label.zh} 已暂停，恢复后会从未完成的位置继续。`,
      en: `${nextTask.label.en} is paused and will continue from the unfinished point after resume.`
    };
    if (artifacts.length) job.artifacts = mergeArtifacts(job.artifacts || [], artifacts);
    if (checkpoint) {
      job.checkpoints = {
        ...(job.checkpoints || {}),
        [nextTask.key]: {
          ...checkpoint,
          updatedAt: new Date().toISOString()
        }
      };
    }
    job.pauseRequested = false;
    job.statusBeforePause = nextJobStatus(job);
    job.status = "paused";
    job.pausedAt = new Date().toISOString();
    job.updatedAt = job.pausedAt;
    job.progress = summarizeTasks(job.tasks);
    appendJobEvent(state, job, {
      type: "job-paused",
      taskKey: nextTask.key,
      status: "paused",
      label: { zh: "任务已暂停", en: "Job paused" },
      message: {
        zh: `已在「${nextTask.label.zh}」批次边界暂停，恢复后从未完成位置继续。`,
        en: `Paused at a ${nextTask.label.en} batch boundary; resume continues from the unfinished point.`
      },
      detail: checkpoint
    });
    job.executionPlan = advanceExecutionPlan(job.executionPlan, nextTask.key, false);
    job.nextAction = {
      label: { zh: "恢复任务", en: "Resume job" },
      href: "/build/execution"
    };
    activeJobIds.delete(job.id);
    persistJobStore(state);
    return {
      ok: false,
      checks: [jobCheck("jobPaused", "warn", "已暂停", "Paused", `已在「${nextTask.label.zh}」暂停，恢复后继续。`, `Paused during ${nextTask.label.en}; resume to continue.`)],
      advanced: {
        key: nextTask.key,
        label: nextTask.label,
        artifacts,
        checkpoint
      },
      job
    };
  }

  const shouldPauseAfterStep = job.pauseRequested === true || job.status === "pausing";
  const artifacts = Array.isArray(execution.artifacts) ? execution.artifacts : [];
  nextTask.status = "completed";
  nextTask.artifacts = artifacts;
  nextTask.message = {
    zh: artifacts.length ? `${nextTask.label.zh} 已完成，已生成 ${artifacts.length} 个本地产物。` : `${nextTask.label.zh} 已完成。`,
    en: artifacts.length ? `${nextTask.label.en} is complete with ${artifacts.length} local artifact(s).` : `${nextTask.label.en} is complete.`
  };
  job.artifacts = mergeArtifacts(job.artifacts || [], artifacts);
  job.status = nextJobStatus(job);
  job.updatedAt = new Date().toISOString();
  job.progress = summarizeTasks(job.tasks);
  appendJobEvent(state, job, {
    type: "step-complete",
    taskKey: nextTask.key,
    status: "completed",
    label: nextTask.label,
    message: nextTask.message
  });

  if (shouldPauseAfterStep && job.status !== "completed") {
    job.pauseRequested = false;
    job.statusBeforePause = job.status;
    job.status = "paused";
    job.pausedAt = new Date().toISOString();
    job.updatedAt = job.pausedAt;
    job.progress = summarizeTasks(job.tasks);
    appendJobEvent(state, job, {
      type: "job-paused",
      taskKey: nextTask.key,
      status: "paused",
      label: { zh: "任务已暂停", en: "Job paused" },
      message: {
        zh: `已在「${nextTask.label.zh}」完成后暂停，后续步骤不会继续执行。`,
        en: `Paused after ${nextTask.label.en} completed; remaining steps will not continue.`
      }
    });
    job.executionPlan = advanceExecutionPlan(job.executionPlan, nextTask.key, false);
    job.nextAction = {
      label: { zh: "恢复任务", en: "Resume job" },
      href: "/build/execution"
    };
    activeJobIds.delete(job.id);
    persistJobStore(state);
    return {
      ok: false,
      checks: [jobCheck("jobPaused", "warn", "已暂停", "Paused", `已在「${nextTask.label.zh}」完成后暂停。`, `Paused after ${nextTask.label.en} completed.`)],
      advanced: {
        key: nextTask.key,
        label: nextTask.label,
        artifacts
      },
      job
    };
  }

  delete job.pauseRequested;
  delete job.pauseRequestedAt;
  delete job.statusBeforePause;
  job.executionPlan = advanceExecutionPlan(job.executionPlan, nextTask.key, job.status === "completed");
  job.nextAction = {
    label: job.status === "completed"
      ? { zh: "查看任务结果", en: "View result" }
      : { zh: "继续推进下一步", en: "Advance next step" },
    href: "/build/execution"
  };
  activeJobIds.delete(job.id);
  persistJobStore(state);

  return {
    ok: true,
    checks: [jobCheck("advanced", "pass", "已推进", "Advanced", `${nextTask.label.zh} 已完成。`, `${nextTask.label.en} is complete.`)],
    advanced: {
      key: nextTask.key,
      label: nextTask.label,
      artifacts
    },
    job
  };
}

export async function runLatestJob(state) {
  const job = currentJob(state);
  if (!job) return latestJob(state);
  if (job.status === "paused") {
    return {
      ok: false,
      checks: [jobCheck("jobPaused", "warn", "任务已暂停", "Job paused", "任务已暂停，恢复后才能执行剩余步骤。", "The job is paused. Resume it before running remaining steps.")],
      job
    };
  }
  if (job.status === "stopped") {
    return {
      ok: false,
      checks: [jobCheck("jobStopped", "fail", "任务已终止", "Job stopped", "任务已终止，不能执行剩余步骤。", "The job has been stopped and cannot run remaining steps.")],
      job
    };
  }
  if (job.status === "running") {
    return {
      ok: false,
      checks: [jobCheck("jobRunning", "warn", "任务正在执行", "Job running", "任务正在执行，请查看实时回显。", "The job is already running. Watch the live log.")],
      job
    };
  }
  if (job.status === "blocked") {
    return {
      ok: false,
      checks: [jobCheck("jobBlocked", "fail", "任务被阻止", "Job blocked", "先处理阻塞项后再继续。", "Fix blockers before continuing.")],
      job
    };
  }

  appendJobEvent(state, job, {
    type: "job-action",
    status: "running",
    label: { zh: "执行剩余步骤", en: "Run remaining steps" },
    message: { zh: "用户已触发执行剩余步骤。", en: "Run remaining steps was started." }
  });
  persistJobStore(state);

  const advancedSteps = [];
  while (currentJob(state)?.tasks.some((item) => item.status === "waiting")) {
    const result = await advanceLatestJob(state);
    if (result.advanced) advancedSteps.push(result.advanced);
    if (!result.ok) {
      return {
        ...result,
        run: { steps: advancedSteps }
      };
    }
    const latest = currentJob(state);
    if (!latest || latest.status === "completed" || latest.status === "failed" || latest.status === "stopped" || latest.status === "paused") break;
  }

  const completedJob = currentJob(state);
  return {
    ok: completedJob?.status === "completed",
    checks: [jobCheck(
      completedJob?.status === "completed" ? "runCompleted" : "runStopped",
      completedJob?.status === "completed" ? "pass" : "warn",
      completedJob?.status === "completed" ? "执行完成" : "执行已停下",
      completedJob?.status === "completed" ? "Run complete" : "Run stopped",
      completedJob?.status === "completed" ? "剩余步骤已完成。" : "执行没有继续推进。",
      completedJob?.status === "completed" ? "All remaining steps are complete." : "The run did not continue."
    )],
    run: { steps: advancedSteps },
    job: completedJob
  };
}

export async function testLatestJobTask(state, options = {}) {
  const job = currentJob(state);
  if (!job) return latestJob(state);
  if (job.status === "stopped") {
    return {
      ok: false,
      checks: [jobCheck("jobStopped", "fail", "任务已终止", "Job stopped", "任务已终止，不能再测试步骤。", "The job has been stopped and steps can no longer be tested.")],
      job
    };
  }
  const taskKey = options.taskKey || nextTestableTask(job)?.key;
  const taskItem = job.tasks.find((item) => item.key === taskKey);
  if (!taskItem) {
    return {
      ok: false,
      checks: [jobCheck("taskMissing", "fail", "没有找到步骤", "Step not found", "没有找到要测试的任务步骤。", "The task step to test was not found.")],
      job
    };
  }
  if (!["waiting", "running", "completed", "failed"].includes(taskItem.status)) {
    return {
      ok: false,
      checks: [jobCheck("taskNotTestable", "warn", "步骤不可测试", "Step cannot be tested", "这个步骤当前不能测试。", "This step cannot be tested right now.")],
      job
    };
  }

  const execution = await testLocalTask(state, job, taskItem);
  const artifacts = Array.isArray(execution.artifacts) ? execution.artifacts : [];
  const testResult = {
    task: {
      key: taskItem.key,
      label: taskItem.label,
      status: taskItem.status
    },
    checkedAt: new Date().toISOString(),
    checks: execution.checks || [],
    artifacts,
    expectedArtifacts: execution.expectedArtifacts || [],
    ...(execution.filterPreview ? { filterPreview: execution.filterPreview } : {})
  };
  job.testResults = {
    ...(job.testResults || {}),
    [taskItem.key]: testResult
  };
  job.updatedAt = new Date().toISOString();
  persistJobStore(state);

  return {
    ok: true,
    checks: execution.checks || [],
    testResult,
    job
  };
}

export function pauseLatestJob(state) {
  const job = currentJob(state);
  if (!job) return latestJob(state);
  if (job.status === "stopped" || job.status === "completed" || job.status === "blocked") {
    return {
      ok: false,
      checks: [jobCheck("pauseUnavailable", "warn", "不能暂停", "Pause unavailable", "当前任务状态不能暂停。", "This job cannot be paused in its current state.")],
      job
    };
  }
  if (job.status === "paused") {
    return {
      ok: true,
      checks: [jobCheck("jobPaused", "pass", "已暂停", "Paused", "任务已经暂停。", "The job is already paused.")],
      job
    };
  }
  if (job.status === "pausing") {
    return {
      ok: true,
      checks: [jobCheck("jobPausing", "warn", "正在暂停", "Pausing", "正在等待当前步骤结束后暂停。", "KnowMesh is waiting for the current step to finish before pausing.")],
      job
    };
  }

  const now = new Date().toISOString();
  const hasRunningStep = job.tasks?.some((item) => item.status === "running");
  job.statusBeforePause = job.status;
  job.updatedAt = now;

  if (job.status === "running" || hasRunningStep) {
    job.pauseRequested = true;
    job.pauseRequestedAt = now;
    job.status = "pausing";
    appendJobEvent(state, job, {
      type: "job-pause-requested",
      taskKey: job.tasks?.find((item) => item.status === "running")?.key || "",
      status: "running",
      label: { zh: "正在暂停", en: "Pausing" },
      message: {
        zh: "已收到暂停请求，当前步骤结束后会暂停。",
        en: "Pause requested; KnowMesh pauses after the current step finishes."
      }
    });
    persistJobStore(state);
    return {
      ok: true,
      checks: [jobCheck("jobPausing", "warn", "正在暂停", "Pausing", "已收到暂停请求，当前步骤结束后会暂停。", "Pause requested; KnowMesh pauses after the current step finishes.")],
      job
    };
  }

  job.pauseRequested = false;
  job.status = "paused";
  job.pausedAt = now;
  appendJobEvent(state, job, {
    type: "job-paused",
    status: "paused",
    label: { zh: "任务已暂停", en: "Job paused" },
    message: { zh: "任务已暂停，后续步骤不会继续执行。", en: "The job is paused and remaining steps will not continue." }
  });
  persistJobStore(state);
  return {
    ok: true,
    checks: [jobCheck("jobPaused", "pass", "已暂停", "Paused", "任务已暂停，不会继续推进。", "The job is paused and will not advance.")],
    job
  };
}

export function resumeLatestJob(state) {
  const job = currentJob(state);
  if (!job) return latestJob(state);
  if (job.status !== "paused") {
    return {
      ok: false,
      checks: [jobCheck("resumeUnavailable", "warn", "不能恢复", "Resume unavailable", "当前任务不是暂停状态。", "This job is not paused.")],
      job
    };
  }
  job.status = nextJobStatus(job);
  delete job.pauseRequested;
  delete job.pauseRequestedAt;
  delete job.statusBeforePause;
  job.resumedAt = new Date().toISOString();
  job.updatedAt = job.resumedAt;
  appendJobEvent(state, job, {
    type: "job-resumed",
    status: job.status,
    label: { zh: "任务已恢复", en: "Job resumed" },
    message: { zh: "任务已恢复，可以继续推进。", en: "The job is resumed and can advance." }
  });
  persistJobStore(state);
  return {
    ok: true,
    checks: [jobCheck("jobResumed", "pass", "已恢复", "Resumed", "任务已恢复，可以继续推进。", "The job is resumed and can advance.")],
    job
  };
}

export function stopLatestJob(state) {
  const job = currentJob(state);
  if (!job) return latestJob(state);
  if (job.status === "stopped") {
    return {
      ok: true,
      checks: [jobCheck("jobStopped", "pass", "已终止", "Stopped", "任务已经终止。", "The job is already stopped.")],
      job
    };
  }
  job.tasks = job.tasks.map((item) => {
    if (item.status !== "waiting" && item.status !== "running") return item;
    return {
      ...item,
      status: "stopped",
      message: {
        zh: `${item.label.zh} 已随任务终止。`,
        en: `${item.label.en} was stopped with the job.`
      }
    };
  });
  job.status = "stopped";
  job.stoppedAt = new Date().toISOString();
  job.updatedAt = job.stoppedAt;
  job.progress = summarizeTasks(job.tasks);
  job.nextAction = {
    label: { zh: "查看终止结果", en: "View stopped job" },
    href: "/build/execution"
  };
  persistJobStore(state);
  return {
    ok: true,
    checks: [jobCheck("jobStopped", "pass", "已终止", "Stopped", "任务已终止，后续步骤不会继续执行。", "The job has been stopped and remaining steps will not run.")],
    job
  };
}

function buildJob(state, preview, options = {}) {
  const now = new Date().toISOString();
  const plannedTasks = preview.planPreview.actions
    .filter((action) => action.key !== "scan" && action.status !== "skip")
    .map((action) => task(action.key, "waiting", action.label.zh, action.label.en, action.message.zh, action.message.en));
  const tasks = [
    task("scan", "completed", "只读扫描", "Read-only scan", "已完成资料识别。", "Source detection is complete."),
    ...plannedTasks,
    task("report", "waiting", "生成执行摘要", "Generate run summary", "汇总本次执行结果和可追溯产物。", "Summarize this run and its traceable artifacts.")
  ];

  const job = {
    id: randomUUID(),
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    mode: preview.mode,
    template: preview.template,
    title: { zh: "知识库生成任务", en: "Knowledge-base build job" },
    summary: {
      sourceRoot: preview.planPreview.summary.sourceRoot,
      workspaceRoot: preview.planPreview.summary.workspaceRoot,
      includedFiles: preview.planPreview.summary.includedFiles,
      logicalDocuments: preview.planPreview.summary.logicalDocuments
    },
    progress: summarizeTasks(tasks),
    executionPlan: preview.planPreview.executionPlan,
    cloudConfirmation: preview.planPreview.cloudConfirmation,
    draft: sanitizeDraft(options.draft || {}),
    artifacts: [],
    tasks,
    failures: [],
    recovery: [],
    nextAction: {
      label: { zh: "查看任务进度", en: "View progress" },
      href: "/build/execution"
    }
  };
  return applyJobIsolation(state, job);
}

function buildTargetedRerunJob(state, preview, input = {}) {
  const now = new Date().toISOString();
  const knowledgeBaseId = preview.knowledgeBase?.id || currentKnowledgeBaseId(state);
  const jobId = randomUUID();
  const mode = input.mode === "aliyun" ? "aliyun" : input.mode === "local" ? "local" : "local";
  const workspaceRoot = targetedRerunWorkspaceRoot(
    String(input.workspaceRoot || input.draft?.["project.workspace.base"] || input.draft?.["project.workspace"] || ""),
    knowledgeBaseId,
    jobId
  );
  const tasks = [
    task("scan", "completed", "确认重跑范围", "Confirm rerun scope", "已确认本次局部重跑范围。", "Targeted rerun scope is confirmed."),
    task("pages", "waiting", "准备受影响资料", "Prepare affected sources", "只准备本次重跑范围内的资料。", "Prepare only sources in this rerun scope."),
    task("clean", "waiting", "重建清洗分片", "Rebuild cleaned chunks", "重建受影响资料的清洗内容和分片。", "Rebuild cleaned content and chunks for affected sources."),
    task("embedding", "waiting", "重建检索数据", "Rebuild search data", "只为受影响片段重建检索数据。", "Rebuild search data only for affected chunks."),
    task("index", "waiting", "写入局部更新", "Write scoped update", "写入局部更新并保留版本记录。", "Write the scoped update and keep version history."),
    task("report", "waiting", "生成重跑摘要", "Generate rerun summary", "汇总本次局部重跑范围、结果和下一步。", "Summarize this targeted rerun, its result, and next action.")
  ];
  const summary = {
    knowledgeBaseId,
    rerun: {
      target: preview.target,
      scope: publicRerunScope(preview.rerunScope),
      documents: preview.summary?.documents || 0,
      pages: preview.summary?.pages || 0,
      retryablePages: preview.summary?.retryablePages || 0,
      structureNodes: preview.summary?.structureNodes || 0,
      chunks: preview.summary?.chunks || 0,
      qualityIssues: preview.summary?.qualityIssues || 0,
      evaluationFailures: preview.summary?.evaluationFailures || 0
    },
    sourceRoot: "",
    workspaceRoot,
    includedFiles: preview.summary?.documents || 0,
    logicalDocuments: preview.summary?.documents || 0
  };
  const job = {
    id: jobId,
    kind: "knowmesh.targetedRerunJob",
    status: "waiting",
    createdAt: now,
    updatedAt: now,
    mode,
    template: preview.knowledgeBase?.template || input.template || "general-docs",
    title: { zh: "局部重跑任务", en: "Targeted rerun job" },
    summary,
    targetedRerun: {
      target: preview.target,
      summary: preview.summary,
      rerunScope: preview.rerunScope,
      documents: preview.documents,
      pageRanges: preview.pageRanges,
      structureNodes: preview.structureNodes,
      failureBatches: preview.failureBatches,
      evaluationFailures: preview.evaluationFailures
    },
    progress: summarizeTasks(tasks),
    executionPlan: buildTargetedRerunExecutionPlan(preview),
    cloudConfirmation: null,
    draft: sanitizeDraft({
      ...(input.draft || {}),
      ...(workspaceRoot ? { "project.workspace": workspaceRoot } : {}),
      "targetedRerun.enabled": true,
      "targetedRerun.type": preview.target?.type || ""
    }),
    artifacts: [],
    tasks,
    failures: [],
    recovery: [],
    nextAction: {
      label: { zh: "查看局部重跑任务", en: "View targeted rerun job" },
      href: "/build/execution"
    }
  };
  return applyJobIsolation(state, job);
}

function publicRerunScope(scope = {}) {
  return {
    type: scope.target?.type || scope.type || "",
    qualityIssueIds: Array.isArray(scope.qualityIssueIds) ? scope.qualityIssueIds : [],
    documentIds: Array.isArray(scope.documentIds) ? scope.documentIds : [],
    relativePaths: Array.isArray(scope.relativePaths) ? scope.relativePaths : [],
    pageRanges: Array.isArray(scope.pageRanges)
      ? scope.pageRanges.map((item) => ({
          documentId: item.documentId || "",
          startPage: Number(item.startPage || 0),
          endPage: Number(item.endPage || 0),
          pages: Number(item.pages || 0)
        }))
      : [],
    structureNodeIds: Array.isArray(scope.structureNodeIds) ? scope.structureNodeIds : [],
    chunkIds: Array.isArray(scope.chunkIds) ? scope.chunkIds : [],
    evaluationCategories: Array.isArray(scope.evaluationCategories) ? scope.evaluationCategories : []
  };
}

function buildTargetedRerunExecutionPlan(preview = {}) {
  const summary = preview.summary || {};
  const stage = (key, order, status, zhLabel, enLabel, zhMessage, enMessage, metrics = []) => ({
    key,
    order,
    status,
    validationStatus: status === "completed" ? "passed" : "pending",
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage },
    roundCount: 1,
    rounds: [{
      key: `${key}-scope`,
      order: 1,
      status,
      validationStatus: status === "completed" ? "passed" : "pending",
      label: { zh: zhLabel, en: enLabel },
      message: { zh: zhMessage, en: enMessage },
      metrics
    }]
  });
  const metric = (zh, en, value) => ({ label: { zh, en }, value });
  const stages = [
    stage("scope", 1, "completed", "确认范围", "Confirm scope", "局部重跑范围已从 catalog.sqlite 读取。", "Rerun scope was read from catalog.sqlite.", [
      metric("资料", "Sources", summary.documents || 0),
      metric("页", "Pages", summary.pages || 0),
      metric("问题", "Issues", summary.qualityIssues || 0)
    ]),
    stage("rebuild", 2, "waiting", "重建受影响内容", "Rebuild affected content", "只重建本次范围关联的资料、页、结构和片段。", "Rebuild only sources, pages, structures, and chunks in this scope.", [
      metric("片段", "Chunks", summary.chunks || 0),
      metric("结构", "Structure", summary.structureNodes || 0)
    ]),
    stage("validate", 3, "waiting", "复核评测", "Validate evaluation", "完成后复核失败类别和引用闭环。", "After rerun, review failed categories and citation closure.", [
      metric("评测失败", "Evaluation failures", summary.evaluationFailures || 0)
    ])
  ];
  return {
    summary: {
      total: stages.length,
      completed: 1,
      waiting: stages.length - 1,
      blocked: 0
    },
    stages
  };
}

function buildBlockedJob(state, preview, blockers) {
  const now = new Date().toISOString();
  const tasks = (preview.planPreview?.actions || []).map((action) => {
    const status = action.kind === "cloud" && preview.mode === "aliyun" ? "blocked" : action.status === "skip" ? "skipped" : "waiting";
    return task(action.key, status, action.label.zh, action.label.en, action.message.zh, action.message.en);
  });
  const failures = blockers.map((item) => ({
    key: item.key,
    retryable: true,
    label: item.label,
    message: item.message,
    step: item.step
  }));

  const job = {
    id: randomUUID(),
    status: "blocked",
    createdAt: now,
    updatedAt: now,
    mode: preview.mode,
    template: preview.template,
    title: { zh: "任务还不能创建", en: "Job cannot be created yet" },
    summary: {
      sourceRoot: preview.planPreview?.summary?.sourceRoot || "",
      workspaceRoot: preview.planPreview?.summary?.workspaceRoot || "",
      includedFiles: preview.planPreview?.summary?.includedFiles || 0,
      logicalDocuments: preview.planPreview?.summary?.logicalDocuments || 0
    },
    progress: summarizeTasks(tasks),
    executionPlan: preview.planPreview?.executionPlan || null,
    cloudConfirmation: preview.planPreview?.cloudConfirmation || null,
    draft: sanitizeDraft({}),
    artifacts: [],
    tasks,
    failures,
    recovery: failures.map((item) => ({
      label: { zh: "去处理", en: "Fix" },
      href: item.step,
      message: item.message
    })),
    nextAction: {
      label: { zh: "回到开始前确认", en: "Back to ready check" },
      href: "/setup/plan"
    }
  };
  return applyJobIsolation(state, job);
}

function applyJobIsolation(state, job) {
  if (!job?.id) return job;
  const currentWorkspace = String(job.summary?.workspaceRoot || job.draft?.["project.workspace"] || "").trim();
  const parsedWorkspace = parseVersionWorkspaceRoot(currentWorkspace);
  const knowledgeBaseId = String(knowledgeBaseIdForJob(state, job, parsedWorkspace?.knowledgeBaseId)).trim();
  const datasetVersionId = String(job.datasetVersionId || parsedWorkspace?.datasetVersionId || createDatasetVersionId(job)).trim();
  const baseWorkspaceRoot = String(job.summary?.baseWorkspaceRoot || job.draft?.["project.workspace.base"] || parsedWorkspace?.baseWorkspaceRoot || currentWorkspace || "").trim();
  const isolatedWorkspaceRoot = baseWorkspaceRoot
    ? path.join(baseWorkspaceRoot, "knowledge-bases", safeFileSegment(knowledgeBaseId), "versions", safeFileSegment(datasetVersionId))
    : "";
  const previousWorkspaceRoot = currentWorkspace && isolatedWorkspaceRoot && path.resolve(currentWorkspace) !== path.resolve(isolatedWorkspaceRoot)
    ? currentWorkspace
    : "";

  if (previousWorkspaceRoot) migrateWorkspaceAssets(previousWorkspaceRoot, isolatedWorkspaceRoot);

  job.knowledgeBase = { id: knowledgeBaseId };
  job.knowledgeBaseId = knowledgeBaseId;
  job.datasetVersionId = datasetVersionId;
  job.summary = {
    ...(job.summary || {}),
    knowledgeBaseId,
    datasetVersionId,
    ...(baseWorkspaceRoot ? { baseWorkspaceRoot } : {}),
    ...(isolatedWorkspaceRoot ? { workspaceRoot: isolatedWorkspaceRoot } : {})
  };
  job.draft = {
    ...sanitizeDraft(job.draft || {}),
    ...(baseWorkspaceRoot ? { "project.workspace.base": baseWorkspaceRoot } : {}),
    ...(isolatedWorkspaceRoot ? { "project.workspace": isolatedWorkspaceRoot } : {})
  };
  if (previousWorkspaceRoot && isolatedWorkspaceRoot) rewriteJobArtifactPaths(job, previousWorkspaceRoot, isolatedWorkspaceRoot);
  return job;
}

function createDatasetVersionId(job) {
  const rawTime = String(job.createdAt || new Date().toISOString()).replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
  const rawJob = String(job.id || "job").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "job";
  return `build-${rawTime}-${rawJob}`;
}

function parseVersionWorkspaceRoot(workspaceRoot) {
  const normalized = path.normalize(String(workspaceRoot || ""));
  if (!normalized) return null;
  const root = path.parse(normalized).root;
  const relativePath = root ? path.relative(root, normalized) : normalized;
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  for (let index = parts.length - 4; index >= 0; index -= 1) {
    if (parts[index] !== "knowledge-bases" || parts[index + 2] !== "versions") continue;
    const baseParts = parts.slice(0, index);
    const baseWorkspaceRoot = baseParts.length
      ? path.join(root || "", ...baseParts)
      : root;
    return {
      baseWorkspaceRoot: baseWorkspaceRoot || root || "",
      knowledgeBaseId: parts[index + 1],
      datasetVersionId: parts[index + 3]
    };
  }
  return null;
}

function migrateWorkspaceAssets(previousWorkspaceRoot, isolatedWorkspaceRoot) {
  for (const folder of ["artifacts", "manifests"]) {
    copyDirectoryMerge(path.join(previousWorkspaceRoot, folder), path.join(isolatedWorkspaceRoot, folder));
  }
}

function copyDirectoryMerge(source, target) {
  if (!source || !target || path.resolve(source) === path.resolve(target) || !fs.existsSync(source)) return;
  const stat = fs.statSync(source);
  if (!stat.isDirectory()) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryMerge(sourcePath, targetPath);
    } else if (entry.isFile() && !fs.existsSync(targetPath)) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function rewriteJobArtifactPaths(job, previousWorkspaceRoot, isolatedWorkspaceRoot) {
  const rewriteArtifact = (artifactItem) => {
    if (!artifactItem || typeof artifactItem !== "object") return artifactItem;
    return {
      ...artifactItem,
      ...(artifactItem.path ? { path: rewriteWorkspacePath(artifactItem.path, previousWorkspaceRoot, isolatedWorkspaceRoot) } : {})
    };
  };
  job.artifacts = (job.artifacts || []).map(rewriteArtifact);
  for (const taskItem of job.tasks || []) {
    if (Array.isArray(taskItem.artifacts)) taskItem.artifacts = taskItem.artifacts.map(rewriteArtifact);
  }
}

function rewriteWorkspacePath(value, previousWorkspaceRoot, isolatedWorkspaceRoot) {
  const text = String(value || "");
  if (!text) return text;
  const relative = path.relative(previousWorkspaceRoot, text);
  if (!relative || relative === "") return isolatedWorkspaceRoot;
  if (relative.startsWith("..") || path.isAbsolute(relative)) return text;
  return path.join(isolatedWorkspaceRoot, relative);
}
function saveJob(state, job) {
  const jobs = jobStore(state);
  jobs.set(job.id, job);
  state.latestJobId = job.id;
  touchKnowledgeBaseById(state, job.knowledgeBaseId || job.knowledgeBase?.id || currentKnowledgeBaseId(state), {
    latestJobId: job.id,
    latestJobStatus: job.status,
    mode: job.mode,
    template: job.template,
    sourceRoot: job.summary?.sourceRoot || "",
    workspaceRoot: job.summary?.baseWorkspaceRoot || job.summary?.workspaceRoot || ""
  });
  writeInitialJobRecords(state, job);
  if (job.kind !== "knowmesh.targetedRerunJob") syncK12EvaluationForJob(state, job);
  persistJobStore(state);
}

function currentJob(state) {
  const jobs = jobStore(state);
  const job = state.latestJobId ? jobs.get(state.latestJobId) : null;
  if (job) normalizeJobProgress(state, job);
  return job;
}

function jobStore(state) {
  if (state.jobs instanceof Map) return state.jobs;
  const persisted = readPersistedJobStore(state);
  state.jobs = persisted.jobs;
  if (!state.latestJobId && persisted.latestJobId) state.latestJobId = persisted.latestJobId;
  const isolated = isolateLoadedJobs(state, state.jobs);
  const repaired = repairStaleLoadedJobs(state, state.jobs);
  if (isolated || repaired) persistJobStore(state);
  ensureDurableJobRecords(state, state.jobs);
  return state.jobs;
}

function isolateLoadedJobs(state, jobs) {
  let changed = false;
  for (const job of jobs.values()) {
    const before = JSON.stringify({
      knowledgeBase: job.knowledgeBase || null,
      knowledgeBaseId: job.knowledgeBaseId || "",
      datasetVersionId: job.datasetVersionId || "",
      summary: job.summary || null,
      draft: job.draft || null,
      artifacts: job.artifacts || []
    });
    applyJobIsolation(state, job);
    const after = JSON.stringify({
      knowledgeBase: job.knowledgeBase || null,
      knowledgeBaseId: job.knowledgeBaseId || "",
      datasetVersionId: job.datasetVersionId || "",
      summary: job.summary || null,
      draft: job.draft || null,
      artifacts: job.artifacts || []
    });
    if (before !== after) changed = true;
  }
  return changed;
}

function repairStaleLoadedJobs(state, jobs) {
  let changed = false;
  for (const job of jobs.values()) {
    if (repairStaleLoadedJob(state, job)) changed = true;
  }
  return changed;
}

function ensureDurableJobRecords(state, jobs) {
  for (const job of jobs.values()) ensureDurableJobRecord(state, job);
}

function ensureDurableJobRecord(state, job) {
  if (!job?.id || !Array.isArray(job.tasks)) return;
  const eventLog = path.join(jobExecutionRoot(state, job), "events.jsonl");
  let maxSequence = Number(job.eventSequence || 0);
  if (fs.existsSync(eventLog)) {
    maxSequence = Math.max(maxSequence, readDurableEventLogSequence(eventLog));
  } else {
    const events = Array.isArray(job.events) && job.events.length
      ? job.events
      : [{
          timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
          type: "job-restored",
          taskKey: "",
          status: job.status || "info",
          label: { zh: "任务状态已恢复", en: "Job state restored" },
          message: { zh: "从本地任务状态补齐执行记录。", en: "Execution records were backfilled from local job state." }
        }];
    for (const [index, event] of events.entries()) {
      const record = normalizedDurableEvent(event, index + 1);
      maxSequence = Math.max(maxSequence, Number(record.sequence || 0));
      writeDurableJobEvent(state, job, record);
      writeJobCheckpoint(state, job, record);
    }
  }
  job.eventSequence = maxSequence;

  for (const taskItem of job.tasks) {
    const checkpointPath = path.join(jobExecutionRoot(state, job), "checkpoints", `${safeFileSegment(taskItem.key)}.checkpoint.json`);
    if (fs.existsSync(checkpointPath)) continue;
    writeJobCheckpoint(state, job, {
      id: `${new Date().toISOString()}-${safeFileSegment(taskItem.key)}-snapshot`,
      sequence: Number(job.eventSequence || 0),
      timestamp: job.updatedAt || job.createdAt || new Date().toISOString(),
      type: "task-snapshot",
      taskKey: taskItem.key,
      status: taskItem.status || "waiting",
      label: taskItem.label || { zh: taskItem.key, en: taskItem.key },
      message: taskItem.message || { zh: "步骤状态已记录。", en: "Step state recorded." }
    });
  }
}

function readDurableEventLogSequence(file) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return 0;
    const lines = text.split(/\r?\n/);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index].trim();
      if (!line) continue;
      const event = JSON.parse(line);
      return Number(event.sequence || 0);
    }
  } catch {
    return 0;
  }
  return 0;
}

function normalizedDurableEvent(event, sequence) {
  const timestamp = event.timestamp || new Date().toISOString();
  return {
    id: event.id || `${timestamp}-${sequence}`,
    sequence: Number(event.sequence || sequence),
    timestamp,
    type: event.type || "job-event",
    taskKey: event.taskKey || "",
    status: event.status || "info",
    label: event.label || { zh: "任务事件", en: "Job event" },
    message: event.message || { zh: "任务状态已更新。", en: "The job state was updated." },
    ...(event.detail && typeof event.detail === "object" ? { detail: event.detail } : {})
  };
}

function repairStaleLoadedJob(state, job) {
  if (!job || !Array.isArray(job.tasks)) return false;
  if (activeJobIds.has(job.id)) return false;
  const staleStatus = job.status === "running" || job.status === "pausing";
  const runningTasks = job.tasks.filter((item) => item.status === "running");
  if (!staleStatus && !runningTasks.length) return false;

  const now = new Date().toISOString();
  const previousStatus = job.status;
  const repairedTasks = runningTasks.length ? runningTasks : job.tasks.filter((item) => item.status === "waiting").slice(0, 1);
  for (const item of repairedTasks) {
    item.status = "waiting";
    item.message = {
      zh: "上次执行中断，已保留已完成进度；继续后会从这里恢复。",
      en: "The local service stopped while this step was running. Completed progress was kept; continue to resume here."
    };
  }

  const wasPausing = job.status === "pausing" || job.pauseRequested === true;
  delete job.pauseRequested;
  delete job.pauseRequestedAt;
  delete job.statusBeforePause;
  job.updatedAt = now;
  job.progress = summarizeTasks(job.tasks);
  job.status = wasPausing ? "paused" : nextJobStatus(job);
  job.nextAction = {
    label: job.status === "paused" ? { zh: "恢复任务", en: "Resume job" } : { zh: "继续执行任务", en: "Continue job" },
    href: "/build/execution"
  };
  appendJobEvent(state, job, {
    type: "job-repaired",
    taskKey: repairedTasks[0]?.key || "",
    status: job.status,
    label: { zh: wasPausing ? "任务已停在暂停状态" : "任务可继续", en: wasPausing ? "Job paused" : "Job resumable" },
    message: {
      zh: wasPausing
        ? "检测到上次服务在暂停过程中中断，已保存进度并停在暂停状态。"
        : "检测到上次服务在执行过程中中断，已保存进度并恢复为可继续状态。",
      en: wasPausing
        ? "The previous service stopped while pausing. Progress was kept and the job is paused."
        : "The previous service stopped while running. Progress was kept and the job is ready to continue."
    },
    detail: {
      repairedTaskKeys: repairedTasks.map((item) => item.key),
      previousStatus,
      repairedAt: now
    }
  });
  return true;
}
function readPersistedJobStore(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return { latestJobId: null, jobs: new Map() };
  const db = openCatalogDatabase(state, knowledgeBaseId);
  const jobs = new Map();
  try {
    const latestJobId = db.prepare("SELECT value FROM catalog_state WHERE key = 'latestJobId'").get()?.value || null;
    for (const row of db.prepare("SELECT job_json FROM jobs ORDER BY created_at ASC, job_id ASC").all()) {
      const job = parseJson(row.job_json, null);
      if (job?.id) jobs.set(job.id, job);
    }
    return {
      latestJobId,
      jobs
    };
  } finally {
    db.close();
  }
}

function persistJobStore(state) {
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  if (!knowledgeBaseId) return;
  const jobs = state.jobs instanceof Map ? state.jobs : new Map();
  const db = openCatalogDatabase(state, knowledgeBaseId);
  const records = [...jobs.values()].map((job) => ({
    ...job,
    draft: sanitizeDraft(job.draft || {})
  }));
  try {
    const write = db.transaction(() => {
      db.prepare("DELETE FROM task_steps").run();
      db.prepare("DELETE FROM jobs").run();
      db.prepare("DELETE FROM artifact_registry WHERE owner_type = 'job'").run();
      for (const job of records) writeJobToCatalog(db, job);
      db.prepare(`
        INSERT INTO catalog_state (key, value, updated_at)
        VALUES ('latestJobId', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(state.latestJobId || "", nowIso());
    });
    write();
  } finally {
    db.close();
  }

  const latest = state.latestJobId ? jobs.get(state.latestJobId) : null;
  if (latest) {
    touchKnowledgeBaseById(state, latest.knowledgeBaseId || latest.knowledgeBase?.id || knowledgeBaseId, {
      latestJobId: latest.id,
      latestJobStatus: latest.status || "",
      mode: latest.mode || "",
      template: latest.template || "",
      sourceRoot: latest.summary?.sourceRoot || "",
      workspaceRoot: latest.summary?.baseWorkspaceRoot || latest.summary?.workspaceRoot || "",
      taskSummary: latest.progress || summarizeTasks(latest.tasks || [])
    });
  }
}

function writeJobToCatalog(db, job) {
  const createdAt = job.createdAt || nowIso();
  const updatedAt = job.updatedAt || createdAt;
  db.prepare(`
    INSERT INTO jobs (job_id, status, mode, template, summary_json, progress_json, job_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    String(job.status || ""),
    String(job.mode || ""),
    String(job.template || ""),
    stableJson(job.summary || {}),
    stableJson(job.progress || summarizeTasks(job.tasks || [])),
    stableJson(job),
    createdAt,
    updatedAt
  );

  const insertStep = db.prepare(`
    INSERT INTO task_steps (job_id, step_key, sort_order, status, label_json, message_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [index, taskItem] of (job.tasks || []).entries()) {
    insertStep.run(
      job.id,
      String(taskItem.key || `step-${index}`),
      index,
      String(taskItem.status || ""),
      stableJson(taskItem.label || {}),
      stableJson(taskItem.message || {}),
      taskItem.updatedAt || updatedAt
    );
  }
  syncJobArtifactsToCatalog(db, job);
  syncJobBuildVersionToCatalog(db, job);
}

function syncJobBuildVersionToCatalog(db, job) {
  const buildId = String(job.datasetVersionId || job.summary?.datasetVersionId || "").trim();
  if (!buildId) return;
  const activeManifestPath = findJobArtifactPath(job, "activeManifest");
  const activeManifest = readJson(activeManifestPath, null);
  if (!activeManifest && shouldPreserveExistingCatalogRelease(db, buildId)) return;
  const status = buildVersionStatus(job, activeManifest);
  const active = status === "active" ? 1 : 0;
  const createdAt = job.createdAt || nowIso();
  const updatedAt = job.updatedAt || createdAt;
  if (active && activeManifestPath) {
    publishBuildVersionToCatalog(db, {
      buildId,
      releaseId: `${buildId}:active`,
      manifestPath: activeManifestPath,
      manifest: activeManifest,
      buildSummary: buildVersionSummary(job, activeManifest),
      releaseSummary: releaseManifestSummary(job, activeManifest),
      qualityGates: { requireActiveRecords: true, allowReviewRecords: true }
    });
    return;
  }
  if (active) {
    db.prepare("UPDATE build_versions SET active = 0 WHERE build_id <> ?").run(buildId);
  }
  db.prepare(`
    INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(build_id) DO UPDATE SET
      status = excluded.status,
      active = excluded.active,
      summary_json = excluded.summary_json,
      updated_at = excluded.updated_at
  `).run(
    buildId,
    status,
    active,
    "",
    stableJson(buildVersionSummary(job, activeManifest)),
    createdAt,
    updatedAt
  );

  if (!activeManifestPath) return;
  db.prepare(`
    INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      build_id = excluded.build_id,
      status = excluded.status,
      manifest_path = excluded.manifest_path,
      summary_json = excluded.summary_json,
      updated_at = excluded.updated_at
  `).run(
    `${buildId}:active`,
    buildId,
    active ? "active" : "draft",
    activeManifestPath,
    stableJson(releaseManifestSummary(job, activeManifest)),
    createdAt,
    updatedAt
  );
}

function shouldPreserveExistingCatalogRelease(db, buildId) {
  const row = db.prepare(`
    SELECT
      b.status AS build_status,
      b.active,
      r.status AS release_status
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
    WHERE b.build_id = ?
    LIMIT 1
  `).get(buildId);
  if (!row) return false;
  if (Number(row.active) === 1 || row.build_status === "active") return true;
  return new Set(["active", "published", "ready"]).has(String(row.release_status || ""));
}

function buildVersionStatus(job, activeManifest) {
  if (job.status === "completed" && activeManifest?.status === "active") return "active";
  if (job.status === "failed") return "failed";
  if (job.status === "paused" || job.status === "pausing") return "paused";
  if (job.status === "stopped") return "stopped";
  return "draft";
}

function buildVersionSummary(job, activeManifest) {
  return {
    job: {
      id: job.id || "",
      mode: job.mode || "",
      template: job.template || "",
      status: job.status || ""
    },
    knowledgeBase: {
      id: job.knowledgeBaseId || job.knowledgeBase?.id || ""
    },
    datasetVersionId: job.datasetVersionId || "",
    workspaceRoot: job.summary?.workspaceRoot || "",
    progress: job.progress || summarizeTasks(job.tasks || []),
    target: activeManifest?.target || null,
    quality: activeManifest?.quality || null,
    activeVersions: Array.isArray(activeManifest?.activeVersions) ? activeManifest.activeVersions.length : 0
  };
}

function releaseManifestSummary(job, activeManifest) {
  return {
    job: {
      id: job.id || "",
      mode: job.mode || "",
      template: job.template || ""
    },
    knowledgeBase: activeManifest?.knowledgeBase || { id: job.knowledgeBaseId || job.knowledgeBase?.id || "" },
    datasetVersionId: activeManifest?.datasetVersionId || job.datasetVersionId || "",
    target: activeManifest?.target || null,
    sidecar: activeManifest?.sidecar || null,
    quality: activeManifest?.quality || null,
    activeVersions: activeManifest?.activeVersions || []
  };
}

function findJobArtifactPath(job, key) {
  return String((job.artifacts || []).find((item) => item.key === key && item.path)?.path || "");
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function normalizeJobProgress(state, job) {
  if (!job || !Array.isArray(job.tasks)) return;
  const migrated = migrateLegacyAliyunContinuationJob(job) || migrateLegacyAliyunFailedCloudJob(job);
  const normalized = summarizeTasks(job.tasks);
  const current = job.progress || {};
  const keys = ["total", "completed", "waiting", "running", "blocked", "failed", "skipped", "stopped"];
  const progressChanged = keys.some((key) => Number(current[key] || 0) !== Number(normalized[key] || 0));
  if (!migrated && !progressChanged) return;
  job.progress = normalized;
  persistJobStore(state);
}

function migrateLegacyAliyunContinuationJob(job) {
  if (job.mode !== "aliyun" || job.status !== "completed" || !Array.isArray(job.tasks)) return false;
  const resumableCloudTasks = job.tasks.filter((item) => cloudTaskKeys.has(item.key) && (item.status === "blocked" || item.status === "skipped"));
  if (!resumableCloudTasks.length) return false;

  for (const item of resumableCloudTasks) {
    item.status = "waiting";
    item.message = legacyCloudContinuationMessage(item.key, item.message);
  }

  job.status = "waiting";
  job.updatedAt = new Date().toISOString();
  job.nextAction = {
    label: { zh: "继续执行任务", en: "Continue job" },
    href: "/build/execution"
  };
  return true;
}

function legacyCloudContinuationMessage(key, fallback = {}) {
  const messages = {
    upload: {
      zh: "继续上传资料。",
      en: "Continue by uploading sources."
    },
    ocr: {
      zh: "继续 OCR 识别。",
      en: "Continue OCR recognition."
    },
    embedding: {
      zh: "继续生成检索数据。",
      en: "Continue creating search data."
    },
    index: {
      zh: "继续写入知识库。",
      en: "Continue writing the knowledge base."
    }
  };
  return messages[key] || fallback;
}

function migrateLegacyAliyunFailedCloudJob(job) {
  if (job.mode !== "aliyun" || job.status !== "failed" || !Array.isArray(job.tasks)) return false;
  const firstLegacyIndex = job.tasks.findIndex(isLegacyUnavailableCloudFailure);
  if (firstLegacyIndex < 0) return false;

  const resetKeys = new Set();
  for (let index = firstLegacyIndex; index < job.tasks.length; index += 1) {
    const item = job.tasks[index];
    if (!cloudTaskKeys.has(item.key) || item.status === "completed") continue;
    if (!["failed", "waiting", "blocked", "skipped"].includes(item.status)) continue;
    item.status = "waiting";
    item.message = legacyCloudContinuationMessage(item.key, item.message);
    resetKeys.add(item.key);
  }
  if (!resetKeys.size) return false;

  job.status = "waiting";
  job.updatedAt = new Date().toISOString();
  job.failures = (job.failures || []).filter((item) => !resetKeys.has(item.key));
  job.recovery = (job.recovery || []).filter((item) => !legacyCloudFailureText(localizedFailureMessage(item.message)));
  job.nextAction = {
    label: { zh: "继续执行任务", en: "Continue job" },
    href: "/build/execution"
  };
  return true;
}

function isLegacyUnavailableCloudFailure(item = {}) {
  if (!cloudTaskKeys.has(item.key) || item.status !== "failed") return false;
  return legacyCloudUnavailableText(localizedFailureMessage(item.message));
}

function legacyCloudUnavailableText(text = "") {
  return /真实执行器还没有接入|不会把这一步假装成已完成|当前缺少可执行配置|当前缺少可用的写入连接/.test(String(text));
}

function legacyCloudFailureText(text = "") {
  return legacyCloudUnavailableText(text) || /没有找到处理输入清单|请先完成上传资料/.test(String(text));
}

function localizedFailureMessage(message = {}) {
  if (typeof message === "string") return message;
  return [message.zh, message.en].filter(Boolean).join(" ");
}
function summarizeTasks(tasks) {
  const actionableTasks = tasks.filter((item) => item.status !== "skipped");
  return {
    total: actionableTasks.length,
    completed: actionableTasks.filter((item) => item.status === "completed").length,
    waiting: actionableTasks.filter((item) => item.status === "waiting").length,
    running: actionableTasks.filter((item) => item.status === "running").length,
    blocked: actionableTasks.filter((item) => item.status === "blocked").length,
    failed: actionableTasks.filter((item) => item.status === "failed").length,
    skipped: tasks.filter((item) => item.status === "skipped").length,
    stopped: actionableTasks.filter((item) => item.status === "stopped").length
  };
}

function mergeArtifacts(existing, created) {
  const byKey = new Map(existing.map((item) => [`${item.key}:${item.path}`, item]));
  for (const item of created) byKey.set(`${item.key}:${item.path}`, item);
  return [...byKey.values()];
}

function sanitizeDraft(draft) {
  return Object.fromEntries(Object.entries(draft || {}).filter(([key]) => !/secret|token|password/i.test(key)));
}

function advanceExecutionPlan(plan, taskKey, completeAll = false) {
  if (!plan?.stages) return plan;
  const targetStageKeys = stageKeysForTask(taskKey);
  const stages = plan.stages.map((stage) => {
    if (!completeAll && !targetStageKeys.includes(stage.key)) return stage;
    if (stage.status === "skipped" || stage.status === "blocked") return stage;
    const nextStatus = "completed";
    return {
      ...stage,
      status: nextStatus,
      validationStatus: "passed",
      rounds: stage.rounds.map((round) => {
        if (round.status === "skipped" || round.status === "blocked") return round;
        return {
          ...round,
          status: nextStatus,
          validationStatus: round.validationStatus === "not_needed" ? "not_needed" : "passed"
        };
      })
    };
  });
  return {
    ...plan,
    summary: summarizeStages(stages),
    stages
  };
}

function stageKeysForTask(taskKey) {
  return {
    merge: ["scan"],
    pages: ["text"],
    clean: ["clean", "chunk", "citation"],
    report: ["validation"]
  }[taskKey] || [taskKey];
}

function nextJobStatus(job) {
  if (job.tasks.some((item) => item.status === "waiting")) return "waiting";
  if (job.tasks.some((item) => item.status === "running")) return "running";
  if (job.tasks.some((item) => item.status === "failed")) return "failed";
  return "completed";
}

function markTaskRunning(state, job, taskItem) {
  activeJobIds.add(job.id);
  const now = new Date().toISOString();
  taskItem.status = "running";
  taskItem.startedAt = now;
  taskItem.message = {
    zh: `正在${taskItem.label.zh}。`,
    en: `Running ${taskItem.label.en}.`
  };
  job.status = "running";
  job.updatedAt = now;
  job.progress = summarizeTasks(job.tasks);
  appendJobEvent(state, job, {
    type: "step-start",
    taskKey: taskItem.key,
    status: "running",
    label: taskItem.label,
    message: taskItem.message
  });
  job.failures = (job.failures || []).filter((item) => item.key !== taskItem.key);
  job.recovery = (job.recovery || []).filter((item) => item.key !== taskItem.key);
  persistJobStore(state);
}

function nextExecutableTask(job) {
  if (job.status === "failed") {
    const failed = job.tasks.find((item) => item.status === "failed");
    if (failed) return failed;
  }
  return job.tasks.find((item) => item.status === "waiting");
}

function createJobLogger(state, job, taskItem) {
  return (event = {}) => {
    appendJobEvent(state, job, {
      type: event.type || "task-detail",
      taskKey: event.taskKey || taskItem?.key || "",
      status: event.status || "running",
      label: event.label || taskItem?.label || { zh: "任务进度", en: "Job progress" },
      message: event.message || { zh: "任务正在处理。", en: "The job is processing." },
      detail: event.detail || null
    });
    job.updatedAt = new Date().toISOString();
    job.progress = summarizeTasks(job.tasks);
    persistJobStore(state);
  };
}
function appendJobEvent(state, job, event = {}) {
  const events = Array.isArray(job.events) ? job.events : [];
  const timestamp = new Date().toISOString();
  const sequence = Number(job.eventSequence || 0) + 1;
  job.eventSequence = sequence;
  const record = {
    id: `${timestamp}-${sequence}`,
    sequence,
    timestamp,
    type: event.type || "job-event",
    taskKey: event.taskKey || "",
    status: event.status || "info",
    label: event.label || { zh: "任务事件", en: "Job event" },
    message: event.message || { zh: "任务状态已更新。", en: "The job state was updated." },
    ...(event.detail && typeof event.detail === "object" ? { detail: event.detail } : {})
  };
  job.events = [...events, record].slice(-200);
  writeDurableJobEvent(state, job, record);
  writeJobCheckpoint(state, job, record);
}

function writeInitialJobRecords(state, job) {
  appendJobEvent(state, job, {
    type: "job-created",
    status: job.status || "waiting",
    label: { zh: "任务已创建", en: "Job created" },
    message: { zh: "任务已创建，后续步骤会按顺序记录。", en: "The job was created and every step will be recorded." }
  });
  for (const taskItem of job.tasks || []) {
    appendJobEvent(state, job, {
      type: "task-initialized",
      taskKey: taskItem.key,
      status: taskItem.status || "waiting",
      label: taskItem.label || { zh: taskItem.key, en: taskItem.key },
      message: taskItem.message || { zh: "步骤已加入任务。", en: "The step was added to the job." }
    });
  }
}

function writeDurableJobEvent(state, job, record) {
  const file = path.join(jobExecutionRoot(state, job), "events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

function writeJobCheckpoint(state, job, event) {
  const taskKey = event.taskKey || "job";
  const taskItem = (job.tasks || []).find((item) => item.key === taskKey) || null;
  const checkpoint = {
    kind: "knowmesh.jobTaskCheckpoint",
    apiVersion: "v1",
    updatedAt: event.timestamp || new Date().toISOString(),
    job: {
      id: job.id,
      status: job.status,
      mode: job.mode,
      template: job.template,
      progress: job.progress || summarizeTasks(job.tasks || []),
      ...(job.kind === "knowmesh.targetedRerunJob" ? {
        targetedRerun: {
          target: job.targetedRerun?.target || {},
          scope: publicRerunScope(job.targetedRerun?.rerunScope || {})
        }
      } : {})
    },
    task: taskItem ? {
      key: taskItem.key,
      status: taskItem.status,
      label: taskItem.label,
      message: taskItem.message,
      startedAt: taskItem.startedAt || null,
      completedAt: taskItem.completedAt || null,
      artifacts: taskItem.artifacts || []
    } : {
      key: taskKey,
      status: event.status || "info",
      label: event.label,
      message: event.message,
      artifacts: []
    },
    event
  };
  writeJson(path.join(jobExecutionRoot(state, job), "checkpoints", `${safeFileSegment(taskKey)}.checkpoint.json`), checkpoint);
  writeJson(path.join(jobExecutionRoot(state, job), "latest.checkpoint.json"), checkpoint);
}

function jobExecutionRoot(state, job) {
  const workspaceRoot = job.summary?.workspaceRoot || job.draft?.["project.workspace"] || "";
  if (workspaceRoot) return path.join(workspaceRoot, "artifacts", "execution", "jobs", safeFileSegment(job.id || "latest"));
  const knowledgeBaseId = job.knowledgeBaseId || job.knowledgeBase?.id || currentKnowledgeBaseId(state);
  return path.join(knowledgeBaseDataRoot(state, knowledgeBaseId), "artifacts", "execution", "jobs", safeFileSegment(job.id || "latest"));
}

function safeFileSegment(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function nextTestableTask(job) {
  return job.tasks.find((item) => ["waiting", "running"].includes(item.status))
    || job.tasks.find((item) => item.status === "completed");
}

function summarizeStages(stages) {
  const rounds = stages.flatMap((item) => item.rounds || []);
  return {
    totalStages: stages.length,
    totalRounds: rounds.length,
    completedRounds: rounds.filter((item) => item.status === "completed").length,
    waitingRounds: rounds.filter((item) => item.status === "waiting").length,
    blockedRounds: rounds.filter((item) => item.status === "blocked").length,
    skippedRounds: rounds.filter((item) => item.status === "skipped").length,
    passedChecks: rounds.filter((item) => item.validationStatus === "passed").length,
    pendingChecks: rounds.filter((item) => item.validationStatus === "pending" || item.validationStatus === "needs_review").length
  };
}

function task(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function jobCheck(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function blocker(key, step, zhMessage, enMessage) {
  return {
    key,
    step,
    label: { zh: "需要处理", en: "Needs attention" },
    message: { zh: zhMessage, en: enMessage }
  };
}





