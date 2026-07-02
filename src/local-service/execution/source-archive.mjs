export async function runSourceArchiveStage(context, job, log, implementation) {
  assertStageImplementation(implementation, "source archive");
  return implementation(context, job, log);
}

function assertStageImplementation(implementation, label) {
  if (typeof implementation !== "function") {
    throw new TypeError(`Missing ${label} execution implementation.`);
  }
}

