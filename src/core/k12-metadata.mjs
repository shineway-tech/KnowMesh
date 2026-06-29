const stages = ["小学", "初中", "高中"];
const subjects = [
  "道德与法治",
  "思想政治",
  "体育与健康",
  "信息科技",
  "信息技术",
  "语文",
  "数学",
  "英语",
  "物理",
  "化学",
  "生物",
  "历史",
  "地理",
  "政治",
  "科学",
  "音乐",
  "美术",
  "体育"
];
const grades = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "七年级", "八年级", "九年级", "高一", "高二", "高三"];
const volumes = ["选择性必修", "全一册", "上册", "下册", "必修"];

const publisherAliases = [
  ["renjiao", "人教版", ["人教版", "人民教育出版社", "RJ"]],
  ["tongbian", "统编版", ["统编版", "部编版", "教育部组织编写"]],
  ["waiyan", "外研社版", ["外研社版", "外研版", "外语教学与研究出版社"]],
  ["beishida", "北师大版", ["北师大版", "北京师范大学出版社"]],
  ["sujiao", "苏教版", ["苏教版", "江苏教育出版社"]],
  ["yilin", "译林版", ["译林版", "译林出版社"]],
  ["beijing", "北京版", ["北京版", "北京出版社"]],
  ["qingdao", "青岛版", ["青岛版", "青岛出版社"]],
  ["mingjiao", "闽教版", ["闽教版", "福建教育出版社"]],
  ["xijiao", "西师大版", ["西师大版", "西南师范大学出版社"]],
  ["hujiao", "沪教版", ["沪教版", "上海教育出版社"]],
  ["lujiao", "鲁教版", ["鲁教版", "山东教育出版社"]],
  ["xiangjiao", "湘教版", ["湘教版", "湖南教育出版社"]],
  ["jijiao", "冀教版", ["冀教版", "河北教育出版社"]],
  ["yuejiao", "粤教版", ["粤教版", "广东教育出版社"]]
];

export function extractK12EducationMetadata(record = {}) {
  const metadata = record.metadata || {};
  const sourceText = strongestSourceText(record);
  const sourceAndTitle = [
    sourceText,
    metadata.title,
    metadata.sourceUri,
    metadata.relativePath
  ].filter(Boolean).join(" ");
  const text = String(record.text || "");
  const grade = metadata.grade || extractGrade(sourceAndTitle);
  const subject = metadata.subject || firstIncluded(sourceAndTitle, subjects);
  const stage = metadata.stage || firstIncluded(sourceAndTitle, stages) || stageFromGrade(grade);
  const publisher = metadata.publisher || extractPublisher(sourceAndTitle);
  const volume = metadata.volume || firstIncluded(sourceAndTitle, volumes);

  return {
    stage,
    subject,
    grade,
    publisher,
    edition: metadata.edition || "",
    volume,
    unit_no: Number(metadata.unit_no || metadata.unitNumber || extractUnitNumber(text) || 0) || null,
    lesson_no: Number(metadata.lesson_no || metadata.lessonNumber || extractLessonNumber(text) || 0) || null,
    lesson_order_no: Number(metadata.lesson_order_no || metadata.lessonOrderNumber || 0) || null,
    lesson_title: String(metadata.lesson_title || metadata.lessonTitle || "")
  };
}

export function compactK12FilterFields(record = {}) {
  const metadata = record.metadata || {};
  const education = metadata.education && typeof metadata.education === "object"
    ? normalizeEducation(metadata.education)
    : extractK12EducationMetadata(record);
  return compactK12Education(education);
}

export function compactK12Education(education = {}) {
  return {
    fgs: [stageCode(education.stage), gradeCode(education.grade), subjectCode(education.subject)].filter(Boolean).join("|"),
    pub: publisherCode(education.publisher || education.edition),
    vol: volumeCode(education.volume),
    unit: education.unit_no ? `u${String(education.unit_no).padStart(2, "0")}` : "",
    lesson: education.lesson_no ? `l${String(education.lesson_no).padStart(2, "0")}` : ""
  };
}

export function extractK12QueryConstraints(value) {
  const text = normalizeText(value);
  const grade = extractGrade(text);
  const subject = firstIncluded(text, subjects);
  const stage = firstIncluded(text, stages) || stageFromGrade(grade);
  const publisher = extractPublisher(text);
  const volume = firstIncluded(text, volumes);
  const unitNumber = extractUnitNumber(text);
  const lessonOrderNumber = extractUnitLessonOrderNumber(text);
  const lessonNumber = lessonOrderNumber ? null : extractLessonNumber(text);
  const education = {
    stage,
    subject,
    grade,
    publisher,
    volume,
    unit_no: unitNumber || null,
    lesson_no: lessonNumber || null,
    lesson_order_no: lessonOrderNumber || null
  };
  const compact = compactK12Education(education);
  const groups = [
    groupFor("stage", stage),
    groupFor("grade", grade),
    groupFor("subject", subject),
    groupFor("publisher", publisher),
    groupFor("volume", volume)
  ].filter(Boolean);
  return {
    groups,
    unitNumber,
    lessonNumber,
    education,
    compact: Object.fromEntries(Object.entries(compact).filter(([, item]) => item)),
    missing: {
      volume: Boolean(grade && subject && !volume)
    },
    scopeLabels: buildScopeLabels(education)
  };
}

export function vectorFilterForK12Constraints(constraints = {}) {
  const compact = constraints.compact || {};
  const parts = [];
  const stage = compact.stage || stageFromGradeCode(compact.grade);
  const fgs = compact.fgs || (stage && compact.grade && compact.subject ? `${stage}|${compact.grade}|${compact.subject}` : "");
  if (fgs) parts.push({ fgs: { $eq: fgs } });
  if (compact.pub) parts.push({ pub: { $eq: compact.pub } });
  if (compact.vol) parts.push({ vol: { $eq: compact.vol } });
  if (compact.unit) parts.push({ unit: { $eq: compact.unit } });
  if (compact.lesson) parts.push({ lesson: { $eq: compact.lesson } });
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { $and: parts };
}

export function metadataMatchesK12Constraints(metadata = {}, constraints = {}) {
  const expected = constraints.compact || {};
  const actual = compactFromAnyMetadata(metadata);
  if (expected.fgs && actual.fgs !== expected.fgs) return false;
  if (expected.pub && actual.pub && actual.pub !== expected.pub) return false;
  if (expected.vol && actual.vol && actual.vol !== expected.vol) return false;
  if (expected.unit && actual.unit && actual.unit !== expected.unit) return false;
  if (expected.lesson && actual.lesson && actual.lesson !== expected.lesson) return false;
  return true;
}

export function compactFromAnyMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== "object") return {};
  if (metadata.fgs || metadata.pub || metadata.vol || metadata.unit || metadata.lesson) {
    return {
      fgs: String(metadata.fgs || ""),
      pub: String(metadata.pub || ""),
      vol: String(metadata.vol || ""),
      unit: String(metadata.unit || ""),
      lesson: String(metadata.lesson || "")
    };
  }
  if (metadata.education) return compactK12Education(normalizeEducation(metadata.education));
  return compactK12FilterFields({
    sourceUri: metadata.sourceUri || metadata.relativePath || "",
    metadata
  });
}

export function describeK12Scope(constraints = {}) {
  const labels = constraints.scopeLabels || buildScopeLabels(constraints.education || {});
  const missing = constraints.missing?.volume
    ? {
        zh: "未指定册别，会同时查看上册和下册。",
        en: "No volume was specified, so both volume 1 and volume 2 are checked."
      }
    : null;
  return {
    zh: `${labels.zh.join(" / ") || "按原问题检索"}${missing ? `。${missing.zh}` : ""}`,
    en: `${labels.en.join(" / ") || "Search by the original question"}${missing ? `. ${missing.en}` : ""}`
  };
}

export function stageCode(value) {
  return {
    小学: "primary",
    初中: "junior",
    高中: "senior"
  }[value] || "";
}

export function subjectCode(value) {
  return {
    语文: "chinese",
    数学: "math",
    英语: "english",
    物理: "physics",
    化学: "chemistry",
    生物: "biology",
    历史: "history",
    地理: "geography",
    政治: "politics",
    道德与法治: "morality",
    思想政治: "politics",
    科学: "science",
    信息科技: "it",
    信息技术: "it",
    体育与健康: "pe",
    体育: "pe",
    音乐: "music",
    美术: "art"
  }[value] || "";
}

export function gradeCode(value) {
  return {
    一年级: "g1",
    二年级: "g2",
    三年级: "g3",
    四年级: "g4",
    五年级: "g5",
    六年级: "g6",
    七年级: "g7",
    八年级: "g8",
    九年级: "g9",
    高一: "g10",
    高二: "g11",
    高三: "g12"
  }[value] || "";
}

export function publisherCode(value) {
  const normalized = extractPublisher(value) || String(value || "");
  return publisherAliases.find(([, label]) => label === normalized)?.[0] || "";
}

export function volumeCode(value) {
  return {
    上册: "v1",
    下册: "v2",
    全一册: "single",
    必修: "compulsory",
    选择性必修: "selective"
  }[value] || "";
}

export function extractUnitNumber(text) {
  const match = normalizeText(text).match(/第([一二三四五六七八九十\d]+)(?:单元|章|节)/);
  if (!match) return null;
  return chineseNumberToArabic(match[1]);
}

export function extractLessonNumber(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/第([一二三四五六七八九十\d]+)课/);
  if (!match) return null;
  return chineseNumberToArabic(match[1]);
}

function strongestSourceText(record = {}) {
  const metadata = record.metadata || {};
  const direct = [
    metadata.relativePath,
    record.sourceUri,
    metadata.sourceUri,
    metadata.title
  ].find(Boolean);
  if (direct) return String(direct);
  const sourcePart = Array.isArray(record.sourceParts)
    ? record.sourceParts.find((item) => item?.relativePath || item?.objectKey)
    : null;
  return String(sourcePart?.relativePath || sourcePart?.objectKey || "");
}

function normalizeEducation(value = {}) {
  return {
    stage: String(value.stage || ""),
    subject: String(value.subject || ""),
    grade: String(value.grade || ""),
    publisher: String(value.publisher || value.edition || ""),
    edition: String(value.edition || ""),
    volume: String(value.volume || ""),
    unit_no: Number(value.unit_no || value.unitNumber || 0) || null,
    lesson_no: Number(value.lesson_no || value.lessonNumber || 0) || null,
    lesson_order_no: Number(value.lesson_order_no || value.lessonOrderNumber || 0) || null,
    lesson_title: String(value.lesson_title || value.lessonTitle || "")
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function firstIncluded(text, candidates) {
  const source = normalizeText(text);
  return candidates.find((candidate) => source.includes(candidate)) || "";
}

function extractGrade(value) {
  const text = normalizeText(value);
  const beforeVolume = text.match(new RegExp(`(${grades.join("|")})(?:上册|下册|全一册|必修|选择性必修)`));
  if (beforeVolume) return beforeVolume[1];
  const withoutStartingPoint = text.replace(/(?:一年级|二年级|三年级|四年级|五年级|六年级)起点/g, "");
  return grades.find((grade) => withoutStartingPoint.includes(grade)) || "";
}

function extractPublisher(value) {
  const text = normalizeText(value);
  return publisherAliases.find(([, , aliases]) => aliases.some((alias) => text.includes(alias)))?.[1] || "";
}

function stageFromGrade(value) {
  const code = gradeCode(value);
  if (/^g[1-6]$/.test(code)) return "小学";
  if (/^g[7-9]$/.test(code)) return "初中";
  if (/^g1[0-2]$/.test(code)) return "高中";
  return "";
}

function stageFromGradeCode(grade) {
  if (/^g[1-6]$/.test(String(grade || ""))) return "primary";
  if (/^g[7-9]$/.test(String(grade || ""))) return "junior";
  if (/^g1[0-2]$/.test(String(grade || ""))) return "senior";
  return "";
}

function groupFor(key, value) {
  if (!value) return null;
  const aliases = key === "publisher"
    ? publisherAliases.find(([, label]) => label === value)?.[2] || [value]
    : [value];
  return { key, terms: aliases };
}

function buildScopeLabels(education = {}) {
  const zh = [
    education.stage,
    education.grade,
    education.subject,
    education.publisher,
    education.volume,
    education.unit_no ? `第${education.unit_no}单元` : "",
    education.lesson_order_no ? `单元内第${education.lesson_order_no}课` : education.lesson_no ? `第${education.lesson_no}课` : ""
  ].filter(Boolean);
  const en = [
    stageCode(education.stage),
    gradeCode(education.grade),
    subjectCode(education.subject),
    publisherCode(education.publisher),
    volumeCode(education.volume),
    education.unit_no ? `unit ${education.unit_no}` : "",
    education.lesson_order_no ? `lesson ${education.lesson_order_no} in unit` : education.lesson_no ? `lesson ${education.lesson_no}` : ""
  ].filter(Boolean);
  return { zh, en };
}

function extractUnitLessonOrderNumber(text) {
  const normalized = normalizeText(text);
  const match = normalized.match(/第[一二三四五六七八九十\d]+单元(?:的)?第?([一二三四五六七八九十\d]+)课/);
  if (!match) return null;
  return chineseNumberToArabic(match[1]);
}

function chineseNumberToArabic(value) {
  if (/^\d+$/.test(String(value))) return Number(value);
  const digits = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (value === "十") return 10;
  if (String(value).startsWith("十")) return 10 + (digits[String(value).slice(1)] || 0);
  if (String(value).includes("十")) {
    const [tens, ones] = String(value).split("十");
    return (digits[tens] || 1) * 10 + (digits[ones] || 0);
  }
  return digits[value] || null;
}
