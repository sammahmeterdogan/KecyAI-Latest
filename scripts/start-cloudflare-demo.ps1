$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$logsDir = Join-Path $scriptDir "_logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logsDir ("start_cloudflare_{0}.log" -f $ts)

function Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append
}

try {
  Log "Repo root: $repoRoot"
  Log "Starting docker compose stack with Cloudflare Quick Tunnel (project=kecyai)..."

  $env:COMPOSE_BAKE = "0"
  $composeBase = "infra/compose/docker-compose.yml"
  $composeCloudflare = "infra/compose/docker-compose.cloudflare.yml"

  cmd /c "docker version" 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "docker version failed (exit code: $LASTEXITCODE)"
  }

  cmd /c "docker compose version" 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose version failed (exit code: $LASTEXITCODE)"
  }

  $prevPref = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  cmd /c "docker compose -p kecyai -f $composeBase -f $composeCloudflare up -d --build" 2>&1 | Tee-Object -FilePath $logFile -Append
  $ErrorActionPreference = $prevPref
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed (exit code: $LASTEXITCODE)"
  }

  Log "Waiting for Cloudflare URL..."
  $publicUrl = $null
  for ($i = 0; $i -lt 30; $i++) {
    $logs = cmd /c "docker logs kecyai-cloudflared" 2>&1
    $match = ($logs | Select-String -Pattern "https://[a-zA-Z0-9-]+\.trycloudflare\.com" -AllMatches | Select-Object -Last 1)
    if ($match) {
      $publicUrl = $match.Matches[0].Value
      break
    }
    Start-Sleep -Seconds 2
  }

  if ($publicUrl) {
    Log "Public demo URL: $publicUrl"
    Log "Share this URL with your friend."
  } else {
    Log "Cloudflare URL not detected yet. Check logs: docker logs -f kecyai-cloudflared"
  }

  Log "Done."
  exit 0
}
catch {
  Log "ERROR: $($_.Exception.Message)"
  Log "Tip: Open this log: $logFile"
  exit 1
}
