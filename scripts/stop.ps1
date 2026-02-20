$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$logsDir = Join-Path $scriptDir "_logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logsDir ("stop_{0}.log" -f $ts)

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append
}

try {
  Log "Repo root: $repoRoot"
  Log "Stopping docker compose stack (project=kecyai)..."

  $env:COMPOSE_BAKE = "0"
  $composeFile = "infra/compose/docker-compose.yml"

  docker compose -p kecyai -f $composeFile down --remove-orphans 2>&1 | Tee-Object -FilePath $logFile -Append

  Log "Done."
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  Log "Tip: Open this log: $logFile"
  exit 1
}
