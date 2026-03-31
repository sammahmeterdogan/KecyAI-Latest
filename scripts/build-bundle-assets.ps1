param(
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$desktopRoot = Join-Path $repoRoot "desktop"
$tauriRoot = Join-Path $desktopRoot "src-tauri"
$binariesDir = Join-Path $tauriRoot "binaries"
$resourcesDir = Join-Path $tauriRoot "resources"
$frontendResourceDir = Join-Path $resourcesDir "frontend"
$pyInstallerWork = Join-Path $tauriRoot ".pyinstaller"
$specPath = Join-Path $tauriRoot "pyinstaller\runtime.spec"
$runtimeDistDir = Join-Path $pyInstallerWork "dist"
$runtimeWorkDir = Join-Path $pyInstallerWork "build"
$targetRuntimeExe = Join-Path $binariesDir "kecyai-runtime-x86_64-pc-windows-msvc.exe"
$frontendRoot = Join-Path $repoRoot "frontend"

function Resolve-Python {
  $candidates = @(
    (Join-Path $HOME "miniforge3\envs\lerobot\python.exe"),
    (Join-Path $HOME "Desktop\Miniforge3\envs\lerobot\python.exe"),
    (Join-Path $HOME "miniforge3\python.exe"),
    (Join-Path $HOME "Desktop\Miniforge3\python.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch "WindowsApps") {
    return $cmd.Source
  }

  throw "Python 3.10+ was not found."
}

function Resolve-Npm {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw "npm was not found."
}

function Ensure-PyInstaller([string]$python) {
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $python -m PyInstaller --version *> $null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevPref

  if ($exitCode -eq 0) {
    return
  }

  & $python -m pip install pyinstaller
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install PyInstaller."
  }
}

function Ensure-PythonModule([string]$python, [string]$moduleName, [string]$installSpec) {
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  @"
import importlib.util
import sys
sys.exit(0 if importlib.util.find_spec("$moduleName") else 1)
"@ | & $python -
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevPref

  if ($exitCode -eq 0) {
    return
  }

  & $python -m pip install $installSpec
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to install Python module: $installSpec"
  }
}

$python = Resolve-Python
$npm = Resolve-Npm

if (-not $SkipFrontend) {
  Push-Location $frontendRoot
  try {
    & $npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend build failed."
    }
  } finally {
    Pop-Location
  }
}

Ensure-PyInstaller $python
Ensure-PythonModule $python "fastapi" "fastapi>=0.115.0"
Ensure-PythonModule $python "uvicorn" "uvicorn[standard]>=0.30.0"

Remove-Item -LiteralPath $pyInstallerWork -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $runtimeDistDir | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeWorkDir | Out-Null
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null
New-Item -ItemType Directory -Force -Path $frontendResourceDir | Out-Null

& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --distpath $runtimeDistDir `
  --workpath $runtimeWorkDir `
  $specPath

if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller build failed."
}

$builtRuntimeExe = Join-Path $runtimeDistDir "kecyai-runtime.exe"
if (-not (Test-Path $builtRuntimeExe)) {
  throw "Frozen runtime executable was not produced: $builtRuntimeExe"
}

Copy-Item -LiteralPath $builtRuntimeExe -Destination $targetRuntimeExe -Force

Remove-Item -LiteralPath $frontendResourceDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $frontendResourceDir | Out-Null
Copy-Item -Path (Join-Path $frontendRoot "dist\*") -Destination $frontendResourceDir -Recurse -Force

Write-Output "Runtime sidecar: $targetRuntimeExe"
Write-Output "Bundled frontend: $frontendResourceDir"
