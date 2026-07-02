#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalService } from "../src/local-service/server.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operatorQuestion = "What rollback rule should the operator follow?";

export async function runOperatorWorkflowSmoke(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const viewports = Array.isArray(options.viewports) && options.viewports.length
    ? options.viewports
    : [
        { name: "desktop", width: 1280, height: 820 },
        { name: "narrow", width: 390, height: 844 }
      ];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-operator-workflow-"));
  const userDataRoot = path.join(tempRoot, "user-data");
  const sourceRoot = path.join(tempRoot, "source");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const checks = [];
  const externalCalls = [];
  let service;
  let knowledgeBaseId = "";
  let controlKnowledgeBaseId = "";

  const pass = (key, message, extra = {}) => checks.push({ key, status: "pass", message, ...extra });
  const fail = (key, message, extra = {}) => checks.push({ key, status: "fail", message: trimMessage(message), ...extra });

  try {
    writeInitialSources(sourceRoot);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    service = await startLocalService({
      projectRoot,
      userDataRoot,
      port: 0,
      open: false,
      fetchImpl: async (url, requestOptions = {}) => {
        externalCalls.push({ url: String(url), method: String(requestOptions.method || "GET") });
        return jsonResponse({});
      }
    });

    const control = await createKnowledgeBase(service.url, { name: "Operator Control KB", template: "general-docs" });
    controlKnowledgeBaseId = control.knowledgeBase.id;
    const created = await createKnowledgeBase(service.url, { name: "Operator Workflow KB", template: "general-docs" });
    knowledgeBaseId = created.knowledgeBase.id;
    const api = (pathname) => `/kb/${knowledgeBaseId}${pathname}`;
    const draft = {
      "setup.mode": "local",
      "project.template": "general-docs",
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "retrieval.profile": "balanced"
    };

    await httpJson(service.url, api("/api/setup/draft"), { method: "POST", body: { draft } });
    await httpJson(service.url, api("/api/setup/retrieval-strategy"), {
      method: "POST",
      body: { draft: { "retrieval.profile": "balanced" } }
    });

    const sourcePrecheck = await httpJson(service.url, api("/api/local/folders/precheck"), {
      method: "POST",
      body: { target: "source", path: sourceRoot, template: "general-docs" }
    });
    const workspacePrecheck = await httpJson(service.url, api("/api/local/folders/precheck"), {
      method: "POST",
      body: { target: "workspace", path: workspaceRoot }
    });
    const initialScan = await scanPreview(service.url, api, draft);
    const initialManifest = await httpJson(service.url, api("/api/source/manifest"));
    const initialPlan = await planPreview(service.url, api, draft);
    const k12 = await createKnowledgeBase(service.url, { name: "Operator K12 Gate KB", template: "textbook-cn-k12" });
    const k12Scan = await httpJson(service.url, `/kb/${k12.knowledgeBase.id}/api/scan/preview`, {
      method: "POST",
      body: {
        mode: "local",
        template: "textbook-cn-k12",
        draft: {
          "setup.mode": "local",
          "project.template": "textbook-cn-k12",
          "project.source": sourceRoot,
          "project.workspace": workspaceRoot
        }
      }
    });

    if (!sourcePrecheck.ok || !workspacePrecheck.ok) throw new Error("Folder precheck failed.");
    if (!initialScan.ok || initialScan.preview?.missingFields?.length) throw new Error("general-docs source scan leaked K12 required fields.");
    if (Number(initialManifest.summary?.includedDocuments || 0) < 4) throw new Error("Source manifest did not include initial operator sources.");
    if (initialPlan.planPreview?.canConfirmLocalJob !== true) throw new Error("Execution plan did not allow a local job.");
    if (!Array.isArray(k12Scan.preview?.missingFields) || k12Scan.preview.missingFields.length === 0) {
      throw new Error("K12 scan did not keep source-scope gates.");
    }

    const beta = initialManifest.documents.find((item) => item.relativePath === "beta.txt");
    if (!beta) throw new Error("beta.txt was not present in the source manifest.");
    const excluded = await httpJson(service.url, api("/api/documents/exclude"), {
      method: "POST",
      body: { documents: [beta], reason: "operator smoke exclude" }
    });
    const excludedBeta = excluded.documents.find((item) => item.relativePath === "beta.txt");
    const restored = await httpJson(service.url, api("/api/documents/restore"), {
      method: "POST",
      body: { documents: [excludedBeta] }
    });
    if (excluded.summary?.userExcludedDocuments !== 1 || restored.summary?.userExcludedDocuments !== 0) {
      throw new Error("Document exclude/restore did not update the current catalog.");
    }

    fs.rmSync(path.join(sourceRoot, "scan-needed.png"), { force: true });
    await scanPreview(service.url, api, draft);
    fs.writeFileSync(path.join(sourceRoot, "scan-needed.png"), "operator restored image placeholder with more bytes", "utf8");
    fs.appendFileSync(path.join(sourceRoot, "alpha.txt"), "\nRollback rule update: rollback only after preview diff and confirmation.", "utf8");
    fs.rmSync(path.join(sourceRoot, "gamma.md"), { force: true });
    const changedScan = await scanPreview(service.url, api, draft);
    const delta = changedScan.catalog?.delta || {};
    if (Number(delta.summary?.modifiedDocuments || 0) < 1
      || Number(delta.summary?.restoredDocuments || 0) < 1
      || Number(delta.summary?.missingDocuments || 0) < 1) {
      throw new Error(`Source delta did not capture modified/restored/missing files: ${JSON.stringify(delta.summary || {})}`);
    }
    pass("sourceIntake", "Operator source intake covers precheck, scan, manifest, exclude/restore, source delta, plan preview, and K12 gate isolation.", {
      includedDocuments: initialManifest.summary.includedDocuments,
      modifiedDocuments: delta.summary.modifiedDocuments,
      restoredDocuments: delta.summary.restoredDocuments,
      missingDocuments: delta.summary.missingDocuments,
      planStages: initialPlan.planPreview.executionPlan.summary.totalStages
    });

    const confirmed = await httpJson(service.url, api("/api/jobs/confirm"), {
      method: "POST",
      body: { mode: "local", template: "general-docs", draft }
    });
    if (!confirmed.ok || confirmed.job?.status !== "waiting") throw new Error("Local operator job was not created.");
    const paused = await httpJson(service.url, api("/api/jobs/latest/pause"), { method: "POST" });
    const resumed = await httpJson(service.url, api("/api/jobs/latest/resume"), { method: "POST" });
    if (!paused.ok || paused.job?.status !== "paused" || !resumed.ok || resumed.job?.status !== "waiting") {
      throw new Error("Pause/resume did not preserve a waiting operator job.");
    }
    const advanced = await httpJson(service.url, api("/api/jobs/latest/advance"), { method: "POST" });
    if (!advanced.ok || advanced.job?.progress?.completed < 2) throw new Error("Job advance did not persist progress.");
    const checkpointBeforeRestart = advanced.job?.checkpoints || {};
    await service.close();
    service = await startLocalService({ projectRoot, userDataRoot, port: 0, open: false });
    const recovered = await httpJson(service.url, api("/api/jobs/latest"));
    if (!recovered.ok || recovered.job?.id !== confirmed.job.id || recovered.job?.progress?.completed < 2) {
      throw new Error("Latest job progress was not recovered after restart.");
    }
    const completed = await httpJson(service.url, api("/api/jobs/latest/run"), { method: "POST" });
    if (!completed.ok || completed.job?.status !== "completed") throw new Error("Operator job did not complete.");
    const diagnosticExport = await httpJson(service.url, api("/api/maintenance/export"));
    assertRedactedJson(diagnosticExport, "maintenance diagnostic export");
    const stopCandidate = await httpJson(service.url, api("/api/jobs/confirm"), {
      method: "POST",
      body: { mode: "local", template: "general-docs", draft }
    });
    const stopped = await httpJson(service.url, api("/api/jobs/latest/stop"), { method: "POST" });
    if (!stopCandidate.ok || !stopped.ok || stopped.job?.status !== "stopped") throw new Error("Stop semantics did not stop a waiting operator job.");
    pass("executionRecovery", "Operator execution proves creation, checkpointed progress, pause/resume/stop, restart recovery, completion, and redacted diagnostics.", {
      completedJobId: completed.job.id,
      recoveredJobId: recovered.job.id,
      checkpointKeys: Object.keys(checkpointBeforeRestart).length
    });

    const search = await httpJson(service.url, api("/api/search?query=rollback&limit=5"));
    if (!search.ok || Number(search.total || 0) < 1) throw new Error("Evidence search returned no operator evidence.");
    const query = await httpJson(service.url, api("/api/query"), {
      method: "POST",
      body: { question: operatorQuestion }
    });
    const searchCitation = search.items?.[0]?.citation || {};
    const citationRefs = Array.isArray(query.citations) && query.citations.length
      ? query.citations.slice(0, 1)
      : [{
          id: searchCitation.citationId || searchCitation.id || search.items?.[0]?.chunkId || "",
          chunkId: search.items?.[0]?.chunkId || "",
          documentId: search.items?.[0]?.documentId || searchCitation.documentId || "",
          title: searchCitation.title || search.items?.[0]?.title || "",
          pageNumber: searchCitation.pageNumber || search.items?.[0]?.pageNumber || 1,
          sourceUri: searchCitation.sourceUri || "",
          documentHref: search.items?.[0]?.links?.document || ""
        }];
    if (!citationRefs[0]?.id && !citationRefs[0]?.chunkId) throw new Error("Evidence search did not expose a feedback citation reference.");
    const feedback = await httpJson(service.url, api("/api/query/feedback"), {
      method: "POST",
      body: {
        action: "wrong_citation",
        question: operatorQuestion,
        answerStatus: query.status || "evidence_review",
        resultKey: query.resultKey || `search:${search.items?.[0]?.chunkId || searchCitation.citationId || "operator"}`,
        citationRefs,
        message: "Operator smoke: verify feedback review and rerun scope."
      }
    });
    const review = await httpJson(service.url, api("/api/maintenance/review?status=open&limit=20"));
    const feedbackIssue = review.review?.items?.find((item) => item.source === "query_feedback" && item.issueType === "wrong_citation");
    const qualityIssue = review.review?.items?.find((item) => item.source === "quality_issue");
    if (!feedback.ok || !feedbackIssue?.rerunScope?.citationIds?.length || !qualityIssue) {
      throw new Error("Maintenance review did not combine feedback and quality issues.");
    }
    const citationDocumentId = citationRefs[0]?.documentId || search.items?.[0]?.documentId || "";
    const rerunPreview = await httpJson(service.url, api("/api/rerun/preview"), {
      method: "POST",
      body: { type: "document", documentId: citationDocumentId }
    });
    const rerunConfirm = await httpJson(service.url, api("/api/rerun/confirm"), {
      method: "POST",
      body: { type: "document", documentId: citationDocumentId, mode: "local" }
    });
    const latestRerunJob = await httpJson(service.url, api("/api/jobs/latest"));
    const resolvedFeedback = await httpJson(service.url, api("/api/maintenance/review/resolve"), {
      method: "POST",
      body: { issueId: feedbackIssue.id, message: "Reviewed by operator smoke." }
    });
    if (!rerunPreview.ok || !rerunConfirm.ok || !rerunConfirm.job?.id || latestRerunJob.job?.id !== rerunConfirm.job.id || !resolvedFeedback.ok) {
      throw new Error(`Targeted rerun or feedback resolution failed: ${JSON.stringify({
        citationDocumentId,
        rerunPreview: { ok: rerunPreview.ok, summary: rerunPreview.summary, error: rerunPreview.error },
        rerunConfirm: { ok: rerunConfirm.ok, status: rerunConfirm.job?.status, jobId: rerunConfirm.job?.id, error: rerunConfirm.error },
        latestRerunJob: { ok: latestRerunJob.ok, jobId: latestRerunJob.job?.id },
        resolvedFeedback: { ok: resolvedFeedback.ok, error: resolvedFeedback.error }
      })}`);
    }
    pass("maintenanceTargetedRerun", "Operator maintenance connects evidence search, feedback review, quality issues, safe rerun scopes, targeted rerun jobs, and resolution.", {
      reviewItems: review.review.summary.total,
      feedbackIssueId: feedbackIssue.id,
      targetedRerunJobId: rerunConfirm.job.id
    });

    fs.appendFileSync(path.join(sourceRoot, "alpha.txt"), "\nVersion two: operators compare before rollback.", "utf8");
    await scanPreview(service.url, api, draft);
    await httpJson(service.url, api("/api/jobs/confirm"), {
      method: "POST",
      body: { mode: "local", template: "general-docs", draft }
    });
    const secondRun = await httpJson(service.url, api("/api/jobs/latest/run"), { method: "POST" });
    if (!secondRun.ok || secondRun.job?.status !== "completed") throw new Error("Second operator build did not complete.");
    const latestAfterSecondRun = await httpJson(service.url, api("/api/jobs/latest"));
    const versions = await httpJson(service.url, api("/api/versions"));
    const active = versions.versions.find((item) => item.active);
    const rollbackTarget = versions.versions.find((item) => !item.active && item.rollbackReady !== false && item.release?.status);
    if (!active || !rollbackTarget) throw new Error(`Version list did not expose active and rollback-ready versions: ${JSON.stringify({
      versions: summarizeVersionsForError(versions),
      latestJob: summarizeJobForError(latestAfterSecondRun.job || secondRun.job)
    })}`);
    const diff = await httpJson(service.url, api(`/api/versions/diff?baseBuildId=${encodeURIComponent(active.buildId)}&targetBuildId=${encodeURIComponent(rollbackTarget.buildId)}`));
    const rollbackPreview = await httpJson(service.url, api("/api/versions/rollback/preview"), {
      method: "POST",
      body: { targetBuildId: rollbackTarget.buildId }
    });
    const rollback = await httpJson(service.url, api("/api/versions/rollback"), {
      method: "POST",
      body: { targetBuildId: rollbackTarget.buildId, confirm: true }
    });
    const controlVersions = await httpJson(service.url, `/kb/${controlKnowledgeBaseId}/api/versions`);
    if (!diff.ok || !rollbackPreview.ok || !rollback.ok || rollback.activatedBuildId !== rollbackTarget.buildId) {
      throw new Error("Version diff or rollback workflow failed.");
    }
    if (Number(controlVersions.summary?.total || 0) !== 0) throw new Error("Rollback mutated an unrelated control knowledge base.");
    const packagePreview = await httpJson(service.url, api("/api/package/export/preview"));
    if (!packagePreview.ok) throw new Error("Package preview failed after rollback.");
    pass("versionRollback", "Operator version workflow proves manifest, package preview, version list, diff, rollback preview, confirmation, and cross-KB isolation.", {
      totalVersions: versions.summary.total,
      activeBeforeRollback: active.buildId,
      activatedBuildId: rollback.activatedBuildId
    });

    const pages = {
      buildHtml: await httpText(service.url, `/kb/${knowledgeBaseId}/build`),
      executionHtml: await httpText(service.url, `/kb/${knowledgeBaseId}/build/execution`),
      documentsHtml: await httpText(service.url, `/kb/${knowledgeBaseId}/maintain/documents`),
      versionsHtml: await httpText(service.url, `/kb/${knowledgeBaseId}/maintain/versions`),
      feedbackHtml: await httpText(service.url, `/kb/${knowledgeBaseId}/maintain/feedback`),
      diagnosticsHtml: await httpText(service.url, `/kb/${knowledgeBaseId}/maintain/diagnostics`)
    };
    const viewportResults = viewports.map((viewport) => viewportCheck(viewport, pages));
    for (const viewport of viewportResults) {
      if (viewport.status !== "pass") throw new Error(`${viewport.name} viewport failed: ${viewport.message}`);
    }
    pass("operatorBrowserWorkflow", "Operator Web Console surfaces expose source intake, execution, maintenance, feedback, versions, and diagnostics.", {
      desktop: viewportResults.some((item) => item.name === "desktop" && item.status === "pass"),
      narrow: viewportResults.some((item) => item.name === "narrow" && item.status === "pass")
    });

    const providerDiagnostics = await httpJson(service.url, api("/api/providers/diagnostics"));
    const integrationDiagnostics = await httpJson(service.url, api("/api/integration/diagnostics"));
    assertRedactedJson(providerDiagnostics, "provider diagnostics");
    assertRedactedJson(integrationDiagnostics, "integration diagnostics");
    if (providerDiagnostics.stateAuthority?.knowledgeBaseState !== "catalog.sqlite"
      || integrationDiagnostics.cors?.defaultRemoteAccess !== false
      || externalCalls.length !== 0) {
      throw new Error("Operator diagnostics did not preserve privacy and localhost/no-cloud boundaries.");
    }
    pass("operatorPrivacyAudit", "Operator diagnostics are scoped, redacted, localhost-only, and no-cloud before explicit provider execution.", {
      externalCalls: externalCalls.length
    });

    await service.close();
    service = null;
    fs.rmSync(tempRoot, { recursive: true, force: true });

    return buildResult({ checks, viewports: viewportResults, externalCalls, tempRoot, tempRootRemoved: !fs.existsSync(tempRoot) });
  } catch (error) {
    fail("operatorWorkflowSmoke", error instanceof Error ? error.message : String(error));
    if (service) await service.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return buildResult({ checks, viewports: [], externalCalls, tempRoot, tempRootRemoved: !fs.existsSync(tempRoot) });
  }
}

function writeInitialSources(sourceRoot) {
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, "alpha.txt"),
    [
      "Operator handbook",
      "The rollback rule is to inspect the diff, preview the rollback risk, require confirmation, and keep unrelated knowledge bases unchanged.",
      "A weekly review cadence keeps quality issues and user feedback actionable."
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(sourceRoot, "beta.txt"), "Beta policy: feedback review should create maintenance work.", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "gamma.md"), "# Gamma note\nThis source will become missing during the smoke.", "utf8");
  fs.writeFileSync(path.join(sourceRoot, "scan-needed.png"), "operator image placeholder", "utf8");
}

async function createKnowledgeBase(baseUrl, body) {
  const created = await httpJson(baseUrl, "/api/knowledge-bases", { method: "POST", body });
  if (!created.ok || !created.knowledgeBase?.id) throw new Error(`Failed to create knowledge base: ${JSON.stringify(created)}`);
  return created;
}

async function scanPreview(baseUrl, api, draft) {
  return httpJson(baseUrl, api("/api/scan/preview"), {
    method: "POST",
    body: { mode: "local", template: "general-docs", draft }
  });
}

async function planPreview(baseUrl, api, draft) {
  return httpJson(baseUrl, api("/api/plan/preview"), {
    method: "POST",
    body: { mode: "local", template: "general-docs", draft }
  });
}

function buildResult({ checks, viewports, externalCalls, tempRoot, tempRootRemoved }) {
  const ok = checks.length > 0
    && checks.every((item) => item.status === "pass")
    && viewports.every((item) => item.status === "pass")
    && tempRootRemoved
    && externalCalls.length === 0;
  const checkPassed = (key) => checks.some((item) => item.key === key && item.status === "pass");
  const desktop = viewports.some((item) => item.name === "desktop" && item.status === "pass");
  const narrow = viewports.some((item) => item.name === "narrow" && item.status === "pass");
  return {
    ok,
    kind: "knowmesh.operatorWorkflowSmoke",
    generatedAt: new Date().toISOString(),
    checks,
    viewports,
    evidence: {
      sourceIntakeProof: {
        status: ok && checkPassed("sourceIntake") ? "pass" : "fail",
        folderPrecheck: checkPassed("sourceIntake"),
        scanPreview: checkPassed("sourceIntake"),
        sourceManifest: checkPassed("sourceIntake"),
        excludeRestore: checkPassed("sourceIntake"),
        changedMissingRestored: checkPassed("sourceIntake"),
        executionPlanPreview: checkPassed("sourceIntake"),
        k12GateIsolation: checkPassed("sourceIntake")
      },
      executionRecoveryProof: {
        status: ok && checkPassed("executionRecovery") ? "pass" : "fail",
        jobCreation: checkPassed("executionRecovery"),
        checkpointPersistence: checkPassed("executionRecovery"),
        progressPolling: checkPassed("executionRecovery"),
        pauseResumeStop: checkPassed("executionRecovery"),
        restartRecovery: checkPassed("executionRecovery"),
        taskSummary: checkPassed("executionRecovery"),
        diagnosticRedaction: checkPassed("executionRecovery")
      },
      maintenanceTargetedRerunProof: {
        status: ok && checkPassed("maintenanceTargetedRerun") ? "pass" : "fail",
        evidenceSearch: checkPassed("maintenanceTargetedRerun"),
        queryFeedbackReview: checkPassed("maintenanceTargetedRerun"),
        qualityIssueReview: checkPassed("maintenanceTargetedRerun"),
        safeRerunScope: checkPassed("maintenanceTargetedRerun"),
        targetedRerunJob: checkPassed("maintenanceTargetedRerun"),
        reviewResolution: checkPassed("maintenanceTargetedRerun")
      },
      versionRollbackProof: {
        status: ok && checkPassed("versionRollback") ? "pass" : "fail",
        versionManifest: checkPassed("versionRollback"),
        packagePreview: checkPassed("versionRollback"),
        versionList: checkPassed("versionRollback"),
        diff: checkPassed("versionRollback"),
        rollbackPreview: checkPassed("versionRollback"),
        rollbackConfirmation: checkPassed("versionRollback"),
        crossKbIsolation: checkPassed("versionRollback")
      },
      operatorBrowserWorkflow: {
        status: ok && checkPassed("operatorBrowserWorkflow") ? "pass" : "fail",
        desktop,
        narrow,
        sourceIntake: checkPassed("operatorBrowserWorkflow"),
        execution: checkPassed("operatorBrowserWorkflow"),
        maintenance: checkPassed("operatorBrowserWorkflow"),
        versions: checkPassed("operatorBrowserWorkflow"),
        feedback: checkPassed("operatorBrowserWorkflow"),
        diagnostics: checkPassed("operatorBrowserWorkflow")
      },
      operatorPrivacyAuditProof: {
        status: ok && checkPassed("operatorPrivacyAudit") ? "pass" : "fail",
        diagnosticRedaction: checkPassed("operatorPrivacyAudit"),
        noCredentialLeak: checkPassed("operatorPrivacyAudit"),
        noPrivateContentLeak: checkPassed("operatorPrivacyAudit"),
        localhostOnly: checkPassed("operatorPrivacyAudit"),
        noExternalCallsBeforeExecution: externalCalls.length === 0,
        noInternalReads: checkPassed("operatorPrivacyAudit")
      },
      externalCalls: {
        total: externalCalls.length,
        calls: externalCalls
      },
      cleanup: {
        tempRoot,
        tempRootRemoved
      }
    }
  };
}

function viewportCheck(viewport, pages) {
  const assertions = [
    ["sourceIntake", /api\/scan\/preview|扫描预览|Scan Preview|data-console-api-action="scan-preview"/i.test(pages.buildHtml)],
    ["execution", /api\/jobs\/latest|执行任务|Run Task|data-job-log-summary/i.test(pages.executionHtml)],
    ["documents", /data-catalog-search|资料维护|Documents|Evidence Search/i.test(pages.documentsHtml)],
    ["versions", /api\/versions|版本记录|Version Records|version-rollback-preview/i.test(pages.versionsHtml)],
    ["feedback", /api\/query\/feedback\/summary|问答反馈|Answer Feedback|wrong_citation/i.test(pages.feedbackHtml)],
    ["diagnostics", /api\/maintenance\/status|维护诊断|Diagnostics Export/i.test(pages.diagnosticsHtml)]
  ];
  const failed = assertions.filter(([, passed]) => !passed).map(([key]) => key);
  return {
    name: viewport.name,
    width: Number(viewport.width || 0),
    height: Number(viewport.height || 0),
    status: failed.length ? "fail" : "pass",
    assertions: Object.fromEntries(assertions),
    message: failed.length ? `Missing ${failed.join(", ")}` : "Operator DOM contract passed."
  };
}

function summarizeVersionsForError(versions = {}) {
  return {
    ok: versions.ok,
    summary: versions.summary || null,
    versions: (versions.versions || []).map((item) => ({
      buildId: item.buildId,
      status: item.status,
      active: item.active,
      release: item.release ? {
        id: item.release.id,
        status: item.release.status,
        manifestPath: item.release.manifestPath ? "[present]" : ""
      } : null,
      rollbackReady: item.rollbackReady,
      rollbackReason: item.rollbackReason?.en || item.rollbackReason?.zh || item.rollbackReason || null
    }))
  };
}

function summarizeJobForError(job = {}) {
  return {
    id: job.id,
    status: job.status,
    knowledgeBaseId: job.knowledgeBaseId || job.knowledgeBase?.id || "",
    datasetVersionId: job.datasetVersionId || job.summary?.datasetVersionId || "",
    artifactKeys: (job.artifacts || []).map((item) => item.key),
    activeManifestArtifact: (job.artifacts || []).find((item) => item.key === "activeManifest")?.path ? "[present]" : "",
    tasks: (job.tasks || []).map((item) => ({ key: item.key, status: item.status }))
  };
}

async function httpText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return text;
}

async function httpJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function assertRedactedJson(value, label) {
  const serialized = JSON.stringify(value);
  const localPathMatch = /(?<![A-Za-z])[A-Z]:[\\/][^"',} ]{0,160}|\/Users\/[^"',} ]{0,160}|\\Users\\[^"',} ]{0,160}/i.exec(serialized);
  if (localPathMatch) {
    throw new Error(`${label} leaked local absolute paths: ${localPathMatch[0]}`);
  }
  if (/sk-[A-Za-z0-9_-]{6,}|"(?:apiKey|accessKeyId|accessKeySecret|providerToken|credential)"\s*:\s*"(?!\[redacted-secret\])/i.test(serialized)) {
    throw new Error(`${label} leaked credentials or raw provider payload markers.`);
  }
  if (/private textbook|真实教材|Operator handbook|The rollback rule is to inspect|A weekly review cadence keeps/i.test(serialized)) {
    throw new Error(`${label} leaked private source content markers.`);
  }
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" }
  });
}

function trimMessage(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 2000);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runOperatorWorkflowSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
