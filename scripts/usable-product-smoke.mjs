#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { startLocalService } from "../src/local-service/server.mjs";
import { catalogDatabasePath, openCatalogDatabase, stableJson, workspaceDatabasePath } from "../src/local-service/storage.mjs";
import { auditStaleJsonAuthority, reviewReleaseAssets } from "./generate-release-evidence.mjs";
import { evaluatePackageFiles } from "./verify-package-boundary.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runUsableProductSmoke(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || defaultProjectRoot);
  const scope = String(options.scope || "all");
  const runLaunch = scope === "all" || scope === "launch";
  const runIntake = scope === "all" || scope === "intake";
  const runWebConsole = scope === "all" || scope === "web-console";
  const runDataPackage = scope === "all" || scope === "data-package";
  const checks = [];
  const externalCalls = [];
  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-usable-product-"));
  const pass = (key, message, extra = {}) => checks.push({ key, status: "pass", message, ...extra });
  const fail = (key, message, extra = {}) => checks.push({ key, status: "fail", message: trimMessage(message), ...extra });

  let blocker;
  let service;
  let selectedKnowledgeBaseId = "";
  let userDataRootRemoved = false;

  try {
    if (!runLaunch && !runIntake && !runWebConsole && !runDataPackage) {
      throw new Error(`Unsupported usable product smoke scope: ${scope}`);
    }

    const startService = async (port = 0) => startLocalService({
      projectRoot,
      userDataRoot,
      host: "127.0.0.1",
      port,
      open: false,
      fetchImpl: async (url, requestOptions = {}) => {
        externalCalls.push({ url: String(url), method: String(requestOptions.method || "GET") });
        return jsonResponse({});
      }
    });

    if (runLaunch) {
      blocker = await occupyPort("127.0.0.1");
      service = await startService(blocker.port);

      const health = await httpJson(service.url, "/api/health");
      if (service.requestedPort !== blocker.port || service.portChanged !== true || service.port === blocker.port) {
        throw new Error("Local service did not report fixed-port fallback when the requested port was busy.");
      }
      if (health.portChanged !== true || health.requestedPort !== blocker.port || health.url !== service.url) {
        throw new Error("Health endpoint did not expose the same port fallback evidence as the launcher result.");
      }
      if (!service.url.startsWith("http://127.0.0.1:")) {
        throw new Error("Service did not bind to a supported localhost URL.");
      }
      pass("portFallback", "Fixed-port conflict falls forward and reports requested/actual ports.", {
        requestedPort: blocker.port,
        actualPort: service.port
      });

      const initialKnowledgeBases = await httpJson(service.url, "/api/knowledge-bases");
      if (initialKnowledgeBases.current !== null || initialKnowledgeBases.items?.length !== 0) {
        throw new Error("Fresh usable-product state should not contain an implicit knowledge base.");
      }
      if (fs.existsSync(path.join(userDataRoot, "knowledge-bases", "default"))
        || fs.existsSync(path.join(userDataRoot, "knowledge-bases", "kb-k12-all-subjects"))) {
        throw new Error("Fresh launch created a legacy implicit knowledge-base folder.");
      }
      pass("noImplicitKnowledgeBase", "Fresh launch keeps the workspace empty until the user creates or selects a KB.");

      const integrationDiagnostics = await httpJson(service.url, "/api/integration/diagnostics");
      if (integrationDiagnostics.service?.remoteAccess !== false
        || integrationDiagnostics.cors?.defaultBindHost !== "127.0.0.1"
        || integrationDiagnostics.cors?.defaultRemoteAccess !== false) {
        throw new Error("Launch diagnostics did not stay localhost-only before KB selection.");
      }
      pass("localhostOnly", "Launch diagnostics keep Web Console access bound to localhost by default.");

      const platformRuntime = await httpJson(service.url, "/api/platform/runtime");
      const launchReliability = platformRuntime.launchReliability || {};
      if (launchReliability.status !== "pass"
        || launchReliability.minimumNodeMajor !== 24
        || launchReliability.browserTarget?.localhostOnly !== true
        || launchReliability.privateRuntime?.canPrepare !== true
        || launchReliability.pathMutationGuard?.mutatesPath !== false
        || !Array.isArray(launchReliability.supportedLaunchers)
        || !launchReliability.supportedLaunchers.length) {
        throw new Error("Platform runtime did not expose a passing launch reliability contract.");
      }
      if (launchReliability.supportedLaunchers.some((item) => Object.hasOwn(item, "absolutePath"))) {
        throw new Error("Launch reliability contract exposed local absolute launcher paths.");
      }
      pass("launcherContract", "Platform runtime reports Node 24+, private-runtime launchers, localhost URL, and no PATH mutation.");

      selectedKnowledgeBaseId = await createSelectedKnowledgeBase(service.url, "Launch Reliability KB");

      await service.close();
      service = null;
      service = await startService(0);
      const restored = await httpJson(service.url, "/api/knowledge-bases");
      if (restored.current?.id !== selectedKnowledgeBaseId) {
        throw new Error("Current KB selection did not survive service restart.");
      }
      if (!fs.existsSync(workspaceDatabasePath({ userDataRoot }))) {
        throw new Error("workspace.sqlite was not created for launch state authority.");
      }
      if (legacyJsonStateFiles(userDataRoot).some((file) => fs.existsSync(file))) {
        throw new Error("Legacy JSON state path was recreated during launch.");
      }
      pass("restartSelectionPersistence", "Restart preserves current KB selection through workspace.sqlite and does not recreate JSON-first state.");

      const diagnostics = await httpJson(service.url, `/kb/${selectedKnowledgeBaseId}/api/maintenance/export`);
      assertNoLocalPaths(diagnostics, [projectRoot, userDataRoot]);
      pass("diagnosticRedaction", "Maintenance diagnostic export redacts local absolute paths and sensitive values.");
    }

    if (runIntake) {
      if (!service) service = await startService(0);
      if (!selectedKnowledgeBaseId) selectedKnowledgeBaseId = await createSelectedKnowledgeBase(service.url, "Document Intake KB");
      await proveDocumentIntake(service.url, selectedKnowledgeBaseId, userDataRoot, pass);
    }

    if (runWebConsole) {
      if (!service) service = await startService(0);
      await proveWebConsoleWorkflow(service.url, pass);
    }

    if (runDataPackage) {
      const expectLegacyK12Migration = !selectedKnowledgeBaseId && !fs.existsSync(workspaceDatabasePath({ userDataRoot }));
      writeLegacyK12State(userDataRoot);
      if (!service) service = await startService(0);
      selectedKnowledgeBaseId = await proveDurableDataPackage(service.url, {
        projectRoot,
        userDataRoot,
        expectLegacyK12Migration
      }, pass);
    }

    if (externalCalls.length !== 0) {
      throw new Error("Usable product smoke made external calls.");
    }
    pass("externalCallBoundary", "Usable product smoke made zero external calls.");
  } catch (error) {
    fail("usableProduct", error?.stack || error?.message || String(error));
  } finally {
    if (service) await service.close();
    if (blocker) await closeServer(blocker.server);
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    userDataRootRemoved = !fs.existsSync(userDataRoot);
  }

  return buildResult({ checks, externalCalls, userDataRootRemoved, selectedKnowledgeBaseId });
}

function buildResult({ checks, externalCalls, userDataRootRemoved, selectedKnowledgeBaseId }) {
  const checkPassed = (key) => checks.some((item) => item.key === key && item.status === "pass");
  const launchChecks = ["portFallback", "noImplicitKnowledgeBase", "localhostOnly", "launcherContract", "restartSelectionPersistence", "diagnosticRedaction"];
  const intakeChecks = ["documentIntake"];
  const webConsoleChecks = ["webConsoleWorkflow"];
  const dataPackageChecks = ["durableDataPackage"];
  const launchRan = launchChecks.some(checkPassed);
  const intakeRan = intakeChecks.some(checkPassed);
  const webConsoleRan = webConsoleChecks.some(checkPassed);
  const dataPackageRan = dataPackageChecks.some(checkPassed);
  const ok = checks.length > 0
    && checks.every((item) => item.status === "pass")
    && externalCalls.length === 0
    && userDataRootRemoved;

  return {
    ok,
    kind: "knowmesh.usableProductSmoke",
    generatedAt: new Date().toISOString(),
    checks,
    evidence: {
      launchReliabilityProof: {
        status: launchRan && ok ? "pass" : launchRan ? "fail" : "skip",
        portFallback: checkPassed("portFallback"),
        noImplicitKnowledgeBase: checkPassed("noImplicitKnowledgeBase"),
        localhostOnly: checkPassed("localhostOnly"),
        pathMutationGuard: checkPassed("launcherContract"),
        privateRuntimeLauncher: checkPassed("launcherContract"),
        restartSelectionPersistence: checkPassed("restartSelectionPersistence"),
        workspaceSqliteAuthority: checkPassed("restartSelectionPersistence"),
        noLegacyJsonState: checkPassed("restartSelectionPersistence"),
        diagnosticRedaction: checkPassed("diagnosticRedaction"),
        browserOpenSuppressed: true
      },
      documentIntakeProof: {
        status: intakeRan && ok ? "pass" : intakeRan ? "fail" : "skip",
        parserBoundary: checkPassed("documentIntake"),
        ocrBoundary: checkPassed("documentIntake"),
        rejectedRiskyInputs: checkPassed("documentIntake"),
        catalogConsistency: checkPassed("documentIntake"),
        targetedRerunSourceSet: checkPassed("documentIntake"),
        externalCallsBeforeExecutionZero: checkPassed("documentIntake")
      },
      webConsoleWorkflowProof: {
        status: webConsoleRan && ok ? "pass" : webConsoleRan ? "fail" : "skip",
        createSelectSetup: checkPassed("webConsoleWorkflow"),
        buildExecutionLoop: checkPassed("webConsoleWorkflow"),
        askFeedbackReview: checkPassed("webConsoleWorkflow"),
        documentsVersionsDiagnostics: checkPassed("webConsoleWorkflow"),
        packagePreview: checkPassed("webConsoleWorkflow"),
        noDuplicatePrimaryControls: checkPassed("webConsoleWorkflow"),
        noDirectInternalStateReads: checkPassed("webConsoleWorkflow")
      },
      durableDataPackageProof: {
        status: dataPackageRan && ok ? "pass" : dataPackageRan ? "fail" : "skip",
        workspaceCatalogBackup: checkPassed("durableDataPackage"),
        walFilesExcluded: checkPassed("durableDataPackage"),
        staleJsonCleanup: checkPassed("durableDataPackage"),
        packageExportPreview: checkPassed("durableDataPackage"),
        importPreviewNoWrites: checkPassed("durableDataPackage"),
        versionManifest: checkPassed("durableDataPackage"),
        rollbackPreview: checkPassed("durableDataPackage"),
        rollbackConfirmation: checkPassed("durableDataPackage"),
        packageBoundaryPrivacy: checkPassed("durableDataPackage"),
        externalCallsBeforeExecutionZero: checkPassed("durableDataPackage")
      },
      externalCalls: {
        total: externalCalls.length,
        calls: externalCalls
      },
      cleanup: {
        userDataRootRemoved
      },
      knowledgeBase: {
        selectedKnowledgeBaseId
      }
    }
  };
}

async function proveDurableDataPackage(baseUrl, options, pass) {
  const state = { projectRoot: options.projectRoot, userDataRoot: options.userDataRoot };
  const migrated = await httpJson(baseUrl, "/api/knowledge-bases");
  if (options.expectLegacyK12Migration) {
    const k12 = migrated.items?.find((item) => item.id === "kb-k12-all-subjects");
    if (!k12 || migrated.current?.id !== "kb-k12-all-subjects" || k12.template !== "textbook-cn-k12") {
      throw new Error("Legacy K12 JSON state was not adopted into workspace.sqlite and catalog.sqlite.");
    }
  }
  if (legacyJsonStateArtifacts(options.userDataRoot).some((file) => fs.existsSync(file))) {
    throw new Error("Legacy JSON-first state files were not cleaned after SQLite migration.");
  }

  const created = await httpJson(baseUrl, "/api/public-samples/create", {
    method: "POST",
    body: { sampleId: "general-docs" }
  });
  const knowledgeBaseId = created.knowledgeBase?.id || "";
  if (!created.ok || !knowledgeBaseId) throw new Error("Data/package proof could not create the public sample KB.");
  seedRollbackCandidate(state, knowledgeBaseId);

  const scoped = (pathname) => `/kb/${knowledgeBaseId}${pathname}`;
  const beforeImport = await httpJson(baseUrl, "/api/knowledge-bases");
  const packagePreview = await httpJson(baseUrl, scoped("/api/package/export/preview"));
  if (!packagePreview.ok
    || packagePreview.packageManifest?.kind !== "knowmesh.packageManifest"
    || packagePreview.packageManifest?.privacy?.redacted !== true
    || !packagePreview.packageManifest?.integrity?.manifestHash
    || packagePreview.exportPlan?.executionEnabled !== false
    || !packagePreview.packageManifest?.contents?.includes?.includes("workspaceRegistration")
    || !packagePreview.packageManifest?.contents?.includes?.includes("catalogSummaries")) {
    throw new Error("Package export preview did not expose a redacted workspace/catalog manifest contract.");
  }
  assertNoLocalPaths(packagePreview, [options.projectRoot, options.userDataRoot]);

  const importPreview = await httpJson(baseUrl, scoped("/api/package/import/preview"), {
    method: "POST",
    body: { manifest: packagePreview.packageManifest }
  });
  const afterImport = await httpJson(baseUrl, "/api/knowledge-bases");
  if (!importPreview.ok
    || importPreview.importPlan?.executionEnabled !== false
    || importPreview.importPlan?.writes?.length !== 0
    || !importPreview.checks?.some((item) => item.key === "knowledgeBaseConflict" && item.status === "warn")
    || libraryFingerprint(beforeImport) !== libraryFingerprint(afterImport)) {
    throw new Error("Package import preview wrote state or failed to report the local knowledge-base conflict.");
  }
  assertNoLocalPaths(importPreview, [options.projectRoot, options.userDataRoot]);

  const versionManifest = await httpJson(baseUrl, scoped("/api/version/manifest"));
  const activeBuildId = versionManifest.summary?.activeBuildId || "";
  const rollbackTarget = (versionManifest.versions || []).find((item) => !item.active && item.release)?.buildId || "";
  if (!versionManifest.ok || versionManifest.summary?.builds < 2 || !activeBuildId || !rollbackTarget) {
    throw new Error("Version manifest did not expose an active build plus rollback candidate.");
  }
  assertNoLocalPaths(versionManifest, [options.projectRoot, options.userDataRoot]);

  const versions = await httpJson(baseUrl, scoped("/api/versions"));
  const diff = await httpJson(baseUrl, scoped(`/api/versions/diff?baseBuildId=${encodeURIComponent(activeBuildId)}&targetBuildId=${encodeURIComponent(rollbackTarget)}`));
  const rollbackPreview = await httpJson(baseUrl, scoped("/api/versions/rollback/preview"), {
    method: "POST",
    body: { targetBuildId: rollbackTarget }
  });
  const rollback = await httpJson(baseUrl, scoped("/api/versions/rollback"), {
    method: "POST",
    body: { targetBuildId: rollbackTarget, confirm: true }
  });
  const afterRollback = await httpJson(baseUrl, scoped("/api/version/manifest"));
  if (!versions.ok
    || versions.summary?.total < 2
    || !diff.ok
    || diff.summary?.targetBuildId !== rollbackTarget
    || !rollbackPreview.ok
    || rollbackPreview.requiresConfirmation !== true
    || !rollback.ok
    || rollback.activatedBuildId !== rollbackTarget
    || afterRollback.summary?.activeBuildId !== rollbackTarget) {
    throw new Error("Version diff, rollback preview, or confirmed rollback did not stay catalog-backed and repeatable.");
  }
  assertNoLocalPaths(diff, [options.projectRoot, options.userDataRoot]);
  assertNoLocalPaths(rollbackPreview, [options.projectRoot, options.userDataRoot]);
  assertNoLocalPaths(rollback, [options.projectRoot, options.userDataRoot]);

  const backup = proveWorkspaceCatalogBackup(state, knowledgeBaseId);
  const boundary = provePackageBoundaryPrivacy();
  if (!backup.ok) throw new Error("Workspace/catalog backup proof failed.");
  if (!boundary.ok) throw new Error("Package boundary privacy proof failed.");

  pass("durableDataPackage", "Durable data proof covers SQLite backup hashes, legacy JSON cleanup, redacted package export/import preview, catalog-backed version rollback, and package boundary privacy.", {
    builds: afterRollback.summary?.builds || 0,
    releases: afterRollback.summary?.releases || 0,
    rejectedPackagePaths: boundary.rejectedPackagePaths,
    rejectedReleaseAssets: boundary.rejectedReleaseAssets
  });
  return knowledgeBaseId;
}

function writeLegacyK12State(root) {
  const now = new Date().toISOString();
  const currentRoot = path.join(root, "knowledge-bases", "kb-k12-all-subjects");
  const defaultRoot = path.join(root, "knowledge-bases", "default");
  fs.mkdirSync(currentRoot, { recursive: true });
  fs.mkdirSync(defaultRoot, { recursive: true });
  fs.mkdirSync(path.join(currentRoot, "feedback"), { recursive: true });
  fs.writeFileSync(path.join(root, "knowledge-bases.json"), `${JSON.stringify({
    kind: "knowmesh.knowledgeBaseRegistry",
    apiVersion: "v1",
    currentId: "default",
    updatedAt: now,
    items: [{
      id: "default",
      name: "K12全科知识库",
      template: "textbook-cn-k12",
      status: "active",
      latestJobId: "legacy-k12-job",
      latestJobStatus: "waiting",
      createdAt: now,
      updatedAt: now
    }]
  }, null, 2)}\n`, "utf8");
  const setup = {
    draft: {
      "project.name": "K12全科知识库",
      "project.template": "textbook-cn-k12",
      "setup.mode": "local"
    },
    updatedAt: now
  };
  const jobs = {
    kind: "knowmesh.jobsState",
    latestJobId: "legacy-k12-job",
    updatedAt: now,
    jobs: [{
      id: "legacy-k12-job",
      status: "waiting",
      mode: "local",
      template: "textbook-cn-k12",
      tasks: [{ key: "scan", status: "waiting" }]
    }]
  };
  for (const file of [
    path.join(root, "setup-state.json"),
    path.join(currentRoot, "setup-state.json"),
    path.join(defaultRoot, "setup-state.json")
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(setup, null, 2)}\n`, "utf8");
  }
  for (const file of [
    path.join(root, "jobs-state.json"),
    path.join(currentRoot, "jobs-state.json"),
    path.join(defaultRoot, "jobs-state.json")
  ]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(path.join(currentRoot, "document-overrides.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(currentRoot, "feedback", "query-feedback.jsonl"), "{\"legacy\":true}\n", "utf8");
}

function seedRollbackCandidate(state, knowledgeBaseId) {
  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const now = new Date().toISOString();
    const previousSummary = {
      documents: { included: 1, excluded: 0, attention: 0, pages: 1 },
      extraction: { pages: 1, blocks: 1, failed: 0 },
      structure: { nodes: 1, objects: 1, relations: 0, orphanObjects: 0 },
      chunks: { total: 1, queryable: 1, unlinked: 0 },
      index: { records: 1, written: 1, failed: 0, stale: 0 },
      write: { records: 1, success: 1, failed: 0 },
      evaluation: { passed: 1, failed: 0, review: 0, coveragePercent: 100, passRate: 100 },
      gates: { status: "pass", coveragePercent: 100, passRate: 100, requiredCases: 1, missingCases: 0 },
      queryFeedback: { open: 0, resolved: 0, negative: 0, positive: 0 },
      target: { provider: "local", indexName: "catalog.sqlite" },
      sidecar: { authoritativeStore: "catalog.sqlite", chunks: 1 }
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO build_versions (build_id, status, active, parent_build_id, summary_json, created_at, updated_at)
        VALUES ('build-public-general-previous', 'published', 0, '', ?, ?, ?)
        ON CONFLICT(build_id) DO UPDATE SET
          status = excluded.status,
          active = excluded.active,
          summary_json = excluded.summary_json,
          updated_at = excluded.updated_at
      `).run(stableJson(previousSummary), now, now);
      db.prepare(`
        INSERT INTO release_manifests (release_id, build_id, status, manifest_path, summary_json, created_at, updated_at)
        VALUES ('release-public-general-previous', 'build-public-general-previous', 'published', 'published/release-public-general-previous/manifest.json', ?, ?, ?)
        ON CONFLICT(release_id) DO UPDATE SET
          status = excluded.status,
          manifest_path = excluded.manifest_path,
          summary_json = excluded.summary_json,
          updated_at = excluded.updated_at
      `).run(stableJson(previousSummary), now, now);
    })();
  } finally {
    db.close();
  }
}

function proveWorkspaceCatalogBackup(state, knowledgeBaseId) {
  const workspaceDb = workspaceDatabasePath(state);
  const catalogDb = catalogDatabasePath(state, knowledgeBaseId);
  if (!fs.existsSync(workspaceDb) || !fs.existsSync(catalogDb)) return { ok: false };
  assertSqliteMigrations(state, knowledgeBaseId);
  const backupRoot = path.join(state.userDataRoot, "maintenance-backup-proof");
  const workspaceBackup = path.join(backupRoot, "workspace.sqlite");
  const catalogBackup = path.join(backupRoot, "knowledge-base", "catalog.sqlite");
  fs.mkdirSync(path.dirname(workspaceBackup), { recursive: true });
  fs.mkdirSync(path.dirname(catalogBackup), { recursive: true });
  fs.copyFileSync(workspaceDb, workspaceBackup);
  fs.copyFileSync(catalogDb, catalogBackup);
  const ok = sha256File(workspaceDb) === sha256File(workspaceBackup)
    && sha256File(catalogDb) === sha256File(catalogBackup)
    && !fs.existsSync(`${workspaceBackup}-wal`)
    && !fs.existsSync(`${catalogBackup}-wal`);
  return { ok };
}

function assertSqliteMigrations(state, knowledgeBaseId) {
  const workspace = new Database(workspaceDatabasePath(state), { readonly: true });
  try {
    if (workspace.prepare("SELECT count(*) AS count FROM migration_history").get().count < 1) {
      throw new Error("workspace.sqlite migration history is empty.");
    }
  } finally {
    workspace.close();
  }
  const catalog = openCatalogDatabase(state, knowledgeBaseId);
  try {
    if (catalog.prepare("SELECT count(*) AS count FROM migration_history").get().count < 1) {
      throw new Error("catalog.sqlite migration history is empty.");
    }
  } finally {
    catalog.close();
  }
}

function provePackageBoundaryPrivacy() {
  const unsafePackage = evaluatePackageFiles([
    "workspace/workspace.sqlite",
    "workspace/workspace.sqlite-wal",
    "workspace/workspace.sqlite-shm",
    "knowledge-bases/sample-general-docs/catalog.sqlite",
    "knowledge-bases/sample-general-docs/catalog.sqlite-wal",
    ".runtime/service.out.log",
    ".env",
    "artifacts/sources/private-source.pdf",
    "src/local-service/server.test.mjs"
  ]);
  const safePackage = evaluatePackageFiles([
    "README.md",
    "docs/current-design.md",
    "examples/public-samples/general-docs/source/operations-handbook.md",
    "src/cli/knowmesh.mjs",
    "src/sdk/index.mjs"
  ]);
  const unsafeAssets = reviewReleaseAssets([
    "workspace/workspace.sqlite",
    "workspace/workspace.sqlite-wal",
    "knowledge-bases/sample-general-docs/catalog.sqlite",
    ".env",
    "logs/service.log",
    "output/playwright/page.yml"
  ]);
  const safeAssets = reviewReleaseAssets([
    "README.md",
    "docs/release-operations.zh-CN.md",
    "assets/social/knowmesh-social-preview.png"
  ]);
  const staleJson = auditStaleJsonAuthority([
    "workspace/workspace.json",
    "knowledge-bases/sample/setup.json",
    "knowledge-bases/sample/query-feedback.jsonl"
  ]);
  const allowedJson = auditStaleJsonAuthority([
    "exports/sample/release-export.json",
    "artifacts/audit/review-report.json"
  ]);
  return {
    ok: unsafePackage.ok === false
      && safePackage.ok === true
      && unsafeAssets.ok === false
      && safeAssets.ok === true
      && staleJson.ok === false
      && allowedJson.ok === true
      && unsafePackage.rejected.some((item) => item.endsWith(".sqlite-wal"))
      && unsafePackage.rejected.some((item) => item.endsWith(".sqlite-shm"))
      && unsafeAssets.rejected.some((item) => item.reason === "sqlite")
      && staleJson.rejected.some((item) => item.reason === "workspace-json-authority")
      && staleJson.rejected.some((item) => item.reason === "kb-json-authority")
      && staleJson.rejected.some((item) => item.reason === "jsonl-search-authority"),
    rejectedPackagePaths: unsafePackage.rejected.length,
    rejectedReleaseAssets: unsafeAssets.rejected.length
  };
}

function libraryFingerprint(library) {
  return (library.items || [])
    .map((item) => `${item.id}:${item.template}:${item.status}:${item.current ? "current" : ""}`)
    .sort()
    .join("|");
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function proveWebConsoleWorkflow(baseUrl, pass) {
  const homeHtml = await httpText(baseUrl, "/");
  assertText(homeHtml, /data-knowledge-base-create|新建知识库|Create Knowledge Base/i, "Home should expose create/select entry.");
  assertText(homeHtml, /Public General Sample|先用公开样例试一下/i, "Home should expose safe public sample entry.");

  const created = await httpJson(baseUrl, "/api/public-samples/create", {
    method: "POST",
    body: { sampleId: "general-docs" }
  });
  const knowledgeBaseId = created.knowledgeBase?.id || "";
  if (!created.ok || !knowledgeBaseId) throw new Error("Web Console proof could not create the public sample KB.");

  const scoped = (pathname) => `/kb/${knowledgeBaseId}${pathname}`;
  const pages = {
    home: homeHtml,
    manager: await httpText(baseUrl, "/knowledge-bases"),
    setup: await httpText(baseUrl, scoped("/setup/project")),
    build: await httpText(baseUrl, scoped("/build")),
    execution: await httpText(baseUrl, scoped("/build/execution")),
    documents: await httpText(baseUrl, scoped("/maintain/documents")),
    ask: await httpText(baseUrl, scoped("/use/ask")),
    feedbackReview: await httpText(baseUrl, scoped("/maintain/feedback")),
    versions: await httpText(baseUrl, scoped("/maintain/versions")),
    diagnostics: await httpText(baseUrl, scoped("/maintain/diagnostics"))
  };

  const query = await httpJson(baseUrl, scoped("/api/query"), {
    method: "POST",
    body: { question: "What review cadence and rollback rule does the public sample require?" }
  });
  if (!query.ok || query.status !== "answered" || !Array.isArray(query.citations) || query.citations.length === 0) {
    throw new Error("Web Console Query Runtime proof did not get a cited sample answer.");
  }
  const feedback = await httpJson(baseUrl, scoped("/api/query/feedback"), {
    method: "POST",
    body: {
      action: "wrong_citation",
      question: "What review cadence and rollback rule does the public sample require?",
      answerStatus: query.status,
      resultKey: query.resultKey,
      citationRefs: query.citations.slice(0, 1),
      message: "Usable product smoke: route feedback to maintenance."
    }
  });
  const review = await httpJson(baseUrl, scoped("/api/maintenance/review?issueType=wrong_citation&limit=5"));
  const packagePreview = await httpJson(baseUrl, scoped("/api/package/export/preview"));
  const versionManifest = await httpJson(baseUrl, scoped("/api/version/manifest"));
  if (!feedback.ok || !review.review?.items?.some((item) => item.source === "query_feedback")) {
    throw new Error("Web Console feedback did not reach maintenance review.");
  }
  if (!packagePreview.ok || !packagePreview.exportPlan) throw new Error("Package preview was not available for the Web Console proof.");
  if (!versionManifest.ok) throw new Error("Version manifest was not available for the Web Console proof.");

  const contracts = [
    [/knowledge-base-manager|data-global-knowledge-base-switcher|切换知识库|Switch Knowledge Base/i, pages.manager, "create/select manager"],
    [/data-folder-path-input|project-path-grid|资料目录|Source folder/i, pages.setup, "setup project"],
    [/data-build-action="preview-scan"|api\/scan\/preview/i, pages.build, "scan preview"],
    [/data-build-action="preview-run"|api\/plan\/preview/i, pages.build, "plan preview"],
    [/data-build-action="create-job"|api\/jobs\/confirm|Create Task|创建任务/i, pages.build, "create task"],
    [/data-job-action="run"|api\/jobs\/latest\/run|Run Task|运行任务/i, pages.execution, "execution run"],
    [/data-document-list|data-catalog-search|maintain\/documents/i, pages.documents, "documents"],
    [/data-query-runtime-panel|api\/query|Query Runtime/i, pages.ask, "ask"],
    [/data-query-feedback|api\/maintenance\/review|Answer Feedback|问答反馈/i, pages.feedbackReview, "feedback review"],
    [/api\/versions|api\/versions\/diff|rollback|回滚/i, pages.versions, "versions"],
    [/api\/maintenance\/status|api\/package\/export\/preview|Diagnostics Export|维护诊断/i, pages.diagnostics, "diagnostics and package"]
  ];
  for (const [pattern, html, label] of contracts) {
    assertText(html, pattern, `Missing Web Console workflow surface: ${label}`);
  }

  assertNoDuplicatePrimaryControls(pages);
  assertNoDirectInternalStateReads(pages);
  pass("webConsoleWorkflow", "Web Console pages prove create/select/setup/build/execution/ask/feedback/documents/versions/diagnostics/package workflow surfaces without duplicate primary controls or direct internal-state reads.", {
    pages: Object.keys(pages).length,
    feedbackItems: review.review.items.length,
    packageFiles: packagePreview.exportPlan?.files?.length || 0
  });
}

async function createSelectedKnowledgeBase(baseUrl, name) {
  const created = await httpJson(baseUrl, "/api/knowledge-bases", {
    method: "POST",
    body: { name, template: "general-docs" }
  });
  const knowledgeBaseId = created.knowledgeBase?.id || "";
  if (!created.ok || !knowledgeBaseId || created.current?.id !== knowledgeBaseId) {
    throw new Error(`${name} creation did not select the new workspace.sqlite record.`);
  }
  return knowledgeBaseId;
}

async function proveDocumentIntake(baseUrl, knowledgeBaseId, root, pass) {
  const sourceRoot = path.join(root, "intake-source");
  const workspaceRoot = path.join(root, "intake-workspace");
  writeIntakeSources(sourceRoot);
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const api = (pathname) => `/kb/${knowledgeBaseId}${pathname}`;
  const draft = {
    "setup.mode": "local",
    "project.template": "general-docs",
    "project.source": sourceRoot,
    "project.workspace": workspaceRoot,
    "retrieval.profile": "balanced"
  };
  await httpJson(baseUrl, api("/api/setup/draft"), { method: "POST", body: { draft } });
  const scan = await httpJson(baseUrl, api("/api/scan/preview"), {
    method: "POST",
    body: { mode: "local", template: "general-docs", draft }
  });
  const sourceManifest = await httpJson(baseUrl, api("/api/source/manifest"));
  const documents = await httpJson(baseUrl, api("/api/documents"));
  const rerunPreview = await httpJson(baseUrl, api("/api/rerun/preview"), {
    method: "POST",
    body: { type: "document", relativePath: "lesson.pdf" }
  });
  const preparation = scan.preview?.sourcePreparation || {};
  const diagnostics = scan.preview?.intakeDiagnostics || {};
  const previewPaths = (scan.preview?.documents || []).map((item) => item.relativePath).sort();
  const manifestPaths = (sourceManifest.documents || []).map((item) => item.relativePath).sort();
  const documentPaths = (documents.documents || []).map((item) => item.relativePath).sort();

  if (preparation.kind !== "knowmesh.sourcePreparationPlan"
    || preparation.summary?.directText !== 1
    || preparation.summary?.office !== 1
    || preparation.summary?.autoConvert !== 1
    || preparation.summary?.ocr !== 2
    || preparation.summary?.unsupported !== 1) {
    throw new Error("Document intake preparation plan did not classify local source formats correctly.");
  }
  if (diagnostics.externalCallsBeforeExecution !== 0
    || !diagnostics.reviewQueue?.some((item) => item.relativePath === "legacy.wps" && item.userFixableErrors?.some((fix) => fix.key === "legacyConverterMissing"))
    || !diagnostics.reviewQueue?.some((item) => item.relativePath === "scan.png" && item.userFixableErrors?.some((fix) => fix.key === "localOcrMissing"))
    || !diagnostics.rejectedFiles?.some((item) => item.relativePath === "unsafe.exe")) {
    throw new Error("Document intake diagnostics did not expose parser/OCR/rejected-source review items.");
  }
  if (JSON.stringify(previewPaths) !== JSON.stringify(["legacy.wps", "lesson.pdf", "notes.md", "scan.png", "worksheet.docx"])
    || JSON.stringify(manifestPaths) !== JSON.stringify(previewPaths)
    || JSON.stringify(documentPaths) !== JSON.stringify(previewPaths)) {
    throw new Error("Catalog-backed source manifest and document inventory did not share the scan preview source set.");
  }
  if (!rerunPreview.ok || rerunPreview.documents?.[0]?.relativePath !== "lesson.pdf") {
    throw new Error("Targeted rerun preview did not resolve the catalog-backed source document.");
  }

  pass("documentIntake", "Local document intake proves parser/OCR boundaries, rejected risky inputs, catalog consistency, targeted rerun source set, and zero external calls before execution.", {
    sourceDocuments: previewPaths.length,
    reviewRequired: diagnostics.summary?.reviewRequired || 0,
    rejectedFiles: diagnostics.rejectedFiles?.length || 0
  });
}

function writeIntakeSources(sourceRoot) {
  const files = {
    "lesson.pdf": "%PDF local placeholder",
    "worksheet.docx": "modern office placeholder",
    "legacy.wps": "wps placeholder",
    "scan.png": "image placeholder",
    "notes.md": "# Notes\nLocal text.",
    "unsafe.exe": "binary placeholder"
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(sourceRoot, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
  }
}

async function occupyPort(host) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const server = net.createServer();
    const port = 20000 + Math.floor(Math.random() * 30000);
    try {
      await listen(server, host, port);
      return { server, port };
    } catch (error) {
      server.removeAllListeners();
      if (!["EADDRINUSE", "EACCES"].includes(error?.code)) throw error;
    }
  }
  throw new Error("Could not reserve a usable fixed port for fallback testing.");
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

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
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

async function httpText(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl));
  const text = await response.text();
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return text;
}

function assertText(text, pattern, message) {
  if (!pattern.test(String(text || ""))) throw new Error(message);
}

function assertNoDuplicatePrimaryControls(pages) {
  for (const [name, html] of Object.entries(pages)) {
    for (const attribute of [
      "data-build-action=\"preview-scan\"",
      "data-build-action=\"preview-run\"",
      "data-build-action=\"create-job\"",
      "data-query-runtime-run",
      "data-api-autoload=\"maintenance-status\"",
      "id=\"sidebarToggle\""
    ]) {
      const count = countOccurrences(html, attribute);
      if (count > 1) throw new Error(`${name} has duplicate primary control ${attribute}.`);
    }
    if (/href="#"|javascript:/i.test(html)) throw new Error(`${name} includes a placeholder or javascript link.`);
  }
}

function assertNoDirectInternalStateReads(pages) {
  const html = Object.values(pages).join("\n");
  const internalMatch = html.match(/\b(source_documents|document_versions|workspace_state|knowledge_bases)\b/i)
    || html.match(/\bSELECT\s+[\s\S]{0,160}\s+FROM\b/);
  if (internalMatch) {
    throw new Error(`Web Console page exposed direct internal table or SQL wording: ${internalMatch[0]}`);
  }
  if (/knowledge-bases\.json|setup-state\.json|jobs-state\.json/i.test(html)) {
    throw new Error("Web Console page exposed legacy JSON-first state paths.");
  }
}

function countOccurrences(text, value) {
  return String(text || "").split(value).length - 1;
}

function legacyJsonStateFiles(root) {
  return [
    path.join(root, "knowledge-bases.json"),
    path.join(root, "setup-state.json"),
    path.join(root, "jobs-state.json")
  ];
}

function legacyJsonStateArtifacts(root) {
  return [
    ...legacyJsonStateFiles(root),
    path.join(root, "knowledge-bases", "default"),
    path.join(root, "knowledge-bases", "kb-k12-all-subjects", "setup-state.json"),
    path.join(root, "knowledge-bases", "kb-k12-all-subjects", "jobs-state.json"),
    path.join(root, "knowledge-bases", "kb-k12-all-subjects", "document-overrides.json"),
    path.join(root, "knowledge-bases", "kb-k12-all-subjects", "feedback", "query-feedback.jsonl")
  ];
}

function assertNoLocalPaths(value, roots = []) {
  const text = JSON.stringify(value);
  for (const root of roots.filter(Boolean)) {
    if (text.includes(root)) throw new Error("Diagnostic export leaked a local absolute path.");
  }
  if (/[A-Za-z]:[\\/]/.test(text) || /(^|[^\\])\\Users\\/i.test(text) || /(^|[^\w/])\/(?:Users|home)\//.test(text)) {
    throw new Error("Diagnostic export leaked a local absolute path.");
  }
  if (/sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}|"(?:accessKeySecret|apiKey|token|secret)"\s*:\s*"(?!\[redacted)/i.test(text)) {
    throw new Error("Diagnostic export leaked a credential-like value.");
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
  const result = await runUsableProductSmoke();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
