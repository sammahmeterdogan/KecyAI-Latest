# KECY AI - Zero-Terminal Setup (Windows / PowerShell)

The simplified stack exposes a single Python service. End users should reach robotics workflows through KECY AI UI paths without managing multiple servers.

## Current service model

| Component | Port | Role |
|-----------|------|------|
| Python runtime service | 8040 | Direct API + optional frontend hosting |
| Frontend dev server | 3000 | Browser development only |

## Docker start

```powershell
git clone <repo-url> kecyai
cd kecyai
docker compose -f infra/compose/docker-compose.yml up -d --build
```

Optional frontend container:

```powershell
docker compose -f infra/compose/docker-compose.yml `
  -f infra/compose/docker-compose.web.yml up -d --build
```

## Health check

```powershell
Invoke-RestMethod http://localhost:8040/api/health
Invoke-RestMethod http://localhost:8040/api/lerobot/health
```

## Teleop quick reference

```powershell
$body = @{
  robot_type  = "so101_follower"
  teleop_type = "web"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri http://localhost:8040/api/lerobot/teleop/start `
  -ContentType "application/json" `
  -Body $body
```

Status:

```powershell
Invoke-RestMethod http://localhost:8040/api/lerobot/teleop/status
```

Stop:

```powershell
Invoke-RestMethod -Method Post http://localhost:8040/api/lerobot/teleop/stop
```

Telemetry stream:

```powershell
Invoke-WebRequest -Uri http://localhost:8040/api/lerobot/teleop/telemetry/stream -Method Get
```

## Error contract

Structured errors are returned directly by the runtime service:

```json
{
  "code": "VALIDATION_ERROR | CONFLICT | PRECONDITION_FAILED | RUNTIME_ERROR | INTERNAL_ERROR",
  "message": "Human-readable explanation",
  "details": {},
  "currentStatus": {}
}
```

HTTP 409 remains the transport for state collisions such as teleop/calibration conflicts.

## Calibration quick reference

```powershell
Invoke-RestMethod http://localhost:8040/api/lerobot/calibration/status

Invoke-RestMethod -Method Post `
  -Uri http://localhost:8040/api/lerobot/calibration/start `
  -ContentType "application/json" `
  -Body '{"robot_type":"so101_follower"}'
```

## Notes

- There is no Java gateway in the active architecture.
- `VITE_API_BASE_URL` is the unified frontend override.
- For desktop use, prefer the Tauri launcher, which starts the local Python service and waits for `/api/health`.
