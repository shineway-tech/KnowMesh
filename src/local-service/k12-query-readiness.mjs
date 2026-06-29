import { k12TemplateId } from "../core/document-scope.mjs";
import { currentKnowledgeBaseId, listKnowledgeBases } from "./knowledge-bases.mjs";
import { nowIso, openCatalogDatabase, parseJson } from "./storage.mjs";

export function readK12QueryReadinessFromCatalog(state, options = {}) {
  const registry = listKnowledgeBases(state);
  const knowledgeBaseId = String(options.knowledgeBaseId || currentKnowledgeBaseId(state) || "").trim();
  if (!knowledgeBaseId) return emptyReadiness();
  const knowledgeBase = registry.items.find((item) => item.id === knowledgeBaseId) || registry.current || { id: knowledgeBaseId };
  if (knowledgeBase.template !== k12TemplateId) return notApplicableReadiness(knowledgeBase);

  const db = openCatalogDatabase(state, knowledgeBaseId);
  try {
    const activeDocuments = numericScalar(db, "SELECT count(*) FROM source_documents WHERE status = 'active'");
    const nodes = db.prepare(`
      SELECT node_id, node_type, metadata_json
      FROM structure_nodes
      ORDER BY node_type ASC, node_id ASC
    `).all().map(nodeRow);
    const objects = db.prepare(`
      SELECT object_id, object_type, quality_state
      FROM knowledge_objects
      ORDER BY object_type ASC, object_id ASC
    `).all().map(objectRow);
    const relations = db.prepare(`
      SELECT relation_type, quality_state
      FROM object_relations
      ORDER BY relation_type ASC, relation_id ASC
    `).all().map(relationRow);
    const evaluation = readEvaluationClosure(db);
    const summary = summarizeQueryReadiness({ activeDocuments, nodes, objects, relations, evaluation });

    return {
      ok: true,
      kind: "knowmesh.k12QueryReadiness",
      apiVersion: "v1",
      phase: "phase3-k12-expert",
      generatedAt: nowIso(),
      knowledgeBase: {
        id: knowledgeBaseId,
        name: knowledgeBase.name || knowledgeBaseId,
        template: knowledgeBase.template || ""
      },
      summary,
      routes: summary.routes,
      objectRoutes: summary.objectRoutes,
      evaluation,
      gaps: buildGaps(summary)
    };
  } finally {
    db.close();
  }
}

function summarizeQueryReadiness({ activeDocuments, nodes, objects, relations, evaluation }) {
  const byNodeType = countBy(nodes, (node) => node.nodeType || "unknown");
  const byObjectType = countBy(objects, (object) => object.objectType || "unknown");
  const byRelationType = countBy(relations, (relation) => relation.relationType || "unknown");
  const tocAnchors = nodes.filter((node) => node.nodeType === "toc_entry" && node.unitNo && node.lessonOrder).length;
  const lessons = Number(byNodeType.lesson || 0);
  const units = Number(byNodeType.unit || 0);
  const vocabulary = Number(byObjectType.vocabulary || 0);
  const formulas = Number(byObjectType.formula || 0);
  const exercises = Number(byObjectType.exercise || 0);
  const belongsToLesson = Number(byRelationType.belongs_to_lesson || 0);
  const supportsExercise = Number(byRelationType.supports_exercise || 0);
  const routes = {
    firstLessonLookup: tocAnchors > 0 ? "ready" : lessons > 0 ? "partial" : "blocked",
    unitLessonLookup: units > 0 && (tocAnchors > 0 || lessons > 0) ? "ready" : "blocked",
    pageCitationLookup: tocAnchors > 0 || lessons > 0 ? "ready" : "blocked",
    outOfScopeRefusal: activeDocuments > 0 ? "ready" : "blocked",
    evaluationClosure: evaluation.status === "ready" ? "ready" : evaluation.results > 0 ? "partial" : "blocked"
  };
  const objectRoutes = {
    vocabularyLookup: vocabulary > 0 && belongsToLesson > 0 ? "ready" : vocabulary > 0 ? "partial" : "blocked",
    mathExerciseLookup: (formulas > 0 || exercises > 0) && supportsExercise > 0 ? "ready" : (formulas > 0 || exercises > 0) ? "partial" : "blocked"
  };
  const allStatuses = [...Object.values(routes), ...Object.values(objectRoutes)];
  return {
    status: readinessStatus(activeDocuments, allStatuses),
    activeDocuments,
    structureNodes: nodes.length,
    units,
    lessons,
    tocEntries: Number(byNodeType.toc_entry || 0),
    tocAnchors,
    knowledgeObjects: objects.length,
    objectTypes: byObjectType,
    objectRelations: relations.length,
    relationTypes: byRelationType,
    routes,
    objectRoutes
  };
}

function readEvaluationClosure(db) {
  const activeBuild = db.prepare(`
    SELECT build_id
    FROM build_versions
    WHERE active = 1
    ORDER BY updated_at DESC, build_id DESC
    LIMIT 1
  `).get();
  const cases = numericScalar(db, "SELECT count(*) FROM evaluation_cases WHERE template = ? AND active = 1", [k12TemplateId]);
  const results = activeBuild ? numericScalar(db, `
    SELECT count(*)
    FROM evaluation_results er
    JOIN evaluation_cases ec ON ec.case_id = er.case_id
    WHERE ec.template = ? AND ec.active = 1 AND er.build_id = ?
  `, [k12TemplateId, activeBuild.build_id]) : 0;
  const passed = activeBuild ? numericScalar(db, `
    SELECT count(*)
    FROM evaluation_results er
    JOIN evaluation_cases ec ON ec.case_id = er.case_id
    WHERE ec.template = ? AND ec.active = 1 AND er.build_id = ? AND er.status IN ('pass', 'passed')
  `, [k12TemplateId, activeBuild.build_id]) : 0;
  const failed = activeBuild ? numericScalar(db, `
    SELECT count(*)
    FROM evaluation_results er
    JOIN evaluation_cases ec ON ec.case_id = er.case_id
    WHERE ec.template = ? AND ec.active = 1 AND er.build_id = ? AND er.status IN ('fail', 'failed')
  `, [k12TemplateId, activeBuild.build_id]) : 0;
  const coveragePercent = cases ? Math.round((results / cases) * 100) : 0;
  return {
    status: cases > 0 && results >= cases && failed === 0 ? "ready" : results > 0 ? "partial" : "blocked",
    activeBuildId: activeBuild?.build_id || "",
    cases,
    results,
    passed,
    failed,
    coveragePercent
  };
}

function buildGaps(summary) {
  const gaps = [];
  if (summary.routes.firstLessonLookup !== "ready") {
    gaps.push(gap("firstLessonLookup", "K12 first-lesson queries need toc_entry nodes with unit and lesson order metadata."));
  }
  if (summary.objectRoutes.vocabularyLookup !== "ready") {
    gaps.push(gap("vocabularyLookup", "Vocabulary queries need vocabulary objects linked to lesson objects."));
  }
  if (summary.objectRoutes.mathExerciseLookup !== "ready") {
    gaps.push(gap("mathExerciseLookup", "Math exercise/example queries need formula or exercise objects and support relations."));
  }
  if (summary.routes.outOfScopeRefusal !== "ready") {
    gaps.push(gap("outOfScopeRefusal", "Out-of-scope refusal needs active source documents with owned K12 scope."));
  }
  if (summary.routes.evaluationClosure !== "ready") {
    gaps.push(gap("evaluationClosure", "K12 query routes need active evaluation cases and results for the active build."));
  }
  return gaps;
}

function gap(key, message) {
  return { key, status: "blocked", message };
}

function readinessStatus(activeDocuments, statuses = []) {
  if (!activeDocuments) return "empty";
  if (statuses.every((status) => status === "ready")) return "ready";
  if (statuses.some((status) => status === "ready" || status === "partial")) return "partial";
  return "blocked";
}

function nodeRow(row = {}) {
  const metadata = parseJson(row.metadata_json, {});
  const education = metadata.education || {};
  return {
    nodeId: String(row.node_id || ""),
    nodeType: String(row.node_type || ""),
    unitNo: Number(metadata.unitNo || education.unit_no || 0) || null,
    lessonOrder: Number(metadata.lessonOrder || education.lesson_order_no || 0) || null
  };
}

function objectRow(row = {}) {
  return {
    objectId: String(row.object_id || ""),
    objectType: String(row.object_type || ""),
    qualityState: String(row.quality_state || "")
  };
}

function relationRow(row = {}) {
  return {
    relationType: String(row.relation_type || ""),
    qualityState: String(row.quality_state || "")
  };
}

function countBy(items, resolveKey) {
  const counts = {};
  for (const item of items) {
    const key = resolveKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function numericScalar(db, sql, params = []) {
  const row = db.prepare(sql).get(...params);
  return Number(Object.values(row || {})[0] || 0);
}

function notApplicableReadiness(knowledgeBase) {
  return {
    ok: true,
    kind: "knowmesh.k12QueryReadiness",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: {
      id: knowledgeBase.id || "",
      name: knowledgeBase.name || knowledgeBase.id || "",
      template: knowledgeBase.template || ""
    },
    summary: emptySummary("not_applicable"),
    routes: {},
    objectRoutes: {},
    evaluation: { status: "not_applicable", activeBuildId: "", cases: 0, results: 0, passed: 0, failed: 0, coveragePercent: 0 },
    gaps: []
  };
}

function emptyReadiness() {
  return {
    ok: false,
    kind: "knowmesh.k12QueryReadiness",
    apiVersion: "v1",
    phase: "phase3-k12-expert",
    generatedAt: nowIso(),
    knowledgeBase: { id: "", name: "", template: "" },
    summary: emptySummary("empty"),
    routes: {},
    objectRoutes: {},
    evaluation: { status: "blocked", activeBuildId: "", cases: 0, results: 0, passed: 0, failed: 0, coveragePercent: 0 },
    gaps: []
  };
}

function emptySummary(status) {
  return {
    status,
    activeDocuments: 0,
    structureNodes: 0,
    units: 0,
    lessons: 0,
    tocEntries: 0,
    tocAnchors: 0,
    knowledgeObjects: 0,
    objectTypes: {},
    objectRelations: 0,
    relationTypes: {},
    routes: {},
    objectRoutes: {}
  };
}
