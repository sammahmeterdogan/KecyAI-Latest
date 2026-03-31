param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Args
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$runtimeEntry = Join-Path $repoRoot "runtime\app\runtime_entry.py"

$candidates = @(
  (Join-Path $HOME "miniforge3\envs\lerobot\python.exe"),
  (Join-Path $HOME "Desktop\Miniforge3\envs\lerobot\python.exe"),
  (Join-Path $HOME "miniforge3\python.exe"),
  (Join-Path $HOME "Desktop\Miniforge3\python.exe")
)

$python = $null
foreach ($candidate in $candidates) {
  if (Test-Path $candidate) {
    $python = (Resolve-Path $candidate).Path
    break
  }
}

if (-not $python) {
  $cmd = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch "WindowsApps") {
    $python = $cmd.Source
  }
}

if (-not $python) {
  throw "Python was not found."
}

& $python $runtimeEntry @Args
exit $LASTEXITCODE
