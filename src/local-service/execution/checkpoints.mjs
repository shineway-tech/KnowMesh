import path from "node:path";

import { writeJsonFile } from "../../core/config.mjs";

export function writeArtifactCheckpoint({ plan, job, stage, checkpoint = {}, files = {} }) {
  const artifactRoot = String(plan?.workspace?.artifactRoot || "").trim();
  if (!artifactRoot || !stage) return "";
  const checkpointPath = path.join(artifactRoot, "checkpoints", `${stage}.checkpoint.json`);
  writeJsonFile(checkpointPath, {
    kind: "knowmesh.executionCheckpoint",
    apiVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    stage,
    jobId: String(job?.id || ""),
    datasetVersionId: String(job?.datasetVersionId || ""),
    knowledgeBaseId: String(plan?.project?.id || ""),
    completedItems: Number(checkpoint.completedItems ?? checkpoint.completed ?? 0),
    failedItems: Number(checkpoint.failedItems ?? checkpoint.failed ?? 0),
    retryItems: Number(checkpoint.retryItems ?? checkpoint.retry ?? 0),
    totalItems: Number(checkpoint.total ?? 0),
    remainingItems: Number(checkpoint.remaining ?? 0),
    batch: Number(checkpoint.batch ?? 0),
    totalBatches: Number(checkpoint.totalBatches ?? 0),
    checkpoint,
    files
  });
  return checkpointPath;
}

