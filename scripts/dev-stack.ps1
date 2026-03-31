param(
  [ValidateSet("base", "autostart", "hardware", "hardware-autostart")]
  [string]$Profile = "",
  [switch]$SkipPreflight,
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($Profile)) {
  $Profile = if ($env:KECYAI_STARTUP_PROFILE) { $env:KECYAI_STARTUP_PROFILE } else { "base" }
}

if ($Profile -eq "autostart") {
  $Profile = "base"
}
if ($Profile -eq "hardware-autostart") {
  $Profile = "hardware"
}

if (-not $SkipPreflight -and $env:KECYAI_SKIP_PREFLIGHT -eq "1") {
  $SkipPreflight = $true
}

$logsDir = Join-Path $scriptDir "_logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$stateDir = Join-Path $scriptDir "_state"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logsDir ("dev_stack_{0}.log" -f $ts)
$runtimePidFile = Join-Path $stateDir "host_runtime.pid"
$runtimeOutLog = Join-Path $logsDir "host_runtime_stdout.log"
$runtimeErrLog = Join-Path $logsDir "host_runtime_stderr.log"

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append
}

function Get-ComposeFiles([string]$startProfile) {
  $files = @("infra/compose/docker-compose.yml")
  if ($startProfile -eq "hardware") {
    $files += "infra/compose/docker-compose.hardware.yml"
  }
  return $files
}

function Wait-ForHttpOk([string]$url, [int]$timeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Log "Healthy: $url"
        return
      }
    } catch {
      Start-Sleep -Milliseconds 1500
      continue
    }
    Start-Sleep -Milliseconds 1500
  }

  throw "Timed out waiting for $url"
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

  throw "A real Python executable was not found. Install Miniforge or Python 3.10+."
}

function Escape-PsLiteral([string]$value) {
  return $value -replace "'", "''"
}

function Get-RunningPid([string]$pidFile) {
  if (-not (Test-Path $pidFile)) {
    return $null
  }

  $raw = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $raw) {
    return $null
  }

  $procId = 0
  if (-not [int]::TryParse($raw, [ref]$procId)) {
    return $null
  }

  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    return $procId
  }

  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return $null
}

function Ensure-HostHardwareConfigured() {
  $python = Get-HostPython
  $probeScript = Join-Path $repoRoot "scripts\hardware_probe.py"
  if (-not (Test-Path $probeScript)) {
    throw "Missing host hardware probe script: $probeScript"
  }

  Log "Auto-detecting robot USB port on the host..."
  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $python $probeScript auto-configure 2>&1 | Tee-Object -FilePath $logFile -Append
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prevPref
  if ($exitCode -ne 0) {
    throw "Host hardware auto-detect failed. Refusing to start hardware mode in dry-run."
  }
}

function Start-HostRuntime() {
  $existingPid = Get-RunningPid $runtimePidFile
  if ($existingPid) {
    Log "Host runtime already running with PID $existingPid."
    return
  }

  $python = Get-HostPython
  $runtimeEntry = Join-Path $repoRoot "runtime\app\runtime_entry.py"

  $commandParts = @()
  $commandParts += '$env:HOME = ''' + (Escape-PsLiteral $HOME) + ''''
  $commandParts += '$env:KECYAI_SERVICE_HOST = ''0.0.0.0'''
  $commandParts += '$env:KECYAI_SERVICE_PORT = ''8040'''
  $commandParts += '$env:KECYAI_FRONTEND_DEV_URL = ''http://127.0.0.1:3000'''
  $commandParts += '& ''' + (Escape-PsLiteral $python) + ''' ''' + (Escape-PsLiteral $runtimeEntry) + ''' serve'
  $command = $commandParts -join "; "

  Log "Starting host runtime process..."
  $proc = Start-Process powershell.exe `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $runtimeOutLog `
    -RedirectStandardError $runtimeErrLog `
    -PassThru

  Start-Sleep -Seconds 2
  $runtimeProcess = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*$runtimeEntry* serve*" } |
    Select-Object -First 1

  $runtimePid = if ($runtimeProcess) { $runtimeProcess.ProcessId } else { $proc.Id }
  Set-Content -Path $runtimePidFile -Value $runtimePid
  Log "Host runtime PID: $runtimePid"
}

try {
  Log "Repo root: $repoRoot"
  Log "Startup profile: $Profile"
  Log "Skip frontend: $SkipFrontend"
  $env:COMPOSE_BAKE = "0"
  $useWindowsHostHardware = ($env:OS -eq "Windows_NT") -and ($Profile -eq "hardware")

  if (-not $SkipPreflight) {
    $preflightScript = Join-Path $scriptDir "preflight.ps1"
    if (Test-Path $preflightScript) {
      $requireWsl = $Profile -eq "hardware" -and -not $useWindowsHostHardware
      Log "Running preflight checks..."
      & $preflightScript -RequireWsl:$requireWsl
      if ($LASTEXITCODE -ne 0) {
        throw "Preflight failed. See preflight log under scripts/_logs."
      }
    } else {
      Log "WARN: preflight script not found. Continuing without preflight."
    }
  } else {
    Log "Skipping preflight checks."
  }

  if ($useWindowsHostHardware) {
    Log "Windows hardware profile detected. Using host-managed Python runtime instead of Docker."
    Ensure-HostHardwareConfigured
    Start-HostRuntime
    Wait-ForHttpOk "http://localhost:8040/api/ready"
  } else {
    $composeFiles = Get-ComposeFiles $Profile
    $composeArgs = @("compose", "-p", "kecyai")
    foreach ($file in $composeFiles) {
      Log "Compose file: $file"
      $composeArgs += @("-f", $file)
    }
    $composeArgs += @("up", "-d", "--build", "runtime")

    Log "Starting Docker services: runtime"
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & docker @composeArgs 2>&1 | Tee-Object -FilePath $logFile -Append
    $ErrorActionPreference = $prevPref
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose up failed (exit code: $LASTEXITCODE)"
    }

    Wait-ForHttpOk "http://localhost:8040/api/ready"
  }

  if ($SkipFrontend) {
    Log "Python runtime service is ready."
    exit 0
  }

  $npm = Get-NpmCommand
  Log "Starting frontend dev server on http://localhost:3000"
  Push-Location (Join-Path $repoRoot "frontend")
  try {
    & $npm run dev -- --host 2>&1 | Tee-Object -FilePath $logFile -Append
    exit $LASTEXITCODE
  } finally {
    Pop-Location
  }
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  Log "Tip: Open this log: $logFile"
  exit 1
}
