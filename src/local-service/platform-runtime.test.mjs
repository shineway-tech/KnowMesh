import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { platformRuntimeInventory } from "./platform-runtime.mjs";

test("platform runtime inventory reports launchers, private node runtime, and system dependencies", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-platform-runtime-"));
  const projectRoot = path.join(temp, "project");
  const runtimeRoot = path.join(temp, "runtime");
  const binDir = path.join(temp, "bin");
  fs.mkdirSync(path.join(projectRoot, "launcher"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "node_modules", "yaml"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "node_modules", "better-sqlite3"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "node", "v24.18.0-linux-x64", "bin"), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "knowmesh"), "#!/usr/bin/env sh\nexec \"$script_dir/launcher/knowmesh\" \"$@\"\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "launcher", "knowmesh"), "KNOWMESH_NODE_VERSION=v24.18.0\nInstalling a private runtime\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "knowmesh",
    version: "0.1.0",
    engines: { node: ">=24" },
    dependencies: { yaml: "^2.7.0", "better-sqlite3": "^12.11.1" }
  }), "utf8");
  for (const command of ["gs", "soffice", "xdg-open", "curl"]) {
    fs.writeFileSync(path.join(binDir, command), "", "utf8");
  }
  const nodePath = path.join(runtimeRoot, "node", "v24.18.0-linux-x64", "bin", "node");
  fs.writeFileSync(nodePath, "", "utf8");

  const inventory = platformRuntimeInventory({ projectRoot }, {
    platform: "linux",
    arch: "x64",
    release: "6.1.0",
    nodePath,
    nodeVersion: "v24.18.0",
    env: {
      HOME: temp,
      KNOWMESH_RUNTIME_DIR: runtimeRoot,
      PATH: binDir
    }
  });

  assert.equal(inventory.kind, "knowmesh.platformRuntimeInventory");
  assert.equal(inventory.summary.status, "ready");
  assert.equal(inventory.node.privateRuntime, true);
  assert.equal(inventory.node.minimumVersion, ">=24");
  assert.equal(inventory.node.packagedVersion, "v24.18.0");
  assert.equal(inventory.launchers.nodeIndependent, true);
  assert.equal(inventory.launchers.privateRuntimeVersion, "v24.18.0");
  assert.equal(inventory.dependencies.pdfRenderer.status, "pass");
  assert.equal(inventory.dependencies.officeConverter.status, "pass");
  assert.equal(inventory.dependencies.providerAdapters.localParser.status, "pass");
  assert.equal(inventory.dependencies.providerAdapters.localOcr.status, "warn");
  assert.equal(inventory.dependencies.providerAdapters.localVector.status, "disabled");
  assert.ok(inventory.dependencies.providerAdapters.localParser.adapters.some((item) => item.key === "modernOffice" && item.status === "pass"));
  assert.ok(inventory.dependencies.providerAdapters.localOcr.adapters.some((item) => item.key === "paddleOcr" && item.status === "missing"));
  assert.equal(inventory.dependencies.packageDependencies.status, "pass");
  assert.equal(inventory.dependencies.folderPicker.status, "pass");
  assert.equal(inventory.dependencies.folderPicker.mode, "manual-path");
  assert.equal(inventory.dependencies.fileReveal.status, "pass");
  assert.equal(inventory.dependencies.fileReveal.command, "xdg-open");
  assert.ok(inventory.checks.some((item) => item.key === "folderPicker" && item.status === "pass"));
  assert.ok(inventory.checks.some((item) => item.key === "fileReveal" && item.status === "pass"));
  assert.ok(inventory.checks.every((item) => item.status === "pass"));
});

test("platform runtime inventory gives guided actions for missing optional dependencies", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-platform-runtime-missing-"));
  const projectRoot = path.join(temp, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "knowmesh",
    version: "0.1.0",
    engines: { node: ">=24" },
    dependencies: { yaml: "^2.7.0", "better-sqlite3": "^12.11.1" }
  }), "utf8");

  const inventory = platformRuntimeInventory({ projectRoot }, {
    platform: "linux",
    arch: "x64",
    release: "6.1.0",
    nodePath: "/usr/bin/node",
    nodeVersion: "v24.18.0",
    env: {
      HOME: temp,
      PATH: ""
    }
  });

  assert.equal(inventory.summary.status, "attention");
  assert.equal(inventory.dependencies.pdfRenderer.status, "warn");
  assert.equal(inventory.dependencies.officeConverter.status, "warn");
  assert.equal(inventory.dependencies.providerAdapters.localParser.adapters.find((item) => item.key === "legacyOffice").status, "missing");
  assert.equal(inventory.dependencies.providerAdapters.localOcr.status, "warn");
  assert.equal(inventory.dependencies.folderPicker.status, "pass");
  assert.equal(inventory.dependencies.folderPicker.mode, "manual-path");
  assert.equal(inventory.dependencies.fileReveal.status, "warn");
  assert.equal(inventory.dependencies.packageDependencies.status, "fail");
  assert.ok(inventory.guidedActions.some((item) => item.key === "installGhostscript"));
  assert.ok(inventory.guidedActions.some((item) => item.key === "installLibreOffice"));
  assert.ok(inventory.guidedActions.some((item) => item.key === "installFileManager"));
  assert.ok(inventory.guidedActions.some((item) => item.key === "installPackages"));
  assert.doesNotMatch(JSON.stringify(inventory), /apiKey|secret|credential/i);
});

test("platform runtime inventory describes native Windows folder picking and file reveal", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-platform-runtime-win32-"));
  const projectRoot = path.join(temp, "project");
  const runtimeRoot = path.join(temp, "runtime");
  fs.mkdirSync(path.join(projectRoot, "launcher"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "node_modules", "yaml"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "node_modules", "better-sqlite3"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "knowmesh.cmd"), "@echo off\r\ncall \"%~dp0launcher\\knowmesh.cmd\" %*\r\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "launcher", "knowmesh.cmd"), "powershell.exe -File knowmesh.ps1 %*\r\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "launcher", "knowmesh.ps1"), "$NodeVersion = \"v24.18.0\"\nInstall-KnowMeshNode\nprivate Node runtime\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "knowmesh",
    version: "0.1.0",
    engines: { node: ">=24" },
    dependencies: { yaml: "^2.7.0", "better-sqlite3": "^12.11.1" }
  }), "utf8");

  const inventory = platformRuntimeInventory({ projectRoot }, {
    platform: "win32",
    arch: "x64",
    release: "10.0.22631",
    nodePath: path.join(runtimeRoot, "node", "v24.18.0-win-x64", "node.exe"),
    nodeVersion: "v24.18.0",
    env: {
      LOCALAPPDATA: temp,
      KNOWMESH_RUNTIME_DIR: runtimeRoot,
      PATH: ""
    }
  });

  assert.equal(inventory.dependencies.folderPicker.status, "pass");
  assert.equal(inventory.dependencies.folderPicker.mode, "native-dialog");
  assert.equal(inventory.dependencies.folderPicker.command, "PowerShell IFileOpenDialog");
  assert.equal(inventory.dependencies.fileReveal.status, "pass");
  assert.equal(inventory.dependencies.fileReveal.command, "explorer.exe");
  assert.ok(inventory.checks.some((item) => item.key === "folderPicker" && item.status === "pass"));
  assert.ok(inventory.checks.some((item) => item.key === "fileReveal" && item.status === "pass"));
});

test("platform runtime inventory derives the Node gate from package engines", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "knowmesh-platform-runtime-node-gate-"));
  const projectRoot = path.join(temp, "project");
  fs.mkdirSync(path.join(projectRoot, "launcher"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "launcher", "knowmesh"), "NODE_VERSION=\"${KNOWMESH_NODE_VERSION:-v24.18.0}\"\nInstalling a private runtime\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
    name: "knowmesh",
    version: "0.1.0",
    engines: { node: ">=24" },
    dependencies: {}
  }), "utf8");

  const inventory = platformRuntimeInventory({ projectRoot }, {
    platform: "linux",
    arch: "x64",
    release: "6.1.0",
    nodePath: "/usr/bin/node",
    nodeVersion: "v23.11.0",
    env: {
      HOME: temp,
      PATH: ""
    }
  });

  assert.equal(inventory.node.status, "fail");
  assert.equal(inventory.node.minimumMajor, 24);
  assert.equal(inventory.node.minimumVersion, ">=24");
  assert.equal(inventory.node.packagedVersion, "v24.18.0");
  assert.ok(inventory.guidedActions.some((item) => item.key === "upgradeNode" && /24\+/.test(item.message.en)));
});
