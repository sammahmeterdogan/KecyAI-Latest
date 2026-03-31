param(
  [switch]$Quiet,
  [switch]$RequireWsl
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

$logsDir = Join-Path $scriptDir "_logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logsDir ("preflight_{0}.log" -f $ts)

$hasFailures = $false
$hasWarnings = $false

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  $line | Tee-Object -FilePath $logFile -Append | Out-Null
  if (-not $Quiet) {
    Write-Host $line
  }
}

function Add-Check([string]$id, [string]$status, [string]$message) {
  if ($status -eq "FAIL") { $script:hasFailures = $true }
  if ($status -eq "WARN") { $script:hasWarnings = $true }
  Write-Log ("[{0}] {1} - {2}" -f $status, $id, $message)
}

function First-Line([object]$value) {
  if ($null -eq $value) { return "" }
  $text = ($value | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  return $text.Split("`n")[0].Trim()
}

Write-Log "Repo root: $repoRoot"
Write-Log "Running Windows preflight checks..."

# CPU virtualization capability checks.
try {
  $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
  if ($null -eq $cpu) {
    Add-Check "cpu.virtualization" "WARN" "Unable to read processor information."
  } else {
    if ($cpu.VMMonitorModeExtensions) {
      Add-Check "cpu.vm_monitor_mode_extensions" "PASS" "CPU virtualization extensions are available."
    } else {
      Add-Check "cpu.vm_monitor_mode_extensions" "FAIL" "CPU virtualization extensions are not available."
    }

    if ($cpu.SecondLevelAddressTranslationExtensions) {
      Add-Check "cpu.slat" "PASS" "Second Level Address Translation (SLAT) is available."
    } else {
      Add-Check "cpu.slat" "FAIL" "SLAT is not available; Docker Desktop may not run Linux containers."
    }

    if ($cpu.VirtualizationFirmwareEnabled) {
      Add-Check "cpu.virtualization_firmware" "PASS" "Virtualization is enabled in firmware."
    } else {
      Add-Check "cpu.virtualization_firmware" "FAIL" "Virtualization is disabled in BIOS/UEFI firmware."
    }
  }
} catch {
  Add-Check "cpu.virtualization" "WARN" ("Unable to query processor virtualization details: {0}" -f $_.Exception.Message)
}

# WSL checks.
$wslOk = $false
if (Get-Command wsl -ErrorAction SilentlyContinue) {
  try {
    $wslStatus = & wsl --status 2>&1
    if ($LASTEXITCODE -eq 0) {
      $wslOk = $true
      Add-Check "wsl.status" "PASS" "WSL is available."
    } else {
      Add-Check "wsl.status" "WARN" ("WSL check failed: {0}" -f (First-Line $wslStatus))
    }
  } catch {
    Add-Check "wsl.status" "WARN" ("WSL command error: {0}" -f $_.Exception.Message)
  }

  try {
    $wslList = & wsl -l -v 2>&1
    if ($LASTEXITCODE -eq 0) {
      $defaultV2 = ($wslList | Select-String -Pattern "\s+2\s*$" -Quiet)
      if ($defaultV2) {
        Add-Check "wsl.version" "PASS" "At least one WSL2 distro is detected."
      } else {
        Add-Check "wsl.version" "WARN" "No WSL2 distro detected. Hardware mode requires Linux/WSL2."
      }
    } else {
      Add-Check "wsl.version" "WARN" ("Unable to list distros: {0}" -f (First-Line $wslList))
    }
  } catch {
    Add-Check "wsl.version" "WARN" ("Unable to check distro versions: {0}" -f $_.Exception.Message)
  }
} else {
  Add-Check "wsl.status" "WARN" "WSL command not found."
}

if ($RequireWsl -and -not $wslOk) {
  Add-Check "wsl.required" "FAIL" "WSL is required for the selected startup profile."
}

# Docker and compose checks.
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Add-Check "docker.cli" "FAIL" "Docker CLI is not installed or not in PATH."
} else {
  try {
    $dockerVersion = & docker version --format "{{.Server.Version}}" 2>&1
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($dockerVersion | Out-String))) {
      Add-Check "docker.engine" "PASS" ("Docker engine reachable (server version {0})." -f (First-Line $dockerVersion))
    } else {
      Add-Check "docker.engine" "FAIL" ("Docker engine not reachable: {0}" -f (First-Line $dockerVersion))
    }
  } catch {
    Add-Check "docker.engine" "FAIL" ("Docker engine check failed: {0}" -f $_.Exception.Message)
  }

  try {
    $composeVersion = & docker compose version 2>&1
    if ($LASTEXITCODE -eq 0) {
      Add-Check "docker.compose" "PASS" ("{0}" -f (First-Line $composeVersion))
    } else {
      Add-Check "docker.compose" "FAIL" ("docker compose unavailable: {0}" -f (First-Line $composeVersion))
    }
  } catch {
    Add-Check "docker.compose" "FAIL" ("docker compose check failed: {0}" -f $_.Exception.Message)
  }
}

if ($hasFailures) {
  Write-Log "Preflight summary: FAIL"
  Write-Log "Preflight log: $logFile"
  exit 1
}

if ($hasWarnings) {
  Write-Log "Preflight summary: WARN"
  Write-Log "Preflight log: $logFile"
  exit 0
}

Write-Log "Preflight summary: PASS"
Write-Log "Preflight log: $logFile"
exit 0
