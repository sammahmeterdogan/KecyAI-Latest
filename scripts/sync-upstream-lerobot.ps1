# sync-upstream-lerobot.ps1
# Syncs local LeRobot clone into runtime/upstream/lerobot/
# Usage: .\scripts\sync-upstream-lerobot.ps1 [-Source <path>]
param(
    [string]$Source = "$HOME\Desktop\lerobot-main"
)

$ErrorActionPreference = "Stop"

# ── Validate source ──
if (-not (Test-Path "$Source\.git")) {
    Write-Error "Source path '$Source' does not contain a git repo. Aborting."
    exit 1
}

# ── Resolve paths ──
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path "$ScriptDir\..").Path
$Dest = "$RepoRoot\runtime\upstream\lerobot"

Write-Host "Source : $Source" -ForegroundColor Cyan
Write-Host "Dest   : $Dest" -ForegroundColor Cyan

# ── Get upstream commit ──
$Commit = git -C $Source rev-parse --short HEAD
$FullCommit = git -C $Source rev-parse HEAD
$Branch = git -C $Source rev-parse --abbrev-ref HEAD
$Date = (Get-Date -Format "yyyy-MM-dd")
Write-Host "Commit : $Commit ($Branch)" -ForegroundColor Green

# ── Sync files (exclude .git, caches) ──
if (Test-Path $Dest) {
    Remove-Item -Recurse -Force $Dest
}
robocopy $Source $Dest /E /XD .git __pycache__ .mypy_cache .ruff_cache .venv node_modules /XF *.pyc /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

# ── Update UPSTREAM.md ──
$UpstreamDoc = "$RepoRoot\docs\architecture\upstream_dependencies.md"
if (Test-Path $UpstreamDoc) {
    $content = Get-Content $UpstreamDoc -Raw
    $content = $content -replace "(?<=\*\*Pinned Commit\*\* \| \`).*?(?=\`)", $FullCommit
    $content = $content -replace "(?<=\*\*Branch\*\* \| \`).*?(?=\`)", $Branch
    $content = $content -replace "(?<=\*\*Sync Date\*\* \| )[\d-]+", $Date
    Set-Content $UpstreamDoc -Value $content -NoNewline
    Write-Host "Updated UPSTREAM.md with $FullCommit" -ForegroundColor Green
}

Write-Host "`nDone. Vendored LeRobot @ $Commit ($Date)" -ForegroundColor Green
