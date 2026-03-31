param(
  [ValidateSet("desktop", "services")]
  [string]$Target = "desktop",
  [ValidateSet("base", "autostart", "hardware", "hardware-autostart")]
  [string]$Profile = "base",
  [switch]$SkipPreflight
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$logsDir = Join-Path $scriptDir "_logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logsDir ("start_{0}.log" -f $ts)

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append
}

function Get-NpmCommand() {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw "npm was not found in PATH."
}

function Get-HostPython() {
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

  return $null
}

function Try-AutoSelectHardwareProfile() {
  if ($env:OS -ne "Windows_NT") {
    return $false
  }

  $python = Get-HostPython
  if (-not $python) {
    return $false
  }

  $probeScript = Join-Path $repoRoot "scripts\hardware_probe.py"
  if (-not (Test-Path $probeScript)) {
    return $false
  }

  Log "Checking for a live robot on Windows host ports..."
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $python $probeScript auto-configure 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevPref
  return ($exitCode -eq 0)
}

try {
  Log "Repo root: $repoRoot"
  if (-not $PSBoundParameters.ContainsKey("Profile") -and (Try-AutoSelectHardwareProfile)) {
    $Profile = "hardware"
    Log "Auto-selected startup profile: hardware"
  }

  if ($Profile -eq "autostart") {
    $Profile = "base"
    Log "Mapped deprecated profile 'autostart' to 'base'."
  }
  if ($Profile -eq "hardware-autostart") {
    $Profile = "hardware"
    Log "Mapped deprecated profile 'hardware-autostart' to 'hardware'."
  }

  Log "Startup target: $Target"
  Log "Startup profile: $Profile"
  $env:KECYAI_STARTUP_PROFILE = $Profile
  if ($SkipPreflight) {
    $env:KECYAI_SKIP_PREFLIGHT = "1"
  } else {
    Remove-Item Env:KECYAI_SKIP_PREFLIGHT -ErrorAction SilentlyContinue
  }

  if ($Target -eq "services") {
    Log "Starting Python runtime service only."
    & (Join-Path $scriptDir "dev-stack.ps1") -Profile $Profile -SkipPreflight:$SkipPreflight -SkipFrontend
    exit $LASTEXITCODE
  }

  $npm = Get-NpmCommand
  Log "Launching Tauri desktop development shell."
  & $npm --prefix desktop run dev 2>&1 | Tee-Object -FilePath $logFile -Append
  exit $LASTEXITCODE
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  Log "Tip: Open this log: $logFile"
  exit 1
}
