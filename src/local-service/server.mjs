import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

import { getTemplate, getTemplateLibrary } from "../core/templates.mjs";
import { refreshAliyunModelCatalog } from "../core/aliyun-model-catalog.mjs";
import {
  checkAliyunIdentity,
  checkAliyunPermissions,
  checkAliyunStorage,
  confirmAliyunStorage,
  minimumAliyunPolicy,
  previewAliyunModelProvider,
  previewAliyunModelQuality,
  previewAliyunSearch,
  previewAliyunServices,
  previewAliyunStorage
} from "./aliyun.mjs";
import { checkEnvironment } from "./environment.mjs";
import { isFolderPrecheckTarget, precheckLocalFolder } from "./folder-precheck.mjs";
import { isFolderPickerTarget, pickLocalFolder } from "./folder-picker.mjs";
import { architectureFoundationStatus } from "./architecture-foundation.mjs";
import { createKnowledgeBase, listKnowledgeBases, switchKnowledgeBase } from "./knowledge-bases.mjs";
import {
  knowledgeBaseVersionDiff,
  knowledgeBaseVersions,
  previewKnowledgeBaseRollback,
  rollbackKnowledgeBaseVersion
} from "./knowledge-versions.mjs";
import { advanceLatestJob, confirmLocalJob, confirmTargetedRerunJob, latestJob, pauseLatestJob, resumeLatestJob, runLatestJob, stopLatestJob, testLatestJobTask } from "./jobs.mjs";
import { maintenanceStatus, previewKnowMeshUpdate, upgradeMetadataContract } from "./maintenance.mjs";
import { maintenanceReview, resolveMaintenanceReviewIssue } from "./maintenance-review.mjs";
import { openKnownLocalPath, revealLocalFilePath } from "./local-paths.mjs";
import { platformRuntimeInventory } from "./platform-runtime.mjs";
import { previewExecutionPlan } from "./plan-preview.mjs";
import { providerCapabilities } from "./provider-capabilities.mjs";
import { providerDiagnostics } from "./provider-diagnostics.mjs";
import { integrationDiagnostics } from "./integration-diagnostics.mjs";
import { integrationManifest } from "./integration-manifest.mjs";
import {
  createPublicSampleKnowledgeBase,
  listPublicSamples,
  resetPublicSampleKnowledgeBase
} from "./public-samples.mjs";
import { buildExportPackagePreview, previewImportPackage } from "./package-manifest.mjs";
import { previewTargetedRerun } from "./targeted-rerun.mjs";
import { previewRetrievalStrategy } from "./retrieval-strategy.mjs";
import { buildTemplateScan, previewScan } from "./scan-preview.mjs";
import { searchCatalog } from "./catalog-search.mjs";
import { renderConsolePage, resolveConsoleRoute } from "../web-console/pages.mjs";
import {
  buildDocumentListPayload,
  excludeKnowledgeBaseDocuments,
  readCatalogDocumentInventory,
  restoreKnowledgeBaseDocuments,
  summarizeDocumentChanges
} from "./document-inventory.mjs";
import { buildDocumentAssetPayload } from "./document-assets.mjs";
import { contentGraph } from "./content-graph.mjs";
import { queryFeedbackSummary, recordQueryFeedback, resolveQueryFeedback } from "./query-feedback.mjs";
import { readExtractionManifestFromCatalog } from "./extraction-manifest.mjs";
import { readSourceManifestFromCatalog } from "./source-catalog.mjs";
import { readStructureSidecarFromCatalog } from "./structure-sidecar.mjs";
import { readChunkManifestFromCatalog, readIndexManifestFromCatalog } from "./retrieval-manifests.mjs";
import { readVersionManifestFromCatalog } from "./version-manifest.mjs";
import { readK12EvaluationManifestFromCatalog } from "./k12-evaluation-manifest.mjs";
import { evaluationDashboard } from "./evaluation-dashboard.mjs";
import { readK12ExpertReadinessFromCatalog } from "./k12-expert-readiness.mjs";
import { readK12QueryReadinessFromCatalog } from "./k12-query-readiness.mjs";
import { readK12SourceScopeGateFromCatalog } from "./k12-source-scope-gate.mjs";
import { readK12StructureReadinessFromCatalog } from "./k12-structure-readiness.mjs";
import { planQueryRoute } from "./query-route-planner.mjs";
import { queryKnowledgeBase, queryRuntimeContract } from "./query-runtime.mjs";
import {
  clearAliyunCredentials,
  credentialLocations,
  maskAccessKeyId,
  modelProviderLocations,
  readAliyunCredentials,
  readAliyunEnvironmentCredentials,
  readAliyunModelProvider,
  readSetupState,
  saveAliyunModelQuality,
  saveAliyunModelProvider,
  saveAliyunSearch,
  saveAliyunCredentials,
  prepareAliyunSearchDraft,
  saveRetrievalStrategy,
  saveSetupDraft
} from "./setup-store.mjs";

const defaultHost = "127.0.0.1";
const defaultPort = 7457;

export async function startLocalService(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const defaultProjectFolders = ensureDefaultProjectFolders(projectRoot);
  const host = options.host || defaultHost;
  const port = Number(options.port ?? defaultPort);
  const startedAt = new Date().toISOString();
  const state = {
    projectRoot,
    defaultProjectFolders,
    host,
    requestedPort: port,
    userDataRoot: options.userDataRoot,
    fetchImpl: options.fetchImpl,
    startedAt,
    packageInfo: readPackageInfo(projectRoot)
  };

  const service = await listenWithFallback(state, { host, port });
  if (options.open) openBrowser(service.url);
  return service;
}

export function createLocalServiceServer(state) {
  return http.createServer((request, response) => {
    handleRequest(request, response, state).catch((error) => {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  });
}

export function openBrowser(url) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

async function listenWithFallback(state, options) {
  const startPort = options.port === 0 ? pickInternalPortStart() : options.port;
  const maxAttempts = options.port === 0 ? 80 : 20;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const requestedPort = startPort + offset;
    const server = createLocalServiceServer(state);

    try {
      await listen(server, options.host, requestedPort);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : requestedPort;
      state.port = actualPort;
      const url = `http://${options.host}:${actualPort}`;
      return {
        server,
        host: options.host,
        requestedPort: options.port,
        port: actualPort,
        portChanged: Number(options.port) > 0 && Number(actualPort) !== Number(options.port),
        url,
        close: () => close(server)
      };
    } catch (error) {
      if (error?.code !== "EADDRINUSE" || offset === maxAttempts - 1) throw error;
    }
  }

  throw new Error("Unable to start KnowMesh local service.");
}

function pickInternalPortStart() {
  return 20000 + Math.floor(Math.random() * 24000);
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function handleRequest(request, response, state) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || defaultHost}`);
  const rawPathname = decodeURIComponent(requestUrl.pathname);
  const scope = resolveKnowledgeBaseRequestScope(state, rawPathname);
  const pathname = scope.pathname;
  const requestState = scope.state;

  if (scope.missingKnowledgeBase) {
    if (pathname.startsWith("/api")) {
      sendJson(response, 404, { ok: false, error: "Knowledge base not found." });
    } else {
      sendRedirect(response, "/knowledge-bases");
    }
    return;
  }

  if (!scope.basePath && shouldRedirectToCurrentKnowledgeBase(pathname)) {
    sendRedirect(response, currentKnowledgeBaseRedirectTarget(requestState, pathname));
    return;
  }

  if (pathname === "/api/health") {
    sendJson(response, 200, buildHealth(requestState));
    return;
  }

  if (pathname === "/api/templates") {
    sendJson(response, 200, getTemplateLibrary());
    return;
  }

  if (pathname === "/api/integration/manifest" && request.method === "GET") {
    sendJson(response, 200, integrationManifest(requestState, { scoped: Boolean(scope.basePath) }));
    return;
  }

  if (pathname === "/api/integration/diagnostics" && request.method === "GET") {
    sendJson(response, 200, integrationDiagnostics(requestState, { scoped: Boolean(scope.basePath) }));
    return;
  }

  if (pathname === "/api/knowledge-bases" && request.method === "GET") {
    sendJson(response, 200, listKnowledgeBases(requestState));
    return;
  }

  if (pathname === "/api/knowledge-bases" && request.method === "POST") {
    const body = await readJsonBody(request);
    const knowledgeBase = createKnowledgeBase(state, body || {});
    sendJson(response, 200, { ok: true, knowledgeBase, ...listKnowledgeBases(state) });
    return;
  }

  if (pathname === "/api/knowledge-bases/current" && request.method === "POST") {
    const body = await readJsonBody(request);
    const current = switchKnowledgeBase(state, body.id || body.knowledgeBaseId || "");
    sendJson(response, 200, { ok: true, current, ...listKnowledgeBases(state) });
    return;
  }

  if (pathname === "/api/public-samples" && request.method === "GET") {
    sendJson(response, 200, listPublicSamples(requestState));
    return;
  }

  if (pathname === "/api/public-samples/create" && request.method === "POST") {
    const body = await readJsonBody(request);
    try {
      sendJson(response, 200, createPublicSampleKnowledgeBase(state, body || {}));
    } catch (error) {
      sendJson(response, error.status || 500, {
        ok: false,
        error: {
          code: error.code || "public_sample_create_failed",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
    return;
  }

  if (pathname === "/api/public-samples/reset" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = resetPublicSampleKnowledgeBase(state, body || {});
    sendJson(response, result.ok ? 200 : result.status || 409, result);
    return;
  }

  if (requiresKnowledgeBaseApi(pathname) && !listKnowledgeBases(requestState).current) {
    sendJson(response, 409, { ok: false, error: "Knowledge base is required." });
    return;
  }

  if (pathname === "/api/documents" && request.method === "GET") {
    const payload = await buildDocumentsPayloadForRequest(requestState, { listOptions: documentListOptionsFromSearch(requestUrl.searchParams) });
    sendJson(response, 200, payload);
    return;
  }

  if (pathname === "/api/documents/check" && request.method === "POST") {
    const payload = await buildDocumentsPayloadForRequest(requestState, { hashFiles: true, includeChanges: true });
    sendJson(response, 200, payload);
    return;
  }

  if (pathname === "/api/documents/asset" && request.method === "GET") {
    const payload = await buildDocumentAssetPayload(requestState, {
      documentId: requestUrl.searchParams.get("documentId") || requestUrl.searchParams.get("id") || "",
      path: requestUrl.searchParams.get("path") || "",
      cursor: requestUrl.searchParams.get("cursor") || "0",
      limit: requestUrl.searchParams.get("limit") || "30"
    });
    sendJson(response, payload.ok ? 200 : 404, payload);
    return;
  }

  if (pathname === "/api/source/manifest" && request.method === "GET") {
    sendJson(response, 200, readSourceManifestFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/extraction/manifest" && request.method === "GET") {
    sendJson(response, 200, readExtractionManifestFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/structure/sidecar" && request.method === "GET") {
    sendJson(response, 200, readStructureSidecarFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/chunks/manifest" && request.method === "GET") {
    sendJson(response, 200, readChunkManifestFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/index/manifest" && request.method === "GET") {
    sendJson(response, 200, readIndexManifestFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/version/manifest" && request.method === "GET") {
    sendJson(response, 200, readVersionManifestFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/evaluation/dashboard" && request.method === "GET") {
    sendJson(response, 200, evaluationDashboard(requestState));
    return;
  }

  if (pathname === "/api/k12/source-scope/gate" && request.method === "GET") {
    sendJson(response, 200, readK12SourceScopeGateFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/k12/readiness" && request.method === "GET") {
    sendJson(response, 200, readK12ExpertReadinessFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/k12/structure/readiness" && request.method === "GET") {
    sendJson(response, 200, readK12StructureReadinessFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/k12/query/readiness" && request.method === "GET") {
    sendJson(response, 200, readK12QueryReadinessFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/k12/evaluation/manifest" && request.method === "GET") {
    sendJson(response, 200, readK12EvaluationManifestFromCatalog(requestState));
    return;
  }

  if (pathname === "/api/documents/exclude" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = excludeKnowledgeBaseDocuments(requestState, {
      documents: body.documents || [],
      reason: body.reason || "用户排除"
    });
    const payload = await buildDocumentsPayloadForRequest(requestState);
    sendJson(response, 200, { ...payload, overrides: result.overrides });
    return;
  }

  if (pathname === "/api/documents/restore" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = restoreKnowledgeBaseDocuments(requestState, { documents: body.documents || [] });
    const payload = await buildDocumentsPayloadForRequest(requestState);
    sendJson(response, 200, { ...payload, overrides: result.overrides });
    return;
  }

  if (pathname === "/api/documents/reveal" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = revealKnowledgeBaseDocument(requestState, body || {});
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (pathname === "/api/content/graph" && request.method === "GET") {
    sendJson(response, 200, contentGraph(requestState, {
      query: requestUrl.searchParams.get("query") || "",
      quality: requestUrl.searchParams.get("quality") || "all",
      cursor: requestUrl.searchParams.get("cursor") || "0",
      limit: requestUrl.searchParams.get("limit") || "20"
    }));
    return;
  }

  if (pathname === "/api/search" && (request.method === "GET" || request.method === "POST")) {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const result = searchCatalog(requestState, catalogSearchInputFromRequest(requestUrl, body || {}));
    sendJson(response, result.ok ? 200 : 409, result);
    return;
  }

  if (pathname === "/api/setup/state") {
    sendJson(response, 200, { ok: true, ...readSetupState(requestState) });
    return;
  }

  if (pathname === "/api/setup/draft" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, { ok: true, ...saveSetupDraft(requestState, body.draft || {}) });
    return;
  }

  if (pathname === "/api/local/folders/pick" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!isFolderPickerTarget(body.target)) {
      sendJson(response, 400, { ok: false, error: "Unsupported folder target." });
      return;
    }
    const result = await pickLocalFolder({
      target: body.target,
      dryRun: body.dryRun === true
    });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/local/folders/precheck" && request.method === "POST") {
    const body = await readJsonBody(request);
    if (!isFolderPrecheckTarget(body.target)) {
      sendJson(response, 400, { ok: false, error: "Unsupported folder target." });
      return;
    }
    sendJson(response, 200, precheckLocalFolder(requestState, {
      target: body.target,
      path: body.path,
      template: body.template
    }));
    return;
  }

  if (pathname === "/api/local/paths/open" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = openKnownLocalPath(requestState, {
      target: body.target,
      dryRun: body.dryRun === true
    });
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }

  if (pathname === "/api/setup/aliyun/credentials/check" && request.method === "POST") {
    const body = await readJsonBody(request);
    const credentials = body.useSavedCredential === true
      ? await readAliyunCredentials(requestState)
      : {
          accessKeyId: String(body.accessKeyId || "").trim(),
          accessKeySecret: String(body.accessKeySecret || ""),
          saveTarget: body.saveTarget || "secure-local",
          source: "current-input"
        };
    const result = await checkAliyunIdentity(credentials, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, {
      ...result,
      credential: summarizeCheckedCredential(credentials, result.ok)
    });
    return;
  }

  if (pathname === "/api/setup/aliyun/credentials" && request.method === "POST") {
    const body = await readJsonBody(request);
    try {
      const credential = await saveAliyunCredentials(requestState, {
        accessKeyId: body.accessKeyId,
        accessKeySecret: body.accessKeySecret,
        saveTarget: body.saveTarget
      });
      sendJson(response, 200, {
        ok: true,
        credential,
        checks: [
          {
            key: "credentialSaved",
            status: "pass",
            label: { zh: "本机凭证", en: "Local credential" },
            message: { zh: "已保存到本机。", en: "Saved locally." }
          }
        ]
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/setup/aliyun/credentials" && request.method === "DELETE") {
    sendJson(response, 200, { ok: true, ...clearAliyunCredentials(requestState) });
    return;
  }

  if (pathname === "/api/setup/aliyun/existing/check" && request.method === "POST") {
    const credentials = readAliyunEnvironmentCredentials(requestState);
    const result = await checkAliyunIdentity(credentials, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, {
      ...result,
      credential: {
        configured: Boolean(credentials?.accessKeyId && credentials?.accessKeySecret),
        verified: Boolean(result.ok),
        accessKeyId: credentials?.accessKeyId ? maskExistingAccessKeyId(credentials.accessKeyId) : "",
        saveTarget: "existing-env",
        source: credentials?.source || "environment"
      }
    });
    return;
  }

  if (pathname === "/api/aliyun/identity/check" && request.method === "POST") {
    const credentials = await readAliyunCredentials(requestState);
    const result = await checkAliyunIdentity(credentials, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/aliyun/permissions/check" && request.method === "POST") {
    const body = await readJsonBody(request);
    const credentials = await readAliyunCredentials(requestState);
    const result = await checkAliyunPermissions(credentials, body.draft || {}, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/aliyun/permissions/policy" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, minimumAliyunPolicy(body.draft || {}));
    return;
  }

  if (pathname === "/api/aliyun/storage/check" && request.method === "POST") {
    const body = await readJsonBody(request);
    const credentials = await readAliyunCredentials(requestState);
    const result = await checkAliyunStorage(credentials, body.draft || {}, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/aliyun/storage/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    const credentials = await readAliyunCredentials(requestState);
    const result = await previewAliyunStorage(credentials, body.draft || {}, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/aliyun/storage/create" && request.method === "POST") {
    const body = await readJsonBody(request);
    const credentials = await readAliyunCredentials(requestState);
    const draft = body.draft || {};
    const result = await confirmAliyunStorage(credentials, draft, { fetchImpl: state.fetchImpl });
    if (result.ok) {
      saveSetupDraft(requestState, {
        ...draft,
        "aliyun.storage.confirmed": true,
        "aliyun.storage.confirmedAt": new Date().toISOString()
      });
    }
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/aliyun/search/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    const draft = prepareAliyunSearchDraft(requestState, body.draft || {});
    sendJson(response, 200, previewAliyunSearch(draft));
    return;
  }

  if (pathname === "/api/setup/aliyun/search" && request.method === "POST") {
    const body = await readJsonBody(request);
    const draft = prepareAliyunSearchDraft(requestState, body.draft || {});
    const preview = previewAliyunSearch(draft);
    if (!preview.ok) {
      sendJson(response, 200, preview);
      return;
    }
    const search = saveAliyunSearch(requestState, draft);
    sendJson(response, 200, {
      ...preview,
      ok: true,
      search,
      checks: [
        ...preview.checks,
        {
          key: "searchSaved",
          status: "pass",
          label: { zh: "知识检索", en: "Knowledge search" },
          message: { zh: "已保存到本机。", en: "Saved locally." }
        }
      ]
    });
    return;
  }

  if (pathname === "/api/aliyun/model-provider/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    const saved = await readAliyunModelProvider(requestState);
    const draft = body.draft || {};
    sendJson(response, 200, previewAliyunModelProvider({
      ...(saved ? {
        "aliyun.model.provider": saved.provider,
        "aliyun.model.protocol": saved.protocol,
        "aliyun.model.region": saved.region,
        "aliyun.model.workspaceId": saved.workspaceId,
        "aliyun.model.baseUrl": saved.baseUrl,
        "aliyun.model.apiKey.configured": true
      } : {}),
      ...draft
    }));
    return;
  }

  if (pathname === "/api/setup/aliyun/model-provider" && request.method === "POST") {
    const body = await readJsonBody(request);
    try {
      const modelProvider = await saveAliyunModelProvider(requestState, {
        provider: body.provider,
        protocol: body.protocol,
        region: body.region,
        workspaceId: body.workspaceId,
        baseUrl: body.baseUrl,
        apiKey: body.apiKey
      });
      sendJson(response, 200, {
        ok: true,
        modelProvider,
        checks: [
          {
            key: "modelProviderSaved",
            status: "pass",
            label: { zh: "百炼 API Key", en: "Model Studio API Key" },
            message: { zh: "已保存到本机。", en: "Saved locally." }
          }
        ]
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (pathname === "/api/aliyun/model-quality/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, previewAliyunModelQuality(body.draft || {}));
    return;
  }

  if (pathname === "/api/setup/aliyun/model-quality" && request.method === "POST") {
    const body = await readJsonBody(request);
    const draft = body.draft || {};
    const preview = previewAliyunModelQuality(draft);
    if (!preview.ok) {
      sendJson(response, 200, preview);
      return;
    }
    const modelQuality = saveAliyunModelQuality(requestState, draft);
    sendJson(response, 200, {
      ...preview,
      ok: true,
      modelQuality,
      checks: [
        ...preview.checks,
        {
          key: "modelQualitySaved",
          status: "pass",
          label: { zh: "模型方案", en: "Model profile" },
          message: { zh: "已保存到本机。", en: "Saved locally." }
        }
      ]
    });
    return;
  }

  if (pathname === "/api/aliyun/model-catalog/refresh" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = await refreshAliyunModelCatalog(body.current || body.draft || {}, { fetchImpl: state.fetchImpl });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/retrieval-strategy/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, previewRetrievalStrategy(body.draft || {}));
    return;
  }

  if (pathname === "/api/setup/retrieval-strategy" && request.method === "POST") {
    const body = await readJsonBody(request);
    const draft = body.draft || {};
    const preview = previewRetrievalStrategy(draft);
    if (!preview.ok) {
      sendJson(response, 200, preview);
      return;
    }
    const retrievalStrategy = saveRetrievalStrategy(state, draft);
    sendJson(response, 200, {
      ...preview,
      ok: true,
      retrievalStrategy,
      checks: [
        ...preview.checks,
        {
          key: "retrievalStrategySaved",
          status: "pass",
          label: { zh: "问答策略", en: "Answer strategy" },
          message: { zh: "已保存到本机。", en: "Saved locally." }
        }
      ]
    });
    return;
  }

  if (pathname === "/api/aliyun/services/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, previewAliyunServices(body.draft || {}));
    return;
  }

  if (pathname === "/api/environment/check" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = await checkEnvironment(requestState, {
      mode: body.mode,
      draft: body.draft || {}
    });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/scan/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = await previewScan(requestState, {
      mode: body.mode,
      template: body.template,
      draft: body.draft || {}
    });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/plan/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = await previewExecutionPlan(requestState, {
      mode: body.mode,
      template: body.template,
      draft: body.draft || {}
    });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/rerun/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, previewTargetedRerun(requestState, body || {}));
    return;
  }

  if (pathname === "/api/rerun/confirm" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = confirmTargetedRerunJob(requestState, body || {});
    sendJson(response, result.ok ? 200 : 409, result);
    return;
  }

  if (pathname === "/api/jobs/confirm" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = await confirmLocalJob(requestState, {
      mode: body.mode,
      template: body.template,
      draft: body.draft || {}
    });
    sendJson(response, 200, result);
    return;
  }

  if (pathname === "/api/jobs/latest" && request.method === "GET") {
    sendJson(response, 200, latestJob(requestState));
    return;
  }

  if (pathname === "/api/jobs/latest/advance" && request.method === "POST") {
    sendJson(response, 200, await advanceLatestJob(requestState));
    return;
  }

  if (pathname === "/api/jobs/latest/run" && request.method === "POST") {
    sendJson(response, 200, await runLatestJob(requestState));
    return;
  }

  if (pathname === "/api/jobs/latest/test" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await testLatestJobTask(requestState, { taskKey: body.taskKey }));
    return;
  }

  if (pathname === "/api/jobs/latest/pause" && request.method === "POST") {
    sendJson(response, 200, pauseLatestJob(requestState));
    return;
  }

  if (pathname === "/api/jobs/latest/resume" && request.method === "POST") {
    sendJson(response, 200, resumeLatestJob(requestState));
    return;
  }

  if (pathname === "/api/jobs/latest/stop" && request.method === "POST") {
    sendJson(response, 200, stopLatestJob(requestState));
    return;
  }

  if (pathname === "/api/query" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, await queryKnowledgeBase(requestState, body || {}));
    return;
  }

  if (pathname === "/api/query/contract" && request.method === "GET") {
    sendJson(response, 200, queryRuntimeContract(requestState));
    return;
  }

  if (pathname === "/api/query/plan" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, planQueryRoute(requestState, body || {}));
    return;
  }

  if (pathname === "/api/query/feedback" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, recordQueryFeedback(requestState, body || {}));
    return;
  }

  if (pathname === "/api/query/feedback/summary" && request.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      kind: "knowmesh.queryFeedbackSummary",
      feedback: queryFeedbackSummary(requestState, { limit: 20 })
    });
    return;
  }

  if (pathname === "/api/query/feedback/resolve" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, resolveQueryFeedback(requestState, body || {}));
    return;
  }

  if (pathname === "/api/maintenance/review" && request.method === "GET") {
    sendJson(response, 200, maintenanceReview(requestState, {
      status: requestUrl.searchParams.get("status") || "open",
      issueType: requestUrl.searchParams.get("issueType") || requestUrl.searchParams.get("type") || "",
      severity: requestUrl.searchParams.get("severity") || "",
      document: requestUrl.searchParams.get("document") || requestUrl.searchParams.get("query") || "",
      page: requestUrl.searchParams.get("page") || "",
      limit: requestUrl.searchParams.get("limit") || "20"
    }));
    return;
  }

  if (pathname === "/api/maintenance/review/resolve" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = resolveMaintenanceReviewIssue(requestState, body || {});
    sendJson(response, result.ok ? 200 : 404, result);
    return;
  }

  if (pathname === "/api/versions" && request.method === "GET") {
    sendJson(response, 200, knowledgeBaseVersions(requestState, { limit: 40 }));
    return;
  }

  if (pathname === "/api/versions/diff" && request.method === "GET") {
    const result = knowledgeBaseVersionDiff(requestState, {
      baseBuildId: requestUrl.searchParams.get("baseBuildId") || requestUrl.searchParams.get("base") || "",
      targetBuildId: requestUrl.searchParams.get("targetBuildId") || requestUrl.searchParams.get("target") || ""
    });
    sendJson(response, result.ok ? 200 : 404, result);
    return;
  }

  if (pathname === "/api/versions/rollback/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = previewKnowledgeBaseRollback(requestState, body || {});
    sendJson(response, result.ok ? 200 : versionStatusCode(result), result);
    return;
  }

  if (pathname === "/api/versions/rollback" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = rollbackKnowledgeBaseVersion(requestState, body || {});
    const status = result.ok ? 200 : result.error?.code === "CONFIRMATION_REQUIRED" ? 409 : versionStatusCode(result);
    sendJson(response, status, result);
    return;
  }

  if (pathname === "/api/maintenance/status" && request.method === "GET") {
    sendJson(response, 200, maintenanceStatus(requestState));
    return;
  }

  if (pathname === "/api/maintenance/foundation" && request.method === "GET") {
    sendJson(response, 200, architectureFoundationStatus(requestState));
    return;
  }

  if (pathname === "/api/platform/runtime" && request.method === "GET") {
    sendJson(response, 200, platformRuntimeInventory(requestState));
    return;
  }

  if (pathname === "/api/providers/capabilities" && request.method === "GET") {
    sendJson(response, 200, providerCapabilities(requestState));
    return;
  }

  if (pathname === "/api/providers/diagnostics" && request.method === "GET") {
    sendJson(response, 200, providerDiagnostics(requestState));
    return;
  }

  if (pathname === "/api/package/export/preview" && request.method === "GET") {
    const result = buildExportPackagePreview(requestState);
    sendJson(response, result.ok ? 200 : 409, result);
    return;
  }

  if (pathname === "/api/package/import/preview" && request.method === "POST") {
    const body = await readJsonBody(request);
    sendJson(response, 200, previewImportPackage(requestState, body || {}));
    return;
  }

  if (pathname === "/api/maintenance/export" && request.method === "GET") {
    sendDownloadJson(response, 200, "knowmesh-diagnostics.json", buildMaintenanceDiagnosticExport(requestState));
    return;
  }

  if (pathname === "/api/maintenance/update/preview" && request.method === "POST") {
    sendJson(response, 200, previewKnowMeshUpdate(requestState));
    return;
  }

  if (pathname === "/api/maintenance/metadata-contract/upgrade" && request.method === "POST") {
    sendJson(response, 200, await upgradeMetadataContract(requestState));
    return;
  }

  if (pathname.startsWith("/api/templates/")) {
    const templateId = pathname.slice("/api/templates/".length);
    const template = getTemplate(templateId);
    if (!template) {
      sendJson(response, 404, { ok: false, error: "Template not found" });
      return;
    }
    sendJson(response, 200, { ok: true, template });
    return;
  }

  const consoleRoute = resolveConsoleRoute(pathname);
  if (consoleRoute) {
    sendHtml(response, renderConsolePage({
      route: consoleRoute,
      service: buildConsoleService(requestState, request, scope)
    }));
    return;
  }

  if (pathname.startsWith("/web-console/")) {
    sendFile(response, path.join(state.projectRoot, "src", "web-console"), pathname.slice("/web-console/".length));
    return;
  }

  if (pathname.startsWith("/assets/brand/")) {
    sendFile(response, path.join(state.projectRoot, "assets", "brand"), pathname.slice("/assets/brand/".length));
    return;
  }

  sendJson(response, 404, { ok: false, error: "Not found" });
}

function resolveKnowledgeBaseRequestScope(state, pathname) {
  const normalized = normalizeRequestPath(pathname);
  const match = /^\/kb\/([^/]+)(\/.*)?$/.exec(normalized);
  if (!match) return { basePath: "", knowledgeBaseId: "", pathname: normalized, state };
  const knowledgeBaseId = decodeURIComponent(match[1] || "").trim();
  const scopedPathname = normalizeRequestPath(match[2] || "/");
  const target = listKnowledgeBases(state).items.find((item) => item.id === knowledgeBaseId);
  if (!target) {
    return {
      basePath: `/kb/${encodeURIComponent(knowledgeBaseId)}`,
      knowledgeBaseId,
      pathname: scopedPathname,
      state,
      missingKnowledgeBase: true
    };
  }
  const scopedState = {
    ...state,
    knowledgeBaseId: target.id
  };
  delete scopedState.jobs;
  delete scopedState.latestJobId;
  return {
    basePath: `/kb/${encodeURIComponent(target.id)}`,
    knowledgeBaseId: target.id,
    pathname: scopedPathname,
    state: scopedState
  };
}

async function buildDocumentsPayloadForRequest(requestState, options = {}) {
  if (!listKnowledgeBases(requestState).current) return emptyDocumentsPayload();

  const setupState = readSetupState(requestState);
  const draft = setupState.draft || {};
  const hasSource = String(draft["project.source"] || "").trim();
  const hasWorkspace = String(draft["project.workspace"] || "").trim();
  const catalogInventory = readCatalogDocumentInventory(requestState);
  const hasCatalogDocuments = Number(catalogInventory.summary?.totalDocuments || 0) > 0;
  let scan = null;
  let scanError = "";
  const shouldScan = Boolean(hasSource && hasWorkspace && (options.hashFiles === true || options.includeChanges === true || !hasCatalogDocuments));

  if (shouldScan) {
    try {
      scan = await buildTemplateScan(requestState, {
        mode: draft["setup.mode"],
        template: draft["template.id"] || draft["project.template"],
        draft,
        hashFiles: options.hashFiles === true
      });
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error);
    }
  }

  const changes = options.includeChanges && scan
    ? summarizeDocumentChanges(catalogInventory, scan)
    : null;
  return {
    ...buildDocumentListPayload(requestState, {
      scan: scan && (!hasCatalogDocuments || options.hashFiles === true || options.includeChanges === true) ? scan : null,
      changes,
      listOptions: options.listOptions || {}
    }),
    inventoryPath: "",
    scanError
  };
}
function emptyDocumentsPayload() {
  return {
    ok: true,
    knowledgeBaseId: "",
    inventory: null,
    summary: {
      includedDocuments: 0,
      excludedDocuments: 0,
      userExcludedDocuments: 0,
      totalDocuments: 0,
      changes: null
    },
    resultSummary: {
      query: "",
      filter: "all",
      totalMatched: 0,
      loadedCount: 0,
      showingFrom: 0,
      showingTo: 0,
      statusCounts: { included: 0, excluded: 0, excludedByUser: 0, attention: 0, added: 0, modified: 0, missing: 0 }
    },
    pagination: { cursor: "0", limit: 50, returned: 0, nextCursor: "", hasMore: false, totalMatched: 0 },
    facets: { included: 0, excluded: 0, excludedByUser: 0, attention: 0, added: 0, modified: 0, missing: 0 },
    documents: [],
    changes: null,
    inventoryPath: "",
    scanError: ""
  };
}
function documentListOptionsFromSearch(searchParams) {
  return {
    query: searchParams.get("query") || "",
    filter: searchParams.get("filter") || "all",
    limit: searchParams.get("limit") || "50",
    cursor: searchParams.get("cursor") || "0"
  };
}

function catalogSearchInputFromRequest(requestUrl, body = {}) {
  const params = requestUrl.searchParams;
  const fromSearch = {
    query: params.get("query") || params.get("q") || "",
    purpose: params.get("purpose") || "",
    includeReview: params.get("includeReview") || params.get("include_review") || undefined,
    documentId: params.get("documentId") || params.get("document_id") || "",
    sourceType: params.get("sourceType") || params.get("source_type") || "",
    structureNodeId: params.get("structureNodeId") || params.get("structure_node_id") || "",
    pageStart: params.get("pageStart") || params.get("page_start") || "",
    pageEnd: params.get("pageEnd") || params.get("page_end") || "",
    limit: params.get("limit") || "",
    offset: params.get("offset") || "",
    qualityStates: [
      ...splitSearchValues(params.getAll("qualityState")),
      ...splitSearchValues(params.getAll("qualityStates"))
    ]
  };
  const merged = { ...fromSearch, ...(body || {}) };
  if (!("qualityStates" in (body || {})) && !("qualityState" in (body || {})) && !fromSearch.qualityStates.length) {
    delete merged.qualityStates;
  }
  return merged;
}

function splitSearchValues(values = []) {
  return values
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function revealKnowledgeBaseDocument(requestState, input = {}) {
  const draft = readSetupState(requestState).draft || {};
  const sourceRoot = String(draft["project.source"] || "").trim();
  if (!sourceRoot) return { ok: false, error: "Source folder is not configured." };

  const document = enrichRevealDocument(requestState, input.document || input);
  const candidates = documentPathCandidates(document);
  if (!candidates.length) return { ok: false, error: "Document path is required." };

  for (const [index, candidate] of candidates.entries()) {
    const target = resolveSafeChildPath(sourceRoot, candidate);
    if (!target) return { ok: false, error: "Document path is outside the source folder." };
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return {
        ...revealLocalFilePath(target, { dryRun: input.dryRun === true }),
        relativePath: normalizeDocumentRelativePath(candidate),
        resolvedFrom: index === 0 ? "logical-file" : "source-part",
        sourcePartsCount: Math.max(0, candidates.length - 1)
      };
    }
  }

  return {
    ok: false,
    error: "Source file was not found in the configured source folder.",
    relativePath: normalizeDocumentRelativePath(candidates[0])
  };
}

function enrichRevealDocument(requestState, document = {}) {
  const relativePath = normalizeDocumentRelativePath(document.relativePath || document.path);
  if (!relativePath || Array.isArray(document.sourceParts)) return document;

  const inventory = readCatalogDocumentInventory(requestState);
  const candidates = [
    ...(inventory.includedDocuments || []),
    ...(inventory.excludedDocuments || [])
  ];
  const matched = candidates.find((item) => {
    return normalizeDocumentRelativePath(item.relativePath || item.path) === relativePath
      || String(item.document_id || "") === String(document.document_id || "");
  });
  return matched ? { ...matched, ...document, sourceParts: matched.sourceParts } : document;
}
function documentPathCandidates(document = {}) {
  const values = [document.relativePath, document.path];
  const hasExplicitParts = Array.isArray(document.sourceParts) && document.sourceParts.length > 0;
  for (const part of hasExplicitParts ? document.sourceParts : []) {
    values.push(part.relativePath, part.path);
  }
  if (!hasExplicitParts) {
    for (const value of [document.relativePath, document.path]) {
      const relative = normalizeDocumentRelativePath(value);
      if (relative && !/\.\d+$/.test(relative)) values.push(`${relative}.1`);
    }
  }
  return [...new Set(values.map(normalizeDocumentRelativePath).filter(Boolean))];
}

function normalizeDocumentRelativePath(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

function resolveSafeChildPath(root, relativePath) {
  const safeRoot = path.resolve(root);
  const relative = normalizeDocumentRelativePath(relativePath);
  if (!relative || path.isAbsolute(relative) || relative.split("/").includes("..")) return null;
  const target = path.resolve(safeRoot, ...relative.split("/"));
  return target === safeRoot || target.startsWith(`${safeRoot}${path.sep}`) ? target : null;
}
function requiresKnowledgeBaseApi(pathname) {
  return pathname.startsWith("/api/setup")
    || pathname.startsWith("/api/aliyun")
    || pathname.startsWith("/api/environment")
    || pathname.startsWith("/api/scan")
    || pathname.startsWith("/api/source")
    || pathname.startsWith("/api/extraction")
    || pathname.startsWith("/api/structure")
    || pathname.startsWith("/api/chunks")
    || pathname.startsWith("/api/index")
    || pathname === "/api/search"
    || pathname === "/api/version/manifest"
    || pathname.startsWith("/api/evaluation")
    || pathname.startsWith("/api/k12")
    || pathname.startsWith("/api/plan")
    || pathname.startsWith("/api/rerun")
    || pathname.startsWith("/api/jobs")
    || pathname.startsWith("/api/query")
    || pathname === "/api/documents/asset"
    || pathname === "/api/documents/exclude"
    || pathname === "/api/documents/restore"
    || pathname === "/api/documents/reveal";
}

function shouldRedirectToCurrentKnowledgeBase(pathname) {
  const normalized = normalizeRequestPath(pathname);
  if (normalized.startsWith("/api") || normalized.startsWith("/web-console") || normalized.startsWith("/assets")) return false;
  if (normalized.startsWith("/setup/")) return true;
  return ["/overview", "/build"].includes(normalized);
}

function currentKnowledgeBaseBasePath(state) {
  const current = listKnowledgeBases(state).current;
  return current?.id ? `/kb/${encodeURIComponent(current.id)}` : "";
}

function currentKnowledgeBaseRedirectTarget(state, pathname) {
  const basePath = currentKnowledgeBaseBasePath(state);
  return basePath ? `${basePath}${pathname}` : "/knowledge-bases";
}

function buildHealth(state) {
  return {
    ok: true,
    name: state.packageInfo.name,
    version: state.packageInfo.version,
    service: "knowmesh-local-service",
    host: state.host,
    port: state.port,
    requestedPort: state.requestedPort,
    portChanged: Number(state.requestedPort) > 0 && Number(state.port) !== Number(state.requestedPort),
    url: state.port ? `http://${state.host}:${state.port}` : "",
    defaultProjectFolders: state.defaultProjectFolders,
    startedAt: state.startedAt
  };
}

function normalizeRequestPath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function buildConsoleService(state, request, scope) {
  const knowledgeBases = listKnowledgeBases(state);
  const basePath = scope?.basePath || currentKnowledgeBaseBasePath(state);
  return {
    endpoint: request.headers.host || state.host,
    version: state.packageInfo.version,
    projectRoot: state.projectRoot,
    basePath,
    apiBasePath: basePath ? `${basePath}/api` : "/api",
    setupState: basePath ? readSetupState(state) : emptySetupState(state),
    knowledgeBases,
    publicSamples: listPublicSamples(state),
    defaultProjectFolders: state.defaultProjectFolders,
    credentialLocations: credentialLocations(state),
    modelProviderLocations: modelProviderLocations(state),
    portChanged: Number(state.requestedPort) > 0 && Number(state.port) !== Number(state.requestedPort)
  };
}

function emptySetupState(state) {
  return {
    draft: {},
    updatedAt: null,
    credential: {
      configured: false,
      verified: false,
      accessKeyId: "",
      saveTarget: "",
      source: "",
      locations: credentialLocations(state)
    },
    modelProvider: {
      configured: false,
      provider: "",
      baseUrl: "",
      region: "",
      testModel: "",
      source: "",
      locations: modelProviderLocations(state)
    },
    modelQuality: { configured: false },
    retrievalStrategy: { configured: false },
    search: { configured: false }
  };
}

function ensureDefaultProjectFolders(projectRoot) {
  const folders = {
    source: path.join(projectRoot, "source"),
    workspace: path.join(projectRoot, "workspace")
  };
  fs.mkdirSync(folders.source, { recursive: true });
  fs.mkdirSync(folders.workspace, { recursive: true });
  return folders;
}

function maskExistingAccessKeyId(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}****`;
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function summarizeCheckedCredential(credentials, verified) {
  if (!credentials?.accessKeyId) {
    return {
      configured: false,
      verified: false,
      accessKeyId: "",
      saveTarget: "",
      source: ""
    };
  }
  const source = credentials.source || "";
  return {
    configured: source === "secure-local" || source === "env-file" || source === "existing-env",
    verified: Boolean(verified),
    accessKeyId: maskAccessKeyId(credentials.accessKeyId),
    saveTarget: credentials.saveTarget || "secure-local",
    source: source || "current-input"
  };
}

function sendFile(response, root, relativePath) {
  const safeRoot = path.resolve(root);
  const target = path.resolve(safeRoot, relativePath);

  if (!target.startsWith(`${safeRoot}${path.sep}`) && target !== safeRoot) {
    sendJson(response, 403, { ok: false, error: "Forbidden" });
    return;
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendJson(response, 404, { ok: false, error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": contentType(target),
    "cache-control": "no-store"
  });
  fs.createReadStream(target).pipe(response);
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}

function sendRedirect(response, location) {
  response.writeHead(302, {
    location,
    "cache-control": "no-store"
  });
  response.end();
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendDownloadJson(response, status, fileName, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}

function buildMaintenanceDiagnosticExport(state) {
  const maintenance = maintenanceStatus(state);
  const foundation = architectureFoundationStatus(state);
  const registry = listKnowledgeBases(state);
  const current = registry.current || null;
  const latest = latestJob(state);
  const baseDiagnostics = {
    ok: true,
    kind: "knowmesh.maintenanceDiagnostics",
    generatedAt: new Date().toISOString(),
    privacy: {
      redacted: true,
      excludes: ["credentials", "apiKeys", "documentText", "sourceContent", "queryText", "answerText", "evaluationQuestions", "expectedAnswers"]
    },
    service: {
      endpoint: maintenance.maintenance?.summary?.endpoint || "",
      version: state.packageInfo?.version || "0.0.0"
    },
    platformRuntime: maintenance.maintenance?.platformRuntime || platformRuntimeInventory(state),
    providerCapabilities: maintenance.maintenance?.providerCapabilities || providerCapabilities(state),
    knowledgeBase: current ? {
      id: current.id,
      name: current.name || current.id,
      status: current.status || "",
      template: current.template || "",
      createdAt: current.createdAt || "",
      updatedAt: current.updatedAt || ""
    } : null,
    checks: maintenance.checks || [],
    maintenance: maintenance.maintenance || {},
    foundation: {
      ok: foundation.ok,
      phase: foundation.phase,
      summary: foundation.summary,
      stateStores: foundation.stateStores,
      phase2: foundation.phase2?.summary || {},
      checks: foundation.checks || []
    },
    latestJob: latest.job ? {
      id: latest.job.id,
      status: latest.job.status,
      mode: latest.job.mode || "",
      template: latest.job.template || "",
      currentTask: latest.job.currentTask || "",
      progress: latest.job.progress || null,
      summary: publicJobSummary(latest.job.summary)
    } : null
  };
  if (!current) return redactMaintenanceDiagnostics(baseDiagnostics, state);

  const sourceManifest = readSourceManifestFromCatalog(state);
  const extractionManifest = readExtractionManifestFromCatalog(state);
  const structureSidecar = readStructureSidecarFromCatalog(state);
  const chunkManifest = readChunkManifestFromCatalog(state);
  const indexManifest = readIndexManifestFromCatalog(state);
  const versionManifest = readVersionManifestFromCatalog(state);
  const k12SourceScopeGate = readK12SourceScopeGateFromCatalog(state);
  const k12ExpertReadiness = readK12ExpertReadinessFromCatalog(state);
  const k12StructureReadiness = readK12StructureReadinessFromCatalog(state);
  const k12QueryReadiness = readK12QueryReadinessFromCatalog(state);
  const k12EvaluationManifest = readK12EvaluationManifestFromCatalog(state);
  const evaluation = evaluationDashboard(state);
  const versions = knowledgeBaseVersions(state, { limit: 20 });
  const feedback = queryFeedbackSummary(state, { limit: 0 });
  const queryContract = queryRuntimeContract(state);

  return redactMaintenanceDiagnostics({
    ...baseDiagnostics,
    sourceManifest: {
      ok: sourceManifest.ok,
      knowledgeBase: sourceManifest.knowledgeBase,
      summary: sourceManifest.summary
    },
    extractionManifest: {
      ok: extractionManifest.ok,
      knowledgeBase: extractionManifest.knowledgeBase,
      summary: extractionManifest.summary
    },
    structureSidecar: {
      ok: structureSidecar.ok,
      knowledgeBase: structureSidecar.knowledgeBase,
      summary: structureSidecar.summary
    },
    chunkManifest: {
      ok: chunkManifest.ok,
      knowledgeBase: chunkManifest.knowledgeBase,
      summary: chunkManifest.summary
    },
    indexManifest: {
      ok: indexManifest.ok,
      knowledgeBase: indexManifest.knowledgeBase,
      summary: indexManifest.summary
    },
    versionManifest: {
      ok: versionManifest.ok,
      knowledgeBase: versionManifest.knowledgeBase,
      summary: versionManifest.summary
    },
    k12Expert: {
      sourceScopeGate: {
        ok: k12SourceScopeGate.ok,
        knowledgeBase: k12SourceScopeGate.knowledgeBase,
        summary: k12SourceScopeGate.summary
      },
      readiness: {
        ok: k12ExpertReadiness.ok,
        knowledgeBase: k12ExpertReadiness.knowledgeBase,
        summary: k12ExpertReadiness.summary
      },
      structureReadiness: {
        ok: k12StructureReadiness.ok,
        knowledgeBase: k12StructureReadiness.knowledgeBase,
        summary: k12StructureReadiness.summary
      },
      queryReadiness: {
        ok: k12QueryReadiness.ok,
        knowledgeBase: k12QueryReadiness.knowledgeBase,
        summary: k12QueryReadiness.summary,
        evaluation: k12QueryReadiness.evaluation
      },
      evaluationManifest: {
        ok: k12EvaluationManifest.ok,
        knowledgeBase: k12EvaluationManifest.knowledgeBase,
        summary: k12EvaluationManifest.summary
      }
    },
    evaluationDashboard: {
      ok: evaluation.ok,
      knowledgeBase: evaluation.knowledgeBase,
      summary: evaluation.summary,
      byStatus: evaluation.byStatus,
      categories: evaluation.categories,
      failureGroups: evaluation.failureGroups,
      recentBuilds: evaluation.recentBuilds,
      privacy: evaluation.privacy
    },
    qualityIssues: {
      summary: maintenance.maintenance?.qualityIssues || {
        status: "clear",
        total: 0,
        open: 0,
        resolved: 0,
        bySeverity: {},
        byTargetType: {}
      }
    },
    queryRuntime: {
      apiVersion: queryContract.apiVersion,
      runtime: queryContract.runtime,
      endpoints: {
        query: queryContract.endpoints.query,
        plan: queryContract.endpoints.plan,
        feedback: queryContract.endpoints.feedback,
        feedbackSummary: queryContract.endpoints.feedbackSummary,
        feedbackResolve: queryContract.endpoints.feedbackResolve
      },
      routePlanner: queryContract.routePlanner,
      response: {
        statusValues: queryContract.response.statusValues,
        citationFields: queryContract.response.citationFields
      }
    },
    versions: {
      summary: versions.summary || {},
      items: (versions.versions || []).map((item) => ({
        id: item.id,
        active: item.active,
        status: item.status,
        createdAt: item.createdAt,
        target: item.target,
        sidecar: item.sidecar,
        documents: item.documents,
        write: item.write
      }))
    },
    feedback: {
      total: feedback.feedback?.total || 0,
      open: feedback.feedback?.open || 0,
      positive: feedback.feedback?.positive || 0,
      resolved: feedback.feedback?.resolved || 0,
      byAction: feedback.feedback?.byAction || {},
      openByAction: feedback.feedback?.openByAction || {}
    }
  }, state);
}

function publicJobSummary(summary = {}) {
  const allowedKeys = [
    "knowledgeBaseId",
    "datasetVersionId",
    "includedFiles",
    "excludedFiles",
    "logicalDocuments",
    "sourceParts",
    "pages",
    "blocks",
    "chunks",
    "indexRecords",
    "vectorRecords",
    "reviewRequired",
    "artifactCount",
    "buildId",
    "releaseId"
  ];
  const result = {};
  for (const key of allowedKeys) {
    const value = summary?.[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function redactMaintenanceDiagnostics(value, state = {}) {
  return redactDiagnosticValue(value, "", diagnosticRedactionRoots(state));
}

function redactDiagnosticValue(value, key = "", roots = []) {
  if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, key, roots));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactDiagnosticString(value, key, roots) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactDiagnosticValue(entryValue, entryKey, roots)
    ])
  );
}

function redactDiagnosticString(value, key = "", roots = []) {
  if (/access[_-]?key|secret|token|api[_-]?key|credential/i.test(key)) return "[redacted-secret]";
  const text = String(value || "");
  if (containsDiagnosticRoot(text, roots) || /[A-Za-z]:[\\/]/.test(text) || /(^|[^\w/])\/(?:Users|home)\//.test(text) || /(^|[^\\])\\Users\\/i.test(text)) {
    return "[redacted-local-path]";
  }
  return text;
}

function diagnosticRedactionRoots(state = {}) {
  const candidates = [
    state.projectRoot,
    state.userDataRoot,
    state.runtimeRoot,
    process.env.KNOWMESH_RUNTIME_DIR
  ];
  const roots = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    roots.push(path.resolve(candidate));
  }
  return [...new Set(roots.map(normalizeDiagnosticPathText).filter((item) => item.length >= 4))];
}

function containsDiagnosticRoot(value, roots = []) {
  const text = normalizeDiagnosticPathText(value);
  return roots.some((root) => root && text.includes(root));
}

function normalizeDiagnosticPathText(value) {
  return String(value || "").replaceAll("\\", "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function versionStatusCode(result = {}) {
  if (result.error?.code === "TARGET_RELEASE_NOT_ACTIVATABLE") return 409;
  if (result.error?.code === "TARGET_ALREADY_ACTIVE") return 409;
  if (result.error?.code === "TARGET_RELEASE_REQUIRED") return 409;
  return 404;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be JSON.");
  }
}

function readPackageInfo(projectRoot) {
  const packagePath = path.join(projectRoot, "package.json");
  const fallback = { name: "knowmesh", version: "0.0.0" };
  if (!fs.existsSync(packagePath)) return fallback;
  return { ...fallback, ...JSON.parse(fs.readFileSync(packagePath, "utf8")) };
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}






