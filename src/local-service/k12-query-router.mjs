import { compactFromAnyMetadata, describeK12Scope, extractK12QueryConstraints } from "../core/k12-metadata.mjs";
import { currentKnowledgeBaseId } from "./knowledge-bases.mjs";
import { openCatalogDatabase, parseJson } from "./storage.mjs";

const k12TemplateId = "textbook-cn-k12";

export function routeK12QueryFromCatalog(state, input = {}) {
  const question = String(input.question || input.query || "").trim();
  const knowledgeBaseId = currentKnowledgeBaseId(state);
  const constraints = extractK12QueryConstraints(question);
  const intent = classifyK12QueryIntent(question, constraints);
  const route = {
    kind: "k12.catalogRoute",
    intent,
    source: "catalog",
    tableOrder: ["structure_nodes", "knowledge_objects", "object_relations"],
    scope: describeK12Scope(constraints)
  };
  if (!knowledgeBaseId || !question) return emptyRouteResult({ knowledgeBaseId, route, constraints, status: "invalid_request" });

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const scope = ownedK12Scope(db, constraints);
    if (scope.outOfScope) {
      return {
        ok: false,
        status: "out_of_scope",
        kind: "knowmesh.k12QueryRouteResult",
        knowledgeBaseId,
        route: { ...route, intent: "out_of_scope" },
        query: querySummary(question, constraints),
        retrieval: { source: "catalog", scanned: 0, accepted: 0, rejected: 0 },
        citations: [],
        message: {
          zh: "这个问题超出当前 K12 知识库拥有的教材范围，已在检索前拒绝。",
          en: "The question is outside the current K12 knowledge-base scope and was refused before retrieval."
        },
        checks: [
          routeCheck("scope", "fail", "范围匹配", "Scope fit", "问题范围不属于当前知识库。", "The requested scope is not owned by this knowledge base.")
        ]
      };
    }

    const citations = citationsForIntent(db, intent, constraints, question);
    return {
      ok: citations.length > 0,
      status: citations.length ? "evidence_found" : "no_evidence",
      kind: "knowmesh.k12QueryRouteResult",
      knowledgeBaseId,
      route,
      query: querySummary(question, constraints),
      retrieval: {
        source: "catalog",
        scanned: citations.length,
        accepted: citations.length,
        rejected: 0,
        ownedScopes: scope.matchedScopes
      },
      citations,
      message: citations.length
        ? { zh: "已从 K12 结构和对象表找到可引用证据。", en: "Citable evidence was found in K12 structure and object tables." }
        : { zh: "当前 catalog 中没有找到符合问题范围的 K12 结构证据。", en: "No matching K12 catalog structure evidence was found." },
      checks: [
        routeCheck("scope", "pass", "范围匹配", "Scope fit", "问题范围属于当前知识库。", "The requested scope is owned by this knowledge base."),
        routeCheck("evidence", citations.length ? "pass" : "fail", "结构证据", "Structure evidence", citations.length ? "找到结构化证据。" : "没有找到结构化证据。", citations.length ? "Structured evidence was found." : "No structured evidence was found.")
      ]
    };
  } finally {
    db.close();
  }
}

export function classifyK12QueryIntent(question, constraints = extractK12QueryConstraints(question)) {
  const text = normalizedQuery(question);
  if (!text) return "unknown";
  if (/词语|生字|词汇|单词|vocabulary|words?/i.test(text)) return "vocabulary_lookup";
  if (/例题|示例|练习|习题|公式|exercise|example|formula/i.test(text)) return "exercise_example_lookup";
  if (/第[一二三四五六七八九十\d]+单元.*(?:第一课|第1课|第一篇|第1篇)|(?:第一课|第1课|第一篇|第1篇).*第[一二三四五六七八九十\d]+单元/.test(text)) {
    return "first_lesson_lookup";
  }
  if (constraints.education?.lesson_order_no && constraints.education?.unit_no) return "first_lesson_lookup";
  if (/目录|toc|table of contents/i.test(text)) return "toc_lookup";
  if (/第[一二三四五六七八九十\d]+单元.*(?:哪些|有什么|课文|内容|teach|topic|主题)|(?:哪些|有什么|课文|内容|teach|topic|主题).*第[一二三四五六七八九十\d]+单元/i.test(text)) {
    return "unit_lookup";
  }
  if (/页|page|位置|包含/.test(text)) return "page_lookup";
  return "hybrid";
}

function citationsForIntent(db, intent, constraints, question) {
  if (intent === "first_lesson_lookup") return firstLessonCitations(db, constraints);
  if (intent === "toc_lookup" || intent === "unit_lookup" || intent === "page_lookup") return structureCitations(db, constraints, question);
  if (intent === "vocabulary_lookup") return objectCitations(db, constraints, {
    objectTypes: ["vocabulary"],
    question
  });
  if (intent === "exercise_example_lookup") return objectCitations(db, constraints, {
    objectTypes: ["formula", "example", "exercise", "knowledge_point"],
    question
  });
  return [
    ...structureCitations(db, constraints, question).slice(0, 2),
    ...objectCitations(db, constraints, { objectTypes: ["knowledge_point", "formula", "example", "exercise", "vocabulary"], question }).slice(0, 4)
  ].slice(0, 6);
}

function firstLessonCitations(db, constraints) {
  const unitNo = Number(constraints.education?.unit_no || 0) || null;
  const lessonOrder = Number(constraints.education?.lesson_order_no || 1) || 1;
  if (!unitNo) return [];
  const rows = db.prepare(`
    SELECT
      sn.node_id,
      sn.document_id,
      sn.node_type,
      sn.title,
      sn.page_start,
      sn.page_end,
      sn.path,
      sn.metadata_json,
      sd.title AS document_title,
      sd.normalized_relative_path,
      sd.metadata_json AS document_metadata_json
    FROM structure_nodes sn
    JOIN source_documents sd ON sd.document_id = sn.document_id
    WHERE sd.status = 'active'
      AND sn.node_type IN ('toc_entry', 'lesson')
    ORDER BY
      CASE sn.node_type WHEN 'toc_entry' THEN 0 WHEN 'lesson' THEN 1 ELSE 2 END,
      sn.sort_order ASC,
      sn.page_start ASC,
      sn.node_id ASC
  `).all();
  return rows
    .map((row) => structureRowToCitation(row, constraints))
    .filter((citation) => {
      const education = citation.metadata.education || {};
      const metadataUnit = Number(education.unit_no || citation.metadata.unitNo || 0) || null;
      const metadataLessonOrder = Number(education.lesson_order_no || citation.metadata.lessonOrder || 0) || null;
      return metadataUnit === unitNo && metadataLessonOrder === lessonOrder && citationScopeMatches(citation, constraints);
    })
    .filter(uniqueLessonCitation())
    .slice(0, constraints.missing?.volume ? 4 : 2);
}

function uniqueLessonCitation() {
  const seen = new Set();
  return (citation) => {
    const key = [
      citation.document_id,
      citation.metadata?.unitNo || "",
      citation.metadata?.lessonOrder || "",
      citation.metadata?.lessonTitle || ""
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

function structureCitations(db, constraints, question) {
  const rows = db.prepare(`
    SELECT
      sn.node_id,
      sn.document_id,
      sn.node_type,
      sn.title,
      sn.page_start,
      sn.page_end,
      sn.path,
      sn.metadata_json,
      sd.title AS document_title,
      sd.normalized_relative_path,
      sd.metadata_json AS document_metadata_json
    FROM structure_nodes sn
    JOIN source_documents sd ON sd.document_id = sn.document_id
    WHERE sd.status = 'active'
      AND sn.node_type IN ('toc_entry', 'unit', 'lesson', 'section')
    ORDER BY sn.document_id ASC, sn.page_start ASC, sn.sort_order ASC, sn.node_id ASC
  `).all();
  const terms = tokenize(question);
  return rows
    .map((row) => structureRowToCitation(row, constraints))
    .filter((citation) => citationScopeMatches(citation, constraints))
    .map((citation) => ({ citation, score: structureScore(citation, constraints, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Number(left.citation.pageNumber || 0) - Number(right.citation.pageNumber || 0))
    .slice(0, 8)
    .map((item) => item.citation);
}

function objectCitations(db, constraints, options = {}) {
  const placeholders = options.objectTypes.map(() => "?").join(", ");
  if (!placeholders) return [];
  const rows = db.prepare(`
    SELECT
      ko.object_id,
      ko.document_id,
      ko.structure_node_id,
      ko.object_type,
      ko.title,
      ko.source_page,
      ko.quality_state,
      ko.metadata_json,
      sn.node_type,
      sn.title AS node_title,
      sn.page_start AS node_page_start,
      sn.page_end AS node_page_end,
      sn.path AS node_path,
      sn.metadata_json AS node_metadata_json,
      sd.title AS document_title,
      sd.normalized_relative_path,
      sd.metadata_json AS document_metadata_json
    FROM knowledge_objects ko
    JOIN source_documents sd ON sd.document_id = ko.document_id
    LEFT JOIN structure_nodes sn ON sn.node_id = ko.structure_node_id
    WHERE sd.status = 'active'
      AND ko.quality_state = 'primary'
      AND ko.object_type IN (${placeholders})
    ORDER BY ko.document_id ASC, COALESCE(ko.source_page, sn.page_start, 0) ASC, ko.object_type ASC, ko.title ASC
  `).all(...options.objectTypes);
  const terms = tokenize(options.question || "");
  return rows
    .map((row) => objectRowToCitation(db, row, constraints))
    .filter((citation) => citationScopeMatches(citation, constraints))
    .map((citation) => ({ citation, score: objectScore(citation, constraints, terms) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Number(left.citation.pageNumber || 0) - Number(right.citation.pageNumber || 0))
    .slice(0, 8)
    .map((item) => item.citation);
}

function structureRowToCitation(row, constraints) {
  const nodeMetadata = parseJson(row.metadata_json, {});
  const documentMetadata = parseJson(row.document_metadata_json, {});
  const education = mergedEducation(documentMetadata, nodeMetadata);
  const lessonOrder = Number(education.lesson_order_no || nodeMetadata.lessonOrder || 0) || null;
  const lessonTitle = education.lesson_title || nodeMetadata.lessonTitle || (row.node_type === "lesson" || row.node_type === "toc_entry" ? row.title : "");
  return {
    id: row.node_id,
    citationId: row.node_id,
    chunk_id: row.node_id,
    document_id: row.document_id,
    title: row.document_title || documentMetadata.title || "",
    sourceUri: row.normalized_relative_path || "",
    pageNumber: row.page_start ?? null,
    excerpt: structureExcerpt(row, { lessonTitle, lessonOrder }),
    contentType: row.node_type === "toc_entry" ? "toc_entry" : row.node_type,
    structureNodeId: row.node_id,
    metadata: safeMetadata({
      template: k12TemplateId,
      contentType: row.node_type === "toc_entry" ? "toc_entry" : row.node_type,
      nodeType: row.node_type,
      nodeTitle: row.title || "",
      structurePath: row.path || "",
      pageEnd: row.page_end ?? null,
      lessonTitle,
      lessonOrder,
      unitNo: Number(education.unit_no || nodeMetadata.unitNo || 0) || null,
      education
    })
  };
}

function objectRowToCitation(db, row, constraints) {
  const objectMetadata = parseJson(row.metadata_json, {});
  const nodeMetadata = parseJson(row.node_metadata_json, {});
  const documentMetadata = parseJson(row.document_metadata_json, {});
  const education = mergedEducation(documentMetadata, nodeMetadata, objectMetadata);
  const relations = objectRelations(db, row.object_id);
  const lessonTitle = education.lesson_title || nodeMetadata.lessonTitle || row.node_title || "";
  const lessonOrder = Number(education.lesson_order_no || nodeMetadata.lessonOrder || 0) || null;
  return {
    id: row.object_id,
    citationId: row.object_id,
    chunk_id: row.object_id,
    document_id: row.document_id,
    title: row.document_title || documentMetadata.title || "",
    sourceUri: row.normalized_relative_path || "",
    pageNumber: row.source_page ?? row.node_page_start ?? null,
    excerpt: objectExcerpt(row),
    contentType: row.object_type,
    structureNodeId: row.structure_node_id || "",
    metadata: safeMetadata({
      template: k12TemplateId,
      contentType: row.object_type,
      objectId: row.object_id,
      objectType: row.object_type,
      objectTitle: row.title || "",
      lessonTitle,
      lessonOrder,
      unitNo: Number(education.unit_no || nodeMetadata.unitNo || 0) || null,
      subject: education.subject || "",
      structurePath: row.node_path || "",
      relations,
      education
    })
  };
}

function objectRelations(db, objectId) {
  return db.prepare(`
    SELECT relation_id, source_object_id, target_object_id, relation_type, quality_state
    FROM object_relations
    WHERE source_object_id = ? OR target_object_id = ?
    ORDER BY relation_type ASC, relation_id ASC
  `).all(objectId, objectId).map((row) => ({
    id: row.relation_id || "",
    type: row.relation_type || "",
    direction: row.source_object_id === objectId ? "out" : "in",
    targetObjectId: row.source_object_id === objectId ? row.target_object_id : row.source_object_id,
    qualityState: row.quality_state || ""
  }));
}

function ownedK12Scope(db, constraints) {
  const rows = db.prepare(`
    SELECT document_id, title, normalized_relative_path, metadata_json
    FROM source_documents
    WHERE status = 'active'
    ORDER BY document_id ASC
  `).all();
  const requested = constraints.compact || {};
  const hasRequestedBookScope = Boolean(requested.fgs || requested.pub || requested.vol);
  if (!hasRequestedBookScope) {
    return { outOfScope: false, matchedScopes: rows.length };
  }
  const matched = rows.filter((row) => documentScopeMatches(row, constraints));
  return {
    outOfScope: rows.length > 0 && matched.length === 0,
    matchedScopes: matched.length
  };
}

function documentScopeMatches(row, constraints = {}) {
  const expected = constraints.compact || {};
  const metadata = parseJson(row.metadata_json, {});
  const actual = compactFromAnyMetadata({
    ...metadata,
    sourceUri: row.normalized_relative_path || "",
    title: row.title || ""
  });
  if (expected.fgs && actual.fgs && actual.fgs !== expected.fgs) return false;
  if (expected.pub && actual.pub && actual.pub !== expected.pub) return false;
  if (expected.vol && actual.vol && actual.vol !== expected.vol) return false;
  return true;
}

function citationScopeMatches(citation, constraints = {}) {
  const expected = constraints.compact || {};
  const actual = compactFromAnyMetadata(citation.metadata || {});
  if (expected.fgs && actual.fgs && actual.fgs !== expected.fgs) return false;
  if (expected.pub && actual.pub && actual.pub !== expected.pub) return false;
  if (expected.vol && actual.vol && actual.vol !== expected.vol) return false;
  if (expected.unit) {
    const unitNo = Number(citation.metadata?.education?.unit_no || citation.metadata?.unitNo || 0) || null;
    const actualUnit = unitNo ? `u${String(unitNo).padStart(2, "0")}` : actual.unit;
    if (actualUnit && actualUnit !== expected.unit) return false;
  }
  return true;
}

function structureScore(citation, constraints = {}, terms = []) {
  let score = 0;
  const unitNo = Number(constraints.education?.unit_no || 0) || null;
  const lessonOrder = Number(constraints.education?.lesson_order_no || 0) || null;
  if (unitNo && Number(citation.metadata.unitNo || 0) === unitNo) score += 30;
  if (lessonOrder && Number(citation.metadata.lessonOrder || 0) === lessonOrder) score += 80;
  if (citation.metadata.contentType === "toc_entry") score += 24;
  if (citation.metadata.nodeType === "lesson") score += 16;
  score += termScore([citation.excerpt, citation.metadata.nodeTitle, citation.metadata.structurePath].join(" "), terms);
  return score;
}

function objectScore(citation, constraints = {}, terms = []) {
  let score = 20;
  const unitNo = Number(constraints.education?.unit_no || 0) || null;
  if (unitNo && Number(citation.metadata.unitNo || 0) === unitNo) score += 24;
  const lessonTitle = String(constraints.education?.lesson_title || "");
  if (lessonTitle && String(citation.metadata.lessonTitle || "").includes(lessonTitle)) score += 40;
  score += relationScore(citation.metadata.relations || []);
  score += termScore([citation.excerpt, citation.metadata.objectTitle, citation.metadata.structurePath, citation.metadata.lessonTitle].join(" "), terms);
  return score;
}

function relationScore(relations = []) {
  let score = 0;
  for (const relation of relations) {
    if (relation.type === "belongs_to_lesson") score += 12;
    if (relation.type === "supports_exercise") score += 18;
  }
  return score;
}

function termScore(value, terms = []) {
  const haystack = normalizedQuery(value);
  let score = 0;
  for (const term of terms) {
    if (term.length >= 2 && haystack.includes(term)) score += Math.min(12, term.length * 2);
  }
  return score;
}

function mergedEducation(...metadataItems) {
  const education = {};
  for (const metadata of metadataItems) {
    if (metadata?.education && typeof metadata.education === "object") Object.assign(education, metadata.education);
  }
  return education;
}

function structureExcerpt(row, options = {}) {
  if (row.node_type === "toc_entry") {
    const lesson = [options.lessonOrder ? `第${options.lessonOrder}课` : "", options.lessonTitle || row.title || ""].filter(Boolean).join(" ");
    return `目录锚点：${lesson || row.title || ""}`.trim();
  }
  const page = row.page_start ? `第${row.page_start}页` : "";
  return [row.node_type || "结构", row.title || "", page].filter(Boolean).join(" · ");
}

function objectExcerpt(row) {
  const labels = {
    vocabulary: "词语",
    formula: "公式",
    exercise: "练习",
    example: "例题",
    knowledge_point: "知识点"
  };
  return `${labels[row.object_type] || row.object_type || "对象"}：${row.title || ""}`.trim();
}

function safeMetadata(metadata = {}) {
  return JSON.parse(JSON.stringify(metadata, (key, value) => {
    if (["text", "rawText", "sourceText", "textPreview", "privateText"].includes(key)) return undefined;
    return value === undefined ? undefined : value;
  }));
}

function querySummary(question, constraints) {
  return {
    question,
    scope: describeK12Scope(constraints),
    constraints: {
      education: constraints.education,
      compact: constraints.compact,
      missing: constraints.missing
    }
  };
}

function emptyRouteResult({ knowledgeBaseId, route, constraints, status }) {
  return {
    ok: false,
    status,
    kind: "knowmesh.k12QueryRouteResult",
    knowledgeBaseId,
    route,
    query: querySummary("", constraints),
    retrieval: { source: "catalog", scanned: 0, accepted: 0, rejected: 0 },
    citations: [],
    checks: []
  };
}

function routeCheck(key, status, labelZh, labelEn, messageZh, messageEn) {
  return {
    key,
    status,
    label: { zh: labelZh, en: labelEn },
    message: { zh: messageZh, en: messageEn }
  };
}

function tokenize(value) {
  const text = normalizedQuery(value);
  const words = text.match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/gi) || [];
  const grams = [];
  for (const word of words) {
    if (/^[\u4e00-\u9fa5]+$/.test(word) && word.length > 4) {
      for (let index = 0; index <= word.length - 2; index += 1) grams.push(word.slice(index, index + 2));
    }
    grams.push(word);
  }
  return [...new Set(grams)].slice(0, 24);
}

function normalizedQuery(value) {
  return String(value || "")
    .replace(/[？?。！!,，、：:；;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
