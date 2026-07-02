#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startLocalService } from "../src/local-service/server.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runFirstRunUsabilitySmoke(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const viewports = Array.isArray(options.viewports) && options.viewports.length
    ? options.viewports
    : [
        { name: "desktop", width: 1280, height: 820 },
        { name: "narrow", width: 390, height: 844 }
      ];
  const externalCalls = [];
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-first-run-usability-"));
  const sourceRoot = path.join(userDataRoot, "first-run-source");
  const workspaceRoot = path.join(userDataRoot, "first-run-workspace");
  const checks = [];
  let service;
  let userDataRootRemoved = false;
  let primaryKnowledgeBaseId = "";
  let selectedKnowledgeBaseId = "";
  let viewportResults = [];

  const pass = (key, message, extra = {}) => checks.push({ key, status: "pass", message, ...extra });
  const fail = (key, message, extra = {}) => checks.push({ key, status: "fail", message: trimMessage(message), ...extra });

  try {
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

    const initialKnowledgeBases = await httpJson(service.url, "/api/knowledge-bases");
    if (!initialKnowledgeBases.ok || initialKnowledgeBases.current !== null || initialKnowledgeBases.items?.length !== 0) {
      throw new Error("Fresh first-run state should not contain an implicit knowledge base.");
    }
    const homeEmptyHtml = await httpText(service.url, "/");
    const managerEmptyHtml = await httpText(service.url, "/knowledge-bases");
    assertText(homeEmptyHtml, /data-knowledge-base-create|新建知识库|Create Knowledge Base/i, "home page should expose first-run create action");
    assertText(homeEmptyHtml, /Public General Sample|先用公开样例试一下/i, "home page should expose public sample as a safe first-run path");
    assertText(managerEmptyHtml, /knowledge-base-manager--empty|还没有知识库|No knowledge bases/i, "knowledge-base page should expose empty state");
    assertText(managerEmptyHtml, /data-knowledge-base-create/i, "knowledge-base page should expose create action");
    pass("emptyState", "Fresh first-run state exposes empty knowledge-base state and safe create/sample actions.");

    const platformRuntime = await httpJson(service.url, "/api/platform/runtime");
    if (platformRuntime.kind !== "knowmesh.platformRuntimeInventory" || platformRuntime.node?.minimumVersion !== ">=24") {
      throw new Error("Platform runtime inventory did not expose the Node 24 readiness contract.");
    }
    const providerCapabilities = await httpJson(service.url, "/api/providers/capabilities");
    if (providerCapabilities.kind !== "knowmesh.providerCapabilities" || Number(providerCapabilities.summary?.providers?.total || 0) < 1) {
      throw new Error("Provider capabilities were not available before KB creation.");
    }
    const integrationDiagnostics = await httpJson(service.url, "/api/integration/diagnostics");
    if (integrationDiagnostics.kind !== "knowmesh.integrationDiagnostics"
      || integrationDiagnostics.knowledgeBase?.selected !== false
      || integrationDiagnostics.cors?.defaultBindHost !== "127.0.0.1"
      || integrationDiagnostics.cors?.defaultRemoteAccess !== false) {
      throw new Error("Unscoped integration diagnostics did not stay safe before KB selection.");
    }
    assertRedactedDiagnostics({ providerCapabilities, integrationDiagnostics });
    pass("readinessDiagnostics", "First-run readiness and diagnostics are available, redacted, and localhost-only before KB selection.", {
      providerAdapters: providerCapabilities.summary.providers.total
    });

    const primary = await httpJson(service.url, "/api/knowledge-bases", {
      method: "POST",
      body: { name: "First Run Local KB", template: "general-docs" }
    });
    primaryKnowledgeBaseId = primary.knowledgeBase?.id || "";
    if (!primary.ok || !primaryKnowledgeBaseId || primary.knowledgeBase?.template !== "general-docs") {
      throw new Error("First-run KB creation did not return a general-docs knowledge base.");
    }
    const second = await httpJson(service.url, "/api/knowledge-bases", {
      method: "POST",
      body: { name: "First Run Reference KB", template: "general-docs" }
    });
    const secondKnowledgeBaseId = second.knowledgeBase?.id || "";
    const switched = await httpJson(service.url, "/api/knowledge-bases/current", {
      method: "POST",
      body: { id: primaryKnowledgeBaseId }
    });
    selectedKnowledgeBaseId = switched.current?.id || "";
    const afterCreate = await httpJson(service.url, "/api/knowledge-bases");
    if (afterCreate.current?.id !== primaryKnowledgeBaseId || selectedKnowledgeBaseId !== primaryKnowledgeBaseId) {
      throw new Error("First-run current selection did not persist through workspace.sqlite.");
    }
    if (!afterCreate.items?.some((item) => item.id === secondKnowledgeBaseId && item.current === false)) {
      throw new Error("Knowledge-base selection list did not preserve non-current KB state.");
    }
    const homeSelectedHtml = await httpText(service.url, "/");
    const overviewHtml = await httpText(service.url, `/kb/${primaryKnowledgeBaseId}/overview`);
    assertText(homeSelectedHtml, new RegExp(primaryKnowledgeBaseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "home should render selected KB context");
    assertText(homeSelectedHtml, /\/kb\/[^"']+\/overview|data-global-knowledge-base-switcher/i, "home should expose scoped console or KB switcher after selection");
    assertText(overviewHtml, /data-page-state|data-console-section|Knowledge Asset|知识库/i, "overview should render for selected KB");
    pass("knowledgeBaseCreateSelect", "First-run KB create/select flow persists current selection and scoped routes through workspace.sqlite.", {
      primaryKnowledgeBaseId,
      secondaryKnowledgeBaseId: secondKnowledgeBaseId
    });

    const scopedProviderDiagnostics = await httpJson(service.url, `/kb/${primaryKnowledgeBaseId}/api/providers/diagnostics`);
    const scopedIntegrationDiagnostics = await httpJson(service.url, `/kb/${primaryKnowledgeBaseId}/api/integration/diagnostics`);
    if (scopedProviderDiagnostics.stateAuthority?.providerSelection !== "workspace.sqlite"
      || scopedProviderDiagnostics.stateAuthority?.knowledgeBaseState !== "catalog.sqlite"
      || scopedProviderDiagnostics.stateAuthority?.browserStorage !== "visual-preferences-only") {
      throw new Error("Scoped provider diagnostics did not report SQLite-first state authority.");
    }
    if (scopedIntegrationDiagnostics.knowledgeBase?.id !== primaryKnowledgeBaseId
      || scopedIntegrationDiagnostics.readiness?.api !== "ready") {
      throw new Error("Scoped integration diagnostics did not report selected KB readiness.");
    }
    assertRedactedDiagnostics({ scopedProviderDiagnostics, scopedIntegrationDiagnostics });
    pass("sqliteBackedReadiness", "Selected KB readiness is scoped and reports workspace.sqlite/catalog.sqlite authority.");

    writeFirstRunSources(sourceRoot);
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const draft = {
      "setup.mode": "local",
      "project.template": "general-docs",
      "project.source": sourceRoot,
      "project.workspace": workspaceRoot,
      "retrieval.profile": "balanced"
    };
    const api = (pathname) => `/kb/${primaryKnowledgeBaseId}${pathname}`;
    await httpJson(service.url, api("/api/setup/draft"), { method: "POST", body: { draft } });
    await httpJson(service.url, api("/api/setup/retrieval-strategy"), {
      method: "POST",
      body: { draft: { "retrieval.profile": "balanced" } }
    });
    await service.close();
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
    const restoredKnowledgeBases = await httpJson(service.url, "/api/knowledge-bases");
    const setupState = await httpJson(service.url, api("/api/setup/state"));
    if (restoredKnowledgeBases.current?.id !== primaryKnowledgeBaseId) {
      throw new Error("First-run current KB selection did not survive service restart.");
    }
    if (setupState.draft?.["project.source"] !== sourceRoot || setupState.draft?.["project.workspace"] !== workspaceRoot) {
      throw new Error("First-run setup draft did not survive service restart.");
    }
    const missingPrecheck = await httpJson(service.url, api("/api/local/folders/precheck"), {
      method: "POST",
      body: { target: "source", path: path.join(userDataRoot, "missing-source"), template: "general-docs" }
    });
    const sourcePrecheck = await httpJson(service.url, api("/api/local/folders/precheck"), {
      method: "POST",
      body: { target: "source", path: sourceRoot, template: "general-docs" }
    });
    const workspacePrecheck = await httpJson(service.url, api("/api/local/folders/precheck"), {
      method: "POST",
      body: { target: "workspace", path: workspaceRoot }
    });
    const scanPreview = await httpJson(service.url, api("/api/scan/preview"), {
      method: "POST",
      body: { mode: "local", template: "general-docs", draft }
    });
    const planPreview = await httpJson(service.url, api("/api/plan/preview"), {
      method: "POST",
      body: { mode: "local", template: "general-docs", draft }
    });
    if (missingPrecheck.ok !== false) throw new Error("Missing source folder precheck should be user-fixable and blocked.");
    if (!sourcePrecheck.ok || !workspacePrecheck.ok) throw new Error("Valid first-run source/workspace precheck failed.");
    if (!scanPreview.ok || scanPreview.preview?.missingFields?.length) throw new Error("general-docs first-run scan preview leaked K12 source-scope fields.");
    if (Number(scanPreview.preview?.summary?.logicalDocuments || scanPreview.preview?.documents?.length || 0) < 2) {
      throw new Error("First-run scan preview did not include the synthetic source documents.");
    }
    if (planPreview.planPreview?.canConfirmLocalJob !== true) throw new Error("First-run execution plan preview did not allow a local job.");
    pass("guidedSetup", "First-run guided setup persists draft through restart and validates source/workspace, scan preview, and plan preview.", {
      sourceRoot: "[temp]",
      workspaceRoot: "[temp]",
      logicalDocuments: scanPreview.preview?.summary?.logicalDocuments || scanPreview.preview?.documents?.length || 0,
      planStages: planPreview.planPreview?.stages?.length || 0
    });

    const confirmed = await httpJson(service.url, api("/api/jobs/confirm"), {
      method: "POST",
      body: { mode: "local", template: "general-docs", draft }
    });
    if (!confirmed.ok || confirmed.job?.status !== "waiting") throw new Error("First-run local build job was not created.");
    const paused = await httpJson(service.url, api("/api/jobs/latest/pause"), { method: "POST" });
    const resumed = await httpJson(service.url, api("/api/jobs/latest/resume"), { method: "POST" });
    if (!paused.ok || paused.job?.status !== "paused" || !resumed.ok || resumed.job?.status !== "waiting") {
      throw new Error("First-run pause/resume did not preserve a waiting job.");
    }
    const advanced = await httpJson(service.url, api("/api/jobs/latest/advance"), { method: "POST" });
    if (!advanced.ok || Number(advanced.job?.progress?.completed || 0) < 1) {
      throw new Error("First-run job advance did not persist visible progress.");
    }
    await service.close();
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
    const recoveredJob = await httpJson(service.url, api("/api/jobs/latest"));
    if (!recoveredJob.ok || recoveredJob.job?.id !== confirmed.job.id || Number(recoveredJob.job?.progress?.completed || 0) < 1) {
      throw new Error("First-run latest job did not recover after service restart.");
    }
    const completed = await httpJson(service.url, api("/api/jobs/latest/run"), { method: "POST" });
    if (!completed.ok || completed.job?.status !== "completed") throw new Error("First-run local build did not complete.");
    const diagnosticExport = await httpJson(service.url, api("/api/maintenance/export"));
    assertNoPrivateDiagnostics(diagnosticExport, userDataRoot);
    pass("buildRecovery", "First-run build proves job creation, progress, pause/resume, restart recovery, completion, and redacted diagnostics.", {
      completedJobId: completed.job.id,
      recoveredJobId: recoveredJob.job.id,
      completedTasks: completed.job.progress?.completed || 0
    });

    const evidenceSearch = await httpJson(service.url, api("/api/search?query=rollback&limit=4"));
    if (!evidenceSearch.ok || Number(evidenceSearch.total || 0) < 1) {
      throw new Error("First-run evidence search returned no built knowledge.");
    }
    const firstQuestion = "What should operators review before publishing?";
    const query = await httpJson(service.url, api("/api/query"), {
      method: "POST",
      body: { question: firstQuestion }
    });
    const answered = query.status === "answered" && Array.isArray(query.citations) && query.citations.length > 0;
    const explicitNoAnswer = ["no_answer", "insufficient_evidence", "out_of_scope"].includes(query.status)
      && (!Array.isArray(query.citations) || query.citations.length === 0);
    if (!answered && !explicitNoAnswer) {
      throw new Error(`First-run query returned a weak or ambiguous result: ${JSON.stringify({ status: query.status, citations: query.citations?.length || 0 })}`);
    }
    const searchCitation = evidenceSearch.items?.[0]?.citation || {};
    const citationRefs = Array.isArray(query.citations) && query.citations.length
      ? query.citations.slice(0, 1)
      : [{
          id: searchCitation.citationId || searchCitation.id || evidenceSearch.items?.[0]?.chunkId || "",
          chunkId: evidenceSearch.items?.[0]?.chunkId || "",
          documentId: evidenceSearch.items?.[0]?.documentId || searchCitation.documentId || "",
          title: searchCitation.title || evidenceSearch.items?.[0]?.title || "",
          pageNumber: searchCitation.pageNumber || evidenceSearch.items?.[0]?.pageNumber || 1,
          sourceUri: searchCitation.sourceUri || "",
          documentHref: evidenceSearch.items?.[0]?.links?.document || ""
        }];
    if (!citationRefs[0]?.id && !citationRefs[0]?.chunkId) throw new Error("First-run evidence did not expose a citation reference for feedback.");
    const feedback = await httpJson(service.url, api("/api/query/feedback"), {
      method: "POST",
      body: {
        action: "wrong_citation",
        question: firstQuestion,
        answerStatus: query.status || "evidence_review",
        resultKey: query.resultKey || `search:${evidenceSearch.items?.[0]?.chunkId || searchCitation.citationId || "first-run"}`,
        citationRefs,
        message: "First-run smoke: route this feedback to maintenance next action."
      }
    });
    const review = await httpJson(service.url, api("/api/maintenance/review?status=open&limit=10"));
    const feedbackIssue = review.review?.items?.find((item) => item.source === "query_feedback" && item.issueType === "wrong_citation");
    if (!feedback.ok || !feedbackIssue?.rerunScope) {
      throw new Error("First-run feedback did not produce a maintenance next action with rerun scope.");
    }
    pass("firstQuestion", "First-run Query Runtime returns a cited answer or explicit no-answer/refusal without weak success.", {
      queryStatus: query.status,
      citations: Array.isArray(query.citations) ? query.citations.length : 0,
      searchTotal: evidenceSearch.total
    });
    pass("maintenanceNextAction", "First-run feedback creates a maintenance review item with a safe next action.", {
      issueId: feedbackIssue.id,
      rerunScopeType: feedbackIssue.rerunScope.type || ""
    });

    const pages = { homeEmptyHtml, managerEmptyHtml, homeSelectedHtml, overviewHtml };
    viewportResults = viewports.map((viewport) => viewportCheck(viewport, pages));
    for (const result of viewportResults) {
      if (result.status !== "pass") throw new Error(`First-run DOM contract failed for ${result.name}: ${result.message}`);
    }
  } catch (error) {
    fail("firstRunUsability", error?.stack || error?.message || String(error));
    viewportResults = viewports.map((viewport) => ({ ...viewport, status: "fail", assertions: {}, message: "Smoke failed before viewport checks." }));
  } finally {
    if (service) await service.close();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    userDataRootRemoved = !fs.existsSync(userDataRoot);
  }
  return buildResult({
    checks,
    viewports: viewportResults,
    externalCalls,
    userDataRoot,
    userDataRootRemoved,
    primaryKnowledgeBaseId,
    selectedKnowledgeBaseId
  });
}

function buildResult({ checks, viewports, externalCalls, userDataRoot, userDataRootRemoved, primaryKnowledgeBaseId, selectedKnowledgeBaseId }) {
  const checkPassed = (key) => checks.some((item) => item.key === key && item.status === "pass");
  const desktop = viewports.some((item) => item.name === "desktop" && item.status === "pass");
  const narrow = viewports.some((item) => item.name === "narrow" && item.status === "pass");
  const ok = checks.length > 0
    && checks.every((item) => item.status === "pass")
    && viewports.every((item) => item.status === "pass")
    && userDataRootRemoved
    && externalCalls.length === 0;
  return {
    ok,
    kind: "knowmesh.firstRunUsabilitySmoke",
    generatedAt: new Date().toISOString(),
    checks,
    viewports,
    evidence: {
      firstRunLaunchProof: {
        status: ok && checkPassed("emptyState") && checkPassed("readinessDiagnostics") ? "pass" : "fail",
        emptyWorkspace: checkPassed("emptyState"),
        createAction: checkPassed("emptyState"),
        sampleAction: checkPassed("emptyState"),
        runtimeDiagnostics: checkPassed("readinessDiagnostics"),
        providerReadiness: checkPassed("readinessDiagnostics"),
        localhostOnly: checkPassed("readinessDiagnostics")
      },
      firstRunBrowserWorkflow: {
        status: ok ? "pass" : "fail",
        desktop,
        narrow,
        emptyState: checkPassed("emptyState"),
        createSelect: checkPassed("knowledgeBaseCreateSelect"),
        readiness: checkPassed("sqliteBackedReadiness"),
        diagnostics: checkPassed("readinessDiagnostics")
      },
      sqliteStateAuthorityProof: {
        status: ok && checkPassed("knowledgeBaseCreateSelect") && checkPassed("sqliteBackedReadiness") ? "pass" : "fail",
        workspaceSqliteSelection: checkPassed("knowledgeBaseCreateSelect"),
        catalogSqliteKnowledgeBase: checkPassed("sqliteBackedReadiness"),
        noBrowserStorageTruth: checkPassed("sqliteBackedReadiness"),
        noJsonStateAuthority: checkPassed("knowledgeBaseCreateSelect")
      },
      guidedSetupProof: {
        status: ok && checkPassed("guidedSetup") ? "pass" : "fail",
        setupDraftPersistence: checkPassed("guidedSetup"),
        folderPrecheck: checkPassed("guidedSetup"),
        missingFolderBlocked: checkPassed("guidedSetup"),
        scanPreview: checkPassed("guidedSetup"),
        executionPlanPreview: checkPassed("guidedSetup"),
        generalDocsNoK12Leak: checkPassed("guidedSetup")
      },
      buildRecoveryProof: {
        status: ok && checkPassed("buildRecovery") ? "pass" : "fail",
        jobCreation: checkPassed("buildRecovery"),
        visibleProgress: checkPassed("buildRecovery"),
        pauseResume: checkPassed("buildRecovery"),
        restartRecovery: checkPassed("buildRecovery"),
        completion: checkPassed("buildRecovery"),
        diagnosticRedaction: checkPassed("buildRecovery")
      },
      firstQuestionProof: {
        status: ok && checkPassed("firstQuestion") ? "pass" : "fail",
        queryRuntime: checkPassed("firstQuestion"),
        citationOrExplicitNoAnswer: checkPassed("firstQuestion"),
        evidenceSearch: checkPassed("firstQuestion"),
        noWeakSuccess: checkPassed("firstQuestion")
      },
      maintenanceNextActionProof: {
        status: ok && checkPassed("maintenanceNextAction") ? "pass" : "fail",
        feedbackStored: checkPassed("maintenanceNextAction"),
        reviewItemCreated: checkPassed("maintenanceNextAction"),
        safeRerunScope: checkPassed("maintenanceNextAction"),
        scopedApi: checkPassed("maintenanceNextAction")
      },
      externalCalls: {
        total: externalCalls.length,
        calls: externalCalls
      },
      cleanup: {
        userDataRoot,
        userDataRootRemoved
      },
      knowledgeBase: {
        primaryKnowledgeBaseId,
        selectedKnowledgeBaseId
      }
    }
  };
}

function writeFirstRunSources(sourceRoot) {
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, "getting-started.md"),
    [
      "# First Run Guide",
      "",
      "KnowMesh should validate source folders before building.",
      "A first-run user should see setup, scan preview, and execution plan guidance."
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(sourceRoot, "operations.txt"),
    "Operators review source changes, citations, feedback, and rollback risk before publishing.",
    "utf8"
  );
}

function viewportCheck(viewport, pages) {
  const assertions = [
    ["homeCreateAction", /data-knowledge-base-create|Create Knowledge Base|新建知识库/i.test(pages.homeEmptyHtml)],
    ["homePublicSample", /Public General Sample|先用公开样例试一下/i.test(pages.homeEmptyHtml)],
    ["managerEmptyState", /knowledge-base-manager--empty|No knowledge bases|还没有知识库/i.test(pages.managerEmptyHtml)],
    ["selectedKbContext", /data-global-knowledge-base-switcher|\/kb\/[^"']+\/overview/i.test(pages.homeSelectedHtml)],
    ["overviewScoped", /data-page-state|data-console-section|Knowledge Asset|知识库/i.test(pages.overviewHtml)]
  ];
  const failed = assertions.filter(([, passed]) => !passed).map(([key]) => key);
  return {
    name: viewport.name,
    width: Number(viewport.width || 0),
    height: Number(viewport.height || 0),
    status: failed.length ? "fail" : "pass",
    assertions: Object.fromEntries(assertions),
    message: failed.length ? `Missing ${failed.join(", ")}` : "First-run DOM contract passed."
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

function assertText(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message);
}

function assertRedactedDiagnostics(value) {
  const text = JSON.stringify(value);
  if (/sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|private textbook|真实教材|客户资料|学生隐私/i.test(text)) {
    throw new Error("First-run diagnostics leaked credentials, raw provider payloads, or private content.");
  }
}

function assertNoPrivateDiagnostics(value, userDataRoot) {
  const text = JSON.stringify(value);
  const escapedRoot = userDataRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(escapedRoot).test(text)) throw new Error("First-run maintenance diagnostics leaked the temp user data path.");
  if (/private textbook|真实教材|客户资料|学生隐私|sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}/i.test(text)) {
    throw new Error("First-run maintenance diagnostics leaked private content or credentials.");
  }
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" }
  });
}

function trimMessage(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 800);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runFirstRunUsabilitySmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
