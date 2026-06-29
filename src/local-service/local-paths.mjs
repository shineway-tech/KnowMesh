import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { credentialLocations, modelProviderLocations } from "./setup-store.mjs";

export function openKnownLocalPath(state, options = {}) {
  const target = String(options.target || "");
  const targetPath = knownLocalPath(state, target);
  if (!targetPath) {
    return {
      ok: false,
      error: "Unsupported local path target."
    };
  }

  const openPath = pathTargetForOpen(targetPath);
  if (options.dryRun === true) {
    return { ok: true, target, path: openPath, opened: false };
  }

  if (target.endsWith("-directory")) fs.mkdirSync(openPath, { recursive: true });
  openPathWithSystem(openPath);
  return { ok: true, target, path: openPath, opened: true };
}

function knownLocalPath(state, target) {
  const locations = credentialLocations(state);
  const modelLocations = modelProviderLocations(state);
  return {
    "credential-directory": locations.secureLocalDir,
    "credential-file": locations.secureLocal,
    "model-provider-directory": modelLocations.secureLocalDir,
    "model-provider-file": modelLocations.secureLocal,
    "project-env-directory": locations.envFileDir,
    "project-env-file": locations.envFile
  }[target] || "";
}

function pathTargetForOpen(targetPath) {
  if (fs.existsSync(targetPath)) return targetPath;
  return path.extname(targetPath) ? path.dirname(targetPath) : targetPath;
}

function openPathWithSystem(targetPath) {
  const { command, args, options } = buildOpenPathCommand(targetPath);
  const child = spawn(command, args, options);
  child.once("error", () => {});
  child.unref();
}

export function revealLocalFilePath(targetPath, options = {}) {
  const command = buildRevealPathCommand(targetPath);
  if (options.dryRun === true) {
    return {
      ok: true,
      path: path.resolve(targetPath),
      directory: path.dirname(path.resolve(targetPath)),
      opened: false,
      selected: command.selected,
      command: { command: command.command, args: command.args }
    };
  }
  const child = spawn(command.command, command.args, command.options);
  child.once("error", () => {});
  child.unref();
  return {
    ok: true,
    path: path.resolve(targetPath),
    directory: path.dirname(path.resolve(targetPath)),
    opened: true,
    selected: command.selected,
    command: { command: command.command, args: command.args }
  };
}

export function buildRevealPathCommand(targetPath, platform = process.platform) {
  const resolved = path.resolve(targetPath);
  if (platform === "win32") {
    const normalizedPath = path.win32.normalize(resolved);
    return {
      command: "explorer.exe",
      args: [`/select,${normalizedPath}`],
      selected: true,
      options: { detached: true, stdio: "ignore", windowsHide: false }
    };
  }
  if (platform === "darwin") {
    return {
      command: "open",
      args: ["-R", resolved],
      selected: true,
      options: { detached: true, stdio: "ignore", windowsHide: true }
    };
  }
  return {
    command: "xdg-open",
    args: [path.dirname(resolved)],
    selected: false,
    options: { detached: true, stdio: "ignore", windowsHide: true }
  };
}

export function buildOpenPathCommand(targetPath, platform = process.platform) {
  const normalizedPath = platform === "win32" ? path.win32.normalize(targetPath) : path.posix.normalize(targetPath);
  const command = platform === "win32" ? "explorer.exe" : platform === "darwin" ? "open" : "xdg-open";
  return {
    command,
    args: [normalizedPath],
    options: {
      detached: true,
      stdio: "ignore",
      windowsHide: platform === "win32" ? false : true
    }
  };
}

