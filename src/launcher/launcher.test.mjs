import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const launcherRoot = path.join(projectRoot, "launcher");

function readLauncher(name) {
  const file = path.join(launcherRoot, name);
  assert.equal(fs.existsSync(file), true, `${name} should exist`);
  return fs.readFileSync(file, "utf8");
}

test("launcher provides Node-independent user entrypoints", () => {
  const cmd = readLauncher("knowmesh.cmd");
  const powershell = readLauncher("knowmesh.ps1");
  const shell = readLauncher("knowmesh");

  assert.match(cmd, /powershell(?:\.exe)?/i);
  assert.match(cmd, /knowmesh\.ps1/);
  assert.doesNotMatch(cmd, /node\s+/i);
  assert.match(powershell, /nodejs\.org\/dist/);
  assert.match(powershell, /Expand-Archive/);
  assert.match(powershell, /LOCALAPPDATA/);
  assert.match(powershell, /KNOWMESH_RUNTIME_DIR/);
  assert.match(shell, /nodejs\.org\/dist/);
  assert.match(shell, /uname -s/);
  assert.match(shell, /uname -m/);
  assert.match(shell, /KNOWMESH_RUNTIME_DIR/);
  assert.doesNotMatch(powershell, /setx\s+PATH/i);
  assert.doesNotMatch(shell, /\bsudo\b/);
});

test("repository root exposes the same user launcher name", () => {
  const rootCmd = fs.readFileSync(path.join(projectRoot, "knowmesh.cmd"), "utf8");
  const rootShell = fs.readFileSync(path.join(projectRoot, "knowmesh"), "utf8");

  assert.match(rootCmd, /launcher[\\/]knowmesh\.cmd/);
  assert.doesNotMatch(rootCmd, /node\s+/i);
  assert.match(rootShell, /launcher\/knowmesh/);
  assert.doesNotMatch(rootShell, /node\s+/i);
});

test("launcher starts the Web Console through a private runtime when system Node is missing", () => {
  const powershell = readLauncher("knowmesh.ps1");
  const shell = readLauncher("knowmesh");

  assert.match(powershell, /Test-NodeVersion/);
  assert.match(powershell, /Install-KnowMeshNode/);
  assert.match(powershell, /Ensure-NodeModules/);
  assert.match(powershell, /src[\\/]cli[\\/]knowmesh\.mjs/);
  assert.match(powershell, /start/);
  assert.match(shell, /test_node_version/);
  assert.match(shell, /install_knowmesh_node/);
  assert.match(shell, /ensure_node_modules/);
  assert.match(shell, /src\/cli\/knowmesh\.mjs/);
  assert.match(shell, /start/);
});

test("README documents launcher-first startup and keeps maintainer Node commands separate", () => {
  const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");

  assert.match(readme, /普通用户启动/);
  assert.match(readme, /launcher[\\/]knowmesh\.cmd start/);
  assert.match(readme, /launcher[\\/]knowmesh start/);
  assert.match(readme, /私有 Node 运行时/);
  assert.match(readme, /不会修改系统 PATH/);
  assert.match(readme, /项目维护入口/);
  assert.match(readme, /node \.\/src\/cli\/knowmesh\.mjs start/);
});

test("Windows launcher passes command arguments to the Node CLI intact", { skip: process.platform !== "win32" }, () => {
  const launcher = path.join(launcherRoot, "knowmesh.cmd");
  const result = spawnSync("cmd.exe", ["/d", "/c", launcher, "help"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      KNOWMESH_PROJECT_ROOT: projectRoot
    }
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(output, /Usage:/);
  assert.doesNotMatch(output, /Unknown command: h/);
});
