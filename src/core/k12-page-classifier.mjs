export function classifyK12Page(record = {}, education = {}) {
  const text = String(record.text || record.markdown || "").trim();
  const title = String(record.title || record.metadata?.title || "").trim();
  const pageNumber = Number(record.pageNumber || record.page_number || record.metadata?.pageNumber || 0) || 0;
  const normalized = normalizeText(`${title}\n${text}`);
  const pageTypes = [];
  const signals = [];

  if (isCoverPage({ pageNumber, normalized })) {
    pageTypes.push("cover");
    signals.push("front_page_book_title");
  }
  if (isTableOfContents(text, normalized)) {
    pageTypes.push("table_of_contents");
    signals.push("toc_dotted_entries");
  }
  if (/前言|序言|编者的话|写给同学们/.test(normalized)) {
    pageTypes.push("preface");
    signals.push("preface_heading");
  }
  if (/单元导语|单元主题|本单元/.test(normalized)) {
    pageTypes.push("unit_guide");
    signals.push("unit_guide_heading");
  }
  if (/课后|练习|习题|做一做|思考题|口算|解决问题/.test(normalized)) {
    pageTypes.push("exercise");
    signals.push("exercise_heading");
  }
  if (/词语表|生字表|词汇|vocabulary|words/i.test(text)) {
    pageTypes.push("vocabulary_table");
    signals.push("vocabulary_heading");
  }
  if (/公式|\\frac|\\times|\\div|[a-zA-Z]\s*=|＝|=/.test(text)) {
    pageTypes.push("formula");
    signals.push("formula_pattern");
  }
  if (education.lesson_no || education.lesson_order_no || /第[一二三四五六七八九十\d]+课|^\s*\d+\s*[^\d\s]/m.test(text)) {
    pageTypes.push("lesson_text");
    signals.push("lesson_heading");
  }

  const uniqueTypes = [...new Set(pageTypes)];
  const primaryType = primaryTypeFor(uniqueTypes) || (record.metadata?.source === "ocr-page" ? "ocr_text" : "body_text");
  return {
    primaryType,
    pageTypes: uniqueTypes.length ? uniqueTypes : [primaryType],
    confidence: confidenceFor(uniqueTypes, signals),
    signals,
    sampleText: clampText(text, 800)
  };
}

export function k12ContentTypeForRecord(record = {}, education = {}) {
  const metadata = record.metadata || {};
  if (metadata.ctype) return String(metadata.ctype);
  const classification = metadata.pageClassification || classifyK12Page(record, education);
  const type = classification.primaryType || "";
  if (type === "table_of_contents") return "toc_entry";
  if (type === "exercise") return "exercise";
  if (type === "formula") return "formula";
  if (type === "vocabulary_table") return "vocabulary";
  if (type === "lesson_text" || education.lesson_no || education.unit_no) return "lesson_text";
  return metadata.source === "ocr-page" ? "ocr_text" : "body_text";
}

function primaryTypeFor(pageTypes) {
  const priority = [
    "table_of_contents",
    "cover",
    "preface",
    "unit_guide",
    "exercise",
    "vocabulary_table",
    "formula",
    "lesson_text"
  ];
  return priority.find((type) => pageTypes.includes(type)) || "";
}

function isCoverPage({ pageNumber, normalized }) {
  if (pageNumber && pageNumber !== 1) return false;
  return /(义务教育教科书|普通高中教科书|五年级|一年级|二年级|三年级|四年级|六年级|七年级|八年级|九年级|上册|下册|必修)/.test(normalized)
    && /(语文|数学|英语|物理|化学|生物|历史|地理|科学|人民教育出版社|统编版)/.test(normalized);
}

function isTableOfContents(text, normalized) {
  if (/目录/.test(normalized)) return true;
  const dottedEntries = String(text || "").split(/\r?\n/).filter((line) => /\S.{0,30}(\.{2,}|…{1,}|·{2,})\s*\d{1,3}\s*$/.test(line)).length;
  const numberedLessonEntries = String(text || "").split(/\r?\n/).filter((line) => /^\s*\d{1,2}\s+\S.{0,24}\s+\d{1,3}\s*$/.test(line)).length;
  return dottedEntries >= 2 || numberedLessonEntries >= 2;
}

function confidenceFor(pageTypes, signals) {
  if (!pageTypes.length) return 0.35;
  return Math.min(0.95, 0.55 + signals.length * 0.1);
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function clampText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}
