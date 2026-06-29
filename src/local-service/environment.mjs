import fs from "node:fs";
import path from "node:path";

import { readSetupState } from "./setup-store.mjs";

export async function checkEnvironment(state, options = {}) {
  const mode = options.mode === "local" ? "local" : "aliyun";
  const setupState = readSetupState(state);
  const draft = {
    ...(setupState.draft || {}),
    ...(options.draft || {})
  };
  const sourcePath = normalizeUserPath(draft["project.source"]);
  const workspacePath = normalizeUserPath(draft["project.workspace"]) || path.join(state.projectRoot, "workspace");
  const checks = [
    checkSourceFolder(sourcePath),
    checkWorkFolder(workspacePath),
    checkDiskSpace(workspacePath),
    checkSourceScope(draft),
    checkFileHandling(),
    checkRetrievalStrategy(setupState)
  ];

  if (mode === "aliyun") {
    checks.push(...checkAliyunModeConfig(setupState, draft));
  } else {
    checks.push(check(
      "cloudSkipped",
      "skip",
      "云端配置",
      "Cloud setup",
      "本地模式不需要阿里云保存位置、模型服务或知识检索配置。",
      "Local mode does not need Aliyun storage, model service, or knowledge-search setup."
    ));
  }

  return {
    ok: checks.every((item) => item.status !== "fail"),
    phase: "preScan",
    mode,
    checks,
    fixes: buildEnvironmentFixes(checks, mode),
    preScan: {
      summary: summarizeChecks(checks),
      groups: buildPreScanGroups(checks, mode)
    }
  };
}

function checkSourceFolder(sourcePath) {
  if (!sourcePath) {
    return check("sourceFolder", "fail", "资料目录", "Source folder", "还没有填写资料目录。", "The source folder is not filled yet.");
  }
  if (!fs.existsSync(sourcePath)) {
    return check("sourceFolder", "fail", "资料目录", "Source folder", `没有找到 ${sourcePath}。`, `${sourcePath} was not found.`);
  }
  if (!fs.statSync(sourcePath).isDirectory()) {
    return check("sourceFolder", "fail", "资料目录", "Source folder", "资料目录必须是一个文件夹。", "The source path must be a folder.");
  }
  return check("sourceFolder", "pass", "资料目录", "Source folder", "资料目录可读取。", "The source folder is readable.");
}

function checkWorkFolder(workspacePath) {
  const target = workspacePath || path.join(process.cwd(), "workspace");
  const ancestor = findExistingAncestor(target);
  if (!ancestor) {
    return check("workFolder", "fail", "工作目录", "Work folder", "没有找到可用的上级目录。", "No usable parent folder was found.");
  }

  try {
    const probe = path.join(ancestor, `.knowmesh-write-check-${Date.now()}.tmp`);
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe, { force: true });
    return check("workFolder", "pass", "工作目录", "Work folder", "工作目录位置可写。", "The work folder location is writable.");
  } catch {
    return check("workFolder", "fail", "工作目录", "Work folder", "工作目录位置不可写。", "The work folder location is not writable.");
  }
}

function checkDiskSpace(workspacePath) {
  const target = findExistingAncestor(workspacePath) || process.cwd();
  try {
    const stat = fs.statfsSync(target);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const freeGb = freeBytes / 1024 / 1024 / 1024;
    return check(
      "diskSpace",
      freeGb >= 5 ? "pass" : "warn",
      "可用空间",
      "Free space",
      `当前位置约有 ${freeGb.toFixed(1)} GB 可用。`,
      `About ${freeGb.toFixed(1)} GB is available here.`
    );
  } catch {
    return check("diskSpace", "warn", "可用空间", "Free space", "无法读取可用空间。", "Cannot read free space.");
  }
}

function checkSourceScope(draft) {
  const missing = ["metadata.stage", "metadata.subject", "metadata.grade"].filter((key) => valueMissing(draft[key]));
  return check(
    "sourceScope",
    missing.length ? "fail" : "pass",
    "资料范围",
    "Source scope",
    missing.length ? "还需要选择学段、学科和年级范围。" : "已选择学段、学科和年级范围。",
    missing.length ? "Choose school stages, subjects, and grades." : "Stages, subjects, and grades are selected."
  );
}

function checkFileHandling() {
  return check(
    "fileHandling",
    "pass",
    "文件识别",
    "File detection",
    "Office、WPS、PDF、图片、Markdown、文本和表格类资料的只读扫描规则已就绪。",
    "Read-only scan rules for Office, WPS, PDF, images, Markdown, text, and table sources are ready."
  );
}

function checkRetrievalStrategy(setupState) {
  return check(
    "retrievalStrategy",
    setupState.retrievalStrategy?.configured ? "pass" : "fail",
    "问答策略",
    "Answer strategy",
    setupState.retrievalStrategy?.configured ? "问答效果策略已保存。" : "还没有保存问答效果策略。",
    setupState.retrievalStrategy?.configured ? "Answer strategy is saved." : "Answer strategy is not saved yet."
  );
}

function checkAliyunModeConfig(setupState, draft) {
  return [
    check(
      "aliyunCredential",
      setupState.credential?.configured ? "pass" : "fail",
      "阿里云凭证",
      "Aliyun credential",
      setupState.credential?.configured ? `已保存本机凭证 ${setupState.credential.accessKeyId}。` : "还没有保存本机阿里云凭证。",
      setupState.credential?.configured ? `Local credential ${setupState.credential.accessKeyId} is saved.` : "No local Aliyun credential is saved yet."
    ),
    check(
      "aliyunStorage",
      draft["aliyun.storage.confirmed"] === true ? "pass" : "fail",
      "云端保存位置",
      "Cloud storage",
      draft["aliyun.storage.confirmed"] === true ? "资料和向量保存位置已确认。" : "还没有确认资料和向量保存位置。",
      draft["aliyun.storage.confirmed"] === true ? "Source and vector storage locations are confirmed." : "Source and vector storage locations are not confirmed yet."
    ),
    check(
      "modelProvider",
      setupState.modelProvider?.configured ? "pass" : "fail",
      "模型服务",
      "Model service",
      setupState.modelProvider?.configured ? "阿里百炼连接已保存。" : "还没有保存阿里百炼连接。",
      setupState.modelProvider?.configured ? "Model Studio connection is saved." : "Model Studio connection is not saved yet."
    ),
    check(
      "modelQuality",
      setupState.modelQuality?.configured ? "pass" : "fail",
      "模型方案",
      "Model profile",
      setupState.modelQuality?.configured ? "模型与质量方案已保存。" : "还没有保存模型与质量方案。",
      setupState.modelQuality?.configured ? "Model and quality profile is saved." : "Model and quality profile is not saved yet."
    ),
    check(
      "knowledgeSearch",
      setupState.search?.configured ? "pass" : "fail",
      "知识检索",
      "Knowledge search",
      setupState.search?.configured ? "知识库索引已保存。" : "还没有保存知识库索引。",
      setupState.search?.configured ? "Knowledge index is saved." : "Knowledge index is not saved yet."
    )
  ];
}

function normalizeUserPath(value) {
  if (!value) return "";
  return path.normalize(String(value).replaceAll("\\", "/"));
}

function findExistingAncestor(start) {
  let current = path.resolve(start || process.cwd());
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current) && fs.statSync(current).isDirectory()) return current;
    current = path.dirname(current);
  }
  return fs.existsSync(current) && fs.statSync(current).isDirectory() ? current : "";
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function summarizeChecks(checks) {
  return {
    total: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    fail: checks.filter((item) => item.status === "fail").length,
    skip: checks.filter((item) => item.status === "skip").length
  };
}

function buildPreScanGroups(checks, mode) {
  const groups = [
    preScanGroup(
      "source",
      "目录可用性",
      "Folders",
      "确认资料目录可读、工作目录可写。",
      "Checks that the source folder is readable and work folder is writable.",
      checks,
      ["sourceFolder", "workFolder", "diskSpace"]
    ),
    preScanGroup(
      "scope",
      "资料范围",
      "Source scope",
      "确认学段、学科和年级已经选好。",
      "Checks that stages, subjects, and grades are selected.",
      checks,
      ["sourceScope", "fileHandling"]
    ),
    preScanGroup(
      "answer",
      "问答效果",
      "Answer quality",
      "确认后续检索、引用和找不到答案时的处理方式。",
      "Checks retrieval, citation, and no-answer behavior.",
      checks,
      ["retrievalStrategy"]
    )
  ];

  if (mode === "aliyun") {
    groups.push(preScanGroup(
      "modeConfig",
      "阿里云配置",
      "Aliyun setup",
      "确认阿里云模式所需的本机凭证、保存位置、模型服务和知识检索已经完成。",
      "Checks that Aliyun credential, storage, model service, and knowledge search are ready.",
      checks,
      ["aliyunCredential", "aliyunStorage", "modelProvider", "modelQuality", "knowledgeSearch"]
    ));
  } else {
    groups.push(preScanGroup(
      "modeConfig",
      "云端配置",
      "Cloud setup",
      "本地模式会跳过阿里云保存位置、模型服务和知识检索配置。",
      "Local mode skips Aliyun storage, model service, and knowledge-search setup.",
      checks,
      ["cloudSkipped"]
    ));
  }

  return groups;
}

function preScanGroup(key, zhTitle, enTitle, zhDescription, enDescription, checks, keys) {
  const items = keys
    .map((itemKey) => checks.find((item) => item.key === itemKey))
    .filter(Boolean);
  const status = groupStatus(items);
  return {
    key,
    status,
    title: { zh: zhTitle, en: enTitle },
    description: { zh: zhDescription, en: enDescription },
    checks: items.map((item) => item.key)
  };
}

function groupStatus(items) {
  if (items.some((item) => item.status === "fail")) return "fail";
  if (items.some((item) => item.status === "warn")) return "warn";
  if (items.length && items.every((item) => item.status === "skip")) return "skip";
  return "pass";
}

function buildEnvironmentFixes(checks, mode) {
  const fixes = [];
  const statusByKey = new Map(checks.map((item) => [item.key, item.status]));

  if (["fail", "warn"].includes(statusByKey.get("sourceFolder"))) {
    fixes.push(fix("sourceFolder", "/setup/project", "选择一个可以读取的资料目录。", "Choose a readable source folder."));
  }
  if (statusByKey.get("workFolder") === "fail") {
    fixes.push(fix("workFolder", "/setup/project", "选择一个可写的工作目录。", "Choose a writable work folder."));
  }
  if (statusByKey.get("diskSpace") === "warn") {
    fixes.push(fix("diskSpace", "/setup/project", "工作目录可用空间偏低，建议换到更大的磁盘。", "Free space is low; choose a work folder on a larger disk."));
  }
  if (statusByKey.get("sourceScope") === "fail") {
    fixes.push(fix("sourceScope", "/setup/project", "补齐学段、学科和年级范围。", "Complete stages, subjects, and grades."));
  }
  if (statusByKey.get("retrievalStrategy") === "fail") {
    fixes.push(fix("retrievalStrategy", "/setup/retrieval", "保存问答效果策略。", "Save the answer strategy."));
  }

  if (mode === "aliyun") {
    if (statusByKey.get("aliyunCredential") === "fail") {
      fixes.push(fix("aliyunCredential", "/setup/aliyun/credential", "测试并保存阿里云本机凭证。", "Test and save the local Aliyun credential."));
    }
    if (statusByKey.get("aliyunStorage") === "fail") {
      fixes.push(fix("aliyunStorage", "/setup/aliyun/storage", "确认资料和向量保存位置。", "Confirm source and vector storage locations."));
    }
    if (statusByKey.get("modelProvider") === "fail") {
      fixes.push(fix("modelProvider", "/setup/aliyun/services", "测试并保存阿里百炼连接。", "Test and save the Model Studio connection."));
    }
    if (statusByKey.get("modelQuality") === "fail") {
      fixes.push(fix("modelQuality", "/setup/aliyun/model-quality", "保存模型与质量方案。", "Save the model and quality profile."));
    }
    if (statusByKey.get("knowledgeSearch") === "fail") {
      fixes.push(fix("knowledgeSearch", "/setup/aliyun/search", "保存知识库索引。", "Save the knowledge index."));
    }
  }

  return fixes;
}

function valueMissing(value) {
  if (Array.isArray(value)) return value.length === 0;
  return !String(value || "").trim();
}

function fix(key, step, zhMessage, enMessage, zhAction = "去处理", enAction = "Fix") {
  return {
    key,
    step,
    label: { zh: "需要处理", en: "Needs attention" },
    message: { zh: zhMessage, en: enMessage },
    action: { zh: zhAction, en: enAction }
  };
}
