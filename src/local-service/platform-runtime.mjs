import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildOpenPathCommand, buildRevealPathCommand } from "./local-paths.mjs";
import { inspectLocalOcrAdapterDependencies } from "./providers/local-ocr.mjs";
import { inspectLocalParserAdapterDependencies } from "./providers/local-parser.mjs";
import { inspectLocalVectorAdapterDependencies } from "./providers/local-vector.mjs";

const fallbackMinimumNodeMajor = 24;
const fallbackPackagedNodeVersion = "v24.18.0";

export function platformRuntimeInventory(state, options = {}) {
  const projectRoot = path.resolve(state.projectRoot || process.cwd());
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const env = options.env || process.env;
  const nodePath = options.nodePath || process.execPath;
  const nodeVersion = options.nodeVersion || process.version;
  const runtimeRoot = defaultRuntimeRoot(state, { platform, env });
  const packageInfo = readPackageInfo(projectRoot, state.packageInfo);
  const minimumNodeMajor = packageMinimumNodeMajor(packageInfo);
  const launchers = inspectLaunchers(projectRoot, platform);
  const packagedNodeVersion = launchers.privateRuntimeVersion || fallbackPackagedNodeVersion;
  const node = inspectNodeRuntime({ nodePath, nodeVersion, runtimeRoot, platform, arch, minimumNodeMajor, packagedNodeVersion });
  const launchReliability = buildLaunchReliability({ platform, node, launchers, minimumNodeMajor, packagedNodeVersion });
  const dependencies = inspectDependencies(state, {
    projectRoot,
    packageInfo,
    platform,
    env,
    runtimeRoot
  });
  const checks = buildChecks({ node, launchers, dependencies });
  const guidedActions = buildGuidedActions({ node, launchers, dependencies, platform });
  const summary = summarizePlatformRuntime(checks, guidedActions);

  return {
    ok: checks.every((item) => item.status !== "fail"),
    kind: "knowmesh.platformRuntimeInventory",
    apiVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    phase: "phase6-platform-layer",
    summary,
    platform: {
      os: platform,
      arch,
      release: options.release || os.release()
    },
    node,
    launchReliability,
    workspace: {
      projectRoot,
      runtimeRoot,
      packageName: packageInfo.name || "knowmesh",
      packageVersion: packageInfo.version || "0.0.0"
    },
    launchers,
    dependencies,
    checks,
    guidedActions,
    privacy: {
      redacted: true,
      excludes: ["sourceContent", "documentText", "providerKeys", "answerText"]
    }
  };
}

function inspectNodeRuntime({ nodePath, nodeVersion, runtimeRoot, platform, arch, minimumNodeMajor, packagedNodeVersion }) {
  const major = nodeMajor(nodeVersion);
  const resolvedNodePath = path.resolve(nodePath || "");
  const privateRuntime = runtimeRoot ? isPathInside(resolvedNodePath, runtimeRoot) : false;
  const status = major >= minimumNodeMajor ? "pass" : "fail";
  return {
    status,
    version: nodeVersion || "",
    executable: resolvedNodePath,
    minimumVersion: `>=${minimumNodeMajor}`,
    minimumMajor: minimumNodeMajor,
    privateRuntime,
    packagedVersion: packagedNodeVersion,
    target: `${platform}-${arch}`,
    message: status === "pass"
      ? label("Node.js 版本满足运行要求。", "Node.js satisfies the runtime requirement.")
      : label(`需要 Node.js ${minimumNodeMajor} 或更高版本。`, `Node.js ${minimumNodeMajor} or newer is required.`)
  };
}

function inspectLaunchers(projectRoot, platform) {
  const definitions = [
    launcherDefinition("rootWindows", "knowmesh.cmd", ["win32"], true),
    launcherDefinition("windowsCmd", path.join("launcher", "knowmesh.cmd"), ["win32"], true),
    launcherDefinition("windowsPowerShell", path.join("launcher", "knowmesh.ps1"), ["win32"], true),
    launcherDefinition("rootShell", "knowmesh", ["darwin", "linux"], true),
    launcherDefinition("posixShell", path.join("launcher", "knowmesh"), ["darwin", "linux"], true)
  ];
  const items = definitions.map((definition) => {
    const absolutePath = path.join(projectRoot, definition.relativePath);
    const content = readTextIfSmall(absolutePath);
    return {
      key: definition.key,
      platform: definition.platforms,
      required: definition.platforms.includes(platform) && definition.required,
      relativePath: definition.relativePath.replaceAll("\\", "/"),
      exists: fs.existsSync(absolutePath),
      nodeInstaller: hasPrivateRuntimeInstaller(content),
      nodeVersion: extractPackagedNodeVersion(content),
      mutatesPath: launcherContentMutatesPath(content)
    };
  });
  const requiredItems = items.filter((item) => item.required);
  const missing = requiredItems.filter((item) => !item.exists);
  const nodeIndependent = requiredItems.some((item) => item.exists && item.nodeInstaller);
  const status = missing.length ? "fail" : nodeIndependent ? "pass" : "warn";
  const privateRuntimeVersion = items.find((item) => item.nodeVersion)?.nodeVersion || fallbackPackagedNodeVersion;
  return {
    status,
    nodeIndependent,
    privateRuntimeVersion,
    required: requiredItems.map((item) => item.relativePath),
    missing: missing.map((item) => item.relativePath),
    items
  };
}

function buildLaunchReliability({ platform, node, launchers, minimumNodeMajor, packagedNodeVersion }) {
  const supportedLaunchers = launchers.items
    .filter((item) => item.platform.includes(platform))
    .map((item) => ({
      key: item.key,
      platform: item.platform,
      required: item.required,
      relativePath: item.relativePath,
      exists: item.exists,
      privateRuntimeInstaller: item.nodeInstaller,
      mutatesPath: item.mutatesPath
    }));
  const required = supportedLaunchers.filter((item) => item.required);
  const missing = required.filter((item) => !item.exists);
  const pathMutating = required.filter((item) => item.mutatesPath);
  const canPrepare = required.some((item) => item.exists && item.privateRuntimeInstaller);
  const status = node.status === "pass" && missing.length === 0 && pathMutating.length === 0 && canPrepare ? "pass" : "attention";

  return {
    status,
    apiVersion: "1.0.0",
    minimumNodeMajor,
    browserTarget: {
      protocol: "http",
      host: "127.0.0.1",
      defaultPort: 7457,
      localhostOnly: true
    },
    portFallback: {
      supported: true,
      attemptsWhenFixedPortBusy: 20
    },
    stateAuthority: {
      workspace: "workspace.sqlite",
      catalog: "catalog.sqlite",
      browserStorage: "visual-preferences-only",
      implicitKnowledgeBase: false
    },
    privateRuntime: {
      canPrepare,
      packagedVersion: packagedNodeVersion
    },
    pathMutationGuard: {
      mutatesPath: pathMutating.length > 0,
      checkedPatterns: ["PATH=", "export PATH=", "$env:Path", "setx", "SetEnvironmentVariable"],
      offenders: pathMutating.map((item) => item.relativePath)
    },
    supportedLaunchers,
    nextActions: launchReliabilityNextActions({ node, missing, pathMutating, canPrepare })
  };
}

function launchReliabilityNextActions({ node, missing, pathMutating, canPrepare }) {
  const actions = [];
  if (node.status !== "pass") {
    actions.push(guidedAction(
      "upgradeNode",
      "安装 Node 24+ 或使用启动器",
      "Install Node 24+ or use launcher",
      "当前 Node 版本低于运行要求；使用 KnowMesh 启动器可准备私有运行时。",
      "The current Node version is below the runtime requirement; use the KnowMesh launcher to prepare a private runtime."
    ));
  }
  if (missing.length) {
    actions.push(guidedAction(
      "restoreLaunchers",
      "恢复启动器文件",
      "Restore Launcher Files",
      `缺少启动器：${missing.map((item) => item.relativePath).join(", ")}。`,
      `Missing launcher(s): ${missing.map((item) => item.relativePath).join(", ")}.`
    ));
  }
  if (!canPrepare) {
    actions.push(guidedAction(
      "usePackagedRuntimeLauncher",
      "保留私有运行时启动器",
      "Keep Private Runtime Launcher",
      "启动器需要能在缺少系统 Node 时准备私有 Node 运行时。",
      "The launcher must be able to prepare a private Node runtime when system Node is missing."
    ));
  }
  if (pathMutating.length) {
    actions.push(guidedAction(
      "removePathMutation",
      "移除 PATH 修改",
      "Remove PATH Mutation",
      "启动器不应永久修改用户 PATH；请改为进程内直接调用私有 Node。",
      "Launchers should not permanently mutate user PATH; invoke the private Node process directly instead."
    ));
  }
  return actions;
}

function inspectDependencies(state, context) {
  return {
    packageDependencies: inspectPackageDependencies(context.projectRoot, context.packageInfo),
    fileOpen: inspectFileOpen(context.projectRoot, context.platform, context.env),
    folderPicker: inspectFolderPicker(context.platform),
    fileReveal: inspectFileReveal(context.projectRoot, context.platform, context.env),
    runtimeDownloader: inspectRuntimeDownloader(context.platform, context.env),
    officeConverter: inspectOfficeConverter(state, context),
    pdfRenderer: inspectPdfRenderer(state, context),
    providerAdapters: inspectProviderAdapters(state, context)
  };
}

function inspectProviderAdapters(state, context) {
  return {
    localParser: inspectLocalParserAdapterDependencies(state, context),
    localOcr: inspectLocalOcrAdapterDependencies(state, context),
    localVector: inspectLocalVectorAdapterDependencies(state, context)
  };
}

function inspectPackageDependencies(projectRoot, packageInfo) {
  const dependencies = Object.keys(packageInfo.dependencies || {});
  const required = dependencies.length ? dependencies : ["better-sqlite3", "yaml"];
  const missing = required.filter((name) => !fs.existsSync(path.join(projectRoot, "node_modules", name)));
  return {
    status: missing.length ? "fail" : "pass",
    required,
    missing,
    message: missing.length
      ? label("本地运行依赖还没有安装完整。", "Local runtime dependencies are not fully installed.")
      : label("本地运行依赖已安装。", "Local runtime dependencies are installed.")
  };
}

function inspectFileOpen(projectRoot, platform, env) {
  const command = buildOpenPathCommand(projectRoot, platform);
  const resolvedCommand = commandAvailable(command.command, { platform, env, osProvided: ["explorer.exe", "open"] });
  const status = resolvedCommand ? "pass" : "warn";
  return {
    status,
    command: command.command,
    resolvedCommand,
    argsPreview: command.args,
    message: status === "pass"
      ? label("可以调用系统文件管理器打开文件夹。", "The system file manager can be used.")
      : label("没有找到系统打开文件夹命令。", "The folder-open command was not found.")
  };
}

function inspectFolderPicker(platform) {
  if (platform === "win32") {
    return {
      status: "pass",
      mode: "native-dialog",
      command: "PowerShell IFileOpenDialog",
      message: label("可以调用系统目录选择框。", "The native folder picker can be used.")
    };
  }
  return {
    status: "pass",
    mode: "manual-path",
    command: "",
    message: label("可以直接粘贴目录路径继续配置。", "Folder paths can be pasted directly to continue setup.")
  };
}

function inspectFileReveal(projectRoot, platform, env) {
  const command = buildRevealPathCommand(projectRoot, platform);
  const resolvedCommand = commandAvailable(command.command, { platform, env, osProvided: ["explorer.exe", "open"] });
  const status = resolvedCommand ? "pass" : "warn";
  return {
    status,
    command: command.command,
    resolvedCommand,
    selected: command.selected,
    argsPreview: command.args,
    message: status === "pass"
      ? label("可以在系统文件管理器中定位文件。", "Files can be revealed in the system file manager.")
      : label("没有找到用于定位文件的系统命令。", "The system file-reveal command was not found.")
  };
}

function inspectRuntimeDownloader(platform, env) {
  if (platform === "win32") {
    return {
      status: "pass",
      command: "PowerShell Invoke-WebRequest",
      resolvedCommand: "PowerShell Invoke-WebRequest",
      message: label("Windows 启动器可使用 PowerShell 下载私有运行时。", "The Windows launcher can download the private runtime with PowerShell.")
    };
  }
  const resolvedCommand = findCommandOnPath(["curl", "wget"], { platform, env });
  const status = resolvedCommand ? "pass" : "warn";
  return {
    status,
    command: resolvedCommand ? path.basename(resolvedCommand) : "",
    resolvedCommand,
    message: status === "pass"
      ? label("可以下载缺失的私有 Node 运行时。", "The private Node runtime can be downloaded when missing.")
      : label("需要 curl 或 wget 才能自动下载私有 Node 运行时。", "curl or wget is needed to download the private Node runtime.")
  };
}

function inspectOfficeConverter(state, { platform, env }) {
  const custom = Array.isArray(state.compatibilityConverters) ? state.compatibilityConverters.filter((item) => item?.command) : [];
  const systemEnabled = state.enableSystemConverters !== false;
  const resolvedCommand = systemEnabled ? findCommandOnPath(["soffice", "libreoffice"], { platform, env }) : "";
  const status = custom.length || resolvedCommand ? "pass" : "warn";
  return {
    status,
    commands: custom.map((item) => item.command).concat(systemEnabled ? ["soffice", "libreoffice"] : []),
    resolvedCommand: custom[0]?.command || resolvedCommand,
    sourceTypes: ["doc", "wps", "xls", "et", "ppt", "dps"],
    message: status === "pass"
      ? label("旧 Office/WPS 转换器可用。", "A legacy Office/WPS converter is available.")
      : label("未找到旧 Office/WPS 转换器；现代 Office、PDF 和文本仍可处理。", "No legacy Office/WPS converter was found; modern Office, PDF, and text sources still work.")
  };
}

function inspectPdfRenderer(state, { platform, env }) {
  const explicit = state.pdfRendererCommand || env.KNOWMESH_GHOSTSCRIPT_PATH || "";
  const resolvedCommand = explicit || findGhostscriptCommand({ platform, env });
  const status = resolvedCommand ? "pass" : "warn";
  return {
    status,
    command: resolvedCommand ? path.basename(resolvedCommand) : "",
    resolvedCommand,
    sourceTypes: ["pdf", "split-pdf"],
    message: status === "pass"
      ? label("Ghostscript 可用于扫描 PDF 拆页。", "Ghostscript can render scanned PDF pages.")
      : label("未找到 Ghostscript；扫描 PDF 的 OCR 拆页会被阻止。", "Ghostscript was not found; OCR page rendering for scanned PDFs will be blocked.")
  };
}

function buildChecks({ node, launchers, dependencies }) {
  return [
    runtimeCheck("nodeRuntime", node.status, "Node 运行时", "Node Runtime", node.message),
    runtimeCheck(
      "launchers",
      launchers.status,
      "启动器",
      "Launchers",
      launchers.status === "pass"
        ? label("当前平台启动器齐全，并能在缺少系统 Node 时准备私有运行时。", "Launchers are present and can prepare a private runtime when system Node is missing.")
        : launchers.status === "fail"
          ? label("当前平台缺少必要启动器。", "Required launchers are missing for this platform.")
          : label("启动器存在，但未确认私有运行时安装能力。", "Launchers exist, but private-runtime setup was not confirmed.")
    ),
    runtimeCheck("packageDependencies", dependencies.packageDependencies.status, "应用依赖", "App Dependencies", dependencies.packageDependencies.message),
    runtimeCheck("fileOpen", dependencies.fileOpen.status, "文件打开", "Open Folder", dependencies.fileOpen.message),
    runtimeCheck("folderPicker", dependencies.folderPicker.status, "目录选择", "Folder Picker", dependencies.folderPicker.message),
    runtimeCheck("fileReveal", dependencies.fileReveal.status, "定位文件", "Reveal File", dependencies.fileReveal.message),
    runtimeCheck("runtimeDownloader", dependencies.runtimeDownloader.status, "运行时下载", "Runtime Download", dependencies.runtimeDownloader.message),
    runtimeCheck("officeConverter", dependencies.officeConverter.status, "旧格式转换", "Legacy Conversion", dependencies.officeConverter.message),
    runtimeCheck("pdfRenderer", dependencies.pdfRenderer.status, "PDF 拆页", "PDF Rendering", dependencies.pdfRenderer.message)
  ];
}

function buildGuidedActions({ node, launchers, dependencies, platform }) {
  const actions = [];
  if (node.status === "fail") {
    actions.push(guidedAction(
      "upgradeNode",
      "安装或使用打包启动器",
      "Install Node or use packaged launcher",
      `安装 Node.js ${node.minimumMajor}+，或直接通过 KnowMesh 启动器启动以准备私有运行时。`,
      `Install Node.js ${node.minimumMajor}+ or start through the KnowMesh launcher to prepare a private runtime.`
    ));
  }
  if (launchers.status !== "pass") {
    actions.push(guidedAction(
      "repairLaunchers",
      "恢复启动器",
      "Restore Launchers",
      platform === "win32" ? "保留 knowmesh.cmd、launcher/knowmesh.cmd 和 launcher/knowmesh.ps1。" : "保留 knowmesh 和 launcher/knowmesh。",
      platform === "win32" ? "Keep knowmesh.cmd, launcher/knowmesh.cmd, and launcher/knowmesh.ps1." : "Keep knowmesh and launcher/knowmesh."
    ));
  }
  if (dependencies.packageDependencies.status === "fail") {
    actions.push(guidedAction(
      "installPackages",
      "安装本地依赖",
      "Install App Dependencies",
      "重新运行 KnowMesh 启动器，或在项目根目录执行 npm install --omit=dev。",
      "Run the KnowMesh launcher again, or run npm install --omit=dev from the project root."
    ));
  }
  if (dependencies.runtimeDownloader.status === "warn") {
    actions.push(guidedAction(
      "installDownloader",
      "安装下载工具",
      "Install Downloader",
      "安装 curl 或 wget，便于启动器自动下载私有 Node 运行时。",
      "Install curl or wget so the launcher can download the private Node runtime."
    ));
  }
  if (dependencies.fileReveal.status === "warn") {
    actions.push(guidedAction(
      "installFileManager",
      "安装文件管理器",
      "Install File Manager",
      platform === "linux" ? "安装 xdg-open 所属的桌面文件管理工具，或继续手动打开目录。" : "恢复系统文件管理器命令，或继续手动打开目录。",
      platform === "linux" ? "Install the desktop file-manager tools that provide xdg-open, or open folders manually." : "Restore the system file-manager command, or open folders manually."
    ));
  }
  if (dependencies.officeConverter.status === "warn") {
    actions.push(guidedAction(
      "installLibreOffice",
      "安装 LibreOffice",
      "Install LibreOffice",
      "安装 LibreOffice，并确保 soffice 或 libreoffice 可被 PATH 找到。",
      "Install LibreOffice and make sure soffice or libreoffice is available on PATH."
    ));
  }
  if (dependencies.pdfRenderer.status === "warn") {
    actions.push(guidedAction(
      "installGhostscript",
      "安装 Ghostscript",
      "Install Ghostscript",
      "安装 Ghostscript，或设置 KNOWMESH_GHOSTSCRIPT_PATH 指向 gs/gswin64c。",
      "Install Ghostscript, or set KNOWMESH_GHOSTSCRIPT_PATH to gs/gswin64c."
    ));
  }
  return actions;
}

function summarizePlatformRuntime(checks, guidedActions) {
  const counts = {
    total: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
    fail: checks.filter((item) => item.status === "fail").length
  };
  return {
    status: counts.fail > 0 || counts.warn > 0 ? "attention" : "ready",
    checks: counts,
    actionCount: guidedActions.length
  };
}

function defaultRuntimeRoot(state, { platform, env }) {
  if (env.KNOWMESH_RUNTIME_DIR) return path.resolve(env.KNOWMESH_RUNTIME_DIR);
  if (platform === "win32") {
    if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, "KnowMesh", "runtime");
    return path.join(homeDir(env, state), ".knowmesh", "runtime");
  }
  return path.join(homeDir(env, state), ".knowmesh", "runtime");
}

function homeDir(env, state) {
  return env.HOME || env.USERPROFILE || state.userDataRoot || os.homedir();
}

function readPackageInfo(projectRoot, fromState = null) {
  if (fromState?.name) return fromState;
  const packagePath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packagePath)) return { name: "knowmesh", version: "0.0.0", dependencies: { "better-sqlite3": "", yaml: "" } };
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return { name: "knowmesh", version: "0.0.0", dependencies: {}, ...parsed };
  } catch {
    return { name: "knowmesh", version: "0.0.0", dependencies: { "better-sqlite3": "", yaml: "" } };
  }
}

function packageMinimumNodeMajor(packageInfo) {
  const engine = packageInfo?.engines?.node || "";
  const match = String(engine).match(/>=\s*(\d+)/);
  return match ? Number(match[1]) : fallbackMinimumNodeMajor;
}

function launcherDefinition(key, relativePath, platforms, required) {
  return { key, relativePath, platforms, required };
}

function readTextIfSmall(file) {
  try {
    if (!fs.existsSync(file)) return "";
    const stat = fs.statSync(file);
    if (stat.size > 128 * 1024) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function hasPrivateRuntimeInstaller(content) {
  return /KNOWMESH_NODE_VERSION|NODE_VERSION/.test(content)
    && /private Node runtime|private runtime|Install-KnowMeshNode|install_knowmesh_node/i.test(content);
}

function launcherContentMutatesPath(content) {
  const text = String(content || "");
  return /\bsetx\b/i.test(text)
    || /SetEnvironmentVariable\s*\(/i.test(text)
    || /(?:^|\r?\n)\s*\$env:Path\s*=/i.test(text)
    || /(?:^|\r?\n)\s*(?:set\s+PATH|PATH)\s*=/i.test(text)
    || /(?:^|\r?\n)\s*export\s+PATH\s*=/i.test(text);
}

function extractPackagedNodeVersion(content) {
  for (const pattern of [
    /KNOWMESH_NODE_VERSION[^\r\n]*?(v\d+\.\d+\.\d+)/,
    /NODE_VERSION[^\r\n]*?(v\d+\.\d+\.\d+)/,
    /NodeVersion[^\r\n]*?(v\d+\.\d+\.\d+)/
  ]) {
    const match = String(content || "").match(pattern);
    if (match) return match[1];
  }
  return "";
}

function findGhostscriptCommand({ platform, env }) {
  const names = platform === "win32" ? ["gswin64c.exe", "gswin32c.exe", "gs.exe", "gs"] : ["gs"];
  const fromPath = findCommandOnPath(names, { platform, env });
  if (fromPath) return fromPath;
  if (platform !== "win32") return "";
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
  for (const root of roots) {
    const gsRoot = path.join(root, "gs");
    if (!fs.existsSync(gsRoot)) continue;
    const versions = fs.readdirSync(gsRoot).sort().reverse();
    for (const version of versions) {
      for (const name of names) {
        const candidate = path.join(gsRoot, version, "bin", name);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return "";
}

function commandAvailable(command, options) {
  if (options.osProvided?.includes(command)) return command;
  return findCommandOnPath([command], options);
}

function findCommandOnPath(names, { platform, env }) {
  const pathEntries = String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const extensions = platform === "win32"
    ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  for (const dir of pathEntries) {
    for (const name of names) {
      for (const extension of commandExtensions(name, extensions, platform)) {
        const candidate = path.join(dir, `${name}${extension}`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return "";
}

function commandExtensions(name, extensions, platform) {
  if (platform !== "win32") return [""];
  return path.extname(name) ? [""] : extensions;
}

function nodeMajor(version) {
  const match = String(version || "").match(/v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function isPathInside(candidate, root) {
  const normalizedCandidate = normalizeForCompare(path.resolve(candidate));
  const normalizedRoot = normalizeForCompare(path.resolve(root));
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${normalizeForCompare(path.sep)}`);
}

function normalizeForCompare(value) {
  return process.platform === "win32" ? String(value).toLowerCase() : String(value);
}

function runtimeCheck(key, status, zhLabel, enLabel, message) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message
  };
}

function guidedAction(key, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}

function label(zh, en) {
  return { zh, en };
}
