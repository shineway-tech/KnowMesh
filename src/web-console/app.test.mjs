import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appSourcePath = path.join(projectRoot, "src/web-console/app.js");
const pagesSourcePath = path.join(projectRoot, "src/web-console/pages.mjs");
const stylesSourcePath = path.join(projectRoot, "src/web-console/styles.css");

function functionBody(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} should exist`);
  const signatureEnd = source.indexOf(")", start);
  assert.notEqual(signatureEnd, -1, `${name} should have a signature`);
  const open = source.indexOf("{", signatureEnd);
  assert.notEqual(open, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  assert.fail(`${name} body should close`);
}

test("document management panel is wired into console initialization", () => {
  const source = fs.readFileSync(appSourcePath, "utf8");
  const bindControlsBody = functionBody(source, "bindControls");

  assert.match(bindControlsBody, /\bbindDocumentManagement\(\);/);
  assert.match(bindControlsBody, /\bbindDocumentAssetViewer\(\);/);
});

test("document management supports server paging, full-text assets, and file reveal actions", () => {
  const source = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const bindDocumentsBody = functionBody(source, "bindDocumentManagement");

  assert.match(bindDocumentsBody, /URLSearchParams/);
  assert.match(bindDocumentsBody, /window\.location\.search/);
  assert.match(bindDocumentsBody, /state\.query = initialQuery/);
  assert.match(bindDocumentsBody, /data-document-load-more/);
  assert.match(bindDocumentsBody, /data-document-result-summary/);
  assert.match(source, /function bindDocumentAssetViewer/);
  assert.match(source, /documentAssetHref/);
  assert.match(source, /data-document-asset-viewer/);
  assert.match(pagesSource, /renderDocumentAssetViewer/);
  assert.match(pagesSource, /\/api\/documents\/asset/);
  assert.match(pagesSource, /\/maintain\/document/);
  assert.match(source, /data-document-action=\"reveal\"/);
  assert.match(pagesSource, /document-management-command/);
  assert.doesNotMatch(pagesSource, /document-management-head/);
});

test("document management exposes catalog evidence search through the shared search API", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const bindControlsBody = functionBody(appSource, "bindControls");

  assert.match(bindControlsBody, /\bbindCatalogEvidenceSearch\(\);/);
  assert.match(pagesSource, /data-catalog-search/);
  assert.match(pagesSource, /data-catalog-search-endpoint="\$\{apiEndpoint\(service, "\/api\/search"\)\}"/);
  assert.match(pagesSource, /catalogSearchTitle/);
  assert.match(pagesSource, /catalogSearchPlaceholder/);
  assert.match(pagesSource, /catalogSearchIncludeReview/);
  assert.match(pagesSource, /data-catalog-search-document/);
  assert.match(pagesSource, /data-catalog-search-source-type/);
  assert.match(pagesSource, /data-catalog-search-page-start/);
  assert.match(pagesSource, /data-catalog-search-page-end/);
  assert.match(pagesSource, /data-catalog-search-quality-state/);
  assert.match(pagesSource, /data-catalog-search-structure-node/);
  assert.match(appSource, /function bindCatalogEvidenceSearch/);
  assert.match(appSource, /function renderCatalogSearchResults/);
  assert.match(appSource, /function renderCatalogSearchItem/);
  assert.match(appSource, /URLSearchParams/);
  assert.match(appSource, /data-catalog-search-include-review/);
  assert.match(appSource, /catalogSearchOptionalField/);
  assert.match(appSource, /documentId/);
  assert.match(appSource, /sourceType/);
  assert.match(appSource, /pageStart/);
  assert.match(appSource, /pageEnd/);
  assert.match(appSource, /structureNodeId/);
  assert.match(appSource, /data-catalog-search-result/);
  assert.match(appSource, /data-catalog-search-open/);
  assert.match(appSource, /qualityState/);
  assert.match(appSource, /citation\.pageNumber/);
  assert.match(appSource, /rankingSignals/);
  assert.match(appSource, /data-catalog-search-evidence-state/);
  assert.match(appSource, /catalogSearchCitationReady/);
  assert.match(appSource, /catalogSearchNeedsCitation/);
  assert.match(appSource, /links\?\.evidence/);
  assert.match(stylesSource, /\.catalog-search-panel/);
  assert.match(stylesSource, /\.catalog-search-results/);
  assert.match(stylesSource, /\.catalog-search-item/);
  assert.match(stylesSource, /\.catalog-search-meta/);
  assert.match(stylesSource, /\.catalog-search-signals/);
});



test("document row keeps rare actions in a more menu with confirmations and i18n", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const rowBody = functionBody(appSource, "renderDocumentRow");
  const attrBody = functionBody(appSource, "documentActionAttributes");
  const bindBody = functionBody(appSource, "bindDocumentManagement");

  assert.match(rowBody, /data-document-menu-toggle/);
  assert.match(rowBody, /data-document-menu/);
  assert.match(rowBody, /document-row-version/);
  assert.match(rowBody, /document-open-action/);
  assert.match(rowBody, /openAsset/);
  assert.match(rowBody, /documentDisplayVersionLabel/);
  assert.match(attrBody, /data-document-updated-at/);
  assert.match(rowBody, /data-document-action="copy-path"/);
  assert.match(rowBody, /action === "exclude"/);
  assert.match(rowBody, /action === "restore"/);
  assert.match(rowBody, /document-menu-group--danger/);
  assert.match(bindBody, /closeDocumentMenus/);
  assert.match(bindBody, /copyTextBestEffort/);
  assert.match(bindBody, /showConfirmDialog/);
  assert.match(pagesSource, /moreActions/);
  assert.match(pagesSource, /copyPath/);
  assert.doesNotMatch(rowBody, /data-document-action="details"/);
  assert.doesNotMatch(bindBody, /showDocumentDetailsDialog/);
  assert.match(pagesSource, /pathCopied/);
  assert.match(pagesSource, /version/);
});

test("ask page uses the public Query Runtime instead of the legacy validation endpoint", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(pagesSource, /renderQueryRuntimePanel/);
  assert.match(pagesSource, /variant: "ask"/);
  assert.match(pagesSource, /data-query-runtime-panel/);
  assert.match(pagesSource, /data-query-runtime-question/);
  assert.match(pagesSource, /data-query-runtime-run/);
  assert.match(pagesSource, /data-query-endpoint="\$\{escapeHtml\(apiEndpoint\(service, "\/api\/query"\)\)\}"/);
  assert.match(pagesSource, /data-query-feedback-endpoint="\$\{escapeHtml\(apiEndpoint\(service, "\/api\/query\/feedback"\)\)\}"/);
  assert.match(pagesSource, /renderUseKnowledgeTabs\("ask", service\)/);
  assert.doesNotMatch(pagesSource, /renderUseKnowledgePath/);
  assert.doesNotMatch(pagesSource, /class="use-runtime-path"/);
  assert.doesNotMatch(pagesSource, /useKnowledgePath\.items/);
  assert.doesNotMatch(pagesSource, /askPanel\.sameRuntimeTitle/);
  assert.match(appSource, /function bindQueryRuntimePanels/);
  assert.match(appSource, /renderQueryRuntimeResult/);
  assert.match(appSource, /data-query-feedback-action/);
  assert.match(appSource, /\/api\/query\/feedback/);
});

test("task pages use user-facing local output wording", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(appSource, /本地产物/);
  assert.match(appSource, /Local outputs/);
  assert.match(pagesSource, /查看本地产物/);
  assert.match(pagesSource, /View Local Outputs/);
  assert.doesNotMatch(`${appSource}\n${pagesSource}`, /查看处理报告|View Processing Report|Processing report/);
});

test("welcome header and console pages use the shared console control", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const welcomeState = functionBody(pagesSource, "buildWelcomeState");
  const welcomePage = functionBody(pagesSource, "renderWelcomePage");
  const setupPage = functionBody(pagesSource, "renderSetupPage");

  assert.match(pagesSource, /welcome-console-link/);
  assert.match(pagesSource, /welcome\.headerConsole/);
  assert.match(pagesSource, /includeConsole: options\.includeConsole !== false/);
  assert.match(welcomePage, /renderWelcomeTopControls\(consoleHref, \{ includeConsole: true \}\)/);
  assert.match(setupPage, /renderTopControls\(service, \{ includeConsole: true \}\)/);
  assert.doesNotMatch(welcomeState, /secondaryKey = "welcome\.actions\.manage"/);
  assert.doesNotMatch(`${pagesSource}\n${stylesSource}`, /topbar-console-link/);
  assert.doesNotMatch(stylesSource, /\.console-link\b/);
});

test("global header controls keep one shared order and no legacy segmented controls", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const controlsStart = pagesSource.indexOf("function renderWelcomeTopControls");
  const controlsEnd = pagesSource.indexOf("function renderWelcomeSecondaryAction", controlsStart);
  assert.notEqual(controlsStart, -1, "renderWelcomeTopControls should exist");
  assert.notEqual(controlsEnd, -1, "renderWelcomeTopControls should have a stable next function boundary");
  const controlsBody = pagesSource.slice(controlsStart, controlsEnd);
  const sharedControlsStart = pagesSource.indexOf("function renderTopControls");
  const sharedControlsEnd = pagesSource.indexOf("function renderWelcomeArchitectureStage", sharedControlsStart);
  assert.notEqual(sharedControlsStart, -1, "renderTopControls should exist");
  assert.notEqual(sharedControlsEnd, -1, "renderTopControls should have a stable next function boundary");
  const sharedControlsBody = pagesSource.slice(sharedControlsStart, sharedControlsEnd);
  const controlsReturn = controlsBody.slice(controlsBody.indexOf("return `"));

  assert.ok(
    controlsReturn.indexOf("${consoleLink}") < controlsReturn.indexOf("welcome-lang-control"),
    "console control should render before language so the right side reads theme, language, console"
  );
  assert.ok(
    controlsReturn.indexOf("welcome-lang-control") < controlsReturn.indexOf("welcome-theme-control"),
    "language control should render before theme so theme stays at the far right"
  );
  assert.match(sharedControlsBody, /renderWelcomeTopControls\(consoleHref/);
  assert.match(stylesSource, /\.welcome-console-link/);
  assert.match(stylesSource, /\.welcome-lang-control/);
  assert.match(stylesSource, /\.welcome-theme-control/);
  assert.doesNotMatch(stylesSource, /\.segmented\b/);
  assert.doesNotMatch(stylesSource, /\.language-control\b/);
  assert.doesNotMatch(stylesSource, /\.theme-control\b/);
});

test("global clickable targets use canonical routes and accessible controls", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.doesNotMatch(pagesSource, /href="#"/);
  assert.doesNotMatch(pagesSource, /javascript:/);
  assert.doesNotMatch(pagesSource, /href="\/execution"/);
  assert.doesNotMatch(pagesSource, /href="\/build\/scan"/);
  assert.doesNotMatch(pagesSource, /href="\/build\/plan"/);
  assert.match(pagesSource, /pageHref\(service, "\/build\/execution"\)/);
  assert.match(pagesSource, /id="sidebarToggle"[^>]*aria-label="折叠菜单"/);
  assert.match(pagesSource, /data-global-disclosure/);
  assert.ok(appSource.includes('querySelectorAll("details[data-global-disclosure]")'));
});

test("setup choice cards use delegated full-card clicks", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const bindControlsBody = functionBody(appSource, "bindControls");

  assert.match(bindControlsBody, /document\.addEventListener\("click"/);
  assert.match(bindControlsBody, /event\.target\.closest\("\[data-mode-option\]"\)/);
  assert.match(bindControlsBody, /event\.target\.closest\("\[data-template-option\]"\)/);
  assert.match(bindControlsBody, /event\.target\.closest\("\[data-account-method-card\]"\)/);
  assert.doesNotMatch(bindControlsBody, /querySelectorAll\("\[data-mode-option\]"\)\.forEach/);
  assert.doesNotMatch(bindControlsBody, /querySelectorAll\("\[data-template-option\]"\)\.forEach/);
  assert.doesNotMatch(bindControlsBody, /querySelectorAll\("\[data-account-method-card\]"\)\.forEach/);
  assert.match(stylesSource, /\.mode-choice-card:focus-visible/);
  assert.match(stylesSource, /\.template-card:focus-visible/);
  assert.match(stylesSource, /\.mode-choice-card[\s\S]*cursor: pointer/);
  assert.match(stylesSource, /\.template-card[\s\S]*cursor: pointer/);
  assert.doesNotMatch(appSource, /scheduleDraftSync/);
});

test("setup mode changes preserve configured knowledge base progress", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const setModeBody = functionBody(appSource, "setMode");

  assert.match(appSource, /function inferCompletedSetupStepsFromDraft/);
  assert.match(setModeBody, /inferCompletedSetupStepsFromDraft\(draftState, mode\)/);
  assert.match(setModeBody, /setupConfigurationReady\(inferred, mode\)/);
  assert.match(setModeBody, /writeSetupCompleted\(inferred\)/);
  assert.match(setModeBody, /keepSetupCompletedThrough\("mode"\)/);
});

test("general setup does not require K12 source-scope fields", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const requiredFieldsBody = functionBody(appSource, "requiredSetupFieldsForStep");
  const inferBody = functionBody(appSource, "inferCompletedSetupStepsFromDraft");
  const serverTemplateBody = functionBody(appSource, "inferSetupTemplateFromServer");
  const initialTemplateBody = functionBody(appSource, "inferInitialSetupTemplate");
  const sourceScopeBody = functionBody(appSource, "sourceScopeLooksComplete");

  assert.match(requiredFieldsBody, /sourceScopeRequiredForTemplate\(settings\.template\)/);
  assert.match(inferBody, /draft\["project\.template"\]/);
  assert.match(inferBody, /sourceScopeLooksComplete\(draft, template\)/);
  assert.match(serverTemplateBody, /draft\["project\.template"\]/);
  assert.match(initialTemplateBody, /draft\["project\.template"\]/);
  assert.match(appSource, /function sourceScopeRequiredForTemplate/);
  assert.match(sourceScopeBody, /if \(!sourceScopeRequiredForTemplate\(templateId\)\) return true/);
});

test("fresh console skips setup state fetch until a knowledge base exists", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");

  assert.match(appSource, /const hasInitialKnowledgeBase = Boolean\(pageState\.knowledgeBases\?\.current\?\.id\);/);
  assert.match(appSource, /const setupStateRequest = hasInitialKnowledgeBase \? loadSetupState\(\) : Promise\.resolve\(\);/);
  assert.doesNotMatch(appSource, /loadSetupState\(\)\.finally/);
});

test("console navigation is grouped by user lifecycle instead of flat feature modules", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /const consoleNavSections = \[/);
  assert.match(pagesSource, /key: "build-workflow"/);
  assert.match(pagesSource, /key: "use-knowledge"/);
  assert.match(pagesSource, /key: "maintain-knowledge"/);
  assert.match(pagesSource, /key: "settings"/);
  assert.match(pagesSource, /renderConsoleNavSections/);
  assert.match(pagesSource, /renderBuildKnowledgeTabs/);
  assert.match(pagesSource, /renderUseKnowledgeTabs/);
  assert.match(pagesSource, /renderMaintainKnowledgeTabs/);
  assert.match(pagesSource, /\/build\/execution/);
  assert.match(pagesSource, /\/use\/ask/);
  assert.match(pagesSource, /\/use\/integration/);
  assert.match(pagesSource, /\/use\/api-docs/);
  assert.match(pagesSource, /\/use\/feedback/);
  assert.match(pagesSource, /\/maintain\/documents/);
  assert.match(pagesSource, /\/maintain\/diagnostics/);
  assert.doesNotMatch(pagesSource, /aliases:/);
  assert.doesNotMatch(pagesSource, /primaryConsoleNavKeys/);
  assert.doesNotMatch(pagesSource, /renderConsoleNavSubItem/);
  assert.match(stylesSource, /\.nav-section/);
  assert.doesNotMatch(stylesSource, /\.nav-sub-list/);
  assert.doesNotMatch(stylesSource, /data-sidebar="collapsed"\] \.nav-sub-list/);
});

test("welcome page uses user-facing lifecycle wording instead of internal layer names", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(pagesSource, /"资料进入"/);
  assert.match(pagesSource, /"生成知识"/);
  assert.match(pagesSource, /"质量复核"/);
  assert.match(pagesSource, /"可追溯回答"/);
  assert.match(pagesSource, /"版本维护"/);
  assert.match(pagesSource, /"应用接入"/);
  assert.doesNotMatch(pagesSource, /\["CORE", "KnowMesh Core"/);
  assert.doesNotMatch(pagesSource, /\["EXPERT", "KnowMesh Expert"/);
  assert.doesNotMatch(pagesSource, /\["QUALITY", "Quality Gates"/);
  assert.doesNotMatch(pagesSource, /\["TRACE", "Traceable Knowledge"/);
  assert.doesNotMatch(pagesSource, /\["VERSION", "Versioned Knowledge"/);
  assert.doesNotMatch(pagesSource, /\["ASSETS", "Knowledge Assets"/);
});

test("knowledge-base switcher uses switch wording instead of duplicate management copy", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(pagesSource, /switchContext: "切换知识库"/);
  assert.match(pagesSource, /switchContext: "Switch Knowledge Base"/);
  assert.match(pagesSource, /manage: "管理"/);
  assert.match(pagesSource, /<strong data-i18n="knowledgeBases\.switchContext">/);
  assert.doesNotMatch(pagesSource, /<strong data-i18n="knowledgeBases\.title">\$\{escapeHtml\(labels\.title\)\}<\/strong>/);
});

test("welcome light theme keeps process nodes crisp instead of gray", () => {
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(stylesSource, /:root\[data-theme="light"\] \.welcome-stage-node/);
  assert.match(stylesSource, /\.welcome-stage-node::before/);
  assert.match(stylesSource, /:root\[data-theme="light"\] \.welcome-stage-node::before/);
  assert.match(stylesSource, /#fbffff/);
  assert.match(stylesSource, /color-mix\(in srgb, var\(--accent\) 58%, #ffffff\)/);
  assert.match(stylesSource, /radial-gradient\(circle at center, color-mix\(in srgb, var\(--accent\) 9%, transparent\)/);
});

test("integration page exposes Query Runtime instead of page-only validation", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(pagesSource, /key: "integration"/);
  assert.match(pagesSource, /renderIntegrationPanel/);
  assert.match(pagesSource, /\/api\/query/);
  assert.match(pagesSource, /Query Runtime/);
  assert.match(pagesSource, /data-query-runtime-panel/);
  assert.match(pagesSource, /data-query-runtime-run/);
  assert.match(pagesSource, /integration-quick-path/);
  assert.match(pagesSource, /integration-flow-section/);
  assert.match(pagesSource, /integrationPanel\.flowSteps/);
  assert.match(pagesSource, /integrationPanel\.testTitle/);
  assert.match(pagesSource, /integrationPanel\.safetyTitle/);
  assert.match(pagesSource, /\/use\/api-docs/);
  assert.doesNotMatch(pagesSource, /integration-docs-bridge/);
  assert.doesNotMatch(pagesSource, /integrationPanel\.openApiDocs/);
  assert.doesNotMatch(pagesSource, /contractEndpointTitle/);
  assert.doesNotMatch(pagesSource, /runtimeTitle/);
  assert.match(appSource, /function bindQueryRuntimePanels/);
  assert.match(appSource, /renderQueryRuntimeResult/);
  assert.match(appSource, /queryRuntime\.emptyQuestion/);
  assert.doesNotMatch(pagesSource, /integration-response-section/);
});

test("api docs page carries Query Runtime contract and code examples", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(pagesSource, /key: "api-docs"/);
  assert.match(pagesSource, /renderApiDocsPanel/);
  assert.match(pagesSource, /api-docs-console-panel/);
  assert.match(pagesSource, /apiDocsPanel\.title/);
  assert.match(pagesSource, /apiDocsPanel\.briefAction/);
  assert.match(pagesSource, /apiDocsPanel\.endpointsTitle/);
  assert.match(pagesSource, /api-docs-endpoint-list/);
  assert.match(pagesSource, /renderApiDocsEndpointRow/);
  assert.match(pagesSource, /integration-contract-section/);
  assert.match(pagesSource, /integrationPanel\.contractTitle/);
  assert.match(pagesSource, /\/api\/query\/contract/);
  assert.doesNotMatch(pagesSource, /integration-endpoint-card--contract/);
  assert.match(pagesSource, /requestFields/);
  assert.match(pagesSource, /statusFields/);
  assert.match(pagesSource, /errorFields/);
  assert.match(pagesSource, /反馈闭环/);
  assert.match(pagesSource, /Feedback Loop/);
  assert.match(pagesSource, /wrong_citation 和 missed_point 会进入问答反馈待复核/);
  assert.match(pagesSource, /sendKnowMeshFeedback/);
  assert.match(pagesSource, /feedbackEndpoint/);
  assert.match(pagesSource, /copyCodeFor/);
  assert.match(pagesSource, /data-copy-code-label-zh/);
  assert.match(pagesSource, /JavaScript 示例/);
  assert.match(appSource, /\[data-copy-code-label-zh\]/);
  assert.match(pagesSource, /links: item\.links \|\| \{\}/);
  assert.match(pagesSource, /new URL\(result\.feedbackEndpoint \|\|/);
  assert.match(pagesSource, /from urllib\.parse import urljoin/);
  assert.match(pagesSource, /feedback_url = urljoin/);
  assert.match(pagesSource, /citation-id-from-query-response/);
  assert.match(pagesSource, /maintain\/document\?documentId=source-document-id/);
  assert.match(pagesSource, /renderIntegrationContractCard\("requestTitle", "requestFields"/);
  assert.match(pagesSource, /data-copy-target-zh="integration-brief-zh"/);
  assert.match(pagesSource, /data-copy-text/);
  assert.match(appSource, /function copyTextFromButton/);
  assert.match(appSource, /copyTarget/);
  assert.match(appSource, /\[data-copy-text\]/);
  assert.match(appSource, /copyTextBestEffort/);
});

test("repeated document and code actions carry user-facing context", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(appSource, /function documentMenuLabel/);
  assert.match(appSource, /aria-label="\$\{escapeHtml\(menuLabel\)\}"/);
  assert.match(appSource, /visually-hidden">\$\{escapeHtml\(menuLabel\)\}/);
  assert.match(pagesSource, /data-copy-code-label-en/);
  assert.match(stylesSource, /\.k12-range-option[\s\S]*min-height: 30px/);
  assert.match(stylesSource, /\.k12-range-actions \.secondary-action[\s\S]*min-height: 30px/);
  assert.match(stylesSource, /\.source-scope-section \.k12-range-actions \.secondary-action[\s\S]*min-height: 30px/);
  assert.match(stylesSource, /\.job-full-log summary[\s\S]*min-height: 32px/);
  assert.match(stylesSource, /\.integration-code-section > summary[\s\S]*min-height: 36px/);
  assert.match(stylesSource, /\.welcome-footnote a[\s\S]*min-height: 32px/);
  assert.match(stylesSource, /\.work-page-help summary[\s\S]*height: 32px/);
  assert.match(stylesSource, /\.query-feedback-source-links a[\s\S]*min-height: 32px/);
});

test("home and overview keep one contextual action instead of duplicate ready shortcuts", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const css = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /renderOverviewStatusPanel/);
  assert.match(pagesSource, /overview-status-panel/);
  assert.match(pagesSource, /data-overview-status-panel/);
  assert.doesNotMatch(pagesSource, /quickActions: isReady/);
  assert.doesNotMatch(pagesSource, /welcome-ready-actions/);
  assert.doesNotMatch(pagesSource, /overview-ready-panel/);
  assert.doesNotMatch(pagesSource, /console\.overviewReady/);
  assert.doesNotMatch(pagesSource, /renderSetupShortcutPanel/);
  assert.doesNotMatch(css, /\.welcome-ready-actions/);
  assert.doesNotMatch(css, /\.overview-ready-panel/);
  assert.doesNotMatch(css, /\.overview-ready-actions/);
  assert.doesNotMatch(css, /\.setup-shortcuts/);
  assert.match(css, /\.overview-status-panel/);
});

test("first-run sample wizard is wired through public sample APIs", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const bindLibraryBody = functionBody(appSource, "bindKnowledgeBaseLibrary");

  assert.match(pagesSource, /renderPublicSampleWizard/);
  assert.match(pagesSource, /data-public-sample-wizard/);
  assert.match(pagesSource, /data-public-sample-create="\$\{escapeHtml\(sample\.id\)\}"/);
  assert.match(pagesSource, /class="secondary-action sample-action"[^>]+data-public-sample-create/);
  assert.doesNotMatch(pagesSource, /class="primary-action"[^>]+data-public-sample-create/);
  assert.match(pagesSource, /data-public-sample-reset/);
  assert.match(pagesSource, /publicSamples: service\.publicSamples/);
  assert.match(pagesSource, /sampleReady/);
  assert.match(bindLibraryBody, /data-public-sample-create/);
  assert.match(bindLibraryBody, /\/api\/public-samples\/create/);
  assert.match(bindLibraryBody, /scopedPathForKnowledgeBase\(data\.knowledgeBase\?\.id, "\/use\/ask"\)/);
  assert.match(bindLibraryBody, /data-public-sample-reset/);
  assert.match(bindLibraryBody, /\/api\/public-samples\/reset/);
  assert.match(stylesSource, /\.public-sample-wizard/);
  assert.match(stylesSource, /\.public-sample-card/);
});

test("query runtime result exposes citations and feedback to users", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");

  assert.match(appSource, /function renderQueryRuntimeResult/);
  assert.match(appSource, /function queryRuntimeText/);
  assert.match(appSource, /function queryRuntimeReadableText/);
  assert.match(appSource, /function renderQueryRuntimeMeta/);
  assert.match(appSource, /function renderQueryRuntimeCitations/);
  assert.match(appSource, /function renderQueryRuntimeIssues/);
  assert.match(appSource, /function renderQueryRuntimeMaintenance/);
  assert.match(appSource, /query-runtime-result-citations/);
  assert.match(appSource, /query-runtime-source-action/);
  assert.match(appSource, /query-runtime-answer/);
  assert.match(appSource, /query-runtime-issues/);
  assert.match(appSource, /query-runtime-maintenance/);
  assert.match(appSource, /queryRuntimeStatusTitle/);
  assert.doesNotMatch(appSource, /data\?\.answer\?\.text \|\| data\?\.answer\?\.message/);
  assert.doesNotMatch(appSource, /\[object Object\]/);
  assert.match(appSource, /function renderQueryRuntimeFeedback/);
  assert.match(appSource, /data-query-feedback-action/);
  assert.match(appSource, /data-query-feedback-citation-refs/);
  assert.match(appSource, /data-query-feedback-result/);
  assert.match(appSource, /queryFeedbackCitationRef/);
  assert.match(appSource, /\/api\/query\/feedback/);
  assert.match(appSource, /bindQueryFeedbackActions/);
  assert.match(appSource, /renderSavedQueryFeedback/);
  assert.match(appSource, /query-runtime-feedback-saved/);
  assert.match(appSource, /hasAttribute\("data-saved-action"\)/);
  assert.match(appSource, /new URLSearchParams\(window\.location\.search\)\.get\("question"\)/);
});

test("feedback records page autoloads Query Runtime feedback summary", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");

  assert.match(pagesSource, /key: "feedback"/);
  assert.match(pagesSource, /renderQueryFeedbackPanel/);
  assert.match(pagesSource, /key: "feedback-review"/);
  assert.match(pagesSource, /renderFeedbackReviewPanel/);
  assert.match(pagesSource, /\/api\/query\/feedback\/summary/);
  assert.match(pagesSource, /data-api-result="query-feedback-summary"/);
  assert.match(pagesSource, /data-query-feedback-mode="records"/);
  assert.match(pagesSource, /data-query-feedback-mode="review"/);
  assert.match(pagesSource, /feedbackPanel\.title/);
  assert.match(pagesSource, /feedbackReviewPanel\.title/);
  assert.match(appSource, /isQueryFeedbackSummaryResult/);
  assert.match(appSource, /knowmesh\.queryFeedbackSummary/);
  assert.match(appSource, /recentRecords/);
  assert.match(appSource, /query-feedback-review-link/);
  assert.match(appSource, /scopedPath\("\/maintain\/feedback"\)/);
});

test("version records page autoloads generated knowledge versions", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /key: "versions"/);
  assert.match(pagesSource, /renderVersionRecordsPanel/);
  assert.match(pagesSource, /data-api-result="version-records"/);
  assert.match(pagesSource, /data-api-autoload="version-records"/);
  assert.match(pagesSource, /\/api\/versions/);
  assert.doesNotMatch(pagesSource, /versionRecordsPanel\.action/);
  assert.match(appSource, /function isVersionRecordsResult/);
  assert.match(appSource, /function isVersionOperationResult/);
  assert.match(appSource, /knowmesh\.versionRecords/);
  assert.match(appSource, /knowmesh\.versionDiff/);
  assert.match(appSource, /version-rollback-preview/);
  assert.match(appSource, /version-rollback-confirm/);
  assert.match(appSource, /function renderVersionRecords/);
  assert.match(appSource, /function renderVersionOperation/);
  assert.match(appSource, /\/api\/versions\/diff\?targetBuildId=/);
  assert.match(appSource, /\/api\/versions\/rollback\/preview/);
  assert.match(appSource, /\/api\/versions\/rollback/);
  assert.match(appSource, /rollbackReady/);
  assert.match(appSource, /rollbackReason/);
  assert.match(appSource, /data-confirm-title-zh="确认回滚版本？"/);
  assert.match(appSource, /data-confirm-body-zh/);
  assert.match(appSource, /data-confirm-label-zh/);
  assert.match(stylesSource, /\.version-records-panel/);
  assert.match(stylesSource, /\.version-record-card/);
  assert.match(stylesSource, /\.version-record-actions/);
  assert.match(stylesSource, /\.version-operation-panel/);
});

test("evaluation dashboard page autoloads safe evaluation summaries", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /key: "evaluation"/);
  assert.match(pagesSource, /\/maintain\/evaluation/);
  assert.match(pagesSource, /renderEvaluationDashboardPanel/);
  assert.match(pagesSource, /data-api-result="evaluation-dashboard"/);
  assert.match(pagesSource, /data-api-autoload="evaluation-dashboard"/);
  assert.match(pagesSource, /\/api\/evaluation\/dashboard/);
  assert.match(appSource, /function isEvaluationDashboardResult/);
  assert.match(appSource, /knowmesh\.evaluationDashboard/);
  assert.match(appSource, /function renderEvaluationDashboard/);
  assert.match(appSource, /function renderEvaluationReleaseGate/);
  assert.match(appSource, /evaluation-release-gate/);
  assert.match(appSource, /targeted-rerun-preview/);
  assert.match(appSource, /targeted-rerun-confirm/);
  assert.match(appSource, /\/api\/rerun\/preview/);
  assert.match(appSource, /\/api\/rerun\/confirm/);
  assert.match(appSource, /function isTargetedRerunResult/);
  assert.match(appSource, /function renderTargetedRerunOperation/);
  assert.match(appSource, /evaluation-dashboard-view/);
  assert.match(appSource, /evaluation-failure-list/);
  assert.match(stylesSource, /\.evaluation-dashboard-panel/);
  assert.match(stylesSource, /\.evaluation-dashboard-grid/);
  assert.match(stylesSource, /\.evaluation-release-gate/);
  assert.match(stylesSource, /\.evaluation-category-list/);
  assert.match(stylesSource, /\.evaluation-failure-list/);
  assert.match(stylesSource, /\.targeted-rerun-panel/);
});

test("build page uses a compact build path instead of duplicate hint cards", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /renderBuildWorkflowRail/);
  assert.match(pagesSource, /data-build-flow-rail/);
  assert.match(pagesSource, /console\.buildWorkflow\.routeSteps/);
  assert.match(stylesSource, /\.build-flow-rail/);
  assert.doesNotMatch(pagesSource, /build-workflow-hint/);
  assert.doesNotMatch(stylesSource, /\.build-workflow-hint/);
});

test("maintenance diagnostics autoloads status without duplicate toolbar actions", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /data-api-autoload="maintenance-status"/);
  assert.match(pagesSource, /data-api-autoload-endpoint="\$\{apiEndpoint\(service, "\/api\/maintenance\/status"\)\}"/);
  assert.match(pagesSource, /data-api-autoload="package-export-preview"/);
  assert.match(pagesSource, /data-api-autoload-endpoint="\$\{apiEndpoint\(service, "\/api\/package\/export\/preview"\)\}"/);
  assert.match(pagesSource, /href="\$\{apiEndpoint\(service, "\/api\/maintenance\/export"\)\}"/);
  assert.match(pagesSource, /download="knowmesh-diagnostics\.json"/);
  assert.match(pagesSource, /maintenancePanel\.exportAction/);
  assert.doesNotMatch(pagesSource, /data-console-api-action="maintenance-status"/);
  assert.doesNotMatch(pagesSource, /data-console-api-action="maintenance-update-preview"/);
  assert.doesNotMatch(pagesSource, /maintenancePanel\.updateAction/);
  assert.doesNotMatch(stylesSource, /\.maintenance-actions-row/);
  assert.match(appSource, /const endpoint = resultNode\?\.dataset\.apiAutoloadEndpoint \|\| "\/api\/maintenance\/status"/);
});

test("maintenance result uses a dedicated view without duplicate status cards", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const renderContentBody = functionBody(appSource, "renderApiResultContent");
  const maintenanceBody = functionBody(appSource, "renderMaintenanceStatus");
  const platformRuntimeBody = functionBody(appSource, "renderPlatformRuntime");
  const dependencyItemBody = functionBody(appSource, "dependencyItem");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(renderContentBody, /isMaintenanceStatusResult\(null,\s*data,\s*actionKey\)/);
  assert.doesNotMatch(maintenanceBody, /renderApiResultFindings/);
  assert.doesNotMatch(maintenanceBody, /maintenance-card-list/);
  assert.match(maintenanceBody, /renderMaintenanceTemplateContract/);
  assert.match(maintenanceBody, /renderMaintenanceProgress/);
  assert.match(maintenanceBody, /renderPlatformRuntime/);
  assert.match(maintenanceBody, /renderProviderCapabilities/);
  assert.match(maintenanceBody, /renderProviderDiagnostics/);
  assert.match(maintenanceBody, /renderMaintenanceDiagnostics/);
  assert.match(platformRuntimeBody, /dependencyItem\("folderPicker", dependencies\.folderPicker\)/);
  assert.match(platformRuntimeBody, /dependencyItem\("fileReveal", dependencies\.fileReveal\)/);
  assert.match(dependencyItemBody, /folderPicker: "目录选择"/);
  assert.match(dependencyItemBody, /fileReveal: "定位文件"/);
  assert.match(dependencyItemBody, /folderPicker: "Folder Picker"/);
  assert.match(dependencyItemBody, /fileReveal: "Reveal File"/);
  assert.match(renderContentBody, /isPackageExportPreviewResult\(data,\s*actionKey\)/);
  assert.match(appSource, /function renderPlatformRuntime/);
  assert.match(appSource, /function renderProviderCapabilities/);
  assert.match(appSource, /function renderProviderDiagnostics/);
  assert.match(appSource, /data-provider-diagnostics/);
  assert.match(appSource, /function renderPackageExportPreview/);
  assert.match(stylesSource, /\.platform-runtime-panel/);
  assert.match(stylesSource, /\.platform-runtime-dependencies/);
  assert.match(stylesSource, /\.provider-capability-panel/);
  assert.match(stylesSource, /\.provider-diagnostics-panel/);
  assert.match(stylesSource, /\.provider-cost-privacy/);
  assert.match(stylesSource, /\.package-export-panel/);
  assert.doesNotMatch(maintenanceBody, /renderQueryFeedbackList/);
  assert.doesNotMatch(maintenanceBody, /renderMaintenanceNextActions/);
  assert.doesNotMatch(maintenanceBody, /nextActions/);
  assert.doesNotMatch(appSource, /function renderMaintenanceNextActions/);
  assert.doesNotMatch(stylesSource, /\.maintenance-next-actions/);
});

test("answer feedback review page shows items that need review", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");
  const feedbackBody = functionBody(appSource, "renderQueryFeedbackList");
  const feedbackItemBody = functionBody(appSource, "renderQueryFeedbackRecordItem");

  assert.match(pagesSource, /renderFeedbackReviewPanel/);
  assert.match(pagesSource, /feedback-review-panel/);
  assert.match(feedbackBody, /query-feedback-panel/);
  assert.match(feedbackBody, /openByAction/);
  assert.match(feedbackBody, /wrong_citation/);
  assert.match(feedbackBody, /missed_point/);
  assert.match(feedbackBody, /positive/);
  assert.match(feedbackBody, /reviewMode/);
  assert.match(appSource, /function renderQueryFeedbackRecordItem/);
  assert.match(appSource, /queryFeedbackSourceLinks/);
  assert.match(appSource, /query-feedback-source-links/);
  assert.match(appSource, /data-query-feedback-resolve/);
  assert.match(appSource, /query-feedback-record-actions/);
  assert.match(appSource, /query-feedback-record-link/);
  assert.match(appSource, /data-feedback-state/);
  assert.match(appSource, /item\.retestHref/);
  assert.match(appSource, /resolution\?\.createdAt/);
  assert.match(appSource, /\/use\/ask\?question=/);
  assert.match(appSource, /\/api\/query\/feedback\/resolve/);
  assert.match(feedbackItemBody, /queryFeedbackSourceLinks/);
  assert.match(feedbackItemBody, /query-feedback-record-actions/);
  assert.match(stylesSource, /\.query-feedback-recent li\[data-feedback-state="resolved"\]/);
  assert.match(stylesSource, /\.query-runtime-feedback-saved/);
});

test("use knowledge pages rely on secondary tabs instead of duplicate path rails", () => {
  const pagesSource = fs.readFileSync(pagesSourcePath, "utf8");
  const stylesSource = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(pagesSource, /renderUseKnowledgeTabs\("ask", service\)/);
  assert.match(pagesSource, /renderQueryRuntimePanel\(service, \{ variant: "ask" \}\)/);
  assert.doesNotMatch(pagesSource, /use-runtime-path/);
  assert.doesNotMatch(pagesSource, /renderUseKnowledgePath/);
  assert.doesNotMatch(pagesSource, /useKnowledgePath/);
  assert.doesNotMatch(stylesSource, /\.use-runtime-path/);
});

test("answer feedback resolve action uses confirm and local refresh", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const bindBody = functionBody(appSource, "bindQueryFeedbackResolveActions");

  assert.match(bindBody, /showConfirmDialog/);
  assert.match(bindBody, /data-query-feedback-resolve/);
  assert.match(bindBody, /refreshInlineApiResult\("query-feedback-summary"\)/);
  assert.doesNotMatch(bindBody, /fetchMaintenanceStatusUpdate/);
  assert.match(bindBody, /\/api\/query\/feedback\/resolve/);
});

test("global dropdown menus stay hidden while their details controls are closed", () => {
  const css = fs.readFileSync(stylesSourcePath, "utf8");

  assert.match(css, /details:not\(\[open\]\) > \.knowledge-base-switch-list/);
  assert.match(css, /details:not\(\[open\]\) > \.welcome-lang-menu/);
});

test("maintenance contract upgrade action is visually primary and confirmed", () => {
  const appSource = fs.readFileSync(appSourcePath, "utf8");
  const diagnosticsBody = functionBody(appSource, "renderMaintenanceDiagnostics");

  assert.match(diagnosticsBody, /maintenance-contract-action/);
  assert.match(diagnosticsBody, /data-confirm-title-zh/);
  assert.match(diagnosticsBody, /data-confirm-body-zh/);
  assert.match(diagnosticsBody, /data-confirm-label-zh/);
  assert.doesNotMatch(diagnosticsBody, /item\.href/);
});
