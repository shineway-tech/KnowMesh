import path from "node:path";

import { toPosix } from "./glob.mjs";

export const k12TemplateId = "textbook-cn-k12";

export function buildK12ScopeFilter(template, draft = {}) {
  const selected = {
    stage: normalizeDraftList(draft["metadata.stage"]),
    subject: normalizeDraftList(draft["metadata.subject"]),
    grade: normalizeDraftList(draft["metadata.grade"]),
    volume: normalizeDraftList(draft["metadata.volume"]),
    publisher: normalizeDraftList(draft["metadata.publisher"]),
    edition: normalizeDraftList(draft["metadata.edition"])
  };
  return {
    enabled: template?.id === k12TemplateId && Object.values(selected).some((values) => values.length > 0),
    selected
  };
}

export function buildK12SourceScopeGate(template, draft = {}, documents = []) {
  const scopeFilter = buildK12ScopeFilter(template, draft);
  if (!scopeFilter.enabled) {
    return {
      ...scopeFilter,
      status: template?.id === k12TemplateId ? "blocked" : "not_applicable",
      totalDocumentsBeforeScope: documents.length,
      includedDocuments: documents.length,
      excludedDocuments: 0,
      included: documents.map((document) => ({ document, decision: { included: true, reason: "scope_not_enabled" } })),
      excluded: []
    };
  }

  const included = [];
  const excluded = [];
  for (const document of documents) {
    const decision = k12ScopeDecision(document, scopeFilter.selected);
    if (decision.included) {
      included.push({ document, decision });
    } else {
      excluded.push({ document, decision });
    }
  }

  return {
    ...scopeFilter,
    status: included.length ? "pass" : "blocked",
    totalDocumentsBeforeScope: documents.length,
    includedDocuments: included.length,
    excludedDocuments: excluded.length,
    included,
    excluded
  };
}


export function k12ScopeDecision(document, selected = {}) {
  const metadata = classifyK12Document(document);
  const checks = [
    dimensionDecision("stage", metadata.stage, selected.stage),
    dimensionDecision("subject", metadata.subject, selected.subject),
    gradeDecision(metadata, selected.grade, selected.stage),
    volumeDecision(metadata, selected.volume),
    freeTextDecision("publisher", metadata.searchText, selected.publisher),
    freeTextDecision("edition", metadata.searchText, selected.edition)
  ];
  const failed = checks.find((item) => !item.pass);
  return {
    included: !failed,
    reason: failed?.reason || "matched",
    metadata,
    checks
  };
}

export function classifyK12Document(document = {}) {
  const relativePath = toPosix(document.relativePath || document.sourceUri || document.title || "");
  const parts = relativePath.split("/").filter(Boolean);
  const title = String(document.title || inferTitle(relativePath));
  const explicit = explicitK12Metadata(document);
  const pathHasFolders = parts.length > 1;
  const stageSegment = parts[0] || "";
  const subjectSegment = parts[1] || "";
  const titleText = normalizeScopeText(title);
  const fullText = normalizeScopeText(`${relativePath} ${title} ${explicit.publisher || ""} ${explicit.edition || ""}`);

  const grade = explicit.grade || inferGrade(parts, titleText);
  const stage = explicit.stage || canonicalFromSegment(stageSegment, k12StageAliases)
    || (!pathHasFolders ? canonicalFromText(titleText, k12StageAliases) || stageFromGrade(grade) : "");
  const subject = explicit.subject || canonicalFromSegment(subjectSegment, k12SubjectAliases)
    || (!pathHasFolders ? canonicalFromText(titleText, k12SubjectAliases) : "");
  const volume = explicit.volume || inferVolume(titleText);

  return {
    relativePath,
    title,
    stage,
    subject,
    grade,
    volume,
    publisherText: fullText,
    editionText: fullText,
    searchText: fullText,
    pathParts: parts
  };
}

function explicitK12Metadata(document = {}) {
  const metadata = document.education || document.metadata?.education || document.metadata || {};
  return {
    stage: stringValue(metadata.stage),
    subject: stringValue(metadata.subject),
    grade: stringValue(metadata.grade),
    volume: stringValue(metadata.volume),
    publisher: stringValue(metadata.publisher),
    edition: stringValue(metadata.edition)
  };
}

export function normalizeDraftList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      return normalizeDraftList(JSON.parse(text));
    } catch {
      return [text];
    }
  }
  return text.split(/[,\u3001]/).map((item) => item.trim()).filter(Boolean);
}

export function normalizeScopeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-·•.。/\\（）()【】\[\]《》<>:：,，]/g, "");
}

export function normalizeScopeKey(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function stringValue(value) {
  return String(value || "").trim();
}

function dimensionDecision(key, actual, selected = []) {
  if (!selected.length) return { key, pass: true, actual: actual || "", expected: [] };
  const selectedSet = new Set(selected.map((item) => normalizeScopeText(item)));
  const pass = selectedSet.has(normalizeScopeText(actual));
  return {
    key,
    pass,
    actual: actual || "",
    expected: selected,
    reason: pass ? "matched" : `${key}_outside_scope`
  };
}

function gradeDecision(metadata, selectedGrades = [], selectedStages = []) {
  if (!selectedGrades.length) return { key: "grade", pass: true, actual: metadata.grade || "", expected: [] };
  const exact = dimensionDecision("grade", metadata.grade, selectedGrades);
  if (exact.pass) return exact;
  const stage = metadata.stage;
  const selectedStageSet = new Set((selectedStages || []).map((item) => normalizeScopeText(item)));
  const expected = k12StageGrades.get(stage) || [];
  const allGradesForStage = expected.length > 0 && expected.every((grade) => selectedGrades.includes(grade));
  const stageSelected = !selectedStageSet.size || selectedStageSet.has(normalizeScopeText(stage));
  const pass = !metadata.grade && stage && stageSelected && allGradesForStage;
  return {
    key: "grade",
    pass,
    actual: metadata.grade || "",
    expected: selectedGrades,
    reason: pass ? "stage_all_grades_selected" : "grade_outside_scope"
  };
}

function volumeDecision(metadata, selected = []) {
  if (!selected.length) return { key: "volume", pass: true, actual: metadata.volume || "", expected: [] };
  const selectedSet = new Set(selected.map((item) => normalizeScopeText(item)));
  const actual = normalizeScopeText(metadata.volume);
  const pass = selectedSet.has(actual);
  return {
    key: "volume",
    pass,
    actual: metadata.volume || "",
    expected: selected,
    reason: pass ? "matched" : "volume_outside_scope"
  };
}

function freeTextDecision(key, text, selected = []) {
  if (!selected.length) return { key, pass: true, actual: "", expected: [] };
  const normalized = normalizeScopeText(text);
  const pass = selected.some((value) => normalized.includes(normalizeScopeText(value)));
  return {
    key,
    pass,
    actual: "",
    expected: selected,
    reason: pass ? "matched" : `${key}_outside_scope`
  };
}

function canonicalFromSegment(segment, aliases) {
  const normalized = normalizeScopeText(segment);
  if (!normalized) return "";
  for (const [canonical, tokens] of aliases.entries()) {
    const normalizedTokens = [canonical, ...tokens].map(normalizeScopeText);
    if (normalizedTokens.includes(normalized)) return canonical;
  }
  return "";
}

function canonicalFromText(text, aliases) {
  for (const [canonical, tokens] of aliases.entries()) {
    if ([canonical, ...tokens].map(normalizeScopeText).some((token) => token && text.includes(token))) return canonical;
  }
  return "";
}

function inferGrade(parts, titleText) {
  const titleAdjacent = matchCanonical(`${titleText}`, k12GradeAliases, /(一年级|二年级|三年级|四年级|五年级|六年级|七年级|八年级|九年级|高一|高二|高三|高中一年级|高中二年级|高中三年级|[1-9]年级|高[123])(?:上册|下册|全一册)/);
  if (titleAdjacent) return titleAdjacent;
  for (const part of parts.slice(2, -1)) {
    const fromSegment = canonicalFromSegment(part, k12GradeAliases);
    if (fromSegment) return fromSegment;
  }
  const matches = [];
  for (const [canonical, tokens] of k12GradeAliases.entries()) {
    for (const token of [canonical, ...tokens].map(normalizeScopeText)) {
      if (token && titleText.includes(token)) matches.push({ canonical, index: titleText.lastIndexOf(token) });
    }
  }
  matches.sort((a, b) => b.index - a.index);
  return matches[0]?.canonical || "";
}

function stageFromGrade(grade) {
  for (const [stage, grades] of k12StageGrades.entries()) {
    if (grades.includes(grade)) return stage;
  }
  return "";
}
function inferVolume(titleText) {
  if (titleText.includes(normalizeScopeText("选择性必修"))) return "选择性必修";
  if (titleText.includes(normalizeScopeText("全一册"))) return "全一册";
  if (titleText.includes(normalizeScopeText("上册"))) return "上册";
  if (titleText.includes(normalizeScopeText("下册"))) return "下册";
  if (titleText.includes(normalizeScopeText("必修"))) return "必修";
  return "";
}

function matchCanonical(text, aliases, regex) {
  const match = text.match(regex);
  if (!match) return "";
  return canonicalFromSegment(match[1], aliases);
}

function inferTitle(relativePath) {
  const basename = path.basename(relativePath).replace(/\.pdf\.\d+$/i, ".pdf");
  return basename.replace(/\.pdf$/i, "").replace(/\.[^.]+$/i, "");
}

const k12StageAliases = new Map([
  ["小学", ["小学"]],
  ["初中", ["初中", "初级中学"]],
  ["高中", ["高中", "普通高中"]]
]);

const k12SubjectAliases = new Map([
  ["语文", ["语文"]],
  ["数学", ["数学"]],
  ["英语", ["英语"]],
  ["道德与法治", ["道德与法治", "道德法治", "道法", "品德", "思想品德"]],
  ["科学", ["科学"]],
  ["历史", ["历史"]],
  ["地理", ["地理"]],
  ["物理", ["物理"]],
  ["化学", ["化学"]],
  ["生物", ["生物", "生物学"]],
  ["思想政治", ["思想政治", "政治"]],
  ["信息科技", ["信息科技", "信息技术", "信息"]],
  ["体育与健康", ["体育与健康", "体育"]],
  ["音乐", ["音乐"]],
  ["美术", ["美术"]]
]);

const k12GradeAliases = new Map([
  ["一年级", ["一年级", "1年级"]],
  ["二年级", ["二年级", "2年级"]],
  ["三年级", ["三年级", "3年级"]],
  ["四年级", ["四年级", "4年级"]],
  ["五年级", ["五年级", "5年级"]],
  ["六年级", ["六年级", "6年级"]],
  ["七年级", ["七年级", "7年级", "初一"]],
  ["八年级", ["八年级", "8年级", "初二"]],
  ["九年级", ["九年级", "9年级", "初三"]],
  ["高一", ["高一", "高中一年级", "高1"]],
  ["高二", ["高二", "高中二年级", "高2"]],
  ["高三", ["高三", "高中三年级", "高3"]]
]);

const k12StageGrades = new Map([
  ["小学", ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级"]],
  ["初中", ["七年级", "八年级", "九年级"]],
  ["高中", ["高一", "高二", "高三"]]
]);


