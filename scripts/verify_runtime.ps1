$ErrorActionPreference = "Stop"

function Test-Endpoint {
    param($Uri, $Method="Get", $Body=$null)
    Write-Host "Testing $Method $Uri ..." -NoNewline
    try {
        if ($Body) {
            $resp = Invoke-RestMethod -Uri $Uri -Method $Method -Body ($Body | ConvertTo-Json) -ContentType "application/json"
        } else {
            $resp = Invoke-RestMethod -Uri $Uri -Method $Method
        }
        Write-Host " OK" -ForegroundColor Green
        return $resp
    } catch {
        if ($_.Exception.Response.StatusCode -eq "NotFound") {
             Write-Host " 404 (Expected if no artifacts)" -ForegroundColor Yellow
             return $null
        }
        Write-Host " FAILED ($($_))" -ForegroundColor Red
        Write-Host $_.Exception.Response.StatusCode
        # return $_.Exception.Response
        return $null
    }
}

try {
    # 1. Health
    $h = Test-Endpoint "http://localhost:8100/health"
    if ($h.status -ne "ok") { throw "Health check failed" }

    # 2. Preflight
    $p = Test-Endpoint "http://localhost:8100/admin/preflight"
    Write-Host "Preflight Ready: $($p.ready)"
    Write-Host "Hints: $($p.hints -join ', ')"

    # 3. Calibration List
    $c = Test-Endpoint "http://localhost:8100/admin/calibration/list"
    Write-Host "Artifacts found: $($c.artifacts.Count)"

    # 4. Calibration Latest
    $l = Test-Endpoint "http://localhost:8100/admin/calibration/latest"

    # 5. Teleop Start (Dry Run)
    $t = Test-Endpoint "http://localhost:8100/teleop/start" "Post" @{robot_type="so101_follower"; dry_run=$true}
    Write-Host "Teleop Mode: $($t.mode)"
    if ($t.mode -ne "simulation") { Write-Warning "Expected simulation mode!" }

    # 6. Stop Teleop
    Test-Endpoint "http://localhost:8100/teleop/stop" "Post" | Out-Null

} catch {
    Write-Error $_
    exit 1
}
