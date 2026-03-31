$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$logsDir = Join-Path $scriptDir "_logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$stateDir = Join-Path $scriptDir "_state"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logsDir ("stop_{0}.log" -f $ts)
$runtimePidFile = Join-Path $stateDir "host_runtime.pid"

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append
}

function Stop-ManagedProcess([string]$name, [string]$pidFile) {
  if (-not (Test-Path $pidFile)) {
    return
  }

  $raw = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $procId = 0
  if (-not [int]::TryParse($raw, [ref]$procId)) {
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    return
  }

  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($proc) {
    Log "Stopping host-managed $name process PID $procId..."
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }

  Remove-Item $pidFile -ErrorAction SilentlyContinue
}

function Stop-ManagedProcessByCommandLine([string]$name, [string]$pattern) {
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $pattern }

  foreach ($proc in $procs) {
    if ($proc.ProcessId -and $proc.ProcessId -ne $PID) {
      Log "Stopping host-managed $name process PID $($proc.ProcessId) via command-line match..."
      Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

try {
  Log "Repo root: $repoRoot"
  Stop-ManagedProcess "runtime" $runtimePidFile
  Stop-ManagedProcessByCommandLine "runtime" "runtime\\app\\runtime_entry\.py.*serve"
  Stop-ManagedProcessByCommandLine "runtime" "runtime\\app\\server\.py"
  Log "Stopping docker compose stack (project=kecyai)..."

  $env:COMPOSE_BAKE = "0"
  $composeFile = "infra/compose/docker-compose.yml"

  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  docker compose -p kecyai -f $composeFile down --remove-orphans 2>&1 | Tee-Object -FilePath $logFile -Append
  $ErrorActionPreference = $prevPref
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose down failed (exit code: $LASTEXITCODE)"
  }

  Log "Done."
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  Log "Tip: Open this log: $logFile"
  exit 1
}
