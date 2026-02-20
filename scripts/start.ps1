$ErrorActionPreference = "Stop"

# Resolve repo root from this script location
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

try {
  Log "Repo root: $repoRoot"
  Log "Starting docker compose stack (project=kecyai)..."

  # Avoid bake/buildx edge-cases where images are not loaded/tagged locally
  $env:COMPOSE_BAKE = "0"

  $composeFile = "infra/compose/docker-compose.yml"

  # Basic sanity
  docker version | Out-Null
  docker compose version | Out-Null

  docker compose -p kecyai -f $composeFile up -d --build 2>&1 | Tee-Object -FilePath $logFile -Append

  Start-Sleep -Seconds 2

  $url = "http://localhost:3000/kecy/platform/teleop"
  Log "Opening UI: $url"
  Start-Process $url

  Log "Done."
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  Log "Tip: Open this log: $logFile"
  exit 1
}
