param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$KnowMeshArgs
)

$ErrorActionPreference = "Stop"
$NodeVersion = if ($env:KNOWMESH_NODE_VERSION) { $env:KNOWMESH_NODE_VERSION } else { "v22.16.0" }
$MinimumNodeMajor = 20

function Write-Step {
  param([string]$Message)
  Write-Host "[KnowMesh] $Message"
}

function Get-ProjectRoot {
  if ($env:KNOWMESH_PROJECT_ROOT) {
    return (Resolve-Path -LiteralPath $env:KNOWMESH_PROJECT_ROOT).Path
  }

  $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
  $fromParent = Join-Path $scriptDir ".."
  if (Test-Path -LiteralPath (Join-Path $fromParent "package.json")) {
    return (Resolve-Path -LiteralPath $fromParent).Path
  }
  if (Test-Path -LiteralPath (Join-Path $scriptDir "package.json")) {
    return (Resolve-Path -LiteralPath $scriptDir).Path
  }

  throw "Cannot find KnowMesh project root. Set KNOWMESH_PROJECT_ROOT and retry."
}

function Get-KnowMeshRuntimeRoot {
  if ($env:KNOWMESH_RUNTIME_DIR) {
    return $env:KNOWMESH_RUNTIME_DIR
  }
  if ($env:LOCALAPPDATA) {
    return (Join-Path $env:LOCALAPPDATA "KnowMesh\runtime")
  }
  return (Join-Path $HOME ".knowmesh\runtime")
}

function Get-WindowsNodeArch {
  $archText = "$env:PROCESSOR_ARCHITECTURE $env:PROCESSOR_ARCHITEW6432"
  if ($archText -match "ARM64") { return "arm64" }
  if ($archText -match "AMD64|x86_64") { return "x64" }
  throw "Unsupported Windows CPU architecture: $archText"
}

function Test-NodeVersion {
  param([string]$NodePath)
  try {
    $version = (& $NodePath --version 2>$null)
    if (-not $version) { return $false }
    $major = [int]($version.TrimStart("v").Split(".")[0])
    return $major -ge $MinimumNodeMajor
  } catch {
    return $false
  }
}

function Get-SystemNode {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command -and (Test-NodeVersion $command.Source)) {
    return $command.Source
  }
  return ""
}

function Install-KnowMeshNode {
  $runtimeRoot = Get-KnowMeshRuntimeRoot
  $arch = Get-WindowsNodeArch
  $nodeDir = Join-Path $runtimeRoot "node\$NodeVersion-win-$arch"
  $nodeExe = Join-Path $nodeDir "node.exe"
  if (Test-NodeVersion $nodeExe) {
    return $nodeExe
  }
  if (Test-Path -LiteralPath $nodeDir) {
    throw "Found an incomplete KnowMesh Node runtime at $nodeDir. Remove it and retry."
  }

  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  $downloads = Join-Path $runtimeRoot "downloads"
  New-Item -ItemType Directory -Force -Path $downloads | Out-Null
  $zipName = "node-$NodeVersion-win-$arch.zip"
  $zipPath = Join-Path $downloads $zipName
  $url = "https://nodejs.org/dist/$NodeVersion/$zipName"

  Write-Step "Downloading private Node runtime: $url"
  Invoke-WebRequest -Uri $url -OutFile $zipPath

  $extractRoot = Join-Path $runtimeRoot ("extract-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Expand-Archive -Path $zipPath -DestinationPath $extractRoot
  $expanded = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
  if (-not $expanded) {
    throw "Node runtime archive did not contain an extracted directory."
  }
  Move-Item -LiteralPath $expanded.FullName -Destination $nodeDir
  if (-not (Test-NodeVersion $nodeExe)) {
    throw "Installed Node runtime is not usable: $nodeExe"
  }
  return $nodeExe
}

function Get-NodePath {
  $systemNode = Get-SystemNode
  if ($systemNode) {
    Write-Step "Using system Node: $systemNode"
    return $systemNode
  }
  Write-Step "System Node.js $MinimumNodeMajor+ was not found. Installing a private runtime."
  return Install-KnowMeshNode
}

function Get-NpmPath {
  param([string]$NodePath)
  $privateNpm = Join-Path (Split-Path -Parent $NodePath) "npm.cmd"
  if (Test-Path -LiteralPath $privateNpm) {
    return $privateNpm
  }
  $command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  $command = Get-Command npm -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  throw "npm was not found next to Node. Reinstall the KnowMesh private runtime."
}

function Ensure-NodeModules {
  param(
    [string]$ProjectRoot,
    [string]$NodePath
  )
  $yamlPackage = Join-Path $ProjectRoot "node_modules\yaml\package.json"
  if (Test-Path -LiteralPath $yamlPackage) {
    return
  }
  $npm = Get-NpmPath $NodePath
  Write-Step "Installing KnowMesh dependencies with $npm"
  Push-Location $ProjectRoot
  try {
    & $npm install --omit=dev
  } finally {
    Pop-Location
  }
}

function Get-KnowMeshCommandArgs {
  if (-not $KnowMeshArgs -or $KnowMeshArgs.Count -eq 0) {
    return @("start")
  }
  return @($KnowMeshArgs)
}

$projectRoot = Get-ProjectRoot
$nodePath = Get-NodePath
Ensure-NodeModules -ProjectRoot $projectRoot -NodePath $nodePath

$cliPath = Join-Path $projectRoot "src\cli\knowmesh.mjs"
$commandArgs = @(Get-KnowMeshCommandArgs)
Write-Step "Starting KnowMesh Web Console"
& $nodePath $cliPath @commandArgs
exit $LASTEXITCODE
