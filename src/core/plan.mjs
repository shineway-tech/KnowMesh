import path from "node:path";

import { writeJsonFile } from "./config.mjs";

export function buildPipelinePlan(config, scanManifest, options = {}) {
  const now = options.now || new Date().toISOString();
  const documents = scanManifest.logicalDocuments.map((document) => buildDocumentPlan(config, scanManifest, document));

  return {
    kind: "knowmesh.pipelinePlan",
    apiVersion: "v1",
    generatedAt: now,
    project: scanManifest.project,
    workspace: scanManifest.workspace,
    retrieval: config?.retrieval || null,
    sourceScanManifest: scanManifest,
    documents,
    proposedActiveManifest: {
      kind: "knowmesh.activeManifest",
      apiVersion: "v1",
      generatedAt: now,
      project: scanManifest.project,
      status: "proposed",
      activeVersions: documents.map((document) => ({
        document_id: document.document_id,
        version_id: document.version_id,
        title: document.title,
        lifecycle: "proposed"
      }))
    },
    gates: [
      {
        step: "merge_split_pdf",
        status: "local_only",
        reason: "Writing merged PDF artifacts requires an explicit execution confirmation."
      },
      {
        step: "upload_raw",
        status: "blocked",
        reason: "Remote upload requires an explicit Web Console confirmation gate."
      },
      {
        step: "ocr",
        status: "blocked",
        reason: "Model calls may incur cost and require explicit user confirmation."
      },
      {
        step: "embedding",
        status: "blocked",
        reason: "Embedding calls may incur cost and require explicit user confirmation."
      },
      {
        step: "index",
        status: "blocked",
        reason: "Vector index writes require an explicit Web Console confirmation gate."
      }
    ]
  };
}

export function writePipelinePlan(plan) {
  const manifests = plan.workspace.manifests;
  const reports = path.join(plan.workspace.artifactRoot, "reports");
  const outputs = [
    path.join(manifests, "source-scan.manifest.json"),
    path.join(manifests, "document-manifest.planned.json"),
    path.join(manifests, "active-manifest.proposed.json"),
    path.join(reports, "pipeline-plan.report.json")
  ];

  writeJsonFile(outputs[0], plan.sourceScanManifest);
  writeJsonFile(outputs[1], {
    kind: "knowmesh.documentManifest",
    apiVersion: "v1",
    generatedAt: plan.generatedAt,
    project: plan.project,
    documents: plan.documents
  });
  writeJsonFile(outputs[2], plan.proposedActiveManifest);
  writeJsonFile(outputs[3], plan);

  return outputs;
}

function buildDocumentPlan(config, scanManifest, document) {
  const artifactRoot = scanManifest.workspace.artifactRoot;
  const relativeBase = document.relativePath.replace(/(\.pdf)?(\.\d+)?$/i, "");
  const indexRecordPath = path.join(artifactRoot, "index_records", `${document.version_id}.jsonl`);

  return {
    document_id: document.document_id,
    version_id: document.version_id,
    title: document.title,
    active: false,
    lifecycle: "planned",
    sourceType: document.sourceType,
    sourceUri: document.sourceUri,
    sourcePath: document.sourcePath,
    relativePath: document.relativePath,
    source_fingerprint: document.source_fingerprint,
    sourceParts: document.sourceParts,
    artifacts: {
      raw: document.merge.outputPath,
      ocr: path.join(artifactRoot, "ocr", `${relativeBase}.pages.jsonl`),
      normalized: path.join(artifactRoot, "normalized", `${relativeBase}.json`),
      chunks: path.join(artifactRoot, "chunks", `${relativeBase}.jsonl`),
      indexRecords: indexRecordPath
    },
    pipeline: [
      {
        step: "scan",
        status: "complete",
        local: true
      },
      {
        step: "merge_split_pdf",
        status: document.merge.required ? "planned" : "not_required",
        local: true
      },
      {
        step: "render_pages",
        status: document.sourceType.includes("pdf") ? "planned" : "not_required",
        local: true
      },
      {
        step: "ocr",
        status: config?.models?.ocr?.provider ? "blocked_until_confirmed" : "not_configured",
        remote: true
      },
      {
        step: "normalize",
        status: "planned",
        local: true
      },
      {
        step: "chunk",
        status: "planned",
        local: true
      },
      {
        step: "embedding",
        status: config?.models?.embedding?.provider ? "blocked_until_confirmed" : "not_configured",
        remote: true
      },
      {
        step: "index",
        status: config?.vector?.provider ? "blocked_until_confirmed" : "not_configured",
        remote: true
      }
    ],
    indexRecordTemplate: {
      chunk_id: `${document.version_id}_chunk_000001`,
      document_id: document.document_id,
      version_id: document.version_id,
      active: false,
      text: "<cleaned chunk text>",
      embedding_model: config?.models?.embedding?.model || "",
      sourceUri: document.sourceUri,
      sourceParts: document.sourceParts,
      page_start: 1,
      page_end: 1,
      metadata: {
        title: document.title,
        project_id: scanManifest.project.id
      }
    }
  };
}
