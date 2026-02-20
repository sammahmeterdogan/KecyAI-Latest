# KECY AI — Zero-Terminal Setup (Windows / PowerShell)

Full stack: **Docker Compose** brings up Runtime + Backend + Frontend.  
The end user opens a browser and never touches a terminal.

---

## Prerequisites

| Tool           | Version  | Check                        |
|----------------|----------|------------------------------|
| Docker Desktop | 4.x+     | `docker --version`           |
| Docker Compose | v2+      | `docker compose version`     |
| PowerShell     | 5.1+     | `$PSVersionTable`            |
| Git            | 2.x+     | `git --version`              |

> **Note:** On Windows, make sure Docker Desktop is running before proceeding.

---

## 1. Clone and Start

```powershell
git clone <repo-url> kecyai
cd kecyai
docker compose -f infra/compose/docker-compose.yml up -d --build
```

Three containers start:

| Container       | Port  | Role                                    |
|-----------------|-------|-----------------------------------------|
| `kecyai-runtime`| 8100  | Python LeRobot runtime (dry-run or HW)  |
| `kecyai-backend`| 8080  | Spring Boot gateway (Java 17)           |
| `kecyai-frontend`| 3000 | React UI (Vite)                         |

---

## 2. Health Check

```powershell
# Runtime direct
Invoke-RestMethod http://localhost:8100/health
# Expected: {"status":"ok","service":"kecyai-lerobot-runtime"}

# Backend gateway
Invoke-RestMethod http://localhost:8080/api/lerobot/health
```

---

## 3. Teleop API — Quick Reference

### 3.1 Start Session (Idempotent)

```powershell
$body = @{
    robot_type  = "so101_follower"
    teleop_type = "web"
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
    -Uri http://localhost:8080/api/lerobot/teleop/start `
    -ContentType "application/json" `
    -Body $body
```

**Idempotency rules:**

| Current state         | Request matches session? | HTTP | Behaviour                            |
|-----------------------|--------------------------|------|--------------------------------------|
| idle                  | n/a                      | 200  | New session started                  |
| running, same config  | yes                      | 200  | Returns current status (idempotent)  |
| running, diff config  | no                       | 409  | `{code:"CONFLICT", message:"...", currentStatus:{...}}` |
| invalid body          | n/a                      | 400  | `{code:"VALIDATION_ERROR", message:"...", details:[...]}` |

### 3.2 Check Status

```powershell
Invoke-RestMethod http://localhost:8080/api/lerobot/teleop/status
```

### 3.3 Send Joint Command

```powershell
$cmd = @{
    mode   = "manual"
    joints = @(
        @{ id = "shoulder_pan";  position = 0.2 },
        @{ id = "shoulder_lift"; position = -0.1 },
        @{ id = "elbow_flex";    position = 0.5 },
        @{ id = "wrist_flex";    position = 0.0 },
        @{ id = "wrist_roll";    position = 0.0 },
        @{ id = "gripper";       position = 0.4 }
    )
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Method Post `
    -Uri http://localhost:8080/api/lerobot/teleop/command `
    -ContentType "application/json" `
    -Body $cmd
```

**Response (200):**

```json
{
  "accepted": [
    {"id": "shoulder_pan", "value": 0.2},
    {"id": "shoulder_lift", "value": -0.1}
  ],
  "rejected": [],
  "simulated": true
}
```

**Error (400):**

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Missing required field: 'joints'",
  "details": ["Expected: {\"mode\":\"manual\",\"joints\":[{\"id\":\"shoulder_pan\",\"position\":0.2}]}"]
}
```

### 3.4 Get Joints

```powershell
Invoke-RestMethod http://localhost:8080/api/lerobot/teleop/joints
```

### 3.5 Preset Poses

```powershell
# Home (all joints zero)
Invoke-RestMethod -Method Post http://localhost:8080/api/lerobot/teleop/pose/home

# Ready
Invoke-RestMethod -Method Post http://localhost:8080/api/lerobot/teleop/pose/ready
```

### 3.6 Gripper

```powershell
Invoke-RestMethod -Method Post http://localhost:8080/api/lerobot/teleop/gripper/open
Invoke-RestMethod -Method Post http://localhost:8080/api/lerobot/teleop/gripper/close
```

### 3.7 Stop Session

```powershell
Invoke-RestMethod -Method Post http://localhost:8080/api/lerobot/teleop/stop
```

### 3.8 Telemetry SSE Stream

```powershell
# PowerShell SSE consumption (continuous stream)
$response = Invoke-WebRequest -Uri http://localhost:8080/api/lerobot/teleop/telemetry/stream -Method Get
$response.Content
```

Or open in browser: `http://localhost:8080/api/lerobot/teleop/telemetry/stream`

---

## 4. Error Contract

All error responses follow this structure:

```json
{
  "code": "VALIDATION_ERROR | CONFLICT | PRECONDITION_FAILED | RUNTIME_ERROR | GATEWAY_ERROR | INTERNAL_ERROR",
  "message": "Human-readable explanation",
  "details": ["optional array of specifics"],
  "currentStatus": {}
}
```

| HTTP Status | Code                 | When                                       |
|-------------|----------------------|--------------------------------------------|
| 400         | VALIDATION_ERROR     | Missing/invalid fields, bad JSON           |
| 409         | CONFLICT             | Start with different config while running  |
| 409         | PRECONDITION_FAILED  | Command sent when teleop not started       |
| 500         | RUNTIME_ERROR        | Runtime internal failure                   |
| 500         | GATEWAY_ERROR        | Backend cannot reach runtime               |
| 502         | runtime_unreachable  | Runtime container down                     |

---

## 5. PowerShell Tips (curl Pitfalls)

PowerShell's `curl` is an alias for `Invoke-WebRequest`, not the real curl.
This causes common issues with POST requests:

```powershell
# WRONG: PowerShell curl alias does not behave like Linux curl
curl -X POST http://localhost:8080/api/lerobot/teleop/start -d '{"robot_type":"so101_follower"}'

# CORRECT: Use Invoke-RestMethod with explicit Content-Type
Invoke-RestMethod -Method Post `
    -Uri http://localhost:8080/api/lerobot/teleop/start `
    -ContentType "application/json" `
    -Body '{"robot_type":"so101_follower","teleop_type":"web"}'

# ALTERNATIVE: Use curl.exe (real curl, if installed)
curl.exe -X POST http://localhost:8080/api/lerobot/teleop/start `
    -H "Content-Type: application/json" `
    -d "{\"robot_type\":\"so101_follower\",\"teleop_type\":\"web\"}"
```

---

## 6. Troubleshooting

| Symptom                          | Cause                                    | Fix                                                    |
|----------------------------------|------------------------------------------|---------------------------------------------------------|
| 400 on start                     | Missing Content-Type or body             | Use `Invoke-RestMethod` with `-ContentType "application/json"` |
| 400 on command                   | Missing `joints` array                   | Ensure `{"joints":[...]}` in body                       |
| 409 on start                     | Different session already running        | Call `/teleop/stop` first, then retry                   |
| 502 on any endpoint              | Runtime container not up                 | `docker compose -f infra/compose/docker-compose.yml logs kecyai-runtime`                    |
| Teleop status = "error"          | Stale session file                       | Call `/teleop/stop` to clear                            |
| SSE stream returns nothing       | TeleopManager not initialized            | Call `/teleop/start` first                              |

---

## 7. Autostart (Optional)

By default the backend does **not** auto-start the runtime container.
If you want the UI "CONNECT" button to bring up the runtime automatically:

### Enable

```powershell
# Use the autostart overlay when starting the stack
docker compose -f infra/compose/docker-compose.yml -f infra/compose/docker-compose.autostart.yml up -d --build
```

This does two things:

1. Mounts `/var/run/docker.sock` into the backend container so it can call the Docker Engine API.
2. Sets `RUNTIME_AUTOSTART_ENABLED=true`.

### Properties

| Env Var | Default | Description |
|---------|---------|-------------|
| `RUNTIME_AUTOSTART_ENABLED` | `false` | Master switch |
| `RUNTIME_AUTOSTART_TIMEOUT_SECONDS` | `30` | Max wait for runtime health |
| `RUNTIME_AUTOSTART_CONTAINER_NAME` | `kecyai-runtime` | Container name to start |

### Behaviour

| Runtime status | Autostart | Result |
|---------------|-----------|--------|
| Already healthy | any | Immediate pass (no Docker call) |
| Offline | `false` | 502 `{code:"RUNTIME_UNREACHABLE"}` |
| Offline | `true`, socket OK | Starts container → polls health → 200 |
| Offline | `true`, no socket | 502 `{code:"DOCKER_UNAVAILABLE"}` |
| Offline | `true`, timeout | 502 `{code:"RUNTIME_START_TIMEOUT"}` |
| Container not found | `true` | 502 `{code:"RUNTIME_START_FAILED"}` |

### Security Note

> **⚠️ docker.sock mount = full Docker API access.**
> The backend container can start/stop/remove any container on the host.
> Only enable in trusted development environments. Never in shared/production.

---

## 8. Calibration (Dry-Run)

The calibration wizard runs end-to-end from the UI (`/kecy/platform/kalibrasyon`) or via API.
Without hardware, it operates in **dry-run mode** with simulated joint range data.

### 8.1 Calibration API — Quick Reference

```powershell
# Check calibration status
curl.exe -s http://localhost:8080/api/lerobot/calibration/status
# Expected: {"state":"idle","dry_run":true,...}

# Start calibration (dry-run — no serial_port)
curl.exe -s -X POST http://localhost:8080/api/lerobot/calibration/start ^
  -H "Content-Type: application/json" ^
  -d "{\"robot_type\":\"so101_follower\"}"
# Expected 200: {"state":"running","dry_run":true,"current_step":{"id":"zero_position",...},...}

# Advance each step (repeat 8 times total)
curl.exe -s -X POST http://localhost:8080/api/lerobot/calibration/step ^
  -H "Content-Type: application/json" -d "{}"
# Expected 200: {"state":"running","step_completed":"zero_position","next_step":{"id":"range_shoulder_pan",...},...}

# After 8th step call:
# Expected 200: {"state":"completed","step_completed":"save","artifact_path":"...calibration_so101_follower_YYYYMMDD_HHMMSS.json",...}

# Stop (cancel mid-session)
curl.exe -s -X POST http://localhost:8080/api/lerobot/calibration/stop
# Expected 200: {"state":"stopped","message":"Calibration session stopped."}
```

### 8.2 Conflict Rules

| Scenario | HTTP | Response |
|----------|------|----------|
| Calibration start while teleop running | 409 | `{code:"CONFLICT", message:"Teleop session is active..."}` |
| Teleop start while calibration running | 409 | `{code:"CONFLICT", message:"Calibration session is active..."}` |
| Calibration start while already running | 409 | `{code:"CONFLICT", message:"Calibration already running..."}` |
| Calibration step with E-STOP active | 409 | `{code:"PRECONDITION_FAILED", message:"E-STOP active..."}` |
| Calibration step with no session | 409 | `{code:"PRECONDITION_FAILED", message:"No calibration session running..."}` |

### 8.3 Calibration Steps (SO-ARM101)

| # | Step ID | Description |
|---|---------|-------------|
| 1 | `zero_position` | Confirm all joints at center (zero) |
| 2 | `range_shoulder_pan` | Sweep shoulder pan through full range |
| 3 | `range_shoulder_lift` | Sweep shoulder lift through full range |
| 4 | `range_elbow_flex` | Sweep elbow flex through full range |
| 5 | `range_wrist_flex` | Sweep wrist flex through full range |
| 6 | `range_wrist_roll` | Sweep wrist roll through full range |
| 7 | `range_gripper` | Sweep gripper through full range |
| 8 | `save` | Save calibration artifact to disk |

### 8.4 Hardware Later

When the robot arrives:

1. Connect USB serial cable to the SO-ARM101.
2. Find the serial port: `ls /dev/ttyUSB*` (Linux) or check Device Manager (Windows).
3. Add `serial_port` to the calibration start request:
   ```json
   {"robot_type":"so101_follower","serial_port":"/dev/ttyUSB0"}
   ```
4. If `serial_port` is provided, calibration runs in **real mode** (`dry_run: false`).
5. For Docker: mount the USB device via `infra/compose/docker-compose.hardware.yml`.

---

## 9. Joint Reference (SO-ARM101)

| Joint ID        | Min (rad)  | Max (rad)  | Description      |
|-----------------|------------|------------|------------------|
| shoulder_pan    | -3.14159   | 3.14159    | Base rotation    |
| shoulder_lift   | -1.5708    | 1.5708     | Shoulder pitch   |
| elbow_flex      | -2.2       | 2.2        | Elbow bend       |
| wrist_flex      | -3.14159   | 3.14159    | Wrist pitch      |
| wrist_roll      | -3.14159   | 3.14159    | Wrist rotation   |
| gripper         | 0.0        | 1.0        | Gripper aperture |

