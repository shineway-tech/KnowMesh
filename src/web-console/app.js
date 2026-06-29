const stateNode = document.getElementById("km-state");
const pageState = stateNode ? JSON.parse(stateNode.textContent) : { copy: {}, setupSteps: [], setupGroups: [] };
const root = document.documentElement;
const basePath = normalizeBasePath(pageState.basePath || document.body?.dataset.basePath || "");
const apiBasePath = normalizeBasePath(pageState.apiBasePath || document.body?.dataset.apiBasePath || (basePath ? `${basePath}/api` : "/api")) || "/api";
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => nativeFetch(rewriteFetchInput(input), init);

const storageKeys = {
  lang: "knowmesh.lang",
  theme: "knowmesh.theme",
  sidebar: "knowmesh.sidebar",
  jobLogFilter: "knowmesh.jobLogFilter"
};

const setupSnapshot = pageState.setupState && typeof pageState.setupState === "object" ? pageState.setupState : {};
const initialTemplateIds = (pageState.templates || []).map((template) => template.id);
const draftState = readDraft(setupSnapshot.draft || {});
let modelCatalog = pageState.aliyunModelCatalog || {};
const modelSlots = pageState.aliyunModelSlots || [];
const retrievalProfiles = pageState.retrievalProfiles || [];
const retrievalMethods = pageState.retrievalMethods || {};
const defaultRetrievalProfileId = pageState.defaultRetrievalProfileId || retrievalProfiles[0]?.id || "balanced";

const settings = {
  lang: readChoice(storageKeys.lang, ["zh", "en"], "zh"),
  theme: readChoice(storageKeys.theme, ["dark", "light"], "dark"),
  sidebar: readChoice(storageKeys.sidebar, ["expanded", "collapsed"], "expanded"),
  mode: inferInitialSetupMode(setupSnapshot, pageState.defaultMode || "aliyun"),
  template: inferInitialSetupTemplate(setupSnapshot, pageState.defaultTemplateId || initialTemplateIds[0] || "")
};

let apiActionsBound = false;
let folderPickersBound = false;
let localPathActionsBound = false;
let storageToolsBound = false;
let modelToolsBound = false;
let retrievalToolsBound = false;
let k12RangeControlsBound = false;
let modelCatalogAutoRefreshStarted = false;
let latestJobAutoLoadStarted = false;
let draftSyncTimer = 0;
let pathPrecheckTimer = 0;
let pathPrecheckSequence = 0;
let activeDialogCleanup = null;
let currentJobSnapshot = null;
let activeJobStepKey = "";
let jobLogFilterMode = readChoice(storageKeys.jobLogFilter, ["all", "current"], "all");
let jobActionPollTimer = 0;
let jobActionPollInFlight = false;
let maintenanceStatusPollTimer = 0;
let maintenanceStatusPollInFlight = false;
let jobInlineUiState = null;
let setupStateLoaded = false;
let overflowTooltipTimer = 0;
let overflowTooltipObserver = null;
const apiResultState = new WeakMap();
const queryRuntimeResultState = new WeakMap();
const folderResultState = new WeakMap();
const setupProgress = new Set();
const setupActionResults = {};
const persistentSetupActionKeys = new Set(["preview-scan", "preview-run"]);
const permissionStatusLabels = {
  zh: {
    pending: "待检查",
    working: "检查中",
    pass: "已通过",
    fail: "未通过",
    warn: "需确认"
  },
  en: {
    pending: "Pending",
    working: "Checking",
    pass: "Passed",
    fail: "Failed",
    warn: "Review"
  }
};

const sourceScopeRequiredKeys = ["metadata.stage", "metadata.subject", "metadata.grade"];
const sourceScopeExtraKeys = ["metadata.volume", "metadata.publisher", "metadata.edition"];

function normalizeBasePath(value) {
  const text = String(value || "").trim();
  if (!text || text === "/") return "";
  const normalized = text.startsWith("/") ? text : `/${text}`;
  return normalized.replace(/\/+$/, "");
}

function scopedPath(path) {
  if (!path || typeof path !== "string") return path;
  if (!basePath || path.startsWith("#") || path.startsWith("http://") || path.startsWith("https://") || path.startsWith("//") || path.startsWith("/kb/") || path.startsWith("/api") || path.startsWith("/assets") || path.startsWith("/web-console")) return path;
  if (/^\/(setup|overview|knowledge-bases|build|use|maintain)(\/|\?|#|$)/.test(path)) return `${basePath}${path}`;
  return path;
}

function scopedPathForKnowledgeBase(id, path) {
  const cleanId = String(id || "").trim();
  if (!cleanId) return scopedPath(path);
  const cleanPath = String(path || "/overview").startsWith("/") ? String(path || "/overview") : `/${path}`;
  return `/kb/${encodeURIComponent(cleanId)}${cleanPath}`;
}

function apiPath(path) {
  if (!path || typeof path !== "string") return path;
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("//") || path.startsWith("/kb/")) return path;
  if (path === "/api" || path.startsWith("/api/")) return `${apiBasePath}${path.slice(4)}`;
  return path;
}

function rewriteFetchInput(input) {
  if (typeof input === "string") return apiPath(input);
  if (input instanceof URL) {
    const origin = window.location.origin;
    if (input.origin === origin && (input.pathname === "/api" || input.pathname.startsWith("/api/"))) {
      return new URL(apiPath(`${input.pathname}${input.search}`), origin);
    }
  }
  return input;
}

function navigateTo(path) {
  window.location.href = scopedPath(path);
}

function replaceTo(path) {
  window.location.replace(scopedPath(path));
}

if (Object.keys(setupSnapshot).length) {
  restoreSetupProgressFromServer(setupSnapshot, { sync: false });
  setupStateLoaded = true;
}

applyAll();
bindControls();
loadTemplates();
loadSetupState().finally(() => {
  restorePersistentSetupActionResult();
  restorePersistentBuildResults();
});

function bindControls() {
  bindGlobalDisclosures();

  document.querySelectorAll("[data-lang-option]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.lang = button.dataset.langOption;
      writeChoice(storageKeys.lang, settings.lang);
      applyLanguage();
      applySetupState();
      closeGlobalDisclosures();
    });
  });

  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.addEventListener("click", () => {
      settings.theme = button.dataset.themeOption;
      writeChoice(storageKeys.theme, settings.theme);
      applyTheme();
      closeGlobalDisclosures();
    });
  });

  const sidebarToggle = document.getElementById("sidebarToggle");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      settings.sidebar = settings.sidebar === "collapsed" ? "expanded" : "collapsed";
      writeChoice(storageKeys.sidebar, settings.sidebar);
      applySidebar();
    });
  }

  document.addEventListener("click", (event) => {
    const modeCard = event.target.closest("[data-mode-option]");
    if (modeCard) {
      event.preventDefault();
      setMode(modeCard.dataset.modeOption, pageState.pageType === "setup");
      return;
    }

    const templateCard = event.target.closest("[data-template-option]");
    if (templateCard) {
      event.preventDefault();
      setTemplate(templateCard.dataset.templateOption, pageState.pageType === "setup");
      return;
    }

    const accountCard = event.target.closest("[data-account-method-card]");
    if (accountCard) {
      event.preventDefault();
      setAccountMethod(accountCard.dataset.accountMethodOption);
    }
  });

  document.querySelectorAll("[data-account-selected-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await runSelectedAccountAction(button);
    });
  });

  bindAccountResultActions();

  document.querySelectorAll("[data-setup-complete]").forEach((button) => {
    button.addEventListener("click", async () => {
      persistVisibleDraftFields();
      const mode = button.dataset.modeOption;
      if (mode) setMode(mode, true);
      const completedStep = button.dataset.setupComplete;
      const canComplete = await ensureSetupStepCanComplete(completedStep, button);
      if (!canComplete) return;
      markSetupComplete(completedStep);

      if (button.dataset.setupFinish === "true") {
        persistSetupProgressToDraft();
        navigateTo("/overview");
        return;
      }

      const nextPath = nextSetupPath(completedStep);
      if (nextPath) navigateTo(nextPath);
    });
  });

  document.querySelectorAll("[data-setup-step-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
      }
    });
  });

  document.querySelectorAll("[data-setup-group-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
      }
    });
  });

  bindDraftFields();
  bindCredentialSaveOptions();
  applyAccountMethod();
  bindApiActions();
  bindFolderPickers();
  bindLocalPathActions();
  bindStorageTools();
  bindModelTools();
  bindRetrievalTools();
  bindK12RangeControls();
  bindKnowledgeBaseLibrary();
  bindDocumentManagement();
  bindDocumentAssetViewer();
  bindQueryFeedbackActions();
  bindQueryFeedbackResolveActions();
  bindQueryRuntimePanels();
  initializeOverflowTooltips();
  initializeConsolePage();
}

function bindQueryRuntimePanels() {
  document.querySelectorAll("[data-query-runtime-panel]").forEach((panel) => {
    if (panel.dataset.queryRuntimeBound === "true") return;
    panel.dataset.queryRuntimeBound = "true";

    const questionNode = panel.querySelector("[data-query-runtime-question]");
    const resultNode = panel.querySelector("[data-query-runtime-result]");
    const testButton = panel.querySelector("[data-query-runtime-run]");
    if (!questionNode || !resultNode || !testButton) return;
    const urlQuestion = new URLSearchParams(window.location.search).get("question");
    if (urlQuestion && !String(questionNode.value || "").trim()) {
      questionNode.value = urlQuestion;
    }

    testButton.addEventListener("click", async () => {
      const question = String(questionNode.value || "").trim();
      if (!question) {
        renderQueryRuntimeResult(resultNode, {
          ok: false,
          status: "invalid_request",
          answer: { status: "invalid_request", message: translate("queryRuntime.emptyQuestion"), reliable: false },
          citations: [],
          runtime: null,
          timing: null
        }, panel);
        return;
      }

      const originalLabel = testButton.textContent;
      testButton.disabled = true;
      testButton.textContent = translate("queryRuntime.running") || originalLabel;
      resultNode.hidden = false;
      resultNode.dataset.state = "working";
      resultNode.innerHTML = `<div class="query-runtime-working">${escapeHtml(translate("queryRuntime.running") || "Running...")}</div>`;

      try {
        const response = await fetch(panel.dataset.queryEndpoint || "/api/query", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ question })
        });
        const data = await response.json();
        renderQueryRuntimeResult(resultNode, data, panel);
        showToast(queryRuntimeToastMessage(data), data?.ok ? "pass" : "warn");
      } catch (error) {
        renderQueryRuntimeResult(resultNode, {
          ok: false,
          status: "runtime_error",
          answer: {
            status: "runtime_error",
            message: error instanceof Error ? error.message : String(error),
            reliable: false
          },
          citations: [],
          runtime: null,
          timing: null
        }, panel);
        showToast(error instanceof Error ? error.message : String(error), "fail");
      } finally {
        testButton.disabled = false;
        testButton.textContent = originalLabel;
      }
    });
  });
}

function renderQueryRuntimeResult(node, data = {}, panel = null) {
  if (!node) return;
  queryRuntimeResultState.set(node, { data, panel });
  const ok = Boolean(data?.ok);
  const status = String(data?.status || data?.answer?.status || (ok ? "answered" : "no_answer"));
  const answerMessage = queryRuntimeText(
    data?.answer?.text,
    data?.answer?.message,
    data?.message,
    data?.error?.message
  );
  const citations = Array.isArray(data?.citations) ? data.citations : [];
  const citationPreview = renderQueryRuntimeCitations(citations);
  const state = ok ? "pass" : status === "invalid_request" ? "warn" : "fail";
  const answerTitle = ok
    ? (settings.lang === "zh" ? "可引用回答" : "Citable Answer")
    : (settings.lang === "zh" ? "当前不能回答" : "Not Answerable Yet");
  const answerLead = ok
    ? (settings.lang === "zh" ? "这条回答已通过引用校验，外部应用调用同一接口会拿到同一套结果。" : "This answer passed citation checks; external apps calling the same endpoint receive the same contract.")
    : (settings.lang === "zh" ? "KnowMesh 不会在缺少可靠来源时强行生成答案。" : "KnowMesh does not fabricate an answer when reliable sources are missing.");
  const metaSummary = renderQueryRuntimeMeta(data, citations, state);
  node.hidden = false;
  node.dataset.state = state;
  node.innerHTML = `${answerMessage ? `<article class="query-runtime-answer" data-status="${escapeHtml(state)}">
      <header>
        <div>
          <strong>${escapeHtml(answerTitle)}</strong>
          <span>${escapeHtml(answerLead)}</span>
        </div>
        <em>${escapeHtml(queryRuntimeStatusTitle(data))}</em>
      </header>
      <p>${escapeHtml(answerMessage)}</p>
    </article>` : ""}
    ${ok ? "" : renderQueryRuntimeIssues(data)}
    ${renderQueryRuntimeMaintenance(data)}
    ${metaSummary}
    ${citationPreview ? `<section class="query-runtime-citation-block"><strong>${escapeHtml(translate("queryRuntime.sourcesTitle") || "Sources")}</strong><ul class="query-runtime-result-citations">${citationPreview}</ul></section>` : ""}
    ${renderQueryRuntimeFeedback(data, panel)}`;
}

function renderQueryRuntimeMeta(data = {}, citations = [], state = "") {
  const items = [
    [translate("queryRuntime.statusLabel") || "Status", queryRuntimeStatusTitle(data)],
    [translate("queryRuntime.runtimeLabel") || "Runtime", data?.runtime?.name || "KnowMesh Query Runtime"],
    [translate("queryRuntime.durationLabel") || "Duration", formatDurationMs(data?.timing?.durationMs)],
    [translate("queryRuntime.citationsLabel") || "Citations", `${citations.length}${translate("queryRuntime.citationsUnit") || ""}`]
  ];
  return `<section class="query-runtime-result-summary" data-status="${escapeHtml(state)}">
      ${items.map(([label, value]) => `<div>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`).join("")}
    </section>`;
}

function queryRuntimeText(...values) {
  for (const value of values) {
    const text = queryRuntimeReadableText(value);
    if (text) return text;
  }
  return "";
}

function queryRuntimeReadableText(value, seen = new Set()) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => queryRuntimeReadableText(item, seen)).filter(Boolean).join(" · ");
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  const preferred = localized(value);
  if (preferred !== value) {
    const text = queryRuntimeReadableText(preferred, seen);
    if (text) return text;
  }
  for (const key of ["text", "message", "detail", "summary", "label", "title", "description", "code"]) {
    const text = queryRuntimeReadableText(value[key], seen);
    if (text) return text;
  }
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && typeof item !== "object")
    .map(([key, item]) => `${key}: ${String(item)}`);
  return entries.join(" · ");
}

function renderQueryRuntimeCitations(citations = []) {
  return citations.slice(0, 5).map((item) => {
    const title = queryRuntimeText(item.title, item.sourceUri, item.id) || (settings.lang === "zh" ? "未命名来源" : "Untitled source");
    const page = item.pageNumber ? `${settings.lang === "zh" ? "第" : "p."}${item.pageNumber}${settings.lang === "zh" ? "页" : ""}` : "";
    const href = item.links?.document || "";
    const excerpt = queryRuntimeText(item.excerpt);
    const meta = [
      page,
      queryRuntimeText(item.metadata?.education?.grade),
      queryRuntimeText(item.metadata?.education?.subject),
      queryRuntimeText(item.metadata?.lessonTitle, item.metadata?.education?.lesson_title)
    ].filter(Boolean).join(" · ");
    const titleMarkup = href
      ? `<a href="${escapeHtml(href)}" title="${escapeHtml(title)}">${escapeHtml(title)}</a>`
      : `<span title="${escapeHtml(title)}">${escapeHtml(title)}</span>`;
    return `<li>
              <div>
                ${titleMarkup}
                ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
                ${excerpt ? `<p>${escapeHtml(excerpt)}</p>` : ""}
              </div>
              ${href ? `<a class="query-runtime-source-action" href="${escapeHtml(href)}">${escapeHtml(settings.lang === "zh" ? "查看全文" : "Open")}</a>` : ""}
            </li>`;
  }).join("");
}

function renderQueryRuntimeIssues(data = {}) {
  if (data?.ok) return "";
  const checks = (Array.isArray(data?.checks) ? data.checks : [])
    .filter((item) => item && item.status && item.status !== "pass");
  const fixes = Array.isArray(data?.fixes) ? data.fixes : [];
  if (!checks.length && !fixes.length) return "";
  const labels = {
    title: settings.lang === "zh" ? "为什么还不能回答" : "Why it cannot answer yet",
    checks: settings.lang === "zh" ? "检查结果" : "Checks",
    fixes: settings.lang === "zh" ? "建议处理" : "Suggested actions"
  };
  const checkItems = checks.map((item) => {
    const label = queryRuntimeText(item.label, item.key);
    const message = queryRuntimeText(item.message, item.detail);
    return `<li data-status="${escapeHtml(item.status)}">
              <span>${escapeHtml(label)}</span>
              <em>${escapeHtml(message)}</em>
            </li>`;
  }).join("");
  const fixItems = fixes.map((item) => {
    const label = queryRuntimeText(item.label, item.key);
    const message = queryRuntimeText(item.message);
    const href = typeof item.step === "string" && item.step ? item.step : "";
    return `<li>
              <div>
                <span>${escapeHtml(label)}</span>
                <em>${escapeHtml(message)}</em>
              </div>
              ${href ? `<a href="${escapeHtml(href)}">${escapeHtml(settings.lang === "zh" ? "去处理" : "Fix")}</a>` : ""}
            </li>`;
  }).join("");
  return `<section class="query-runtime-issues">
            <strong>${escapeHtml(labels.title)}</strong>
            ${checkItems ? `<div><span>${escapeHtml(labels.checks)}</span><ul>${checkItems}</ul></div>` : ""}
            ${fixItems ? `<div><span>${escapeHtml(labels.fixes)}</span><ul>${fixItems}</ul></div>` : ""}
          </section>`;
}

function renderQueryRuntimeMaintenance(data = {}) {
  const maintenance = data?.maintenance || {};
  const issue = maintenance.issue || null;
  if (!maintenance.queued || !issue) return "";
  const reason = queryRuntimeText(issue.reason) || (settings.lang === "zh" ? "这次查询已进入维护队列。" : "This query is now in the maintenance queue.");
  const reviewHref = issue.reviewHref || "/maintain/feedback";
  const retestHref = issue.retestHref || "";
  const labels = settings.lang === "zh"
    ? {
        title: "已进入维护队列",
        body: "处理资料或配置后，可以从这里复测同一个问题。",
        review: "去处理",
        retest: "复测问题"
      }
    : {
        title: "Queued for maintenance",
        body: "After fixing sources or setup, retest the same question from here.",
        review: "Review",
        retest: "Retest"
      };
  const links = [
    reviewHref ? `<a href="${escapeHtml(scopedPath(reviewHref))}">${escapeHtml(labels.review)}</a>` : "",
    retestHref ? `<a href="${escapeHtml(scopedPath(retestHref))}">${escapeHtml(labels.retest)}</a>` : ""
  ].filter(Boolean).join("");
  return `<section class="query-runtime-maintenance">
            <div>
              <strong>${escapeHtml(labels.title)}</strong>
              <span>${escapeHtml(reason)}</span>
              <em>${escapeHtml(labels.body)}</em>
            </div>
            ${links ? `<div>${links}</div>` : ""}
          </section>`;
}

function renderQueryRuntimeFeedback(data = {}, panel = null) {
  const actions = Array.isArray(data?.feedback?.actions) ? data.feedback.actions : [];
  if (!actions.length) return "";
  const citationItems = Array.isArray(data?.citations) ? data.citations : [];
  const citations = citationItems
    .map((item) => item.id || item.chunk_id)
    .filter(Boolean)
    .join(",");
  const citationRefs = JSON.stringify(citationItems.map(queryFeedbackCitationRef).filter(Boolean));
  const endpoint = data?.feedback?.endpoint || panel?.dataset?.queryFeedbackEndpoint || "/api/query/feedback";
  const question = data?.request?.question || "";
  const status = data?.status || data?.answer?.status || "";
  const resultKey = data?.resultKey || data?.answer?.resultKey || "";
  return `<section class="query-runtime-feedback">
            <div>
              <strong>${escapeHtml(translate("queryRuntime.feedbackTitle") || "Feedback")}</strong>
              <span>${escapeHtml(translate("queryRuntime.feedbackBody") || "")}</span>
            </div>
            <div class="query-runtime-feedback-actions">
              ${actions.map((action) => `<button type="button"
                data-query-feedback-action="${escapeHtml(action.key || "")}"
                data-query-feedback-endpoint="${escapeHtml(endpoint)}"
                data-query-feedback-status="${escapeHtml(status)}"
                data-query-feedback-result="${escapeHtml(resultKey)}"
                data-query-feedback-question="${escapeHtml(question)}"
                data-query-feedback-citations="${escapeHtml(citations)}"
                data-query-feedback-citation-refs="${escapeHtml(citationRefs)}"
                title="${escapeHtml(localized(action.message) || localized(action.label) || "")}">${escapeHtml(localized(action.label) || action.key || "")}</button>`).join("")}
            </div>
          </section>`;
}

function queryFeedbackCitationRef(item = {}) {
  if (!item || typeof item !== "object") return null;
  return {
    id: item.id || item.chunk_id || "",
    title: item.title || item.sourceUri || "",
    sourceUri: item.sourceUri || "",
    pageNumber: item.pageNumber ?? null,
    lessonTitle: item.metadata?.lessonTitle || item.metadata?.education?.lesson_title || item.lessonTitle || "",
    documentHref: item.links?.document || item.documentHref || "",
    excerpt: item.excerpt || ""
  };
}

function rerenderVisibleQueryRuntimeResults() {
  document.querySelectorAll("[data-query-runtime-result]").forEach((node) => {
    if (node.hidden) return;
    const state = queryRuntimeResultState.get(node);
    if (state?.data) renderQueryRuntimeResult(node, state.data, state.panel);
  });
}

function queryRuntimeStatusTitle(data = {}) {
  if (data?.ok) return translate("queryRuntime.resultAnswered") || "Reliable answer returned";
  const status = data?.status || data?.answer?.status || "";
  if (status === "no_evidence") return queryRuntimeText(data?.answer?.message) || (settings.lang === "zh" ? "没有找到可引用来源" : "No citable source found");
  if (status === "model_unavailable") return queryRuntimeText(data?.answer?.message) || (settings.lang === "zh" ? "模型服务还不能生成答案" : "Model service cannot answer yet");
  if (status === "model_failed") return queryRuntimeText(data?.answer?.message, data?.error?.message) || (settings.lang === "zh" ? "模型服务生成失败" : "Model generation failed");
  if (status === "runtime_error") return queryRuntimeText(data?.answer?.message, data?.error?.message) || (settings.lang === "zh" ? "查询运行失败" : "Query runtime failed");
  if (status === "invalid_request") return translate("queryRuntime.emptyQuestion") || "Enter a question first.";
  if (status === "no_answer") return translate("queryRuntime.resultNoAnswer") || "No reliable answer yet";
  return translate("queryRuntime.resultError") || "Action needed";
}

function queryRuntimeToastMessage(data = {}) {
  return queryRuntimeStatusTitle(data);
}

function formatDurationMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (number < 1000) return `${Math.max(0, Math.round(number))} ms`;
  return `${(number / 1000).toFixed(number < 10000 ? 1 : 0)} s`;
}

function bindQueryFeedbackActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-query-feedback-action]");
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.queryFeedbackAction || "";
    if (!action || button.disabled) return;
    button.disabled = true;
    try {
      const response = await fetch(button.dataset.queryFeedbackEndpoint || "/api/query/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action,
          question: button.dataset.queryFeedbackQuestion || "",
          resultKey: button.dataset.queryFeedbackResult || "",
          answerStatus: button.dataset.queryFeedbackStatus || "",
          citationIds: (button.dataset.queryFeedbackCitations || "").split(",").filter(Boolean),
          citationRefs: parseFeedbackCitationRefs(button.dataset.queryFeedbackCitationRefs)
        })
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) throw new Error(data.error || "feedback failed");
      const feedbackPanel = button.closest(".query-runtime-feedback");
      if (feedbackPanel) {
        feedbackPanel.setAttribute("data-saved-action", action);
        feedbackPanel.querySelectorAll("[data-query-feedback-action]").forEach((item) => { item.disabled = true; });
        renderSavedQueryFeedback(feedbackPanel, data.feedback || {}, action);
      }
      showToast(settings.lang === "zh" ? "反馈已记录" : "Feedback saved", "pass");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "fail");
    } finally {
      if (!button.closest(".query-runtime-feedback")?.hasAttribute("data-saved-action")) {
        button.disabled = false;
      }
    }
  });
}

function renderSavedQueryFeedback(panel, feedback = {}, action = "") {
  const previous = panel.querySelector(".query-runtime-feedback-saved");
  if (previous) previous.remove();
  const needsReview = Boolean(feedback.needsReview || action === "wrong_citation" || action === "missed_point");
  const reviewHref = feedback.reviewHref || scopedPath("/maintain/feedback");
  const retestHref = feedback.retestHref || "";
  const labels = settings.lang === "zh"
    ? {
        saved: needsReview ? "反馈已进入问答反馈维护。" : "反馈已记录为正向信号。",
        review: "去处理",
        retest: "复测问题"
      }
    : {
        saved: needsReview ? "Feedback is now waiting in Answer Feedback." : "Feedback was saved as a positive signal.",
        review: "Review",
        retest: "Ask again"
      };
  const links = [
    needsReview ? `<a href="${escapeHtml(scopedPath(reviewHref))}">${escapeHtml(labels.review)}</a>` : "",
    retestHref ? `<a href="${escapeHtml(scopedPath(retestHref))}">${escapeHtml(labels.retest)}</a>` : ""
  ].filter(Boolean).join("");
  panel.insertAdjacentHTML("beforeend", `<div class="query-runtime-feedback-saved">
    <span>${escapeHtml(labels.saved)}</span>
    ${links ? `<div>${links}</div>` : ""}
  </div>`);
}

function parseFeedbackCitationRefs(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function bindQueryFeedbackResolveActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-query-feedback-resolve]");
    if (!button) return;
    event.preventDefault();
    const id = button.dataset.queryFeedbackResolve || "";
    if (!id || button.disabled) return;
    const question = button.dataset.feedbackQuestion || "";
    const ok = await showConfirmDialog({
      title: settings.lang === "zh" ? "标记反馈已处理？" : "Mark feedback as handled?",
      body: settings.lang === "zh"
        ? `这会把这条反馈标记为已处理，原始反馈仍会保留在日志中。\n\n${question || "未记录问题"}`
        : `This marks the feedback as handled. The original feedback stays in the log.\n\n${question || "Question not recorded"}`,
      confirmLabel: settings.lang === "zh" ? "标记已处理" : "Mark handled",
      tone: "warning"
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const endpoint = button.dataset.feedbackResolveEndpoint || "/api/query/feedback/resolve";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok || data.ok === false) {
        const message = typeof data.error === "string"
          ? data.error
          : data.error?.message || data.error?.code || "feedback resolve failed";
        throw new Error(message);
      }
      showToast(settings.lang === "zh" ? "反馈已标记处理" : "Feedback marked handled", "pass");
      await refreshInlineApiResult("query-feedback-summary");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "fail");
    } finally {
      button.disabled = false;
    }
  });
}

function bindKnowledgeBaseLibrary() {
  document.querySelectorAll("[data-knowledge-base-switch]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.knowledgeBaseSwitch;
      if (!id) return;
      button.disabled = true;
      try {
        const response = await fetch("/api/knowledge-bases/current", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ id })
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || "switch failed");
        closeGlobalDisclosures();
        showToast(translate("knowledgeBases.switched") || (settings.lang === "zh" ? "已切换知识库。" : "Knowledge base switched."), "pass");
        window.setTimeout(() => { window.location.href = scopedPathForKnowledgeBase(id, "/overview"); }, 120);
      } catch (error) {
        button.disabled = false;
        showToast(error instanceof Error ? error.message : String(error), "fail");
      }
    });
  });

  document.querySelectorAll("[data-knowledge-base-create]").forEach((button) => {
    button.addEventListener("click", async () => {
      closeGlobalDisclosures();
      const name = await showPromptDialog({
        title: translate("knowledgeBases.promptTitle") || (settings.lang === "zh" ? "新建知识库" : "New Knowledge Base"),
        body: translate("knowledgeBases.promptBody") || (settings.lang === "zh" ? "给这个知识库起一个容易识别的名称。" : "Name this knowledge base so it is easy to recognize later."),
        placeholder: translate("knowledgeBases.promptPlaceholder") || "KnowMesh"
      });
      if (name === null) return;
      const trimmed = String(name || "").trim();
      if (!trimmed) return;
      button.disabled = true;
      try {
        const response = await fetch("/api/knowledge-bases", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ name: trimmed, template: settings.template || pageState.defaultTemplateId || "general-docs" })
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || "create failed");
        showToast(translate("knowledgeBases.created") || (settings.lang === "zh" ? "知识库已创建，请继续配置。" : "Knowledge base created. Continue setup."), "pass");
        window.setTimeout(() => { window.location.href = scopedPathForKnowledgeBase(data.knowledgeBase?.id, "/setup/mode"); }, 120);
      } catch (error) {
        button.disabled = false;
        showToast(error instanceof Error ? error.message : String(error), "fail");
      }
    });
  });
}

function bindGlobalDisclosures() {
  const disclosures = Array.from(document.querySelectorAll("details[data-global-disclosure]"));
  if (!disclosures.length) return;

  disclosures.forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      disclosures.forEach((other) => {
        if (other !== details) other.open = false;
      });
    });

    details.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest("[data-lang-option], [data-knowledge-base-switch], [data-knowledge-base-create]");
      if (!action) return;
      window.setTimeout(() => {
        details.open = false;
      }, 0);
    });
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    disclosures.forEach((details) => {
      if (details.open && !details.contains(target)) details.open = false;
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeGlobalDisclosures();
  });
}

function closeGlobalDisclosures() {
  document.querySelectorAll("details[data-global-disclosure][open]").forEach((details) => {
    details.open = false;
  });
}
function bindDocumentManagement() {
  const root = document.querySelector("[data-document-management]");
  if (!root) return;
  const state = { documents: [], changes: null, filter: "all", query: "", cursor: "0", limit: 50, hasMore: false, loading: false, searchTimer: 0 };
  const search = root.querySelector("[data-document-search]");
  const checkButton = root.querySelector("[data-document-check]");
  const loadMoreButton = root.querySelector("[data-document-load-more]");
  const resultSummary = root.querySelector("[data-document-result-summary]");
  const initialQuery = new URLSearchParams(window.location.search).get("query") || "";
  state.query = initialQuery;
  if (search && initialQuery) search.value = initialQuery;

  async function loadDocuments({ reset = false, endpoint = "", method = "GET" } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.cursor = "0";
      state.documents = [];
      showDocumentLoading(root);
    }
    updateDocumentLoadingState(root, true);
    const params = new URLSearchParams();
    params.set("limit", String(state.limit));
    params.set("cursor", reset ? "0" : state.cursor || "0");
    params.set("filter", state.filter || "all");
    if (state.query) params.set("query", state.query);
    const baseEndpoint = endpoint || root.dataset.documentsEndpoint || "/api/documents";
    const url = method === "GET" ? `${baseEndpoint}${baseEndpoint.includes("?") ? "&" : "?"}${params.toString()}` : baseEndpoint;
    try {
      const data = await fetchDocumentPayload(url, method === "GET" ? {} : { method });
      updateDocumentPanel(root, state, data, { append: !reset && method === "GET" });
    } catch (error) {
      showDocumentEmpty(root, error instanceof Error ? error.message : String(error));
      renderDocumentResultSummary(root, state, null);
      throw error;
    } finally {
      state.loading = false;
      updateDocumentLoadingState(root, false);
    }
  }

  search?.addEventListener("input", () => {
    state.query = search.value || "";
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      loadDocuments({ reset: true }).catch((error) => showToast(error instanceof Error ? error.message : String(error), "fail"));
    }, 220);
  });
  root.querySelectorAll("[data-document-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.documentFilter || "all";
      root.querySelectorAll("[data-document-filter]").forEach((item) => item.setAttribute("aria-pressed", item === button ? "true" : "false"));
      loadDocuments({ reset: true }).catch((error) => showToast(error instanceof Error ? error.message : String(error), "fail"));
    });
  });
  loadMoreButton?.addEventListener("click", () => {
    loadDocuments({ reset: false }).catch((error) => showToast(error instanceof Error ? error.message : String(error), "fail"));
  });
  checkButton?.addEventListener("click", async () => {
    checkButton.disabled = true;
    checkButton.dataset.loading = "true";
    try {
      await loadDocuments({ reset: true, endpoint: root.dataset.documentsCheckEndpoint || "/api/documents/check", method: "POST" });
      showToast(documentChangeToast({ summary: state.latestSummary }), state.latestSummary?.changes?.needsAttention ? "warn" : "pass");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "fail");
    } finally {
      checkButton.disabled = false;
      delete checkButton.dataset.loading;
    }
  });
  root.addEventListener("click", async (event) => {
    const menuToggle = event.target.closest("[data-document-menu-toggle]");
    if (menuToggle && root.contains(menuToggle)) {
      event.preventDefault();
      const menu = document.getElementById(menuToggle.getAttribute("aria-controls") || "");
      const willOpen = Boolean(menu?.hidden);
      closeDocumentMenus(root);
      if (menu) {
        menu.hidden = !willOpen;
        menuToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      }
      return;
    }

    const button = event.target.closest("[data-document-action]");
    if (!button || !root.contains(button)) return;
    closeDocumentMenus(root);
    const documentItem = documentFromActionButton(button);
    const action = button.dataset.documentAction;

    if (action === "copy-path") {
      const copied = await copyTextBestEffort(documentItem.relativePath || "");
      showToast(copied ? translate("documentsPanel.pathCopied") : translate("setup.pathCopyFailed"), copied ? "pass" : "fail");
      return;
    }

    if (action === "reveal") {
      button.disabled = true;
      try {
        const data = await fetchDocumentPayload(root.dataset.documentsRevealEndpoint || "/api/documents/reveal", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ document: documentItem })
        });
        showToast(documentRevealToast(data), "pass");
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), "fail");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action !== "exclude" && action !== "restore") return;
    const isRestore = action === "restore";
    const ok = await showConfirmDialog({
      title: translate(isRestore ? "documentsPanel.confirmRestoreTitle" : "documentsPanel.confirmExcludeTitle"),
      body: translate(isRestore ? "documentsPanel.confirmRestoreBody" : "documentsPanel.confirmExcludeBody"),
      confirmLabel: translate(isRestore ? "documentsPanel.actionRestore" : "documentsPanel.actionExclude")
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const endpoint = isRestore ? root.dataset.documentsRestoreEndpoint : root.dataset.documentsExcludeEndpoint;
      await fetchDocumentPayload(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ documents: [documentItem] })
      });
      await loadDocuments({ reset: true });
      showToast(isRestore ? translate("documentsPanel.includedStatus") : translate("documentsPanel.excludedByUser"), "pass");
    } catch (error) {
      button.disabled = false;
      showToast(error instanceof Error ? error.message : String(error), "fail");
    }
  });
  document.addEventListener("click", (event) => {
    if (!root.contains(event.target)) closeDocumentMenus(root);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDocumentMenus(root);
  });

  if (resultSummary) resultSummary.textContent = translate("documentsPanel.loading");
  loadDocuments({ reset: true }).catch((error) => showDocumentEmpty(root, error instanceof Error ? error.message : String(error)));
}

function bindDocumentAssetViewer() {
  const root = document.querySelector("[data-document-asset-viewer]");
  if (!root) return;
  const state = { document: null, pages: [], cursor: "0", hasMore: false, loading: false };
  const params = new URLSearchParams(window.location.search);
  const documentId = params.get("documentId") || params.get("id") || "";
  const documentPath = params.get("path") || "";
  const loadMoreButton = root.querySelector("[data-document-asset-load-more]");
  const revealButton = root.querySelector("[data-document-asset-reveal]");

  async function loadAsset({ reset = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.cursor = "0";
      state.pages = [];
      showDocumentAssetLoading(root);
    }
    updateDocumentAssetLoading(root, true);
    const query = new URLSearchParams();
    if (documentId) query.set("documentId", documentId);
    if (documentPath) query.set("path", documentPath);
    query.set("cursor", reset ? "0" : state.cursor || "0");
    query.set("limit", "30");
    try {
      const endpoint = root.dataset.documentAssetEndpoint || "/api/documents/asset";
      const data = await fetchDocumentPayload(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${query.toString()}`);
      state.document = data.document || null;
      state.pages = reset ? (data.pages || []) : [...state.pages, ...(data.pages || [])];
      state.cursor = data.pagination?.nextCursor || "";
      state.hasMore = data.pagination?.hasMore === true;
      renderDocumentAsset(root, state, data);
    } catch (error) {
      showDocumentAssetEmpty(root, error instanceof Error ? error.message : String(error));
      showToast(error instanceof Error ? error.message : String(error), "fail");
    } finally {
      state.loading = false;
      updateDocumentAssetLoading(root, false);
    }
  }

  loadMoreButton?.addEventListener("click", () => {
    loadAsset({ reset: false }).catch((error) => showToast(error instanceof Error ? error.message : String(error), "fail"));
  });

  revealButton?.addEventListener("click", async () => {
    if (!state.document) return;
    revealButton.disabled = true;
    try {
      const data = await fetchDocumentPayload(root.dataset.documentsRevealEndpoint || "/api/documents/reveal", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ document: state.document })
      });
      showToast(documentRevealToast(data), "pass");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "fail");
    } finally {
      revealButton.disabled = false;
    }
  });

  if (!documentId && !documentPath) {
    showDocumentAssetEmpty(root, translate("documentsPanel.assetMissing"));
    return;
  }
  loadAsset({ reset: true }).catch((error) => showDocumentAssetEmpty(root, error instanceof Error ? error.message : String(error)));
}

function showDocumentAssetLoading(root) {
  const titleNode = root.querySelector("[data-document-asset-title]");
  const subtitleNode = root.querySelector("[data-document-asset-subtitle]");
  const body = root.querySelector("[data-document-asset-body]");
  if (titleNode) titleNode.textContent = translate("documentsPanel.assetTitle");
  if (subtitleNode) subtitleNode.textContent = translate("documentsPanel.assetLead");
  if (body) body.innerHTML = `<div class="document-empty"><strong>${escapeHtml(translate("documentsPanel.assetLoading"))}</strong></div>`;
}

function updateDocumentAssetLoading(root, loading) {
  const button = root.querySelector("[data-document-asset-load-more]");
  if (button) button.disabled = loading;
  root.dataset.loading = loading ? "true" : "false";
}

function renderDocumentAsset(root, state, data) {
  const documentItem = data.document || state.document || {};
  const titleNode = root.querySelector("[data-document-asset-title]");
  const subtitleNode = root.querySelector("[data-document-asset-subtitle]");
  if (titleNode) titleNode.textContent = documentItem.title || documentItem.relativePath || translate("documentsPanel.assetTitle");
  if (subtitleNode) subtitleNode.textContent = documentAssetSubtitle(documentItem, data);
  renderDocumentAssetSummary(root, documentItem, data.summary || {}, data.version || null);
  renderDocumentAssetPages(root, state.pages, data);
  updateDocumentAssetPagination(root, state, data.pagination || {});
}

function documentAssetSubtitle(documentItem = {}, data = {}) {
  const parts = [
    documentItem.relativePath,
    data.version?.id ? `${translate("documentsPanel.version")} ${data.version.id}` : "",
    data.sidecar?.status === "ready" ? translate("documentsPanel.sidecarReady") : translate("documentsPanel.noSidecar")
  ].filter(Boolean);
  return parts.join(" · ");
}

function renderDocumentAssetSummary(root, documentItem = {}, summary = {}, version = null) {
  const node = root.querySelector("[data-document-asset-summary]");
  if (!node) return;
  const values = [
    [summary.pages ?? 0, translate("documentsPanel.pages")],
    [summary.chunks ?? 0, translate("documentsPanel.chunks")],
    [summary.sourceParts ?? 0, translate("documentsPanel.sourceParts")],
    [documentItem.displayVersion || version?.id || "-", translate("documentsPanel.version")]
  ];
  node.innerHTML = values.map(([value, label]) => `<span><strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong><em>${escapeHtml(label)}</em></span>`).join("");
}

function renderDocumentAssetPages(root, pages, data = {}) {
  const body = root.querySelector("[data-document-asset-body]");
  if (!body) return;
  if (!pages.length) {
    showDocumentAssetEmpty(root, data.sidecar?.status === "ready" ? translate("documentsPanel.assetMissing") : translate("documentsPanel.noSidecar"));
    return;
  }
  body.innerHTML = `<aside class="document-asset-page-nav">
      ${pages.map((page, index) => `<a href="#asset-page-${escapeHtml(String(page.pageStart || index + 1))}" title="${escapeHtml(documentAssetPageLabel(page, index))}">${escapeHtml(documentAssetPageLabel(page, index))}</a>`).join("")}
    </aside>
    <div class="document-asset-pages">
      ${pages.map((page, index) => renderDocumentAssetPage(page, index)).join("")}
    </div>`;
  scheduleOverflowTooltips();
}

function renderDocumentAssetPage(page, index) {
  const label = documentAssetPageLabel(page, index);
  const chunks = Array.isArray(page.chunks) ? page.chunks : [];
  return `<article class="document-asset-page" id="asset-page-${escapeHtml(String(page.pageStart || index + 1))}">
      <header>
        <span>${escapeHtml(label)}</span>
        <strong title="${escapeHtml(page.title || "")}">${escapeHtml(page.title || "")}</strong>
      </header>
      <pre class="document-asset-text">${escapeHtml(page.text || "")}</pre>
      <details class="document-asset-chunks">
        <summary>${escapeHtml(translate("documentsPanel.pageChunks"))} · ${chunks.length}</summary>
        <div>
          ${chunks.map((chunk) => `<section>
            <b title="${escapeHtml(chunk.chunkId || "")}">${escapeHtml(chunk.contentType || chunk.chunkId || "-")}</b>
            <span>${escapeHtml(documentChunkQualityLabel(chunk.quality || {}))}</span>
            <p>${escapeHtml(chunk.excerpt || "")}</p>
          </section>`).join("")}
        </div>
      </details>
    </article>`;
}

function documentAssetPageLabel(page, index) {
  const pageStart = Number(page.pageStart || 0);
  const pageEnd = Number(page.pageEnd || pageStart || 0);
  if (!pageStart) return `${translate("documentsPanel.page")} ${index + 1}`;
  return pageEnd && pageEnd !== pageStart
    ? `${translate("documentsPanel.page")} ${pageStart}-${pageEnd}`
    : `${translate("documentsPanel.page")} ${pageStart}`;
}

function documentChunkQualityLabel(quality = {}) {
  const score = Number(quality.score || 0);
  const lifecycle = quality.lifecycle || "";
  const parts = [];
  if (score) parts.push(`${score}`);
  if (lifecycle) parts.push(lifecycle);
  return parts.join(" · ") || "-";
}

function updateDocumentAssetPagination(root, state, pagination = {}) {
  const button = root.querySelector("[data-document-asset-load-more]");
  if (!button) return;
  button.hidden = !state.hasMore;
  if (!state.hasMore) return;
  const shown = Number(pagination.nextCursor || state.pages.length || 0);
  const total = Number(pagination.totalPages || shown || 0);
  button.textContent = `${translate("documentsPanel.loadMorePages")} (${Math.min(shown, total)}/${total})`;
}

function showDocumentAssetEmpty(root, message) {
  const titleNode = root.querySelector("[data-document-asset-title]");
  const subtitleNode = root.querySelector("[data-document-asset-subtitle]");
  const body = root.querySelector("[data-document-asset-body]");
  if (titleNode) titleNode.textContent = translate("documentsPanel.assetTitle");
  if (subtitleNode) subtitleNode.textContent = translate("documentsPanel.assetLead");
  if (!body) return;
  body.innerHTML = `<div class="document-empty"><strong>${escapeHtml(message || translate("documentsPanel.assetMissing"))}</strong></div>`;
}

async function fetchDocumentPayload(endpoint, options = {}) {
  const response = await fetch(endpoint, { headers: { accept: "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || data.scanError || "documents failed");
  return data;
}

function updateDocumentPanel(root, state, data, options = {}) {
  const incoming = Array.isArray(data.documents) ? data.documents : [];
  state.documents = options.append ? [...state.documents, ...incoming] : incoming;
  state.changes = data.changes || null;
  state.latestSummary = data.summary || {};
  state.latestResult = data.resultSummary || {};
  state.cursor = data.pagination?.nextCursor || "";
  state.hasMore = data.pagination?.hasMore === true;
  updateDocumentStats(root, data.summary || {});
  renderDocumentResultSummary(root, state, data);
  renderDocumentChangeBanner(root, state.changes);
  renderDocumentRows(root, state);
  updateDocumentPagination(root, state, data.pagination || {});
}

function updateDocumentStats(root, summary) {
  const changes = summary.changes || {};
  const values = {
    total: summary.totalDocuments ?? 0,
    included: summary.includedDocuments ?? 0,
    excluded: summary.excludedDocuments ?? 0,
    attention: changes.needsAttention ?? 0
  };
  Object.entries(values).forEach(([key, value]) => {
    const node = root.querySelector(`[data-document-stat="${key}"]`);
    if (node) node.textContent = String(value);
  });
}

function renderDocumentResultSummary(root, state, data) {
  const node = root.querySelector("[data-document-result-summary]");
  if (!node) return;
  if (!data) {
    node.textContent = "";
    return;
  }
  const summary = data.summary || {};
  const result = data.resultSummary || {};
  const counts = result.statusCounts || {};
  const query = result.query || state.query || "";
  const filter = result.filter || state.filter || "all";
  const title = documentResultTitle(query, filter);
  const range = result.totalMatched
    ? `${translate("documentsPanel.loaded")} ${result.showingFrom}-${result.showingTo}`
    : `${translate("documentsPanel.loaded")} 0`;
  const detail = filter === "all" && !query
    ? `${translate("documentsPanel.total")} ${summary.totalDocuments ?? 0} · ${translate("documentsPanel.included")} ${summary.includedDocuments ?? 0} · ${translate("documentsPanel.excluded")} ${summary.excludedDocuments ?? 0} · ${translate("documentsPanel.attention")} ${summary.changes?.needsAttention ?? 0}`
    : `${translate("documentsPanel.matched")} ${result.totalMatched ?? 0} · ${range} · ${translate("documentsPanel.included")} ${counts.included ?? 0} · ${translate("documentsPanel.excluded")} ${counts.excluded ?? 0} · ${translate("documentsPanel.attention")} ${counts.attention ?? 0}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
}

function documentResultTitle(query, filter) {
  if (query) return settings.lang === "zh" ? `搜索“${query}”` : `Search "${query}"`;
  if (filter && filter !== "all") return settings.lang === "zh" ? `筛选：${documentFilterLabel(filter)}` : `Filter: ${documentFilterLabel(filter)}`;
  return settings.lang === "zh" ? "全部资料" : "All documents";
}

function documentFilterLabel(filter) {
  return {
    included: translate("documentsPanel.included"),
    excluded: translate("documentsPanel.excluded"),
    attention: translate("documentsPanel.attention"),
    all: translate("documentsPanel.all")
  }[filter] || filter;
}

function renderDocumentChangeBanner(root, changes) {
  const node = root.querySelector("[data-document-change]");
  if (!node) return;
  const summary = changes?.summary;
  if (!summary) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.dataset.status = summary.needsAttention > 0 ? "warn" : "pass";
  node.innerHTML = `<strong>${escapeHtml(summary.needsAttention > 0 ? translate("documentsPanel.changes") : translate("documentsPanel.noChanges"))}</strong><span>${escapeHtml(documentChangeSummaryText(summary))}</span>`;
}

function renderDocumentRows(root, state) {
  const list = root.querySelector("[data-document-list]");
  if (!list) return;
  if (!state.documents.length) {
    showDocumentEmpty(root, translate("documentsPanel.emptyBody"));
    return;
  }
  list.innerHTML = state.documents.map((documentItem) => renderDocumentRow(documentItem)).join("");
  scheduleOverflowTooltips();
}

function renderDocumentRow(documentItem) {
  const status = documentItem.changeStatus || documentItem.status || "included";
  const action = documentActionFor(documentItem);
  const title = documentItem.title || documentItem.relativePath || "";
  const actionAttrs = documentActionAttributes(documentItem, status);
  const menuId = documentMenuId(documentItem);
  const version = documentDisplayVersionLabel(documentItem);
  const updated = documentUpdatedLabel(documentItem);
  const menuLabel = documentMenuLabel(documentItem);
  const maintenanceAction = action
    ? `<div class="document-menu-group document-menu-group--danger" role="group" aria-label="${escapeHtml(translate("documentsPanel.menuMaintain"))}">
        <button type="button" class="document-menu-item${action === "exclude" ? " document-menu-item--danger" : ""}" data-document-action="${escapeHtml(action)}" ${actionAttrs}>${escapeHtml(action === "restore" ? translate("documentsPanel.actionRestore") : translate("documentsPanel.actionExclude"))}</button>
      </div>`
    : "";
  return `<article class="document-row" data-status="${escapeHtml(status)}">
    <div class="document-row-main">
      <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
      <code title="${escapeHtml(documentItem.relativePath || "")}">${escapeHtml(documentItem.relativePath || "")}</code>
    </div>
    <div class="document-row-meta">
      <span title="${escapeHtml(documentItem.sourceType || "-")}">${escapeHtml(documentItem.sourceType || "-")}</span>
      <b>${escapeHtml(documentStatusLabel(status))}</b>
    </div>
    <div class="document-row-version">
      <span title="${escapeHtml(version)}">${escapeHtml(version)}</span>
      <em title="${escapeHtml(updated)}">${escapeHtml(updated)}</em>
    </div>
    <div class="document-row-actions">
      <a class="secondary-action quiet-action document-open-action" href="${escapeHtml(documentAssetHref(documentItem))}" title="${escapeHtml(translate("documentsPanel.openAsset"))}">${escapeHtml(translate("documentsPanel.openAsset"))}</a>
      <div class="document-action-menu">
        <button class="document-menu-toggle" type="button" data-document-menu-toggle aria-haspopup="menu" aria-expanded="false" aria-controls="${escapeHtml(menuId)}" aria-label="${escapeHtml(menuLabel)}" title="${escapeHtml(menuLabel)}">
          <span aria-hidden="true">⋮</span>
          <span class="visually-hidden">${escapeHtml(menuLabel)}</span>
        </button>
        <div class="document-menu" id="${escapeHtml(menuId)}" data-document-menu role="menu" hidden>
          <div class="document-menu-group" role="group" aria-label="${escapeHtml(translate("documentsPanel.menuView"))}">
            <button type="button" role="menuitem" class="document-menu-item" data-document-action="reveal" ${actionAttrs}>${escapeHtml(translate("documentsPanel.locate"))}</button>
            <button type="button" role="menuitem" class="document-menu-item" data-document-action="copy-path" ${actionAttrs}>${escapeHtml(translate("documentsPanel.copyPath"))}</button>
          </div>
          ${maintenanceAction}
        </div>
      </div>
    </div>
  </article>`;
}

function documentMenuLabel(documentItem = {}) {
  const label = translate("documentsPanel.moreActions") || "More actions";
  const title = documentItem.title || documentItem.relativePath || "";
  const separator = settings.lang === "zh" ? "：" : ": ";
  return title ? `${label}${separator}${title}` : label;
}

function documentAssetHref(documentItem = {}) {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/maintain\/documents$/, "/maintain/document");
  url.search = "";
  if (documentItem.document_id) url.searchParams.set("documentId", documentItem.document_id);
  else if (documentItem.relativePath) url.searchParams.set("path", documentItem.relativePath);
  return `${url.pathname}${url.search}`;
}

function showDocumentLoading(root) {
  const list = root.querySelector("[data-document-list]");
  if (!list) return;
  list.innerHTML = Array.from({ length: 5 }, () => `<div class="document-row document-row-skeleton"><span></span><span></span><span></span></div>`).join("");
}

function showDocumentEmpty(root, message) {
  const list = root.querySelector("[data-document-list]");
  if (!list) return;
  list.innerHTML = `<div class="document-empty"><strong>${escapeHtml(translate("documentsPanel.emptyTitle"))}</strong><span>${escapeHtml(message || translate("documentsPanel.emptyBody"))}</span></div>`;
}

function updateDocumentPagination(root, state, pagination = {}) {
  const button = root.querySelector("[data-document-load-more]");
  if (!button) return;
  button.hidden = !state.hasMore;
  if (!state.hasMore) return;
  const shown = pagination.nextCursor ? Number(pagination.nextCursor) : state.documents.length;
  const total = pagination.totalMatched ?? state.latestResult?.totalMatched ?? state.documents.length;
  button.textContent = `${translate("documentsPanel.loadMore")} (${Math.min(shown, total)}/${total})`;
}

function updateDocumentLoadingState(root, loading) {
  const button = root.querySelector("[data-document-load-more]");
  const summary = root.querySelector("[data-document-result-summary]");
  if (button) button.disabled = loading;
  if (summary) summary.dataset.loading = loading ? "true" : "false";
}

function closeDocumentMenus(root) {
  root.querySelectorAll("[data-document-menu]").forEach((menu) => { menu.hidden = true; });
  root.querySelectorAll("[data-document-menu-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}
function documentRevealToast(data = {}) {
  if (data.resolvedFrom === "source-part") return translate("documentsPanel.locatedSourcePart");
  return data.selected ? translate("documentsPanel.locatedFile") : translate("documentsPanel.openedDirectory");
}
function documentActionFor(documentItem) {
  if (documentItem.status === "excluded_by_user") return "restore";
  if (documentItem.status === "included" || !documentItem.status) return "exclude";
  return "";
}

function documentActionAttributes(documentItem, status) {
  return [
    ["data-document-id", documentItem.document_id || ""],
    ["data-document-path", documentItem.relativePath || ""],
    ["data-document-title", documentItem.title || ""],
    ["data-document-type", documentItem.sourceType || ""],
    ["data-document-status", status || documentItem.status || ""],
    ["data-document-version", documentItem.version_id || ""],
    ["data-document-display-version", documentDisplayVersionLabel(documentItem)],
    ["data-document-updated-at", documentItem.updatedAt || ""],
    ["data-document-fingerprint", documentItem.source_fingerprint || ""]
  ].map(([key, value]) => `${key}="${escapeHtml(value)}"`).join(" ");
}

function documentMenuId(documentItem) {
  const raw = documentItem.document_id || documentItem.version_id || documentItem.relativePath || documentItem.title || "document";
  return `document-menu-${String(raw).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96)}`;
}

function documentFromActionButton(button) {
  return {
    document_id: button.dataset.documentId || "",
    relativePath: button.dataset.documentPath || "",
    title: button.dataset.documentTitle || "",
    sourceType: button.dataset.documentType || "",
    status: button.dataset.documentStatus || "",
    version_id: button.dataset.documentVersion || "",
    displayVersion: button.dataset.documentDisplayVersion || "",
    updatedAt: button.dataset.documentUpdatedAt || "",
    source_fingerprint: button.dataset.documentFingerprint || ""
  };
}

function documentDisplayVersionLabel(documentItem = {}) {
  return documentItem.displayVersion
    || documentItem.display_version
    || documentItem.contentVersion
    || documentItem.content_version
    || translate("documentsPanel.unknown");
}

function documentUpdatedLabel(documentItem = {}) {
  const value = documentItem.updatedAt || documentItem.updated_at || "";
  if (!value) return translate("documentsPanel.unknown");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(settings.lang === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function documentStatusLabel(status) {
  const labels = {
    included: translate("documentsPanel.includedStatus"),
    excluded: translate("documentsPanel.excluded"),
    excluded_by_user: translate("documentsPanel.excludedByUser"),
    added: translate("documentsPanel.added"),
    modified: translate("documentsPanel.modified"),
    missing: translate("documentsPanel.missing")
  };
  return labels[status] || status || "-";
}

function documentChangeSummaryText(summary) {
  const parts = [];
  if (summary.added) parts.push(`${translate("documentsPanel.added")} ${summary.added}`);
  if (summary.modified) parts.push(`${translate("documentsPanel.modified")} ${summary.modified}`);
  if (summary.missing) parts.push(`${translate("documentsPanel.missing")} ${summary.missing}`);
  return parts.join(" · ") || translate("documentsPanel.noChanges");
}

function documentChangeToast(data) {
  const summary = data?.summary?.changes;
  if (!summary) return translate("documentsPanel.noChanges");
  return documentChangeSummaryText(summary);
}
function initializeOverflowTooltips() {
  if (overflowTooltipObserver || !document.body) return;
  overflowTooltipObserver = new MutationObserver(scheduleOverflowTooltips);
  overflowTooltipObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "data-status", "data-selected"]
  });
  window.addEventListener("resize", scheduleOverflowTooltips);
  scheduleOverflowTooltips();
}

function scheduleOverflowTooltips() {
  if (overflowTooltipTimer) window.cancelAnimationFrame(overflowTooltipTimer);
  overflowTooltipTimer = window.requestAnimationFrame(() => {
    overflowTooltipTimer = 0;
    applyOverflowTooltips();
  });
}

function applyOverflowTooltips() {
  const selector = [
    ".nav-text",
    ".route-chip > span:not(.route-chip-mark)",
    ".work-page-title-row h1",
    ".work-page-kicker span",
    ".work-page-kicker strong",
    ".api-result-copy strong",
    ".api-result-copy span",
    ".job-pipeline button strong",
    ".job-pipeline button em",
    ".job-log-stream time",
    ".job-log-stream code",
    ".job-log-stream span",
    ".job-log-stream p",
    ".job-artifacts summary span",
    ".job-artifacts summary em",
    ".job-artifact-list span",
    ".job-artifact-list em",
    ".job-artifact-list code",
    ".job-disclosure summary span",
    ".job-disclosure summary em",
    ".execution-stage strong",
    ".execution-stage p",
    ".execution-pill",
    ".execution-round-main strong",
    ".execution-round-main p",
    ".execution-round-main em",
    ".execution-metrics b",
    ".execution-metrics em",
    ".draft-field input",
    ".draft-field textarea",
    ".draft-field select",
    ".model-slot-control select",
    ".model-slot-detail p",
    ".folder-picker-result code",
    ".credential-location-list code",
    ".document-row-main strong",
    ".document-row-main code",
    ".document-row-meta span",
    ".document-row-meta b",
    ".document-row-version span",
    ".document-row-version em"
  ].join(",");

  document.querySelectorAll(selector).forEach((node) => {
    applyOverflowTooltip(node);
  });
}

function applyOverflowTooltip(node) {
  if (!(node instanceof HTMLElement)) return;
  if (node.closest(".icon-sprite") || node.closest("[aria-hidden='true']")) return;
  const autoTitle = node.dataset.overflowTitle === "true";
  const manualTitle = node.hasAttribute("title") && !autoTitle;
  if (manualTitle) return;
  const value = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement
    ? node.value || node.selectedOptions?.[0]?.textContent || ""
    : node.textContent || "";
  const text = value.replace(/\s+/g, " ").trim();
  const overflowing = node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;
  if (overflowing && text) {
    node.setAttribute("title", text);
    node.dataset.overflowTitle = "true";
    return;
  }
  if (autoTitle) {
    node.removeAttribute("title");
    delete node.dataset.overflowTitle;
  }
}

async function ensureSetupStepCanComplete(stepKey, completeButton) {
  const requiredFields = missingRequiredSetupFields(stepKey);
  if (requiredFields.length) {
    showRequiredFieldsMessage(stepKey, "fail", requiredFields);
    focusDraftField(requiredFields[0]);
    return false;
  }

  const actionKey = requiredSetupActionForStep(stepKey);
  if (!actionKey) {
    showRequiredFieldsMessage(stepKey, "pass");
    return true;
  }

  const resultNode = resultNodeForAction(actionKey);
  if (!resultNode) {
    showSetupGateMessage(resultNode, "fail", actionKey, "missingAction");
    return false;
  }

  if (setupRequiredActionPassed(actionKey)) return true;
  showSetupGateMessage(resultNodeForAction(actionKey), "fail", actionKey, "blocked");
  refreshSetupContinueState();
  return false;
}

function requiredSetupActionForStep(stepKey) {
  return {
    "aliyun-credential": "save-aliyun-credentials",
    "aliyun-permissions": "check-aliyun-permissions",
    "aliyun-storage": "preview-aliyun-storage",
    "aliyun-services": "test-aliyun-model-provider",
    "aliyun-model-quality": "save-aliyun-model-quality",
    "aliyun-search": "save-aliyun-search",
    retrieval: "save-retrieval-strategy",
    environment: "check-environment",
    scan: "preview-scan",
    plan: "preview-run"
  }[stepKey] || "";
}

function requiredSetupFieldsForStep(stepKey) {
  return {
    "aliyun-account": ["aliyun.account.method"],
    "aliyun-credential": ["aliyun.credential.accessKeyId", "aliyun.credential.accessKeySecret", "aliyun.credential.saveTarget"],
    project: ["project.source", "project.workspace", "metadata.stage", "metadata.subject", "metadata.grade"]
  }[stepKey] || [];
}

function missingRequiredSetupFields(stepKey) {
  const draft = collectDraftFields();
  return requiredSetupFieldsForStep(stepKey).filter((key) => {
    if (key === "aliyun.credential.accessKeyId" && credentialSecretConfigured()) return false;
    if (key === "aliyun.credential.accessKeySecret" && credentialSecretConfigured()) return false;
    return draftValueMissing(draft[key]);
  });
}

function focusDraftField(key) {
  const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"]`);
  if (field?.type === "hidden") {
    document.querySelector(`[data-k12-range-field="${cssEscape(key)}"] [data-k12-option]:not([hidden]):not([disabled])`)?.focus?.();
    return;
  }
  field?.focus?.();
}

function credentialSecretConfigured() {
  return Boolean(draftState["aliyun.credential.accessKeySecret.configured"]);
}

function modelProviderKeyConfigured() {
  return Boolean(draftState["aliyun.model.apiKey.configured"]);
}

function credentialInputState() {
  const idField = document.querySelector('[data-draft-field="aliyun.credential.accessKeyId"]');
  const secretField = document.querySelector('[data-draft-field="aliyun.credential.accessKeySecret"]');
  const accessKeyId = String(idField?.value || "").trim();
  const accessKeySecret = String(secretField?.value || "").trim();
  const idMasked = idField?.dataset.credentialMasked === "true";
  return {
    accessKeyId,
    accessKeySecret,
    idMasked,
    hasCurrentInput: Boolean(accessKeySecret || (accessKeyId && !idMasked))
  };
}

function modelProviderInputState() {
  const apiKeyField = document.querySelector('[data-draft-field="aliyun.model.apiKey"]');
  return {
    provider: String(document.querySelector('[data-draft-field="aliyun.model.provider"]')?.value || "aliyun-bailian").trim(),
    protocol: String(document.querySelector('[data-draft-field="aliyun.model.protocol"]')?.value || "openai-compatible").trim(),
    region: String(document.querySelector('[data-draft-field="aliyun.model.region"]')?.value || "cn-beijing").trim(),
    workspaceId: String(document.querySelector('[data-draft-field="aliyun.model.workspaceId"]')?.value || "").trim(),
    baseUrl: String(document.querySelector('[data-draft-field="aliyun.model.baseUrl"]')?.value || "").trim(),
    apiKey: String(apiKeyField?.value || ""),
    hasCurrentInput: Boolean(String(apiKeyField?.value || "").trim())
  };
}

function applyAll() {
  applyTheme();
  applySidebar();
  applyLanguage();
  applyTemplates();
  applyDraftPanels();
  applyAccountMethod();
  const redirected = applySetupState();
  if (!redirected) finishPreferenceHydration();
}

function applyTheme() {
  root.dataset.theme = settings.theme;
  root.style.colorScheme = settings.theme;
  document.querySelectorAll("[data-theme-option]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeOption === settings.theme));
  });
}

function finishPreferenceHydration() {
  delete root.dataset.preferenceHydrating;
  root.dataset.preferenceReady = "true";
}

function setMode(mode, resetSetupAfterMode) {
  const previous = settings.mode;
  settings.mode = mode;
  draftState["setup.mode"] = settings.mode;
  writeDraft(draftState);
  syncDraftToServer();
  if (previous !== mode) clearPersistentSetupActionResults();
  if (resetSetupAfterMode && previous !== mode) {
    const inferred = inferCompletedSetupStepsFromDraft(draftState, mode);
    if (setupConfigurationReady(inferred, mode)) writeSetupCompleted(inferred);
    else keepSetupCompletedThrough("mode");
  }
  applyMode();
  applySetupState();
}

function applyMode() {
  root.dataset.mode = settings.mode;

  document.querySelectorAll("[data-mode-option]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.modeOption === settings.mode));
  });

  const modeLabel = translate(`modes.${settings.mode}.label`);
  const modeDescription = translate(`modes.${settings.mode}.description`);
  document.querySelectorAll("[data-mode-label]").forEach((node) => {
    if (modeLabel !== undefined) node.textContent = modeLabel;
  });
  document.querySelectorAll("[data-mode-description]").forEach((node) => {
    if (modeDescription !== undefined) node.textContent = modeDescription;
  });

  document.querySelectorAll("[data-mode-i18n]").forEach((node) => {
    const key = node.dataset.modeI18n.replace("{mode}", settings.mode);
    const value = translate(key);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-focused-mode-i18n]").forEach((node) => {
    const key = node.dataset.focusedModeI18n.replace("{mode}", settings.mode);
    const value = translate(key);
    if (value !== undefined) node.textContent = value;
  });

  applyConfigSummary();
}

function setAccountMethod(method) {
  const field = accountMethodField();
  if (!field) return;
  const nextMethod = supportedAccountMethod(method);
  if (currentAccountMethod() === nextMethod) {
    applyAccountMethod();
    return;
  }
  field.value = nextMethod;
  saveDraftField(field);
  resetAccountMethodStage();
  applyAccountMethod();
}

async function runSelectedAccountAction(button) {
  persistVisibleDraftFields();
  const method = currentAccountMethod();

  if (method === "dedicated-ram") {
    await completeAccountStepsAndNavigate("aliyun-account", button.dataset.accountDedicatedNext || "/setup/aliyun/credential");
    return;
  }

  if (method === "existing-profile") {
    await runExistingAccountCheck(button);
    return;
  }

  if (method === "need-create") {
    showAccountCreationGuide();
  }
}

function resetAccountMethodStage() {
  const resultNode = document.querySelector("[data-account-method-result]");
  const guideNode = document.querySelector("[data-account-creation-guide]");
  const stageNode = document.querySelector("[data-account-method-stage]");
  if (resultNode) {
    resultNode.hidden = true;
    resultNode.innerHTML = "";
  }
  if (guideNode) guideNode.hidden = true;
  if (stageNode) stageNode.dataset.stageState = "idle";
}

async function runExistingAccountCheck(button) {
  const scrollPosition = currentScrollPosition();
  const resultNode = document.querySelector("[data-account-method-result]");
  const guideNode = document.querySelector("[data-account-creation-guide]");
  const stageNode = document.querySelector("[data-account-method-stage]");
  const endpoint = button.dataset.accountCheckEndpoint || "/api/aliyun/identity/check";

  if (guideNode) guideNode.hidden = true;
  if (stageNode) stageNode.dataset.stageState = "result";
  button.disabled = true;
  showApiResult(
    resultNode,
    "working",
    translate("setup.accountCheckLoading") || (settings.lang === "zh" ? "正在检测本机阿里云配置..." : "Checking local Aliyun configuration..."),
    "check-existing-aliyun-config"
  );
  restoreScrollPosition(scrollPosition);

  try {
    await syncDraftToServerNow();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ mode: settings.mode, template: settings.template, draft: collectDraftFields({ includeSensitive: false }) })
    });
    const data = await response.json();
    if (!response.ok && !hasRenderableApiData(data)) throw new Error(data.error || "Request failed.");
    showApiChecks(resultNode, data, "check-existing-aliyun-config", { showDialog: false });
    renderAccountCheckNextAction(resultNode, data, button);
    restoreScrollPosition(scrollPosition);
  } catch {
    showApiResult(
      resultNode,
      "fail",
      translate("setup.accountCheckFail") || (settings.lang === "zh" ? "没有检测到可用配置。请改为填写本机凭证。" : "No usable configuration was found. Enter a local credential instead."),
      "check-existing-aliyun-config",
      { showDialog: false }
    );
    renderAccountCheckNextAction(resultNode, { ok: false }, button);
    restoreScrollPosition(scrollPosition);
  } finally {
    button.disabled = false;
    restoreScrollPosition(scrollPosition);
  }
}

function renderAccountCheckNextAction(resultNode, data, button) {
  if (!resultNode) return;
  const ok = isApiResultClear(data, "check-existing-aliyun-config");
  const nextPath = ok ? button.dataset.accountSuccessNext : button.dataset.accountFailureNext;
  const label = ok
    ? translate("setup.accountContinuePermissions") || (settings.lang === "zh" ? "继续检查账号" : "Continue to Account Check")
    : translate("setup.accountContinueCredential") || (settings.lang === "zh" ? "去填写凭证" : "Enter Credentials");
  const stepKeys = ok ? ["aliyun-account", "aliyun-credential"] : ["aliyun-account"];
  const state = apiResultState.get(resultNode);
  const actionHtml = `<div class="account-result-actions">
    <button class="primary-action" type="button" data-account-result-next data-account-next="${escapeHtml(nextPath || "/setup/aliyun/credential")}" data-account-complete-steps="${escapeHtml(stepKeys.join(","))}">${escapeHtml(label)}</button>
  </div>`;
  if (state) {
    state.contentHtml = `${state.contentHtml || ""}${actionHtml}`;
    apiResultState.set(resultNode, state);
  }
  resultNode.classList.add("api-result--with-action");
  resultNode.insertAdjacentHTML("beforeend", actionHtml);
  window.setTimeout(() => bindAccountResultActions(document), 0);
}

function showAccountCreationGuide() {
  const scrollPosition = currentScrollPosition();
  const resultNode = document.querySelector("[data-account-method-result]");
  const guideNode = document.querySelector("[data-account-creation-guide]");
  const stageNode = document.querySelector("[data-account-method-stage]");
  if (resultNode) resultNode.hidden = true;
  if (guideNode) guideNode.hidden = false;
  if (stageNode) stageNode.dataset.stageState = "guide";
  restoreScrollPosition(scrollPosition);
}

function currentScrollPosition() {
  return { x: window.scrollX || 0, y: window.scrollY || 0 };
}

function restoreScrollPosition(position) {
  if (!position) return;
  window.scrollTo(position.x, position.y);
}

function bindAccountResultActions(scope = document) {
  scope.querySelectorAll("[data-account-result-next], [data-account-guide-continue]").forEach((button) => {
    if (button.dataset.accountNextBound === "true") return;
    button.dataset.accountNextBound = "true";
    button.addEventListener("click", async () => {
      await completeAccountStepsAndNavigate(button.dataset.accountCompleteSteps, button.dataset.accountNext);
    });
  });
}

async function completeAccountStepsAndNavigate(stepList, nextPath) {
  await syncDraftToServerNow();
  const completed = readSetupCompleted();
  String(stepList || "aliyun-account")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((step) => completed.add(step));
  writeSetupCompleted(completed);
  applyConfigSummary();
  if (nextPath) navigateTo(nextPath);
}

function accountMethodField() {
  return document.querySelector("[data-draft-field=\"aliyun.account.method\"]");
}

function currentAccountMethod() {
  const field = accountMethodField();
  return supportedAccountMethod(draftState["aliyun.account.method"] || field?.value || "dedicated-ram");
}

function supportedAccountMethod(method) {
  return ["dedicated-ram", "existing-profile", "need-create"].includes(method) ? method : "dedicated-ram";
}

function applyAccountMethod() {
  const field = accountMethodField();
  if (!field) return;
  const method = currentAccountMethod();
  if (field.value !== method) field.value = method;

  document.querySelectorAll("[data-account-method-panel]").forEach((panel) => {
    panel.dataset.accountMethod = method;
  });

  document.querySelectorAll("[data-account-method-option]").forEach((button) => {
    const selected = button.dataset.accountMethodOption === method;
    button.dataset.selected = String(selected);
    if (button.matches("button")) button.setAttribute("aria-pressed", String(selected));
  });

  if (method !== "need-create") {
    const guideNode = document.querySelector("[data-account-creation-guide]");
    if (guideNode) guideNode.hidden = true;
  }
}

function setTemplate(templateId, resetSetupAfterTemplate) {
  const previous = settings.template;
  settings.template = templateId;
  draftState["template.id"] = settings.template;
  writeDraft(draftState);
  syncDraftToServer();
  if (previous !== templateId) clearPersistentSetupActionResults();
  if (resetSetupAfterTemplate && previous !== templateId) keepSetupCompletedThrough("template");
  applyTemplates();
  applySetupState();
}

function applyTemplates() {
  root.dataset.template = settings.template;
  const selected = currentTemplate();
  if (!selected) return;

  document.querySelectorAll("[data-template-option]").forEach((button) => {
    const active = button.dataset.templateOption === selected.id;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelectorAll("[data-template-field]").forEach((node) => {
    const template = templateById(node.dataset.templateId);
    const value = localized(template?.[node.dataset.templateField]);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-template-filter-label]").forEach((node) => {
    const template = templateById(node.dataset.templateFilterLabel);
    const value = localized(template?.vectorFilterPolicy?.label);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-template-recommended]").forEach((node) => {
    const value = translate("app.recommended");
    if (value !== undefined) node.textContent = value;
  });

  setText("[data-selected-template-title]", localized(selected.title));
  renderTemplateContractPanel(selected);
  renderProjectDraftFields(selected);
  applyConfigSummary();
}

function renderTemplateContractPanel(template) {
  const panel = document.querySelector("[data-template-contract-panel]");
  if (!panel || !template) return;
  const metadataContract = template.metadataContract || {};
  const aliyunContract = template.aliyunMetadataContract || {};
  const set = (selector, value) => {
    const node = panel.querySelector(selector);
    if (node) node.textContent = String(value || "");
  };
  set("[data-template-contract-title]", template.expertName || template.coreName || localized(template.title));
  set("[data-template-library-version]", templateVersionLabel("app.templateLibraryVersion", pageState.templateLibraryVersion));
  set("[data-template-contract-version]", templateVersionLabel("app.currentTemplateVersion", template.version));
  set("[data-template-contract-summary]", localized(metadataContract.summary) || localized(template.summary));
  set("[data-template-contract-search]", listContractFields(metadataContract.requiredForSearch));
  set("[data-template-contract-citation]", listContractFields(metadataContract.requiredForCitation));
  set("[data-template-contract-filters]", listContractFields(metadataContract.queryFilters));
  set("[data-template-contract-sidecar]", localized(aliyunContract.summary));
}

function templateVersionLabel(labelKey, version) {
  const label = translate(labelKey) || labelKey;
  return `${label} v${version || "-"}`;
}

function listContractFields(fields) {
  if (!Array.isArray(fields) || !fields.length) return "";
  return fields.map((item) => localized(item) || item).filter(Boolean).join(" · ");
}

function applyTaskBriefs() {
  document.querySelectorAll("[data-task-brief]").forEach((node) => {
    const [stepKey, key] = node.dataset.taskBrief.split(".");
    const value = localized(pageState.setupTaskBriefs?.[stepKey]?.[key]);
    if (value !== undefined) node.textContent = value;
  });
}

function applyAliyunGuides() {
  document.querySelectorAll("[data-aliyun-guide]").forEach((node) => {
    const [stepKey, key] = node.dataset.aliyunGuide.split(".");
    const value = localized(pageState.setupAliyunGuides?.[stepKey]?.[key]);
    if (value !== undefined) node.textContent = value;
  });
}

function renderProjectDraftFields(template) {
  const target = document.querySelector('[data-draft-fields="project"]');
  if (!target || !template) return;

  target.innerHTML = renderProjectDraftSections(template);
  bindDraftFields(target);
  applyK12RangeFields();
  renderProjectChecklist(template);
}

function renderProjectDraftSections(template) {
  const sections = ["source", "workspace", "metadata"].map((sectionKey) => {
    const fields = template.requiredFields.filter((field) => projectSectionForTemplateField(field.key) === sectionKey);
    if (!fields.length) return "";
    const section = pageState.projectDraftSections?.[sectionKey] || {};
    if (sectionKey === "metadata" && fields.some((field) => isSourceScopeFieldKey(draftKeyForTemplateField(field.key)))) {
      return renderProjectSourceScopeSection(template, fields, section);
    }
    return `<section class="draft-field-section" data-project-field-section="${escapeHtml(sectionKey)}">
                <div class="draft-field-section-head">
                  <strong data-project-section-title="${escapeHtml(sectionKey)}">${escapeHtml(localized(section.title) || "")}</strong>
                  <p data-project-section-note="${escapeHtml(sectionKey)}">${escapeHtml(localized(section.note) || "")}</p>
                </div>
                <div class="draft-field-section-fields">
                  ${fields.map((field) => renderProjectDraftField(template, field, { hideLabel: sectionKey === "source" || sectionKey === "workspace" })).join("")}
                </div>
              </section>`;
  }).filter(Boolean);
  return `${sections.join("")}${renderFolderPickerResultSlot()}`;
}

function isSourceScopeFieldKey(key) {
  return sourceScopeRequiredKeys.includes(key) || sourceScopeExtraKeys.includes(key);
}

function renderProjectSourceScopeSection(template, fields, section) {
  const fieldMap = new Map(fields.map((field) => [draftKeyForTemplateField(field.key), field]));
  const requiredSteps = sourceScopeRequiredKeys
    .map((key, index) => renderProjectSourceScopeStep(template, fieldMap.get(key), index + 1))
    .join("");
  const extraFields = sourceScopeExtraKeys
    .map((key) => fieldMap.get(key))
    .filter(Boolean)
    .map((field) => renderProjectDraftField(template, field))
    .join("");
  const status = sourceScopeStatusContent();

  return `<section class="draft-field-section source-scope-section" data-project-field-section="metadata" data-source-scope>
                <div class="draft-field-section-head source-scope-head">
                  <div>
                    <strong>${escapeHtml(localized(section.title) || "")}</strong>
                    <p>${escapeHtml(localized(section.note) || "")}</p>
                  </div>
                  <div class="source-scope-status" data-source-scope-status data-state="${escapeHtml(status.state)}">
                    <strong data-source-scope-status-title>${escapeHtml(status.title)}</strong>
                    <span data-source-scope-status-note>${escapeHtml(status.note)}</span>
                  </div>
                </div>
                <div class="source-scope-steps">
                  ${requiredSteps}
                </div>
                ${extraFields ? `<details class="source-scope-extra" data-source-scope-extra>
                  <summary data-source-scope-extra-summary>${escapeHtml(translate("setup.sourceScope.extraTitle") || "")}<span>${escapeHtml(translate("setup.sourceScope.extraNote") || "")}</span></summary>
                  <div class="source-scope-extra-fields">
                    ${extraFields}
                  </div>
                </details>` : ""}
              </section>`;
}

function renderProjectSourceScopeStep(template, field, index) {
  if (!field) return "";
  const key = draftKeyForTemplateField(field.key);
  const stepKey = sourceScopeStepKey(key);
  const title = translate(`setup.sourceScope.steps.${stepKey}.title`) || localized(field.label);
  const desc = translate(`setup.sourceScope.steps.${stepKey}.desc`) || "";
  return `<article class="source-scope-step" data-source-scope-step="${escapeHtml(key)}">
                    <div class="source-scope-step-head">
                      <span class="source-scope-step-index">${String(index).padStart(2, "0")}</span>
                      <div>
                        <strong>${escapeHtml(title)}</strong>
                        <p>${escapeHtml(desc)}</p>
                      </div>
                    </div>
                    ${renderProjectDraftField(template, field, { sourceScope: true })}
                  </article>`;
}

function sourceScopeStepKey(key) {
  if (key === "metadata.stage") return "stage";
  if (key === "metadata.subject") return "subject";
  return "grade";
}

function projectSectionForTemplateField(key) {
  if (key === "source.root") return "source";
  if (key === "workspace.root") return "workspace";
  return "metadata";
}

function renderProjectDraftField(template, field, options = {}) {
  const key = draftKeyForTemplateField(field.key);
  const label = localized(field.label);
  const placeholder = projectFieldPlaceholder(template, field);
  const value = draftState[key] ?? defaultProjectDraftValue(key);
  const required = field.required ? ` <em>${escapeHtml(translate("app.required"))}</em>` : "";
  const placeholderAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : "";
  const pickerTarget = fieldPickerTargetForDraftKey(key);

  if (pickerTarget) {
    const inputId = draftFieldInputId(key);
    const titleKey = pickerTarget === "workspace" ? "workspaceTitle" : "sourceTitle";
    const bodyKey = pickerTarget === "workspace" ? "workspaceBody" : "sourceBody";
    const labelMarkup = options.hideLabel ? "" : `<label for="${escapeHtml(inputId)}">${escapeHtml(label)}${required}</label>`;
    const ariaLabel = options.hideLabel ? ` aria-label="${escapeHtml(label)}"` : "";
    return `<div class="draft-field draft-field-with-picker">
                ${labelMarkup}
                <div class="folder-dropzone" data-folder-dropzone="${escapeHtml(pickerTarget)}" data-folder-target="${escapeHtml(key)}" tabindex="0" role="button">
                  <span class="folder-dropzone-icon" aria-hidden="true"></span>
                  <strong>${escapeHtml(translate(`setup.folderBrowser.${titleKey}`) || "")}</strong>
                  <p>${escapeHtml(translate(`setup.folderBrowser.${bodyKey}`) || "")}</p>
                  <div class="folder-dropzone-actions">
                    <button class="primary-action path-picker-action" type="button" data-folder-picker="${escapeHtml(pickerTarget)}" data-folder-target="${escapeHtml(key)}">${escapeHtml(translate("setup.folderBrowser.choose") || folderPickerButtonLabel(pickerTarget))}</button>
                  </div>
                </div>
                <div class="folder-path-entry">
                  <span>${escapeHtml(translate("setup.folderBrowser.pasteLabel") || "")}</span>
                  <div class="draft-field-row">
                    <input id="${escapeHtml(inputId)}" type="text" data-draft-field="${escapeHtml(key)}" data-path-precheck="${escapeHtml(pickerTarget)}"${ariaLabel}${placeholderAttr} value="${escapeHtml(value)}">
                    <button class="secondary-action path-picker-action" type="button" data-folder-use-path="${escapeHtml(pickerTarget)}" data-folder-target="${escapeHtml(key)}">${escapeHtml(translate("setup.folderBrowser.usePath") || (settings.lang === "zh" ? "使用路径" : "Use Path"))}</button>
                  </div>
                </div>
              </div>`;
  }

  if (field.type === "select" && Array.isArray(field.options)) {
    return renderProjectSelectField(key, label, required, value, field.options);
  }

  if (field.type === "multi-select" && Array.isArray(field.options)) {
    return renderProjectMultiSelectField(key, label, required, value, field.options, options);
  }

  return `<label class="draft-field">
                <span>${escapeHtml(label)}${required}</span>
                <input type="text" data-draft-field="${escapeHtml(key)}"${placeholderAttr} value="${escapeHtml(value)}">
              </label>`;
}

function renderProjectMultiSelectField(key, label, required, value, options, renderOptions = {}) {
  const selected = normalizeMultiSelectValue(value);
  const isSourceScope = renderOptions.sourceScope === true;
  const head = isSourceScope
    ? `<span data-draft-label="${escapeHtml(key)}">${escapeHtml(label)}${required}</span>`
    : `<div class="k12-range-head">
              <span>${escapeHtml(label)}${required}</span>
            </div>`;
  return `<div class="draft-field k12-range-field" data-k12-range-field="${escapeHtml(key)}">
            ${head}
            <input type="hidden" data-draft-field="${escapeHtml(key)}" data-draft-multi-value="true" value="${escapeHtml(JSON.stringify(selected))}">
            <div class="k12-range-options">
              ${options.map((option) => {
                const pressed = selected.includes(option.value) ? "true" : "false";
                const stages = Array.isArray(option.stages) ? option.stages.join(" ") : "";
                return `<button class="k12-range-option" type="button" data-k12-option-stages="${escapeHtml(stages)}" data-k12-option="${escapeHtml(option.value)}" aria-pressed="${pressed}">${escapeHtml(localized(option.label))}</button>`;
              }).join("")}
            </div>
            <p class="k12-range-empty" data-k12-range-empty>${escapeHtml(translate("setup.chooseStageFirst") || (settings.lang === "zh" ? "先选择学段后，再选择学科、年级和册别。" : "Choose stages first, then select subjects, grades, and volumes."))}</p>
            <div class="k12-range-actions">
              ${renderK12RangeQuickActions(key)}
              <button class="secondary-action quiet-action" type="button" data-k12-clear="${escapeHtml(key)}">${escapeHtml(translate("setup.clearSelection") || (settings.lang === "zh" ? "清空" : "Clear"))}</button>
            </div>
          </div>`;
}

function renderK12RangeQuickActions(key) {
  if (key === "metadata.stage") {
    return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(translate("setup.sourceScope.allStages") || "全学段")}</button>`;
  }
  if (key === "metadata.subject") {
    return [
      ["all", translate("setup.sourceScope.allSubjects") || "全科目"],
      ["core", translate("setup.sourceScope.coreSubjects") || "语数英"],
      ["science", translate("setup.sourceScope.scienceSubjects") || "理科"],
      ["humanities", translate("setup.sourceScope.humanitiesSubjects") || "文科"],
      ["arts", translate("setup.sourceScope.artsSubjects") || "艺体"]
    ].map(([preset, label]) => `<button class="secondary-action quiet-action" type="button" data-k12-preset="${escapeHtml(preset)}" data-k12-preset-target="${escapeHtml(key)}">${escapeHtml(label)}</button>`).join("");
  }
  if (key === "metadata.grade") {
    return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(translate("setup.sourceScope.allGrades") || "全部年级")}</button>`;
  }
  if (key === "metadata.volume") {
    return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(translate("setup.sourceScope.allVolumes") || "全部册别")}</button>`;
  }
  return `<button class="secondary-action quiet-action" type="button" data-k12-select-all="${escapeHtml(key)}">${escapeHtml(translate("setup.selectAll") || (settings.lang === "zh" ? "全选" : "Select all"))}</button>`;
}

function renderProjectSelectField(key, label, required, value, options) {
  return `<label class="draft-field">
                <span>${escapeHtml(label)}${required}</span>
                <select data-draft-field="${escapeHtml(key)}">
                  <option value="">${escapeHtml(translate("setup.selectPlaceholder") || (settings.lang === "zh" ? "请选择" : "Choose"))}</option>
                  ${options.map((option) => {
                    const selected = option.value === value ? " selected" : "";
                    return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(localized(option.label))}</option>`;
                  }).join("")}
                </select>
              </label>`;
}

function renderFolderPickerResultSlot() {
  return `<div class="folder-picker-result" data-folder-picker-result="project" hidden></div>`;
}

function renderProjectChecklist(template) {
  const target = document.querySelector('[data-draft-checklist="project"]');
  if (!target) return;

  const requiredMetadata = template.requiredFields
    .filter((field) => field.required && !["source.root", "workspace.root"].includes(field.key))
    .map((field) => localized(field.label));
  const requiredLine = requiredMetadata.length
    ? {
        zh: `补齐资料范围：${requiredMetadata.join("、")}。`,
        en: `Fill source scope: ${requiredMetadata.join(", ")}.`
      }
    : {
        zh: "这个模板只需要资料目录和工作目录即可先预览。",
        en: "This template only needs a source folder and work folder to preview."
      };
  const items = [
    { zh: "资料目录只读扫描。", en: "Source folder is scanned read-only." },
    { zh: "工作目录保存中间结果、报告和可回滚版本。", en: "Work folder stores intermediate data, reports, and restorable versions." },
    requiredLine
  ];

  target.innerHTML = items.map((item) => `<li>${escapeHtml(localized(item))}</li>`).join("");
}

function draftKeyForTemplateField(key) {
  if (key === "source.root") return "project.source";
  if (key === "workspace.root") return "project.workspace";
  return key;
}

function projectFieldPlaceholder(template, field) {
  if (field.key === "source.root") {
    const value = pageState.defaultProjectFolders?.source || template.defaultPaths?.source || "";
    return settings.lang === "zh" ? `默认：${value}` : `Default: ${value}`;
  }
  if (field.key === "workspace.root") {
    const value = pageState.defaultProjectFolders?.workspace || template.defaultPaths?.work || "";
    return settings.lang === "zh" ? `默认：${value}` : `Default: ${value}`;
  }
  return field.required
    ? (settings.lang === "zh" ? "必填" : "Required")
    : (settings.lang === "zh" ? "可选" : "Optional");
}

function fieldPickerTargetForDraftKey(key) {
  if (key === "project.source" || key === "source.root") return "source";
  if (key === "project.workspace" || key === "workspace.root") return "workspace";
  return "";
}

function defaultProjectDraftValue(key) {
  if (key === "project.source" || key === "source.root") return pageState.defaultProjectFolders?.source || "";
  if (key === "project.workspace" || key === "workspace.root") return pageState.defaultProjectFolders?.workspace || "";
  return "";
}

function folderPickerButtonLabel(target) {
  return translate(`setup.folderPicker.${target}`) || (settings.lang === "zh" ? "选择目录" : "Choose");
}

function draftFieldInputId(key) {
  return `draft-${String(key).replace(/[^a-z0-9_-]+/gi, "-")}`;
}

function applySidebar() {
  root.dataset.sidebar = settings.sidebar;
  const labelKey = settings.sidebar === "collapsed" ? "app.expandSidebar" : "app.sidebar";
  const label = translate(labelKey);
  const sidebarToggle = document.getElementById("sidebarToggle");
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-label", label);
    sidebarToggle.setAttribute("title", label);
  }
}

function applyLanguage() {
  root.dataset.lang = settings.lang;
  root.lang = settings.lang === "zh" ? "zh-CN" : "en";

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const value = translate(node.dataset.i18n);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    const value = translate(node.dataset.i18nPlaceholder);
    if (value !== undefined) node.setAttribute("placeholder", value);
  });

  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    const value = translate(node.dataset.i18nAriaLabel);
    if (value !== undefined) node.setAttribute("aria-label", value);
  });

  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    const value = translate(node.dataset.i18nTitle);
    if (value !== undefined) node.setAttribute("title", value);
  });

  document.querySelectorAll("[data-copy-code-label-zh]").forEach((node) => {
    const label = settings.lang === "zh" ? node.dataset.copyCodeLabelZh : node.dataset.copyCodeLabelEn;
    const pattern = translate("integrationPanel.copyCodeFor") || (settings.lang === "zh" ? "复制 {label}" : "Copy {label}");
    const value = pattern.replace("{label}", label || "");
    node.textContent = value;
    node.setAttribute("aria-label", value);
  });

  document.querySelectorAll("[data-credential-security-label]").forEach((node) => {
    const value = settings.lang === "zh" ? node.dataset.securityLabelZh : node.dataset.securityLabelEn;
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-lang-option]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.langOption === settings.lang));
  });

  document.querySelectorAll("[data-nav-key]").forEach((link) => {
    const label = translate(`nav.${link.dataset.navKey}`);
    link.setAttribute("title", label);
    link.setAttribute("aria-label", label);
  });

  document.querySelectorAll("[data-setup-step-link]").forEach((link) => {
    const label = translate(`setup.steps.${link.dataset.setupStepLink}.label`);
    if (label) link.setAttribute("aria-label", label);
  });

  document.querySelectorAll("[data-setup-group-link]").forEach((link) => {
    const label = translate(`setup.groups.${link.dataset.setupGroupLink}.label`);
    if (label) link.setAttribute("aria-label", label);
  });

  const title = pageTitle();
  document.title = title ? `KnowMesh · ${title}` : "KnowMesh";
  applySidebar();
  applyMode();
  applyTaskBriefs();
  applyAliyunGuides();
  applyTemplates();
  applyDraftPanels();
  applyAccountMethod();
  applyModelProviderContext();
  applyModelQualityModelCards();
  applyRetrievalStrategyCards();
  applyConfigSummary();
  refreshPermissionScopeStatusLabels();
  rerenderVisibleApiResults();
  rerenderVisibleQueryRuntimeResults();
  refreshBuildWorkflowState();
  if (pageState.pageType === "console" && pageState.active === "execution" && currentJobSnapshot) {
    refreshJobActionBar(currentJobSnapshot, "ready");
  }
}

function applySetupState() {
  const steps = activeSetupSteps();
  const groups = activeSetupGroups();
  const completed = readSetupCompleted();
  const finished = setupIsFinished(completed);
  document.body.dataset.setupFinished = String(finished);

  if (pageState.pageType === "console") {
    if (!finished && !setupStateLoaded) {
      document.body.dataset.setupGated = "pending";
      return false;
    }
    if (!finished) {
      const allowed = firstIncompleteIndex(steps, completed);
      replaceTo(steps[allowed]?.path || "/setup/mode");
      return true;
    }
    document.body.dataset.setupGated = "false";
  }

  if (pageState.pageType !== "setup") return false;

  const currentIndex = steps.findIndex((step) => step.key === pageState.activeSetupStep);
  if (currentIndex === -1) {
    const allowed = firstIncompleteIndex(steps, completed);
    replaceTo(steps[allowed]?.path || "/setup/mode");
    return true;
  }

  const allowedIndex = firstIncompleteIndex(steps, completed);
  const currentGroup = setupGroupForStep(pageState.activeSetupStep);
  const currentGroupIndex = groups.findIndex((group) => group.key === currentGroup?.key);
  if (currentIndex > allowedIndex) {
    replaceTo(steps[allowedIndex]?.path || "/setup/mode");
    return true;
  }

  document.querySelectorAll("[data-setup-step-link]").forEach((link) => {
    const key = link.dataset.setupStepLink;
    const index = steps.findIndex((step) => step.key === key);
    const applicable = index > -1;
    link.hidden = !applicable;
    if (!applicable) return;
    const locked = index > allowedIndex;
    const done = completed.has(key);
    link.classList.toggle("completed", done);
    link.classList.toggle("locked", locked);
    link.classList.toggle("active", key === pageState.activeSetupStep);
    link.setAttribute("aria-disabled", String(locked));
    link.setAttribute("title", locked ? translate("setup.locked") : "");
    const group = setupGroupForStep(key);
    const groupIndex = groups.findIndex((item) => item.key === group?.key);
    const localIndex = localStepIndex(key);
    const indexNode = link.querySelector(".step-index");
    if (indexNode) indexNode.textContent = String(localIndex + 1);
    const railIndexNode = link.querySelector(".setup-step-number");
    if (railIndexNode) railIndexNode.textContent = groupIndex > -1 ? `${groupIndex + 1}.${localIndex + 1}` : String(localIndex + 1);
  });

  document.querySelectorAll("[data-setup-group-link]").forEach((link) => {
    const group = setupGroup(link.dataset.setupGroupLink);
    const groupSteps = activeStepsForGroup(group);
    const applicable = groupSteps.length > 0;
    const wrapper = link.closest("[data-setup-group-wrapper]");
    if (wrapper) wrapper.hidden = !applicable;
    link.hidden = !applicable;
    if (!applicable) return;

    const firstIndex = steps.findIndex((step) => step.key === groupSteps[0].key);
    const locked = firstIndex > allowedIndex;
    const done = groupSteps.every((step) => completed.has(step.key));
    const active = groupSteps.some((step) => step.key === pageState.activeSetupStep);
    const target = groupSteps.find((step) => !completed.has(step.key)) || groupSteps[0];
    const groupIndex = groups.findIndex((item) => item.key === group.key);

    link.classList.toggle("completed", done);
    link.classList.toggle("locked", locked);
    link.classList.toggle("active", active);
    if (wrapper) {
      wrapper.classList.toggle("completed", done);
      wrapper.classList.toggle("locked", locked);
      wrapper.classList.toggle("active", active);
    }
    link.setAttribute("aria-disabled", String(locked));
    link.setAttribute("title", locked ? translate("setup.locked") : "");
    link.setAttribute("href", locked ? groupSteps[0].path : target.path);

    const indexNode = link.querySelector(".setup-group-index");
    if (indexNode) indexNode.textContent = String(groupIndex + 1);

    const currentNode = link.querySelector("[data-setup-group-current]");
    if (currentNode) {
      const currentStep = active ? pageState.activeSetupStep : target.key;
      const label = translate(`setup.steps.${currentStep}.label`);
      if (label) currentNode.textContent = label;
    }
  });

  setText("[data-setup-progress-current]", String(currentGroupIndex + 1));
  setText("[data-setup-progress-total]", String(groups.length));

  document.querySelectorAll("[data-setup-back]").forEach((link) => {
    const previous = steps[currentIndex - 1];
    if (previous) {
      link.hidden = false;
      link.setAttribute("href", previous.path);
    } else {
      link.hidden = true;
      link.removeAttribute("href");
    }
  });
  applyConfigSummary();
  refreshSetupContinueState();
  return false;
}

function markSetupComplete(key) {
  const completed = readSetupCompleted();
  completed.add(key);
  writeSetupCompleted(completed);
  applyConfigSummary();
  refreshSetupContinueState();
}

function keepSetupCompletedThrough(key) {
  const steps = activeSetupSteps();
  const keepIndex = steps.findIndex((step) => step.key === key);
  const completed = readSetupCompleted();
  const kept = new Set();
  for (let index = 0; index <= keepIndex; index += 1) {
    if (completed.has(steps[index].key)) kept.add(steps[index].key);
  }
  writeSetupCompleted(kept);
  persistSetupProgressToDraft();
  applyConfigSummary();
  refreshSetupContinueState();
}

function activeSetupSteps(mode = settings.mode) {
  return (pageState.setupSteps || []).filter((step) => step.scope === "all" || step.scope === mode);
}

function activeSetupGroups(mode = settings.mode) {
  return (pageState.setupGroups || []).filter((group) => group.scope === "all" || group.scope === mode);
}

function setupGroup(groupKey) {
  return (pageState.setupGroups || []).find((group) => group.key === groupKey);
}

function setupGroupForStep(stepKey) {
  const step = (pageState.setupSteps || []).find((item) => item.key === stepKey);
  return step ? setupGroup(step.group) : null;
}

function activeStepsForGroup(group) {
  if (!group) return [];
  const steps = activeSetupSteps();
  return (group.stepKeys || [])
    .map((key) => steps.find((step) => step.key === key))
    .filter(Boolean);
}

function localStepIndex(stepKey) {
  const group = setupGroupForStep(stepKey);
  const steps = activeStepsForGroup(group);
  const index = steps.findIndex((step) => step.key === stepKey);
  return index > -1 ? index : 0;
}

function nextSetupPath(key) {
  const steps = activeSetupSteps();
  const index = steps.findIndex((step) => step.key === key);
  return index > -1 ? steps[index + 1]?.path : "";
}

function firstIncompleteIndex(steps, completed) {
  for (let index = 0; index < steps.length; index += 1) {
    if (!completed.has(steps[index].key)) return index;
  }
  return Math.max(steps.length - 1, 0);
}

function setupIsFinished(completed = setupProgress, mode = settings.mode) {
  if (draftState["setup.finished"] === true) return true;
  const steps = activeSetupSteps(mode);
  if (!steps.length) return false;
  if (steps.every((step) => completed.has(step.key))) return true;
  return setupConfigurationReady(completed, mode);
}

function setupConfigurationReady(completed = setupProgress, mode = settings.mode) {
  const steps = activeSetupSteps(mode);
  const lastConfigIndex = steps.findIndex((step) => step.key === "environment");
  if (lastConfigIndex < 0) return false;
  return steps.slice(0, lastConfigIndex + 1).every((step) => completed.has(step.key));
}

function inferCompletedSetupStepsFromDraft(draft = draftState, mode = settings.mode) {
  const completed = new Set(["mode"]);
  const normalizedMode = mode === "local" ? "local" : "aliyun";

  if (normalizedMode === "aliyun") {
    if (draft["aliyun.account.method"] || draft["aliyun.credential.accessKeyId"] || draft["aliyun.credential.accessKeySecret.configured"]) completed.add("aliyun-account");
    if (draft["aliyun.credential.accessKeyId"] && draft["aliyun.credential.accessKeySecret.configured"]) completed.add("aliyun-credential");
    if (completed.has("aliyun-credential") || draft["aliyun.storage.confirmed"]) completed.add("aliyun-permissions");
    if (draft["aliyun.storage.confirmed"] || (draft["aliyun.storage.bucket"] && draft["aliyun.search.bucket"])) completed.add("aliyun-storage");
    if (draft["aliyun.model.apiKey.configured"] || draft["aliyun.model.baseUrl"]) completed.add("aliyun-services");
    if (draft["aliyun.services.modelQuality.configured"]) completed.add("aliyun-model-quality");
    if (draft["aliyun.search.configured"] || (draft["aliyun.search.bucket"] && draft["aliyun.search.index"])) completed.add("aliyun-search");
  }

  const template = draft["template.id"] || draft.template || settings.template;
  if (initialTemplateIds.includes(template)) completed.add("template");
  if (draft["retrieval.strategy.configured"]) completed.add("retrieval");
  if (draft["project.source"] && draft["project.workspace"] && sourceScopeLooksComplete(draft)) completed.add("project");
  if (completed.has("project") && completed.has("retrieval") && (normalizedMode !== "aliyun" || completed.has("aliyun-search"))) completed.add("environment");

  if (draft["setup.mode"] === mode && draft["setup.finished"] === true && setupConfigurationReady(completed, mode)) {
    activeSetupSteps(mode).forEach((step) => completed.add(step.key));
  }

  return completed;
}

function readSetupCompleted() {
  return new Set(setupProgress);
}

function writeSetupCompleted(completed, options = {}) {
  setupProgress.clear();
  completed.forEach((key) => {
    if (key) setupProgress.add(key);
  });
  if (options.sync === false) return;
  persistSetupProgressToDraft();
}

function persistSetupProgressToDraft() {
  draftState["setup.completedSteps"] = [...setupProgress];
  draftState["setup.finished"] = setupIsFinished(setupProgress);
  writeDraft(draftState);
  syncDraftToServer();
}

function pageTitle() {
  if (pageState.pageType === "setup" && pageState.activeSetupStep) {
    return translate(`setup.steps.${pageState.activeSetupStep}.label`);
  }
  if (pageState.pageType === "console" && pageState.active) {
    return translate(`nav.${pageState.active}`);
  }
  return "";
}

function translate(path) {
  const source = pageState.copy?.[settings.lang] || pageState.copy?.zh || {};
  return path.split(".").reduce((current, key) => current?.[key], source);
}

function templateById(templateId) {
  return (pageState.templates || []).find((template) => template.id === templateId);
}

function currentTemplate() {
  return templateById(settings.template) || (pageState.templates || [])[0];
}

function localized(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) return value[settings.lang] || value.zh || value.en;
  return value;
}

function applyConfigSummary() {
  if (!document.querySelector("[data-setup-config-summary]")) return;
  const draft = collectDraftFields({ includeSensitive: false });
  const template = currentTemplate();
  const completed = readSetupCompleted();
  const empty = translate("setup.summary.empty") || (settings.lang === "zh" ? "未选择" : "Not selected");
  const stepConfirmed = completed.has(pageState.activeSetupStep);

  setSummaryValue("[data-summary-mode]", translate(`modes.${settings.mode}.short`) || translate(`modes.${settings.mode}.label`) || settings.mode, empty);
  setSummaryValue("[data-summary-template]", localized(template?.title), empty);
  setSummaryValue("[data-summary-source]", draft["project.source"] || draft["source.root"], empty);
  setSummaryValue("[data-summary-workspace]", draft["project.workspace"] || draft["workspace.root"], empty);
  setSummaryValue("[data-summary-step]", stepConfirmed ? translate("setup.summary.confirmed") : translate("setup.summary.pending"), empty);
}

function setSummaryValue(selector, value, empty) {
  document.querySelectorAll(selector).forEach((node) => {
    const text = String(value || "").trim() || empty;
    node.textContent = text;
    node.setAttribute("title", text);
    node.dataset.empty = String(text === empty);
  });
}

function bindDraftFields(scope = document) {
  scope.querySelectorAll("[data-draft-field]").forEach((field) => {
    if (field.dataset.draftBound === "true") return;
    field.dataset.draftBound = "true";

    const key = field.dataset.draftField;
    const sensitive = field.dataset.draftSensitive === "true";

    if (!sensitive && draftState[key] !== undefined && field.dataset.draftMultiValue === "true") {
      field.value = JSON.stringify(normalizeMultiSelectValue(draftState[key]));
    } else if (!sensitive && draftState[key] !== undefined) {
      field.value = draftState[key];
    }
    if (sensitive && draftState[`${key}.configured`]) {
      field.setAttribute("placeholder", settings.lang === "zh" ? "已填写，返回时不显示明文" : "Configured; secret is not shown again");
    }

    field.addEventListener("input", () => {
      if (field.dataset.credentialMasked === "true") delete field.dataset.credentialMasked;
      saveDraftField(field);
      if (field.dataset.pathPrecheck) {
        schedulePathPrecheck(field.dataset.pathPrecheck, field.value);
      }
    });
    field.addEventListener("change", () => {
      saveDraftField(field);
      if (field.dataset.pathPrecheck) {
        runPathPrecheck(field.dataset.pathPrecheck, field.value);
      }
    });
  });
}

function saveDraftField(field) {
  const key = field.dataset.draftField;
  if (!key) return;

  if (field.dataset.draftSensitive === "true") {
    if (field.value) draftState[`${key}.pending`] = true;
    else delete draftState[`${key}.pending`];
  } else {
    draftState[key] = draftFieldValue(field);
  }

  writeDraft(draftState);
  clearPersistentSetupActionResults();
  resetSetupProgressAfterDraftChange();
  resetCurrentSetupActionResult();
  refreshSetupContinueState();
  applyConfigSummary();
  applyModelProviderContext();
  applyModelQualityModelCards();
  applyRetrievalStrategyCards();
  if (field.dataset.draftSensitive !== "true") {
    syncDraftToServer();
  } else {
    updateDraftSaveState("local");
  }
}

function bindCredentialSaveOptions(scope = document) {
  const checkbox = scope.querySelector("[data-credential-env-copy]");
  const target = scope.querySelector('[data-draft-field="aliyun.credential.saveTarget"]') || document.querySelector('[data-draft-field="aliyun.credential.saveTarget"]');
  if (!checkbox || !target || checkbox.dataset.credentialEnvBound === "true") return;

  checkbox.dataset.credentialEnvBound = "true";
  syncCredentialSaveOptions();
  checkbox.addEventListener("change", () => {
    target.value = checkbox.checked ? "env-file" : "secure-local";
    saveDraftField(target);
  });
}

function syncCredentialSaveOptions() {
  const checkbox = document.querySelector("[data-credential-env-copy]");
  const target = document.querySelector('[data-draft-field="aliyun.credential.saveTarget"]');
  if (!checkbox || !target) return;

  const value = draftState["aliyun.credential.saveTarget"] || target.value || "secure-local";
  target.value = value === "env-file" ? "env-file" : "secure-local";
  checkbox.checked = target.value === "env-file";
}

function resetSetupProgressAfterDraftChange() {
  if (pageState.pageType !== "setup" || !pageState.activeSetupStep) return;
  const steps = activeSetupSteps();
  const currentIndex = steps.findIndex((step) => step.key === pageState.activeSetupStep);
  if (currentIndex < 0) return;
  const completed = readSetupCompleted();
  if (!completed.has(pageState.activeSetupStep)) return;

  const kept = new Set();
  for (let index = 0; index < currentIndex; index += 1) {
    if (completed.has(steps[index].key)) kept.add(steps[index].key);
  }
  writeSetupCompleted(kept);
  persistSetupProgressToDraft();
  applySetupState();
}

function persistVisibleDraftFields() {
  let changed = false;
  document.querySelectorAll("[data-draft-field]").forEach((field) => {
    const key = field.dataset.draftField;
    if (!key) return;
    if (field.dataset.draftSensitive === "true") {
      if (field.value) draftState[`${key}.pending`] = true;
      else delete draftState[`${key}.pending`];
      changed = true;
      return;
    }
    draftState[key] = draftFieldValue(field);
    changed = true;
  });

  if (!changed) return;
  writeDraft(draftState);
  clearPersistentSetupActionResults();
  syncDraftToServer();
}

function bindApiActions() {
  if (apiActionsBound) return;
  apiActionsBound = true;
  document.addEventListener("click", async (event) => {
    const resultOpenButton = event.target.closest("[data-api-result-open]");
    if (resultOpenButton) {
      event.preventDefault();
      const resultNode = resultOpenButton.closest("[data-api-result]");
      showApiResultDialog(resultNode, { fromUser: true });
      return;
    }

    const buildOpenButton = event.target.closest("[data-build-open-result]");
    if (buildOpenButton) {
      event.preventDefault();
      const resultNode = resultNodeForAction(buildOpenButton.dataset.buildOpenResult || "");
      showApiResultDialog(resultNode, { fromUser: true });
      return;
    }

    const jobStepButton = event.target.closest("[data-job-step-button]");
    if (jobStepButton) {
      event.preventDefault();
      selectJobStep(jobStepButton.dataset.jobStepButton || "");
      return;
    }

    const jobLogJumpButton = event.target.closest("[data-job-log-jump]");
    if (jobLogJumpButton) {
      event.preventDefault();
      scrollJobLogToLatest(jobLogJumpButton.closest("[data-api-result]") || document);
      return;
    }

    const jobLogFilterButton = event.target.closest("[data-job-log-filter]");
    if (jobLogFilterButton) {
      event.preventDefault();
      const mode = jobLogFilterButton.dataset.jobLogFilter || "all";
      if (!["all", "current"].includes(mode) || mode === jobLogFilterMode) return;
      jobLogFilterMode = mode;
      writeChoice(storageKeys.jobLogFilter, mode);
      rerenderVisibleApiResults();
      return;
    }

    const remediationCopyButton = event.target.closest("[data-copy-remediation-policy]");
    if (remediationCopyButton) {
      event.preventDefault();
      await copyRemediationPolicy(remediationCopyButton);
      return;
    }

    const genericCopyButton = event.target.closest("[data-copy-text], [data-copy-text-zh], [data-copy-text-en], [data-copy-target], [data-copy-target-zh], [data-copy-target-en]");
    if (genericCopyButton) {
      event.preventDefault();
      const copyText = copyTextFromButton(genericCopyButton);
      const copied = await copyTextBestEffort(copyText);
      showToast(copied ? translate("setup.pathCopied") || "Copied" : translate("setup.pathCopyFailed") || "Copy failed", copied ? "pass" : "fail");
      return;
    }

    const footerTestButton = event.target.closest("[data-setup-footer-test]");
    if (footerTestButton) {
      event.preventDefault();
      const actionButton = document.querySelector(`[data-setup-api-action="${cssEscape(footerTestButton.dataset.setupFooterTest)}"]`);
      if (!actionButton) return;
      persistVisibleDraftFields();
      footerTestButton.disabled = true;
      await runApiAction(actionButton);
      footerTestButton.disabled = false;
      return;
    }

    const rerunButton = event.target.closest("[data-rerun-setup-action]");
    if (rerunButton) {
      event.preventDefault();
      const actionButton = document.querySelector(`[data-setup-api-action="${cssEscape(rerunButton.dataset.rerunSetupAction)}"]`);
      if (actionButton) await runApiAction(actionButton);
      return;
    }

    const button = event.target.closest("[data-setup-api-action], [data-console-api-action]");
    if (!button) return;
    event.preventDefault();
    await runApiAction(button);
  });
}

function copyTextFromButton(button) {
  const langSuffix = settings.lang === "en" ? "En" : "Zh";
  const direct = button.dataset[`copyText${langSuffix}`] || button.dataset.copyText || "";
  if (direct) return direct;
  const targetId = button.dataset[`copyTarget${langSuffix}`] || button.dataset.copyTarget || "";
  if (!targetId) return "";
  return document.getElementById(targetId)?.textContent || "";
}

function bindFolderPickers() {
  if (folderPickersBound) return;
  folderPickersBound = true;
  document.addEventListener("click", async (event) => {
    const resultOpenButton = event.target.closest("[data-folder-result-open]");
    if (resultOpenButton) {
      event.preventDefault();
      showStoredFolderPrecheckDialog(resultOpenButton);
      return;
    }

    const usePathButton = event.target.closest("[data-folder-use-path]");
    if (usePathButton) {
      event.preventDefault();
      await useTypedFolderPath(usePathButton);
      return;
    }
    const button = event.target.closest("[data-folder-picker]");
    if (!button) return;
    event.preventDefault();
    await runSystemFolderPicker(button);
  });
  document.addEventListener("click", async (event) => {
    const dropzone = event.target.closest("[data-folder-dropzone]");
    if (!dropzone || event.target.closest("button, input")) return;
    event.preventDefault();
    const button = dropzone.querySelector("[data-folder-picker]");
    if (button) await runSystemFolderPicker(button);
  });
  document.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const dropzone = event.target.closest("[data-folder-dropzone]");
    if (!dropzone) return;
    event.preventDefault();
    const button = dropzone.querySelector("[data-folder-picker]");
    if (button) await runSystemFolderPicker(button);
  });
  document.addEventListener("dragover", (event) => {
    const dropzone = event.target.closest("[data-folder-dropzone]");
    if (!dropzone) return;
    event.preventDefault();
    dropzone.dataset.dragging = "true";
  });
  document.addEventListener("dragleave", (event) => {
    const dropzone = event.target.closest("[data-folder-dropzone]");
    if (!dropzone || dropzone.contains(event.relatedTarget)) return;
    delete dropzone.dataset.dragging;
  });
  document.addEventListener("drop", async (event) => {
    const dropzone = event.target.closest("[data-folder-dropzone]");
    if (!dropzone) return;
    event.preventDefault();
    delete dropzone.dataset.dragging;
    await handleFolderDrop(dropzone, event);
  });
}

function bindK12RangeControls() {
  if (k12RangeControlsBound) return;
  k12RangeControlsBound = true;

  document.addEventListener("click", (event) => {
    const option = event.target.closest("[data-k12-option]");
    if (option) {
      event.preventDefault();
      if (option.hidden || option.disabled) return;
      const field = option.closest("[data-k12-range-field]");
      if (!field) return;
      const key = field.dataset.k12RangeField;
      const current = selectedK12RangeValues(key);
      const value = option.dataset.k12Option;
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      setK12RangeValues(key, next);
      return;
    }

    const preset = event.target.closest("[data-k12-preset]");
    if (preset) {
      event.preventDefault();
      const field = document.querySelector(`[data-k12-range-field="${cssEscape(preset.dataset.k12PresetTarget)}"]`);
      if (!field) return;
      setK12RangeValues(field.dataset.k12RangeField, k12PresetValues(field, preset.dataset.k12Preset));
      return;
    }

    const selectAll = event.target.closest("[data-k12-select-all]");
    if (selectAll) {
      event.preventDefault();
      const field = document.querySelector(`[data-k12-range-field="${cssEscape(selectAll.dataset.k12SelectAll)}"]`);
      if (!field) return;
      const values = Array.from(field.querySelectorAll("[data-k12-option]"))
        .filter((item) => !item.hidden && !item.disabled)
        .map((item) => item.dataset.k12Option);
      setK12RangeValues(field.dataset.k12RangeField, values);
      return;
    }

    const clear = event.target.closest("[data-k12-clear]");
    if (!clear) return;
    event.preventDefault();
    setK12RangeValues(clear.dataset.k12Clear, []);
  });
}

function initializeConsolePage() {
  if (pageState.pageType !== "console") return;
  autoLoadApiResults();
  if (pageState.active === "execution") {
    initializeJobConsole();
  }
}

function autoLoadApiResults() {
  document.querySelectorAll("[data-api-autoload]").forEach((resultNode) => {
    if (resultNode.dataset.apiAutoloadStarted === "true") return;
    resultNode.dataset.apiAutoloadStarted = "true";
    window.setTimeout(() => loadAutoApiResult(resultNode), 0);
  });
}

async function refreshInlineApiResult(key) {
  const resultNode = document.querySelector(`[data-api-result="${cssEscape(key)}"]`);
  if (!resultNode) return;
  await loadAutoApiResult(resultNode);
}

async function loadAutoApiResult(resultNode) {
  const actionKey = resultNode.dataset.apiAutoload || resultNode.dataset.apiResult || "";
  const actionButton = document.querySelector(`[data-setup-api-action="${cssEscape(actionKey)}"], [data-console-api-action="${cssEscape(actionKey)}"]`);
  const endpoint = resultNode.dataset.apiAutoloadEndpoint || actionButton?.dataset.apiEndpoint || "";
  const method = resultNode.dataset.apiAutoloadMethod || actionButton?.dataset.apiMethod || "GET";
  const loading = settings.lang === "zh"
    ? (resultNode.dataset.apiAutoloadLoadingZh || actionButton?.dataset.apiLoadingZh || "")
    : (resultNode.dataset.apiAutoloadLoadingEn || actionButton?.dataset.apiLoadingEn || "");
  if (!endpoint) return;

  showApiResult(resultNode, "working", loading || (settings.lang === "zh" ? "正在读取状态..." : "Loading status..."), actionKey, { showDialog: false, showToast: false });

  try {
    const response = await fetch(endpoint, { method, headers: { accept: "application/json" } });
    const data = await response.json();
    if (!response.ok && !hasRenderableApiData(data)) throw new Error(data.error || "Request failed.");
    showApiChecks(resultNode, data, actionKey, { showDialog: false, showToast: false, persist: false });
    syncMaintenanceStatusPolling(resultNode, data, actionKey);
  } catch {
    showApiResult(
      resultNode,
      "fail",
      settings.lang === "zh" ? "没有读取到维护状态，请稍后重新检查。" : "Maintenance status could not be loaded. Check again later.",
      actionKey,
      { showDialog: false, showToast: false }
    );
  }
}

function syncMaintenanceStatusPolling(resultNode, data, actionKey = "") {
  if (!isMaintenanceStatusResult(resultNode, data, actionKey)) return;
  if (isMaintenanceMetadataContractRunning(data)) {
    startMaintenanceStatusPolling();
  } else {
    stopMaintenanceStatusPolling();
  }
}

function isMaintenanceStatusResult(resultNode, data, actionKey = "") {
  return actionKey === "maintenance-status"
    || resultNode?.dataset.apiResult === "maintenance-status"
    || Boolean(data?.maintenance);
}

function isMaintenanceMetadataContractRunning(data) {
  if (data?.maintenance?.metadataContractProgress?.status === "running") return true;
  return (data?.maintenance?.diagnostics || []).some((item) => item?.key === "metadataContract" && item?.status === "working");
}

function startMaintenanceStatusPolling() {
  if (maintenanceStatusPollTimer) return;
  maintenanceStatusPollTimer = window.setInterval(fetchMaintenanceStatusUpdate, 2000);
}

function stopMaintenanceStatusPolling() {
  if (!maintenanceStatusPollTimer) return;
  window.clearInterval(maintenanceStatusPollTimer);
  maintenanceStatusPollTimer = 0;
}

async function fetchMaintenanceStatusUpdate() {
  if (maintenanceStatusPollInFlight) return;
  const resultNode = document.querySelector('[data-api-result="maintenance-status"]');
  const endpoint = resultNode?.dataset.apiAutoloadEndpoint || "/api/maintenance/status";
  if (!resultNode || !endpoint) {
    stopMaintenanceStatusPolling();
    return;
  }
  maintenanceStatusPollInFlight = true;
  try {
    const response = await fetch(endpoint, { method: "GET", headers: { accept: "application/json" } });
    const data = await response.json();
    if (!response.ok && !hasRenderableApiData(data)) throw new Error(data.error || "Request failed.");
    showApiChecks(resultNode, data, "maintenance-status", { showDialog: false, showToast: false, persist: false });
    if (!isMaintenanceMetadataContractRunning(data)) stopMaintenanceStatusPolling();
  } catch {
    stopMaintenanceStatusPolling();
  } finally {
    maintenanceStatusPollInFlight = false;
  }
}

function initializeJobConsole() {
  refreshJobActionBar(null, "loading");
  if (latestJobAutoLoadStarted) return;
  const refreshButton = document.querySelector('[data-job-action-control="refresh"]');
  if (!refreshButton) return;
  latestJobAutoLoadStarted = true;
  window.setTimeout(() => runApiAction(refreshButton), 0);
}

function isJobConsoleAction(actionKey = "") {
  return [
    "latest-job",
    "advance-latest-job",
    "run-latest-job",
    "pause-latest-job",
    "resume-latest-job",
    "stop-latest-job",
    "test-job-task"
  ].includes(actionKey);
}

function refreshJobActionBar(job, state = "ready", message = "", actionKey = "") {
  const shell = document.querySelector("[data-job-execution-shell]");
  if (!shell) return;

  if (job) currentJobSnapshot = job;
  if (!job && state === "empty") currentJobSnapshot = null;
  const effectiveJob = job || (state === "working" || state === "failed" ? currentJobSnapshot : null);
  const emptyState = shell.querySelector("[data-job-empty-state]");
  const actionBar = shell.querySelector("[data-job-action-bar]");
  if (emptyState) emptyState.hidden = Boolean(effectiveJob);
  if (actionBar) {
    actionBar.hidden = !effectiveJob;
    actionBar.setAttribute("aria-busy", String(state === "working"));
    actionBar.dataset.jobActionState = state || "ready";
    if (actionKey) actionBar.dataset.jobActionKey = actionKey;
  }

  shell.dataset.jobState = effectiveJob?.status || state || "empty";
  shell.dataset.jobActionState = state || "ready";
  if (actionKey) shell.dataset.jobActionKey = actionKey;
  updateJobActionStatus(effectiveJob, state, message);
  refreshJobActionAvailability(effectiveJob, state, actionKey);
  if (pageState.active === "execution" && ["running", "pausing"].includes(effectiveJob?.status)) {
    startJobActionPolling();
  } else if (state !== "working") {
    stopJobActionPolling();
  }
}

function updateJobActionStatus(job, state = "ready", message = "") {
  const titleNode = document.querySelector("[data-job-action-status-title]");
  const bodyNode = document.querySelector("[data-job-action-status-body]");
  if (!titleNode || !bodyNode) return;
  const text = jobActionStatusText(job, state, message);
  titleNode.textContent = text.title;
  bodyNode.textContent = text.body;
}

function jobCanValidateKnowledge(job) {
  if (!job || job.status !== "completed") return false;
  const tasks = Array.isArray(job.tasks) ? job.tasks : [];
  if (!tasks.length || tasks.some((item) => item.status === "skipped")) return false;
  return tasks.some((item) => item.key === "index" && item.status === "completed");
}

function refreshJobActionAvailability(job, state = "ready", actionKey = "") {
  const status = job?.status || state || "empty";
  const hasJob = Boolean(job);
  const canTest = hasJob && (status === "waiting" || status === "failed");
  const visible = new Set();

  if (!hasJob && state !== "loading" && state !== "working") {
    visible.add("create");
  } else if (hasJob && status === "waiting") {
    visible.add("test");
    visible.add("advance");
    visible.add("run");
  } else if (hasJob && status === "running") {
    visible.add("pause");
    visible.add("stop");
  } else if (hasJob && status === "pausing") {
    visible.add("stop");
  } else if (hasJob && status === "paused") {
    visible.add("resume");
    visible.add("stop");
  } else if (hasJob && status === "failed") {
    visible.add("test");
    visible.add("advance");
  } else if (hasJob && status === "blocked") {
    visible.add("refresh");
  } else if (hasJob && status === "completed" && jobCanValidateKnowledge(job)) {
    visible.add("ask");
  }

  syncCompletedJobActionPriority(job, status);
  syncJobActionLabels(status);

  document.querySelectorAll("[data-job-action-control]").forEach((control) => {
    const key = control.dataset.jobActionControl;
    const shouldShow = key === "test" ? canTest && visible.has(key) : visible.has(key);
    control.hidden = !shouldShow;
    if ("disabled" in control) {
      const canClickWhileWorking = state === "working" && ["pause", "stop"].includes(key);
      control.disabled = state === "working" && !canClickWhileWorking;
      control.setAttribute("aria-disabled", String(control.disabled));
      control.classList.toggle("is-busy-source", state === "working" && actionKey && control.dataset.consoleApiAction === actionKey);
    }
  });
}

function syncJobActionLabels(status = "") {
  const advanceControl = document.querySelector('[data-job-action-control="advance"]');
  if (!advanceControl) return;
  const key = status === "failed" ? "retry" : "advance";
  advanceControl.textContent = translate(`jobs.latest.${key}`) || (settings.lang === "zh" ? (key === "retry" ? "重试当前步骤" : "推进下一步") : (key === "retry" ? "Retry Current Step" : "Advance Next Step"));
  advanceControl.classList.toggle("job-action-main", status !== "failed");
}
function syncCompletedJobActionPriority(job, status = "") {
  const askControl = document.querySelector("[data-job-action-control=\"ask\"]");
  const canValidate = status === "completed" && jobCanValidateKnowledge(job);
  if (askControl) {
    askControl.classList.toggle("primary-action", canValidate);
    askControl.classList.toggle("secondary-action", !canValidate);
    askControl.classList.toggle("job-action-main", canValidate);
  }
}

function startJobActionPolling() {
  if (jobActionPollTimer || pageState.active !== "execution") return;
  jobActionPollTimer = window.setInterval(pollLatestJobInline, 1200);
  window.setTimeout(pollLatestJobInline, 0);
}

function stopJobActionPolling() {
  if (!jobActionPollTimer) return;
  window.clearInterval(jobActionPollTimer);
  jobActionPollTimer = 0;
}

async function pollLatestJobInline() {
  if (jobActionPollInFlight || pageState.active !== "execution") return;
  jobActionPollInFlight = true;
  try {
    const response = await fetch("/api/jobs/latest", {
      headers: { accept: "application/json" }
    });
    const data = await response.json();
    const resultNode = document.querySelector('[data-api-result="latest-job"]');
    showApiChecks(resultNode, data, "latest-job", { showToast: false, showDialog: false });
    refreshJobActionBar(data?.job || null, data?.job ? "ready" : "empty");
    if (!data?.job || !["running", "pausing"].includes(data.job.status)) stopJobActionPolling();
  } catch {
    // Keep polling quiet; the fixed action bar still shows the last known state.
  } finally {
    jobActionPollInFlight = false;
  }
}

function selectJobStep(stepKey = "") {
  if (!stepKey) return;
  activeJobStepKey = stepKey;
  const shell = document.querySelector("[data-job-execution-shell]");
  if (!shell) return;
  shell.dataset.selectedJobStep = stepKey;
  shell.querySelectorAll("[data-job-step-button]").forEach((button) => {
    const selected = button.dataset.jobStepButton === stepKey;
    button.dataset.selected = String(selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  shell.querySelectorAll("[data-job-log-step]").forEach((row) => {
    row.dataset.selected = String(row.dataset.jobLogStep === stepKey);
  });
}

function jobActionStatusText(job, state = "ready", message = "") {
  const zh = settings.lang === "zh";
  if (state === "loading") {
    return {
      title: zh ? "正在读取任务" : "Loading job",
      body: zh ? "读取完成后，只显示当前可执行的操作。" : "After loading, only current available actions stay visible."
    };
  }
  if (state === "working") {
    return {
      title: zh ? "正在处理" : "Working",
      body: message || (zh ? "任务状态更新后会自动刷新回显。" : "The job display refreshes when the action returns.")
    };
  }
  if (!job) {
    return {
      title: zh ? "还没有任务" : "No job yet",
      body: zh ? "先创建任务，任务页才会显示进度、回显和控制按钮。" : "Create a job first to see progress, logs, and controls."
    };
  }

  const status = job.status || "unknown";
  const confirmationOnly = jobHasOnlyConfirmationBlocks(job);
  const current = currentJobTask(Array.isArray(job.tasks) ? job.tasks : [], status);
  const currentLabel = localized(current?.label) || (zh ? "没有待处理步骤" : "No waiting step");
  const statusLabels = zh
    ? {
        waiting: "等待执行",
        running: "可以继续执行",
        pausing: "正在暂停",
        paused: "任务已暂停",
        failed: "任务需要处理",
        blocked: confirmationOnly ? "等待执行前确认" : "任务需要处理",
        stopped: "任务已终止",
        completed: "任务已完成",
        unknown: "任务状态"
      }
    : {
        waiting: "Waiting to run",
        running: "Ready to continue",
        pausing: "Pausing",
        paused: "Paused",
        failed: "Needs attention",
        blocked: confirmationOnly ? "Waiting for confirmation" : "Needs attention",
        stopped: "Stopped",
        completed: "Complete",
        unknown: "Job status"
      };
  const bodies = zh
    ? {
        waiting: `当前步骤：${currentLabel}。可以先测试，也可以直接执行剩余步骤。`,
        running: `当前步骤：${currentLabel}。可以继续推进或执行剩余步骤。`,
        pausing: `当前步骤：${currentLabel}。正在等待当前步骤结束后暂停。`,
        paused: "任务不会继续推进，确认后可以恢复或终止。",
        failed: "先查看回显和失败原因，再测试或重试当前步骤。",
        blocked: confirmationOnly ? "任务需要确认后才能继续。" : "先处理页面中的问题，再刷新任务状态。",
        stopped: "任务已经停止，后续步骤不会继续。",
        completed: "任务已完成。可以查看回显和产物。",
        unknown: "查看当前任务状态和可执行操作。"
      }
    : {
        waiting: `Current step: ${currentLabel}. Test first or run the remaining steps.`,
        running: `Current step: ${currentLabel}. Advance one step or run the remaining steps.`,
        pausing: `Current step: ${currentLabel}. KnowMesh will pause after this step finishes.`,
        paused: "The job will not continue until resumed or stopped.",
        failed: "Review the log and failure reason, then test or retry the current step.",
        blocked: confirmationOnly ? "Confirm this job before continuing." : "Fix the issues shown on the page, then refresh the job.",
        stopped: "The job is stopped and will not continue.",
        completed: "The job is complete. You can review logs and artifacts.",
        unknown: "Review the current job state and available actions."
      };
  return {
    title: statusLabels[status] || statusLabels.unknown,
    body: bodies[status] || bodies.unknown
  };
}

function setK12RangeValues(key, values, options = {}) {
  const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"][data-draft-multi-value="true"]`);
  const unique = [...new Set((values || []).map(String).filter(Boolean))];
  if (field) field.value = JSON.stringify(unique);
  draftState[key] = unique;
  syncK12RangeButtons(key, unique);
  if (!options.skipApply) applyK12RangeFields({ changedKey: key });
  updateSourceScopeStatus();
  refreshSetupContinueState();
  writeDraft(draftState);
  clearPersistentSetupActionResults();
  resetSetupProgressAfterDraftChange();
  resetCurrentSetupActionResult();
  applyConfigSummary();
  syncDraftToServer();
}

function selectedK12RangeValues(key) {
  const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"][data-draft-multi-value="true"]`);
  if (field) return normalizeMultiSelectValue(field.value);
  return normalizeMultiSelectValue(draftState[key]);
}

function selectedK12RangeLabels(key) {
  const selected = selectedK12RangeValues(key);
  const buttons = Array.from(document.querySelectorAll(`[data-k12-range-field="${cssEscape(key)}"] [data-k12-option]`));
  return selected.map((value) => {
    const button = buttons.find((item) => item.dataset.k12Option === value);
    return button?.textContent?.trim() || value;
  });
}

function sourceScopeStatusContent() {
  const missingKeys = sourceScopeRequiredKeys.filter((key) => selectedK12RangeValues(key).length === 0);
  if (missingKeys.length) {
    const fields = missingKeys.map(sourceScopeFieldLabel).join(settings.lang === "zh" ? "、" : ", ");
    return {
      state: "missing",
      title: formatMessage(translate("setup.sourceScope.statusMissing") || "还差：{fields}", { fields }),
      note: translate("setup.sourceScope.requiredHint") || ""
    };
  }

  const stages = selectedK12RangeLabels("metadata.stage").join(settings.lang === "zh" ? "、" : ", ");
  return {
    state: "ready",
    title: formatMessage(translate("setup.sourceScope.statusReady") || "已选择：{stages} · {subjects} 个学科 · {grades} 个年级", {
      stages,
      subjects: String(selectedK12RangeValues("metadata.subject").length),
      grades: String(selectedK12RangeValues("metadata.grade").length)
    }),
    note: settings.lang === "zh" ? "资料范围已完成，可以继续。" : "Source scope is ready. You can continue."
  };
}

function sourceScopeFieldLabel(key) {
  if (settings.lang === "en") {
    if (key === "metadata.stage") return "stages";
    if (key === "metadata.subject") return "subjects";
    return "grades";
  }
  if (key === "metadata.stage") return "学段";
  if (key === "metadata.subject") return "学科";
  return "年级";
}

function formatMessage(message, replacements) {
  return String(message).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => replacements[key] ?? "");
}

function updateSourceScopeStatus() {
  const statusNode = document.querySelector("[data-source-scope-status]");
  if (!statusNode) return;
  const status = sourceScopeStatusContent();
  statusNode.dataset.state = status.state;
  setText("[data-source-scope-status-title]", status.title);
  setText("[data-source-scope-status-note]", status.note);
}

function k12PresetValues(field, preset) {
  const visible = Array.from(field.querySelectorAll("[data-k12-option]"))
    .filter((item) => !item.hidden && !item.disabled);
  if (preset === "all") return visible.map((item) => item.dataset.k12Option);

  const presetMap = {
    core: ["语文", "数学", "英语"],
    science: ["数学", "科学", "物理", "化学", "生物"],
    humanities: ["语文", "英语", "道德与法治", "思想政治", "历史", "地理"],
    arts: ["体育与健康", "音乐", "美术", "信息科技"]
  };
  const allowed = presetMap[preset] || [];
  return visible
    .filter((item) => allowed.includes(item.dataset.k12Option))
    .map((item) => item.dataset.k12Option);
}

function syncK12RangeButtons(key, selected = selectedK12RangeValues(key)) {
  document.querySelectorAll(`[data-k12-range-field="${cssEscape(key)}"] [data-k12-option]`).forEach((button) => {
    button.setAttribute("aria-pressed", String(selected.includes(button.dataset.k12Option)));
  });
}

function applyK12RangeFields() {
  const selectedStages = selectedK12RangeValues("metadata.stage");
  document.querySelectorAll("[data-k12-range-field]").forEach((field) => {
    const key = field.dataset.k12RangeField;
    const stageFiltered = key !== "metadata.stage";
    let visibleCount = 0;

    field.querySelectorAll("[data-k12-option]").forEach((button) => {
      const stages = splitStageList(button.dataset.k12OptionStages);
      const visible = !stageFiltered || !stages.length || selectedStages.some((stage) => stages.includes(stage));
      button.hidden = stageFiltered && (!selectedStages.length || !visible);
      button.disabled = stageFiltered && !selectedStages.length;
      if (!button.hidden) visibleCount += 1;
    });

    const empty = field.querySelector("[data-k12-range-empty]");
    if (empty) empty.hidden = !stageFiltered || selectedStages.length > 0 || visibleCount > 0;

    const allowed = Array.from(field.querySelectorAll("[data-k12-option]"))
      .filter((button) => !button.hidden)
      .map((button) => button.dataset.k12Option);
    const pruned = selectedK12RangeValues(key).filter((item) => allowed.includes(item));
    if (pruned.length !== selectedK12RangeValues(key).length) {
      setK12RangeValues(key, pruned, { skipApply: true });
    } else {
      syncK12RangeButtons(key, pruned);
    }
  });
  updateSourceScopeStatus();
}

function splitStageList(value = "") {
  return String(value).split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function bindLocalPathActions() {
  if (localPathActionsBound) return;
  localPathActionsBound = true;
  document.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-local-path]");
    if (copyButton) {
      event.preventDefault();
      await copyLocalPath(copyButton);
      return;
    }

    const openButton = event.target.closest("[data-open-local-path]");
    if (!openButton) return;
    event.preventDefault();
    await openLocalPathTarget(openButton);
  });
}

function bindStorageTools() {
  if (storageToolsBound) return;
  storageToolsBound = true;
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-generate-bucket-name]");
    if (!button) return;
    event.preventDefault();
    generateBucketName(button);
  });
  document.addEventListener("change", (event) => {
    if (!event.target.closest("[data-storage-setup]")) return;
    applyStorageLocationMode();
  });
  document.addEventListener("input", (event) => {
    const field = event.target.closest("[data-draft-field=\"aliyun.storage.bucket\"]");
    if (!field) return;
    applyStorageLocationMode();
  });
  applyStorageLocationMode();
}

function generateBucketName(button) {
  const targetKey = button.dataset.bucketTarget;
  const field = document.querySelector(`[data-draft-field="${cssEscape(targetKey)}"]`);
  if (!field) return;
  const bucketKind = button.dataset.generateBucketName === "vector" ? "vector" : "source";
  field.value = suggestedBucketName(bucketKind);
  saveDraftField(field);
  applyStorageLocationMode();
  showToast(
    settings.lang === "zh" ? "已生成可用命名格式" : "Generated a valid naming format",
    "pass"
  );
}

function suggestedBucketName(bucketKind) {
  const template = currentTemplate();
  const subject = String(normalizeMultiSelectValue(draftState["metadata.subject"])[0] || draftState["metadata.subject"] || template?.id || "kb")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18) || "kb";
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = Math.random().toString(36).slice(2, 6);
  return normalizeBucketName(`knowmesh-${subject}-${bucketKind}-${date}-${random}`, bucketKind === "vector" ? 32 : 63);
}

function normalizeBucketName(value, maxLength = 63) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return normalized.length >= 3 ? normalized : `knowmesh-${normalized || "kb"}`;
}

function bindModelTools() {
  if (modelToolsBound) return;
  modelToolsBound = true;

  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-model-quality-profile-card]");
    if (!card) return;
    event.preventDefault();
    selectModelQualityProfile(card.dataset.modelQualityProfileCard);
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-refresh-model-catalog]");
    if (!button) return;
    event.preventDefault();
    await refreshModelCatalog(button);
  });

  document.addEventListener("change", (event) => {
    const field = event.target.closest("[data-model-provider-setup] [data-draft-field]");
    if (!field) return;
    applyModelProviderContext(field.dataset.draftField);
  });

  document.addEventListener("change", (event) => {
    const field = event.target.closest("[data-model-quality-setup] [data-draft-field]");
    if (!field) return;
    applyModelQualityModelCards();
  });

  applyModelProviderContext();
  applyModelQualityModelCards();
  autoRefreshModelCatalog();
}

function selectModelQualityProfile(profile) {
  const defaults = modelQualityDefaults(profile);
  const updates = {
    "aliyun.services.profile": defaults.profile,
    "aliyun.services.ocr": defaults.ocr,
    "aliyun.services.organizer": defaults.organizer,
    "aliyun.services.embedding": defaults.embedding,
    "aliyun.services.rerank": defaults.rerank
  };

  for (const [key, value] of Object.entries(updates)) {
    const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"]`);
    if (field) field.value = value;
    draftState[key] = value;
  }

  writeDraft(draftState);
  resetSetupProgressAfterDraftChange();
  resetCurrentSetupActionResult();
  applyModelQualityModelCards();
  syncDraftToServer();
}

function modelQualityDefaults(profile) {
  if (profile === "high-quality") {
    return {
      profile: "high-quality",
      ocr: "qwen-vl-ocr-2025-11-20",
      organizer: "qwen-max",
      embedding: "qwen3-vl-embedding",
      rerank: "qwen3-vl-rerank"
    };
  }
  if (profile === "low-cost") {
    return {
      profile: "low-cost",
      ocr: "qwen3-vl-flash",
      organizer: "qwen-turbo",
      embedding: "text-embedding-v4",
      rerank: "qwen3-rerank"
    };
  }
  return {
    profile: "recommended",
    ocr: "qwen-vl-ocr-2025-11-20",
    organizer: "qwen-plus",
    embedding: "text-embedding-v4",
    rerank: "qwen3-rerank"
  };
}

function autoRefreshModelCatalog() {
  if (modelCatalogAutoRefreshStarted) return;
  if (!document.querySelector("[data-model-quality-setup]")) return;
  modelCatalogAutoRefreshStarted = true;
  const button = document.querySelector("[data-refresh-model-catalog]");
  window.setTimeout(() => {
    refreshModelCatalog(button, { silent: true });
  }, 0);
}

async function refreshModelCatalog(button, options = {}) {
  const silent = Boolean(options.silent);
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  setModelCatalogState("syncing");
  try {
    const response = await fetch("/api/aliyun/model-catalog/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current: collectDraftFields({ includeSensitive: false }) })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    modelCatalog = data.catalog || modelCatalog;
    refreshModelSelectOptions();
    applyModelQualityModelCards();
    const official = data.source === "official-docs";
    const message = setModelCatalogState(official ? "official" : "local");
    const migrations = Array.isArray(data.migrations) ? data.migrations : [];
    if (!silent) {
      showToast(
        migrations.length
          ? (settings.lang === "zh" ? "发现旧模型配置，建议切换到当前推荐模型" : "Old model settings found. Switch to current recommendations.")
          : message,
        migrations.length ? "warn" : "pass"
      );
    }
  } catch {
    const fallback = setModelCatalogState("local");
    if (!silent) showToast(fallback, "warn");
  } finally {
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

function draftFieldValue(field) {
  if (field.dataset.draftMultiValue === "true") return normalizeMultiSelectValue(field.value);
  return field.value;
}

function normalizeMultiSelectValue(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
      } catch {
        return [];
      }
    }
    return trimmed.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function draftValueMissing(value) {
  if (Array.isArray(value)) return value.length === 0;
  return !String(value || "").trim();
}

function setModelCatalogState(status) {
  const stateNode = document.querySelector("[data-model-catalog-state]");
  const key = status === "syncing"
    ? "setup.modelQuality.catalogSyncing"
    : status === "official"
      ? "setup.modelQuality.catalogOfficial"
      : "setup.modelQuality.catalogFallback";
  const fallback = settings.lang === "zh" ? "模型列表：本地推荐" : "Model list: local recommendations";
  const text = translate(key) || fallback;
  if (stateNode) {
    stateNode.dataset.modelCatalogStatus = status === "official" ? "official" : status === "syncing" ? "syncing" : "local";
    stateNode.textContent = text;
  }
  return text;
}

function refreshModelSelectOptions() {
  let changed = false;
  for (const slot of modelSlots) {
    const field = document.querySelector(`[data-draft-field="${cssEscape(slot.draftKey)}"]`);
    if (!field || field.tagName !== "SELECT") continue;
    const current = field.value || draftState[slot.draftKey] || "";
    const options = modelCatalog[slot.key] || [];
    const fallback = options.find((item) => item.status === "recommended") || options[0];
    const nextValue = options.some((item) => item.id === current) ? current : fallback?.id || "";
    field.innerHTML = options.map((item) => {
      const selected = item.id === nextValue ? " selected" : "";
      return `<option value="${escapeHtml(item.id)}"${selected}>${escapeHtml(modelOptionLabel(item))}</option>`;
    }).join("");
    if (nextValue) field.value = nextValue;
    if (nextValue && draftState[slot.draftKey] !== nextValue) {
      draftState[slot.draftKey] = nextValue;
      changed = true;
    }
  }
  if (changed) {
    writeDraft(draftState);
    syncDraftToServer();
  }
}

function applyModelQualityModelCards() {
  const setup = document.querySelector("[data-model-quality-setup]");
  if (!setup) return;
  const profile = String(collectDraftFields({ includeSensitive: false })["aliyun.services.profile"] || "recommended").trim();
  document.querySelectorAll("[data-model-quality-profile-card]").forEach((card) => {
    card.dataset.selected = String(card.dataset.modelQualityProfileCard === profile);
  });

  for (const slot of modelSlots) {
    const field = setup.querySelector(`[data-draft-field="${cssEscape(slot.draftKey)}"]`);
    const selected = modelCatalogItem(slot.key, field?.value || draftState[slot.draftKey]);
    if (!selected) continue;
    setText(`[data-model-slot-status="${cssEscape(slot.key)}"]`, modelStatusLabel(selected.status));
    document.querySelectorAll(`[data-model-slot-status="${cssEscape(slot.key)}"]`).forEach((node) => {
      node.dataset.status = selected.status || "available";
    });
    setText(`[data-model-slot-fit="${cssEscape(slot.key)}"]`, localized(selected.fit));
    setText(`[data-model-slot-impact="${cssEscape(slot.key)}"]`, localized(selected.impact));
    updateModelSlotLink(slot.key, "doc", selected.docUrl);
    updateModelSlotLink(slot.key, "pricing", selected.pricingUrl);
  }
}

function modelCatalogItem(slotKey, modelId) {
  const items = modelCatalog[slotKey] || [];
  return items.find((item) => item.id === modelId) || items.find((item) => item.status === "recommended") || items[0] || null;
}

function updateModelSlotLink(slotKey, linkType, href) {
  const selector = linkType === "pricing" ? `[data-model-slot-pricing="${cssEscape(slotKey)}"]` : `[data-model-slot-doc="${cssEscape(slotKey)}"]`;
  document.querySelectorAll(selector).forEach((node) => {
    if (href) node.href = href;
  });
}

function modelOptionLabel(item) {
  const base = localized(item.label) || item.id;
  const recommended = item.status === "recommended";
  return recommended
    ? `${base}${settings.lang === "zh" ? "（推荐）" : " (recommended)"}`
    : base;
}

function modelStatusLabel(status) {
  const zh = { recommended: "推荐", available: "可用" };
  const en = { recommended: "Recommended", available: "Available" };
  return (settings.lang === "zh" ? zh : en)[status] || (settings.lang === "zh" ? "可用" : "Available");
}

function bindRetrievalTools() {
  if (retrievalToolsBound) return;
  retrievalToolsBound = true;

  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-retrieval-profile-card]");
    if (!card) return;
    event.preventDefault();
    selectRetrievalProfile(card.dataset.retrievalProfileCard);
  });

  applyRetrievalStrategyCards();
}

function selectRetrievalProfile(profileId) {
  const profile = retrievalProfileById(profileId) || retrievalProfileById(defaultRetrievalProfileId);
  if (!profile) return;
  const field = document.querySelector('[data-draft-field="retrieval.profile"]');
  if (field) field.value = profile.id;
  draftState["retrieval.profile"] = profile.id;
  writeDraft(draftState);
  resetSetupProgressAfterDraftChange();
  resetCurrentSetupActionResult();
  applyRetrievalStrategyCards();
  syncDraftToServer();
}

function applyRetrievalStrategyCards() {
  const setup = document.querySelector("[data-retrieval-setup]");
  if (!setup) return;
  const field = setup.querySelector('[data-draft-field="retrieval.profile"]');
  const profileId = String(field?.value || draftState["retrieval.profile"] || defaultRetrievalProfileId).trim();
  const profile = retrievalProfileById(profileId) || retrievalProfileById(defaultRetrievalProfileId) || retrievalProfiles[0];
  if (!profile) return;

  if (field && field.value !== profile.id) field.value = profile.id;

  retrievalProfiles.forEach((item) => {
    const selected = item.id === profile.id;
    document.querySelectorAll(`[data-retrieval-profile-card="${cssEscape(item.id)}"]`).forEach((card) => {
      card.dataset.selected = String(selected);
      card.setAttribute("aria-pressed", String(selected));
    });
    setText(`[data-retrieval-profile-badge="${cssEscape(item.id)}"]`, localized(item.badge));
    setText(`[data-retrieval-profile-title="${cssEscape(item.id)}"]`, localized(item.label));
    setText(`[data-retrieval-profile-fit="${cssEscape(item.id)}"]`, localized(item.fit));
    setText(`[data-retrieval-profile-body="${cssEscape(item.id)}"]`, localized(item.body));
  });

  setText("[data-retrieval-profile-current]", localized(profile.label));
  const methodList = document.querySelector("[data-retrieval-method-list]");
  if (methodList) {
    methodList.innerHTML = (profile.methods || []).map((method) => {
      const item = retrievalMethods[method] || { label: { zh: method, en: method }, body: { zh: "", en: "" } };
      return `<article data-retrieval-method-item="${escapeHtml(method)}">
        <strong>${escapeHtml(localized(item.label) || method)}</strong>
        <span>${escapeHtml(localized(item.body) || "")}</span>
      </article>`;
    }).join("");
  }
}

function retrievalProfileById(profileId) {
  return retrievalProfiles.find((profile) => profile.id === profileId) || null;
}

function applyStorageLocationMode() {
  const setup = document.querySelector("[data-storage-setup]");
  if (!setup) return;
  const modeField = setup.querySelector('[data-draft-field="aliyun.search.storageMode"]');
  const sourceActionField = setup.querySelector('[data-draft-field="aliyun.storage.action"]');
  const searchRegionField = setup.querySelector('[data-draft-field="aliyun.search.region"]');
  const searchBucketField = setup.querySelector('[data-draft-field="aliyun.search.bucket"]');

  if (sourceActionField && !sourceActionField.value) {
    sourceActionField.value = "create";
    draftState["aliyun.storage.action"] = "create";
    writeDraft(draftState);
  }
  if (modeField && !modeField.value) {
    modeField.value = "same-region";
    draftState["aliyun.search.storageMode"] = "same-region";
    writeDraft(draftState);
  }
  if (modeField?.value === "same-bucket") {
    modeField.value = "same-region";
    draftState["aliyun.search.storageMode"] = "same-region";
    writeDraft(draftState);
  }

  const mode = modeField?.value || "same-region";

  setup.dataset.searchStorageMode = mode;

  if (searchRegionField) {
    searchRegionField.disabled = mode !== "separate-region";
    if (mode !== "separate-region" && searchRegionField.value) {
      searchRegionField.value = "";
      draftState["aliyun.search.region"] = "";
      writeDraft(draftState);
    }
  }

  if (searchBucketField) searchBucketField.disabled = false;
}

async function copyLocalPath(button) {
  const key = button.dataset.copyLocalPath;
  const value = document.querySelector(`[data-local-path-value="${cssEscape(key)}"]`)?.textContent?.trim() || "";
  if (!value) return;
  const copied = await copyTextBestEffort(value);
  showToast(
    copied
      ? translate("setup.pathCopied") || (settings.lang === "zh" ? "路径已复制" : "Path copied")
      : translate("setup.pathCopyFailed") || (settings.lang === "zh" ? "没有复制成功，请手动选择路径复制。" : "The path was not copied. Select and copy it manually."),
    copied ? "pass" : "warn"
  );
}

async function openLocalPathTarget(button) {
  const target = button.dataset.openLocalPath;
  button.disabled = true;
  try {
    const response = await fetch("/api/local/paths/open", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ target })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Open path failed.");
    showToast(translate("setup.pathOpenStarted") || (settings.lang === "zh" ? "已打开本地目录" : "Local folder opened"), "pass");
  } catch {
    showToast(translate("setup.pathOpenFailed") || (settings.lang === "zh" ? "没有打开目录，请按路径手动查看。" : "The folder did not open. Use the path to check it manually."), "fail");
  } finally {
    button.disabled = false;
  }
}

async function useTypedFolderPath(button) {
  const target = button.dataset.folderUsePath;
  const draftKey = button.dataset.folderTarget;
  const field = draftKey ? document.querySelector(`[data-draft-field="${cssEscape(draftKey)}"]`) : null;
  const value = String(field?.value || "").trim();
  if (!value) {
    const message = target === "workspace"
      ? (settings.lang === "zh" ? "请先粘贴工作目录路径。" : "Paste the work folder path first.")
      : (settings.lang === "zh" ? "请先粘贴资料目录路径。" : "Paste the source folder path first.");
    showFolderPickerResult(document.querySelector("[data-folder-picker-result=\"project\"]"), "warn", message);
    showFolderPathDialog({
      status: "warn",
      title: settings.lang === "zh" ? "还没有路径" : "No Path Yet",
      message
    });
    return;
  }
  if (draftKey) applyPickedFolder(draftKey, value);
  await runPathPrecheck(target, value, { showDialog: true });
}

async function handleFolderDrop(dropzone, event) {
  const target = dropzone.dataset.folderDropzone;
  const draftKey = dropzone.dataset.folderTarget;
  const droppedPath = pathFromDroppedItems(event.dataTransfer);

  if (droppedPath && draftKey) {
    applyPickedFolder(draftKey, droppedPath);
    await runPathPrecheck(target, droppedPath);
    return;
  }

  const message = translate("setup.folderBrowser.dropUnavailable")
    || (settings.lang === "zh"
      ? "浏览器不能读取拖入目录的完整本机路径，请点击“选择文件夹”或粘贴路径。"
      : "The browser cannot read the full local path from a dropped folder. Choose a folder or paste the path instead.");
  showFolderPickerResult(document.querySelector("[data-folder-picker-result=\"project\"]"), "warn", message);
  showFolderPathDialog({
    status: "warn",
    title: settings.lang === "zh" ? "没有取得完整路径" : "Full Path Not Available",
    message
  });
}

function pathFromDroppedItems(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []);
  const fileWithPath = files.find((file) => typeof file.path === "string" && file.path);
  if (!fileWithPath) return "";
  if (files.length === 1 && !fileWithPath.name) return fileWithPath.path;
  return parentPathFromFile(fileWithPath.path, fileWithPath.name);
}

function parentPathFromFile(filePath, fileName) {
  const value = String(filePath || "");
  const name = String(fileName || "");
  if (!value) return "";
  if (name && value.endsWith(name)) {
    return value.slice(0, Math.max(0, value.length - name.length)).replace(/[\\/]$/, "");
  }
  const index = Math.max(value.lastIndexOf("\\"), value.lastIndexOf("/"));
  return index > 0 ? value.slice(0, index) : value;
}

async function runSystemFolderPicker(button) {
  const target = button.dataset.folderPicker;
  const draftKey = button.dataset.folderTarget;
  const resultNode = document.querySelector("[data-folder-picker-result=\"project\"]");
  const working = translate("setup.folderPicker.working") || (settings.lang === "zh" ? "正在打开系统目录选择..." : "Opening the system folder picker...");

  button.disabled = true;
  showFolderPickerResult(resultNode, "working", working);

  try {
    const response = await fetch("/api/local/folders/pick", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ target })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Folder picker failed.");

    if (data.ok && data.path && draftKey) {
      applyPickedFolder(draftKey, data.path);
      await runPathPrecheck(target, data.path);
      return;
    }

    const fallbackMessage = localized(data.checks?.[0]?.message)
      || translate("setup.folderPicker.canceled")
      || (settings.lang === "zh" ? "没有选择目录，可以继续手动粘贴路径。" : "No folder was selected. You can paste the path manually.");
    showFolderPickerResult(resultNode, "warn", fallbackMessage);
  } catch {
    showFolderPickerResult(
      resultNode,
      "warn",
      translate("setup.folderPicker.unavailable") || (settings.lang === "zh" ? "没有打开系统目录选择框，请直接粘贴路径。" : "The system folder picker did not open. Paste the path manually.")
    );
  } finally {
    button.disabled = false;
  }
}

function applyPickedFolder(key, value) {
  const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"]`);
  draftState[key] = value;
  if (field) {
    field.value = value;
    saveDraftField(field);
  } else {
    writeDraft(draftState);
    resetSetupProgressAfterDraftChange();
    applyConfigSummary();
    syncDraftToServer();
  }
  renderProjectChecklist(currentTemplate());
}

async function runPathPrecheck(target, value, options = {}) {
  const resultNode = document.querySelector("[data-folder-picker-result=\"project\"]");
  const pathValue = String(value || "").trim();
  const sequence = ++pathPrecheckSequence;

  if (!pathValue) {
    const message = target === "workspace"
      ? (settings.lang === "zh" ? "还没有选择工作目录。" : "No work folder has been selected yet.")
      : (settings.lang === "zh" ? "还没有选择资料目录。" : "No source folder has been selected yet.");
    showFolderPickerResult(resultNode, "warn", message);
    if (options.showDialog) {
      showFolderPathDialog({
        status: "warn",
        title: settings.lang === "zh" ? "还没有路径" : "No Path Yet",
        message
      });
    }
    return;
  }

  showFolderPickerResult(
    resultNode,
    "working",
    settings.lang === "zh" ? "正在做本机只读预检..." : "Running a local read-only precheck...",
    pathValue
  );

  try {
    const response = await fetch("/api/local/folders/precheck", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        target,
        path: pathValue,
        template: settings.template
      })
    });
    const data = await response.json();
    if (sequence !== pathPrecheckSequence) return;
    if (!response.ok) throw new Error(data.error || "Precheck failed.");
    showPathPrecheckResult(resultNode, data);
    if (options.showDialog) showPathPrecheckDialog(data);
  } catch {
    const message = settings.lang === "zh"
      ? "没有完成本机预检，可以继续手动检查路径。"
      : "The local precheck did not complete. You can still check the path manually.";
    showFolderPickerResult(
      resultNode,
      "warn",
      message,
      pathValue
    );
    if (options.showDialog) {
      showFolderPathDialog({
        status: "warn",
        title: settings.lang === "zh" ? "预检没有完成" : "Precheck Did Not Finish",
        message,
        path: pathValue
      });
    }
  }
}

function schedulePathPrecheck(target, value) {
  window.clearTimeout(pathPrecheckTimer);
  pathPrecheckTimer = window.setTimeout(() => {
    runPathPrecheck(target, value);
  }, 500);
}

function showFolderPickerResult(resultNode, status, message, selectedPath = "") {
  if (!resultNode) return;
  folderResultState.delete(resultNode);
  resultNode.hidden = false;
  resultNode.className = `folder-picker-result ${status}`;
  const labels = folderStatusLineLabels(status, message, selectedPath);
  resultNode.innerHTML = `<span class="api-result-dot" aria-hidden="true"></span>
    <span class="api-result-copy">
      <strong>${escapeHtml(labels.title)}</strong>
      <span>${escapeHtml(labels.message)}</span>
    </span>`;
}

function showPathPrecheckResult(resultNode, data) {
  if (!resultNode) return;
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const status = folderPrecheckStatus(checks);
  const labels = folderStatusLineLabels(status, folderPrecheckSummary(data, status), data?.path || "");
  folderResultState.set(resultNode, data);
  resultNode.hidden = false;
  resultNode.className = `folder-picker-result ${status}`;
  resultNode.innerHTML = `<span class="api-result-dot" aria-hidden="true"></span>
    <span class="api-result-copy">
      <strong>${escapeHtml(labels.title)}</strong>
      <span>${escapeHtml(labels.message)}</span>
    </span>
    <button class="folder-result-open" type="button" data-folder-result-open>${escapeHtml(labels.open)}</button>`;
}

function showStoredFolderPrecheckDialog(button) {
  const resultNode = button.closest("[data-folder-picker-result]");
  const data = resultNode ? folderResultState.get(resultNode) : null;
  if (data) showPathPrecheckDialog(data);
}

function folderPrecheckStatus(checks) {
  if (checks.some((item) => item.status === "fail")) return "fail";
  if (checks.some((item) => item.status === "warn")) return "warn";
  return "pass";
}

function folderStatusLineLabels(status, message = "", selectedPath = "") {
  const open = settings.lang === "zh" ? "查看结果" : "View";
  if (status === "working") {
    return {
      title: settings.lang === "zh" ? "处理中" : "Working",
      message: message || selectedPath || (settings.lang === "zh" ? "正在检查目录。" : "Checking the folder."),
      open
    };
  }
  if (status === "pass") {
    return {
      title: settings.lang === "zh" ? "已完成" : "Complete",
      message: message || selectedPath || (settings.lang === "zh" ? "目录检查完成。" : "Folder check complete."),
      open
    };
  }
  if (status === "fail") {
    return {
      title: settings.lang === "zh" ? "未通过" : "Failed",
      message: message || selectedPath || (settings.lang === "zh" ? "目录需要处理。" : "The folder needs attention."),
      open
    };
  }
  return {
    title: settings.lang === "zh" ? "需确认" : "Review",
    message: message || selectedPath || (settings.lang === "zh" ? "目录需要确认。" : "Review this folder."),
    open
  };
}

function folderPrecheckSummary(data, status) {
  const targetLabel = data?.target === "workspace"
    ? (settings.lang === "zh" ? "工作目录" : "Work folder")
    : (settings.lang === "zh" ? "资料目录" : "Source folder");
  if (status === "pass") {
    return settings.lang === "zh" ? `${targetLabel}已检查，可以使用。` : `${targetLabel} checked and ready.`;
  }
  if (status === "fail") {
    return settings.lang === "zh" ? `${targetLabel}有问题，请查看结果。` : `${targetLabel} has issues. View the result.`;
  }
  return settings.lang === "zh" ? `${targetLabel}有需要确认的项目。` : `${targetLabel} needs review.`;
}

function showPathPrecheckDialog(data) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const status = folderPrecheckStatus(checks);
  const isClear = status === "pass";
  const targetLabel = data?.target === "workspace"
    ? (settings.lang === "zh" ? "工作目录" : "Work Folder")
    : (settings.lang === "zh" ? "资料目录" : "Source Folder");
  const title = settings.lang === "zh" ? `${targetLabel}检查结果` : `${targetLabel} Check Result`;
  const summaryTitle = isClear
    ? (settings.lang === "zh" ? "可以使用这个目录" : "This folder can be used")
    : (settings.lang === "zh" ? "需要先处理" : "Needs attention");
  const summaryBody = isClear
    ? (settings.lang === "zh" ? "本机预检已完成，可以继续下一步。" : "The local precheck is complete. You can continue.")
    : (settings.lang === "zh" ? "先查看下面的问题，再重新检查。" : "Review the items below, then check again.");
  const visibleChecks = checks.filter((item) => item.status !== "pass" && item.status !== "skip");
  const items = visibleChecks.length ? visibleChecks : checks.slice(0, 4);
  const pathHtml = data?.path
    ? `<div class="api-result-detail"><strong>${escapeHtml(settings.lang === "zh" ? "当前路径" : "Current path")}</strong><span>${escapeHtml(data.path)}</span></div>`
    : "";

  showAppDialog({
    kind: "result",
    tone: status === "fail" ? "danger" : "default",
    title,
    bodyHtml: `<div class="result-dialog-content">
      <section class="api-result-findings" data-status="${escapeHtml(isClear ? "pass" : "fail")}">
        <header>
          <span class="api-result-state-dot" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(summaryTitle)}</strong>
            <p>${escapeHtml(summaryBody)}</p>
          </div>
        </header>
        ${items.length ? `<ul class="api-result-primary-list">${items.map((item) => renderApiCheckItem(item)).join("")}</ul>` : ""}
      </section>
      ${pathHtml}
    </div>`,
    confirmLabel: settings.lang === "zh" ? "知道了" : "Close"
  });
}

function showFolderPathDialog({ status = "warn", title = "KnowMesh", message = "", path = "" } = {}) {
  const clear = status === "pass";
  const pathHtml = path
    ? `<div class="api-result-detail"><strong>${escapeHtml(settings.lang === "zh" ? "当前路径" : "Current path")}</strong><span>${escapeHtml(path)}</span></div>`
    : "";
  showAppDialog({
    kind: "result",
    tone: status === "fail" ? "danger" : "default",
    title,
    bodyHtml: `<div class="result-dialog-content">
      <section class="api-result-findings" data-status="${escapeHtml(clear ? "pass" : "fail")}">
        <header>
          <span class="api-result-state-dot" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(clear ? (settings.lang === "zh" ? "已完成" : "Completed") : (settings.lang === "zh" ? "需要处理" : "Needs attention"))}</strong>
            <p>${escapeHtml(message)}</p>
          </div>
        </header>
      </section>
      ${pathHtml}
    </div>`,
    confirmLabel: settings.lang === "zh" ? "知道了" : "Close"
  });
}

async function runApiAction(button) {
  const actionKey = apiActionKey(button);
  const action = draftPanelAction(actionKey);
  const resultKey = button.dataset.apiResultKey || action?.resultKey || actionKey;
  const resultNode = document.querySelector(`[data-api-result="${cssEscape(resultKey)}"]`);
  const loading = settings.lang === "zh" ? button.dataset.apiLoadingZh : button.dataset.apiLoadingEn;
  const method = button.dataset.apiMethod || "POST";
  const jobAction = isJobConsoleAction(actionKey);

  if (actionKey === "save-aliyun-credentials") {
    return runAliyunCredentialTestFlow(button, resultNode, loading || "");
  }

  if (actionKey === "test-aliyun-model-provider") {
    return runModelProviderTestFlow(button, resultNode, loading || "");
  }

  if (actionKey === "preview-aliyun-storage") {
    return runAliyunStorageConfirmFlow(button, resultNode, loading || "");
  }

  if (!(await confirmApiAction(button))) return null;

  button.disabled = true;
  showApiResult(resultNode, "working", loading || "", actionKey);
    if (jobAction) {
      refreshJobActionBar(currentJobSnapshot, "working", loading || "", actionKey);
      if (actionKey !== "latest-job") startJobActionPolling();
    }

  try {
    const requestOptions = {
      method,
      headers: { accept: "application/json" }
    };
    if (method !== "GET") {
      requestOptions.headers["content-type"] = "application/json";
      requestOptions.body = JSON.stringify(buildApiPayload(actionKey, button));
    }
    const response = await fetch(button.dataset.apiEndpoint, {
      ...requestOptions
    });
    const data = await response.json();
    if (!response.ok && !hasRenderableApiData(data)) throw new Error(data.error || "Request failed.");
    if (action?.key === "clear-aliyun-credentials") {
      delete draftState["aliyun.credential.accessKeySecret.configured"];
      delete draftState["aliyun.credential.accessKeySecret.pending"];
      delete draftState["aliyun.credential.accessKeySecret"];
      writeDraft(draftState);
      clearSensitiveFields(settings.lang === "zh" ? "已清除，请重新填写" : "Cleared; enter again");
      applyCredentialSavedVisualState(null);
      applySavedCredentialActionState(false);
      applyDraftValues();
      applyConfigSummary();
    }
    if (data.copyText && action?.key === "copy-aliyun-policy") {
      await copyTextBestEffort(data.copyText);
    }
    if (action?.key === "save-aliyun-model-quality" && data.modelQuality?.configured) {
      applySavedModelQuality(data.modelQuality);
    }
    if (action?.key === "save-aliyun-search" && data.search?.configured) {
      applySavedSearch(data.search);
    }
    if (action?.key === "save-retrieval-strategy" && data.retrievalStrategy?.configured) {
      applySavedRetrievalStrategy(data.retrievalStrategy);
    }
    showApiChecks(resultNode, data, actionKey);
    syncMaintenanceStatusPolling(resultNode, data, actionKey);
    if (jobAction) refreshJobActionBar(data?.job || null, data?.job ? "ready" : "empty", "", actionKey);
    if (actionKey === "confirm-build-job" && data?.job) {
      showToast(settings.lang === "zh" ? "任务已创建，正在进入执行页。" : "Task created. Opening execution page.", "pass");
      window.setTimeout(() => {
        navigateTo("/build/execution");
      }, 450);
    }
    return data;
  } catch {
    showApiResult(
      resultNode,
      "fail",
      settings.lang === "zh" ? "操作没有完成，请检查填写内容后重试。" : "The action did not complete. Check the fields and retry.",
      actionKey
    );
    if (jobAction) refreshJobActionBar(currentJobSnapshot, "failed", "", actionKey);
    return null;
  } finally {
    button.disabled = false;
  }
}

async function runAliyunStorageConfirmFlow(button, resultNode, loading) {
  const actionKey = "preview-aliyun-storage";
  const payload = buildApiPayload(actionKey, button);
  button.disabled = true;
  showApiResult(resultNode, "working", loading || (settings.lang === "zh" ? "正在检查保存位置..." : "Checking storage locations..."), actionKey);

  try {
    const previewResponse = await fetch(button.dataset.apiEndpoint || "/api/aliyun/storage/preview", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const preview = await previewResponse.json();
    if (!previewResponse.ok && !hasRenderableApiData(preview)) throw new Error(preview.error || "Preview failed.");

    if (!preview.ok) {
      showApiChecks(resultNode, preview, actionKey);
      return preview;
    }

    const shouldCreate = await showAliyunStorageConfirmPrompt(preview);
    if (!shouldCreate) {
      showApiResult(
        resultNode,
        "fail",
        settings.lang === "zh" ? "还没有保存云端位置，确认后才能继续。" : "Cloud storage locations are not saved yet. Confirm them before continuing.",
        actionKey,
        { showToast: false }
      );
      return null;
    }

    showApiResult(
      resultNode,
      "working",
      settings.lang === "zh" ? "正在创建或保存 Bucket..." : "Creating or saving buckets...",
      actionKey,
      { showToast: false }
    );
    const createResponse = await fetch("/api/aliyun/storage/create", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const created = await createResponse.json();
    if (!createResponse.ok && !hasRenderableApiData(created)) throw new Error(created.error || "Storage creation failed.");
    if (created.storage?.confirmed) {
      draftState["aliyun.storage.confirmed"] = true;
      draftState["aliyun.storage.confirmedAt"] = new Date().toISOString();
      writeDraft(draftState);
    }
    showApiChecks(resultNode, created, actionKey);
    return created;
  } catch {
    showApiResult(
      resultNode,
      "fail",
      settings.lang === "zh" ? "没有完成保存位置准备，请检查填写内容和阿里云权限后重试。" : "Storage setup did not finish. Check the fields and Aliyun permissions, then try again.",
      actionKey
    );
    return null;
  } finally {
    button.disabled = false;
  }
}

async function runModelProviderTestFlow(button, resultNode, loading) {
  const actionKey = "test-aliyun-model-provider";
  const input = modelProviderInputState();
  const payload = buildApiPayload(actionKey, button);
  button.disabled = true;
  showApiResult(resultNode, "working", loading || (settings.lang === "zh" ? "正在检查模型服务..." : "Checking model service..."), actionKey);

  try {
    const response = await fetch(button.dataset.apiEndpoint || "/api/aliyun/model-provider/preview", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const preview = await response.json();
    if (!response.ok && !hasRenderableApiData(preview)) throw new Error(preview.error || "Model provider check failed.");
    showApiChecks(resultNode, preview, actionKey, { showDialog: false });

    if (!modelProviderTestPassed(preview)) return preview;
    if (!input.hasCurrentInput) return preview;

    const shouldSave = await showModelProviderSavePrompt(preview);
    if (!shouldSave) {
      showApiResult(
        resultNode,
        "fail",
        settings.lang === "zh" ? "测试已通过，但还没有保存百炼 API Key。" : "The test passed, but the Model Studio API Key has not been saved.",
        actionKey,
        { showDialog: false, showToast: false }
      );
      return null;
    }

    showApiResult(
      resultNode,
      "working",
      settings.lang === "zh" ? "正在保存百炼 API Key..." : "Saving Model Studio API Key...",
      actionKey,
      { showDialog: false, showToast: false }
    );
    const saveResponse = await fetch("/api/setup/aliyun/model-provider", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input)
    });
    const saved = await saveResponse.json();
    if (!saveResponse.ok && !hasRenderableApiData(saved)) throw new Error(saved.error || "Model provider save failed.");
    if (saved.modelProvider?.configured) applySavedModelProvider(saved.modelProvider);
    showApiChecks(resultNode, saved, actionKey, { showDialog: false });
    return saved;
  } catch {
    showApiResult(
      resultNode,
      "fail",
      settings.lang === "zh" ? "没有完成模型服务检查，请检查 Base URL 和 API Key 后重试。" : "The model service check did not finish. Check the Base URL and API Key, then retry.",
      actionKey
    );
    return null;
  } finally {
    button.disabled = false;
  }
}

function modelProviderTestPassed(data) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  return Boolean(data?.ok && !checks.some((item) => item.status === "fail"));
}

function showModelProviderSavePrompt(data) {
  const note = settings.lang === "zh"
    ? "保存后，KnowMesh 才会在 OCR、整理、向量化和重排步骤中使用这个 API Key。"
    : "After saving, KnowMesh can use this API Key for OCR, organization, embedding, and rerank steps.";
  return showAppDialog({
    kind: "confirm",
    tone: "default",
    title: settings.lang === "zh" ? "连接可用，是否保存？" : "Connection Works. Save It?",
    bodyHtml: renderConfirmation(data.confirmation, { note }),
    confirmLabel: settings.lang === "zh" ? "保存 API Key" : "Save API Key",
    cancelLabel: settings.lang === "zh" ? "取消" : "Cancel"
  });
}

function showAliyunStorageConfirmPrompt(data) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const willCreate = checks.some((item) => item.status === "warn" && /BucketLookup$/.test(item.key || ""));
  const note = settings.lang === "zh"
    ? "确认后，KnowMesh 会创建缺失的私有 Bucket，或保存当前账号下已有的 Bucket。不会上传资料，也不会写入知识库。"
    : "After confirmation, KnowMesh creates missing private buckets or saves existing buckets from the current account. No sources are uploaded and no knowledge base is written.";
  return showAppDialog({
    kind: "confirm",
    tone: "default",
    title: settings.lang === "zh" ? "确认云端保存位置" : "Confirm Cloud Storage",
    bodyHtml: renderConfirmation(data.confirmation, { note }),
    confirmLabel: willCreate
      ? (settings.lang === "zh" ? "创建并保存" : "Create and Save")
      : (settings.lang === "zh" ? "保存位置" : "Save Locations"),
    cancelLabel: settings.lang === "zh" ? "取消" : "Cancel"
  });
}

async function runAliyunCredentialTestFlow(button, resultNode, loading) {
  const actionKey = "save-aliyun-credentials";
  const request = selectAliyunCredentialTestRequest(button);
  button.disabled = true;
  showApiResult(resultNode, "working", loading || (settings.lang === "zh" ? "正在测试凭证..." : "Testing credential..."), actionKey);

  try {
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request.payload)
    });
    const data = await response.json();
    if (!response.ok && !hasRenderableApiData(data)) throw new Error(data.error || "Request failed.");
    data.credentialTestSource = request.source;
    showApiChecks(resultNode, data, actionKey, { showDialog: false });

    if (!credentialTestPassed(data)) {
      return data;
    }

    if (request.source !== "current-input") {
      return data;
    }

    const shouldSave = await showCredentialSavePrompt(data, request);
    if (!shouldSave) {
      showApiResult(
        resultNode,
        "fail",
        settings.lang === "zh" ? "测试已通过，但还没有保存到本机。" : "The test passed, but the credential has not been saved locally.",
        actionKey,
        { showDialog: false, showToast: false }
      );
      return null;
    }

    showApiResult(
      resultNode,
      "working",
      settings.lang === "zh" ? "正在保存凭证..." : "Saving credential...",
      actionKey,
      { showDialog: false, showToast: false }
    );
    const saveResponse = await fetch("/api/setup/aliyun/credentials", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildApiPayload(actionKey, button))
    });
    const saved = await saveResponse.json();
    if (!saveResponse.ok && !hasRenderableApiData(saved)) throw new Error(saved.error || "Save failed.");
    if (saved.credential?.configured) applySavedCredential(saved.credential);
    showApiChecks(resultNode, saved, actionKey, { showDialog: false });
    return saved;
  } catch {
    showApiResult(
      resultNode,
      "fail",
      settings.lang === "zh" ? "没有完成凭证测试，请检查填写内容后重试。" : "The credential test did not complete. Check the fields and retry.",
      actionKey
    );
    return null;
  } finally {
    button.disabled = false;
  }
}

function selectAliyunCredentialTestRequest(button) {
  const actionKey = "save-aliyun-credentials";
  const input = credentialInputState();
  if (input.hasCurrentInput) {
    return {
      source: "current-input",
      endpoint: button.dataset.apiEndpoint || "/api/setup/aliyun/credentials/check",
      payload: buildApiPayload(actionKey, button)
    };
  }
  if (credentialSecretConfigured()) {
    return {
      source: "saved-local",
      endpoint: button.dataset.apiEndpoint || "/api/setup/aliyun/credentials/check",
      payload: { ...buildApiPayload(actionKey, button), useSavedCredential: true }
    };
  }
  return {
    source: "local-config",
    endpoint: "/api/setup/aliyun/existing/check",
    payload: {
      mode: settings.mode,
      template: settings.template,
      draft: collectDraftFields({ includeSensitive: false })
    }
  };
}

function credentialTestPassed(data) {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  return Boolean(data?.ok && data.credential?.verified && !checks.some((item) => item.status === "fail"));
}

function showCredentialSavePrompt(data, request) {
  const note = settings.lang === "zh"
    ? "这组凭证已通过测试。保存后，KnowMesh 才会在后续步骤中使用它。"
    : "This credential passed the test. Save it before KnowMesh uses it in later steps.";
  return showAppDialog({
    kind: "confirm",
    tone: "default",
    title: settings.lang === "zh" ? "测试通过，是否保存？" : "Test Passed. Save It?",
    bodyHtml: renderCredentialSaveSummary(data, request, note),
    confirmLabel: settings.lang === "zh" ? "保存凭证" : "Save Credential",
    cancelLabel: settings.lang === "zh" ? "取消" : "Cancel"
  });
}

function renderCredentialSaveSummary(data, request, note) {
  return renderCredentialTestSummary({ ...data, credentialTestSource: request.source }, { note });
}

function renderCredentialTestSummary(data, options = {}) {
  const source = credentialSourceLabel(data.credential?.source || data.credentialTestSource || "");
  const resultText = options.resultText || credentialResultText(data);
  const note = options.note || "";
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const detailItems = checks.map((item) => {
    return `<li data-status="${escapeHtml(item.status)}"><strong>${escapeHtml(localized(item.label))}</strong><span>${escapeHtml(localized(item.message))}</span></li>`;
  }).join("");
  const details = detailItems
    ? `<details class="credential-test-details">
        <summary>${escapeHtml(settings.lang === "zh" ? "查看详情" : "View Details")}</summary>
        <ul>${detailItems}</ul>
      </details>`
    : "";
  return `<section class="credential-test-summary" data-status="${escapeHtml(options.status || (data.ok ? "pass" : "fail"))}">
      <p><span>${escapeHtml(settings.lang === "zh" ? "测试来源" : "Test Source")}</span><strong>${escapeHtml(source)}</strong></p>
      <p><span>${escapeHtml(settings.lang === "zh" ? "连接结果" : "Connection")}</span><strong>${escapeHtml(resultText)}</strong></p>
      ${note ? `<p class="credential-test-note">${escapeHtml(note)}</p>` : ""}
      ${details}
    </section>`;
}

function firstCredentialCheck(data, status = "") {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  return checks.find((item) => !status || item.status === status) || checks[0];
}

function credentialResultText(data) {
  const passed = firstCredentialCheck(data, "pass");
  if (passed?.message) return localized(passed.message);
  if (data.identity?.identityType) {
    return settings.lang === "zh"
      ? `已连接 ${data.identity.identityType}。`
      : `Connected as ${data.identity.identityType}.`;
  }
  return settings.lang === "zh" ? "已连接阿里云。" : "Connected to Aliyun.";
}

function credentialSourceLabel(source) {
  const key = String(source || "");
  const labels = settings.lang === "zh"
    ? {
        "current-input": "页面输入",
        "saved-local": "已保存凭证",
        "secure-local": "已保存凭证",
        "env-file": "项目 .env",
        "existing-env": "本机配置",
        environment: "系统环境变量",
        "local-config": "本机配置"
      }
    : {
        "current-input": "Page input",
        "saved-local": "Saved credential",
        "secure-local": "Saved credential",
        "env-file": "Project .env",
        "existing-env": "Local configuration",
        environment: "System environment variables",
        "local-config": "Local configuration"
      };
  if (key.includes(".env")) return settings.lang === "zh" ? "项目 .env" : "Project .env";
  return labels[key] || (settings.lang === "zh" ? "本机配置" : "Local configuration");
}

async function confirmApiAction(button) {
  const body = settings.lang === "zh" ? button.dataset.confirmBodyZh : button.dataset.confirmBodyEn;
  if (!body) return true;
  const title = settings.lang === "zh" ? button.dataset.confirmTitleZh : button.dataset.confirmTitleEn;
  const confirmLabel = settings.lang === "zh" ? button.dataset.confirmLabelZh : button.dataset.confirmLabelEn;
  return showConfirmDialog({ title, body, confirmLabel });
}

function showConfirmDialog(options = {}) {
  return showAppDialog({ ...options, kind: "confirm" });
}

function showAlertDialog(options = {}) {
  return showAppDialog({ ...options, kind: "alert" });
}

function showPromptDialog(options = {}) {
  return showAppDialog({ ...options, kind: "prompt" });
}

function showAppDialog(options = {}) {
  const rootNode = document.querySelector("[data-app-dialog-root]");
  if (!rootNode) {
    return Promise.resolve(options.kind === "prompt" ? null : false);
  }

  if (activeDialogCleanup) activeDialogCleanup();

  const titleNode = rootNode.querySelector("[data-app-dialog-title]");
  const bodyNode = rootNode.querySelector("[data-app-dialog-body]");
  const inputNode = rootNode.querySelector("[data-app-dialog-input]");
  const cancelButton = rootNode.querySelector("[data-app-dialog-cancel]");
  const confirmButton = rootNode.querySelector("[data-app-dialog-confirm]");
  const kind = options.kind || "alert";
  const labels = dialogLabels();
  const confirmLabel = options.confirmLabel || labels.confirm;
  const cancelLabel = options.cancelLabel || labels.cancel;

  rootNode.dataset.dialogKind = kind;
  rootNode.dataset.dialogTone = options.tone || "default";
  delete rootNode.dataset.dialogClosing;
  if (titleNode) titleNode.textContent = options.title || "KnowMesh";
  if (bodyNode) {
    if (options.bodyHtml) bodyNode.innerHTML = options.bodyHtml;
    else bodyNode.textContent = options.body || "";
  }
  if (confirmButton) confirmButton.textContent = confirmLabel;
  if (cancelButton) {
    cancelButton.textContent = cancelLabel;
    cancelButton.hidden = kind === "alert" || kind === "result";
  }
  if (inputNode) {
    inputNode.hidden = kind !== "prompt";
    inputNode.value = options.value || "";
    inputNode.placeholder = options.placeholder || "";
  }

  rootNode.hidden = false;
  document.body.dataset.dialogOpen = "true";

  return new Promise((resolve) => {
    let settled = false;
    let backdropReady = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      closeAppDialogNode(rootNode);
      delete document.body.dataset.dialogOpen;
      resolve(value);
    };
    const cleanup = () => {
      confirmButton?.removeEventListener("click", onConfirm);
      cancelButton?.removeEventListener("click", onCancel);
      rootNode.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeyDown);
      activeDialogCleanup = null;
    };
    const onConfirm = () => {
      if (kind === "prompt") {
        finish(inputNode?.value ?? "");
        return;
      }
      finish(true);
    };
    const onCancel = () => {
      finish(kind === "prompt" ? null : false);
    };
    const onBackdrop = (event) => {
      if (!backdropReady) return;
      if (event.target === rootNode && kind !== "alert") onCancel();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && kind !== "alert") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" && kind === "prompt" && document.activeElement === inputNode) {
        event.preventDefault();
        onConfirm();
      }
    };

    activeDialogCleanup = () => finish(kind === "prompt" ? null : false);
    confirmButton?.addEventListener("click", onConfirm);
    cancelButton?.addEventListener("click", onCancel);
    rootNode.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeyDown);

    window.setTimeout(() => {
      backdropReady = true;
      if (kind === "prompt") inputNode?.focus();
      else confirmButton?.focus();
    }, 0);
  });
}

function closeAppDialogNode(rootNode) {
  rootNode.dataset.dialogClosing = "true";
  window.setTimeout(() => {
    if (rootNode.dataset.dialogClosing !== "true") return;
    rootNode.hidden = true;
    delete rootNode.dataset.dialogClosing;
  }, 170);
}

function dialogLabels() {
  return {
    confirm: translate("setup.dialogConfirm") || (settings.lang === "zh" ? "确定" : "Confirm"),
    cancel: translate("setup.dialogCancel") || (settings.lang === "zh" ? "取消" : "Cancel")
  };
}

function showToast(message, status = "info") {
  const region = document.querySelector("[data-toast-region]");
  if (!region || !message) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.dataset.status = status;
  toast.setAttribute("role", status === "fail" ? "alert" : "status");
  toast.textContent = message;
  region.appendChild(toast);
  window.setTimeout(() => {
    toast.dataset.leaving = "true";
    window.setTimeout(() => toast.remove(), 180);
  }, 2800);
}

function hasRenderableApiData(data) {
  return Boolean(data && (Array.isArray(data.checks) || Array.isArray(data.fixes) || data.confirmation || data.copyText || data.planPreview || data.preview || data.job || data.maintenance || data.testResult || isVersionOperationResult(data) || isEvaluationDashboardResult(data) || isTargetedRerunResult(data) || isPackageExportPreviewResult(data)));
}

function apiActionKey(button) {
  return button.dataset.setupApiAction || button.dataset.consoleApiAction || "";
}

function buildApiPayload(actionKey, button = null) {
  const draft = collectDraftFields();
  const mode = settings.mode;
  if (actionKey === "test-job-task") {
    return {
      taskKey: button?.dataset.jobTaskKey || "",
      mode,
      template: settings.template,
      draft
    };
  }
  if (actionKey === "version-rollback-preview") {
    return {
      targetBuildId: button?.dataset.versionBuildId || "",
      mode,
      template: settings.template,
      draft
    };
  }
  if (actionKey === "version-rollback-confirm") {
    return {
      targetBuildId: button?.dataset.versionBuildId || "",
      confirm: true,
      mode,
      template: settings.template,
      draft
    };
  }
  if (actionKey === "targeted-rerun-preview" || actionKey === "targeted-rerun-confirm") {
    return {
      type: button?.dataset.rerunType || "failedBatch",
      documentId: button?.dataset.rerunDocumentId || "",
      relativePath: button?.dataset.rerunRelativePath || "",
      startPage: button?.dataset.rerunStartPage || "",
      endPage: button?.dataset.rerunEndPage || "",
      unit: button?.dataset.rerunUnit || "",
      nodeId: button?.dataset.rerunNodeId || "",
      mode,
      template: settings.template,
      draft
    };
  }
  if (actionKey === "save-aliyun-credentials") {
    const input = credentialInputState();
    return {
      accessKeyId: input.hasCurrentInput ? input.accessKeyId : draft["aliyun.credential.accessKeyId"],
      accessKeySecret: input.hasCurrentInput ? input.accessKeySecret : draft["aliyun.credential.accessKeySecret"],
      saveTarget: draft["aliyun.credential.saveTarget"],
      useSavedCredential: credentialSecretConfigured() && !input.hasCurrentInput,
      mode,
      draft
    };
  }
  return { mode, template: settings.template, draft };
}

function collectDraftFields(options = {}) {
  const includeSensitive = options.includeSensitive !== false;
  const draft = { ...draftState };
  if (!includeSensitive) {
    Object.keys(draft).forEach((key) => {
      if (/secret|token|password/i.test(key)) delete draft[key];
    });
  }
  document.querySelectorAll("[data-draft-field]").forEach((field) => {
    const key = field.dataset.draftField;
    if (!key) return;
    if (key === "aliyun.credential.accessKeyId" && field.dataset.credentialMasked === "true") {
      delete draft[key];
      return;
    }
    if (field.dataset.draftSensitive === "true") {
      if (includeSensitive && field.value) {
        draft[key] = field.value;
      } else {
        delete draft[key];
      }
    } else {
      draft[key] = draftFieldValue(field);
    }
  });
  return draft;
}

function clearSensitiveFields(message) {
  document.querySelectorAll("[data-draft-sensitive=\"true\"]").forEach((field) => {
    field.value = "";
    field.setAttribute("placeholder", message || (settings.lang === "zh" ? "已填写，返回时不显示明文" : "Configured; secret is not shown again"));
  });
}

async function copyTextBestEffort(text) {
  try {
    await navigator.clipboard?.writeText?.(text);
    return true;
  } catch {
    return fallbackCopyText(text);
  }
}

async function copyRemediationPolicy(button) {
  const card = button.closest("[data-remediation-card]");
  const text = card?.querySelector("[data-remediation-policy]")?.textContent || "";
  if (!text.trim()) return;
  const copied = await copyTextBestEffort(text);
  showToast(
    copied
      ? (settings.lang === "zh" ? "权限清单已复制" : "Policy copied")
      : (settings.lang === "zh" ? "没有复制成功，请手动复制。" : "Copy failed. Copy it manually."),
    copied ? "pass" : "warn"
  );
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto 0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function permissionResultUsesCards(actionKey = "", resultNode = null) {
  return actionKey === "check-aliyun-permissions" || actionKey === "copy-aliyun-policy" || Boolean(resultNode?.dataset?.permissionResultStatus);
}

function resetPermissionScopeStatuses(status = "pending") {
  document.querySelectorAll("[data-permission-scope]").forEach((scopeNode) => {
    setPermissionScopeStatus(scopeNode, status);
  });
  refreshSetupContinueState();
}

function refreshPermissionScopeStatusLabels() {
  document.querySelectorAll("[data-permission-scope]").forEach((scopeNode) => {
    const statusNode = scopeNode.querySelector("[data-permission-scope-status]");
    setPermissionScopeStatus(scopeNode, scopeNode.dataset.permissionStatus || statusNode?.dataset.permissionStatus || "pending");
  });
}

function updatePermissionScopeStatuses(data, actionKey = "") {
  if (actionKey !== "check-aliyun-permissions") return;
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const grouped = new Map();
  document.querySelectorAll("[data-permission-scope]").forEach((scopeNode) => {
    grouped.set(scopeNode.dataset.permissionScope, []);
  });

  checks.forEach((item) => {
    permissionScopesForCheck(item.key).forEach((scope) => {
      if (grouped.has(scope)) grouped.get(scope).push(item.status);
    });
  });

  grouped.forEach((statuses, scope) => {
    const scopeNode = document.querySelector(`[data-permission-scope="${cssEscape(scope)}"]`);
    setPermissionScopeStatus(scopeNode, summarizePermissionStatuses(statuses));
  });
}

function permissionScopesForCheck(key = "") {
  if (key === "credential" || key === "identity") return ["identity"];
  if (key === "ramUser") return ["ram"];
  if (key === "ossListBuckets") return ["storage"];
  return [];
}

function summarizePermissionStatuses(statuses = []) {
  if (!statuses.length) return "pending";
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.includes("pass")) return "pass";
  return "pending";
}

function setPermissionScopeStatus(scopeNode, status = "pending") {
  if (!scopeNode) return;
  const normalized = ["pending", "working", "pass", "fail", "warn"].includes(status) ? status : "pending";
  const statusNode = scopeNode.querySelector("[data-permission-scope-status]");
  if (!statusNode) return;
  scopeNode.dataset.permissionStatus = normalized;
  statusNode.dataset.permissionStatus = normalized;
  statusNode.textContent = permissionStatusLabels[settings.lang]?.[normalized] || permissionStatusLabels.zh[normalized];
}

function showApiChecks(resultNode, data, actionKey = "", options = {}) {
  if (!resultNode) return;
  const resultOk = isApiResultClear(data, actionKey);
  const status = resultOk ? "pass" : "fail";
  const message = apiResultStatusLineMessage(data, status, actionKey);
  const contentHtml = renderApiResultContent(data, actionKey, resultNode);
  apiResultState.set(resultNode, { data, actionKey, status, message, contentHtml });
  if (options.persist !== false) writePersistentSetupActionResult(actionKey, data);
  updateBuildResultSummary(actionKey, status, data);
  if (jobResultUsesInline(resultNode, actionKey)) {
    updateJobInlineResult(resultNode, status, contentHtml, data, actionKey);
    if (options.showToast !== false && actionKey !== "latest-job") showToast(apiResultToastMessage(status, actionKey), status);
    refreshSetupContinueState();
    return;
  }
  if (actionKey === "preview-run") {
    updatePlanPreviewResult(resultNode, status, contentHtml, data, actionKey, resultOk);
    if (options.showToast !== false) showToast(apiResultToastMessage(status, actionKey), status);
    refreshSetupContinueState();
    return;
  }
  if (permissionResultUsesCards(actionKey, resultNode)) {
    updatePermissionScopeStatuses(data, actionKey);
    updateApiStatusLine(resultNode, status, message, actionKey, Boolean(contentHtml), resultOk);
    if (options.showToast !== false) showToast(apiResultToastMessage(status, actionKey), status);
    if (options.showDialog === true && contentHtml) showApiResultDialog(resultNode);
    refreshSetupContinueState();
    return;
  }
  if (apiResultUsesInlineDetail(resultNode)) {
    updateApiInlineResult(resultNode, status, contentHtml, resultOk);
    if (options.showToast !== false) showToast(apiResultToastMessage(status, actionKey), status);
    if (options.showDialog === true && contentHtml) showApiResultDialog(resultNode);
    refreshSetupContinueState();
    return;
  }
  updateApiStatusLine(resultNode, status, message, actionKey, Boolean(contentHtml), resultOk);
  if (options.showToast !== false) showToast(apiResultToastMessage(status, actionKey), status);
  if (options.showDialog === true && contentHtml) showApiResultDialog(resultNode);
  refreshSetupContinueState();
}

function jobResultUsesInline(resultNode, actionKey = "") {
  return Boolean(resultNode?.dataset?.apiResult === "latest-job" && isJobConsoleAction(actionKey));
}

function updateJobInlineResult(resultNode, status, contentHtml, data, actionKey = "") {
  if (!resultNode) return;
  const preservedUi = captureJobInlineUiState(resultNode);
  if (actionKey === "latest-job" && !data?.job) {
    currentJobSnapshot = null;
    resultNode.hidden = true;
    resultNode.innerHTML = "";
    resultNode.dataset.apiResultStatus = "empty";
    resultNode.dataset.apiResultClear = "false";
    return;
  }
  resultNode.hidden = false;
  if (data?.job) currentJobSnapshot = data.job;
  resultNode.className = `job-api-result ${status}`;
  resultNode.dataset.apiResultStatus = status;
  resultNode.dataset.apiResultClear = String(Boolean(data?.job));
  resultNode.innerHTML = contentHtml || `<section class="job-empty-result">${escapeHtml(settings.lang === "zh" ? "还没有可展示的任务。" : "No job to show yet.")}</section>`;
  restoreJobInlineUiState(resultNode, preservedUi, data?.job || null);
}

function captureJobInlineUiState(resultNode) {
  if (!resultNode) return null;
  const open = new Set([...resultNode.querySelectorAll("[data-job-disclosure][open]")].map((node) => node.dataset.jobDisclosure).filter(Boolean));
  const logNode = activeJobLogScrollNode(resultNode);
  const nearBottom = !logNode || (logNode.scrollHeight - logNode.clientHeight - logNode.scrollTop) < 24;
  return {
    open,
    selectedStep: activeJobStepKey,
    logScrollTop: logNode?.scrollTop || 0,
    nearBottom,
    lastEventId: currentJobSnapshot?.events?.at?.(-1)?.id || ""
  };
}

function restoreJobInlineUiState(resultNode, state, job) {
  if (!resultNode || !state) return;
  resultNode.querySelectorAll("[data-job-disclosure]").forEach((node) => {
    if (state.open?.has(node.dataset.jobDisclosure)) node.open = true;
  });
  if (state.selectedStep) selectJobStep(state.selectedStep);
  const logNode = activeJobLogScrollNode(resultNode);
  const newCount = countNewJobEvents(job, state.lastEventId);
  if (logNode) {
    if (state.nearBottom) {
      logNode.scrollTop = logNode.scrollHeight;
    } else {
      logNode.scrollTop = state.logScrollTop || 0;
    }
  }
  updateNewJobLogHint(resultNode, state.nearBottom ? 0 : newCount);
}

function activeJobLogScrollNode(rootNode = document) {
  const fullLog = rootNode.querySelector(".job-full-log[open] ol");
  return fullLog || rootNode.querySelector(".job-log-stream > ol");
}

function countNewJobEvents(job, previousLastId = "") {
  const events = Array.isArray(job?.events) ? job.events : [];
  if (!events.length || !previousLastId) return 0;
  const previousIndex = events.findIndex((event) => event.id === previousLastId);
  if (previousIndex < 0) return 0;
  return Math.max(0, events.length - previousIndex - 1);
}

function updateNewJobLogHint(resultNode, count = 0) {
  resultNode.querySelectorAll("[data-job-new-log-hint]").forEach((node) => node.remove());
  if (!count) return;
  const header = resultNode.querySelector(".job-log-stream > header");
  if (!header) return;
  const label = settings.lang === "zh" ? `有 ${count} 条新回显` : `${count} new log line${count === 1 ? "" : "s"}`;
  header.insertAdjacentHTML("beforeend", `<button class="job-new-log-hint" type="button" data-job-new-log-hint data-job-log-jump>${escapeHtml(label)}</button>`);
}

function scrollJobLogToLatest(rootNode = document) {
  const logNode = activeJobLogScrollNode(rootNode);
  if (logNode) logNode.scrollTop = logNode.scrollHeight;
  rootNode.querySelectorAll("[data-job-new-log-hint]").forEach((node) => node.remove());
}
function rerenderVisibleApiResults() {
  document.querySelectorAll("[data-api-result]").forEach((node) => {
    if (node.hidden) return;
    const state = apiResultState.get(node);
    if (!state?.data) return;
    showApiChecks(node, state.data, state.actionKey, { showDialog: false, showToast: false });
    if (isJobConsoleAction(state.actionKey)) {
      refreshJobActionBar(state.data?.job || null, state.data?.job ? "ready" : "empty");
    }
  });
}

function showApiResult(resultNode, status, message, actionKey = "", options = {}) {
  if (!resultNode) return;
  const preserveJobConsole = jobResultUsesInline(resultNode, actionKey) && currentJobSnapshot && status !== "pass";
  const contentHtml = preserveJobConsole
    ? renderJobApiResultContent({ ok: true, job: currentJobSnapshot }, "latest-job")
    : `<section class="api-result-detail ${escapeHtml(status)}"><section class="api-result-message"><strong>${escapeHtml(apiStatusLineLabels(status, actionKey, message).title)}</strong><p>${escapeHtml(message)}</p></section></section>`;
  if (status === "working") clearPersistentSetupActionResult(actionKey);
  apiResultState.set(resultNode, { data: preserveJobConsole ? { ok: true, job: currentJobSnapshot } : { ok: status === "pass" }, actionKey, status, message, contentHtml });
  updateBuildResultSummary(actionKey, status);
  if (actionKey === "preview-run") {
    updatePlanPreviewEmptyState(false);
  }
  if (jobResultUsesInline(resultNode, actionKey)) {
    resultNode.hidden = false;
    resultNode.className = `job-api-result ${status}`;
    resultNode.dataset.apiResultStatus = status;
    resultNode.dataset.apiResultClear = String(status === "pass");
    resultNode.innerHTML = preserveJobConsole
      ? contentHtml
      : `<section class="job-result-detail job-result-detail--message ${escapeHtml(status)}">${contentHtml}</section>`;
    refreshSetupContinueState();
    return;
  }
  if (permissionResultUsesCards(actionKey, resultNode)) {
    if (actionKey === "check-aliyun-permissions") {
      resetPermissionScopeStatuses(status === "working" ? "working" : status);
    }
    updateApiStatusLine(resultNode, status, message, actionKey, status !== "working", status === "pass");
    if (status !== "working" && options.showToast !== false) showToast(apiResultToastMessage(status, actionKey, message), status);
    if (status !== "working" && options.showDialog === true) showApiResultDialog(resultNode);
    refreshSetupContinueState();
    return;
  }
  if (apiResultUsesInlineDetail(resultNode)) {
    updateApiInlineResult(resultNode, status, contentHtml, status === "pass");
    if (status !== "working" && options.showToast !== false) showToast(apiResultToastMessage(status, actionKey, message), status);
    if (status !== "working" && options.showDialog === true) showApiResultDialog(resultNode);
    refreshSetupContinueState();
    return;
  }
  updateApiStatusLine(resultNode, status, message, actionKey, status !== "working", status === "pass");
  if (status !== "working" && options.showToast !== false) showToast(apiResultToastMessage(status, actionKey, message), status);
  if (status !== "working" && options.showDialog === true) showApiResultDialog(resultNode);
  refreshSetupContinueState();
}

function apiResultUsesInlineDetail(resultNode) {
  return resultNode?.dataset?.apiInlineResult === "true";
}

function updateApiInlineResult(resultNode, status, contentHtml, isClear = false) {
  if (!resultNode) return;
  resultNode.hidden = false;
  resultNode.className = `api-result api-result--inline ${status}`;
  resultNode.dataset.apiResultStatus = status;
  resultNode.dataset.apiResultClear = String(Boolean(isClear));
  resultNode.innerHTML = contentHtml;
}

function renderApiResultContent(data, actionKey = "", resultNode = null) {
  if (isJobConsoleAction(actionKey)) {
    return renderJobApiResultContent(data, actionKey);
  }
  if (actionKey === "preview-run") {
    const preview = renderPlanPreview(data.planPreview);
    return `<section class="api-result-detail ${isApiResultClear(data, actionKey) ? "pass" : "fail"}">${preview || `<p>${escapeHtml(settings.lang === "zh" ? "没有可展示的执行计划。" : "No run plan to show.")}</p>`}</section>`;
  }
  if (isQueryFeedbackSummaryResult(data, actionKey)) {
    const feedbackMode = resultNode?.dataset?.queryFeedbackMode || "review";
    const feedbackDetail = renderQueryFeedbackList(data.feedback, feedbackMode);
    return `<section class="api-result-detail ${isApiResultClear(data, actionKey) ? "pass" : "warn"} feedback-result">${feedbackDetail || `<p>${escapeHtml(settings.lang === "zh" ? "还没有反馈记录。" : "No feedback records yet.")}</p>`}</section>`;
  }
  if (isVersionRecordsResult(data, actionKey)) {
    const versionsDetail = renderVersionRecords(data);
    return `<section class="api-result-detail ${isApiResultClear(data, actionKey) ? "pass" : "warn"} version-records-result-detail">${versionsDetail || `<p>${escapeHtml(settings.lang === "zh" ? "还没有版本记录。" : "No version records yet.")}</p>`}</section>`;
  }
  if (isVersionOperationResult(data, actionKey)) {
    const detail = renderVersionOperation(data);
    return `<section class="api-result-detail ${data?.ok === false ? "fail" : "pass"} version-records-result-detail">${detail || `<p>${escapeHtml(settings.lang === "zh" ? "版本操作已完成。" : "Version operation complete.")}</p>`}</section>`;
  }
  if (isEvaluationDashboardResult(data, actionKey)) {
    const detail = renderEvaluationDashboard(data);
    const status = data?.summary?.status === "ready" ? "pass" : "warn";
    return `<section class="api-result-detail ${status} evaluation-dashboard-result-detail">${detail || `<p>${escapeHtml(settings.lang === "zh" ? "还没有评测数据。" : "No evaluation data yet.")}</p>`}</section>`;
  }
  if (isTargetedRerunResult(data, actionKey)) {
    const detail = renderTargetedRerunOperation(data);
    return `<section class="api-result-detail ${data?.ok === false ? "fail" : "pass"} targeted-rerun-result-detail">${detail || `<p>${escapeHtml(settings.lang === "zh" ? "局部重跑操作已完成。" : "Targeted rerun operation complete.")}</p>`}</section>`;
  }
  if (isPackageExportPreviewResult(data, actionKey)) {
    const detail = renderPackageExportPreview(data);
    return `<section class="api-result-detail ${data?.ok === false ? "fail" : "pass"} package-export-result-detail">${detail || `<p>${escapeHtml(settings.lang === "zh" ? "还没有可展示的导出包预览。" : "No package export preview to show.")}</p>`}</section>`;
  }
  if (isMaintenanceStatusResult(null, data, actionKey)) {
    const maintenanceDetail = renderMaintenanceStatus(data.maintenance);
    return `<section class="api-result-detail ${isApiResultClear(data, actionKey) ? "pass" : "fail"} maintenance-result">${maintenanceDetail || `<p>${escapeHtml(settings.lang === "zh" ? "没有可展示的维护状态。" : "No maintenance status to show.")}</p>`}</section>`;
  }
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const preScan = renderPreScanPanel(data, actionKey);
  const findings = renderApiResultFindings(data, actionKey);
  const remediation = checks.map((item) => renderCheckRemediation(item)).filter(Boolean).join("");
  const passed = renderPassedChecks(checks);
  const detail = `${findings}${remediation}${preScan}${renderFixLinks(data.fixes)}${renderCopyText(data.copyText)}${renderConfirmation(data.confirmation)}${renderScanPreview(data.preview)}${renderPlanPreview(data.planPreview)}${renderJobStatus(data.job)}${renderMaintenanceStatus(data.maintenance)}${renderJobTestResult(data.testResult)}${passed}`;
  return `<section class="api-result-detail ${isApiResultClear(data, actionKey) ? "pass" : "fail"}">${detail || `<p>${escapeHtml(data.ok ? (settings.lang === "zh" ? "操作已完成。" : "The action is complete.") : (settings.lang === "zh" ? "操作需要处理。" : "The action needs attention."))}</p>`}</section>`;
}

function isQueryFeedbackSummaryResult(data, actionKey = "") {
  return actionKey === "query-feedback-summary"
    || data?.kind === "knowmesh.queryFeedbackSummary"
    || Boolean(data?.feedback && !data?.maintenance);
}

function isVersionRecordsResult(data, actionKey = "") {
  return actionKey === "version-records" || data?.kind === "knowmesh.versionRecords";
}

function isVersionOperationResult(data, actionKey = "") {
  return actionKey === "version-diff"
    || actionKey === "version-rollback-preview"
    || actionKey === "version-rollback-confirm"
    || data?.kind === "knowmesh.versionDiff"
    || data?.kind === "knowmesh.versionRollbackPreview"
    || data?.kind === "knowmesh.versionRollback";
}

function isEvaluationDashboardResult(data, actionKey = "") {
  return actionKey === "evaluation-dashboard" || data?.kind === "knowmesh.evaluationDashboard";
}

function isTargetedRerunResult(data, actionKey = "") {
  return actionKey === "targeted-rerun-preview"
    || actionKey === "targeted-rerun-confirm"
    || data?.kind === "knowmesh.targetedRerunPreview"
    || data?.kind === "knowmesh.targetedRerunConfirm";
}

function isPackageExportPreviewResult(data, actionKey = "") {
  return actionKey === "package-export-preview" || data?.kind === "knowmesh.packageExportPreview";
}

function renderPackageExportPreview(data) {
  const manifest = data?.packageManifest || {};
  const artifacts = manifest.artifacts || {};
  const artifactSummary = artifacts.summary || {};
  const integrity = manifest.integrity || {};
  const includes = Array.isArray(manifest.contents?.includes) ? manifest.contents.includes : [];
  const excludes = Array.isArray(manifest.privacy?.excludes) ? manifest.privacy.excludes : [];
  const labels = settings.lang === "zh"
    ? {
        title: "导出包预览",
        version: "格式版本",
        knowledgeBase: "知识库",
        artifacts: "Artifact",
        checksum: "Manifest Hash",
        includes: "包含",
        excludes: "排除",
        plan: "执行计划",
        previewOnly: "仅预览"
      }
    : {
        title: "Package Export Preview",
        version: "Format Version",
        knowledgeBase: "Knowledge Base",
        artifacts: "Artifacts",
        checksum: "Manifest Hash",
        includes: "Includes",
        excludes: "Excludes",
        plan: "Execution Plan",
        previewOnly: "Preview Only"
      };
  return `<section class="package-export-panel">
            <header>
              <div>
                <strong>${escapeHtml(labels.title)}</strong>
                <span>${escapeHtml(manifest.packageId || "")}</span>
              </div>
              <b>${escapeHtml(labels.previewOnly)}</b>
            </header>
            <div class="package-export-grid">
              <span><b>${escapeHtml(manifest.formatVersion || "-")}</b><em>${escapeHtml(labels.version)}</em></span>
              <span><b>${escapeHtml(manifest.knowledgeBase?.name || manifest.knowledgeBase?.id || "-")}</b><em>${escapeHtml(labels.knowledgeBase)}</em></span>
              <span><b>${escapeHtml(String(artifactSummary.total || 0))}</b><em>${escapeHtml(labels.artifacts)}</em></span>
              <span><b>${escapeHtml(String(integrity.manifestHash || "").slice(0, 12) || "-")}</b><em>${escapeHtml(labels.checksum)}</em></span>
            </div>
            <div class="package-export-lists">
              <article>
                <strong>${escapeHtml(labels.includes)}</strong>
                <ul>${includes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </article>
              <article>
                <strong>${escapeHtml(labels.excludes)}</strong>
                <ul>${excludes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </article>
            </div>
            <div class="package-export-plan">
              <strong>${escapeHtml(labels.plan)}</strong>
              <span>${escapeHtml(localized(data?.exportPlan?.nextStep) || "")}</span>
            </div>
          </section>`;
}

function renderJobApiResultContent(data, actionKey = "") {
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const needsAttention = actionKey !== "latest-job" && checks.some((item) => item.status === "fail" || item.status === "warn");
  const findings = needsAttention ? renderApiResultFindings(data, actionKey) : "";
  const detail = `${renderJobStatus(data?.job)}${renderJobTestResult(data?.testResult)}${findings}`;
  const fallback = data?.job
    ? ""
    : `<section class="job-empty-result">${escapeHtml(settings.lang === "zh" ? "还没有可展示的任务。" : "No job to show yet.")}</section>`;
  return `<section class="job-result-detail ${isApiResultClear(data, actionKey) ? "pass" : "fail"}">${detail || fallback}</section>`;
}

function updateApiStatusLine(resultNode, status, message, actionKey = "", hasDetails = true, isClear = status === "pass") {
  if (!resultNode) return;
  const labels = apiStatusLineLabels(status, actionKey, message);
  resultNode.hidden = false;
  resultNode.className = `api-result ${status}`;
  resultNode.dataset.apiResultStatus = status;
  resultNode.dataset.apiResultClear = String(Boolean(isClear));
  resultNode.innerHTML = `<span class="api-result-dot" aria-hidden="true"></span>
    <span class="api-result-copy">
      <strong>${escapeHtml(labels.title)}</strong>
      <span>${escapeHtml(labels.message)}</span>
    </span>
    ${hasDetails ? `<button class="api-result-open" type="button" data-api-result-open>${escapeHtml(labels.open)}</button>` : ""}`;
}

function apiStatusLineLabels(status, actionKey = "", message = "") {
  const open = settings.lang === "zh" ? "查看结果" : "View";
  const actionLabel = apiActionLabel(actionKey);
  if (status === "working") {
    return {
      title: settings.lang === "zh" ? "处理中" : "Working",
      message: message || (settings.lang === "zh" ? `${actionLabel}进行中...` : `${actionLabel} is running...`),
      open
    };
  }
  if (status === "pass") {
    return {
      title: settings.lang === "zh" ? "已完成" : "Complete",
      message: message || (settings.lang === "zh" ? `${actionLabel}完成。` : `${actionLabel} complete.`),
      open
    };
  }
  return {
    title: settings.lang === "zh" ? "需要处理" : "Needs attention",
    message: message || (settings.lang === "zh" ? `${actionLabel}需要处理。` : `${actionLabel} needs attention.`),
    open
  };
}

function apiActionLabel(actionKey = "") {
  if (actionKey === "preview-scan") return settings.lang === "zh" ? "扫描资料" : "Scan Sources";
  if (actionKey === "preview-run") return settings.lang === "zh" ? "执行计划" : "Run Plan";
  const button = document.querySelector(`[data-setup-api-action="${cssEscape(actionKey)}"], [data-console-api-action="${cssEscape(actionKey)}"]`);
  const label = button?.textContent?.trim();
  if (label) return label;
  return settings.lang === "zh" ? "操作" : "Action";
}

function apiResultToastMessage(status, actionKey = "", fallback = "") {
  if (fallback && status === "fail") return fallback;
  const label = apiActionLabel(actionKey);
  if (status === "pass") return settings.lang === "zh" ? `${label}完成` : `${label} complete`;
  if (status === "working") return settings.lang === "zh" ? `${label}进行中` : `${label} running`;
  return settings.lang === "zh" ? `${label}需要处理` : `${label} needs attention`;
}

function showApiResultDialog(resultNode, options = {}) {
  if (!resultNode) return;
  const state = apiResultState.get(resultNode);
  if (!state?.contentHtml) return;
  const title = resultDialogTitle(state.status, state.actionKey);
  showAppDialog({
    kind: "result",
    tone: state.status === "fail" ? "danger" : "default",
    title,
    bodyHtml: `<div class="result-dialog-content">${state.contentHtml}</div>`,
    confirmLabel: settings.lang === "zh" ? "知道了" : "Close"
  });
}

function resultDialogTitle(status, actionKey = "") {
  const label = apiActionLabel(actionKey);
  if (status === "pass") return settings.lang === "zh" ? `${label}结果` : `${label} Result`;
  if (status === "working") return settings.lang === "zh" ? `${label}进行中` : `${label} Running`;
  return settings.lang === "zh" ? `${label}需要处理` : `${label} Needs Attention`;
}

function renderApiResultFindings(data, actionKey = "") {
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const visible = checks.filter((item) => item.status !== "pass" && item.status !== "skip");
  const labels = settings.lang === "zh"
    ? {
        readyTitle: "已通过",
        readyBody: "本次检查已通过，可以继续下一步。",
        issueTitle: "需要处理",
        issueBody: "先处理下面的问题，再重新检查。",
        emptyTitle: "没有检查项",
        emptyBody: "本次操作没有返回可展示的检查项。"
      }
    : {
        readyTitle: "Passed",
        readyBody: "This check passed. You can continue.",
        issueTitle: "Needs attention",
        issueBody: "Fix the items below, then check again.",
        emptyTitle: "No checks",
        emptyBody: "This action returned no displayable checks."
      };
  const clear = isApiResultClear(data, actionKey);
  const items = visible.length ? visible : checks.filter((item) => item.status === "pass").slice(0, 3);
  const title = checks.length ? (clear ? labels.readyTitle : labels.issueTitle) : labels.emptyTitle;
  const body = checks.length ? (clear ? labels.readyBody : labels.issueBody) : labels.emptyBody;
  const status = clear ? "pass" : "fail";

  return `<section class="api-result-findings" data-status="${escapeHtml(status)}">
            <header>
              <span class="api-result-state-dot" aria-hidden="true"></span>
              <div>
                <strong>${escapeHtml(title)}</strong>
                <p>${escapeHtml(body)}</p>
              </div>
            </header>
            ${items.length ? `<ul class="api-result-primary-list">${items.map((item) => renderApiCheckItem(item)).join("")}</ul>` : ""}
          </section>`;
}

function renderApiCheckItem(item) {
  return `<li data-status="${escapeHtml(item.status)}">
            <span class="api-result-check-status">${escapeHtml(checkStatusLabel(item.status))}</span>
            <div>
              <strong>${escapeHtml(localized(item.label))}</strong>
              <span>${escapeHtml(localized(item.message))}</span>
            </div>
          </li>`;
}

function renderCheckRemediation(item) {
  const remediation = item?.remediation;
  if (!remediation) return "";
  const title = localized(remediation.title) || (settings.lang === "zh" ? "处理方法" : "How to fix");
  const message = localized(remediation.message) || localized(remediation.summary) || "";
  const actions = Array.isArray(remediation.missingActions) ? remediation.missingActions : [];
  const steps = Array.isArray(remediation.steps) ? remediation.steps : [];
  const diagnostics = item.diagnostics || {};
  const policy = remediation.copyText
    ? `<pre class="api-remediation-policy" data-remediation-policy hidden>${escapeHtml(remediation.copyText)}</pre>`
    : "";
  const copyButton = remediation.copyText
    ? `<button class="secondary-action" type="button" data-copy-remediation-policy>${escapeHtml(localized(remediation.copyLabel) || (settings.lang === "zh" ? "复制权限清单" : "Copy Policy"))}</button>`
    : "";
  const openButton = remediation.consoleUrl
    ? `<a class="secondary-action" href="${escapeHtml(remediation.consoleUrl)}" target="_blank" rel="noreferrer">${escapeHtml(localized(remediation.openLabel) || (settings.lang === "zh" ? "打开控制台" : "Open Console"))}</a>`
    : "";

  return `<section class="api-result-remediation" data-remediation-card data-remediation-type="${escapeHtml(remediation.type || "")}">
            <header>
              <span>${escapeHtml(settings.lang === "zh" ? "建议处理" : "Suggested Fix")}</span>
              <strong>${escapeHtml(title)}</strong>
              ${message ? `<p>${escapeHtml(message)}</p>` : ""}
            </header>
            ${renderRemediationLocation(remediation)}
            ${actions.length ? `<div class="api-remediation-actions"><span>${escapeHtml(settings.lang === "zh" ? "缺少权限" : "Missing actions")}</span><strong>${escapeHtml(actions.join(", "))}</strong></div>` : ""}
            ${steps.length ? `<ol class="api-remediation-steps">${steps.map((step) => `<li>${escapeHtml(localized(step))}</li>`).join("")}</ol>` : ""}
            ${copyButton || openButton ? `<div class="api-remediation-buttons">${copyButton}${openButton}</div>` : ""}
            ${policy}
            ${renderDiagnostics(diagnostics)}
          </section>`;
}

function renderRemediationLocation(remediation = {}) {
  const location = localized(remediation.location);
  if (!location) return "";
  return `<div class="api-remediation-location">
            <span>${escapeHtml(settings.lang === "zh" ? "处理位置" : "Where to fix")}</span>
            <strong>${escapeHtml(location)}</strong>
          </div>`;
}

function renderDiagnostics(diagnostics = {}) {
  const items = [
    ["Status", diagnostics.status],
    ["Code", diagnostics.code],
    ["RequestId", diagnostics.requestId],
    ["Message", diagnostics.message]
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());
  if (!items.length) return "";
  const label = settings.lang === "zh" ? "技术细节" : "Technical details";
  return `<details class="api-result-diagnostics">
            <summary>${escapeHtml(label)}</summary>
            <dl>${items.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
          </details>`;
}

function renderPassedChecks(checks = []) {
  const passed = checks.filter((item) => item.status === "pass");
  if (!passed.length) return "";
  const title = settings.lang === "zh" ? `已通过 ${passed.length} 项` : `${passed.length} passed`;
  return `<details class="api-result-passed-checks">
            <summary>${escapeHtml(title)}</summary>
            <ul>${passed.map((item) => renderApiCheckItem(item)).join("")}</ul>
          </details>`;
}

function checkStatusLabel(status = "") {
  const labels = settings.lang === "zh"
    ? { pass: "已通过", fail: "未通过", warn: "需确认", skip: "已跳过", working: "检查中" }
    : { pass: "Passed", fail: "Failed", warn: "Review", skip: "Skipped", working: "Checking" };
  return labels[status] || labels.warn;
}

function isApiResultClear(data, actionKey = "") {
  if (!data) return false;
  const checks = Array.isArray(data.checks) ? data.checks : [];
  const hasFailedCheck = checks.some((item) => item.status === "fail");
  if (actionKey === "save-aliyun-credentials") {
    return Boolean(data.ok && (data.credential?.configured || data.credential?.verified) && !hasFailedCheck);
  }
  if (actionKey === "check-aliyun-permissions") {
    return Boolean(data.ok && !hasFailedCheck);
  }
  if (actionKey === "preview-aliyun-storage") {
    return Boolean(data.ok && data.storage?.confirmed && !hasFailedCheck);
  }
  if (actionKey === "preview-aliyun-services") {
    return Boolean(data.ok && data.confirmation && !hasFailedCheck);
  }
  if (actionKey === "save-aliyun-model-quality") {
    return Boolean(data.ok && data.modelQuality?.configured && !hasFailedCheck);
  }
  if (actionKey === "save-aliyun-search") {
    return Boolean(data.ok && data.search?.configured && !hasFailedCheck);
  }
  if (actionKey === "test-aliyun-model-provider") {
    return Boolean(data.ok && !hasFailedCheck && (data.confirmation || data.modelProvider?.configured));
  }
  if (actionKey === "preview-scan") {
    const fixes = Array.isArray(data.fixes) ? data.fixes : [];
    const includedFiles = Number(data.preview?.summary?.includedFiles || 0);
    return Boolean(data.ok && fixes.length === 0 && includedFiles > 0);
  }
  if (actionKey === "preview-run") {
    const blockers = Array.isArray(data.planPreview?.blockers) ? data.planPreview.blockers : [];
    return Boolean(data.ok && blockers.length === 0);
  }
  return Boolean(data.ok);
}

function setupRequiredActionPassed(actionKey = "") {
  const resultNode = resultNodeForAction(actionKey);
  if (!resultNode) return false;
  const state = apiResultState.get(resultNode);
  if (state?.data) return isApiResultClear(state.data, actionKey);
  return resultNode.dataset.apiResultClear === "true";
}

function refreshSetupContinueState() {
  document.querySelectorAll("[data-setup-requires-fields]").forEach((button) => {
    const stepKey = button.dataset.setupComplete || "";
    const completed = stepKey ? readSetupCompleted().has(stepKey) : false;
    const passed = completed || missingRequiredSetupFields(stepKey).length === 0;
    button.disabled = !passed;
    button.setAttribute("aria-disabled", String(!passed));
    button.dataset.setupFieldGatePassed = String(passed);
  });

  document.querySelectorAll("[data-setup-requires-passed-action]").forEach((button) => {
    const actionKey = button.dataset.setupRequiresPassedAction || "";
    const stepKey = button.dataset.setupComplete || "";
    const completed = stepKey ? readSetupCompleted().has(stepKey) : false;
    const completedCanPass = completed && setupCompletedCanPassAction(stepKey, actionKey);
    const passed = completedCanPass || setupRequiredActionPassed(actionKey);
    button.disabled = !passed;
    button.setAttribute("aria-disabled", String(!passed));
    button.dataset.setupGatePassed = String(passed);
    document.querySelectorAll(`[data-setup-api-action="${cssEscape(actionKey)}"]`).forEach((actionButton) => {
      actionButton.dataset.setupActionPassed = String(passed);
    });
  });
}

function setupCompletedCanPassAction(stepKey, actionKey) {
  if (stepKey === "plan" || actionKey === "preview-run") return false;
  return true;
}

function readPersistentSetupResults() {
  return { ...setupActionResults };
}

function writePersistentSetupResults(results) {
  Object.keys(setupActionResults).forEach((key) => delete setupActionResults[key]);
  Object.assign(setupActionResults, results && typeof results === "object" && !Array.isArray(results) ? results : {});
}

function clearPersistentSetupActionResult(actionKey) {
  if (!persistentSetupActionKeys.has(actionKey)) return;
  const results = readPersistentSetupResults();
  let changed = Boolean(results[actionKey]);
  delete results[actionKey];
  if (actionKey === "preview-scan" && results["preview-run"]) {
    delete results["preview-run"];
    changed = true;
    updateBuildResultSummary("preview-run", "pending");
  }
  if (changed) {
    writePersistentSetupResults(results);
    updateBuildResultSummary(actionKey, "pending");
  }
}

function clearPersistentSetupActionResults() {
  const results = readPersistentSetupResults();
  let changed = false;
  persistentSetupActionKeys.forEach((actionKey) => {
    if (results[actionKey]) {
      delete results[actionKey];
      changed = true;
    }
    updateBuildResultSummary(actionKey, "pending");
  });
  if (changed) writePersistentSetupResults(results);
}

function writePersistentSetupActionResult(actionKey, data) {
  if (!persistentSetupActionKeys.has(actionKey) || !data) return;
  if (actionKey === "preview-scan") clearPersistentSetupActionResult("preview-run");
  const results = readPersistentSetupResults();
  results[actionKey] = {
    actionKey,
    fingerprint: persistentSetupActionFingerprint(actionKey),
    savedAt: new Date().toISOString(),
    clear: isApiResultClear(data, actionKey),
    data
  };
  writePersistentSetupResults(results);
}

function restorePersistentSetupActionResult(actionKey = requiredSetupActionForStep(pageState.activeSetupStep)) {
  if (!persistentSetupActionKeys.has(actionKey)) return false;
  const resultNode = resultNodeForAction(actionKey);
  if (!resultNode) return false;
  const results = readPersistentSetupResults();
  const entry = results[actionKey];
  if (!entry?.data || entry.fingerprint !== persistentSetupActionFingerprint(actionKey)) {
    clearPersistentSetupActionResult(actionKey);
    return false;
  }
  showApiChecks(resultNode, entry.data, actionKey, { showDialog: false, showToast: false, persist: false });
  return true;
}

function restorePersistentBuildResults() {
  if (pageState.pageType !== "console" || pageState.active !== "build") return;
  restorePersistentSetupActionResult("preview-scan");
  restorePersistentSetupActionResult("preview-run");
  refreshBuildWorkflowState();
}

function setBuildResultState(actionKey, status, data) {
  const resultNode = resultNodeForAction(actionKey);
  if (resultNode) {
    apiResultState.set(resultNode, {
      data,
      actionKey,
      status,
      message: "",
      contentHtml: ""
    });
    resultNode.dataset.apiResultStatus = status;
    resultNode.dataset.apiResultClear = String(isApiResultClear(data, actionKey));
    resultNode.hidden = true;
    resultNode.innerHTML = "";
  }
  updateBuildResultSummary(actionKey, status, data);
}

function refreshBuildWorkflowState() {
  if (pageState.pageType !== "console" || pageState.active !== "build") return;
  ["preview-scan", "preview-run"].forEach((actionKey) => {
    const resultNode = resultNodeForAction(actionKey);
    const state = resultNode ? apiResultState.get(resultNode) : null;
    if (state?.data && !resultNode.hidden) {
      updateBuildResultSummary(actionKey, state.status, state.data);
      return;
    }
    updateBuildResultSummary(actionKey, "pending");
  });
  updateBuildActionGates();
}

function updateBuildResultSummary(actionKey = "", status = "pending", data = null) {
  if (pageState.pageType !== "console" || pageState.active !== "build") return;
  if (actionKey !== "preview-scan" && actionKey !== "preview-run") return;
  const summaryNode = document.querySelector(`[data-build-result-summary="${cssEscape(actionKey)}"]`);
  const actionButton = document.querySelector(`[data-build-action="${cssEscape(actionKey)}"]`);
  const openButton = document.querySelector(`[data-build-open-result="${cssEscape(actionKey)}"]`);
  const createJobButton = document.querySelector("[data-build-create-job]");
  const prefix = actionKey === "preview-scan" ? "scan" : "plan";
  const normalized = status === "pass" ? "pass" : status === "fail" ? "fail" : status === "working" ? "working" : "pending";
  const textState = normalized === "pass" ? "Done" : normalized === "fail" ? "Issue" : normalized === "working" ? "Working" : "Pending";
  const title = normalized === "working"
    ? (settings.lang === "zh" ? "正在处理" : "Working")
    : translate(`console.buildWorkflow.${prefix}${textState}Title`);
  const body = normalized === "working"
    ? (settings.lang === "zh" ? "请稍等，完成后会保留本次结果。" : "Please wait. The result will be kept when complete.")
    : translate(`console.buildWorkflow.${prefix}${textState}Body`);

  if (summaryNode) {
    summaryNode.dataset.status = normalized;
    const titleNode = summaryNode.querySelector("[data-build-result-title]");
    const bodyNode = summaryNode.querySelector("[data-build-result-body]");
    if (titleNode && title) titleNode.textContent = title;
    if (bodyNode && body) bodyNode.textContent = body;
  }

  if (actionButton) {
    const hasResult = normalized === "pass" || normalized === "fail";
    const label = hasResult
      ? (settings.lang === "zh" ? actionButton.dataset.labelRerunZh : actionButton.dataset.labelRerunEn)
      : (settings.lang === "zh" ? actionButton.dataset.labelInitialZh : actionButton.dataset.labelInitialEn);
    if (label) actionButton.textContent = label;
    actionButton.classList.toggle("primary-action", !hasResult);
    actionButton.classList.toggle("secondary-action", hasResult);
  }

  if (openButton) {
    const hasResult = (normalized === "pass" || normalized === "fail") && Boolean(data || apiResultState.get(resultNodeForAction(actionKey))?.data);
    openButton.hidden = !hasResult;
    const label = translate(`console.buildWorkflow.${prefix}Open`);
    if (label) openButton.textContent = label;
  }

  if (actionKey === "preview-run" && createJobButton) {
    const resultData = data || apiResultState.get(resultNodeForAction(actionKey))?.data;
    const canCreate = normalized === "pass" && isApiResultClear(resultData, "preview-run");
    createJobButton.hidden = !canCreate;
    createJobButton.disabled = !canCreate;
    createJobButton.setAttribute("aria-disabled", String(!canCreate));
  }
  updateBuildActionGates();
}

function updateBuildActionGates() {
  if (pageState.pageType !== "console" || pageState.active !== "build") return;
  const scanPassed = setupRequiredActionPassed("preview-scan");
  const planPassed = setupRequiredActionPassed("preview-run");
  const planButton = document.querySelector('[data-build-action="preview-run"]');
  const createJobButton = document.querySelector("[data-build-create-job]");

  if (planButton) {
    planButton.disabled = !scanPassed;
    planButton.setAttribute("aria-disabled", String(!scanPassed));
  }
  if (createJobButton && createJobButton.hidden) {
    createJobButton.disabled = !planPassed;
    createJobButton.setAttribute("aria-disabled", String(!planPassed));
  }
}

function persistentSetupActionFingerprint(actionKey) {
  const dependency = actionKey === "preview-run" ? persistentSetupActionDependency("preview-scan") : "";
  return stableJson({
    actionKey,
    mode: settings.mode,
    template: settings.template,
    dependency,
    draft: sanitizePersistentDraftSnapshot(collectDraftFields({ includeSensitive: false }))
  });
}

function persistentSetupActionDependency(actionKey) {
  const entry = readPersistentSetupResults()[actionKey];
  if (!entry) return "";
  return stableJson({
    actionKey,
    fingerprint: entry.fingerprint || "",
    savedAt: entry.savedAt || "",
    clear: Boolean(entry.clear)
  });
}

function sanitizePersistentDraftSnapshot(draft) {
  const snapshot = {};
  Object.keys(draft || {}).sort().forEach((key) => {
    if (/secret|token|password|apiKey/i.test(key)) return;
    if (/\.pending$/i.test(key)) return;
    const value = draft[key];
    if (value === undefined) return;
    snapshot[key] = value;
  });
  return snapshot;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resetCurrentSetupActionResult() {
  if (pageState.pageType !== "setup" || !pageState.activeSetupStep) return;
  const actionKey = requiredSetupActionForStep(pageState.activeSetupStep);
  if (!actionKey) return;
  const resultNode = resultNodeForAction(actionKey);
  if (!resultNode) return;
  clearPersistentSetupActionResult(actionKey);
  apiResultState.delete(resultNode);
  delete resultNode.dataset.apiResultStatus;
  delete resultNode.dataset.apiResultClear;
  resultNode.hidden = true;
  resultNode.innerHTML = "";
  if (actionKey === "preview-run") updatePlanPreviewEmptyState(true);
  if (actionKey === "check-aliyun-permissions") resetPermissionScopeStatuses("pending");
  refreshSetupContinueState();
}

function resultNodeForAction(actionKey) {
  const action = draftPanelAction(actionKey);
  const actionButton = document.querySelector(`[data-setup-api-action="${cssEscape(actionKey)}"], [data-console-api-action="${cssEscape(actionKey)}"]`);
  const resultKey = actionButton?.dataset.apiResultKey || action?.resultKey || actionKey;
  return document.querySelector(`[data-api-result="${cssEscape(resultKey)}"]`);
}

function showSetupGateMessage(resultNode, status, actionKey, reason) {
  if (!resultNode) return;
  const isPlanGate = actionKey === "preview-run";
  const labels = settings.lang === "zh"
    ? {
        title: reason === "missingAction" ? "还不能继续" : (isPlanGate ? "先生成本次计划" : "先处理后再继续"),
        message: reason === "missingAction"
          ? "本页缺少必要检查入口，请回到上一步后重新进入。"
          : isPlanGate
            ? "本页需要先生成一次通过的计划。没有红色问题时，继续按钮才会打开。"
            : "当前步骤还没有通过。按下方提示处理后，再点击继续。",
        retry: isPlanGate ? "生成计划" : "重新检查"
      }
    : {
        title: reason === "missingAction" ? "Cannot continue yet" : (isPlanGate ? "Generate the plan first" : "Fix before continuing"),
        message: reason === "missingAction"
          ? "This page is missing the required check entry. Go back and open it again."
          : isPlanGate
            ? "Generate a passing plan on this page first. Continue unlocks when there are no red issues."
            : "This step has not passed yet. Follow the guidance below, then continue again.",
        retry: isPlanGate ? "Generate Plan" : "Recheck"
      };
  const retryAction = requiredSetupActionForStep(pageState.activeSetupStep) || actionKey;
  const retry = retryAction
    ? `<button class="secondary-action setup-gate-retry" type="button" data-rerun-setup-action="${escapeHtml(retryAction)}">${escapeHtml(labels.retry)}</button>`
    : "";
  const contentHtml = `<section class="api-result-detail ${escapeHtml(status)}"><section class="setup-gate-message" data-setup-gate-message>
    <div><strong>${escapeHtml(labels.title)}</strong><p>${escapeHtml(labels.message)}</p></div>
    ${retry}
  </section></section>`;
  apiResultState.set(resultNode, {
    data: { ok: false },
    actionKey,
    status,
    message: labels.title,
    contentHtml
  });
  updateApiStatusLine(resultNode, status, labels.title, actionKey, true);
  showToast(apiResultToastMessage(status, actionKey, labels.title), status);
  refreshSetupContinueState();
}

function showRequiredFieldsMessage(stepKey, status, missingFields = []) {
  const actionKey = requiredSetupActionForStep(stepKey);
  const resultNode = actionKey
    ? resultNodeForAction(actionKey)
    : document.querySelector(`[data-api-result="field-gate-${cssEscape(stepKey)}"]`);
  if (!resultNode) return;
  const missingLabels = missingFields
    .map((key) => localized(draftField(key)?.label) || key)
    .filter(Boolean);
  const message = status === "pass"
    ? (settings.lang === "zh" ? "本步已确认，可以继续。" : "This step is confirmed. You can continue.")
    : settings.lang === "zh"
      ? `先完成本页必填项：${missingLabels.join("、")}。`
      : `Complete the required field: ${missingLabels.join(", ")}.`;
  showApiResult(resultNode, status, message, actionKey || `field-gate-${stepKey}`);
}

function renderConfirmation(confirmation, options = {}) {
  if (!confirmation) return "";
  const summary = Array.isArray(confirmation.summary) ? confirmation.summary : [];
  const impacts = Array.isArray(confirmation.impacts) ? confirmation.impacts : [];
  const title = localized(confirmation.title) || (settings.lang === "zh" ? "确认信息" : "Confirmation");
  const note = options.note === false
    ? ""
    : options.note || (settings.lang === "zh" ? "当前只是确认预览，不会直接执行。" : "This is only a confirmation preview. Nothing is executed directly.");

  return `<section class="confirmation-preview">
            <h3>${escapeHtml(title)}</h3>
            ${renderConfirmationList(summary, "summary")}
            ${renderConfirmationList(impacts, "impacts")}
            ${note ? `<p class="confirmation-note">${escapeHtml(note)}</p>` : ""}
          </section>`;
}

function renderFixLinks(fixes) {
  const items = Array.isArray(fixes) ? fixes : [];
  if (!items.length) return "";
  const labels = settings.lang === "zh"
    ? { title: "需要先处理", action: "去处理" }
    : { title: "Needs Attention", action: "Fix" };
  return `<div class="run-blockers api-fix-links">
            <strong>${escapeHtml(labels.title)}</strong>
            <ul class="api-fix-card-list">${items.map((item) => {
              const href = item.step || item.href || "#";
              const external = /^https?:\/\//i.test(href);
              const action = localized(item.action) || labels.action;
              const target = external ? ` target="_blank" rel="noreferrer"` : "";
              const samePage = !external && href === window.location.pathname;
              const rerunAction = samePage ? requiredSetupActionForStep(pageState.activeSetupStep) : "";
              const control = rerunAction
                ? `<button class="secondary-action fix-card-action" type="button" data-rerun-setup-action="${escapeHtml(rerunAction)}">${escapeHtml(action)}</button>`
                : `<a class="fix-card-action" href="${escapeHtml(href)}"${target}>${escapeHtml(action)}</a>`;
              return `<li class="api-fix-card">
                <div>
                  <strong>${escapeHtml(localized(item.label) || labels.title)}</strong>
                  <span>${escapeHtml(localized(item.message))}</span>
                </div>
                ${control}
              </li>`;
            }).join("")}</ul>
          </div>`;
}

function renderCopyText(copyText) {
  if (!copyText) return "";
  const label = settings.lang === "zh" ? "可复制权限清单" : "Copyable Policy";
  return `<section class="copy-text-preview">
            <h3>${escapeHtml(label)}</h3>
            <pre>${escapeHtml(copyText)}</pre>
          </section>`;
}

function renderConfirmationList(items, kind) {
  if (!items.length) return "";
  return `<dl data-confirmation-list="${escapeHtml(kind)}">${items.map((item) => {
    return `<div><dt>${escapeHtml(localized(item.label))}</dt><dd>${escapeHtml(localized(item.value))}</dd></div>`;
  }).join("")}</dl>`;
}

function renderScanPreview(preview) {
  if (!preview) return "";
  const summary = preview.summary || {};
  const documents = Array.isArray(preview.documents) ? preview.documents : [];
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const missingFields = Array.isArray(preview.missingFields) ? preview.missingFields : [];
  const issueGroups = Array.isArray(preview.issueGroups) ? preview.issueGroups : [];
  const processingGroups = Array.isArray(preview.processingGroups) ? preview.processingGroups : [];
  const labels = settings.lang === "zh"
    ? {
        title: "扫描预览",
        subtitle: "先确认能不能继续，再看需要处理的问题和文件处理方式。",
        readyTitle: "可以继续",
        readyBody: "这批资料已通过扫描预览，可以进入开始前确认。",
        reviewTitle: "可以继续，有提醒",
        reviewBody: "这批资料可以进入下一步，但建议先看一下提醒项。",
        issueTitle: "需要先处理",
        issueBody: "处理下面的问题后，再重新生成扫描预览。",
        scope: "资料范围",
        processing: "处理方式",
        issues: "问题清单",
        samples: "资料样例",
        included: "纳入文件",
        documents: "逻辑资料",
        split: "分卷资料",
        excluded: "范围外资料",
        source: "资料目录",
        selectedScope: "本次范围",
        missing: "缺少必填项",
        missingEmpty: "资料范围已满足。",
        issueEmpty: "暂时没有发现阻塞问题。",
        empty: "没有可预览的资料。",
        warnings: "需要注意",
        action: "去处理",
        passed: "已就绪",
        showPassed: "查看已通过项目",
        handlingHint: "这些分类决定后续是本机读取、格式转换，还是在正式执行时做 OCR。",
        sampleHint: "只展示部分样例，用来确认这批资料是否选对。"
      }
    : {
        title: "Scan Preview",
        subtitle: "Check whether you can continue, then review issues and handling groups.",
        readyTitle: "Ready to continue",
        readyBody: "These sources passed the scan preview and can move to run preview.",
        reviewTitle: "Ready with notes",
        reviewBody: "You can continue, but review these notes first.",
        issueTitle: "Needs attention",
        issueBody: "Fix the items below, then generate the scan preview again.",
        scope: "Source Scope",
        processing: "Handling",
        issues: "Issues",
        samples: "Source Samples",
        included: "Included Files",
        documents: "Documents",
        split: "Split Sources",
        excluded: "Out of Scope",
        source: "Source Folder",
        selectedScope: "Selected Scope",
        missing: "Missing fields",
        missingEmpty: "Source scope is complete.",
        issueEmpty: "No blocking issue was found.",
        empty: "No sources to preview.",
        warnings: "Needs Attention",
        action: "Fix",
        passed: "Ready",
        showPassed: "View passed items",
        handlingHint: "These groups decide whether sources are read locally, converted, or held for text recognition confirmation.",
        sampleHint: "Only a few examples are shown so you can confirm the selected folder is right."
      };
  const hasBlockingIssues = issueGroups.some((group) => group.status === "fail") || missingFields.length > 0;
  const hasReviewItems = issueGroups.some((group) => group.status === "warn") || warnings.length > 0;
  const scanStatus = hasBlockingIssues ? "fail" : (hasReviewItems ? "warn" : "pass");
  const verdictTitle = hasBlockingIssues ? labels.issueTitle : (hasReviewItems ? labels.reviewTitle : labels.readyTitle);
  const verdictBody = hasBlockingIssues ? labels.issueBody : (hasReviewItems ? labels.reviewBody : labels.readyBody);
  const issueBody = hasBlockingIssues ? labels.issueBody : (hasReviewItems ? labels.reviewBody : labels.issueEmpty);
  const scopeFilter = summary.scopeFilter || null;
  const selectedScope = formatScanSelectedScope(scopeFilter);

  return `<section class="scan-preview">
            <header class="scan-preview-head">
              <h3>${escapeHtml(labels.title)}</h3>
              <p>${escapeHtml(labels.subtitle)}</p>
            </header>
            <div class="scan-result-stack">
              <section class="scan-result-summary" data-status="${escapeHtml(scanStatus)}">
                <div class="scan-result-verdict">
                  <span class="api-result-state-dot" aria-hidden="true"></span>
                  <div>
                    <strong>${escapeHtml(verdictTitle)}</strong>
                    <p>${escapeHtml(verdictBody)}</p>
                  </div>
                </div>
                <dl class="scan-summary-strip">
                  <div><dt>${escapeHtml(labels.included)}</dt><dd>${escapeHtml(summary.includedFiles ?? 0)}</dd></div>
                  <div><dt>${escapeHtml(labels.documents)}</dt><dd>${escapeHtml(summary.logicalDocuments ?? 0)}</dd></div>
                  <div><dt>${escapeHtml(labels.split)}</dt><dd>${escapeHtml(summary.splitPdfGroups ?? 0)}</dd></div>
                  ${scopeFilter?.enabled ? `<div><dt>${escapeHtml(labels.excluded)}</dt><dd>${escapeHtml(scopeFilter.excludedDocuments ?? 0)}</dd></div>` : ""}
                </dl>
              </section>
              <section class="scan-result-section scan-result-section--issues" data-status="${escapeHtml(scanStatus)}">
                <header>
                  <strong>${escapeHtml(labels.issues)}</strong>
                  <p>${escapeHtml(issueBody)}</p>
                </header>
                ${issueGroups.length ? renderScanIssueGroups(issueGroups, labels) : renderScanIssues(missingFields, warnings, labels)}
              </section>
              <section class="scan-result-section">
                <header>
                  <strong>${escapeHtml(labels.processing)}</strong>
                  <p>${escapeHtml(labels.handlingHint)}</p>
                </header>
                ${renderScanProcessingGroups(processingGroups)}
              </section>
              <section class="scan-result-section scan-result-section--source">
                <header>
                  <strong>${escapeHtml(labels.scope)}</strong>
                </header>
                <p class="scan-source"><span>${escapeHtml(labels.source)}</span><em>${escapeHtml(summary.sourceRoot || "")}</em></p>
                ${selectedScope ? `<p class="scan-source"><span>${escapeHtml(labels.selectedScope)}</span><em>${escapeHtml(selectedScope)}</em></p>` : ""}
              </section>
              <section class="scan-result-section">
                <header>
                  <strong>${escapeHtml(labels.samples)}</strong>
                  <p>${escapeHtml(labels.sampleHint)}</p>
                </header>
                ${documents.length ? `<ul class="scan-document-list">${documents.map((document) => {
                  return `<li><strong>${escapeHtml(document.title)}</strong><span>${escapeHtml(document.relativePath)} · ${escapeHtml(document.sourceType)}</span></li>`;
                }).join("")}</ul>` : `<p>${escapeHtml(labels.empty)}</p>`}
              </section>
            </div>
          </section>`;
}

function updatePlanPreviewResult(resultNode, status, contentHtml, data, actionKey, resultOk) {
  resultNode.hidden = false;
  resultNode.className = `api-result plan-preview-result ${status}`;
  resultNode.dataset.apiResultStatus = status;
  resultNode.dataset.apiResultClear = String(Boolean(resultOk));
  resultNode.innerHTML = contentHtml;
  updatePlanPreviewEmptyState(false);
  apiResultState.set(resultNode, {
    data,
    actionKey,
    status,
    message: apiResultStatusLineMessage(data, status, actionKey),
    contentHtml
  });
}

function updatePlanPreviewEmptyState(show) {
  document.querySelectorAll("[data-plan-preview-empty]").forEach((node) => {
    node.hidden = !show;
  });
}

function formatScanSelectedScope(scopeFilter) {
  if (!scopeFilter?.enabled) return "";
  const selected = scopeFilter.selected || {};
  const labels = settings.lang === "zh"
    ? { stage: "学段", subject: "学科", grade: "年级", volume: "册别", publisher: "出版社", edition: "版本" }
    : { stage: "Stage", subject: "Subject", grade: "Grade", volume: "Volume", publisher: "Publisher", edition: "Edition" };
  const joiner = settings.lang === "zh" ? "、" : ", ";
  return ["stage", "subject", "grade", "volume", "publisher", "edition"]
    .map((key) => {
      const values = Array.isArray(selected[key]) ? selected[key].filter(Boolean) : [];
      if (!values.length) return "";
      return `${labels[key]} ${values.join(joiner)}`;
    })
    .filter(Boolean)
    .join(" / ");
}

function renderScanProcessingGroups(groups) {
  const labels = settings.lang === "zh"
    ? { empty: "没有可处理文件。" }
    : { empty: "No processable files." };
  if (!groups.length) return `<p class="scan-empty-state">${escapeHtml(labels.empty)}</p>`;
  return `<div class="scan-processing-list">${groups.map((group) => {
    const types = Array.isArray(group.types) ? group.types : [];
    return `<article class="scan-processing-card" data-processing="${escapeHtml(group.key || "direct")}">
              <span>${escapeHtml(group.count ?? 0)}</span>
              <div>
                <strong>${escapeHtml(localized(group.label) || group.key)}</strong>
                <p>${escapeHtml(localized(group.message))}</p>
                ${types.length ? `<em>${escapeHtml(types.map((item) => `${item.type} ${item.count}`).join(" / "))}</em>` : ""}
              </div>
            </article>`;
  }).join("")}</div>`;
}

function renderScanIssueGroups(groups, labels) {
  const actionable = groups.filter((group) => group.status === "fail" || group.status === "warn");
  const passed = groups.filter((group) => group.status !== "fail" && group.status !== "warn");
  const primary = actionable.length ? actionable : [];
  return `<div class="scan-issue-groups">
    ${primary.length ? primary.map((group) => renderScanIssueGroup(group, labels)).join("") : `<p class="scan-empty-state">${escapeHtml(labels.issueEmpty)}</p>`}
    ${passed.length ? `<details class="scan-issue-passed">
      <summary>${escapeHtml(labels.showPassed)} · ${escapeHtml(passed.length)}</summary>
      <div>${passed.map((group) => renderScanIssueGroup(group, labels)).join("")}</div>
    </details>` : ""}
  </div>`;
}

function renderScanIssueGroup(group, labels) {
    const items = Array.isArray(group.items) ? group.items : [];
    return `<article class="scan-issue-group" data-status="${escapeHtml(group.status || "pass")}">
              <header>
                <span>${escapeHtml(scanStatusLabel(group.status))}</span>
                <strong>${escapeHtml(localized(group.title))}</strong>
                <p>${escapeHtml(localized(group.description))}</p>
              </header>
              ${items.length ? `<ul>${items.map((item) => renderScanIssueGroupItem(item, labels)).join("")}</ul>` : ""}
            </article>`;
}

function renderScanIssueGroupItem(item, labels) {
  const href = item.href || "";
  const action = localized(item.action) || labels.action;
  const control = href ? `<a href="${escapeHtml(href)}">${escapeHtml(action)}</a>` : "";
  return `<li data-status="${escapeHtml(item.status || "pass")}">
            <div>
              <strong>${escapeHtml(localized(item.label))}</strong>
              <span>${escapeHtml(localized(item.message))}</span>
            </div>
            ${control}
          </li>`;
}

function scanStatusLabel(status) {
  const labels = settings.lang === "zh"
    ? { fail: "必须处理", warn: "建议检查", pass: "已就绪", skip: "已跳过" }
    : { fail: "Must fix", warn: "Review", pass: "Ready", skip: "Skipped" };
  return labels[status] || labels.pass;
}

function renderScanIssues(missingFields, warnings, labels) {
  const missingItems = missingFields.map((field) => {
    const label = localized(field.label) || field.key;
    return `<li data-status="warn"><strong>${escapeHtml(labels.missing)}</strong><span>${escapeHtml(label)}</span></li>`;
  });
  const warningItems = warnings.map((warning) => {
    return `<li data-status="warn"><strong>${escapeHtml(labels.warnings)}</strong><span>${escapeHtml(localized(warning.message) || warning.code || warning)}</span></li>`;
  });
  const items = [...missingItems, ...warningItems];
  if (!items.length) {
    return `<p class="scan-empty-state">${escapeHtml(labels.issueEmpty)}</p>`;
  }
  return `<ul class="scan-issue-list">${items.join("")}</ul>`;
}

function renderPreScanPanel(data, actionKey) {
  if (actionKey !== "check-environment" || !data.preScan) return "";
  const groups = Array.isArray(data.preScan.groups) ? data.preScan.groups : [];
  if (!groups.length) return "";
  const checksByKey = new Map((Array.isArray(data.checks) ? data.checks : []).map((item) => [item.key, item]));
  const summary = data.preScan.summary || {};
  const labels = settings.lang === "zh"
    ? {
        title: "检查结果",
        pass: "通过",
        warn: "提醒",
        fail: "需处理",
        skip: "跳过",
        status: {
          pass: "已就绪",
          warn: "有提醒",
          fail: "需处理",
          skip: "已跳过"
        }
      }
    : {
        title: "Check Results",
        pass: "Pass",
        warn: "Warn",
        fail: "Fix",
        skip: "Skip",
        status: {
          pass: "Ready",
          warn: "Warnings",
          fail: "Needs attention",
          skip: "Skipped"
        }
      };

  return `<section class="readiness-panel">
            <header>
              <strong>${escapeHtml(labels.title)}</strong>
              <div class="readiness-summary">
                <span><b>${escapeHtml(summary.pass ?? 0)}</b><em>${escapeHtml(labels.pass)}</em></span>
                <span><b>${escapeHtml(summary.warn ?? 0)}</b><em>${escapeHtml(labels.warn)}</em></span>
                <span><b>${escapeHtml(summary.fail ?? 0)}</b><em>${escapeHtml(labels.fail)}</em></span>
                <span><b>${escapeHtml(summary.skip ?? 0)}</b><em>${escapeHtml(labels.skip)}</em></span>
              </div>
            </header>
            <div class="readiness-group-list">
              ${groups.map((group) => renderPreScanGroup(group, checksByKey, labels)).join("")}
            </div>
          </section>`;
}

function renderPreScanGroup(group, checksByKey, labels) {
  const checks = (group.checks || []).map((key) => checksByKey.get(key)).filter(Boolean);
  return `<article class="readiness-group" data-status="${escapeHtml(group.status)}">
            <div>
              <span>${escapeHtml(labels.status[group.status] || group.status)}</span>
              <strong>${escapeHtml(localized(group.title))}</strong>
              <p>${escapeHtml(localized(group.description))}</p>
            </div>
            <ul>${checks.map((item) => {
              return `<li data-status="${escapeHtml(item.status)}"><span>${escapeHtml(localized(item.label))}</span><em>${escapeHtml(localized(item.message))}</em></li>`;
            }).join("")}</ul>
          </article>`;
}

function renderPlanPreview(preview) {
  if (!preview) return "";
  const summary = preview.summary || {};
  const blockers = Array.isArray(preview.blockers) ? preview.blockers : [];
  const gates = Array.isArray(preview.gates) ? preview.gates : [];
  const executionPlan = preview.executionPlan;
  const hasBlockers = blockers.length > 0;
  const hasCloudActions = Number(summary.cloudActions || 0) > 0;
  const showInlineConfirm = !(pageState.pageType === "console" && pageState.active === "build");
  const labels = settings.lang === "zh"
    ? {
        title: "本次执行计划",
        readyTitle: "可以继续",
        readyBody: "当前没有必须先处理的问题。创建任务后，KnowMesh 会按执行流程连续推进。",
        blockedTitle: "还有必须先处理的问题",
        blockedBody: "处理下面的红色问题后，再重新生成本次计划。",
        files: "纳入文件",
        documents: "资料",
        local: "本地动作",
        cloud: "云端动作",
        blocked: "阻塞项",
        blockers: "需要先处理",
        plan: "处理路线",
        boundaries: "执行前会再次确认",
        localBoundaryTitle: "本地执行边界",
        localBoundaryBody: "本地模式只写入工作目录，不上传资料，也不会产生云端模型费用。",
        cloudBoundaryTitle: "阿里云模式会按流程执行",
        cloudBoundaryBody: "上传、OCR、生成检索数据和写入知识库都属于同一个任务流程。",
        fix: "去处理",
        confirm: "确认并创建任务",
        confirmNote: "创建后进入任务页，按执行流程连续推进。"
      }
    : {
        title: "Run Plan",
        readyTitle: "Ready to continue",
        readyBody: "There are no required issues to fix now. After creating a job, KnowMesh runs the flow continuously.",
        blockedTitle: "Fix these first",
        blockedBody: "Resolve the red issues below, then generate the plan again.",
        files: "Files",
        documents: "Sources",
        local: "Local Actions",
        cloud: "Cloud Actions",
        blocked: "Blockers",
        blockers: "Needs Attention",
        plan: "Processing Route",
        boundaries: "Confirmed Again Before Running",
        localBoundaryTitle: "Local Run Boundary",
        localBoundaryBody: "Local mode only writes to the work folder. It does not upload sources or create cloud model costs.",
        cloudBoundaryTitle: "Aliyun mode runs as part of the same flow",
        cloudBoundaryBody: "Upload, OCR, search-data creation, and knowledge-base writes are part of the same job flow.",
        fix: "Fix",
        confirm: "Confirm Knowledge-base Job",
        confirmNote: "After creation, open the task page and run the flow continuously."
      };

  return `<section class="run-preview">
            <header class="run-preview-head" data-status="${hasBlockers ? "fail" : "pass"}">
              <span class="api-result-state-dot" aria-hidden="true"></span>
              <div>
                <h3>${escapeHtml(labels.title)}</h3>
                <strong>${escapeHtml(hasBlockers ? labels.blockedTitle : labels.readyTitle)}</strong>
                <p>${escapeHtml(hasBlockers ? labels.blockedBody : labels.readyBody)}</p>
              </div>
            </header>
            <div class="run-stats">
              <span><b>${escapeHtml(summary.includedFiles ?? 0)}</b><em>${escapeHtml(labels.files)}</em></span>
              <span><b>${escapeHtml(summary.logicalDocuments ?? 0)}</b><em>${escapeHtml(labels.documents)}</em></span>
              <span><b>${escapeHtml(summary.localActions ?? 0)}</b><em>${escapeHtml(labels.local)}</em></span>
              <span><b>${escapeHtml(summary.cloudActions ?? 0)}</b><em>${escapeHtml(labels.cloud)}</em></span>
              <span><b>${escapeHtml(summary.blockers ?? blockers.length)}</b><em>${escapeHtml(labels.blocked)}</em></span>
            </div>
            ${blockers.length ? `<div class="run-blockers"><strong>${escapeHtml(labels.blockers)}</strong><ul>${blockers.map((item) => {
              return `<li><span>${escapeHtml(localized(item.message))}</span><a href="${escapeHtml(item.step)}">${escapeHtml(labels.fix)}</a></li>`;
            }).join("")}</ul></div>` : ""}
            ${renderExecutionPlan(executionPlan, { title: labels.plan })}
            <section class="run-boundaries">
              <strong>${escapeHtml(labels.boundaries)}</strong>
              <article data-boundary="${hasCloudActions ? "cloud" : "local"}">
                <span>${escapeHtml(hasCloudActions ? labels.cloudBoundaryTitle : labels.localBoundaryTitle)}</span>
                <p>${escapeHtml(hasCloudActions ? labels.cloudBoundaryBody : labels.localBoundaryBody)}</p>
              </article>
              ${renderCloudConfirmation(preview.cloudConfirmation, { compact: true })}
              ${gates.length ? `<ul class="run-gate-list">${gates.map((item) => {
                return `<li><span>${escapeHtml(localized(item.label))}</span><em>${escapeHtml(localized(item.message))}</em></li>`;
              }).join("")}</ul>` : ""}
            </section>
            ${showInlineConfirm && preview.canConfirmLocalJob === true && !blockers.length ? `<div class="run-confirm">
              <p>${escapeHtml(labels.confirmNote)}</p>
              <button class="primary-action" type="button" data-console-api-action="confirm-build-job" data-api-endpoint="/api/jobs/confirm" data-api-loading-zh="正在创建任务..." data-api-loading-en="Creating job...">${escapeHtml(labels.confirm)}</button>
              <div class="api-result" data-api-result="confirm-build-job" hidden></div>
            </div>` : ""}
          </section>`;
}

function renderMaintenanceStatus(maintenance) {
  if (!maintenance) return "";
  const summary = maintenance.summary || {};
  const diagnostics = Array.isArray(maintenance.diagnostics) ? maintenance.diagnostics : [];
  const updateGate = maintenance.updateGate;
  const progress = maintenance.metadataContractProgress || null;
  const templateContract = maintenance.templateContract || null;
  const platformRuntime = maintenance.platformRuntime || null;
  const providerCapabilities = maintenance.providerCapabilities || null;
  const labels = settings.lang === "zh"
    ? {
        title: "维护状态",
        service: "服务",
        version: "版本",
        latestJob: "最近任务",
        updateChannel: "更新通道"
      }
    : {
        title: "Maintenance Status",
        service: "Service",
        version: "Version",
        latestJob: "Latest Job",
        updateChannel: "Update Channel"
      };

  return `<section class="maintenance-status">
            <header class="maintenance-status-head">
              <h3>${escapeHtml(labels.title)}</h3>
            </header>
            <div class="maintenance-status-grid">
              <span><b>${escapeHtml(summary.endpoint || "-")}</b><em>${escapeHtml(labels.service)}</em></span>
              <span><b>${escapeHtml(summary.version || "-")}</b><em>${escapeHtml(labels.version)}</em></span>
              <span><b>${escapeHtml(localized(summary.latestJobLabel) || summary.latestJobStatus || "-")}</b><em>${escapeHtml(labels.latestJob)}</em></span>
              <span><b>${escapeHtml(localized(summary.updateChannelLabel) || summary.updateChannel || "-")}</b><em>${escapeHtml(labels.updateChannel)}</em></span>
            </div>
            ${renderMaintenanceProgress(progress)}
            ${renderPlatformRuntime(platformRuntime)}
            ${renderProviderCapabilities(providerCapabilities)}
            ${renderMaintenanceDiagnostics(diagnostics)}
            ${renderMaintenanceTemplateContract(templateContract)}
            ${renderMaintenanceUpdateGate(updateGate)}
          </section>`;
}

function renderProviderCapabilities(capabilities) {
  if (!capabilities) return "";
  const providers = Array.isArray(capabilities.providers) ? capabilities.providers : [];
  const costPrivacyCards = Array.isArray(capabilities.costPrivacyCards) ? capabilities.costPrivacyCards : [];
  const actions = Array.isArray(capabilities.guidedActions) ? capabilities.guidedActions : [];
  const labels = settings.lang === "zh"
    ? {
        title: "供应商能力",
        ready: "就绪",
        attention: "需确认",
        providers: "供应商",
        costPrivacy: "成本与隐私",
        costUnits: "成本单位",
        privacy: "隐私边界",
        dataLeaves: "会离开本机",
        localOnly: "仅本机",
        storesSource: "保存资料",
        storesVectors: "保存向量",
        guidance: "处理建议",
        none: "暂无需要处理的供应商配置。"
      }
    : {
        title: "Provider Capabilities",
        ready: "Ready",
        attention: "Review",
        providers: "Providers",
        costPrivacy: "Cost and Privacy",
        costUnits: "Cost Units",
        privacy: "Privacy Boundary",
        dataLeaves: "Leaves Device",
        localOnly: "Local Only",
        storesSource: "Stores Sources",
        storesVectors: "Stores Vectors",
        guidance: "Guidance",
        none: "No provider setup needs attention."
      };
  const statusText = capabilities.summary?.status === "ready" ? labels.ready : labels.attention;
  return `<section class="provider-capability-panel" data-status="${escapeHtml(capabilities.summary?.status || "attention")}">
            <header>
              <div>
                <strong>${escapeHtml(labels.title)}</strong>
                <span>${escapeHtml(`${capabilities.summary?.providers?.configured || 0}/${capabilities.summary?.providers?.total || 0} ${statusText}`)}</span>
              </div>
              <b>${escapeHtml(statusText)}</b>
            </header>
            <div class="provider-capability-grid">
              ${providers.map((provider) => `<article data-status="${escapeHtml(provider.status || "")}">
                <strong>${escapeHtml(localized(provider.label))}</strong>
                <span>${escapeHtml(localized(provider.message))}</span>
              </article>`).join("")}
            </div>
            <div class="provider-cost-privacy">
              <strong>${escapeHtml(labels.costPrivacy)}</strong>
              <ul>${costPrivacyCards.map((item) => {
                const privacy = item.privacy || {};
                const privacyLabels = [
                  privacy.dataLeavesDevice ? labels.dataLeaves : labels.localOnly,
                  privacy.storesSource ? labels.storesSource : "",
                  privacy.storesVectors ? labels.storesVectors : ""
                ].filter(Boolean);
                return `<li data-configured="${escapeHtml(String(Boolean(item.configured)))}">
                  <div>
                    <b>${escapeHtml(localized(item.title))}</b>
                    <span>${escapeHtml(`${labels.costUnits}: ${(item.cost?.units || []).join(", ")}`)}</span>
                    <em>${escapeHtml(`${labels.privacy}: ${privacyLabels.join(" / ")}`)}</em>
                  </div>
                </li>`;
              }).join("")}</ul>
            </div>
            <div class="provider-guidance">
              <strong>${escapeHtml(labels.guidance)}</strong>
              ${actions.length ? `<ul>${actions.map((item) => `<li>
                <b>${escapeHtml(localized(item.label))}</b>
                <span>${escapeHtml(localized(item.message))}</span>
              </li>`).join("")}</ul>` : `<p>${escapeHtml(labels.none)}</p>`}
            </div>
          </section>`;
}

function renderPlatformRuntime(runtime) {
  if (!runtime) return "";
  const checks = runtime.summary?.checks || {};
  const dependencies = runtime.dependencies || {};
  const dependencyItems = [
    dependencyItem("packageDependencies", dependencies.packageDependencies),
    dependencyItem("fileOpen", dependencies.fileOpen),
    dependencyItem("runtimeDownloader", dependencies.runtimeDownloader),
    dependencyItem("officeConverter", dependencies.officeConverter),
    dependencyItem("pdfRenderer", dependencies.pdfRenderer)
  ].filter(Boolean);
  const actions = Array.isArray(runtime.guidedActions) ? runtime.guidedActions : [];
  const labels = settings.lang === "zh"
    ? {
        title: "平台运行时",
        ready: "就绪",
        attention: "需留意",
        os: "系统",
        node: "Node",
        launcher: "启动器",
        privateRuntime: "私有运行时",
        systemNode: "系统 Node",
        dependencyTitle: "本机依赖",
        actionTitle: "处理建议",
        none: "暂无需要处理的依赖。"
      }
    : {
        title: "Platform Runtime",
        ready: "Ready",
        attention: "Review",
        os: "OS",
        node: "Node",
        launcher: "Launcher",
        privateRuntime: "Private Runtime",
        systemNode: "System Node",
        dependencyTitle: "Local Dependencies",
        actionTitle: "Guidance",
        none: "No dependency needs attention."
      };
  const statusText = runtime.summary?.status === "ready" ? labels.ready : labels.attention;
  const launcherText = runtime.launchers?.nodeIndependent ? labels.privateRuntime : labels.systemNode;
  return `<section class="platform-runtime-panel" data-status="${escapeHtml(runtime.summary?.status || "attention")}">
            <header>
              <div>
                <strong>${escapeHtml(labels.title)}</strong>
                <span>${escapeHtml(`${checks.pass || 0}/${checks.total || 0} ${statusText}`)}</span>
              </div>
              <b>${escapeHtml(statusText)}</b>
            </header>
            <div class="platform-runtime-grid">
              <span><b>${escapeHtml(`${runtime.platform?.os || "-"} ${runtime.platform?.arch || ""}`.trim())}</b><em>${escapeHtml(labels.os)}</em></span>
              <span><b>${escapeHtml(runtime.node?.version || "-")}</b><em>${escapeHtml(labels.node)}</em></span>
              <span><b>${escapeHtml(launcherText)}</b><em>${escapeHtml(labels.launcher)}</em></span>
            </div>
            <div class="platform-runtime-dependencies">
              <strong>${escapeHtml(labels.dependencyTitle)}</strong>
              <ul>${dependencyItems.map((item) => `<li data-status="${escapeHtml(item.status)}">
                <span>${escapeHtml(platformDependencyStatusLabel(item.status))}</span>
                <div>
                  <b>${escapeHtml(item.label)}</b>
                  <em>${escapeHtml(item.message)}</em>
                </div>
              </li>`).join("")}</ul>
            </div>
            <div class="platform-runtime-actions">
              <strong>${escapeHtml(labels.actionTitle)}</strong>
              ${actions.length ? `<ul>${actions.map((item) => `<li>
                <b>${escapeHtml(localized(item.label))}</b>
                <span>${escapeHtml(localized(item.message))}</span>
              </li>`).join("")}</ul>` : `<p>${escapeHtml(labels.none)}</p>`}
            </div>
          </section>`;
}

function dependencyItem(key, item) {
  if (!item) return null;
  const labels = settings.lang === "zh"
    ? {
        packageDependencies: "应用依赖",
        fileOpen: "打开文件夹",
        runtimeDownloader: "运行时下载",
        officeConverter: "旧格式转换",
        pdfRenderer: "PDF 拆页"
      }
    : {
        packageDependencies: "App Dependencies",
        fileOpen: "Open Folder",
        runtimeDownloader: "Runtime Download",
        officeConverter: "Legacy Conversion",
        pdfRenderer: "PDF Rendering"
      };
  return {
    key,
    status: item.status || "warn",
    label: labels[key] || key,
    message: localized(item.message) || item.resolvedCommand || item.command || ""
  };
}

function platformDependencyStatusLabel(status) {
  const labels = settings.lang === "zh"
    ? { pass: "正常", warn: "留意", fail: "需处理" }
    : { pass: "OK", warn: "Review", fail: "Needs work" };
  return labels[status] || status || "";
}

function renderQueryFeedbackList(feedback, mode = "review") {
  if (!feedback) return "";
  const reviewMode = mode === "review";
  const total = Number(feedback.total || 0);
  const open = Number(feedback.open || 0);
  const positive = Number(feedback.positive || 0);
  const resolved = Number(feedback.resolved || 0);
  const recent = reviewMode
    ? (Array.isArray(feedback.recent) ? feedback.recent : [])
    : (Array.isArray(feedback.recentRecords) ? feedback.recentRecords : (Array.isArray(feedback.recent) ? feedback.recent : []));
  const byAction = feedback.byAction || {};
  const openByAction = feedback.openByAction || {};
  const labels = settings.lang === "zh"
    ? {
        title: reviewMode ? "问答反馈维护" : "反馈记录",
        empty: reviewMode ? "暂无需要处理的问答反馈。" : "还没有收到需要复核的反馈。",
        emptyAll: "还没有收到问答反馈。",
        summary: reviewMode ? `有 ${open} 条反馈等待复核。` : `共收到 ${total} 条反馈，其中 ${open} 条需要维护复核。`,
        positiveSummary: positive > 0 ? `已收到 ${positive} 条有帮助反馈。` : "没有待处理反馈。",
        hint: reviewMode
          ? "优先处理引用错误和回答漏点，处理后再验证问答效果。"
          : "这里仅汇总反馈状态；需要处理的反馈请在维护知识库的问答反馈页集中处理。",
        open: "待复核",
        useful: "有帮助",
        wrong_citation: "引用不对",
        missed_point: "回答漏点",
        resolved: "已处理",
        recent: reviewMode ? "待复核反馈" : "最近反馈",
        unknownQuestion: "未记录问题",
        answerStatus: "回答状态",
        citations: "条引用",
        pagePrefix: "第",
        pageSuffix: "页",
        source: "相关资料",
        searchSources: "按问题查找资料",
        retest: "重新提问",
        retestReview: "复测问题",
        markResolved: "标记已处理",
        handled: "已处理",
        handledAt: "处理时间",
        sourceMissing: "没有记录引用资料",
        reviewLink: "去维护反馈"
      }
    : {
        title: reviewMode ? "Answer Feedback Maintenance" : "Feedback Records",
        empty: reviewMode ? "No answer feedback is waiting for maintenance." : "No reviewable feedback yet.",
        emptyAll: "No answer feedback has been received.",
        summary: reviewMode ? `${open} feedback items are waiting for review.` : `${total} feedback items received; ${open} need maintenance review.`,
        positiveSummary: positive > 0 ? `${positive} useful feedback items have been recorded.` : "No feedback needs review.",
        hint: reviewMode
          ? "Prioritize wrong citations and missed points, then validate answers again."
          : "This page only summarizes feedback state. Handle reviewable feedback in Maintain Knowledge Base.",
        open: "To review",
        useful: "Useful",
        wrong_citation: "Wrong citation",
        missed_point: "Missed point",
        resolved: "Handled",
        recent: reviewMode ? "Feedback to review" : "Recent feedback",
        unknownQuestion: "Question not recorded",
        answerStatus: "Answer status",
        citations: "citation(s)",
        pagePrefix: "p.",
        pageSuffix: "",
        source: "Related source",
        searchSources: "Search sources by question",
        retest: "Ask again",
        retestReview: "Retest",
        markResolved: "Mark handled",
        handled: "Handled",
        handledAt: "Handled at",
        sourceMissing: "No related source recorded",
        reviewLink: "Open Maintenance"
      };
  const actionLabels = {
    useful: labels.useful,
    wrong_citation: labels.wrong_citation,
    missed_point: labels.missed_point
  };
  if (open <= 0) {
    return `<section class="query-feedback-panel" data-state="empty">
              <header>
                <strong>${escapeHtml(labels.title)}</strong>
                <span>${escapeHtml(total <= 0 ? labels.emptyAll : labels.positiveSummary)}</span>
              </header>
              ${total > 0 ? `<div class="query-feedback-counts">
                <span data-action="open"><b>${escapeHtml(String(open))}</b><em>${escapeHtml(labels.open)}</em></span>
                <span data-action="useful"><b>${escapeHtml(String(positive))}</b><em>${escapeHtml(labels.useful)}</em></span>
                <span data-action="resolved"><b>${escapeHtml(String(resolved))}</b><em>${escapeHtml(labels.resolved)}</em></span>
              </div>` : ""}
              ${!reviewMode && recent.length ? `<div class="query-feedback-recent">
                <strong>${escapeHtml(labels.recent)}</strong>
                <ul>${recent.map((item) => renderQueryFeedbackRecordItem(item, actionLabels, labels, false)).join("")}</ul>
              </div>` : ""}
            </section>`;
  }
  const reviewHref = scopedPath("/maintain/feedback");
  return `<section class="query-feedback-panel" data-state="active">
            <header>
              <div>
                <strong>${escapeHtml(labels.title)}</strong>
                <span>${escapeHtml(labels.summary)}</span>
              </div>
              ${!reviewMode ? `<a class="primary-action query-feedback-review-link" href="${escapeHtml(reviewHref)}">${escapeHtml(labels.reviewLink)}</a>` : ""}
            </header>
            <div class="query-feedback-counts">
              <span data-action="open"><b>${escapeHtml(String(open))}</b><em>${escapeHtml(labels.open)}</em></span>
              <span data-action="wrong_citation"><b>${escapeHtml(String(openByAction.wrong_citation || 0))}</b><em>${escapeHtml(labels.wrong_citation)}</em></span>
              <span data-action="missed_point"><b>${escapeHtml(String(openByAction.missed_point || 0))}</b><em>${escapeHtml(labels.missed_point)}</em></span>
              <span data-action="useful"><b>${escapeHtml(String(byAction.useful || 0))}</b><em>${escapeHtml(labels.useful)}</em></span>
            </div>
            <p>${escapeHtml(labels.hint)}</p>
            ${recent.length ? `<div class="query-feedback-recent">
              <strong>${escapeHtml(labels.recent)}</strong>
              <ul>${recent.map((item) => renderQueryFeedbackRecordItem(item, actionLabels, labels, reviewMode)).join("")}</ul>
            </div>` : ""}
          </section>`;
}

function renderQueryFeedbackRecordItem(item, actionLabels, labels, actionable = false) {
  const question = item.question || labels.unknownQuestion;
  const action = actionLabels[item.action] || item.action || "";
  const citationCount = Array.isArray(item.citationIds) ? item.citationIds.length : 0;
  const citationRefs = Array.isArray(item.citationRefs) ? item.citationRefs : [];
  const sourceLinks = queryFeedbackSourceLinks(item, citationRefs, labels);
  const resolved = Boolean(item.resolved);
  const status = resolved ? labels.handled : action;
  const askHref = item.retestHref ? scopedPath(item.retestHref) : scopedPath(`/use/ask?question=${encodeURIComponent(question)}`);
  const suffix = [
    formatLocalTime(item.createdAt),
    resolved && item.resolution?.createdAt ? `${labels.handledAt}: ${formatLocalTime(item.resolution.createdAt)}` : "",
    item.answerStatus ? `${labels.answerStatus}: ${item.answerStatus}` : "",
    citationCount ? `${citationCount} ${labels.citations}` : ""
  ].filter(Boolean).join(" · ");
  const retestAction = `<a class="secondary-action quiet-action query-feedback-record-link"
        href="${escapeHtml(askHref)}">${escapeHtml(actionable ? labels.retestReview : labels.retest)}</a>`;
  const actionControl = actionable
    ? `${retestAction}<button class="secondary-action quiet-action query-feedback-resolve"
        type="button"
        data-query-feedback-resolve="${escapeHtml(item.id)}"
        data-feedback-question="${escapeHtml(question)}"
        data-feedback-resolve-endpoint="/api/query/feedback/resolve">${escapeHtml(labels.markResolved)}</button>`
    : retestAction;
  return `<li class="query-feedback-record" data-feedback-state="${resolved ? "resolved" : "open"}">
            <div class="query-feedback-record-main">
              <span>${escapeHtml(status)}</span>
              <b title="${escapeHtml(question)}">${escapeHtml(question)}</b>
              <em>${escapeHtml(suffix)}</em>
            </div>
            ${sourceLinks || `<p class="query-feedback-source-empty">${escapeHtml(labels.sourceMissing)}</p>`}
            ${item.message ? `<p>${escapeHtml(item.message)}</p>` : ""}
            <div class="query-feedback-record-actions">${actionControl}</div>
          </li>`;
}

function queryFeedbackSourceLinks(item = {}, citationRefs = [], labels = {}) {
  const links = citationRefs
    .map((ref) => {
      const href = queryFeedbackDocumentHref(ref, item.question);
      if (!href) return "";
      const title = ref.title || ref.sourceUri || ref.id || labels.source || "";
      const meta = [
        ref.pageNumber ? `${labels.pagePrefix}${ref.pageNumber}${labels.pageSuffix || ""}` : "",
        ref.lessonTitle || ""
      ].filter(Boolean).join(" · ");
      return `<a href="${escapeHtml(href)}" title="${escapeHtml(ref.excerpt || title)}">
        <span>${escapeHtml(title)}</span>
        ${meta ? `<em>${escapeHtml(meta)}</em>` : ""}
      </a>`;
    })
    .filter(Boolean);
  if (!links.length && item.question) {
    links.push(`<a href="${escapeHtml(scopedPath(`/maintain/documents?query=${encodeURIComponent(item.question)}`))}">
      <span>${escapeHtml(labels.searchSources || "Search sources")}</span>
    </a>`);
  }
  return links.length ? `<div class="query-feedback-source-links" aria-label="${escapeHtml(labels.source || "Related source")}">${links.join("")}</div>` : "";
}

function queryFeedbackDocumentHref(ref = {}, fallbackQuery = "") {
  const explicit = String(ref.documentHref || "").trim();
  if (explicit) return scopedPath(explicit);
  const query = String(ref.title || ref.sourceUri || fallbackQuery || "").trim();
  return query ? scopedPath(`/maintain/documents?query=${encodeURIComponent(query)}`) : "";
}

function renderVersionRecords(data = {}) {
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const summary = data.summary || {};
  const knowledgeBase = data.knowledgeBase || {};
  const labels = settings.lang === "zh"
    ? {
        title: "版本记录",
        empty: "当前知识库还没有生成版本。完成一次写入知识库后，这里会显示版本、索引和 Sidecar 状态。",
        active: "当前生效",
        latest: "最新版本",
        total: "版本数",
        sidecar: "Sidecar 就绪",
        target: "写入目标",
        documents: "资料",
        records: "索引记录",
        created: "生成时间",
        noTarget: "未记录写入目标",
        ready: "已就绪",
        missing: "未就绪",
        local: "本地产物",
        diff: "查看差异",
        rollback: "回滚预览"
      }
    : {
        title: "Version Records",
        empty: "This knowledge base has no generated version yet. After a knowledge-base write, versions, indexes, and Sidecar status appear here.",
        active: "Active",
        latest: "Latest",
        total: "Versions",
        sidecar: "Sidecar Ready",
        target: "Write Target",
        documents: "Sources",
        records: "Index Records",
        created: "Created",
        noTarget: "No target recorded",
        ready: "Ready",
        missing: "Missing",
        local: "Local output",
        diff: "Diff",
        rollback: "Rollback Preview"
      };
  if (!versions.length) {
    return `<section class="version-records-empty">
              <strong>${escapeHtml(labels.title)}</strong>
              <p>${escapeHtml(labels.empty)}</p>
            </section>`;
  }
  return `<section class="version-records-view">
            <header>
              <div>
                <strong>${escapeHtml(knowledgeBase.name || knowledgeBase.id || labels.title)}</strong>
                <span>${escapeHtml(knowledgeBase.template || "")}</span>
              </div>
              <div class="version-records-summary">
                <span><b>${escapeHtml(String(summary.total || versions.length))}</b><em>${escapeHtml(labels.total)}</em></span>
                <span><b>${escapeHtml(summary.active || summary.latest || "-")}</b><em>${escapeHtml(labels.active)}</em></span>
                <span><b>${escapeHtml(String(summary.sidecarReady || 0))}</b><em>${escapeHtml(labels.sidecar)}</em></span>
              </div>
            </header>
            <div class="version-record-list">
              ${versions.map((item) => renderVersionRecordCard(item, labels)).join("")}
            </div>
          </section>`;
}

function renderVersionRecordCard(item = {}, labels) {
  const target = item.target || {};
  const sidecar = item.sidecar || {};
  const documents = item.documents || {};
  const write = item.write || {};
  const targetText = [target.provider, target.bucket, target.indexName].filter(Boolean).join(" / ") || labels.noTarget;
  const sidecarReady = sidecar.status === "ready";
  return `<article class="version-record-card" data-active="${item.active ? "true" : "false"}">
            <header>
              <div>
                <span>${escapeHtml(item.active ? labels.active : labels.local)}</span>
                <strong title="${escapeHtml(item.id || "")}">${escapeHtml(item.id || "-")}</strong>
              </div>
              <em data-state="${sidecarReady ? "ready" : "missing"}">${escapeHtml(sidecarReady ? labels.ready : labels.missing)}</em>
            </header>
            <dl>
              <div><dt>${escapeHtml(labels.target)}</dt><dd title="${escapeHtml(targetText)}">${escapeHtml(targetText)}</dd></div>
              <div><dt>${escapeHtml(labels.documents)}</dt><dd>${escapeHtml(String(documents.included || documents.total || 0))}</dd></div>
              <div><dt>${escapeHtml(labels.records)}</dt><dd>${escapeHtml(String(write.success || write.records || sidecar.chunks || 0))}</dd></div>
              <div><dt>${escapeHtml(labels.created)}</dt><dd>${escapeHtml(formatLocalTime(item.createdAt))}</dd></div>
            </dl>
            <div class="version-record-actions">
              <button type="button"
                data-console-api-action="version-diff"
                data-api-method="GET"
                data-api-result-key="version-records"
                data-api-endpoint="/api/versions/diff?targetBuildId=${encodeURIComponent(item.id || "")}"
                data-api-loading-zh="正在比较版本..."
                data-api-loading-en="Comparing versions...">${escapeHtml(labels.diff)}</button>
              ${item.active ? "" : `<button type="button"
                data-console-api-action="version-rollback-preview"
                data-version-build-id="${escapeHtml(item.id || "")}"
                data-api-result-key="version-records"
                data-api-endpoint="/api/versions/rollback/preview"
                data-api-loading-zh="正在生成回滚预览..."
                data-api-loading-en="Preparing rollback preview...">${escapeHtml(labels.rollback)}</button>`}
            </div>
          </article>`;
}

function renderVersionOperation(data = {}) {
  if (data.kind === "knowmesh.versionRollback" && data.versions) {
    return `<section class="version-operation-panel" data-kind="rollback-complete">
              <header>
                <strong>${escapeHtml(settings.lang === "zh" ? "回滚已完成" : "Rollback Complete")}</strong>
                <span>${escapeHtml(data.activatedBuildId || "")}</span>
              </header>
              ${renderVersionRecords(data.versions)}
            </section>`;
  }
  const diff = data.kind === "knowmesh.versionDiff" ? data : data.diff;
  if (!diff) return "";
  const labels = settings.lang === "zh"
    ? {
        diffTitle: data.kind === "knowmesh.versionRollbackPreview" ? "回滚预览" : "版本差异",
        base: "当前版本",
        target: "目标版本",
        documents: "资料变化",
        records: "索引变化",
        evaluation: "评测变化",
        confirm: "确认回滚",
        body: "确认后会把当前知识库切换到这个版本。"
      }
    : {
        diffTitle: data.kind === "knowmesh.versionRollbackPreview" ? "Rollback Preview" : "Version Diff",
        base: "Current version",
        target: "Target version",
        documents: "Source change",
        records: "Index change",
        evaluation: "Evaluation change",
        confirm: "Confirm Rollback",
        body: "Confirmation switches this knowledge base to the target version."
      };
  const comparison = diff.comparison || {};
  const targetBuildId = data.targetBuildId || diff.summary?.targetBuildId || "";
  return `<section class="version-operation-panel" data-kind="${escapeHtml(data.kind || diff.kind || "")}">
            <header>
              <strong>${escapeHtml(labels.diffTitle)}</strong>
              <span>${escapeHtml(`${labels.base}: ${diff.summary?.baseBuildId || "-"} · ${labels.target}: ${targetBuildId || "-"}`)}</span>
            </header>
            <div class="version-operation-grid">
              ${renderVersionOperationMetric(labels.documents, comparison.documents?.included)}
              ${renderVersionOperationMetric(labels.records, comparison.write?.records)}
              ${renderVersionOperationMetric(labels.evaluation, comparison.evaluation?.failed)}
            </div>
            ${data.kind === "knowmesh.versionRollbackPreview" ? `<div class="version-operation-actions">
              <button type="button"
                data-console-api-action="version-rollback-confirm"
                data-version-build-id="${escapeHtml(targetBuildId)}"
                data-api-result-key="version-records"
                data-api-endpoint="/api/versions/rollback"
                data-api-loading-zh="正在回滚版本..."
                data-api-loading-en="Rolling back version..."
                data-confirm-title-zh="确认回滚版本？"
                data-confirm-title-en="Confirm rollback?"
                data-confirm-body-zh="${escapeHtml(labels.body)}"
                data-confirm-body-en="${escapeHtml(labels.body)}"
                data-confirm-label-zh="${escapeHtml(labels.confirm)}"
                data-confirm-label-en="${escapeHtml(labels.confirm)}">${escapeHtml(labels.confirm)}</button>
            </div>` : ""}
          </section>`;
}

function renderVersionOperationMetric(label, metric = {}) {
  const base = metric?.base ?? 0;
  const target = metric?.target ?? 0;
  const delta = metric?.delta ?? 0;
  const deltaText = Number(delta) > 0 ? `+${delta}` : String(delta);
  return `<span>
            <em>${escapeHtml(label)}</em>
            <b>${escapeHtml(`${base} -> ${target}`)}</b>
            <strong data-delta="${escapeHtml(Number(delta) === 0 ? "same" : Number(delta) > 0 ? "up" : "down")}">${escapeHtml(deltaText)}</strong>
          </span>`;
}

function renderEvaluationDashboard(data = {}) {
  const summary = data.summary || {};
  const categories = Array.isArray(data.categories) ? data.categories : [];
  const failureGroups = Array.isArray(data.failureGroups) ? data.failureGroups : [];
  const recentBuilds = Array.isArray(data.recentBuilds) ? data.recentBuilds : [];
  const nextActions = Array.isArray(data.nextActions) ? data.nextActions : [];
  const knowledgeBase = data.knowledgeBase || {};
  const labels = settings.lang === "zh"
    ? {
        title: "评测看板",
        empty: "当前知识库还没有评测用例。完成一次构建后，这里会显示覆盖率、通过率和失败类别。",
        status: "状态",
        cases: "用例数",
        coverage: "覆盖率",
        passRate: "通过率",
        failed: "失败",
        activeBuild: "当前构建",
        categories: "类别结果",
        failures: "需要处理",
        recentBuilds: "最近构建",
        nextActions: "下一步",
        noFailures: "没有失败或待复核评测。",
        noRecent: "还没有构建评测结果。",
        missing: "缺失",
        review: "待复核",
        passed: "通过",
        riskCodes: "风险",
        lastResult: "最近结果"
      }
    : {
        title: "Evaluation Dashboard",
        empty: "This knowledge base has no evaluation cases yet. After a build, coverage, pass rate, and failure categories appear here.",
        status: "Status",
        cases: "Cases",
        coverage: "Coverage",
        passRate: "Pass Rate",
        failed: "Failed",
        activeBuild: "Active Build",
        categories: "Category Results",
        failures: "Needs Action",
        recentBuilds: "Recent Builds",
        nextActions: "Next Actions",
        noFailures: "No failed or review evaluation result.",
        noRecent: "No build evaluation result yet.",
        missing: "Missing",
        review: "Review",
        passed: "Passed",
        riskCodes: "Risks",
        lastResult: "Last Result"
      };
  if (!summary.cases) {
    return `<section class="evaluation-dashboard-view">
              <header>
                <div>
                  <strong>${escapeHtml(knowledgeBase.name || knowledgeBase.id || labels.title)}</strong>
                  <span>${escapeHtml(knowledgeBase.template || "")}</span>
                </div>
                <em data-status="${escapeHtml(summary.status || "empty")}">${escapeHtml(evaluationStatusLabel(summary.status))}</em>
              </header>
              <section class="evaluation-dashboard-empty">
                <strong>${escapeHtml(labels.title)}</strong>
                <p>${escapeHtml(labels.empty)}</p>
              </section>
              ${renderEvaluationActions(nextActions, labels)}
            </section>`;
  }
  return `<section class="evaluation-dashboard-view">
            <header>
              <div>
                <strong>${escapeHtml(knowledgeBase.name || knowledgeBase.id || labels.title)}</strong>
                <span>${escapeHtml(knowledgeBase.template || "")}</span>
              </div>
              <em data-status="${escapeHtml(summary.status || "attention")}">${escapeHtml(evaluationStatusLabel(summary.status))}</em>
            </header>
            <div class="evaluation-dashboard-grid">
              ${renderEvaluationMetric(labels.cases, summary.cases)}
              ${renderEvaluationMetric(labels.coverage, `${summary.coveragePercent || 0}%`)}
              ${renderEvaluationMetric(labels.passRate, `${summary.passRate || 0}%`)}
              ${renderEvaluationMetric(labels.failed, summary.failed || 0)}
              ${renderEvaluationMetric(labels.missing, summary.missing || 0)}
              ${renderEvaluationMetric(labels.activeBuild, summary.activeBuildId || "-")}
            </div>
            ${renderEvaluationCategories(categories, labels)}
            ${renderEvaluationFailures(failureGroups, labels)}
            ${renderEvaluationRecentBuilds(recentBuilds, labels)}
            ${renderEvaluationActions(nextActions, labels)}
          </section>`;
}

function renderEvaluationMetric(label, value) {
  return `<span>
            <em>${escapeHtml(label)}</em>
            <b>${escapeHtml(String(value ?? "-"))}</b>
          </span>`;
}

function renderEvaluationCategories(categories = [], labels) {
  if (!categories.length) return "";
  return `<section class="evaluation-category-list">
            <header><strong>${escapeHtml(labels.categories)}</strong></header>
            <ul>
              ${categories.map((item) => `<li data-status="${escapeHtml(item.status || "review")}">
                <div>
                  <strong>${escapeHtml(item.category || "-")}</strong>
                  <span>${escapeHtml(`${labels.passed}: ${item.passed || 0} / ${labels.failed}: ${item.failed || 0} / ${labels.review}: ${item.review || 0} / ${labels.missing}: ${item.missing || 0}`)}</span>
                </div>
                <em>${escapeHtml(evaluationStatusLabel(item.status))}</em>
              </li>`).join("")}
            </ul>
          </section>`;
}

function renderEvaluationFailures(failureGroups = [], labels) {
  if (!failureGroups.length) {
    return `<section class="evaluation-failure-list">
              <header><strong>${escapeHtml(labels.failures)}</strong></header>
              <p>${escapeHtml(labels.noFailures)}</p>
            </section>`;
  }
  const previewLabel = settings.lang === "zh" ? "预览局部重跑" : "Preview Rerun";
  return `<section class="evaluation-failure-list">
            <header>
              <strong>${escapeHtml(labels.failures)}</strong>
              <button type="button"
                data-console-api-action="targeted-rerun-preview"
                data-rerun-type="failedBatch"
                data-api-result-key="evaluation-dashboard"
                data-api-endpoint="/api/rerun/preview"
                data-api-loading-zh="正在预览局部重跑..."
                data-api-loading-en="Previewing targeted rerun...">${escapeHtml(previewLabel)}</button>
            </header>
            <ul>
              ${failureGroups.map((item) => {
                const risks = Array.isArray(item.riskCodes) ? item.riskCodes.join(", ") : "";
                const actionHref = item.action?.href ? scopedPath(item.action.href) : "";
                const actionLabel = localized(item.action?.label) || "";
                return `<li data-status="${escapeHtml(item.status || "review")}">
                  <div>
                    <strong>${escapeHtml(item.category || "-")}</strong>
                    <span>${escapeHtml(`${labels.failed}: ${item.failed || 0} / ${labels.review}: ${item.review || 0} / ${labels.missing}: ${item.missing || 0}`)}</span>
                    ${risks ? `<small>${escapeHtml(`${labels.riskCodes}: ${risks}`)}</small>` : ""}
                  </div>
                  ${actionHref && actionLabel ? `<a href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>` : `<em>${escapeHtml(evaluationStatusLabel(item.status))}</em>`}
                </li>`;
              }).join("")}
            </ul>
          </section>`;
}

function renderEvaluationRecentBuilds(recentBuilds = [], labels) {
  if (!recentBuilds.length) {
    return `<section class="evaluation-recent-builds">
              <header><strong>${escapeHtml(labels.recentBuilds)}</strong></header>
              <p>${escapeHtml(labels.noRecent)}</p>
            </section>`;
  }
  return `<section class="evaluation-recent-builds">
            <header><strong>${escapeHtml(labels.recentBuilds)}</strong></header>
            <ol>
              ${recentBuilds.slice(0, 5).map((item) => `<li>
                <div>
                  <strong title="${escapeHtml(item.buildId || "")}">${escapeHtml(item.buildId || "-")}</strong>
                  <span>${escapeHtml(`${labels.passRate}: ${item.passRate || 0}% · ${labels.failed}: ${item.failed || 0}`)}</span>
                </div>
                <em>${escapeHtml(formatLocalTime(item.lastResultAt))}</em>
              </li>`).join("")}
            </ol>
          </section>`;
}

function renderEvaluationActions(nextActions = [], labels) {
  if (!nextActions.length) return "";
  return `<section class="evaluation-next-actions">
            <header><strong>${escapeHtml(labels.nextActions)}</strong></header>
            <div>
              ${nextActions.map((item) => `<a href="${escapeHtml(scopedPath(item.href || "/build"))}">${escapeHtml(localized(item.label) || item.key || labels.nextActions)}</a>`).join("")}
            </div>
          </section>`;
}

function evaluationStatusLabel(status = "") {
  const key = String(status || "attention");
  const zh = { ready: "已通过", attention: "需处理", blocked: "未就绪", empty: "暂无评测", fail: "失败", missing: "缺失", review: "待复核" };
  const en = { ready: "Ready", attention: "Needs Action", blocked: "Blocked", empty: "No Data", fail: "Failed", missing: "Missing", review: "Review" };
  return (settings.lang === "zh" ? zh : en)[key] || key;
}

function renderTargetedRerunOperation(data = {}) {
  const preview = data.kind === "knowmesh.targetedRerunConfirm" ? data.preview : data;
  const summary = preview?.summary || {};
  const target = preview?.target || data.target || {};
  const labels = settings.lang === "zh"
    ? {
        previewTitle: data.kind === "knowmesh.targetedRerunConfirm" ? "局部重跑任务已创建" : "局部重跑预览",
        body: "只会重跑当前范围关联的资料、页、结构、片段和评测失败类别。",
        documents: "资料",
        pages: "页",
        chunks: "片段",
        issues: "问题",
        evaluation: "评测失败",
        target: "范围",
        confirm: "创建局部重跑任务",
        openJob: "查看任务",
        failures: "失败批次"
      }
    : {
        previewTitle: data.kind === "knowmesh.targetedRerunConfirm" ? "Targeted Rerun Job Created" : "Targeted Rerun Preview",
        body: "Only sources, pages, structures, chunks, and failed evaluation categories in this scope are rerun.",
        documents: "Sources",
        pages: "Pages",
        chunks: "Chunks",
        issues: "Issues",
        evaluation: "Evaluation Failures",
        target: "Scope",
        confirm: "Create Targeted Rerun Job",
        openJob: "View Job",
        failures: "Failure Batches"
      };
  const batches = Array.isArray(preview?.failureBatches) ? preview.failureBatches : [];
  return `<section class="targeted-rerun-panel">
            <header>
              <div>
                <strong>${escapeHtml(labels.previewTitle)}</strong>
                <span>${escapeHtml(labels.body)}</span>
              </div>
              <em>${escapeHtml(`${labels.target}: ${target.type || "-"}`)}</em>
            </header>
            <div class="targeted-rerun-grid">
              ${renderEvaluationMetric(labels.documents, summary.documents || 0)}
              ${renderEvaluationMetric(labels.pages, summary.pages || 0)}
              ${renderEvaluationMetric(labels.chunks, summary.chunks || 0)}
              ${renderEvaluationMetric(labels.issues, summary.qualityIssues || 0)}
              ${renderEvaluationMetric(labels.evaluation, summary.evaluationFailures || 0)}
            </div>
            ${batches.length ? `<section class="targeted-rerun-batches">
              <strong>${escapeHtml(labels.failures)}</strong>
              <ul>${batches.map((item) => `<li><span>${escapeHtml(item.type || "")}</span><em>${escapeHtml(String(item.pages || item.issues || item.failures || 0))}</em></li>`).join("")}</ul>
            </section>` : ""}
            <div class="targeted-rerun-actions">
              ${data.kind === "knowmesh.targetedRerunPreview" ? `<button type="button"
                data-console-api-action="targeted-rerun-confirm"
                data-rerun-type="${escapeHtml(target.type || "failedBatch")}"
                data-rerun-document-id="${escapeHtml(target.documentId || "")}"
                data-rerun-relative-path="${escapeHtml(target.relativePath || "")}"
                data-rerun-start-page="${escapeHtml(target.startPage || "")}"
                data-rerun-end-page="${escapeHtml(target.endPage || "")}"
                data-rerun-unit="${escapeHtml(target.unit || "")}"
                data-rerun-node-id="${escapeHtml(target.nodeId || "")}"
                data-api-result-key="evaluation-dashboard"
                data-api-endpoint="/api/rerun/confirm"
                data-api-loading-zh="正在创建局部重跑任务..."
                data-api-loading-en="Creating targeted rerun job...">${escapeHtml(labels.confirm)}</button>` : ""}
              ${data.kind === "knowmesh.targetedRerunConfirm" && data.job?.id ? `<a href="${escapeHtml(scopedPath("/build/execution"))}">${escapeHtml(labels.openJob)}</a>` : ""}
            </div>
          </section>`;
}

function renderMaintenanceProgress(progress) {
  if (!progress || progress.status !== "running") return "";
  const completed = Number(progress.completed || 0);
  const total = Number(progress.total || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0;
  const labels = settings.lang === "zh"
    ? { title: "升级进行中", count: total ? `${completed}/${total}` : "准备中" }
    : { title: "Upgrade in progress", count: total ? `${completed}/${total}` : "Preparing" };
  return `<section class="maintenance-progress-card" data-status="${escapeHtml(progress.status)}">
            <div>
              <strong>${escapeHtml(labels.title)}</strong>
              <span>${escapeHtml(localized(progress.message) || "")}</span>
            </div>
            <div class="maintenance-progress-bar" aria-label="${escapeHtml(labels.count)}"><span style="width: ${percent}%"></span></div>
            <b>${escapeHtml(labels.count)}</b>
          </section>`;
}

function renderMaintenanceDiagnostics(diagnostics) {
  if (!diagnostics.length) return "";
  const labels = settings.lang === "zh"
    ? {
        title: "诊断清单",
        action: "处理",
        status: {
          pass: "正常",
          warn: "留意",
          fail: "需处理",
          working: "处理中",
          blocked: "已关闭"
        }
      }
    : {
        title: "Diagnostics",
        action: "Fix",
        status: {
          pass: "OK",
          warn: "Review",
          fail: "Needs work",
          working: "Working",
          blocked: "Off"
        }
      };
  return `<section class="maintenance-diagnostics">
            <strong>${escapeHtml(labels.title)}</strong>
            <ul>${diagnostics.map((item) => {
              const status = labels.status[item.status] || item.status;
              const action = item.action || null;
              const actionLabel = localized(action?.label);
              const disabledAttr = action?.disabled ? " disabled aria-disabled=\"true\"" : "";
              const actionButton = action
                ? `<button class="secondary-action quiet-action${action.key === "upgrade-metadata-contract" ? " maintenance-contract-action" : ""}" type="button"
                    data-console-api-action="${escapeHtml(action.key || "maintenance-action")}"
                    data-api-result-key="maintenance-status"
                    data-api-endpoint="${escapeHtml(action.endpoint || "")}"
                    data-api-loading-zh="${escapeHtml(action.loading?.zh || "")}"
                    data-api-loading-en="${escapeHtml(action.loading?.en || "")}"
                    data-confirm-title-zh="${escapeHtml(action.confirmTitle?.zh || "")}"
                    data-confirm-title-en="${escapeHtml(action.confirmTitle?.en || "")}"
                    data-confirm-body-zh="${escapeHtml(action.confirmBody?.zh || "")}"
                    data-confirm-body-en="${escapeHtml(action.confirmBody?.en || "")}"
                    data-confirm-label-zh="${escapeHtml(action.confirmLabel?.zh || action.label?.zh || "")}"
                    data-confirm-label-en="${escapeHtml(action.confirmLabel?.en || action.label?.en || "")}"${disabledAttr}>${escapeHtml(actionLabel || labels.action)}</button>`
                : "";
              return `<li data-status="${escapeHtml(item.status)}">
                <div>
                  <span>${escapeHtml(status)}</span>
                  <strong>${escapeHtml(localized(item.label))}</strong>
                  <em>${escapeHtml(localized(item.message))}</em>
                </div>
                ${actionButton}
              </li>`;
            }).join("")}</ul>
          </section>`;
}

function renderMaintenanceTemplateContract(contract) {
  if (!contract) return "";
  const capabilities = Array.isArray(contract.capabilities) ? contract.capabilities : [];
  const gates = Array.isArray(contract.gates) ? contract.gates : [];
  const labels = settings.lang === "zh"
    ? { title: "当前模板能力", version: "模板版本", gates: "写入门禁" }
    : { title: "Template Capabilities", version: "Template Version", gates: "Write Gates" };
  return `<section class="maintenance-template-contract">
            <header>
              <div>
                <strong>${escapeHtml(labels.title)}</strong>
                <span>${escapeHtml(localized(contract.title) || contract.id || "")}</span>
              </div>
              <b>${escapeHtml(labels.version)} ${escapeHtml(contract.version || "0.0.0")}</b>
            </header>
            <p>${escapeHtml(localized(contract.summary) || "")}</p>
            <div class="maintenance-template-grid">
              ${capabilities.map((item) => `<article>
                <strong>${escapeHtml(localized(item.label))}</strong>
                <span>${escapeHtml(localized(item.message))}</span>
              </article>`).join("")}
            </div>
            ${gates.length ? `<div class="maintenance-template-gates">
              <strong>${escapeHtml(labels.gates)}</strong>
              <ul>${gates.map((item) => `<li>
                <b>${escapeHtml(localized(item.label))}</b>
                <span>${escapeHtml(localized(item.message))}</span>
              </li>`).join("")}</ul>
            </div>` : ""}
          </section>`;
}

function renderMaintenanceUpdateGate(updateGate) {
  if (!updateGate || !Array.isArray(updateGate.steps)) return "";
  const labels = settings.lang === "zh"
    ? {
        status: {
          pass: "已就绪",
          warn: "需留意",
          fail: "需处理",
          blocked: "未执行"
        }
      }
    : {
        status: {
          pass: "Ready",
          warn: "Review",
          fail: "Needs work",
          blocked: "Off"
        }
      };
  return `<section class="maintenance-update-gate">
            <div>
              <strong>${escapeHtml(localized(updateGate.label))}</strong>
              <p>${escapeHtml(localized(updateGate.message))}</p>
            </div>
            <ol>${updateGate.steps.map((step, index) => {
              const status = labels.status[step.status] || step.status;
              return `<li data-status="${escapeHtml(step.status)}">
                <span class="maintenance-update-index">${index + 1}</span>
                <span class="maintenance-update-state">${escapeHtml(status)}</span>
                <div class="maintenance-update-copy">
                  <strong>${escapeHtml(localized(step.label))}</strong>
                  <em>${escapeHtml(localized(step.message))}</em>
                </div>
              </li>`;
            }).join("")}</ol>
          </section>`;
}

function renderExecutionPlan(plan, options = {}) {
  if (!plan || !Array.isArray(plan.stages) || !plan.stages.length) return "";
  const summary = plan.summary || {};
  const labels = settings.lang === "zh"
    ? {
        title: options.title || "执行步骤计划",
        subtitle: "按这个路线处理资料，并逐轮校验结果。",
        stages: "步骤",
        rounds: "轮",
        passed: "已校验",
        pending: "待校验",
        roundPrefix: "第",
        roundSuffix: "轮",
        validation: "校验",
        status: {
          waiting: "待开始",
          running: "执行中",
          completed: "已完成",
          blocked: "已阻塞",
          failed: "失败",
          skipped: "已跳过"
        },
        validationStatus: {
          passed: "已通过",
          pending: "待校验",
          not_needed: "无需校验",
          blocked: "待处理",
          needs_review: "执行后复核",
          failed: "未通过"
        }
      }
    : {
        title: options.title || "Execution Plan",
        subtitle: "Sources are processed and checked round by round.",
        stages: "Stages",
        rounds: "Rounds",
        passed: "Checked",
        pending: "Pending checks",
        roundPrefix: "Round",
        roundSuffix: "",
        validation: "Validation",
        status: {
          waiting: "Waiting",
          running: "Running",
          completed: "Complete",
          blocked: "Blocked",
          failed: "Failed",
          skipped: "Skipped"
        },
        validationStatus: {
          passed: "Passed",
          pending: "Pending",
          not_needed: "Not needed",
          blocked: "Needs attention",
          needs_review: "Needs review",
          failed: "Failed"
        }
      };

  return `<section class="execution-flow">
            <div class="execution-flow-head">
              <div>
                <h4>${escapeHtml(labels.title)}</h4>
                <p>${escapeHtml(labels.subtitle)}</p>
              </div>
              <div class="execution-flow-summary">
                <span><b>${escapeHtml(summary.totalStages ?? plan.stages.length)}</b><em>${escapeHtml(labels.stages)}</em></span>
                <span><b>${escapeHtml(summary.totalRounds ?? 0)}</b><em>${escapeHtml(labels.rounds)}</em></span>
                <span><b>${escapeHtml(summary.passedChecks ?? 0)}</b><em>${escapeHtml(labels.passed)}</em></span>
                <span><b>${escapeHtml(summary.pendingChecks ?? 0)}</b><em>${escapeHtml(labels.pending)}</em></span>
              </div>
            </div>
            <div class="execution-stage-list">
              ${plan.stages.map((stage) => renderExecutionStage(stage, labels)).join("")}
            </div>
          </section>`;
}

function renderExecutionStage(stage, labels) {
  const rounds = Array.isArray(stage.rounds) ? stage.rounds : [];
  const status = labels.status[stage.status] || stage.status;
  const validation = labels.validationStatus[stage.validationStatus] || stage.validationStatus;
  const validationTitle = `${labels.validation}: ${validation}`;
  const open = stage.status === "blocked" || stage.validationStatus === "blocked" ? " open" : "";
  return `<details class="execution-stage" data-status="${escapeHtml(stage.status)}" data-validation="${escapeHtml(stage.validationStatus)}"${open}>
            <summary>
              <span class="execution-stage-index">${escapeHtml(stage.order)}</span>
              <div>
                <strong>${escapeHtml(localized(stage.label))}</strong>
                <p>${escapeHtml(localized(stage.message))}</p>
              </div>
              <span class="execution-pill">${escapeHtml(status)}</span>
              <span class="execution-pill validation" title="${escapeHtml(validationTitle)}">${escapeHtml(validation)}</span>
            </summary>
            <ol class="execution-round-list">
              ${rounds.map((round) => renderExecutionRound(round, labels)).join("")}
            </ol>
          </details>`;
}

function renderExecutionRound(round, labels) {
  const metrics = Array.isArray(round.metrics) ? round.metrics : [];
  const status = labels.status[round.status] || round.status;
  const validation = labels.validationStatus[round.validationStatus] || round.validationStatus;
  const roundLabel = settings.lang === "zh"
    ? `${labels.roundPrefix} ${round.order} ${labels.roundSuffix}`
    : `${labels.roundPrefix} ${round.order}`;

  return `<li data-status="${escapeHtml(round.status)}" data-validation="${escapeHtml(round.validationStatus)}">
            <div class="execution-round-main">
              <strong>${escapeHtml(roundLabel)} · ${escapeHtml(localized(round.label))}</strong>
              <p>${escapeHtml(localized(round.message))}</p>
              <em>${escapeHtml(status)} · ${escapeHtml(labels.validation)}: ${escapeHtml(validation)}</em>
            </div>
            ${metrics.length ? `<div class="execution-metrics">${metrics.map(renderExecutionMetric).join("")}</div>` : ""}
          </li>`;
}

function renderExecutionMetric(metricItem) {
  return `<span><b>${escapeHtml(metricItem.value)}</b><em>${escapeHtml(localized(metricItem.label))}</em></span>`;
}

function renderJobStatus(job) {
  if (!job) return "";
  const tasks = Array.isArray(job.tasks) ? job.tasks : [];
  const flowTasks = tasks;
  const failures = Array.isArray(job.failures) ? job.failures : [];
  const recovery = Array.isArray(job.recovery) ? job.recovery : [];
  const confirmationOnly = jobHasOnlyConfirmationBlocks(job);
  const progress = job.progress || {};
  const derivedTotal = flowTasks.length;
  const derivedCompleted = flowTasks.filter((item) => item.status === "completed").length;
  const storedTotal = Number(progress.total || 0);
  const storedCompleted = Number(progress.completed || 0);
  const total = storedTotal || derivedTotal || 0;
  const completed = Math.min(total, storedCompleted || derivedCompleted || 0);
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const labels = settings.lang === "zh"
    ? {
        title: "执行知识库任务",
        created: "创建时间",
        updated: "更新时间",
        files: "文件",
        documents: "资料",
        taskStatus: "任务状态",
        currentStep: "当前步骤",
        activity: "实时回显",
        activityHint: "自动刷新中",
        progress: "推进进度",
        tasks: "任务",
        nextTask: "下一步",
        flow: "执行流程",
        clickStep: "点击节点定位对应回显",
        runSummary: "总进度",
        currentPrefix: "当前",
        taskComplete: "任务已完成",
        stepProgress: "节点",
        noArtifacts: "这一步还没有产物。",
        details: "任务详情",
        planDetails: "查看完整计划",
        planSummary: "创建任务时生成的路线图，默认收起，只用于追溯。",
        planStages: "步骤",
        planRounds: "轮",
        confirmationDetails: "查看执行前确认",
        confirmationSummary: "上传、OCR、向量化和写入知识库会在真正执行前再次确认。",
        noCurrentStep: "没有等待处理的步骤。",
        none: "无",
        artifacts: "本地产物",
        testResult: "测试结果",
        expectedArtifacts: "正式执行预计产物",
        test: "测试",
        failures: "失败恢复",
        confirmTask: "待确认",
        status: {
          waiting: "等待中",
          running: "执行中",
          completed: "已完成",
          blocked: confirmationOnly ? "待确认" : "需处理",
          failed: "失败",
          skipped: "未执行",
          paused: "已暂停",
          stopped: "已终止",
        },
        open: "进入任务页"
      }
    : {
        title: "Run Knowledge Base Job",
        created: "Created",
        updated: "Updated",
        files: "Files",
        documents: "Sources",
        taskStatus: "Job status",
        currentStep: "Current step",
        activity: "Live Log",
        activityHint: "Auto-refreshing",
        progress: "Progress",
        tasks: "Tasks",
        nextTask: "Next step",
        flow: "Execution Flow",
        clickStep: "Click a node to locate its log line",
        runSummary: "Overall progress",
        currentPrefix: "Current",
        taskComplete: "Job complete",
        stepProgress: "Node",
        noArtifacts: "No artifacts yet for this step.",
        details: "Task details",
        planDetails: "View full plan",
        planSummary: "The route generated before task creation. Collapsed by default for reference.",
        planStages: "stages",
        planRounds: "rounds",
        confirmationDetails: "View run confirmations",
        confirmationSummary: "Upload, OCR, embedding, and knowledge-base writes are confirmed before they run.",
        noCurrentStep: "No step is waiting.",
        none: "None",
        artifacts: "Local outputs",
        testResult: "Test Result",
        expectedArtifacts: "Expected full-run artifacts",
        test: "Test",
        failures: "Recovery",
        confirmTask: "Confirm",
        status: {
          waiting: "Waiting",
          running: "Running",
          completed: "Complete",
          blocked: confirmationOnly ? "Confirm" : "Needs work",
          failed: "Failed",
          skipped: "Not run",
          paused: "Paused",
          stopped: "Stopped",
        },
        open: "Open Tasks"
      };
  const statusLabel = labels.status[job.status] || job.status;
  const currentTask = currentJobTask(flowTasks, job.status);
  const selectedTask = selectedJobTask(flowTasks, currentTask);
  const selectedKey = selectedTask?.key || currentTask?.key || "";
  const currentLabel = job.status === "completed"
    ? labels.taskComplete
    : currentTask ? localized(currentTask.label) : labels.noCurrentStep;
  const stateLabel = job.status === "completed" ? currentLabel : `${labels.currentPrefix}: ${currentLabel}`;
  const summaryLine = `${progressPercent}% · ${completed}/${total} · ${stateLabel}`;
  const runSummary = { progressPercent, summaryLine, statusLabel };

  return `<section class="job-status" data-job-status="${escapeHtml(job.status || "unknown")}">
            ${renderJobFlowMap(flowTasks, selectedKey, labels)}
            ${renderJobLogStream(job, labels, currentTask, runSummary)}
            ${failures.length ? `<div class="run-blockers"><strong>${escapeHtml(labels.failures)}</strong><ul>${recovery.map((item) => {
              return `<li><span>${escapeHtml(localized(item.message))}</span><a href="${escapeHtml(item.href)}">${escapeHtml(localized(item.label))}</a></li>`;
            }).join("")}</ul></div>` : ""}
            <section class="job-disclosures">
              ${renderJobTaskDetails(job, labels, statusLabel)}
              ${renderJobPlanDetails(job.executionPlan, labels)}
              ${renderJobArtifacts(job.artifacts, labels)}
              ${renderJobConfirmationDetails(job.cloudConfirmation, labels)}
            </section>
          </section>`;
}
function currentJobTask(tasks = [], jobStatus = "") {
  const running = tasks.find((item) => item.status === "running");
  const failed = tasks.find((item) => item.status === "failed");
  const waiting = tasks.find((item) => item.status === "waiting");
  const blocked = tasks.find((item) => item.status === "blocked");
  if (jobStatus === "blocked") return running || failed || blocked || waiting || null;
  return running || failed || waiting || blocked || (jobStatus === "completed" ? tasks.filter((item) => item.status === "completed").at(-1) : null);
}

function selectedJobTask(tasks = [], currentTask = null) {
  if (activeJobStepKey) {
    const selected = tasks.find((item) => item.key === activeJobStepKey);
    if (selected) return selected;
  }
  return currentTask || tasks[0] || null;
}

function jobHasOnlyConfirmationBlocks(job) {
  if (!job || job.status !== "blocked") return false;
  const failures = Array.isArray(job.failures) ? job.failures : [];
  const tasks = Array.isArray(job.tasks) ? job.tasks : [];
  return failures.length === 0 && tasks.some((item) => item.status === "blocked");
}

function renderJobFlowMap(tasks, selectedKey, labels) {
  const items = Array.isArray(tasks) ? tasks : [];
  if (!items.length) return "";
  return `<section class="job-pipeline" aria-label="${escapeHtml(labels.flow)}" data-selected-job-step="${escapeHtml(selectedKey)}">
            <header>
              <strong>${escapeHtml(labels.flow)}</strong>
              <span>${escapeHtml(labels.clickStep)}</span>
            </header>
            <ol>
              ${items.map((item, index) => {
                const status = item.status === "blocked" && isCloudConfirmationTask(item)
                  ? labels.confirmTask
                  : labels.status[item.status] || item.status;
                const selected = item.key === selectedKey;
                return `<li data-status="${escapeHtml(item.status)}">
                  <button type="button" data-job-step-button="${escapeHtml(item.key)}" data-selected="${selected ? "true" : "false"}" aria-pressed="${selected ? "true" : "false"}">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <strong>${escapeHtml(localized(item.label))}</strong>
                    <em>${escapeHtml(status)}</em>
                  </button>
                </li>`;
              }).join("")}
            </ol>
          </section>`;
}
function renderJobLogStream(job, labels, currentTask = null, summary = {}) {
  const events = normalizeJobEvents(job.events);
  if (events.length) {
    const visibleLimit = jobLogVisibleLimit(job, currentTask);
    const filteredEvents = jobLogFilteredEvents(events, currentTask);
    const visibleEvents = filteredEvents.slice(-visibleLimit).reverse();
    const filterActive = filteredEvents.length < events.length;
    return `<section class="job-log-stream" role="log" aria-live="polite">
              ${renderJobLogHeader(labels, visibleLimit, currentTask, filterActive)}
              ${renderJobSummaryLogLine(job, labels, summary)}
              <ol>
                ${renderJobHeartbeatLogLine(job, labels, currentTask)}
                ${visibleEvents.map((event, index) => renderJobEventLine(event, labels, index)).join("")}
              </ol>
              ${filteredEvents.length > visibleLimit ? `<details class="job-full-log" data-job-disclosure="full-log">
                <summary>${escapeHtml(settings.lang === "zh" ? "查看全部回显" : "View all log lines")}</summary>
                <ol>
                  ${filteredEvents.slice().reverse().map((event, index) => renderJobEventLine(event, labels, index)).join("")}
                </ol>
              </details>` : ""}
            </section>`;
  }

  const allItems = Array.isArray(job.tasks) ? job.tasks : [];
  const selectedKey = activeJobStepKey || currentTask?.key || "";
  const logItems = jobLogFilterMode === "current" && selectedKey
    ? allItems.filter((item) => item.key === selectedKey)
    : allItems;
  const current = currentTask && (!selectedKey || currentTask.key === selectedKey)
    ? currentTask
    : logItems.find((item) => item.status === "running" || item.status === "waiting" || item.status === "blocked" || item.status === "failed")
      || logItems.at(-1);
  const visibleLimit = jobLogVisibleLimit(job, current);
  const historyItems = logItems
    .filter((item) => item.key !== current?.key)
    .filter((item) => item.status !== "waiting")
    .slice(0, Math.max(0, visibleLimit - 1));
  if (!current && !historyItems.length) return "";
  return `<section class="job-log-stream" role="log" aria-live="polite">
            ${renderJobLogHeader(labels, visibleLimit, current, jobLogFilterMode === "current" && Boolean(selectedKey))}
            ${renderJobSummaryLogLine(job, labels, summary)}
            <ol>
              ${renderJobHeartbeatLogLine(job, labels, current)}
              ${current ? renderJobLogLine(job, current, 1, labels, { current: true }) : ""}
              ${historyItems.map((item, index) => renderJobLogLine(job, item, index + 2, labels)).join("")}
            </ol>
            ${logItems.length > visibleLimit ? `<details class="job-full-log" data-job-disclosure="full-log">
              <summary>${escapeHtml(settings.lang === "zh" ? "查看全部回显" : "View all log lines")}</summary>
              <ol>
                ${logItems.map((item, index) => renderJobLogLine(job, item, index, labels)).join("")}
              </ol>
            </details>` : ""}
          </section>`;
}

function renderJobLogHeader(labels, visibleLimit, currentTask = null, filterActive = false) {
  const allText = settings.lang === "zh" ? "全部" : "All";
  const currentText = settings.lang === "zh" ? "当前步骤" : "Current";
  const currentLabel = localized(currentTask?.label) || currentText;
  const hint = filterActive
    ? (settings.lang === "zh" ? `只显示“${currentLabel}”相关回显` : `Only showing ${currentLabel}`)
    : jobLogVisibleHint(visibleLimit);
  const label = settings.lang === "zh" ? "回显范围" : "Log scope";
  return `<header>
            <strong>${escapeHtml(labels.activity)}</strong>
            <div class="job-log-header-side">
              <span>${escapeHtml(hint)}</span>
              <div class="job-log-filter" role="group" aria-label="${escapeHtml(label)}">
                <button type="button" data-job-log-filter="all" aria-pressed="${jobLogFilterMode === "all" ? "true" : "false"}">${escapeHtml(allText)}</button>
                <button type="button" data-job-log-filter="current" aria-pressed="${jobLogFilterMode === "current" ? "true" : "false"}">${escapeHtml(currentText)}</button>
              </div>
            </div>
          </header>`;
}

function jobLogFilteredEvents(events, currentTask = null) {
  if (jobLogFilterMode !== "current") return events;
  const taskKey = activeJobStepKey || currentTask?.key || "";
  if (!taskKey) return events;
  return events.filter((event) => (event.taskKey || "") === taskKey);
}
function jobLogVisibleLimit(job, currentTask = null) {
  const runningTaskKey = Array.isArray(job?.tasks) ? job.tasks.find((item) => item.status === "running")?.key : "";
  const taskKey = runningTaskKey || currentTask?.key || "";
  const batchTaskKeys = new Set(["ocr", "embedding", "index", "upload"]);
  return job?.status === "running" && batchTaskKeys.has(taskKey) ? 50 : 30;
}

function jobLogVisibleHint(limit) {
  return settings.lang === "zh" ? `默认显示最近 ${limit} 条` : `Showing latest ${limit} lines`;
}

function normalizeJobEvents(events) {
  return Array.isArray(events)
    ? events.filter((event) => event && typeof event === "object")
    : [];
}

function renderJobHeartbeatLogLine(job, labels, currentTask = null) {
  if (!job || job.status !== "running") return "";
  const task = currentTask || (Array.isArray(job.tasks) ? job.tasks.find((item) => item.status === "running") : null);
  const label = localized(task?.label) || (settings.lang === "zh" ? "当前步骤" : "current step");
  const startedAt = Date.parse(task?.startedAt || job.updatedAt || job.createdAt || "");
  const elapsed = Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const message = settings.lang === "zh"
    ? `正在${label}，已运行 ${formatJobElapsed(elapsed)}；页面会持续刷新，不需要重复点击。`
    : `Running ${label} for ${formatJobElapsed(elapsed)}. This page keeps refreshing; no repeat click is needed.`;
  return `<li class="job-log-heartbeat" data-status="running" data-log-kind="heartbeat" data-job-log-step="${escapeHtml(task?.key || "")}">
            <time>${escapeHtml(formatLocalTime(new Date()))}</time>
            <code>${escapeHtml(settings.lang === "zh" ? "持续回显" : "heartbeat")}</code>
            <span>${escapeHtml(labels.status.running || eventStatusLabel("running"))}</span>
            <p>${escapeHtml(message)}</p>
          </li>`;
}

function formatJobElapsed(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  if (safe < 60) return settings.lang === "zh" ? `${safe} 秒` : `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return settings.lang === "zh" ? `${minutes} 分 ${rest} 秒` : `${minutes}m ${rest}s`;
}

function renderJobEventLine(event, labels, index) {
  const statusKey = event.status || "info";
  const status = labels.status[statusKey] || eventStatusLabel(statusKey);
  const type = event.type || "event";
  const taskKey = event.taskKey || "";
  const prompt = taskKey ? `${eventTypeLabel(type)} ${taskKey}` : eventTypeLabel(type);
  const message = localized(event.message) || localized(event.label) || prompt;
  return `<li data-status="${escapeHtml(statusKey)}" data-log-kind="event" data-job-log-step="${escapeHtml(taskKey)}">
            <time>${escapeHtml(formatJobEventTime(event.timestamp, index))}</time>
            <code>${escapeHtml(prompt)}</code>
            <span>${escapeHtml(status)}</span>
            <p title="${escapeHtml(message)}"><strong class="job-log-message">${escapeHtml(message)}</strong>${renderJobEventMetrics(event.detail)}</p>
          </li>`;
}

function renderJobEventMetrics(detail = null) {
  if (!detail || typeof detail !== "object") return "";
  const progress = detail.progress && typeof detail.progress === "object" ? detail.progress : detail;
  const result = detail.result && typeof detail.result === "object" ? detail.result : detail;
  const items = [];
  if (progress.batch && progress.totalBatches) {
    items.push(settings.lang === "zh" ? `批次 ${progress.batch}/${progress.totalBatches}` : `Batch ${progress.batch}/${progress.totalBatches}`);
  }
  if (Number.isFinite(Number(progress.completed)) && Number.isFinite(Number(progress.total)) && Number(progress.total) > 0) {
    items.push(settings.lang === "zh" ? `累计 ${progress.completed}/${progress.total}` : `${progress.completed}/${progress.total} done`);
  }
  if (Number(progress.remaining) > 0) {
    items.push(settings.lang === "zh" ? `剩余 ${progress.remaining}` : `${progress.remaining} left`);
  }
  if (Number(result.failed) > 0) {
    items.push(settings.lang === "zh" ? `失败 ${result.failed}` : `${result.failed} failed`);
  }
  if (Number(result.retry) > 0) {
    items.push(settings.lang === "zh" ? `重试 ${result.retry}` : `${result.retry} retry`);
  }
  if (!items.length) return "";
  const text = items.join(" · ");
  return `<small class="job-log-metrics" title="${escapeHtml(text)}">${items.map((item) => `<b>${escapeHtml(item)}</b>`).join("")}</small>`;
}

function eventTypeLabel(type = "") {
  const zh = settings.lang === "zh";
  const labels = zh
    ? {
        "job-action": "操作",
        "step-start": "开始",
        "step-complete": "完成",
        "step-failed": "失败",
        "step-skip": "跳过",
        "job-event": "事件",
        "task-detail": "进度",
        "checkpoint": "检查点",
        "job-paused": "暂停",
        "job-resumed": "恢复",
        "job-pause-requested": "暂停请求",
        "job-repaired": "状态修复"
      }
    : {
        "job-action": "action",
        "step-start": "start",
        "step-complete": "done",
        "step-failed": "fail",
        "step-skip": "skip",
        "job-event": "event",
        "task-detail": "progress",
        "checkpoint": "checkpoint",
        "job-paused": "pause",
        "job-resumed": "resume",
        "job-pause-requested": "pause request",
        "job-repaired": "state repair"
      };
  return labels[type] || type || labels["job-event"];
}

function eventStatusLabel(status = "") {
  const zh = settings.lang === "zh";
  const labels = zh
    ? { info: "信息", waiting: "等待中", running: "执行中", completed: "已完成", failed: "失败", warn: "提醒", paused: "已暂停", stopped: "已终止" }
    : { info: "Info", waiting: "Waiting", running: "Running", completed: "Complete", failed: "Failed", warn: "Notice", paused: "Paused", stopped: "Stopped" };
  return labels[status] || status || labels.info;
}

function formatJobEventTime(timestamp, index) {
  return formatLocalTime(timestamp, index === 0 ? "now" : "--:--:--");
}

function formatLocalTime(value, fallback = "--:--:--") {
  const date = value instanceof Date ? value : new Date(value || "");
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat(settings.lang === "zh" ? "zh-CN" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date);
}
function renderJobSummaryLogLine(job, labels, summary = {}) {
  const percent = Math.max(0, Math.min(100, Number(summary.progressPercent || 0)));
  const statusLabel = summary.statusLabel || (labels.status[job.status] || job.status || labels.none);
  const message = summary.summaryLine || `${percent}%`;
  const compactMessage = String(message).replace(/^\s*\d+%\s*·\s*/, "");
  return `<div class="job-log-summary" data-status="${escapeHtml(job.status || "unknown")}" data-job-log-summary>
            <div class="job-log-summary-percent">
              <strong>${escapeHtml(`${percent}%`)}</strong>
              <span>${escapeHtml(labels.runSummary)}</span>
            </div>
            <div class="job-log-summary-copy">
              <div class="job-log-summary-meta">
                <time>${escapeHtml(formatLocalTime(job.updatedAt || job.createdAt))}</time>
                <span>${escapeHtml(statusLabel)}</span>
              </div>
              <p>${escapeHtml(compactMessage)}</p>
            </div>
            <i class="job-log-meter" aria-label="${escapeHtml(labels.runSummary)} ${escapeHtml(percent)}%">
              <b style="width:${escapeHtml(percent)}%"></b>
            </i>
          </div>`;
}
function renderJobLogLine(job, item, index, labels, options = {}) {
  const status = item.status === "blocked" && isCloudConfirmationTask(item)
    ? labels.confirmTask
    : labels.status[item.status] || item.status;
  const prompt = jobLogPrompt(item);
  const title = options.current ? labels.currentStep : prompt;
  return `<li class="${options.current ? "job-log-current" : ""}" data-status="${escapeHtml(item.status)}" data-job-log-step="${escapeHtml(item.key)}">
            <time>${escapeHtml(jobLogTime(job, item, index))}</time>
            <code>${escapeHtml(title)}</code>
            <span>${escapeHtml(status)}</span>
            <p>${escapeHtml(localized(item.message))}</p>
          </li>`;
}

function jobLogPrompt(item) {
  const zh = settings.lang === "zh";
  const verbs = zh
    ? {
        waiting: "等待",
        running: "执行",
        completed: "完成",
        blocked: "阻塞",
        failed: "失败",
        skipped: "未执行",
        paused: "暂停",
        stopped: "终止"
      }
    : {
        waiting: "wait",
        running: "run",
        completed: "done",
        blocked: "block",
        failed: "fail",
        skipped: "not-run",
        paused: "pause",
        stopped: "stop"
      };
  return `${verbs[item.status] || item.status} ${item.key}`;
}

function jobLogTime(job, item, index) {
  if (item.status === "completed" || item.status === "failed" || item.status === "stopped") return formatLocalTime(job.updatedAt || job.createdAt);
  if (index === 0) return formatLocalTime(job.createdAt);
  return "--:--:--";
}

function renderJobTaskDetails(job, labels, statusLabel) {
  return `<details class="job-disclosure job-disclosure--task" data-job-disclosure="task">
            <summary>
              <span>${escapeHtml(labels.details)}</span>
              <em>${escapeHtml(statusLabel)}</em>
            </summary>
            <div class="job-meta-grid">
              <span><b>${escapeHtml(statusLabel)}</b><em>${escapeHtml(labels.taskStatus)}</em></span>
              <span><b>${escapeHtml(job.summary?.includedFiles ?? 0)}</b><em>${escapeHtml(labels.files)}</em></span>
              <span><b>${escapeHtml(job.summary?.logicalDocuments ?? 0)}</b><em>${escapeHtml(labels.documents)}</em></span>
              <span><b>${escapeHtml(job.createdAt || "")}</b><em>${escapeHtml(labels.created)}</em></span>
              <span><b>${escapeHtml(job.updatedAt || job.createdAt || "")}</b><em>${escapeHtml(labels.updated)}</em></span>
            </div>
          </details>`;
}

function renderJobPlanDetails(plan, labels) {
  if (!plan || !Array.isArray(plan.stages) || !plan.stages.length) return "";
  const summary = plan.summary || {};
  const meta = [
    `${summary.totalStages ?? plan.stages.length} ${labels.planStages}`,
    `${summary.totalRounds ?? 0} ${labels.planRounds}`
  ].join(" · ");
  return `<details class="job-disclosure job-disclosure--plan" data-job-disclosure="plan">
            <summary>
              <span>${escapeHtml(labels.planDetails)}</span>
              <em>${escapeHtml(meta)}</em>
            </summary>
            <p>${escapeHtml(labels.planSummary)}</p>
            ${renderExecutionPlan(plan)}
          </details>`;
}

function renderJobConfirmationDetails(cloud, labels) {
  if (!cloud || !Array.isArray(cloud.steps) || !cloud.steps.length) return "";
  const summary = cloud.summary || {};
  const meta = `${summary.confirmationRequired ?? 0} ${settings.lang === "zh" ? "项待确认" : "confirmations"}`;
  return `<details class="job-disclosure job-disclosure--confirmation" data-job-disclosure="confirmation" id="confirm">
            <summary>
              <span>${escapeHtml(labels.confirmationDetails)}</span>
              <em>${escapeHtml(meta)}</em>
            </summary>
            <p>${escapeHtml(labels.confirmationSummary)}</p>
            ${renderCloudConfirmation(cloud)}
          </details>`;
}

function renderCloudConfirmation(cloud) {
  if (!cloud || !Array.isArray(cloud.steps) || !cloud.steps.length) return "";
  const summary = cloud.summary || {};
  const labels = settings.lang === "zh"
    ? {
        total: "确认项",
        ready: "已就绪",
        blocked: "待处理",
        confirm: "执行前确认",
        required: "执行前确认",
        status: {
          pass: "已通过",
          fail: "需配置",
          blocked: "需处理",
          confirm_later: "执行前确认",
          warn: "需留意"
        }
      }
    : {
        total: "Steps",
        ready: "Ready",
        blocked: "Needs work",
        confirm: "Before Run",
        required: "Before Run",
        status: {
          pass: "Passed",
          fail: "Configure",
          blocked: "Needs work",
          confirm_later: "Before Run",
          warn: "Review"
        }
      };
  return `<section class="cloud-confirmation">
            <header>
              <div>
                <h4>${escapeHtml(localized(cloud.title))}</h4>
                <p>${escapeHtml(localized(cloud.message))}</p>
              </div>
              <div class="cloud-confirmation-summary">
                <span><b>${escapeHtml(summary.totalSteps ?? cloud.steps.length)}</b><em>${escapeHtml(labels.total)}</em></span>
                <span><b>${escapeHtml(summary.readySteps ?? 0)}</b><em>${escapeHtml(labels.ready)}</em></span>
                <span><b>${escapeHtml(summary.blockedSteps ?? 0)}</b><em>${escapeHtml(labels.blocked)}</em></span>
                <span><b>${escapeHtml(summary.confirmationRequired ?? 0)}</b><em>${escapeHtml(labels.confirm)}</em></span>
              </div>
            </header>
            <ol class="cloud-confirmation-list">
              ${cloud.steps.map((step) => {
                const status = labels.status[step.status] || step.status;
                const action = localized(step.actionLabel) || status;
                const actionLink = step.href && step.status !== "confirm_later"
                  ? `<a href="${escapeHtml(step.href)}">${escapeHtml(action)}</a>`
                  : "";
                return `<li data-status="${escapeHtml(step.status)}" data-confirmation="${step.confirmationRequired ? "required" : "ready"}">
                  <div>
                    <span>${escapeHtml(status)}</span>
                    <strong>${escapeHtml(localized(step.label))}</strong>
                    <p>${escapeHtml(localized(step.message))}</p>
                  </div>
                  ${step.confirmationRequired ? `<em>${escapeHtml(labels.required)}</em>` : ""}
                  ${actionLink}
                </li>`;
              }).join("")}
            </ol>
          </section>`;
}

function renderJobArtifacts(artifacts, labels) {
  const items = Array.isArray(artifacts) ? artifacts : [];
  if (!items.length) return "";
  const countLabel = settings.lang === "zh" ? `${items.length} 项` : `${items.length} item${items.length === 1 ? "" : "s"}`;
  return `<details class="job-artifacts" id="job-artifacts" data-job-disclosure="artifacts">
            <summary>
              <span>${escapeHtml(labels.artifacts)}</span>
              <em>${escapeHtml(countLabel)}</em>
            </summary>
            <ul class="job-artifact-list">${items.map((item) => {
              return `<li data-status="${escapeHtml(item.status || "created")}">
                <div>
                  <span>${escapeHtml(localized(item.label))}</span>
                  <em>${escapeHtml(localized(item.message))}</em>
                </div>
                <code title="${escapeHtml(item.path || "")}">${escapeHtml(item.path || "")}</code>
              </li>`;
            }).join("")}</ul>
          </details>`;
}

function renderJobTestResult(testResult) {
  if (!testResult) return "";
  const checks = Array.isArray(testResult.checks) ? testResult.checks : [];
  const artifacts = Array.isArray(testResult.artifacts) ? testResult.artifacts : [];
  const expectedArtifacts = Array.isArray(testResult.expectedArtifacts) ? testResult.expectedArtifacts : [];
  const labels = settings.lang === "zh"
    ? {
        title: "步骤测试结果",
        checkedAt: "测试时间",
        task: "测试步骤",
        checks: "测试项",
        report: "测试报告",
        expected: "正式执行预计产物"
      }
    : {
        title: "Step Test Result",
        checkedAt: "Checked",
        task: "Step",
        checks: "Checks",
        report: "Test report",
        expected: "Expected full-run artifacts"
      };
  return `<section class="job-test-result">
            <h3>${escapeHtml(labels.title)}</h3>
            <div class="job-test-meta">
              <span><b>${escapeHtml(localized(testResult.task?.label) || testResult.task?.key || "")}</b><em>${escapeHtml(labels.task)}</em></span>
              <span><b>${escapeHtml(testResult.checkedAt || "")}</b><em>${escapeHtml(labels.checkedAt)}</em></span>
            </div>
            <div class="job-test-section">
              <strong>${escapeHtml(labels.checks)}</strong>
              <ul>${checks.map((item) => `<li data-status="${escapeHtml(item.status)}"><span>${escapeHtml(localized(item.label))}</span><em>${escapeHtml(localized(item.message))}</em></li>`).join("")}</ul>
            </div>
            ${artifacts.length ? `<div class="job-test-section"><strong>${escapeHtml(labels.report)}</strong><ul>${artifacts.map((item) => `<li data-status="${escapeHtml(item.status || "created")}"><span>${escapeHtml(localized(item.label))}</span><code title="${escapeHtml(item.path || "")}">${escapeHtml(item.path || "")}</code></li>`).join("")}</ul></div>` : ""}
            ${renderJobFilterPreview(testResult.filterPreview)}
            ${expectedArtifacts.length ? `<div class="job-test-section"><strong>${escapeHtml(labels.expected)}</strong><ul>${expectedArtifacts.map((item) => `<li><span>${escapeHtml(localized(item.label))}</span><code title="${escapeHtml(item.path || "")}">${escapeHtml(item.path || "")}</code></li>`).join("")}</ul></div>` : ""}
          </section>`;
}

function renderJobFilterPreview(filterPreview) {
  if (!filterPreview) return "";
  const summary = filterPreview.summary || {};
  const groups = Array.isArray(filterPreview.ruleGroups) ? filterPreview.ruleGroups : [];
  const records = Array.isArray(filterPreview.records) ? filterPreview.records : [];
  const labels = settings.lang === "zh"
    ? {
        title: "过滤预览",
        filtered: "命中",
        removed: "删除",
        metadata: "转元数据",
        review: "待确认",
        samples: "命中样例"
      }
    : {
        title: "Filter Preview",
        filtered: "Matched",
        removed: "Removed",
        metadata: "Metadata",
        review: "Review",
        samples: "Samples"
      };
  return `<div class="job-filter-preview">
            <strong>${escapeHtml(labels.title)}</strong>
            <div class="job-filter-summary">
              <span><b>${escapeHtml(summary.filteredItems ?? 0)}</b><em>${escapeHtml(labels.filtered)}</em></span>
              <span><b>${escapeHtml(summary.removedItems ?? 0)}</b><em>${escapeHtml(labels.removed)}</em></span>
              <span><b>${escapeHtml(summary.metadataOnlyItems ?? 0)}</b><em>${escapeHtml(labels.metadata)}</em></span>
              <span><b>${escapeHtml(summary.reviewRequired ?? 0)}</b><em>${escapeHtml(labels.review)}</em></span>
            </div>
            ${groups.length ? `<div class="job-filter-groups">${groups.map((group) => `<span><b>${escapeHtml(group.count ?? 0)}</b><em>${escapeHtml(localized(group.label) || group.action || group.key)}</em></span>`).join("")}</div>` : ""}
            ${records.length ? `<div class="job-filter-records"><em>${escapeHtml(labels.samples)}</em><ul>${records.map((item) => `<li data-action="${escapeHtml(item.action)}"><span>${escapeHtml(item.rule_id)}</span><code title="${escapeHtml(item.original_text || "")}">${escapeHtml(item.original_text || "")}</code><small>${escapeHtml(localized(item.reason) || item.action)}</small></li>`).join("")}</ul></div>` : ""}
          </div>`;
}

function isCloudConfirmationTask(taskItem = {}) {
  return ["upload", "ocr", "embedding", "index"].includes(taskItem.key);
}

function updateDraftSaveState(status) {
  const key = status === "saving"
    ? "setup.draftSaving"
    : status === "local"
      ? "setup.draftLocal"
      : "setup.draftSaved";
  const fallback = settings.lang === "zh"
    ? (status === "saving" ? "正在保存..." : status === "local" ? "已保存在本机浏览器。" : "已保存。")
    : (status === "saving" ? "Saving..." : status === "local" ? "Saved in this browser." : "Saved.");
  document.querySelectorAll("[data-draft-save-state]").forEach((node) => {
    node.textContent = translate(key) || fallback;
    node.dataset.status = status;
  });
}

function syncDraftToServer() {
  window.clearTimeout(draftSyncTimer);
  updateDraftSaveState("saving");
  draftSyncTimer = window.setTimeout(async () => {
    try {
      await fetch("/api/setup/draft", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ draft: collectDraftFields({ includeSensitive: false }) })
      });
      updateDraftSaveState("saved");
    } catch {
      updateDraftSaveState("local");
    }
  }, 250);
}

async function syncDraftToServerNow() {
  window.clearTimeout(draftSyncTimer);
  updateDraftSaveState("saving");
  try {
    await fetch("/api/setup/draft", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ draft: collectDraftFields({ includeSensitive: false }) })
    });
    updateDraftSaveState("saved");
    return true;
  } catch {
    updateDraftSaveState("local");
    return false;
  }
}

async function loadSetupState() {
  try {
    const response = await fetch("/api/setup/state", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    restoreSetupProgressFromServer(data);
    if (data.draft && typeof data.draft === "object") {
      Object.assign(draftState, data.draft);
      writeDraft(draftState);
      applyDraftValues();
    }
    if (data.credential?.configured) showSavedCredential(data.credential);
    else clearSavedCredentialState();
    if (data.modelProvider?.configured) applySavedModelProvider(data.modelProvider);
    else applySavedModelProvider(null);
    if (data.modelQuality?.configured) applySavedModelQuality(data.modelQuality, { silent: true });
    else applySavedModelQuality(null);
    if (data.retrievalStrategy?.configured) applySavedRetrievalStrategy(data.retrievalStrategy, { silent: true });
    else applySavedRetrievalStrategy(null);
    if (data.search?.configured) applySavedSearch(data.search, { silent: true });
    else applySavedSearch(null);
    applyConfigSummary();
  } catch {
    // Setup state is local convenience state.
  } finally {
    setupStateLoaded = true;
    applyAll();
  }
}

function restoreSetupProgressFromServer(data) {
  const completed = inferCompletedSetupSteps(data);
  if (!completed.size) return;

  const mode = inferSetupModeFromServer(data);
  if (mode && mode !== settings.mode) {
    settings.mode = mode;
  }

  const template = inferSetupTemplateFromServer(data);
  if (template && template !== settings.template) {
    settings.template = template;
  }

  const merged = readSetupCompleted();
  const savedCompleted = Array.isArray(data?.draft?.["setup.completedSteps"])
    ? data.draft["setup.completedSteps"]
    : [];
  savedCompleted.forEach((key) => merged.add(key));
  completed.forEach((key) => merged.add(key));
  writeSetupCompleted(merged, { sync: false });
}

function inferCompletedSetupSteps(data) {
  const draft = data?.draft || {};
  const mode = inferSetupModeFromServer(data);
  const completed = inferCompletedSetupStepsFromDraft(draft, mode);
  if (mode === "aliyun") {
    if (draft["aliyun.account.method"] || data?.credential?.configured) completed.add("aliyun-account");
    if (data?.credential?.configured) completed.add("aliyun-credential");
    if (data?.credential?.configured || draft["aliyun.storage.confirmed"]) completed.add("aliyun-permissions");
    if (draft["aliyun.storage.confirmed"] || (draft["aliyun.storage.bucket"] && draft["aliyun.search.bucket"])) completed.add("aliyun-storage");
    if (data?.modelProvider?.configured || draft["aliyun.model.apiKey.configured"]) completed.add("aliyun-services");
    if (data?.modelQuality?.configured || draft["aliyun.services.modelQuality.configured"]) completed.add("aliyun-model-quality");
    if (data?.search?.configured || draft["aliyun.search.configured"]) completed.add("aliyun-search");
  }
  if (inferSetupTemplateFromServer(data)) completed.add("template");
  if (data?.retrievalStrategy?.configured || draft["retrieval.strategy.configured"]) completed.add("retrieval");
  if (draft["project.source"] && draft["project.workspace"] && sourceScopeLooksComplete(draft)) completed.add("project");
  if (completed.has("project") && completed.has("retrieval") && (mode !== "aliyun" || completed.has("aliyun-search"))) completed.add("environment");
  return completed;
}

function inferSetupModeFromServer(data) {
  const draft = data?.draft || {};
  if (draft["setup.mode"] === "local" || draft.mode === "local") return "local";
  if (data?.credential?.configured || data?.modelProvider?.configured || data?.search?.configured) return "aliyun";
  return settings.mode;
}

function inferSetupTemplateFromServer(data) {
  const draft = data?.draft || {};
  const explicit = draft["template.id"] || draft.template;
  if (initialTemplateIds.includes(explicit)) return explicit;
  if (Array.isArray(draft["metadata.stage"]) || Array.isArray(draft["metadata.subject"]) || Array.isArray(draft["metadata.grade"])) {
    if (initialTemplateIds.includes("textbook-cn-k12")) return "textbook-cn-k12";
  }
  return initialTemplateIds.includes(settings.template) ? settings.template : pageState.defaultTemplateId;
}

function sourceScopeLooksComplete(draft) {
  return sourceScopeRequiredKeys.every((key) => Array.isArray(draft[key]) ? draft[key].length > 0 : Boolean(draft[key]));
}

function applyDraftValues() {
  document.querySelectorAll("[data-draft-field]").forEach((field) => {
    const key = field.dataset.draftField;
    if (!key || field.dataset.draftSensitive === "true") return;
    if (draftState[key] !== undefined && field.dataset.draftMultiValue === "true") {
      field.value = JSON.stringify(normalizeMultiSelectValue(draftState[key]));
    } else if (draftState[key] !== undefined) {
      field.value = draftState[key];
    }
  });
  syncCredentialSaveOptions();
  applyK12RangeFields();
  applyAccountMethod();
  applyConfigSummary();
  applyModelProviderContext();
  applyModelQualityModelCards();
  applyRetrievalStrategyCards();
}

function showSavedCredential(credential) {
  applySavedCredential(credential, { silent: true });
}

function clearSavedCredentialState() {
  delete draftState["aliyun.credential.accessKeySecret.configured"];
  delete draftState["aliyun.credential.accessKeySecret.pending"];
  delete draftState["aliyun.credential.accessKeySecret"];
  writeDraft(draftState);
  applyCredentialSavedVisualState(null);
  applyConfigSummary();
}

function applySavedCredential(credential, options = {}) {
  if (!credential?.configured) {
    clearSavedCredentialState();
    return;
  }
  draftState["aliyun.credential.accessKeySecret.configured"] = true;
  delete draftState["aliyun.credential.accessKeySecret.pending"];
  delete draftState["aliyun.credential.accessKeySecret"];
  writeDraft(draftState);
  clearSensitiveFields(settings.lang === "zh" ? "已保存，如需更换请重新粘贴" : "Saved; paste a new Secret to replace it");
  applyCredentialSavedVisualState(credential);
  applyConfigSummary();
  showSavedCredentialResult(credential, options);
}

function showSavedCredentialResult(credential, options = {}) {
  const resultNode = document.querySelector("[data-api-result=\"save-aliyun-credentials\"]");
  if (!resultNode) return;
  const message = settings.lang === "zh"
    ? `已保存本机凭证：${credential.accessKeyId || "已配置"}。`
    : `Local credential saved: ${credential.accessKeyId || "configured"}.`;
  showApiResult(resultNode, "pass", message, "save-aliyun-credentials", { showDialog: false, showToast: options.silent === false });
}

function applyCredentialSavedVisualState(credential) {
  const configured = Boolean(credential?.configured);
  const idField = document.querySelector('[data-draft-field="aliyun.credential.accessKeyId"]');
  const secretField = document.querySelector('[data-draft-field="aliyun.credential.accessKeySecret"]');
  if (!configured) {
    if (idField) delete idField.dataset.credentialMasked;
    if (secretField && !secretField.value) {
      const placeholder = localized(draftField("aliyun.credential.accessKeySecret")?.placeholder);
      if (placeholder) secretField.setAttribute("placeholder", placeholder);
    }
  }
  if (idField && configured && credential.accessKeyId) {
    idField.value = credential.accessKeyId;
    idField.dataset.credentialMasked = "true";
  }
  if (secretField && configured && !secretField.value) {
    secretField.setAttribute("placeholder", settings.lang === "zh" ? "已保存，如需更换请重新粘贴" : "Saved; paste a new Secret to replace it");
  }
  applySavedCredentialActionState(configured);
}

function apiResultStatusLineMessage(data, status, actionKey = "") {
  if (status === "pass" && actionKey === "test-aliyun-model-provider" && data?.modelProvider?.configured) {
    return modelProviderSavedMessage(data.modelProvider);
  }
  if (status === "pass" && actionKey === "save-aliyun-model-quality" && data?.modelQuality?.configured) {
    return modelQualitySavedMessage(data.modelQuality);
  }
  if (status === "pass" && actionKey === "save-aliyun-search" && data?.search?.configured) {
    return searchSavedMessage(data.search);
  }
  if (status === "pass" && actionKey === "save-retrieval-strategy" && data?.retrievalStrategy?.configured) {
    return retrievalStrategySavedMessage(data.retrievalStrategy);
  }
  return apiResultToastMessage(status, actionKey);
}

function modelProviderSavedMessage(modelProvider) {
  const key = modelProvider?.apiKey || (settings.lang === "zh" ? "已配置" : "configured");
  return settings.lang === "zh"
    ? `已保存本机凭证：${key}。`
    : `Local credential saved: ${key}.`;
}

function modelQualitySavedMessage(modelQuality) {
  const label = localized(modelQuality?.profileLabel) || modelQuality?.profile || (settings.lang === "zh" ? "已配置" : "configured");
  return settings.lang === "zh"
    ? `已保存模型方案：${label}。`
    : `Model profile saved: ${label}.`;
}

function searchSavedMessage(search) {
  const index = search?.index || (settings.lang === "zh" ? "已配置" : "configured");
  return settings.lang === "zh"
    ? `已保存索引配置：${index}。`
    : `Index setup saved: ${index}.`;
}

function retrievalStrategySavedMessage(retrievalStrategy) {
  const label = localized(retrievalStrategy?.profileLabel) || retrievalStrategy?.profile || (settings.lang === "zh" ? "已配置" : "configured");
  return settings.lang === "zh"
    ? `已保存问答策略：${label}。`
    : `Answer strategy saved: ${label}.`;
}

function applySavedModelProvider(modelProvider, options = {}) {
  const configured = Boolean(modelProvider?.configured);
  const fields = {
    "aliyun.model.provider": modelProvider?.provider,
    "aliyun.model.protocol": modelProvider?.protocol,
    "aliyun.model.region": modelProvider?.region,
    "aliyun.model.workspaceId": modelProvider?.workspaceId,
    "aliyun.model.baseUrl": modelProvider?.baseUrl
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    draftState[key] = value;
    const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"]`);
    if (field) field.value = value;
  }

  if (configured) {
    draftState["aliyun.model.apiKey.configured"] = true;
    delete draftState["aliyun.model.apiKey.pending"];
    delete draftState["aliyun.model.apiKey"];
    const keyField = document.querySelector('[data-draft-field="aliyun.model.apiKey"]');
    if (keyField) {
      keyField.value = "";
      keyField.setAttribute("placeholder", settings.lang === "zh" ? "已填写，返回时不显示明文" : "Configured; key is not shown again");
    }
  } else {
    delete draftState["aliyun.model.apiKey.configured"];
  }

  writeDraft(draftState);
  showSavedModelProviderResult(modelProvider, options);
  applyModelProviderContext();
}

function showSavedModelProviderResult(modelProvider, options = {}) {
  const resultNode = document.querySelector('[data-api-result="test-aliyun-model-provider"]');
  if (!resultNode) return;
  if (!modelProvider?.configured) {
    resultNode.hidden = true;
    apiResultState.delete(resultNode);
    return;
  }
  showApiChecks(
    resultNode,
    {
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
    },
    "test-aliyun-model-provider",
    { showDialog: false, showToast: options.silent === false }
  );
}

function applySavedModelQuality(modelQuality, options = {}) {
  if (!modelQuality?.configured) {
    const resultNode = document.querySelector('[data-api-result="save-aliyun-model-quality"]');
    if (resultNode) {
      resultNode.hidden = true;
      apiResultState.delete(resultNode);
    }
    delete draftState["aliyun.services.modelQuality.configured"];
    writeDraft(draftState);
    return;
  }

  const fields = {
    "aliyun.services.profile": modelQuality.profile,
    "aliyun.services.ocr": modelQuality.ocr,
    "aliyun.services.organizer": modelQuality.organizer,
    "aliyun.services.embedding": modelQuality.embedding,
    "aliyun.services.rerank": modelQuality.rerank,
    "aliyun.services.modelQuality.configured": true
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === "") continue;
    draftState[key] = value;
    const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"]`);
    if (field) field.value = value;
  }
  writeDraft(draftState);
  applyModelQualityModelCards();
  showSavedModelQualityResult(modelQuality, options);
}

function showSavedModelQualityResult(modelQuality, options = {}) {
  const resultNode = document.querySelector('[data-api-result="save-aliyun-model-quality"]');
  if (!resultNode) return;
  if (!modelQuality?.configured) {
    resultNode.hidden = true;
    apiResultState.delete(resultNode);
    return;
  }
  showApiChecks(
    resultNode,
    {
      ok: true,
      modelQuality,
      checks: [
        {
          key: "modelQualitySaved",
          status: "pass",
          label: { zh: "模型方案", en: "Model profile" },
          message: {
            zh: `${localized(modelQuality.profileLabel) || modelQuality.profile || "已配置"}已保存到本机。`,
            en: `${localized(modelQuality.profileLabel) || modelQuality.profile || "Configured"} saved locally.`
          }
        },
        {
          key: "modelQualityModels",
          status: "pass",
          label: { zh: "已选模型", en: "Selected models" },
          message: {
            zh: `${modelQuality.ocr || ""} / ${modelQuality.organizer || ""} / ${modelQuality.embedding || ""} / ${modelQuality.rerank || ""}`,
            en: `${modelQuality.ocr || ""} / ${modelQuality.organizer || ""} / ${modelQuality.embedding || ""} / ${modelQuality.rerank || ""}`
          }
        }
      ]
    },
    "save-aliyun-model-quality",
    { showDialog: false, showToast: options.silent === false }
  );
}

function applySavedSearch(search, options = {}) {
  if (!search?.configured) {
    const resultNode = document.querySelector('[data-api-result="save-aliyun-search"]');
    if (resultNode) {
      resultNode.hidden = true;
      apiResultState.delete(resultNode);
    }
    delete draftState["aliyun.search.configured"];
    writeDraft(draftState);
    return;
  }

  const fields = {
    "aliyun.search.action": search.action,
    "aliyun.search.bucket": search.bucket,
    "aliyun.search.index": search.index,
    "aliyun.search.embedding": search.embedding,
    "aliyun.search.configured": true
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === "") continue;
    draftState[key] = value;
    const field = document.querySelector(`[data-draft-field="${cssEscape(key)}"]`);
    if (field) field.value = value;
  }
  writeDraft(draftState);
  showSavedSearchResult(search, options);
}

function showSavedSearchResult(search, options = {}) {
  const resultNode = document.querySelector('[data-api-result="save-aliyun-search"]');
  if (!resultNode) return;
  if (!search?.configured) {
    resultNode.hidden = true;
    apiResultState.delete(resultNode);
    return;
  }
  showApiChecks(
    resultNode,
    {
      ok: true,
      search,
      checks: [
        {
          key: "searchSaved",
          status: "pass",
          label: { zh: "知识检索", en: "Knowledge search" },
          message: {
            zh: `${search.index || "索引配置"}已保存到本机。`,
            en: `${search.index || "Index setup"} saved locally.`
          }
        },
        {
          key: "searchTarget",
          status: "pass",
          label: { zh: "索引位置", en: "Index target" },
          message: {
            zh: `${search.bucket || "OSS 向量 Bucket"} / ${search.embedding || "向量化模型"}`,
            en: `${search.bucket || "OSS vector bucket"} / ${search.embedding || "embedding model"}`
          }
        }
      ]
    },
    "save-aliyun-search",
    { showDialog: false, showToast: options.silent === false }
  );
}

function applySavedRetrievalStrategy(retrievalStrategy, options = {}) {
  if (!retrievalStrategy?.configured) {
    const resultNode = document.querySelector('[data-api-result="save-retrieval-strategy"]');
    if (resultNode) {
      resultNode.hidden = true;
      apiResultState.delete(resultNode);
    }
    delete draftState["retrieval.strategy.configured"];
    writeDraft(draftState);
    applyRetrievalStrategyCards();
    return;
  }

  draftState["retrieval.profile"] = retrievalStrategy.profile;
  draftState["retrieval.strategy.configured"] = true;
  const field = document.querySelector('[data-draft-field="retrieval.profile"]');
  if (field) field.value = retrievalStrategy.profile;
  writeDraft(draftState);
  applyRetrievalStrategyCards();
  showSavedRetrievalStrategyResult(retrievalStrategy, options);
}

function showSavedRetrievalStrategyResult(retrievalStrategy, options = {}) {
  const resultNode = document.querySelector('[data-api-result="save-retrieval-strategy"]');
  if (!resultNode) return;
  if (!retrievalStrategy?.configured) {
    resultNode.hidden = true;
    apiResultState.delete(resultNode);
    return;
  }
  const methodLabels = (retrievalStrategy.methods || [])
    .map((method) => localized(retrievalMethods[method]?.label) || method)
    .filter(Boolean)
    .join(settings.lang === "zh" ? "、" : ", ");
  showApiChecks(
    resultNode,
    {
      ok: true,
      retrievalStrategy,
      checks: [
        {
          key: "retrievalStrategySaved",
          status: "pass",
          label: { zh: "问答策略", en: "Answer strategy" },
          message: {
            zh: `${localized(retrievalStrategy.profileLabel) || retrievalStrategy.profile || "已配置"}已保存到本机。`,
            en: `${localized(retrievalStrategy.profileLabel) || retrievalStrategy.profile || "Configured"} saved locally.`
          }
        },
        {
          key: "retrievalStrategyMethods",
          status: "pass",
          label: { zh: "会启用", en: "Enabled" },
          message: {
            zh: methodLabels || "已保存。",
            en: methodLabels || "Saved."
          }
        }
      ]
    },
    "save-retrieval-strategy",
    { showDialog: false, showToast: options.silent === false }
  );
}

function applySavedCredentialActionState(configured) {
  document.querySelectorAll("[data-requires-saved-credential]").forEach((button) => {
    button.hidden = !configured;
  });
}

function refreshCredentialSavedVisualState() {
  if (!credentialSecretConfigured()) return;
  applyCredentialSavedVisualState({
    configured: true,
    accessKeyId: document.querySelector('[data-draft-field="aliyun.credential.accessKeyId"][data-credential-masked="true"]')?.value || ""
  });
}

function applyDraftPanels() {
  document.querySelectorAll("[data-draft-panel-title]").forEach((node) => {
    const panel = draftPanel(node.dataset.draftPanelTitle);
    const value = localized(panel?.title);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-draft-panel-note]").forEach((node) => {
    const panel = draftPanel(node.dataset.draftPanelNote);
    const value = localized(panel?.note);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-draft-label]").forEach((node) => {
    const field = draftField(node.dataset.draftLabel);
    const value = localized(field?.label);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-draft-field]").forEach((node) => {
    const field = draftField(node.dataset.draftField);
    const placeholder = localized(field?.placeholder);
    if (placeholder) node.setAttribute("placeholder", placeholder);
  });

  document.querySelectorAll("[data-draft-option]").forEach((node) => {
    const parts = node.dataset.draftOption.split(".");
    const index = parts.pop();
    const fieldKey = parts.join(".");
    const field = draftField(fieldKey);
    const option = field?.options?.[Number(index)];
    const value = localized(option?.label);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-draft-check]").forEach((node) => {
    const [panelKey, index] = node.dataset.draftCheck.split(".");
    const panel = draftPanel(panelKey);
    const value = localized(panel?.checklist?.[Number(index)]);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-api-action-idle]").forEach((node) => {
    const action = draftPanelAction(node.dataset.apiActionIdle);
    const value = localized(action?.idle);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-setup-workspace-action]").forEach((node) => {
    const action = draftPanelAction(node.dataset.setupWorkspaceAction);
    const value = localized(action?.label);
    if (value !== undefined) node.textContent = value;
  });

  document.querySelectorAll("[data-setup-api-action]").forEach((node) => {
    const action = draftPanelAction(node.dataset.setupApiAction);
    const value = localized(action?.label);
    if (value !== undefined) node.textContent = value;
  });

  refreshCredentialSavedVisualState();
  applyStorageLocationMode();
  applyModelProviderContext();
  applyModelQualityModelCards();
}

function applyModelProviderContext(changedKey = "") {
  const setup = document.querySelector("[data-model-provider-setup]");
  if (!setup) return;

  if (draftState["aliyun.model.testModel"] !== undefined) {
    delete draftState["aliyun.model.testModel"];
    writeDraft(draftState);
  }

  const protocolField = setup.querySelector('[data-draft-field="aliyun.model.protocol"]');
  const regionField = setup.querySelector('[data-draft-field="aliyun.model.region"]');
  const workspaceField = setup.querySelector('[data-draft-field="aliyun.model.workspaceId"]');
  const baseUrlField = setup.querySelector('[data-draft-field="aliyun.model.baseUrl"]');
  if (!baseUrlField) return;

  const protocol = protocolField?.value || draftState["aliyun.model.protocol"] || "openai-compatible";
  const region = regionField?.value || draftState["aliyun.model.region"] || "cn-beijing";
  const workspaceId = workspaceField?.value || draftState["aliyun.model.workspaceId"] || "";
  const suggested = suggestedModelBaseUrl({ protocol, region, workspaceId });
  const current = String(baseUrlField.value || "").trim();
  const changedBaseUrl = changedKey === "aliyun.model.baseUrl";

  if (changedBaseUrl) {
    baseUrlField.dataset.modelProviderAutoUrl = String(!current || current === suggested);
    return;
  }

  const canAutoFill = !current
    || baseUrlField.dataset.modelProviderAutoUrl !== "false"
    || isKnownModelBaseUrl(current);
  if (!canAutoFill) return;

  baseUrlField.value = suggested;
  baseUrlField.dataset.modelProviderAutoUrl = "true";
  draftState["aliyun.model.baseUrl"] = suggested;
  writeDraft(draftState);
}

function suggestedModelBaseUrl({ protocol, region, workspaceId }) {
  if (protocol === "dashscope-native") return "https://dashscope.aliyuncs.com";
  if (region === "ap-southeast-1" || region === "eu-central-1") {
    const workspace = String(workspaceId || "").trim() || "{WorkspaceId}";
    return `https://${workspace}.${region}.maas.aliyuncs.com/compatible-mode/v1`;
  }
  return "https://dashscope.aliyuncs.com/compatible-mode/v1";
}

function isKnownModelBaseUrl(value) {
  return value === "https://dashscope.aliyuncs.com"
    || value === "https://dashscope.aliyuncs.com/compatible-mode/v1"
    || /^https:\/\/[^/]+\.(ap-southeast-1|eu-central-1)\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.test(value);
}

function draftPanel(stepKey) {
  return pageState.setupDraftPanels?.[stepKey];
}

function draftPanelAction(actionKey) {
  for (const panel of Object.values(pageState.setupDraftPanels || {})) {
    if (panel.action?.key === actionKey) return panel.action;
    const action = panel.actions?.find((item) => item.key === actionKey);
    if (action) return action;
  }
  return null;
}

function draftField(fieldKey) {
  for (const panel of Object.values(pageState.setupDraftPanels || {})) {
    const field = panel.fields?.find((item) => item.key === fieldKey);
    if (field) return field;
  }
  return null;
}

function setText(selector, value) {
  document.querySelectorAll(selector).forEach((node) => {
    if (value !== undefined) node.textContent = value;
  });
}

async function loadTemplates() {
  try {
    const response = await fetch("/api/templates", { headers: { accept: "application/json" } });
    if (!response.ok) return;
    const data = await response.json();
    if (!Array.isArray(data.templates)) return;
    pageState.templates = data.templates;
    if (data.version) pageState.templateLibraryVersion = data.version;
    if (!templateById(settings.template)) {
      settings.template = pageState.defaultTemplateId || data.templates[0]?.id || settings.template;
      draftState["template.id"] = settings.template;
      writeDraft(draftState);
      syncDraftToServer();
    }
    applyTemplates();
  } catch {
    // The server-rendered template data is enough for first paint.
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/"/g, "\\\"");
}

function readDraft(initialDraft = {}) {
  return initialDraft && typeof initialDraft === "object" && !Array.isArray(initialDraft) ? { ...initialDraft } : {};
}

function writeDraft() {
  // Draft truth lives in the local KnowMesh service state file via /api/setup/draft.
}

function inferInitialSetupMode(data, fallback) {
  const draft = data?.draft || {};
  if (draft["setup.mode"] === "local" || draft.mode === "local") return "local";
  if (draft["setup.mode"] === "aliyun" || draft.mode === "aliyun") return "aliyun";
  if (data?.credential?.configured || data?.modelProvider?.configured || data?.search?.configured) return "aliyun";
  return fallback;
}

function inferInitialSetupTemplate(data, fallback) {
  const draft = data?.draft || {};
  const explicit = draft["template.id"] || draft.template;
  if (initialTemplateIds.includes(explicit)) return explicit;
  return initialTemplateIds.includes(fallback) ? fallback : initialTemplateIds[0] || "";
}
function readChoice(key, allowed, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeChoice(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local preferences are a convenience, not a requirement.
  }
}




